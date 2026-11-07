<script>
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ── deterministic pixel-bot renderer (placeholder art) ── */
function rng(seed){ let x = seed * 2654435761 % 4294967296; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const PALETTES = [
  ["#3dff6e","#14532d","#0a0f0a"], ["#ffb000","#7a5200","#100c02"], ["#37e0e0","#155e63","#02141a"],
  ["#ff4fd8","#6d1157","#17030f"], ["#e8e8e8","#5a5a5a","#101010"], ["#ff5252","#6e1414","#170404"],
];
function drawBot(cv, seed){
  const r = rng(seed), ctx = cv.getContext("2d"), S = 8; cv.width = S; cv.height = S;
  const pal = PALETTES[seed % PALETTES.length];
  ctx.fillStyle = pal[2]; ctx.fillRect(0,0,S,S);
  const grid = [];
  for (let y = 0; y < S; y++){ grid[y] = [];
    for (let x = 0; x < 4; x++){ const v = r() > 0.52 ? 1 : 0; grid[y][x] = v; grid[y][S-1-x] = v; } }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
    if (grid[y][x]){ ctx.fillStyle = (y > 1 && y < 4 && (x === 2 || x === 5)) ? "#ffffff" : pal[0]; ctx.fillRect(x, y, 1, 1); }
  ctx.fillStyle = pal[1]; ctx.fillRect(3, 6, 2, 1); /* mouth */
}
function botCanvas(seed, cls){ const cv = document.createElement("canvas"); if (cls) cv.className = cls; drawBot(cv, seed); return cv; }

/* ── boot sequence ── */
const bootLines = [
  ["nullsector-os v1.0.0 — ttyS0", "dim"], ["mounting /dev/chain0 (bsc-mainnet) ... OK", ""],
  ["loading agent-id module ............ OK", ""], ["verifying wallet signature ......... OK", ""],
  ["compiling nullsector.sol ........... OK", ""], ["royalty module (erc-2981) ......... OK", ""],
  ["", ""], ["welcome, agent. type `help` or click ./mint to begin_", ""],
];
const bootEl = $("#boot"); let bi = 0;
function typeBoot(){
  if (bi >= bootLines.length){ setTimeout(() => bootEl.classList.add("hide"), 650); return; }
  const [txt, cls] = bootLines[bi++];
  const d = document.createElement("div"); if (cls) d.className = cls; d.textContent = txt;
  bootEl.appendChild(d); setTimeout(typeBoot, txt === "" ? 60 : 130 + Math.random() * 160);
}
typeBoot();
bootEl.addEventListener("click", () => bootEl.classList.add("hide"));

/* ── clock (UTC) ── */
setInterval(() => {
  $("#clock").textContent = new Date().toLocaleTimeString("en-GB", { timeZone: "UTC" }) + " UTC";
}, 500);

/* ── tabs ── */
function show(name){
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.scr === name));
  $$(".scr").forEach(s => s.classList.toggle("on", s.id === "scr-" + name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$("#tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.scr)));

/* ── supply bar ── */
let minted = 0; const MAXS = 4321;
function renderBar(){
  const pct = minted / MAXS, cells = 34, on = Math.round(pct * cells);
  $("#st-bar").innerHTML = "[" + "█".repeat(on) + '<span class="off">' + "░".repeat(cells - on) + "</span>] " + (pct * 100).toFixed(1) + "%";
  $("#st-minted").textContent = minted.toLocaleString("en-US");
  $("#st-left").textContent = (MAXS - minted).toLocaleString("en-US");
}
renderBar();

/* ── mint log ── */
const logEl = $("#mint-log");
function ts(){ return new Date().toLocaleTimeString("en-GB", { timeZone: "UTC" }); }
function log(msg, cls){
  const d = document.createElement("div");
  d.innerHTML = '<span class="t">[' + ts() + "]</span> " + msg;
  if (cls) d.className = cls;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
}
log("session started — nullsector mint client v1.0.0");
log("rpc: bsc-mainnet connected (read-only)", "inf");
log("reads: contract + agent-id registry — live", "inf");
log("tracks: FREE 1/wallet (slot / 10 blk) · PAID 0.001 BNB fixed (slot / 5 blk, max 3)", "wr");
log("paste an address below — the prompt fills in for your agent…");

/* ── live reads + address check (no wallet connect, ever) ── */
const NFT_ADDR = "0x9395e207F9928657237DE96ffB12340094c073cd";
const READ_RPC = "https://rpc-bsc.48.club";
const NFT_READ_ABI = ["function status(address) view returns (bool,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool,uint256,uint256)", "function totalSupply() view returns (uint256)", "function mintOpen() view returns (bool)", "function startBlock() view returns (uint256)", "function ownerOf(uint256) view returns (address)"];
let readContract = null;
function getReadContract(){
  if (!readContract) readContract = new ethers.Contract(NFT_ADDR, NFT_READ_ABI, new ethers.JsonRpcProvider(READ_RPC));
  return readContract;
}
async function refreshSupply(){
  try {
    const c = getReadContract();
    const res = await Promise.all([c.totalSupply(), c.mintOpen(), c.startBlock()]);
    minted = Number(res[0]);
    renderBar();
    const soldOut = minted >= MAXS;
    const co = $("#cfg-open");
    if (co){ co.textContent = soldOut ? "sold_out" : String(res[1]); co.className = soldOut ? "warn" : (res[1] ? "ok" : "warn"); }
    const fs = $("#foot-status");
    if (fs) fs.textContent = soldOut ? "mint status: SOLD OUT — 4,321 / 4,321 · market open" : res[1] ? "mint status: LIVE — mint open · supply " + minted + " / 4,321" : Number(res[2]) > 0 ? "mint status: PAUSED — the owner paused the mint" : "mint status: NOT LAUNCHED — contract deployed · opens when the owner launches";
    log(soldOut ? "contract: supply 4,321 / 4,321 — SOLD OUT. mint closed." : "contract: supply " + minted + " / 4,321 · mint_open = " + res[1], soldOut ? "ok" : "inf");
  } catch { log("contract read failed — rpc busy, values may be stale", "err"); }
}
refreshSupply();

function promptFor(addr){
  return "NULLSECTOR is SOLD OUT — 4,321 / 4,321 minted on BNB Chain (chainId 56), contract " + NFT_ADDR + ". Do NOT call mintFree() or mintPaid() for wallet " + addr + " — no supply remains.\n\nTrading is live on the native market at https://nullsector.online (market contract 0xA59493C4Fc96a44c3EbAc7985464a10cD43Fb0f6 — 0% market fee, 2.5% royalty). Read the Trading section of https://nullsector.online/skill.md first. Only buy, list or bid when I explicitly ask, and confirm the exact token ID and price with me first.";
}
$("#btn-check-addr").addEventListener("click", async () => {
  const v = $("#addr-in").value.trim();
  if (!ethers.isAddress(v)){
    $("#chk-agent").innerHTML = '<span class="bad">invalid address</span>';
    log("address check: invalid address", "err");
    return;
  }
  log("checking " + v + " …", "inf");
  try {
    const st = await getReadContract().status(v);
    const open = st[0], eligible = st[7], freeUsed = st[8];
    const soldOut = Number(st[1]) >= MAXS;
    const paidCount = Number(st[9]), paidLeft = Number(st[10]);
    $("#chk-agent").innerHTML = eligible ? '<span class="ok">detected ✓</span>' : '<span class="bad">not found ✗</span>';
    $("#chk-free").textContent = soldOut ? "mint closed — sold out" : !eligible ? "needs an Agent ID" : freeUsed ? "already claimed" : "available — 1 waiting";
    $("#chk-paid").textContent = soldOut ? "mint closed — sold out" : paidCount + " / 3 used · " + paidLeft + " left";
    $("#chk-open").innerHTML = soldOut ? '<span class="warn">sold out</span>' : open ? '<span class="ok">true</span>' : '<span class="warn">false — not launched</span>';
    $("#st-wallet").textContent = v.slice(0, 6) + "…" + v.slice(-4);
    $("#st-wallet").className = "";
    $("#st-yours").textContent = (freeUsed ? 1 : 0) + paidCount + " / 4";
    $("#mint-prompt").value = promptFor(v);
    log("agent-id " + (eligible ? "✓" : "✗") + " · free " + (freeUsed ? "claimed" : "available") + " · paid " + paidCount + "/3 · open " + open, eligible ? "ok" : "wr");
    log("prompt updated for " + v + " — copy it for your agent", "ok");
  } catch { log("address check failed — rpc busy, try again", "err"); }
});



/* ── activity feed ── */
const feedEl = $("#feed");
const ACTORS = ["0x8bC1…44d0", "0x19Fa…bEEF", "0xD00d…1234", "0x5Eed…9aA1", "0xAa01…77Cc", "0xF00d…3b3b"];
function pushFeed(kind, text){
  const d = document.createElement("div");
  d.innerHTML = '<span class="t">[' + ts() + ']</span> <span class="' + (kind === "MINT" ? "ok" : kind === "SALE" ? "warn" : "cy") + '">' + kind.padEnd(5, " ") + "</span> " + text;
  feedEl.prepend(d);
  while (feedEl.children.length > 60) feedEl.lastChild.remove();
}
let feedInit = false, lastSupply = 0;
let feedBusy = false;
async function feedTick(){
  if (feedBusy) return;
  feedBusy = true;
  try {
    const c = getReadContract();
    const res = await Promise.all([c.totalSupply(), c.mintOpen()]);
    const supply = Number(res[0]);
    if (!feedInit){
      feedInit = true; lastSupply = supply;
      if (!res[1] && supply === 0){ pushFeed("MINT", "mint not launched yet — this feed streams real mints only, starting at launch"); return; }
      const from = Math.max(1, supply - 29);
      for (let id = from; id <= supply; id++){
        try { const o = await c.ownerOf(id); pushFeed("MINT", "NULL #" + id + " minted → " + o.slice(0, 6) + "…" + o.slice(-4)); } catch (e) {}
      }
      if (supply > 30) pushFeed("MINT", "…and " + (supply - 30) + " earlier mints — supply " + supply + " / 4,321");
      return;
    }
    if (supply > lastSupply){
      for (let id = lastSupply + 1; id <= supply; id++){
        try { const o = await c.ownerOf(id); pushFeed("MINT", "NULL #" + id + " minted → " + o.slice(0, 6) + "…" + o.slice(-4)); } catch (e) {}
      }
      lastSupply = supply;
    }
  } catch (e) {}
  finally { feedBusy = false; }
}
feedTick();
setInterval(feedTick, 12000);

/* ── activity feed — market events (listed / sold / offers) ── */
const MKT_FEED_ADDR = "0xA59493C4Fc96a44c3EbAc7985464a10cD43Fb0f6";
const MKT_FEED_ABI = [
  "event Listed(uint256 indexed id, address indexed seller, uint256 price)",
  "event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 royalty)",
  "event OfferMade(uint256 indexed id, address indexed bidder, uint256 amount)",
  "event Cancelled(uint256 indexed id, address indexed seller)"
];
const fB = (w) => { const n = parseFloat(ethers.formatEther(w)); if (n > 0 && n < 0.0001) return "<0.0001"; const q = 10000000000n; let v; try { v = (BigInt(w) + q / 2n) / q * q; } catch { v = w; } const x = ethers.formatEther(v); return x.includes(".") ? x.replace(/0+$/, "").replace(/\.$/, "") : x; };
const shortA = (a) => a.slice(0, 6) + "…" + a.slice(-4);
let mktFeedInit = false, lastMktBlock = 0, mktFeedBusy = false;
const mktSeen = new Set();
async function mktFeedTick(){
  if (mktFeedBusy) return;
  mktFeedBusy = true;
  try {
    const prov = new ethers.JsonRpcProvider(READ_RPC);
    const mc = new ethers.Contract(MKT_FEED_ADDR, MKT_FEED_ABI, prov);
    const bn = await prov.getBlockNumber();
    let from = mktFeedInit ? lastMktBlock + 1 : Math.max(0, bn - 20000);
    if (from > bn) return;
    const evs = [];
    for (let f = from; f <= bn; f += 5000){
      const t = Math.min(f + 4999, bn);
      const parts = await Promise.all([
        mc.queryFilter(mc.filters.Listed(), f, t),
        mc.queryFilter(mc.filters.Sold(), f, t),
        mc.queryFilter(mc.filters.OfferMade(), f, t),
        mc.queryFilter(mc.filters.Cancelled(), f, t)
      ]);
      for (const arr of parts) for (const e of arr) evs.push(e);
      lastMktBlock = t; mktFeedInit = true;
    }
    evs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));
    for (const e of evs){
      const key = e.transactionHash + ':' + e.index;
      if (mktSeen.has(key)) continue;
      mktSeen.add(key);
      if (mktSeen.size > 5000) mktSeen.clear();
      const a = e.args, id = a.id.toString();
      if (e.eventName === "Listed") pushFeed("LIST", "NULL #" + id + " listed @ " + fB(a.price) + " BNB by " + shortA(a.seller));
      else if (e.eventName === "Sold") pushFeed("SALE", "NULL #" + id + " sold → " + shortA(a.buyer) + " @ " + fB(a.price) + " BNB");
      else if (e.eventName === "OfferMade") { if (id === "0") pushFeed("OFFER", "collection offer @ " + fB(a.amount) + " BNB by " + shortA(a.bidder)); else pushFeed("OFFER", "NULL #" + id + " offer @ " + fB(a.amount) + " BNB by " + shortA(a.bidder)); }
      else if (e.eventName === "Cancelled") pushFeed("DELIST", "NULL #" + id + " listing cancelled by " + shortA(a.seller));
    }
  } catch (e) {}
  finally { mktFeedBusy = false; }
}
mktFeedTick();
setInterval(mktFeedTick, 20000);

/* ── copy agent mint prompt ── */
$("#btn-copy-prompt").addEventListener("click", async () => {
  const box = $("#mint-prompt");
  const status = $("#copy-prompt-status");
  box.focus(); box.select();
  try {
    await navigator.clipboard.writeText(box.value);
    status.textContent = "copied ✓";
  } catch {
    const ok = document.execCommand && document.execCommand("copy");
    status.textContent = ok ? "copied ✓" : "press Ctrl+C / long-press to copy";
  }
  setTimeout(() => { status.textContent = ""; }, 2400);
});

/* ── fake CLI ── */
$("#cli-in").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const raw = e.target.value.trim(); e.target.value = "";
  const c = raw.toLowerCase();
  if (c === "help") log("commands: mint · market · activity · whoami · clear", "inf");
  else if (c === "mint" || c === "./mint") show("mint");
  else if (c === "gallery" || c === "ls") show("market");
  else if (c === "activity" || c === "tail" || c === "tail -f ./activity.log") show("activity");
  else if (c === "whoami") log("agent-id verified. clearance: minter.", "ok");
  else if (c === "clear") logEl.innerHTML = "";
  else if (c === "") {}
  else { log("bash: " + raw.split(" ")[0] + ": command not found — try `help`", "err"); show("mint"); }
  if (["help", "whoami", "clear"].includes(c)) show("mint");
});
</script>