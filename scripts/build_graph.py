#!/usr/bin/env python3
"""Build the public knowledge-graph dataset for the app.
Nodes = modules, links = topical similarity (shared tags / clusters), capped per node.
Output: public/de_dataset.json  (clusters + nodes + links + profiles + meta)"""
import json, itertools, collections

mods = json.load(open("data/modules.json"))
clusters = json.load(open("data/clusters.json"))
profiles = json.load(open("data/profiles.json"))

def clusters_of(m):
    return set([m["primary_cluster"]] + list(m.get("secondary_clusters", [])))

# ---- nodes (slim) ----
nodes = []
for m in mods:
    nodes.append({
        "id": m["id"],
        "title_en": m["title_en"], "title_de": m["title_de"],
        "label": m["title_en"] or m["title_de"],
        "faculty": m["faculty"], "language": m["language"], "cp": m["cp"],
        "level_band": m.get("level_band", "core"), "kind": m.get("kind", "course"),
        "cluster": m["primary_cluster"], "secondary_clusters": m.get("secondary_clusters", []),
        "competencies": m.get("competencies", []), "topic_tags": m.get("topic_tags", []),
        "description_en": m.get("description_en", ""),
        "module_code": m.get("module_code"), "source": m.get("source"), "source_url": m.get("source_url"),
    })

# ---- links: topical similarity ----
# inverted index over topic tags
tagidx = collections.defaultdict(list)
for m in mods:
    for t in set(m.get("topic_tags", [])):
        tagidx[t.lower()].append(m["id"])

by = {m["id"]: m for m in mods}
pair_w = collections.defaultdict(int)
for t, ids in tagidx.items():
    if len(ids) > 25:   # skip overly generic tags to avoid hairball
        continue
    for a, b in itertools.combinations(sorted(set(ids)), 2):
        pair_w[(a, b)] += 2  # +2 per shared tag

# cluster bonus
for a, b in list(pair_w.keys()):
    ca, cb = by[a], by[b]
    if ca["primary_cluster"] == cb["primary_cluster"]:
        pair_w[(a, b)] += 2
    elif clusters_of(ca) & clusters_of(cb):
        pair_w[(a, b)] += 1

# keep top-K per node with weight>=3
MINW, K = 3, 6
adj = collections.defaultdict(list)
for (a, b), w in pair_w.items():
    if w >= MINW:
        adj[a].append((w, b)); adj[b].append((w, a))
keep = set()
for n, lst in adj.items():
    for w, o in sorted(lst, reverse=True)[:K]:
        keep.add((min(n, o), max(n, o)))

# fallback: ensure no isolated node — connect each to its nearest same-cluster partner
connected = set()
for a, b in keep:
    connected.add(a); connected.add(b)
by_cluster = collections.defaultdict(list)
for m in mods:
    by_cluster[m["primary_cluster"]].append(m["id"])
for m in mods:
    nid = m["id"]
    if nid in connected:
        continue
    best, bestw = None, -1
    for o in by_cluster[m["primary_cluster"]]:
        if o == nid:
            continue
        w = pair_w.get((min(nid, o), max(nid, o)), 0)
        # tie-break: prefer a partner that is itself well-connected
        score = w * 10 + len(adj.get(o, []))
        if score > bestw:
            bestw, best = score, o
    if best:
        keep.add((min(nid, best), max(nid, best)))
        connected.add(nid)

links = []
for a, b in sorted(keep):
    ca, cb = by[a], by[b]
    links.append({
        "source": a, "target": b, "weight": pair_w[(min(a,b),max(a,b))],
        "intra": ca["primary_cluster"] == cb["primary_cluster"],
        "cross_faculty": ca["faculty"] != cb["faculty"],
    })

# ---- slim profiles ----
slim_profiles = []
for p in profiles["profiles"]:
    slim_profiles.append({
        "id": p["id"], "name": p["name"], "tagline": p["tagline"], "description": p["description"],
        "core_clusters": p["core_clusters"], "allied_clusters": p["allied_clusters"],
        "threshold_cp": p["threshold_cp"], "core_min_cp": p["core_min_cp"],
        "eligible_pool": p["eligible_pool"], "core_eligible_pool": p["core_eligible_pool"],
        "substitutes": p["substitutes"], "stats": p["stats"],
        "example_selection": p["example_selection"],
        "example_total_cp": p["example_total_cp"], "example_core_cp": p["example_core_cp"],
        "reachable_en_finfmb": p["reachable_en_finfmb"],
    })

dataset = {
    "meta": {
        "title": "M.Sc. Digital Engineering — Modul- & Profilierungsgraph",
        "faculties": ["FIN", "FMB", "ETIT"],
        "n_modules": len(nodes), "n_links": len(links),
        "n_clusters": len(clusters["clusters"]), "n_profiles": len(slim_profiles),
        "profile_threshold_cp": profiles["meta"]["threshold_cp"],
        "profile_core_min_cp": profiles["meta"]["core_min_cp"],
        "generated_from": "data/modules.json + data/clusters.json + data/profiles.json",
    },
    "clusters": clusters["clusters"],
    "modules": nodes,
    "links": links,
    "profiles": slim_profiles,
}
json.dump(dataset, open("public/de_dataset.json", "w"), ensure_ascii=False, indent=1)

deg = collections.Counter()
for l in links:
    deg[l["source"]] += 1; deg[l["target"]] += 1
print(f"nodes={len(nodes)} links={len(links)} avg_degree={2*len(links)/len(nodes):.1f}")
print(f"isolated nodes={sum(1 for n in nodes if deg[n['id']]==0)}")
print(f"cross-faculty links={sum(1 for l in links if l['cross_faculty'])}  bridge(inter-cluster)={sum(1 for l in links if not l['intra'])}")
print("wrote public/de_dataset.json")
