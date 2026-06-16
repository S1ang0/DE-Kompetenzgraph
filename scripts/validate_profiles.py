#!/usr/bin/env python3
"""Independent constraint validation for all profilings.
Checks, from scratch against data/modules.json:
  C1  every module in the REQUIRED (eligible) pool is English (en/both)   -> no German module is necessary
  C2  every module in the REQUIRED pool is FIN or FMB                      -> no ETIT module is necessary
  CP  a valid English FIN+FMB selection reaches threshold_cp with >= core_min_cp from the core cluster(s)
  SUB substitutes are optional only (each substitute is German FIN/FMB or ETIT, never an en-FIN/FMB module)
Exit code 0 iff all profiles pass C1 & C2 & CP.
"""
import json, sys

mods = json.load(open("data/modules.json"))
prof = json.load(open("data/profiles.json"))
M = {m["id"]: m for m in mods}

def core_keys(p): return set(p["core_clusters"])

allpass = True
lines = []
lines.append("=" * 78)
lines.append("CONSTRAINT VALIDATION — M.Sc. Digital Engineering profilings")
lines.append(f"threshold_cp = {prof['meta']['threshold_cp']}   core_min_cp = {prof['meta']['core_min_cp']}")
lines.append("=" * 78)

for p in prof["profiles"]:
    name = p["name"]
    elig = [M[i] for i in p["eligible_pool"]]
    core = core_keys(p)

    # C1 language
    c1_viol = [m["id"] for m in elig if m["language"] not in ("en", "both")]
    c1 = not c1_viol
    # C2 faculty
    c2_viol = [m["id"] for m in elig if m["faculty"] not in ("FIN", "FMB")]
    c2 = not c2_viol

    # CP reachability (independent recompute, greedy)
    THRESH = p["threshold_cp"]; CORE_MIN = p["core_min_cp"]
    core_pool = sorted([m for m in elig if m["primary_cluster"] in core], key=lambda x: -(x["cp"] or 0))
    chosen, core_sum, total = [], 0, 0
    for m in core_pool:
        if core_sum >= CORE_MIN: break
        chosen.append(m["id"]); core_sum += m["cp"] or 0; total += m["cp"] or 0
    rest = sorted([m for m in elig if m["id"] not in chosen], key=lambda x: -(x["cp"] or 0))
    for m in rest:
        if total >= THRESH: break
        chosen.append(m["id"]); total += m["cp"] or 0
    cp_ok = (core_sum >= CORE_MIN) and (total >= THRESH)

    # SUB: substitutes never include an en-FIN/FMB module
    sub_viol = [i for i in p["substitutes"]
                if M[i]["faculty"] in ("FIN", "FMB") and M[i]["language"] in ("en", "both")]
    sub_ok = not sub_viol

    ok = c1 and c2 and cp_ok
    allpass = allpass and ok
    status = "PASS" if ok else "FAIL"
    lines.append(f"\n[{status}] {name}")
    lines.append(f"    core={p['core_clusters']}  allied={p['allied_clusters']}")
    lines.append(f"    C1 English-only required pool : {'OK' if c1 else 'VIOLATION '+str(c1_viol[:5])}  ({len(elig)} modules)")
    lines.append(f"    C2 FIN+FMB-only required pool : {'OK' if c2 else 'VIOLATION '+str(c2_viol[:5])}")
    lines.append(f"    CP reachable (EN FIN+FMB)     : {'OK' if cp_ok else 'NOT REACHABLE'}  -> example {total} CP total, {core_sum} CP core ({len(chosen)} modules)")
    lines.append(f"    SUB optional-only             : {'OK' if sub_ok else 'VIOLATION '+str(sub_viol[:5])}  ({len(p['substitutes'])} substitutes)")

lines.append("\n" + "=" * 78)
lines.append(f"RESULT: {sum(1 for p in prof['profiles'])} profiles checked — "
             f"{'ALL PASS ✓' if allpass else 'SOME FAILED ✗'}")
lines.append("=" * 78)
report = "\n".join(lines)
print(report)
open("data/validation_report.txt", "w").write(report + "\n")
sys.exit(0 if allpass else 1)
