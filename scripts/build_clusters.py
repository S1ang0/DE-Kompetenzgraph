#!/usr/bin/env python3
"""Recompute per-cluster counts from data/modules.json into data/clusters.json
(preserves name/color/description/seeds; updates count_total / count_incl_secondary /
count_en_finfmb / cp_en_finfmb)."""
import json, collections

clusters = json.load(open("data/clusters.json"))
m = json.load(open("data/modules.json"))

def en_finfmb(x):
    return x["faculty"] in ("FIN", "FMB") and x["language"] in ("en", "both")

prim = collections.Counter(x["primary_cluster"] for x in m)
withsec = collections.Counter()
for x in m:
    withsec[x["primary_cluster"]] += 1
    for s in x["secondary_clusters"]:
        withsec[s] += 1
enc = collections.Counter(x["primary_cluster"] for x in m if en_finfmb(x))
encp = collections.defaultdict(int)
for x in m:
    if en_finfmb(x):
        encp[x["primary_cluster"]] += x["cp"] or 0

for c in clusters["clusters"]:
    k = c["key"]
    c["count_total"] = prim[k]
    c["count_incl_secondary"] = withsec[k]
    c["count_en_finfmb"] = enc[k]
    c["cp_en_finfmb"] = encp[k]

json.dump(clusters, open("data/clusters.json", "w"), ensure_ascii=False, indent=1)
print("clusters.json counts updated:", len(clusters["clusters"]), "clusters")
