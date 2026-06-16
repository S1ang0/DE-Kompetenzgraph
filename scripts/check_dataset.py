#!/usr/bin/env python3
"""Dataset integrity check (base test). Asserts the public dataset is internally consistent.
Exit 0 iff all checks pass."""
import json, sys

ds = json.load(open("public/de_dataset.json"))
clusters = {c["key"] for c in ds["clusters"]}
mods = {m["id"]: m for m in ds["modules"]}
errs = []

FAC = {"FIN", "FMB", "ETIT"}
LANG = {"en", "de", "both"}
for m in ds["modules"]:
    if not m.get("id"): errs.append(f"module missing id: {m}")
    if m["faculty"] not in FAC: errs.append(f"{m['id']}: bad faculty {m['faculty']}")
    if m["language"] not in LANG: errs.append(f"{m['id']}: bad language {m['language']}")
    if not isinstance(m["cp"], (int, float)): errs.append(f"{m['id']}: cp not numeric ({m['cp']})")
    if m["cluster"] not in clusters: errs.append(f"{m['id']}: unknown cluster {m['cluster']}")
    if not (m.get("title_en") or m.get("title_de")): errs.append(f"{m['id']}: no title")
    for s in m.get("secondary_clusters", []):
        if s not in clusters: errs.append(f"{m['id']}: unknown secondary cluster {s}")

for l in ds["links"]:
    s = l["source"] if isinstance(l["source"], str) else l["source"]["id"]
    t = l["target"] if isinstance(l["target"], str) else l["target"]["id"]
    if s not in mods: errs.append(f"link source missing: {s}")
    if t not in mods: errs.append(f"link target missing: {t}")

for p in ds["profiles"]:
    for k in p["core_clusters"] + p["allied_clusters"]:
        if k not in clusters: errs.append(f"profile {p['id']}: unknown cluster {k}")
    pool = set(p["eligible_pool"])
    for i in p["eligible_pool"] + p["substitutes"] + p["core_eligible_pool"]:
        if i not in mods: errs.append(f"profile {p['id']}: unknown module {i}")
    if not set(p["core_eligible_pool"]).issubset(pool):
        errs.append(f"profile {p['id']}: core_eligible not subset of eligible")
    # C1/C2 sanity on the required pool
    for i in p["eligible_pool"]:
        if mods[i]["faculty"] not in ("FIN", "FMB"):
            errs.append(f"profile {p['id']}: C2 violation in eligible ({i})")
        if mods[i]["language"] not in ("en", "both"):
            errs.append(f"profile {p['id']}: C1 violation in eligible ({i})")
    if not p["reachable_en_finfmb"]:
        errs.append(f"profile {p['id']}: not reachable")

print(f"checked: {len(ds['modules'])} modules, {len(ds['links'])} links, {len(ds['profiles'])} profiles, {len(ds['clusters'])} clusters")
if errs:
    print(f"FAILED with {len(errs)} error(s):")
    for e in errs[:30]: print("  -", e)
    sys.exit(1)
print("ALL INTEGRITY CHECKS PASS ✓")
sys.exit(0)
