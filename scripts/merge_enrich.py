#!/usr/bin/env python3
"""Merge enrichment batches into the base dataset -> data/modules.json (source of truth)
   + data/modules.csv. Validates clusters, reports stats."""
import json, glob, csv, collections, sys, os

base = {m["id"]: m for m in json.load(open("data/modules_base.json"))}
clusters = json.load(open("data/clusters.json"))
VALID = {c["key"] for c in clusters["clusters"]}

enr = {}
for f in sorted(glob.glob("data/enrich/out_batch_*.json")):
    for r in json.load(open(f)):
        enr[r["id"]] = r

missing = [mid for mid in base if mid not in enr]
extra = [rid for rid in enr if rid not in base]
print("base:", len(base), "| enriched:", len(enr), "| missing enrichment:", len(missing), "| extra:", len(extra))
if missing:
    print("  MISSING:", missing[:20])

problems = []
modules = []
for mid, m in base.items():
    e = enr.get(mid)
    rec = {k: v for k, v in m.items() if k != "_text"}
    if not e:
        problems.append((mid, "no enrichment"))
        rec["primary_cluster"] = rec.get("primary_cluster") or "methods_skills"
        modules.append(rec)
        continue
    pc = e.get("primary_cluster")
    if pc not in VALID:
        problems.append((mid, f"bad primary_cluster {pc}"))
        pc = "methods_skills"
    sc = [c for c in (e.get("secondary_clusters") or []) if c in VALID and c != pc]
    rec["primary_cluster"] = pc
    rec["secondary_clusters"] = sc[:2]
    rec["competencies"] = e.get("competencies") or []
    rec["topic_tags"] = e.get("topic_tags") or []
    rec["level_band"] = e.get("level") or "core"
    rec["kind"] = e.get("kind") or "course"
    if e.get("language") in ("en", "de", "both"):
        rec["language"] = e["language"]
    rec["description_en"] = e.get("description_en") or ""
    modules.append(rec)

# stable order: faculty then title
modules.sort(key=lambda r: (r["faculty"], (r["title_en"] or r["title_de"] or "").lower()))

json.dump(modules, open("data/modules.json", "w"), ensure_ascii=False, indent=1)

# CSV
cols = ["id","title_en","title_de","language","faculty","cp","level","level_band","kind",
        "primary_cluster","secondary_clusters","topic_tags","competencies","module_code","source","source_url","description_en","notes"]
with open("data/modules.csv","w",newline="") as fh:
    w = csv.writer(fh)
    w.writerow(cols)
    for m in modules:
        row=[]
        for c in cols:
            v=m.get(c,"")
            if isinstance(v,list): v="; ".join(map(str,v))
            row.append(v if v is not None else "")
        w.writerow(row)

# ---- report ----
print("\nproblems:", len(problems))
for p in problems[:20]: print("  ", p)

fac=collections.Counter(m["faculty"] for m in modules)
lang=collections.Counter(m["language"] for m in modules)
kind=collections.Counter(m["kind"] for m in modules)
print("\nfaculty:", dict(fac))
print("language (post-enrich):", dict(lang))
print("kind:", dict(kind))

print("\n--- cluster counts (total | EN FIN+FMB courses) ---")
name={c["key"]:c["name"] for c in clusters["clusters"]}
tot=collections.Counter(m["primary_cluster"] for m in modules)
def is_en_finfmb_course(m):
    return m["faculty"] in ("FIN","FMB") and m["language"] in ("en","both") and m["kind"] in ("course","lab","project","seminar")
enfin=collections.Counter(m["primary_cluster"] for m in modules if is_en_finfmb_course(m))
for c in clusters["clusters"]:
    k=c["key"]
    print(f"  {k:16s} {name[k][:38]:38s} total={tot[k]:3d}  EN_FINFMB={enfin[k]:3d}")
print("\nTOTAL modules:", len(modules))
print("EN FIN+FMB course-like modules:", sum(1 for m in modules if is_en_finfmb_course(m)))
