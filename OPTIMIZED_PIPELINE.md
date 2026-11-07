# Pipeline Graphify — Tối ưu so với SKILL.md gốc

Ghi lại các fix và điều chỉnh phát sinh khi chạy thực tế, không có trong hướng dẫn gốc.

---

## Thay đổi cần thiết (bắt buộc)

### 1. Tạo `.graphifyignore` TRƯỚC bước detect

Nếu không, `LICENSES.chromium.html` (2.909.348 từ!) và các file nhị phân phình corpus lên 25 file / "Large corpus" warning, buộc chạy lại từ đầu.

```
# .graphifyignore đặt tại root project
LICENSES.chromium.html
LICENSE.electron.txt
resources/
locales/
*.dll
*.exe
*.pak
*.bin
```

Thứ tự bắt buộc:
```
1. Tạo .graphifyignore
2. Chạy detect
```

### 2. Dùng API trực tiếp để xuất HTML, không dùng CLI subcommand

```powershell
# ❌ Không dùng (exit 0 nhưng không tạo file)
& (Get-Content graphify-out\.graphify_python) -m graphify.cli export html

# ✅ Dùng cái này
$py = Get-Content graphify-out\.graphify_python
$code = @''
import networkx as nx, json
from graphify.export import to_html
from graphify.graph import from_json
G, meta = from_json('graphify-out/graph.json')
communities = {n: G.nodes[n]['community'] for n in G.nodes}
labels = json.load(open('graphify-out/.graphify_labels.json'))
to_html(G, communities, 'graphify-out/graph.html', community_labels=labels)
''@
 | &  -
```

### 3. Semantic extraction khi không có GEMINI_API_KEY

Không có key → không dùng subagent → viết chunk JSON thủ công.

Chiến lược batch tốt hơn SKILL.md:
- Nhóm **theo loại file** (5 HTML cùng chunk, mỗi image chunk riêng) thay vì nhóm theo số dòng. File minified là một dòng khổng lồ — số dòng vô nghĩa.
- Mỗi chunk JSON phải có schema: `{"nodes": [...], "edges": [...], "hyperedges": [...]}`
- Node ID: `<stem>_<semantic_role>` (ví dụ `scratch_tracea_landing`, `scratch_wezards_mint_portal`)

### 4. `to_json(force=True)` cho lần build đầu

Lần đầu không có `graph.json` cũ → shrink guard kích hoạt và chặn. Luôn dùng `force=True`.

### 5. Community labeling cần đọc source khi AST bị minified

AST dump ra `mt()`, `Z()`, `pt()` — không đọc được nghĩa. Quy trình:

```python
# In 8 node label đầu + set source file của mỗi community
for cid in sorted(set(nx.get_node_attributes(G, 'community').values())):
    nodes = [n for n,d in G.nodes(data=True) if d.get('community')==cid]
    labels_in = [G.nodes[n].get('label','?') for n in nodes[:8]]
    files_in  = set(G.nodes[n].get('source_file','?') for n in nodes)
    print(f"Community {cid}: {labels_in} | files: {files_in}")
```

Sau đó đặt tên theo file/module chính chứ không dựa vào symbol name.

### 6. `read_file` yêu cầu đường dẫn tuyệt đối

```powershell
# ❌ read_file "graphify-out\.graphify_detect.json"
# ✅ read_file "C:\Users\MyAsus\AppData\Local\Programs\Antigravity\graphify-out\.graphify_detect.json"
```

### 7. Python invocation pattern bắt buộc

```powershell
& (Get-Content graphify-out\.graphify_python) -m graphify.cli <subcommand>
# hoặc heredoc:
$py = Get-Content graphify-out\.graphify_python
$code = @''
<python code>
''@
$code | & $py -
```

Không dùng `python`, `py`, hay đường dẫn hardcode — `.graphify_python` lưu đúng interpreter path.

---

## Tối ưu tùy chọn

### Cài Solidity parser (nếu corpus có `.sol`)
```powershell
& (Get-Content graphify-out\.graphify_python) -m pip install "graphifyy[solidity]"
```
Sau đó chạy lại từ bước AST extract. Hiện `MintContract.sol` đóng góp 0 node.

### Graph có hướng (--directed)
Thêm `directed=True` vào `to_json()` và `from_json()` để giữ phân biệt `contains` vs `calls`. Giải quyết 39 cặp edge bị gộp. Đánh đổi: một số thuật toán community detection không chạy được trên DiGraph.

### Health check script
Chạy sau mỗi build:
```python
from graphify.graph import from_json, health_check
G, meta = from_json('graphify-out/graph.json')
health_check(G, verbose=True)
```
Nếu có dangling/self-loop: kiểm tra AST extractor version.

---

## So sánh SKILL.md gốc vs pipeline này

| Bước | SKILL.md | Pipeline này |
|---|---|---|
| Corpus filter | Không đề cập | `.graphifyignore` bắt buộc trước detect |
| HTML export | `cli export html` | `to_html()` trực tiếp qua API |
| Semantic (no key) | Dùng subagent | Viết chunk JSON inline, batch theo file type |
| Community label | Auto (cần API) | Manual inspection khi AST bị minified |
| `to_json` lần đầu | Không ghi rõ | Luôn `force=True` |
| Health check | Tùy chọn | Bắt buộc sau bước 4, kết quả phải báo cáo |
| Cleanup | `Remove-Item` list cứng | Thêm `-ErrorAction SilentlyContinue` |
