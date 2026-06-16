#!/usr/bin/env python3
"""Compute eligible pools, substitutes and a concrete reachability example per profile.
Input: data/modules.json, data/clusters.json, data/profiles_def.json
Output: data/profiles.json"""
import json

mods = json.load(open("data/modules.json"))
clusters = json.load(open("data/clusters.json"))
pdef = json.load(open("data/profiles_def.json"))
M = {m["id"]: m for m in mods}
cname = {c["key"]: c["name"] for c in clusters["clusters"]}

THRESH = pdef["meta"]["threshold_cp"]
CORE_MIN = pdef["meta"]["core_min_cp"]
KINDS = set(pdef["meta"]["eligible_kinds"])

def in_scope(m, keys):
    return m["primary_cluster"] in keys or any(s in keys for s in m.get("secondary_clusters", []))

def primary_in(m, keys):
    return m["primary_cluster"] in keys

def is_en_finfmb(m):
    return m["faculty"] in ("FIN", "FMB") and m["language"] in ("en", "both")

def greedy_example(core_pool, wide_pool):
    """Pick core modules until CORE_MIN, then widen until THRESH. Returns (ids, total, core_sum)."""
    chosen, core_sum, total = [], 0, 0
    for m in sorted(core_pool, key=lambda x: -(x["cp"] or 0)):
        if core_sum >= CORE_MIN:
            break
        chosen.append(m); core_sum += m["cp"] or 0; total += m["cp"] or 0
    if core_sum < CORE_MIN:
        return None
    pool_rest = [m for m in wide_pool if m["id"] not in {c["id"] for c in chosen}]
    for m in sorted(pool_rest, key=lambda x: -(x["cp"] or 0)):
        if total >= THRESH:
            break
        chosen.append(m); total += m["cp"] or 0
    if total < THRESH:
        return None
    return ([c["id"] for c in chosen], total, core_sum)

out_profiles = []
for p in pdef["profiles"]:
    core = set(p["core_clusters"])
    allied = set(p["allied_clusters"])
    allk = core | allied
    scope = [m for m in mods if in_scope(m, allk) and m["kind"] in KINDS]
    eligible = [m for m in scope if is_en_finfmb(m)]                       # required pool (C1+C2 ok)
    substitutes = [m for m in scope if not is_en_finfmb(m)]                # de FIN/FMB or ETIT (optional only)
    core_eligible = [m for m in eligible if primary_in(m, core)]
    core_en_cp = sum(m["cp"] or 0 for m in core_eligible)
    total_en_cp = sum(m["cp"] or 0 for m in eligible)
    ex = greedy_example(core_eligible, eligible)
    out_profiles.append({
        "id": p["id"], "name": p["name"], "tagline": p["tagline"], "description": p["description"],
        "core_clusters": p["core_clusters"], "allied_clusters": p["allied_clusters"],
        "core_cluster_names": [cname[k] for k in p["core_clusters"]],
        "threshold_cp": THRESH, "core_min_cp": CORE_MIN,
        "eligible_pool": [m["id"] for m in eligible],
        "core_eligible_pool": [m["id"] for m in core_eligible],
        "substitutes": [m["id"] for m in substitutes],
        "stats": {
            "n_eligible": len(eligible), "n_core_eligible": len(core_eligible),
            "n_substitutes": len(substitutes),
            "core_en_cp": core_en_cp, "total_en_cp": total_en_cp,
        },
        "example_selection": ex[0] if ex else None,
        "example_total_cp": ex[1] if ex else None,
        "example_core_cp": ex[2] if ex else None,
        "reachable_en_finfmb": ex is not None,
    })

result = {"meta": pdef["meta"], "profiles": out_profiles}
json.dump(result, open("data/profiles.json", "w"), ensure_ascii=False, indent=1)

print(f"{'profile':34s} {'#elig':>5} {'#core':>5} {'coreCP':>6} {'totCP':>6} {'#subs':>5}  reachable")
for p in out_profiles:
    s = p["stats"]
    print(f"{p['name'][:34]:34s} {s['n_eligible']:5d} {s['n_core_eligible']:5d} {s['core_en_cp']:6d} {s['total_en_cp']:6d} {s['n_substitutes']:5d}  {'YES' if p['reachable_en_finfmb'] else 'NO !!!'}")
print(f"\nprofiles: {len(out_profiles)} | reachable: {sum(p['reachable_en_finfmb'] for p in out_profiles)}")
