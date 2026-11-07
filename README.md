# Graphify — Antigravity Corpus

Gói kết quả graphify chạy trên corpus `C:\Users\MyAsus\AppData\Local\Programs\Antigravity`.
Ngày chạy: 2026-11-07.

---

## 1. Loại graph đã tạo

| Lớp | Chi tiết |
|---|---|
| In-memory | `networkx.Graph` — **vô hướng** (`directed=False`). Dùng `--directed` sẽ ra `DiGraph`. |
| Định dạng lưu | `graph/graph.json` — GraphRAG-ready JSON (`GRAPH_SCHEMA_VERSION`) |
| Trực quan | `graph/graph.html` — HTML tự chứa, layout force-directed, 308 KB |
| Báo cáo | `graph/GRAPH_REPORT.md` — audit trail |
| Hỗ trợ | `graph/manifest.json` (state cho `--update`), `graph/cost.json` (token tracker), `graph/community_labels.json` |

### Schema node
`id`, `label`, `community`, `community_name`, `file_type`, `source_file`, `source_location`, `_origin` (`ast` | `semantic`)

### Schema edge
`source`, `target`, `relation`, `confidence` (`EXTRACTED` | `INFERRED` | `AMBIGUOUS`), `confidence_score`, `weight`

---

## 2. Số liệu

- Corpus: **22 file**, ~**70.583 từ**
- Graph: **347 node · 709 edge · 9 community**
- Phân loại edge: **86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS**
- INFERRED: 102 edge, confidence trung bình **0.85**
- Import cycle: **không có**

### God node (bậc cao nhất)
| Node | Bậc |
|---|---|
| `die()` | 22 |
| `mt()` | 17 |
| `api()` | 13 |
| `Z()` | 12 |
| `Q()` | 12 |
| `pt()` | 12 |
| `checkCall()` | 12 |
| `refresh()` | 11 |
| `jt()` | 11 |
| `It()` | 11 |

Cảnh báo: hầu hết là **định danh minified**, không mang nghĩa nghiệp vụ. Chỉ `checkCall()`, `refresh()` là đọc được.

### Community
| # | Tên | Node |
|---|---|---|
| 0 | Agent ID Security Guard | 71 |
| 1 | Bobbie Application State | 62 |
| 2 | Agent Arena Mint & Bowl | 49 |
| 3 | Kart CLI Contract Operations | 39 |
| 4 | NullSector Mint Terminal | 28 |
| 5 | TRACE & WeZards Mint Engines | 25 |
| 6 | NullSector Canvas & Boot | 26 |
| 7 | Agent Identity & Visual Cards | 12 |
| 8 | Arena Reward Claim Handler | 3 (quá mỏng, bị ẩn khỏi report) |

### Kết nối bất ngờ
- `BONBO.AI On-Chain Agent Identity Badge` —`semantically_similar_to`→ `Identity is Your Alpha Manifesto`
- `Oe()` —`indirect_call`→ `N()`
- `pt()` / `mt()` —`indirect_call`→ `n()` / `o()`

---

## 3. Hạn chế đã biết — ĐỌC TRƯỚC KHI TIN GRAPH

> [!WARNING]
> Graph **không hoàn chỉnh**. Ba lỗ hổng trích xuất và một cảnh báo sức khoẻ graph bên dưới là thật, không phải lỗi hiển thị.

**a) Graph health WARNING** (bước 4.5):
- 1 edge có endpoint treo (dangling)
- 4 self-loop
- 39 cặp edge bị gộp khi build vô hướng
- 11 edge tham chiếu ngoài

Nguyên nhân: AST extractor phát **cả** `contains` **và** `calls` cho cùng một cặp file→symbol (ví dụ `scratch_arena_js_bowl_js_v_7 -> scratch_arena_js_bowl_js_v_7_padaddr` ở L25 `contains` và L344 `calls`). Ở graph vô hướng hai edge này gộp làm một, mất phân biệt ngữ nghĩa.

**b) `MintContract.sol` không có trong graph.**
`tree-sitter-solidity` chưa cài → 1 file `.sol` đóng góp 0 node. Cần `pip install "graphifyy[solidity]"` rồi chạy lại.

**c) `ns_script_0.js` và `ns_script_2.js` chỉ trích xuất một phần.**
Lỗi cú pháp tại dòng 1 (code minified/IIFE), mỗi file vẫn ra 25 symbol nhưng có thể thiếu.

**d) 3 file chưa phân loại** (2 file không có phần mở rộng, 1 file `.dat`) — không vào graph.

---

## 4. Cách dùng

```powershell
# Mở trực quan
start "C:\Users\MyAsus\Downloads\graphify-antigravity-20261107\graph\graph.html"

# Truy vấn (từ thư mục project gốc)
& (Get-Content graphify-out\.graphify_python) -m graphify.cli query "how does the mint flow work?"

# Chạy lại toàn bộ pipeline
.\run_graphify.ps1

# Cập nhật tăng dần (dùng manifest.json)
.\run_graphify_update.ps1
```

---

## 5. Cấu trúc gói

```
graphify-antigravity-20261107/
├── README.md              ← file này
├── OPTIMIZED_PIPELINE.md  ← khác biệt so với SKILL.md gốc
├── run_graphify.ps1       ← chạy lại từ đầu
├── run_graphify_update.ps1← cập nhật tăng dần
├── graph/
│   ├── graph.html
│   ├── graph.json
│   ├── GRAPH_REPORT.md
│   ├── manifest.json
│   ├── cost.json
│   └── community_labels.json
└── source/                ← corpus gốc mà graph tham chiếu
    ├── agent-card-preview.svg
    └── scratch/ (20 file: html, js, sol, json, cli/*.mjs)
```
