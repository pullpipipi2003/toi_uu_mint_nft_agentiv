#!/usr/bin/env python
"""graphify_pipeline.py — pipeline graphify one-shot, thay cho chuỗi lệnh CLI thủ công.

Chạy:
    $PY = Get-Content graphify-out\\.graphify_python
    & $PY scratch\\graphify_pipeline.py            # full build
    & $PY scratch\\graphify_pipeline.py --update   # incremental qua manifest.json

Lưu ý (xem OPTIMIZED_PIPELINE.md):
  * .graphifyignore phải tồn tại TRƯỚC bước detect.
  * Xuất HTML qua export.to_html(); `cli export html` là silent no-op.
  * to_json(force=True) ở lần build đầu, nếu không shrink guard chặn.
  * cluster.cluster() trả dict[int, list[str]] — đúng shape to_json cần.
  * Không có GEMINI_API_KEY -> đặt .graphify_chunk_*.json trong graphify-out/,
    script tự gộp cùng AST extraction.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # scratch/ -> project root
OUT = ROOT / "graphify-out"
OUT.mkdir(exist_ok=True)


def log(m):
    print(m, flush=True)


def read_labels():
    p = OUT / ".graphify_labels.json"
    if not p.exists():
        return {}
    raw = json.loads(p.read_text(encoding="utf-8"))
    return {int(k): v for k, v in raw.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--directed", action="store_true")
    a = ap.parse_args()

    from graphify import detect, extract, build, cluster, export, analyze, report
    from graphify.manifest import save_manifest

    # 1 ─ detect
    log("[1] detect")
    if a.update and (OUT / "manifest.json").exists():
        det = detect.detect_incremental(ROOT, str(OUT / "manifest.json"))
    else:
        det = detect.detect(ROOT)
    by_kind = det.get("files", {})
    counts = {k: len(v) for k, v in by_kind.items() if v}
    log(f"    {det.get('total_files')} file / ~{det.get('total_words')} tu  {counts}")
    if det.get("unclassified"):
        log(f"    chua phan loai: {len(det['unclassified'])}")

    # 2 ─ AST
    log("[2] AST extract")
    code = [Path(p) for p in by_kind.get("code", [])]
    ast_ext = extract.extract(code, root=ROOT) if code else {"nodes": [], "links": []}
    n_ast = len(ast_ext.get("nodes", []))
    e_ast = len(ast_ext.get("links", ast_ext.get("edges", [])))
    log(f"    {n_ast} node / {e_ast} edge")

    # 3 ─ merge AST + semantic chunks
    log("[3] merge")
    chunks = [ast_ext]
    for p in sorted(OUT.glob(".graphify_chunk_*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        chunks.append(d)
        log(f"    + {p.name} ({len(d.get('nodes', []))} node)")
    ext_all = {}
    for c in chunks:
        for k, v in c.items():
            if isinstance(v, list):
                ext_all.setdefault(k, []).extend(v)
            elif isinstance(v, dict):
                ext_all.setdefault(k, {}).update(v)
            else:
                ext_all[k] = v

    G = build.build([ext_all], directed=a.directed, root=ROOT)
    log(f"    {G.number_of_nodes()} node / {G.number_of_edges()} edge")

    # 4 ─ cluster
    log("[4] cluster")
    communities = cluster.cluster(G)
    auto = cluster.label_communities_by_hub(G, communities)
    labels = read_labels() or auto
    for cid, members in communities.items():
        name = labels.get(cid) or auto.get(cid, "")
        for n in members:
            G.nodes[n]["community"] = cid
            G.nodes[n]["community_name"] = name
        log(f"    c{cid}: {len(members):3d} — {name}")

    # 5 ─ analyze
    log("[5] analyze")
    cohesion = cluster.score_all(G, communities)
    gods = analyze.god_nodes(G, top_n=10)
    surprises = analyze.surprising_connections(G, communities, top_n=5)
    questions = analyze.suggest_questions(G, communities, labels, top_n=7)

    # 6 ─ export
    log("[6] export")
    j = export.to_json(G, communities, str(OUT / "graph.json"), force=True,
                       community_labels=labels)
    h = export.to_html(G, communities, str(OUT / "graph.html"),
                       community_labels=labels)
    log(f"    graph.json={j}  graph.html={h}")
    (OUT / ".graphify_labels.json").write_text(
        json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False, indent=2),
        encoding="utf-8")

    # 7 ─ report
    log("[7] report")
    cp = OUT / "cost.json"
    cost = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else {}
    md = report.generate(G, communities, cohesion, labels, gods, surprises,
                         det, cost, str(ROOT), suggested_questions=questions)
    (OUT / "GRAPH_REPORT.md").write_text(md, encoding="utf-8")
    log(f"    GRAPH_REPORT.md {len(md)} B")

    # 8 ─ manifest
    log("[8] manifest")
    files_map = {k: list(v) for k, v in by_kind.items() if v}
    save_manifest(files_map, str(OUT / "manifest.json"), kind="both", root=ROOT)
    log("DONE")


if __name__ == "__main__":
    sys.exit(main())
