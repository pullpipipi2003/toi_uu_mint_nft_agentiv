<script>
      (function(){
        "use strict";
        const MARKET_ADDR = "0xA59493C4Fc96a44c3EbAc7985464a10cD43Fb0f6";
        const NFT = "0x9395e207F9928657237DE96ffB12340094c073cd";
        const RPC = "https://rpc-bsc.48.club";
        const MKT_ABI = [
          "function getListings(uint256,uint256) view returns (uint256[],address[],uint256[],bool[])",
          "function listings(uint256) view returns (address,uint256)",
          "function listedCount() view returns (uint256)",
          "function totalVolume() view returns (uint256)",
          "function totalSales() view returns (uint256)",
          "function collectionOffer(address) view returns (uint256)",
          "function getCollectionOffers(uint256,uint256) view returns (address[],uint256[])",
          "function buy(uint256) payable",
          "function list(uint256,uint256)",
          "function cancel(uint256)",
          "function makeOffer(uint256) payable",
          "function getTokenOffers(uint256) view returns (address[],uint256[])",
          "function tokenOffer(uint256,address) view returns (uint256)",
          "function offers(uint256,address) view returns (uint256)",
          "function cancelOffer(uint256)",
          "function acceptOffer(uint256,address,uint256)",
          "function makeCollectionOffer() payable",
          "function acceptCollectionOffer(uint256,address,uint256)",
          "function cancelCollectionOffer()"
        ];
        const NFT_ABI = [
          "function ownerOf(uint256) view returns (address)",
          "function balanceOf(address) view returns (uint256)",
          "function setApprovalForAll(address,bool)",
          "function isApprovedForAll(address,address) view returns (bool)"
        ];
        const out = (t) => { document.getElementById('mOut').innerHTML = t; const tt = document.getElementById('mToast'); if (tt){ tt.innerHTML = t; tt.style.display = 'block'; clearTimeout(window.__nsToastT); window.__nsToastT = setTimeout(() => { tt.style.display = 'none'; }, 7000); } };
        const fmtFull = (w) => { const q = 10000000000n; let v; try { v = (BigInt(w) + q / 2n) / q * q; } catch { v = w; } const s = ethers.formatEther(v); return s.includes('.') ? s.replace(/0+$/,'').replace(/\.$/,'') : s; };
        const fmt = (w) => { const n = parseFloat(ethers.formatEther(w)); return (n > 0 && n < 0.0001) ? '<0.0001' : fmtFull(w); };
        function readMkt(){ return new ethers.Contract(MARKET_ADDR, MKT_ABI, new ethers.JsonRpcProvider(RPC)); }
        function readProv(url){ return new ethers.JsonRpcProvider(url || RPC, 56, { batchMaxCount: 1 }); }

        async function walletSend(data, valueWei){
          if (!window.ethereum) throw new Error('no wallet in this browser — open this page inside a wallet app browser, or use the agent prompt below');
          const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
          const from = accs && accs[0]; if (!from) throw new Error('no account connected');
          const cid = await window.ethereum.request({ method: 'eth_chainId' });
          if (cid !== '0x38') { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }); }
          const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: MARKET_ADDR, data, value: '0x' + (valueWei || 0n).toString(16) }] });
          await readProv().waitForTransaction(hash);
          return hash;
        }
        async function signerMkt(){
          if (!window.ethereum) throw new Error('no wallet in this browser — open this page inside a wallet app browser, or use the agent prompt below');
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          const bp = new ethers.BrowserProvider(window.ethereum);
          const net = await bp.getNetwork();
          if (net.chainId !== 56n) {
            try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }); }
            catch { throw new Error('switch your wallet to BNB Smart Chain (56) first'); }
          }
          const signer = await bp.getSigner();
          setWalletState(await signer.getAddress());
          return new ethers.Contract(MARKET_ADDR, MKT_ABI, signer);
        }
        function setWalletState(addr){
          const el = document.getElementById('mktWalletState');
          if (addr) el.innerHTML = 'connected: <b>' + addr.slice(0, 6) + '…' + addr.slice(-4) + '</b> · BNB Smart Chain';
          document.getElementById('btnMktConnect').textContent = '[ WALLET CONNECTED ]';
        }
        let nsDisplay = [], nsShown = 0, nsLive = [], nsSupplyNow = 0, PAL = null;
        async function loadPal(){ if (PAL) return PAL; try { PAL = await (await fetch('/palette.json')).json(); } catch { PAL = {}; } return PAL; }
        function listedCard(x){
          return '<div class="mkt-card" onclick="window.__nsOpen(' + x.id + ')"><img src="/images/' + x.id + '.png" alt="NULLSECTOR #' + x.id + '">' +
            '<div class="id">NULLSECTOR #' + x.id + '</div><div class="pr">' + fmt(x.price) + ' BNB</div></div>';
        }
        function unlistedCard(id){
          return '<div class="mkt-card" onclick="window.__nsOpen(' + id + ')"><img loading="lazy" src="/images/' + id + '.png" alt="NULLSECTOR #' + id + '">' +
            '<div class="id">NULLSECTOR #' + id + '</div><div class="pr" style="color:var(--dim)">not listed</div></div>';
        }
        function renderMore(){
          const grid = document.getElementById('mGrid'), btn = document.getElementById('mMore');
          const end = Math.min(nsShown + 48, nsDisplay.length);
          let html = '';
          for (; nsShown < end; nsShown++) { const x = nsDisplay[nsShown]; html += (x.price !== null && x.price !== undefined) ? listedCard(x) : unlistedCard(x.id); }
          grid.insertAdjacentHTML('beforeend', html);
          if (nsShown >= nsDisplay.length) btn.style.display = 'none';
          else { btn.style.display = ''; btn.textContent = '[ LOAD MORE — ' + nsShown + ' / ' + nsDisplay.length + ' SHOWN ]'; }
        }
        async function buildDisplay(){
          const grid = document.getElementById('mGrid'), st = document.getElementById('mktState');
          const listedOnly = document.getElementById('mFListed').value === 'listed';
          const palWanted = document.getElementById('mFPalette').value;
          let arr = nsLive.map(x => ({ id: x.id, price: x.price }));
          const listedIds = new Set(arr.map(x => x.id));
          if (!listedOnly) { for (let id = nsSupplyNow; id >= 1; id--) if (!listedIds.has(id)) arr.push({ id, price: null }); }
          if (palWanted) { await loadPal(); arr = arr.filter(x => (PAL[x.id] || '') === palWanted); }
          nsDisplay = arr; nsShown = 0; grid.innerHTML = '';
          renderMore();
          st.textContent = listedOnly
            ? '// ' + arr.length + ' listed unit(s), cheapest first.'
            : palWanted
              ? '// palette ' + palWanted + ' — ' + arr.length + ' minted unit(s) so far, listed first.'
              : (nsLive.length
                  ? '// ' + nsLive.length + ' listed on top (cheapest first) — then every minted unit, newest first. ' + nsSupplyNow + ' minted so far.'
                  : '// nothing listed yet — every minted unit below, newest first. be the first to list. ' + nsSupplyNow + ' minted so far.');
        }
        async function loadMarket(){
          const st = document.getElementById('mktState'), grid = document.getElementById('mGrid');
          if (!MARKET_ADDR){
            st.textContent = '// market contract not deployed yet — the floor opens the moment it goes live. trading also runs on Element meanwhile.';
            document.getElementById('mAddr').textContent = 'not deployed yet';
            return;
          }
          document.getElementById('mAddr').innerHTML = '<a href="https://bscscan.com/address/' + MARKET_ADDR + '" target="_blank" rel="noopener">' + MARKET_ADDR + '</a>';
          try {
            const m = readMkt();
            const [cnt, vol, sales] = await Promise.all([m.listedCount(), m.totalVolume(), m.totalSales()]);
            document.getElementById('mListed').textContent = cnt.toString();
            document.getElementById('mVol').textContent = fmt(vol);
            document.getElementById('mSales').textContent = sales.toString();
            const [ids, sellers, prices, actives] = await m.getListings(0, 200);
            const live = []; const listedSet = new Set();
            for (let i = 0; i < ids.length; i++) if (actives[i] && prices[i] > 0n) { live.push({ id: Number(ids[i]), price: prices[i] }); listedSet.add(Number(ids[i])); }
            live.sort((a, b) => a.price < b.price ? -1 : 1);
            document.getElementById('mFloor').textContent = live.length ? fmt(live[0].price) : '—';
            try {
              const [buyers, amts] = await m.getCollectionOffers(0, 50);
              let best = 0n; for (const a of amts) if (a > best) best = a;
              document.getElementById('mCollOffer').textContent = best > 0n ? fmt(best) : '—';
            } catch {}
            let supply = 0;
            try {
              const nftR = new ethers.Contract(NFT, ["function totalSupply() view returns (uint256)"], new ethers.JsonRpcProvider(RPC));
              supply = Number(await nftR.totalSupply());
            } catch {}
            nsLive = live; nsSupplyNow = supply;
            await buildDisplay();
            document.getElementById('mUpdated').textContent = 'updated ' + new Date().toISOString().slice(11, 19) + ' UTC';
            loadAllOffers();
          } catch (e) { st.textContent = '// floor read failed — rpc busy, hit refresh.'; }
        }
        async function needWallet(){
          if (!window.ethereum){ throw new Error('no wallet in this browser — open nullsector.online inside your wallet app browser (MetaMask / Bitget / Trust), connect your wallet there, then tap buy again. Or skip the browser: hand the agent prompt below to your AI agent and it buys through the contract.'); }
          const bp = new ethers.BrowserProvider(window.ethereum);
          const accs = await bp.send('eth_requestAccounts', []);
          return accs[0];
        }
        window.__nsBuy = async (id, priceWei) => {
          await window.__nsOpen(id);
          const blk = document.getElementById('mdConfirm'), txt = document.getElementById('mdConfirmText');
          try {
            const m = readMkt();
            const lst = await m.listings(id);
            if (lst[1] === 0n) { out('that listing is gone — refresh the floor.'); const mm = document.getElementById('mdMsg'); if (mm) mm.innerHTML = 'that listing is gone — refresh the floor.'; return; }
            txt.innerHTML = 'preview — buy <b>NULLSECTOR #' + id + '</b> for <b>' + fmtFull(lst[1]) + ' BNB</b><br>seller: ' + lst[0].slice(0, 6) + '…' + lst[0].slice(-4) + ' · the 2.5% royalty comes out of the seller\'s side, not yours.<br>nothing is sent yet — press CONFIRM BUY and your wallet will ask you to sign.';
            document.getElementById('mdBuy').style.display = 'none';
            blk.style.display = '';
            blk.scrollIntoView({ block: 'nearest' });
            document.getElementById('mdConfirmBtn').onclick = () => { blk.style.display = 'none'; window.__nsBuyExec(id, lst[1].toString()); };
            document.getElementById('mdCancelBtn').onclick = () => { blk.style.display = 'none'; document.getElementById('mdBuy').style.display = ''; const mm = document.getElementById('mdMsg'); if (mm) mm.innerHTML = 'buy cancelled — nothing was sent.'; };
          } catch { out('preview failed — could not re-read the listing just now. try again.'); }
        };
        window.__nsBuyExec = async (id, priceWei) => {
          const both = (t) => { out(t); const mm = document.getElementById('mdMsg'); if (mm) mm.innerHTML = t; };
          try {
            await needWallet();
            const m = await signerMkt();
            both('sending buy tx for #' + id + ' …');
            const tx = await m.buy(id, { value: BigInt(priceWei) });
            await tx.wait();
            both('bought #' + id + ' — tx ' + tx.hash);
            loadMarket();
          } catch (e) { both('buy failed: ' + (e.shortMessage || e.message)); }
        };
        window.__nsOpen = async (id) => {
          const modal = document.getElementById('mDetail');
          document.getElementById('mdImg').src = '/images/' + id + '.png';
          document.getElementById('mdTitle').textContent = 'NULLSECTOR #' + id;
          const st = document.getElementById('mdStatus'), ow = document.getElementById('mdOwner'), tr = document.getElementById('mdTraits');
          const buyBtn = document.getElementById('mdBuy');
          st.textContent = 'loading…'; ow.textContent = ''; tr.textContent = ''; document.getElementById('mdMsg').innerHTML = '';
          buyBtn.style.display = 'none';
          document.getElementById('mdConfirm').style.display = 'none';
          document.getElementById('mdSell').style.display = 'none';
          modal.style.display = 'flex';
          fetch('/metadata/' + id + '.json').then(r => r.json()).then(mdata => {
            tr.textContent = (mdata.attributes || []).map(x => x.trait_type.toLowerCase() + '=' + String(x.value).toLowerCase()).join(' · ');
          }).catch(() => {});
          try {
            const m = readMkt();
            const nftR = new ethers.Contract(NFT, NFT_ABI, readProv());
            const [lst, owner] = await Promise.all([m.listings(id), nftR.ownerOf(id)]);
            ow.textContent = 'owner: ' + owner.slice(0, 6) + '…' + owner.slice(-4);
            if (lst[1] > 0n) {
              st.textContent = fmtFull(lst[1]) + ' BNB — listed by ' + lst[0].slice(0, 6) + '…' + lst[0].slice(-4);
              buyBtn.style.display = '';
              buyBtn.onclick = () => window.__nsBuy(id, lst[1].toString());
            } else st.textContent = 'not listed — make an offer below or via a collection offer';
            let me = null;
            if (window.ethereum) { try { const a = await window.ethereum.request({ method: 'eth_accounts' }); if (a && a.length) me = a[0].toLowerCase(); } catch {} }
            const sellBox = document.getElementById('mdSell');
            if (me && owner.toLowerCase() === me) {
              sellBox.style.display = '';
              const isListed = lst[1] > 0n;
              document.getElementById('mdListRow').style.display = isListed ? 'none' : '';
              const cb = document.getElementById('mdCancelListing');
              cb.style.display = isListed ? '' : 'none';
              cb.onclick = () => window.__nsCancelListing(id);
              document.getElementById('mdListBtn').onclick = () => window.__nsDoList(id);
              const bidRow = document.getElementById('mdBidRow');
              bidRow.innerHTML = '';
              try {
                const [buyers, amts] = await m.getCollectionOffers(0, 50);
                let bi = -1, best = 0n;
                for (let i = 0; i < amts.length; i++) if (amts[i] > best && buyers[i].toLowerCase() !== me) { best = amts[i]; bi = i; }
                if (bi >= 0) bidRow.innerHTML = '<span class="u">best collection bid: <b>' + fmt(best) + ' BNB</b> by ' + buyers[bi].slice(0, 6) + '…' + buyers[bi].slice(-4) + '</span> <button type="button" onclick="window.__nsAcceptBestBid(' + id + ',\'' + buyers[bi] + '\',\'' + best.toString() + '\')">[ ACCEPT BID ]</button>';
              } catch {}
            } else sellBox.style.display = 'none';
          } catch { st.textContent = 'status read failed — tap to retry'; st.onclick = () => window.__nsOpen(id); }
          window.__nsLoadOffers(id);
        };
        window.__nsLoadOffers = async (id) => {
          const box = document.getElementById('mdOffers'), mine = document.getElementById('mdMyOffer');
          box.innerHTML = ''; mine.innerHTML = '';
          try {
            const m = readMkt();
            const [bidders, amounts] = await m.getTokenOffers(id);
            let me = null;
            if (window.ethereum) { try { const a = await window.ethereum.request({ method: 'eth_accounts' }); if (a && a.length) me = a[0].toLowerCase(); } catch {} }
            let owner = null;
            try { const nftR = new ethers.Contract(NFT, NFT_ABI, new ethers.JsonRpcProvider(RPC)); owner = (await nftR.ownerOf(id)).toLowerCase(); } catch {}
            const rows = bidders.map((b, i) => ({ b, a: amounts[i] })).filter(r => r.a > 0n).sort((x, y) => x.a < y.a ? 1 : -1);
            let collRows = [];
            try { const [cbs, cas] = await m.getCollectionOffers(0, 50); collRows = cbs.map((b, i) => ({ b, a: cas[i] })).filter(r => r.a > 0n).sort((x, y) => x.a < y.a ? 1 : -1); } catch {}
            let html = '';
            if (rows.length) html += '<div class="u" style="margin-bottom:4px">// offers on this unit</div>' + rows.map(r =>
              '<div class="mkt-row" style="justify-content:space-between;margin-top:4px"><span>' + fmt(r.a) + ' BNB — ' + r.b.slice(0, 6) + '…' + r.b.slice(-4) + '</span>' +
              ((me && owner === me && r.b.toLowerCase() !== me) ? '<button type="button" onclick="window.__nsAcceptOffer(' + id + ',\'' + r.b + '\',\'' + r.a.toString() + '\')">[ ACCEPT ]</button>' : '') + '</div>').join('');
            if (collRows.length) html += '<div class="u" style="margin:' + (rows.length ? '10px' : '0') + ' 0 4px">// collection offers</div>' + collRows.map(r =>
              '<div class="mkt-row" style="justify-content:space-between;margin-top:4px"><span>' + fmt(r.a) + ' BNB — ' + r.b.slice(0, 6) + '…' + r.b.slice(-4) + '</span>' +
              ((me && owner === me && r.b.toLowerCase() !== me) ? '<button type="button" onclick="window.__nsAcceptBestBid(' + id + ',\'' + r.b + '\',\'' + r.a.toString() + '\')">[ ACCEPT ]</button>' : '') + '</div>').join('');
            box.innerHTML = html || '<span class="u">// no offers on this unit yet — be the first below</span>';
            if (me) {
              const my = await m.tokenOffer(id, me);
              if (my > 0n) mine.innerHTML = '<span class="u">your offer on this unit: <b>' + fmt(my) + ' BNB</b></span> <button type="button" onclick="window.__nsCancelOffer(' + id + ')">[ CANCEL OFFER ]</button>';
            }
          } catch { box.innerHTML = '<span class="u">// offers read failed</span>'; }
        };
        window.__nsAcceptOffer = async (id, bidder, amountWei) => {
          const mm = document.getElementById('mdMsg');
          try {
            const me = await needWallet();
            const m = await signerMkt();
            const bp = new ethers.BrowserProvider(window.ethereum);
            const nftW = new ethers.Contract(NFT, NFT_ABI, await bp.getSigner());
            if (!(await nftW.isApprovedForAll(me, MARKET_ADDR))) { mm.innerHTML = 'one approval first so the market can move this unit…'; const atx = await nftW.setApprovalForAll(MARKET_ADDR, true); await atx.wait(); }
            mm.innerHTML = 'accepting the offer…';
            const tx = await m.acceptOffer(id, bidder, BigInt(amountWei));
            await tx.wait();
            mm.innerHTML = 'offer accepted — #' + id + ' sold. tx ' + tx.hash;
            out('accepted offer on #' + id + ' — tx ' + tx.hash);
            loadMarket(); window.__nsOpen(id);
          } catch (e) { mm.innerHTML = 'accept failed: ' + (e.shortMessage || e.message); }
        };
        window.__nsCancelOffer = async (id) => {
          const mm = document.getElementById('mdMsg');
          try {
            mm.innerHTML = 'cancelling your offer…';
            const hash = await walletSend(new ethers.Interface(MKT_ABI).encodeFunctionData('cancelOffer', [id]), 0n);
            mm.innerHTML = 'offer cancelled — the BNB is back in your wallet. tx ' + hash;
            out('offer on #' + id + ' cancelled');
            window.__nsLoadOffers(id);
          } catch (e) { mm.innerHTML = 'cancel failed: ' + (e.shortMessage || e.message); }
        };
        document.getElementById('mdClose').onclick = () => { document.getElementById('mDetail').style.display = 'none'; };
        window.__nsDoList = async (id) => {
          const mm = document.getElementById('mdMsg');
          const raw = document.getElementById('mdListPrice').value.trim();
          let price; try { price = ethers.parseEther(raw); } catch { mm.innerHTML = 'type a price in BNB first.'; return; }
          if (price <= 0n) { mm.innerHTML = 'price must be above 0.'; return; }
          try {
            const me = await needWallet();
            const bp = new ethers.BrowserProvider(window.ethereum);
            const nftW = new ethers.Contract(NFT, NFT_ABI, await bp.getSigner());
            if ((await nftW.ownerOf(id)).toLowerCase() !== me.toLowerCase()) { mm.innerHTML = 'this unit is not in the connected wallet.'; return; }
            if (!(await nftW.isApprovedForAll(me, MARKET_ADDR))) { mm.innerHTML = 'step 1/2 — approving the market to move this unit when it sells…'; const atx = await nftW.setApprovalForAll(MARKET_ADDR, true); await atx.wait(); }
            mm.innerHTML = 'step 2/2 — listing #' + id + ' …';
            const m = await signerMkt();
            const tx = await m.list(id, price); await tx.wait();
            mm.innerHTML = 'listed #' + id + ' at ' + fmt(price) + ' BNB — tx ' + tx.hash;
            out('listed #' + id + ' at ' + fmt(price) + ' BNB');
            loadMarket(); window.__nsOpen(id);
          } catch (e) { mm.innerHTML = 'list failed: ' + (e.shortMessage || e.message); }
        };
        window.__nsAcceptBestBid = async (id, buyer, amountWei) => {
          const mm = document.getElementById('mdMsg');
          try {
            const me = await needWallet();
            const bp = new ethers.BrowserProvider(window.ethereum);
            const nftW = new ethers.Contract(NFT, NFT_ABI, await bp.getSigner());
            if (!(await nftW.isApprovedForAll(me, MARKET_ADDR))) { mm.innerHTML = 'one approval first so the market can move this unit…'; const atx = await nftW.setApprovalForAll(MARKET_ADDR, true); await atx.wait(); }
            mm.innerHTML = 'accepting the bid…';
            const m = await signerMkt();
            const tx = await m.acceptCollectionOffer(id, buyer, BigInt(amountWei)); await tx.wait();
            mm.innerHTML = 'bid accepted — #' + id + ' sold. tx ' + tx.hash;
            out('sold #' + id + ' into a collection bid — tx ' + tx.hash);
            loadMarket(); window.__nsOpen(id);
          } catch (e) { mm.innerHTML = 'accept failed: ' + (e.shortMessage || e.message); }
        };
        document.getElementById('mdOfferBtn').onclick = async () => {
          const mm = document.getElementById('mdMsg');
          const id = Number(document.getElementById('mdTitle').textContent.replace(/[^0-9]/g, ''));
          const raw = document.getElementById('mdOfferAmt').value.trim();
          let val; try { val = ethers.parseEther(raw); } catch { mm.innerHTML = 'type an amount in BNB first — e.g. 0.001'; return; }
          if (val <= 0n) { mm.innerHTML = 'amount must be above 0'; return; }
          try {
            const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
            const me = accs && accs[0];
            if (me) { const cur = await readMkt().offers(id, me); if (cur > 0n) { mm.innerHTML = 'you already have an offer of ' + fmt(cur) + ' BNB on this unit — a new offer would ADD to it. cancel your offer first if you want to change the amount.'; return; } }
            mm.innerHTML = 'sending your offer — ' + fmt(val) + ' BNB will be held in the market contract until the owner accepts or you cancel.';
            const hash = await walletSend(new ethers.Interface(MKT_ABI).encodeFunctionData('makeOffer', [id]), val);
            mm.innerHTML = 'offer placed on #' + id + ' — tx ' + hash;
            out('offer placed on #' + id + ' @ ' + fmt(val) + ' BNB');
            window.__nsLoadOffers(id);
          } catch (e) { mm.innerHTML = 'offer failed: ' + (e.shortMessage || e.message); }
        };
        document.getElementById('mDetail').addEventListener('click', (e) => { if (e.target.id === 'mDetail') e.target.style.display = 'none'; });
        document.getElementById('mReload').onclick = loadMarket;
        (function initWallet(){
          const hint = document.getElementById('mktWalletHint');
          if (!window.ethereum) {
            hint.innerHTML = 'no wallet in this browser — on a phone, open this page inside your wallet app\'s browser (MetaMask / Bitget / Trust) to buy, list and offer.';
            return;
          }
          window.ethereum.request({ method: 'eth_accounts' }).then((a) => { if (a && a.length) setWalletState(a[0]); }).catch(() => {});
          if (window.ethereum.on) window.ethereum.on('accountsChanged', (a) => { if (a && a.length) setWalletState(a[0]); else location.reload(); });
        })();
        document.getElementById('btnMktConnect').onclick = async () => {
          try { await signerMkt(); }
          catch (e) { document.getElementById('mktWalletState').textContent = e.message || 'connect failed'; }
        };
        document.getElementById('mMore').onclick = renderMore;
        document.getElementById('btn-copy-mkt').onclick = async () => {
          const t = document.getElementById('mkt-prompt');
          try { await navigator.clipboard.writeText(t.value); document.getElementById('copy-mkt-status').textContent = 'copied'; }
          catch { t.select(); document.execCommand('copy'); document.getElementById('copy-mkt-status').textContent = 'copied'; }
        };
        const goSearch = () => {
          const v = parseInt(document.getElementById('mSearch').value, 10);
          if (!v || v < 1 || v > 4321) return out('type a token number between 1 and 4321.');
          if (nsSupplyNow && v > nsSupplyNow) return out('#' + v + ' is not minted yet — supply is ' + nsSupplyNow + '.');
          window.__nsOpen(v);
        };
        document.getElementById('mSearchGo').onclick = goSearch;
        document.getElementById('mSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') goSearch(); });
        document.getElementById('mFListed').onchange = buildDisplay;
        document.getElementById('mFPalette').onchange = buildDisplay;
        window.__nsCancelListing = async (id) => {
          try {
            const m = await signerMkt();
            out('cancelling listing #' + id + ' …');
            const tx = await m.cancel(id);
            await tx.wait();
            out('listing #' + id + ' cancelled — tx ' + tx.hash);
            loadMarket(); nsLoadMine();
            if (document.getElementById('mDetail').style.display === 'flex') window.__nsOpen(id);
          } catch (e) { out('cancel failed: ' + (e.shortMessage || e.message)); }
        };
        window.__nsQuickList = (id) => { window.__nsOpen(id); };
        const SCAN_RPCS = ['https://rpc-bsc.48.club', 'https://bsc-dataseed1.binance.org', 'https://bsc-mainnet.public.blastapi.io'];
        async function scanLogs(mk, from, to){
          for (const url of SCAN_RPCS) {
            try { const [c, f] = mk(new ethers.JsonRpcProvider(url)); return await c.queryFilter(f, from, to); } catch {}
          }
          return null;
        }
        async function nsRenderMine(addr, mine){
          const st = document.getElementById('mMyState'), grid = document.getElementById('mMyGrid');
          mine.sort((a, b) => b - a);
          let connected = null;
          if (window.ethereum) { try { const a = await window.ethereum.request({ method: 'eth_accounts' }); if (a && a.length) connected = a[0].toLowerCase(); } catch {} }
          const canManage = connected === addr.toLowerCase();
          const m = readMkt();
          let html = '';
          for (const id of mine) {
            const lst = await m.listings(id);
            const listed = lst[1] > 0n;
            html += '<div class="mkt-card" onclick="window.__nsOpen(' + id + ')"><img loading="lazy" src="/images/' + id + '.png" alt="NULLSECTOR #' + id + '"><div class="id">NULLSECTOR #' + id + '</div>' +
              (listed
                ? '<div class="pr">' + fmt(lst[1]) + ' BNB — listed</div>' + (canManage ? '<button type="button" onclick="event.stopPropagation();window.__nsCancelListing(' + id + ')">cancel listing</button>' : '')
                : '<div class="pr" style="color:var(--dim)">not listed</div>' + (canManage ? '<button type="button" onclick="event.stopPropagation();window.__nsQuickList(' + id + ')">list it</button>' : '')) +
              '</div>';
          }
          grid.innerHTML = html;
          st.textContent = mine.length
            ? '// ' + mine.length + ' unit(s) owned by ' + addr.slice(0, 6) + '…' + addr.slice(-4) + (canManage ? '.' : ' — connect this wallet to manage them.')
            : '// no NULLSECTOR units found for ' + addr.slice(0, 6) + '…' + addr.slice(-4) + '.';
        }
        async function nsLoadMine(){
          const st = document.getElementById('mMyState'), grid = document.getElementById('mMyGrid');
          let addr = document.getElementById('mMyAddr').value.trim();
          if (!addr && window.ethereum) { try { const a = await window.ethereum.request({ method: 'eth_accounts' }); if (a && a.length) addr = a[0]; } catch {} }
          if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) { st.textContent = '// paste your wallet address above, or connect a wallet first.'; return; }
          grid.innerHTML = '';
          try {
            const nftR = new ethers.Contract(NFT, NFT_ABI, readProv());
            const bal = Number(await nftR.balanceOf(addr));
            if (bal === 0) { st.textContent = '// no NULLSECTOR units found for ' + addr.slice(0, 6) + '…' + addr.slice(-4) + '.'; return; }
            st.textContent = '// scanning history for ' + bal + ' unit(s) of ' + addr.slice(0, 6) + '…' + addr.slice(-4) + '…';
            const EV = ["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"];
            const mkIn = (prov) => { const c = new ethers.Contract(NFT, EV, prov); return [c, c.filters.Transfer(null, addr)]; };
            const mkOut = (prov) => { const c = new ethers.Contract(NFT, EV, prov); return [c, c.filters.Transfer(addr, null)]; };
            const seen = new Set(), cand = new Set();
            const bn = await readProv().getBlockNumber();
            for (let top = bn; top >= 130811113; top -= 5000) {
              const from = Math.max(130811113, top - 4999);
              const lin = await scanLogs(mkIn, from, top);
              const lout = await scanLogs(mkOut, from, top);
              if (!lin || !lout) { st.textContent = '// scan failed midway — the public RPCs are busy. try again in a moment.'; return; }
              const evs = [...lin.map(l => ({ l, isIn: 1 })), ...lout.map(l => ({ l, isIn: 0 }))].sort((a, b) => (b.l.blockNumber - a.l.blockNumber) || (b.l.index - a.l.index));
              for (const x of evs) { const tid = Number(x.l.args.tokenId); if (seen.has(tid)) continue; seen.add(tid); if (x.isIn) cand.add(tid); }
              const mineNow = [];
              for (const id of cand) { try { if ((await nftR.ownerOf(id)).toLowerCase() === addr.toLowerCase()) mineNow.push(id); } catch {} }
              st.textContent = '// scanning… back to block ' + from.toLocaleString('en-US') + ' · found ' + mineNow.length + ' / ' + bal;
              if (mineNow.length >= bal) { nsRenderMine(addr, mineNow); return; }
              if (from === 130811113) { nsRenderMine(addr, mineNow); return; }
            }
          } catch { st.textContent = '// scan failed — rpc busy, try again.'; }
        }
        document.getElementById('mMyBtn').onclick = nsLoadMine;
        async function loadAllOffers(){
          const st = document.getElementById('mOffersState'), list = document.getElementById('mOffersList'), coll = document.getElementById('mCollList');
          st.textContent = '// loading offers…';
          let bidCount = 0;
          try {
            const [buyers, amts] = await readMkt().getCollectionOffers(0, 50);
            const crows = buyers.map((b, i) => ({ b, a: amts[i] })).filter(x => x.a > 0n).sort((x, y) => x.a < y.a ? 1 : -1);
            bidCount = crows.length;
            coll.innerHTML = crows.length
              ? crows.map(r => '<div class="mkt-row" style="justify-content:space-between;margin-top:4px"><span>' + fmt(r.a) + ' BNB — any unit</span><span class="u">by ' + r.b.slice(0, 6) + '…' + r.b.slice(-4) + '</span></div>').join('')
              : '<span class="u">// no collection bids right now</span>';
            const mine = document.getElementById('mMyBid');
            mine.innerHTML = '';
            if (window.ethereum) { try { const a = await window.ethereum.request({ method: 'eth_accounts' }); if (a && a.length) { const my = await readMkt().collectionOffer(a[0]); if (my > 0n) mine.innerHTML = '<span class="u">your collection bid: <b>' + fmt(my) + ' BNB</b></span> <button type="button" onclick="window.__nsCancelBid()">[ CANCEL BID ]</button>'; } } catch {} }
          } catch { coll.innerHTML = '<span class="u">// collection bids read failed — hit refresh offers.</span>'; }
          try {
            const evAbi = ["event OfferMade(uint256 indexed id, address indexed bidder, uint256 amount)", "event OfferCancelled(uint256 indexed id, address indexed bidder, uint256 amount)", "event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 royalty)"];
            const prov = new ethers.JsonRpcProvider(RPC);
            const mc = new ethers.Contract(MARKET_ADDR, evAbi, prov);
            const bn = await prov.getBlockNumber();
            const state = new Map();
            let evs = [];
            for (let f = 131140000; f <= bn; f += 50000) {
              const t = Math.min(f + 49999, bn);
              const parts = await Promise.all([mc.queryFilter(mc.filters.OfferMade(), f, t), mc.queryFilter(mc.filters.OfferCancelled(), f, t), mc.queryFilter(mc.filters.Sold(), f, t)]);
              for (const arr of parts) for (const e of arr) evs.push(e);
            }
            evs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));
            for (const e of evs) {
              const a = e.args, id = a.id.toString();
              if (id === '0') { /* collection bids ride OfferMade/OfferCancelled with tokenId 0 — they are listed above from getCollectionOffers() */ }
              else if (e.eventName === 'OfferMade') state.set(id + '|' + a.bidder.toLowerCase(), { id: Number(id), bidder: a.bidder, amount: a.amount });
              else if (e.eventName === 'OfferCancelled') state.delete(id + '|' + a.bidder.toLowerCase());
              else if (e.eventName === 'Sold') state.delete(id + '|' + a.buyer.toLowerCase());
            }
            const rows = [...state.values()].sort((x, y) => x.amount < y.amount ? 1 : -1);
            list.innerHTML = rows.length
              ? rows.map(r => '<div class="mkt-row" style="justify-content:space-between;margin-top:4px"><span><a href="#" onclick="window.__nsOpen(' + r.id + ');return false;">NULLSECTOR #' + r.id + '</a> — ' + fmt(r.amount) + ' BNB</span><span class="u">by ' + r.bidder.slice(0, 6) + '…' + r.bidder.slice(-4) + '</span></div>').join('')
              : '<span class="u">// no open token offers right now</span>';
            st.textContent = '// ' + rows.length + ' open token offer(s) · ' + bidCount + ' collection bid(s) — updated ' + new Date().toISOString().slice(11, 19) + ' UTC';
          } catch { list.innerHTML = '<span class="u">// token-offer history could not be read — the collection bids above are live from the contract. hit refresh offers to retry.</span>'; st.textContent = '// collection bids loaded · token offers unread — hit refresh offers.'; }
        }
        document.getElementById('mOffersRefresh').onclick = loadAllOffers;
        window.__nsCancelBid = async () => {
          try { out('cancelling your collection bid…'); const data = new ethers.Interface(MKT_ABI).encodeFunctionData('cancelCollectionOffer', []); const hash = await walletSend(data, 0n); out('collection bid cancelled — BNB back in your wallet. tx ' + hash); loadAllOffers(); loadMarket(); }
          catch (e) { out('cancel failed: ' + (e.shortMessage || e.message)); }
        };
        document.getElementById('mBidBtn').onclick = async () => {
          const raw = document.getElementById('mBidAmt').value.trim();
          let amt; try { amt = ethers.parseEther(raw); } catch { return out('type an amount in BNB first.'); }
          if (amt <= 0n) return out('amount must be above 0.');
          try { const accs = await window.ethereum.request({ method: 'eth_requestAccounts' }); const me = accs && accs[0]; if (me) { const cur = await readMkt().collectionOffer(me); if (cur > 0n) { out('you already have a collection bid of ' + fmt(cur) + ' BNB — placing again would ADD to it. cancel it first with [ CANCEL BID ] if you want to change the amount.'); return; } } out('placing collection offer…'); const data = new ethers.Interface(MKT_ABI).encodeFunctionData('makeCollectionOffer', []); const hash = await walletSend(data, amt); out('collection offer placed: ' + fmt(amt) + ' BNB — tx ' + hash); loadAllOffers(); loadMarket(); }
          catch (e) { out('offer failed: ' + (e.shortMessage || e.message)); }
        };
        document.querySelector('[data-scr="market"]').addEventListener('click', loadMarket);
        loadMarket();
      })();
      </script>