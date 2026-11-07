// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IDexPair, IWETH, DexMath} from "./interfaces/IDex.sol";
import {IAggregatorV3} from "./interfaces/IOracle.sol";
import {AGIToken} from "./AGIToken.sol";

/// @title AGIMint — agent-gated fair mint
/// @notice Agent-gated fair mint. Shares are sold on a rising price ladder. Up to the
///         open threshold each payment parks its liquidity share and mints inventory
///         for the pool; the threshold share opens the official pair, sends the LP to
///         the dead address, and switches trading on. After the pool opens, every mint
///         buys at a small discount to the pool price and pairs its liquidity share
///         into the pool, again burning the LP, while a floor line burns pool inventory
///         to keep the price from falling below a level set by total paid.
///
///         Eligibility is proven by an EIP-712 voucher from the gate signer (the signer
///         checks the caller's Agent-ID off-chain). The voucher binds the caller, the
///         Agent-ID and a nonce, so it cannot be replayed or used by another wallet.
contract AGIMint is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------- constants
    uint256 public constant TOTAL_SHARES = 444_000;
    uint256 public constant MAX_SUPPLY = 4_440_000_000 ether; // 4.44B

    uint256 public constant USER_SHARE = 11_000 ether; // minter tokens per share, pre-open (backtest-tuned for the flat-then-step ladder)
    uint256 public constant POOL_SHARE = 6_820 ether; // pool inventory per share, pre-open (backtest-tuned for the flat-then-step ladder)

    // Payment split: 80% to the pool, 20% to the treasury.
    uint256 public constant TREASURY_BPS = 2_000;
    // Post-open mint buys at 99% of the pool price.
    uint256 public constant MINT_PRICE_BPS = 9_900;

    // Floor line = totalPaid * FLOOR_LINE / LINE_DENOM. These three are deploy params
    // (tuned to the token's price scale); see immutables below.
    uint256 public constant RISE_NUM = 1_008; // at most +0.8% per transaction
    uint256 public constant RISE_DEN = 1_000;

    uint256 public constant FREE_PER_ID = 1; // base free shares per Agent-ID (lifted by invites/social)
    // Two SEPARATE free tracks, each 1 per Agent-ID (a WL agent can claim BOTH = 2 free; a non-WL
    // agent can only claim the public one). WL eligibility is attested in the voucher's `wl` flag
    // by the gate signer (the backend only signs wl=true for whitelisted Agent-IDs).
    uint256 public constant WL_FREE_CAP = 500;     // whitelist free shares (total)
    uint256 public constant PUBLIC_FREE_CAP = 500; // public free shares (total)
    uint256 public constant WL_PER_AGENT = 5;      // max WL free per Agent-ID (1 base social-task + invites)
    uint256 public constant PUBLIC_PER_AGENT = 5;  // max public free per Agent-ID (base + social tasks)
    uint256 public constant MAX_PER_TX = 10;
    uint256 public constant REFUND_WINDOW = 30 days; // auto-refund if the pool never opens in 30 days
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // EIP-712
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant MINT_TYPEHASH =
        keccak256("Mint(address minter,uint256 agentId,uint256 nonce,uint256 deadline)");
    bytes32 private constant FREE_TYPEHASH =
        keccak256("Free(address minter,uint256 agentId,bool wl,uint256 shares,uint256 nonce,uint256 deadline)");

    // ------------------------------------------------------------- immutables
    AGIToken public immutable token;
    IDexPair public immutable pair;
    address public immutable weth;
    address public immutable gateSigner; // off-chain mint-eligibility signer
    address public immutable treasury;
    uint256 public immutable MAX_PAID_PER_WALLET; // paid shares cap, per wallet
    uint256 public immutable OPEN_AT; // threshold share that opens the pool
    uint256 public immutable OPEN_TOKENS; // pool inventory seeded at open (= OPEN_AT * POOL_SHARE)
    uint256 public immutable mintStart; // unix time the mint opens; mint() and mintFree() revert before it (0 = no time gate)
    uint256 public immutable FLOOR_LINE; // floor-line numerator (tuned to price scale)
    uint256 public immutable LINE_DENOM; // floor-line denominator
    uint256 public immutable POOL_TOKEN_FLOOR; // min pool token reserve kept by floor burns
    // USD pricing oracle (shares are priced in USD, paid in ETH converted at mint time).
    address public immutable ethUsdFeed; // Chainlink ETH/USD aggregator proxy
    address public immutable sequencerFeed; // L2 sequencer uptime feed (0 to skip)
    uint256 public immutable feedHeartbeat; // max age of a fresh answer
    uint256 public immutable feedMin; // sanity floor for the answer
    uint256 public immutable feedMax; // sanity ceiling for the answer
    uint256 public immutable sequencerGrace; // grace period after sequencer restart
    bool private immutable _tokenIs0;

    // ------------------------------------------------------------- state
    uint256 public totalMinted;
    uint256 public totalPaid;
    bool public paused = true;
    bool public seeded;
    bool public renounced;
    uint256 public pendingQuote; // parked quote (WETH) for the opening pool
    uint256 public pendingTokens; // parked token inventory for the opening pool
    uint256 public openedTime;
    uint256 public firstMintTime; // timestamp of the first mint; starts the refund clock

    uint256 public wlFreeSupply;     // WL free shares claimed (cap WL_FREE_CAP)
    uint256 public publicFreeSupply; // public free shares claimed (cap PUBLIC_FREE_CAP)
    mapping(uint256 => uint256) public wlMinted;     // WL free claimed by Agent-ID (cap WL_PER_AGENT)
    mapping(uint256 => uint256) public publicMinted; // public free claimed by Agent-ID (cap PUBLIC_PER_AGENT)
    mapping(address => uint256) public paidMinted; // paid shares taken, by wallet
    mapping(bytes32 => bool) public spentNonce; // mint voucher replay guard
    // Pre-open refund ledger: shares minted and ETH paid, per minter, while the pool is closed.
    // 100% of pre-open payments are escrowed here; if the pool never opens, these are refundable.
    mapping(address => uint256) public refundShares;
    mapping(address => uint256) public refundPaid;

    event Minted(address indexed minter, uint256 indexed agentId, uint256 firstSerial, uint256 shares, uint256 paid);
    event FreeMinted(address indexed minter, uint256 indexed agentId, bool wl, uint256 shares);
    event Opened(uint256 quoteIn, uint256 tokensIn, uint256 lp);
    event PoolBurned(uint256 atShare, uint256 amount);
    event TaxSwapped(uint256 tokensIn, uint256 ethOut);
    event Seeded();
    event PausedSet(bool paused);
    event Renounced();
    event Refunded(address indexed minter, uint256 shares, uint256 amount);

    error NotTreasury();
    error AdminRenounced();
    error Paused();
    error NotSeeded();
    error BadShares();
    error SoldOut();
    error Quota();
    error OverMaxCost();
    error BadPayment();
    error StalePrice();
    error BadSignature();
    error Slippage();
    error BadConfig();
    error Replayed();
    error NotOpen();
    error NotStarted();
    error RefundClosed();
    error NothingToRefund();
    error NothingToSwap();
    error SwappedThisBlock();
    error ZeroAddress();
    error PayoutFailed();

    struct Config {
        address token;
        address weth;
        address gateSigner;
        address treasury;
        uint256 maxPaidPerWallet;
        uint256 openAt;
        uint256 floorLineNum;
        uint256 floorLineDenom;
        uint256 poolTokenFloor;
        address ethUsdFeed;
        address sequencerFeed;
        uint256 feedHeartbeat;
        uint256 feedMin;
        uint256 feedMax;
        uint256 sequencerGrace;
        uint256 mintStart;
    }

    constructor(Config memory c) {
        if (
            c.token == address(0) || c.weth == address(0) || c.gateSigner == address(0)
                || c.treasury == address(0) || c.ethUsdFeed == address(0)
        ) revert ZeroAddress();
        if (c.openAt == 0 || c.openAt > TOTAL_SHARES || c.floorLineDenom == 0) revert BadConfig();
        // free is a SEPARATE $0 track (mintFree), independent of the paid pool-open threshold
        if (c.maxPaidPerWallet == 0) revert BadConfig();
        if (c.feedMin == 0 || c.feedMin >= c.feedMax || c.feedHeartbeat == 0) revert BadConfig();
        token = AGIToken(payable(c.token));
        pair = IDexPair(token.pair());
        weth = c.weth;
        gateSigner = c.gateSigner;
        treasury = c.treasury;
        MAX_PAID_PER_WALLET = c.maxPaidPerWallet;
        OPEN_AT = c.openAt;
        OPEN_TOKENS = c.openAt * POOL_SHARE;
        FLOOR_LINE = c.floorLineNum;
        LINE_DENOM = c.floorLineDenom;
        POOL_TOKEN_FLOOR = c.poolTokenFloor;
        ethUsdFeed = c.ethUsdFeed;
        sequencerFeed = c.sequencerFeed;
        feedHeartbeat = c.feedHeartbeat;
        feedMin = c.feedMin;
        feedMax = c.feedMax;
        sequencerGrace = c.sequencerGrace;
        mintStart = c.mintStart;
        _tokenIs0 = pair.token0() == address(token);
    }

    receive() external payable {
        if (msg.sender != weth) revert BadPayment();
    }

    // ------------------------------------------------------------- views
    /// @notice Price of paid share `n` in whole US cents (these ARE the dollar-cents).
    ///         Flat $1.00 until the pool opens at paid share OPEN_AT, then one step up per
    ///         10,000-share band, reaching $8.04 on the final paid share (444,000). Free shares are a
    ///         separate $0 track (mintFree), so this ladder is paid-position only.
    function priceCents(uint256 n) public view returns (uint256) {
        if (n <= OPEN_AT) return 100; // $1.00 flat while funds accumulate before the pool opens
        uint256 band = (n - 1) / 10_000; // 0 in the flat region, then 1, 2, ... per 10k paid shares
        return 100 + band * 16; // +$0.16 per band; band 44 at share 444,000 => $8.04
    }

    /// @notice Price of share `n` in USD, 18 decimals. priceCents is whole dollar-cents,
    ///         so 100c * 1e16 = 1e18 = $1.00.
    function priceUsd(uint256 n) public view returns (uint256) {
        return priceCents(n) * 1e16;
    }

    /// @notice Total USD cost (18 dec) for the next `shares`.
    function costUsd(uint256 shares) public view returns (uint256 cost) {
        uint256 n = totalMinted;
        for (uint256 i; i < shares; i++) {
            cost += priceUsd(n + 1 + i);
        }
    }

    /// @notice ETH (wei) the next `shares` cost at the current oracle price.
    function quoteEth(uint256 shares) public view returns (uint256) {
        (uint256 px, uint256 unit) = _ethUsd();
        return _costEth(shares, px, unit);
    }

    /// @dev Reads and validates the ETH/USD feed; returns (answer, 10**decimals).
    function _ethUsd() internal view returns (uint256 px, uint256 unit) {
        if (sequencerFeed != address(0)) {
            (, int256 up, uint256 since,,) = IAggregatorV3(sequencerFeed).latestRoundData();
            // up == 0 means the sequencer is live; require a valid round up past the grace period.
            if (up != 0 || since == 0 || block.timestamp - since <= sequencerGrace) revert StalePrice();
        }
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IAggregatorV3(ethUsdFeed).latestRoundData();
        if (
            answer <= 0 || updatedAt == 0 || answeredInRound < roundId
                || block.timestamp > updatedAt + feedHeartbeat
        ) revert StalePrice();
        px = uint256(answer);
        if (px < feedMin || px > feedMax) revert StalePrice();
        unit = 10 ** IAggregatorV3(ethUsdFeed).decimals();
    }

    /// @dev ETH wei for a USD (18-dec) amount at price `px` scaled by `unit` (= 10**decimals).
    function _ethAt(uint256 usd18, uint256 px, uint256 unit) internal pure returns (uint256) {
        return usd18 * unit / px;
    }

    /// @dev ETH cost summed share-by-share so it matches the per-share settlement exactly.
    function _costEth(uint256 shares, uint256 px, uint256 unit) internal view returns (uint256 cost) {
        uint256 n = totalMinted;
        for (uint256 i; i < shares; i++) {
            cost += _ethAt(priceUsd(n + 1 + i), px, unit);
        }
    }


    function opened() public view returns (bool) {
        return totalMinted >= OPEN_AT;
    }

    function reserves() public view returns (uint256 rQuote, uint256 rToken) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (rToken, rQuote) = _tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function circulating() public view returns (uint256) {
        return token.totalSupply() - token.balanceOf(address(pair)) - token.balanceOf(DEAD)
            - token.balanceOf(address(this));
    }

    function floorValue() public view returns (uint256) {
        return totalPaid * FLOOR_LINE / LINE_DENOM;
    }

    // ------------------------------------------------------------- treasury admin
    function _onlyTreasury() private view {
        if (msg.sender != treasury) revert NotTreasury();
        if (renounced) revert AdminRenounced();
    }

    function seed() external {
        _onlyTreasury();
        seeded = true;
        emit Seeded();
    }

    function setPaused(bool next) external {
        _onlyTreasury();
        if (!next && !seeded) revert NotSeeded();
        paused = next;
        emit PausedSet(next);
    }

    function setPoolBlocked(address pool, bool blocked) external {
        _onlyTreasury();
        token.setPoolBlocked(pool, blocked);
    }

    /// @notice Gives up pause and pool-blocking for good. Minting keeps running.
    function renounce() external {
        _onlyTreasury();
        if (!seeded) revert NotSeeded();
        renounced = true;
        paused = false;
        token.disableBlocks();
        emit Renounced();
    }


    // ------------------------------------------------------------- mint
    /// @param shares   number of shares to mint (1..MAX_PER_TX)
    /// @param agentId  the caller's Agent-ID, attested by the voucher
    /// @param nonce    voucher nonce (single use)
    /// @param deadline voucher expiry
    /// @param sig      gate-signer EIP-712 signature over Mint(minter,agentId,nonce,deadline)
    /// @param maxCost  max wei the caller will pay
    function mint(
        uint256 shares,
        uint256 agentId,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        uint256 maxCost,
        uint256 minTokensOut
    ) external payable nonReentrant {
        if (paused) revert Paused();
        if (block.timestamp < mintStart) revert NotStarted();
        if (shares == 0 || shares > MAX_PER_TX) revert BadShares();
        if (totalMinted + shares > TOTAL_SHARES) revert SoldOut();
        if (block.timestamp > deadline) revert BadSignature();

        bytes32 digest = _digest(keccak256(abi.encode(MINT_TYPEHASH, msg.sender, agentId, nonce, deadline)));
        if (spentNonce[digest]) revert Replayed();
        _requireSigner(digest, sig, gateSigner);
        spentNonce[digest] = true;

        // Paid-only ladder. Free shares are a SEPARATE $0 track (mintFree), so paid minting runs
        // in parallel from the first share and never waits for the WL/free pool to sell out.
        if (paidMinted[msg.sender] + shares > MAX_PAID_PER_WALLET) revert Quota();
        paidMinted[msg.sender] += shares;

        // USD-priced, paid in ETH at the current oracle price. `maxCost` is max ETH wei.
        (uint256 px, uint256 unit) = _ethUsd();
        uint256 cost = _costEth(shares, px, unit);
        if (cost > maxCost || msg.value < cost) revert OverMaxCost();

        IWETH(weth).deposit{value: cost}();
        uint256 got = _mintShares(agentId, shares, cost, px, unit);
        if (got < minTokensOut) revert Slippage();

        // Refund surplus ETH last (checks-effects-interactions).
        uint256 surplus = msg.value - cost;
        if (surplus > 0) {
            (bool ok,) = msg.sender.call{value: surplus}("");
            if (!ok) revert PayoutFailed();
        }
    }

    // ------------------------------------------------------------- free mint ($0 giveaway, parallel)
    /// @notice Claim a free share ($0): one per Agent-ID on each track. `wl=true` draws from the
    ///         whitelist track (cap WL_FREE_CAP), `wl=false` from the public track (cap PUBLIC_FREE_CAP).
    ///         A whitelisted agent can claim BOTH (2 free); a non-WL agent only the public one. This
    ///         runs in PARALLEL with paid minting — it never blocks or waits for the ladder. Free
    ///         shares mint USER_SHARE to the agent only (no pool, no escrow, no pool-open effect).
    function mintFree(uint256 agentId, bool wl, uint256 shares, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        if (paused) revert Paused();
        if (block.timestamp < mintStart) revert NotStarted();
        if (shares == 0) revert BadShares();
        if (block.timestamp > deadline) revert BadSignature();
        // The voucher binds `shares` = the allocation this agent EARNED off-chain (social tasks +
        // invites, tracked in Supabase). The contract enforces the hard per-agent and total caps.
        bytes32 digest =
            _digest(keccak256(abi.encode(FREE_TYPEHASH, msg.sender, agentId, wl, shares, nonce, deadline)));
        if (spentNonce[digest]) revert Replayed();
        _requireSigner(digest, sig, gateSigner);
        spentNonce[digest] = true;

        if (wl) {
            if (wlMinted[agentId] + shares > WL_PER_AGENT) revert Quota();
            if (wlFreeSupply + shares > WL_FREE_CAP) revert SoldOut();
            wlMinted[agentId] += shares;
            wlFreeSupply += shares;
        } else {
            if (publicMinted[agentId] + shares > PUBLIC_PER_AGENT) revert Quota();
            if (publicFreeSupply + shares > PUBLIC_FREE_CAP) revert SoldOut();
            publicMinted[agentId] += shares;
            publicFreeSupply += shares;
        }
        token.mint(msg.sender, shares * USER_SHARE); // $0 giveaway; MAX_SUPPLY cap enforced in the token
        emit FreeMinted(msg.sender, agentId, wl, shares);
    }

    // ------------------------------------------------------------- refund
    /// @notice If the pool never opens, every pre-open minter can reclaim 100% of what they
    ///         paid once REFUND_WINDOW has passed since the first mint. The minter's tokens
    ///         and the matching parked pool inventory are burned, the escrowed ETH is
    ///         returned, and the shares are released. Permanently off once the pool opens.
    function refund() external nonReentrant {
        if (opened()) revert RefundClosed();
        if (firstMintTime == 0 || block.timestamp < firstMintTime + REFUND_WINDOW) revert RefundClosed();
        uint256 shares = refundShares[msg.sender];
        uint256 amount = refundPaid[msg.sender];
        if (shares == 0 || amount == 0) revert NothingToRefund();

        // effects
        refundShares[msg.sender] = 0;
        refundPaid[msg.sender] = 0;
        totalMinted -= shares;
        totalPaid -= amount;
        pendingQuote -= amount;
        pendingTokens -= shares * POOL_SHARE;

        // un-mint the minter's stake and the parked pool inventory for these shares
        token.burnFromHolder(msg.sender, shares * USER_SHARE);
        token.burnFromHolder(address(this), shares * POOL_SHARE);

        // return the escrowed ETH (unwrap WETH), interactions last
        IWETH(weth).withdraw(amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert PayoutFailed();
        emit Refunded(msg.sender, shares, amount);
    }

    struct Pool {
        uint256 q; // quote reserve (working)
        uint256 t; // token reserve (working)
        uint256 startQ;
        uint256 startT;
        uint256 circ;
        uint256 supply;
        uint256 addQ; // quote to add to the pool this tx
        uint256 addT; // tokens to add to the pool this tx
        uint256 burnT; // pool tokens to burn this tx (floor line)
        uint256 userT; // tokens owed to the minter this tx
    }

    function _mintShares(uint256 agentId, uint256 shares, uint256 cost, uint256 px, uint256 unit)
        private
        returns (uint256 minted)
    {
        if (firstMintTime == 0) firstMintTime = block.timestamp;
        uint256 first = totalMinted + 1;
        uint256 toTreasury;
        uint256 preShares; // pre-open shares this tx (refundable)
        uint256 prePaid; // pre-open ETH this tx (refundable)
        Pool memory p;
        bool live = opened();
        if (live) _loadPool(p);

        for (uint256 n = first; n < first + shares; n++) {
            uint256 pay = _ethAt(priceUsd(n), px, unit);
            totalPaid += pay;
            if (n <= OPEN_AT) {
                // Pre-open: escrow the FULL payment. The treasury cut is deferred to _open()
                // so a launch that never opens can refund 100% of what each minter paid.
                p.userT += USER_SHARE;
                pendingQuote += pay;
                pendingTokens += POOL_SHARE;
                token.mint(address(this), POOL_SHARE);
                preShares += 1;
                prePaid += pay;
                if (n == OPEN_AT) {
                    token.mint(msg.sender, p.userT);
                    minted += p.userT;
                    p.userT = 0;
                    _open();
                    live = true;
                    _loadPool(p);
                }
            } else {
                uint256 cut = pay * TREASURY_BPS / 10_000;
                toTreasury += cut;
                _curveShare(p, n, pay, pay - cut);
            }
        }
        totalMinted = first + shares - 1;
        // Record refundable stake only if the pool did NOT open in this tx. If it opened,
        // the pre-open funds are committed to the pool and refunds are permanently off.
        if (preShares > 0 && !live) {
            refundShares[msg.sender] += preShares;
            refundPaid[msg.sender] += prePaid;
        }

        if (p.userT > 0) {
            token.mint(msg.sender, p.userT);
            minted += p.userT;
        }
        if (live && p.addQ > 0) _settle(p);
        if (toTreasury > 0) IERC20(weth).safeTransfer(treasury, toTreasury);
        emit Minted(msg.sender, agentId, first, shares, cost);
    }

    function _loadPool(Pool memory p) private view {
        (p.q, p.t) = reserves();
        p.startQ = p.q;
        p.startT = p.t;
        p.circ = circulating();
        p.supply = token.totalSupply();
    }

    /// @dev Settles one post-open share against the working pool: mint tokens to the
    ///      buyer at 99% of pool price, pair the liquidity share in at pool price, then
    ///      apply the floor line by reducing the token reserve (burn) toward the target,
    ///      capped so the price rises at most RISE_NUM/RISE_DEN per transaction and never
    ///      below POOL_TOKEN_FLOOR. Equivalent to settling share by share.
    function _curveShare(Pool memory p, uint256 n, uint256 pay, uint256 lpQuote) private {
        uint256 userT = pay * p.t * 10_000 / (p.q * MINT_PRICE_BPS);
        uint256 lpT = (lpQuote * p.t + p.q - 1) / p.q;
        p.supply += userT + lpT;
        if (p.supply > MAX_SUPPLY) revert SoldOut();
        p.userT += userT;
        p.circ += userT;
        p.q += lpQuote;
        p.t += lpT;
        p.addQ += lpQuote;
        p.addT += lpT;

        // Floor line: keep circulating value (priced in quote) at or above the line.
        uint256 line = totalPaid * FLOOR_LINE / LINE_DENOM;
        if (p.circ * p.q / p.t >= line) return;
        uint256 byTarget = p.q * p.circ / line;
        uint256 byRise = (p.q * p.startT * RISE_DEN + p.startQ * RISE_NUM - 1) / (p.startQ * RISE_NUM);
        uint256 next = byTarget > byRise ? byTarget : byRise;
        if (next < POOL_TOKEN_FLOOR) next = POOL_TOKEN_FLOOR;
        if (next >= p.t) return;
        uint256 burn = p.t - next;
        p.t = next;
        p.burnT += burn;
        emit PoolBurned(n, burn);
    }

    function _settle(Pool memory p) private {
        IERC20(weth).safeTransfer(address(pair), p.addQ);
        token.mint(address(pair), p.addT);
        pair.mint(DEAD);
        if (p.burnT > 0) token.burnFromPair(p.burnT);
        pair.sync();
    }

    function _open() private {
        uint256 topUp = OPEN_TOKENS - pendingTokens;
        if (topUp > 0) token.mint(address(this), topUp);
        uint256 escrowed = pendingQuote; // 100% of pre-open payments, held in escrow
        pendingQuote = 0;
        pendingTokens = 0;
        uint256 treasuryCut = escrowed * TREASURY_BPS / 10_000; // the deferred 20%, paid now
        uint256 quoteIn = escrowed - treasuryCut; // 80% seeds the pool
        if (treasuryCut > 0) IERC20(weth).safeTransfer(treasury, treasuryCut);
        // Seed the pool with exactly `quoteIn`. If anyone donated WETH to the empty pair before
        // open, send only the shortfall so the opening price stays authoritative (not inflated by
        // the donation); the escrow we did not need to send then goes to the treasury. (audit L1)
        uint256 donated = IERC20(weth).balanceOf(address(pair));
        uint256 seedQuote = quoteIn > donated ? quoteIn - donated : 0;
        if (seedQuote > 0) IERC20(weth).safeTransfer(address(pair), seedQuote);
        uint256 leftover = quoteIn - seedQuote;
        if (leftover > 0) IERC20(weth).safeTransfer(treasury, leftover);
        IERC20(address(token)).safeTransfer(address(pair), OPEN_TOKENS);
        uint256 lp = pair.mint(DEAD);
        token.enableTrading();
        pair.sync();
        openedTime = block.timestamp;
        emit Opened(quoteIn, OPEN_TOKENS, lp);
    }

    // ------------------------------------------------------------- helpers
    function _digest(bytes32 structHash) private view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("AGI Mint"), keccak256("1"), block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _requireSigner(bytes32 digest, bytes calldata sig, address who) private pure {
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || got != who) revert BadSignature();
    }
}
