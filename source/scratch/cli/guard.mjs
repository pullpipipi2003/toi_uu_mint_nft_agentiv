// The spend guard kart runs before every transaction. The server builds the calldata, but nothing it says is trusted:
// a transaction must go to the AgentCards contract baked into this skill (release.json), call exactly the function the
// command means with exactly its arguments and nothing more (the calldata is decoded the way the contract reads it,
// and anything after the arguments, a gap, or a value out of range is refused), and carry exactly the price the chain
// itself reports. Which card it acts on comes from the command (--card) or the chain (the card this Agent ID minted),
// never from the server; a mint must be for this wallet, this Agent ID and the role and realm the human picked, since
// the server holds the key that signs mints; and a preview describes the transaction from its own calldata, never
// with the server's words. baw's simulation then has to show that payment and nothing else leaving the wallet. A
// season pool claim must go to the RewardPool contract baked in next to it, and its proof must lead to the root that
// contract holds for exactly this wallet and amount. No dependencies (Node 20+), so the selectors and argument
// layouts are fixed here and a unit test checks them against the contract ABIs.

export const SELECTORS = {
  buy: "0xd96a094a", // buy(uint256)
  buyMythic: "0xcd44232d", // buyMythic(uint256)
  buyFights: "0x3f759f13", // buyFights(uint256,uint16)
  buyPass: "0x3420f9b3", // buyPass(uint256)
  list: "0x50fd7367", // list(uint256,uint256)
  mint: "0x9c0527d6", // mint(Stats,bytes)
  update: "0xf94ac82f", // update(Update,bytes)
  claimMythic: "0xf2199b82", // claimMythic(MythicClaim,bytes)
  claim: "0xae0b51df", // RewardPool.claim(uint256,uint256,bytes32[])
};
export const READS = {
  priceOf: "0xb9186d7d", // priceOf(uint256)
  fightPackPrice: "0x639fc437", // fightPackPrice()
  passPrice: "0xca3286f5", // passPrice()
  mythics: "0xa5a01727", // mythics(uint256): price is the 14th return word
  claimUsed: "0x225ce525", // claimUsed(uint256)
  cardOfAgentId: "0x2d3f7b8f", // cardOfAgentId(uint256): the card an Agent ID minted, 0 for none
  ownerOf: "0x6352211e", // ownerOf(uint256)
  seasons: "0xf5d709a1", // RewardPool.seasons(uint256): root, funded, claimed, claimEnds, swept
  claimed: "0x120aa877", // RewardPool.claimed(uint256,address)
};
const ON_POOL = new Set(["claim"]); // functions of RewardPool; every other one is AgentCards'
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True for an API on this machine (a dev server), where plain http is fine. */
export function isLocalApi(api) {
  try {
    return LOCAL_HOSTS.has(new URL(api).hostname);
  } catch {
    return false;
  }
}

/** Why kart refuses to talk to `api`, or null: anything but https, except a server on this machine. */
export function apiProblem(api) {
  let u;
  try {
    u = new URL(api);
  } catch {
    return `not a URL: ${api}`;
  }
  if (u.protocol === "https:" || (u.protocol === "http:" && isLocalApi(api))) return null;
  return `refusing ${api}: the Agent Cards API must be https (plain http only for a server on this machine)`;
}

/** "0.05" -> 50000000000000000n; null when it isn't a plain BNB amount (up to 18 decimals). */
export function parseBnb(text) {
  const m = /^(\d{1,12})(?:\.(\d{1,18}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] || "").padEnd(18, "0"));
}

/** 50000000000000000n -> "0.05" */
export function formatBnb(wei) {
  const w = BigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const ROLE_NAMES = ["", "warrior", "priest", "mage", "assassin"]; // index = the on-chain role number
export const REGION_NAMES = ["west", "east", "north", "south"]; // index = the on-chain region number

/** "warrior" / "Warrior" / "1" -> 1, the way the server reads --role; null when it isn't a mintable role. */
export function roleNumber(input) {
  const v = String(input ?? "").trim().toLowerCase();
  const i = ROLE_NAMES.indexOf(v);
  return i > 0 ? i : /^[1-4]$/.test(v) ? Number(v) : null;
}

/** "west" / "West" / "0" -> 0, the way the server reads --region; null when it isn't a realm. */
export function regionNumber(input) {
  const v = String(input ?? "").trim().toLowerCase();
  const i = REGION_NAMES.indexOf(v);
  return i >= 0 ? i : /^[0-3]$/.test(v) ? Number(v) : null;
}

const roleName = (n) => ROLE_NAMES[Number(n)] || `role ${n}`;
const regionName = (n) => REGION_NAMES[Number(n)] || `region ${n}`;
// an Agent ID label as the contract allows it (a-z, 0-9, _ and -, up to 29): anything else in one the server sent
// shows as "?", so a hostile label can't smuggle text into kart's output
const labelText = (label) => String(label ?? "").replace(/[^a-z0-9_-]/g, "?").slice(0, 29) || "?";

// ---- reading calldata exactly the way the contract does

/**
 * The arguments of every function kart sends, as the ABI lays them out: static words, bytes and string, bytes32[]
 * and tuples of those (an object, its fields in order). A unit test checks them against the contract ABIs.
 */
export const ARGS = {
  buy: ["uint256"],
  buyMythic: ["uint256"],
  buyFights: ["uint256", "uint16"],
  buyPass: ["uint256"],
  list: ["uint256", "uint256"],
  mint: [
    {
      wallet: "address", label: "string", power: "uint8", defense: "uint8", speed: "uint8", luck: "uint8", role: "uint8", region: "uint8",
      badges: "uint32", roll: "uint32", issuedAt: "uint64", expiry: "uint64",
    },
    "bytes",
  ],
  update: [{ id: "uint256", level: "uint16", badges: "uint32", issuedAt: "uint64", expiry: "uint64" }, "bytes"],
  claimMythic: [{ to: "address", design: "uint256", nonce: "uint256", expiry: "uint64" }, "bytes"],
  claim: ["uint256", "uint256", "bytes32[]"],
};
const BITS = { address: 160n, uint8: 8n, uint16: 16n, uint32: 32n, uint64: 64n, uint256: 256n };
const isDynamic = (t) => t === "bytes" || t === "string" || t === "bytes32[]" || (typeof t === "object" && Object.values(t).some(isDynamic));
const headSize = (t) => (typeof t === "object" && !isDynamic(t) ? Object.values(t).reduce((n, m) => n + headSize(m), 0) : 32);
const utf8 = (hex) => new TextDecoder().decode(Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16)));

// why calldata doesn't fit its function's arguments, worded to follow "<function> with"
class Malformed extends Error {}
const SHORT = "its arguments missing or cut short";
const LAYOUT = "its arguments not laid out the way the contract reads them";
const RANGE = "a value that doesn't fit its type";

/**
 * Reads `types` from `hex` (the bytes after the selector) at byte `base`, the frame their offsets count from, exactly
 * as abi.encode writes them: the heads in order, then the tails in the same order with nothing between them. Returns
 * [values, end]; throws Malformed for anything else, so the only calldata that passes is the one honest encoding.
 */
function readFrame(types, hex, base) {
  const size = hex.length / 2;
  const wordAt = (at) => {
    if (at + 32 > size) throw new Malformed(SHORT);
    return BigInt(`0x${hex.slice(at * 2, at * 2 + 64)}`);
  };
  const list = Array.isArray(types) ? types : Object.values(types);
  let head = base;
  let tail = base + list.reduce((n, t) => n + headSize(t), 0);
  const values = list.map((t) => {
    if (typeof t === "object" && !isDynamic(t)) { // a static tuple sits inline in the head
      const [v, end] = readFrame(t, hex, head);
      head = end;
      return v;
    }
    const w = wordAt(head);
    head += 32;
    if (!isDynamic(t)) {
      if (w >= 1n << BITS[t]) throw new Malformed(RANGE);
      return w;
    }
    if (w !== BigInt(tail - base)) throw new Malformed(LAYOUT); // the tail must start right where the last one ended
    if (typeof t === "object") {
      const [v, end] = readFrame(t, hex, tail);
      tail = end;
      return v;
    }
    const len = wordAt(tail);
    if (len > BigInt(size)) throw new Malformed(SHORT);
    const n = Number(len);
    const span = t === "bytes32[]" ? 32 * n : 32 * Math.ceil(n / 32);
    if (tail + 32 + span > size) throw new Malformed(SHORT);
    const body = hex.slice((tail + 32) * 2, (tail + 32 + span) * 2);
    tail += 32 + span;
    if (t === "bytes32[]") return Array.from({ length: n }, (_, i) => BigInt(`0x${body.slice(i * 64, i * 64 + 64)}`));
    if (!/^0*$/.test(body.slice(2 * n))) throw new Malformed(LAYOUT); // the padding must be zeros
    return t === "bytes" ? `0x${body.slice(0, 2 * n)}` : utf8(body.slice(0, 2 * n));
  });
  return [Array.isArray(types) ? values : Object.fromEntries(Object.keys(types).map((k, i) => [k, values[i]])), tail];
}

/**
 * Calldata split into its known function name (or null), its 32-byte words after the selector and, for a known
 * function whose calldata is exactly its arguments (nothing after them, no gaps, every value in range), those
 * arguments decoded in order as `args` (tuples as objects, numbers as BigInt, bytes as 0x hex). Otherwise `args` is
 * null and `malformed` says why. Null when it isn't hex words behind a selector at all.
 */
export function decodeCall(calldata) {
  const data = String(calldata ?? "").toLowerCase();
  if (!/^0x[0-9a-f]*$/.test(data) || data.length < 10 || (data.length - 10) % 64 !== 0) return null;
  const sel = data.slice(0, 10);
  const body = data.slice(10);
  const words = Array.from({ length: body.length / 64 }, (_, i) => BigInt(`0x${body.slice(i * 64, i * 64 + 64)}`));
  const fn = Object.keys(SELECTORS).find((k) => SELECTORS[k] === sel) || null;
  if (!fn) return { fn, words, args: null };
  try {
    const [args, end] = readFrame(ARGS[fn], body, 0);
    const extra = body.length / 2 - end;
    if (extra) return { fn, words, args: null, malformed: `${extra} bytes of extra data after its arguments` };
    return { fn, words, args };
  } catch (e) {
    if (!(e instanceof Malformed)) throw e;
    return { fn, words, args: null, malformed: e.message };
  }
}

const addr = (w) => `0x${w.toString(16).padStart(40, "0")}`;
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * What is wrong with a transaction the server built, against what this command means to do.
 * `expect`: { fn, value (wei), and per function: id, design, packs, price; for mint: label (this Agent ID), role and,
 * when the human named one, region; for claim: season, amount and the root the pool holds on chain }.
 * `ctx`: { cards, pool, wallet }.
 */
export function checkCall(tx, expect, ctx) {
  const bad = [];
  const [target, name] = ON_POOL.has(expect.fn) ? [ctx.pool, "RewardPool"] : [ctx.cards, "Agent Cards"];
  if (!target) return [`this kart has no ${name} contract address (release.json): reinstall the skill`];
  if (!same(tx?.to, target)) bad.push(`it goes to ${tx?.to}, not the ${name} contract ${target}`);
  const call = decodeCall(tx?.calldata);
  if (!call) return [...bad, "the calldata is malformed"];
  if (call.fn !== expect.fn) return [...bad, `it calls ${call.fn || "an unknown function"}, not ${expect.fn}`];
  // exactly the function's arguments: anything after them is calldata the contract ignores but the wallet pays gas
  // for, and a layout the contract would read differently from kart is refused outright
  if (!call.args) return [...bad, `its calldata isn't exactly ${expect.fn}'s arguments (${call.malformed})`];
  const w = call.words;
  const arg = (i) => call.args[i];
  const want = (what, got, exp) => {
    if (exp === undefined || BigInt(got) !== BigInt(exp)) bad.push(`its ${what} is ${got}, not ${exp}`);
  };
  const signed = (sig) => {
    if (sig.length !== 2 + 2 * 65) bad.push("its signature isn't 65 bytes"); // all the contract's recover accepts
  };
  switch (expect.fn) {
    case "buy":
    case "buyPass":
      want("card", arg(0), expect.id);
      break;
    case "buyMythic":
      want("design", arg(0), expect.design);
      break;
    case "buyFights":
      want("card", arg(0), expect.id);
      want("pack count", arg(1), expect.packs);
      break;
    case "list":
      want("card", arg(0), expect.id);
      want("price", arg(1), expect.price);
      break;
    case "update":
      want("card", arg(0).id, expect.id);
      signed(arg(1));
      break;
    case "claimMythic":
      if (!same(addr(arg(0).to), ctx.wallet)) bad.push("the voucher doesn't name this wallet");
      signed(arg(1));
      break;
    case "mint": {
      // the server holds the key that signs mints, so a hostile one can sign any Stats it likes: the card must be for
      // this wallet and this Agent ID, with the role and the realm the human picked (the stats themselves can't be
      // checked, so the preview shows them from this calldata, never from the server's summary)
      const s = arg(0);
      if (!same(addr(s.wallet), ctx.wallet)) bad.push("the mint is for another wallet");
      if (s.label !== expect.label) bad.push(`it names the Agent ID ${labelText(s.label)}, not ${expect.label}`);
      if (expect.role === undefined || s.role !== BigInt(expect.role)) bad.push(`its role is ${roleName(s.role)}, not ${roleName(expect.role)}`);
      if (expect.region !== undefined && s.region !== BigInt(expect.region)) bad.push(`its region is ${regionName(s.region)}, not ${regionName(expect.region)}`);
      signed(arg(1));
      break;
    }
    case "claim": {
      want("season", arg(0), expect.season);
      want("amount", arg(1), expect.amount);
      // the claim pays whoever sends it; its proof (a bytes32[] behind an offset) must lead to the pool's root on
      // chain for this pool, season, wallet and amount, or the amount isn't really this wallet's in this season
      const proof = proofIn(w);
      if (!proof) bad.push("its proof is malformed");
      else if (!verifyPoolProof(proof, expect.root, ctx.pool, arg(0), ctx.wallet, expect.amount)) bad.push("its proof doesn't lead to the pool's root on chain for this wallet and amount");
      break;
    }
    default:
      bad.push(`no rule for ${expect.fn}`);
  }
  let value;
  try {
    value = BigInt(tx?.value ?? -1);
  } catch {
    value = -1n;
  }
  if (value !== BigInt(expect.value)) bad.push(`it carries ${value < 0n ? "a bad value" : `${formatBnb(value)} BNB`}, not the ${formatBnb(expect.value)} BNB the chain says`);
  return bad;
}

/**
 * What a transaction does, read from its own calldata and from the value kart sends (null: unknown), never from the
 * server's words: { does, and as the function has them: card, price, packs, design, level, winner; for a mint the
 * name, role, region and stats the signed Stats carry }. Previews show this, so a server can't describe one thing
 * while the calldata does another.
 */
export function describeCall(calldata, value = null) {
  const call = decodeCall(calldata);
  if (!call) return { does: "nothing kart can read: the calldata is malformed" };
  if (!call.fn) return { does: "an unknown function" };
  if (!call.args) return { does: `${call.fn} with ${call.malformed}` };
  const bnb = (wei) => `${formatBnb(wei)} BNB`;
  const paid = value === null ? {} : { price: bnb(value) };
  const pays = value === null ? "" : ` for ${bnb(value)}`;
  const [a, b] = call.args;
  const card = typeof a === "bigint" ? String(a) : null;
  switch (call.fn) {
    case "buy":
      return { does: `buy card #${card} on the market${pays}`, card, ...paid };
    case "buyPass":
      return { does: `buy a season pass for card #${card}${pays}`, card, ...paid };
    case "buyFights":
      return { does: `buy ${b} fight pack${b === 1n ? "" : "s"} for card #${card}${pays}`, card, packs: Number(b), ...paid };
    case "list":
      return b === 0n
        ? { does: `take card #${card} off the market`, card }
        : { does: `list card #${card} on the market at ${bnb(b)}`, card, price: bnb(b) };
    case "buyMythic":
      return { does: `buy the next copy of Mythic design ${a}${pays}`, design: Number(a), ...paid };
    case "update":
      return { does: `write level ${a.level} onto card #${a.id}`, card: String(a.id), level: Number(a.level) };
    case "claimMythic":
      return { does: `claim a wheel copy of Mythic design ${a.design} for ${addr(a.to)}`, design: Number(a.design), winner: addr(a.to) };
    case "mint": {
      const name = `${labelText(a.label)}.ai`;
      const [role, region] = [roleName(a.role), regionName(a.region)];
      const stats = { power: Number(a.power), defense: Number(a.defense), speed: Number(a.speed), luck: Number(a.luck) };
      const line = `power ${stats.power}, defense ${stats.defense}, speed ${stats.speed}, luck ${stats.luck}`;
      return { does: `mint ${name}'s free card: ${/^[aeiou]/.test(region) ? "an" : "a"} ${region} ${role} with ${line}`, name, role, region, stats };
    }
    case "claim":
      return { does: `claim ${bnb(b)} from the season ${a} reward pool`, season: Number(a), amount: bnb(b) };
    default:
      return { does: call.fn };
  }
}

// ---- season pool claims: RewardPool's leaves and proofs (worker/src/merkle.js builds them the same way)

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const hexBytes = (hex) => Uint8Array.from(String(hex).replace(/^0x/, "").match(/../g) || [], (b) => parseInt(b, 16));

/** RewardPool.leaf(season, wallet, amount) in the pool at `pool`: keccak256(keccak256(abi.encode(pool, season, wallet, amount))),
 *  bound to that contract and season so a payout list can't be reused under another. */
export const poolLeaf = (pool, season, wallet, amount) =>
  keccak256(hexBytes(keccak256(hexBytes(word(BigInt(pool)) + word(season) + word(BigInt(wallet)) + word(amount)))));

/** Whether a proof (0x hex words) leads from (wallet, amount) in `season` of the pool at `pool` to `root`, as OpenZeppelin's
 *  MerkleProof walks it. */
export function verifyPoolProof(proof, root, pool, season, wallet, amount) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(root)) || /^0x0+$/.test(root)) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(pool))) return false;
  let h = poolLeaf(pool, season, wallet, amount);
  for (const p of proof) {
    const sib = `0x${word(BigInt(p))}`;
    h = keccak256(hexBytes(h < sib ? h.slice(2) + sib.slice(2) : sib.slice(2) + h.slice(2)));
  }
  return h === root.toLowerCase();
}

/** The bytes32[] proof of claim(season, amount, proof) from its words, as 0x hex; null when malformed. */
function proofIn(w) {
  if (w[2] === undefined || w[2] % 32n !== 0n) return null;
  const at = Number(w[2] / 32n);
  const len = w[at];
  if (len === undefined || len > 256n || w.length < at + 1 + Number(len)) return null;
  return w.slice(at + 1, at + 1 + Number(len)).map((x) => `0x${word(x)}`);
}

/**
 * With --yes, a payment needs the human's ceiling: --max-bnb. Returns why not to send, or null. A price that changed
 * after the human looked (a relisted card, say) is above the ceiling and stops the send.
 */
export function ceilingProblem(value, flags) {
  if (BigInt(value) === 0n || !flags.yes) return null;
  const max = typeof flags["max-bnb"] === "string" ? parseBnb(flags["max-bnb"]) : null;
  if (max === null) return `paying ${formatBnb(value)} BNB needs your human's ceiling: add --max-bnb ${formatBnb(value)}`;
  if (BigInt(value) > max) return `the price is now ${formatBnb(value)} BNB, above the approved --max-bnb ${formatBnb(max)}: ask your human again`;
  return null;
}

/**
 * Same checks our own agents use before sending anything: no approvals, no risk flags, and the wallet's outflows must be
 * exactly `paying` wei of BNB (0 for gas-only calls) and nothing else. baw reports balanceChanges entries as
 * { contractAddress: 0xeeee… for BNB, change: signed wei, owner, tokenType: "Native" }. It fails closed: an entry
 * counts as this wallet's unless its owner is plainly another address, a change kart can't read as a number is a
 * problem rather than zero, and a payment the simulation doesn't show stops the send.
 */
export function problems(pv, wallet, paying = 0n) {
  if (!pv?.success) return [`simulation failed: ${JSON.stringify(pv?.error ?? null).slice(0, 200)}`];
  const d = pv.data || {};
  const sim = d.simulationResult || {};
  const risks = d.risks || {};
  // another wallet's entry needs a real, different address as its owner; null, "", a missing or odd owner is ours
  const theirs = (b) => /^0x[0-9a-f]{40}$/i.test(String(b?.owner)) && !same(b.owner, wallet);
  // a change is a JSON number or a plain decimal string of wei; hex, units or nothing at all can't be trusted as zero
  const changeOf = (b) => (typeof b?.change === "number" ? b.change : /^[+-]?\d+(\.\d+)?$/.test(String(b?.change ?? "").trim()) ? Number(b.change) : NaN);
  const listed = sim.balanceChanges ?? [];
  const ours = Array.isArray(listed) ? listed.filter((b) => !theirs(b)) : [{}]; // not a list: one entry kart can't read
  const unreadable = ours.some((b) => !Number.isFinite(changeOf(b)));
  const leaving = ours.filter((b) => changeOf(b) < 0);
  const native = (b) => b.tokenType === "Native" || same(b.contractAddress, NATIVE);
  const tokenOut = leaving.some((b) => !native(b));
  const bnbOut = leaving.filter(native).reduce((s, b) => s - changeOf(b), 0); // wei; JSON numbers, so allow rounding
  const want = Number(paying);
  const slack = want * 1e-9 + 1;
  return [
    ["simulation error", sim.simulationErrorDetail],
    ["asks for a token approval", (sim.allowanceChanges || []).length],
    ["changes wallet authority", (sim.authorityChanges || []).length],
    ["Binance risk warning", risks.riskDetails],
    ["risky address", Object.values(risks.addresses || {}).some((v) => v?.riskDetails)],
    ["can't read the simulation's balance change, so its format may have changed", unreadable],
    ["a token or NFT leaves the wallet", tokenOut],
    [paying > 0n ? "more than the price leaves the wallet" : "BNB leaves the wallet", bnbOut > want + slack],
    ["the simulation doesn't show the payment, so its format may have changed", paying > 0n && bnbOut < want - slack],
  ]
    .filter(([, bad]) => bad && (!Array.isArray(bad) || bad.length))
    .map(([why]) => why);
}

// ---- the agent's own card: the contract maps an Agent ID's token id, keccak256 of its name, to the card it minted

/** "Nova.ai" / "nova" -> "nova", the name as the registry hashes it (like the server's); null when it can't be one. */
export function agentLabel(name) {
  const label = String(name ?? "").trim().toLowerCase().replace(/\.ai$/, "");
  return /^[a-z0-9_-]{1,29}$/.test(label) ? label : null;
}

const MASK64 = (1n << 64n) - 1n;
const rotl = (v, n) => ((v << n) | (v >> (64n - n))) & MASK64;
// Keccak-f[1600]'s round constants and rotation offsets, generated the way the Keccak reference defines them
const KECCAK_RC = [];
const KECCAK_ROT = Array(25).fill(0n);
for (let i = 0, r = 1; i < 24; i++) {
  let c = 0n;
  for (let j = 0; j < 7; j++) {
    r = ((r << 1) ^ ((r >> 7) * 0x71)) & 0xff; // the LFSR x^8 + x^6 + x^5 + x^4 + 1
    if (r & 2) c |= 1n << ((1n << BigInt(j)) - 1n);
  }
  KECCAK_RC.push(c);
}
for (let t = 0, x = 1, y = 0; t < 24; t++) {
  KECCAK_ROT[x + 5 * y] = BigInt((((t + 1) * (t + 2)) / 2) % 64);
  [x, y] = [y, (2 * x + 3 * y) % 5];
}

function keccakF(A) {
  const B = Array(25);
  const C = Array(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= d;
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], KECCAK_ROT[x + 5 * y]);
    for (let i = 0; i < 25; i++) {
      const row = i - (i % 5);
      A[i] = B[i] ^ (~B[row + ((i + 1) % 5)] & B[row + ((i + 2) % 5)]);
    }
    A[0] ^= KECCAK_RC[round];
  }
}

/** Ethereum's keccak256 (not SHA3-256, which pads differently and is all Node's crypto has) of text or bytes, as 0x hex. */
export function keccak256(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : Uint8Array.from(input);
  const RATE = 136;
  const msg = new Uint8Array((Math.floor(data.length / RATE) + 1) * RATE);
  msg.set(data);
  msg[data.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const A = Array(25).fill(0n);
  for (let off = 0; off < msg.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + 8 * i + b]);
      A[i] ^= lane;
    }
    keccakF(A);
  }
  let hex = "0x";
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((A[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, "0");
  return hex;
}

/** An Agent ID's token id in the registry, the key of AgentCards.cardOfAgentId: uint256(keccak256(label)). */
export const agentIdOf = (label) => BigInt(keccak256(label));

// ---- reading prices and cards from the chain ourselves, never from the server

const u256 = (n) => BigInt(n).toString(16).padStart(64, "0");

/** eth_call through a public RPC. */
export async function ethCall(rpc, to, data) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => null);
  if (!j || j.error || typeof j.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(j.result)) {
    throw new Error(`could not read the chain (${rpc}): ${j?.error?.message || "no result"}`);
  }
  return j.result;
}

/** Return word `i` of an eth_call result. */
export const wordOf = (result, i) => BigInt(`0x${result.slice(2 + i * 64, 2 + i * 64 + 64) || "0"}`);

export const chain = {
  marketPrice: async (rpc, cards, id) => wordOf(await ethCall(rpc, cards, READS.priceOf + u256(id)), 0),
  fightPackPrice: async (rpc, cards) => wordOf(await ethCall(rpc, cards, READS.fightPackPrice), 0),
  passPrice: async (rpc, cards) => wordOf(await ethCall(rpc, cards, READS.passPrice), 0),
  mythicPrice: async (rpc, cards, design) => wordOf(await ethCall(rpc, cards, READS.mythics + u256(design)), 13),
  claimUsed: async (rpc, cards, nonce) => wordOf(await ethCall(rpc, cards, READS.claimUsed + u256(nonce)), 0) === 1n,
  cardOfAgentId: async (rpc, cards, agentId) => wordOf(await ethCall(rpc, cards, READS.cardOfAgentId + u256(agentId)), 0),
  ownerOf: async (rpc, cards, id) => addr(wordOf(await ethCall(rpc, cards, READS.ownerOf + u256(id)), 0)),
  // RewardPool: a season's funding and whether a wallet has claimed it
  poolSeason: async (rpc, pool, season) => {
    const r = await ethCall(rpc, pool, READS.seasons + u256(season));
    return { root: `0x${u256(wordOf(r, 0))}`, funded: wordOf(r, 1), claimed: wordOf(r, 2), claimEnds: Number(wordOf(r, 3)), swept: wordOf(r, 4) === 1n };
  },
  poolClaimed: async (rpc, pool, season, wallet) => wordOf(await ethCall(rpc, pool, READS.claimed + u256(season) + u256(BigInt(wallet))), 0) === 1n,
};
