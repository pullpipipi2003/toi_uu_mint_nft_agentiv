"""Quick dry-run: test pipeline với graph.json hiện tại (không re-extract)."""
import json, sys
from pathlib import Path
from graphify.build import build_from_json
from graphify import cluster, export, analyze, report
from graphify.manifest import save_manifest

ROOT = Path(r"C:\Users\MyAsus\AppData\Local\Programs\Antigravity")
OUT = ROOT / "graphify-out"

d = json.loads((OUT / "graph.json").read_text(encoding="utf-8"))
G = build_from_json(d)
print("G:", G.number_of_nodes(), G.number_of_edges())

comms = cluster.cluster(G)
labels = {int(k): v for k, v in json.loads((OUT / ".graphify_labels.json").read_text()).items()}
auto = cluster.label_communities_by_hub(G, comms)
merged_labels = {**auto, **labels}

for cid, members in comms.items():
    name = merged_labels.get(cid, "")
    for n in members:
        G.nodes[n]["community"] = cid
        G.nodes[n]["community_name"] = name

cohesion = cluster.score_all(G, comms)
gods = analyze.god_nodes(G, top_n=10)
surprises = analyze.surprising_connections(G, comms, top_n=5)
questions = analyze.suggest_questions(G, comms, merged_labels, top_n=7)
print("gods:", [g.get("label","?") for g in gods[:5]])
print("surprises:", len(surprises))
print("questions:", len(questions))

# report
cp = OUT / "cost.json"
cost = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else {}
det = {"total_files": 24, "total_words": 71133, "needs_graph": True,
       "files": {"code":[], "document":[], "paper":[], "image":[], "video":[]}}
md = report.generate(G, comms, cohesion, merged_labels, gods, surprises,
                     det, cost, str(ROOT), suggested_questions=questions)
print("report len:", len(md))
print("OK")
