// Agent Arena · papan klaim ARENA. Membaca kontrak ArenaClaim langsung
// dari rantai (balapan beberapa RPC, pola yang sama dengan bowl.js).
(function () {
  var CLAIM = "0x3452E984bFBB2A24F33D633bBFfC8Abbfc3DB80B";
  var RPCS = [
    "https://bsc-dataseed-public.bnbchain.org",
    "https://bsc-dataseed1.binance.org",
    "https://bsc-dataseed.binance.org",
    "https://bsc-rpc.publicnode.com",
  ];
  function rpcCall(url, to, data) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 6000);
    return fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: to, data: data }, "latest"] }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      if (!j.result) throw new Error("no result");
      return j.result;
    });
  }
  var readChain = function (to, data) { return Promise.any(RPCS.map(function (u) { return rpcCall(u, to, data); })); };
  var fmt = function (n) { return n.toLocaleString("en-US"); };
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };

  function refresh() {
    readChain(CLAIM, "0xd54ad2a1").then(function (r) { set("led-claimed", fmt(parseInt(r, 16))); }).catch(function () {});
    readChain(CLAIM, "0x754c463f").then(function (r) { set("led-remaining", fmt(parseInt(r, 16))); }).catch(function () {});
    readChain(CLAIM, "0x4b8bcb58").then(function (r) { set("led-cstatus", parseInt(r, 16) === 1 ? "Open" : "Opens soon"); }).catch(function () {});
  }
  if (document.getElementById("led-claimed")) {
    refresh();
    setInterval(refresh, 60000);
  }
})();
