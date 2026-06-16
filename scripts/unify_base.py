#!/usr/bin/env python3
"""Unify FIN (web) + FMB + ETIT raw records into one base dataset with stable IDs,
normalized faculty/CP, and robust language detection. Output: data/modules_base.json"""
import re, json, os, collections

def slug(s, maxlen=48):
    s = (s or "").lower()
    s = re.sub(r"[äàáâ]", "a", s); s = re.sub(r"[öòóô]", "o", s); s = re.sub(r"[üùúû]", "u", s)
    s = s.replace("ß", "ss")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen].strip("-")

# ---- language detection ----
DE_WORDS = set("der die das und für wird werden sind nicht eine einen einer ein im in den dem des mit auf zur zum bei aus als auch sowie sich Studierende Studierenden Kenntnisse Fähigkeiten Vorlesung Übung Grundlagen Verfahren Methoden Anwendung über durch zwischen".lower().split())
EN_WORDS = set("the and of to for are will be is in on with as students student knowledge skills lecture exercise methods application introduction able understand basic between through".lower().split())

def detect_lang_from_text(text):
    toks = re.findall(r"[A-Za-zÄÖÜäöüß]+", (text or "").lower())
    if len(toks) < 20:
        return None
    de = sum(1 for t in toks if t in DE_WORDS)
    en = sum(1 for t in toks if t in EN_WORDS)
    if de == 0 and en == 0:
        return None
    if en > de * 1.4:
        return "en"
    if de > en * 1.4:
        return "de"
    return "both"

def norm_lang(raw, text, hint=None):
    r = (raw or "").lower()
    has_de = any(k in r for k in ["deutsch", "german"])
    has_en = any(k in r for k in ["englisch", "english"])
    if has_de and has_en:
        return "both"
    if has_en and not has_de:
        return "en"
    if has_de and not has_en:
        return "de"
    # fall back to content detection
    d = detect_lang_from_text(text)
    if d:
        return d
    if hint:
        return hint
    return None

def num_cp(cp):
    if cp is None:
        return None
    try:
        v = float(str(cp).replace(",", "."))
        return int(v) if v == int(v) else v
    except Exception:
        return None

modules = []
seen_titlekeys = {}

# ---------- FIN ----------
fin = json.load(open("data/raw_web/fin_pages.json"))
finmods = [m for m in fin if m["is_module"]]
by = {}
for m in finmods:
    k = m["module_id"]
    if not k:
        continue
    if k not in by or len(m["text"]) > len(by[k]["text"]):
        by[k] = m
for m in by.values():
    title = (m["title"] or "").strip()
    lang_raw = (m["language"] or "")
    lang = norm_lang(lang_raw, m["text"])
    modules.append({
        "id": "fin-" + (m["module_id"].split("-")[-1] if m["module_id"] else slug(title)),
        "title_en": title, "title_de": None,
        "language": lang or "en",
        "faculty": "FIN",
        "cp": num_cp(m["cp"]),
        "level": "Master",
        "module_code": m["module_id"],
        "source": "FIN BookStack (bookstack.cs.ovgu.de)",
        "source_url": m["url"],
        "competencies": [], "prerequisites": [], "topic_tags": [],
        "primary_cluster": None, "secondary_clusters": [], "notes": "",
        "_text": (m["text"] or "")[:4000],
    })

# ---------- FMB ----------
fmb = json.load(open("data/raw_modules_fmb.json"))
for m in fmb:
    title_en = (m.get("title_en") or "").strip().rstrip(":")
    title_de = (m.get("title_de") or "").strip().rstrip(":")
    title_en = re.sub(r"\s*(Exam number|Pr.fungsnummer)\s*$", "", title_en).strip()
    title_de = re.sub(r"\s*(Exam number|Pr.fungsnummer)\s*$", "", title_de).strip()
    hint = "en" if m.get("english_doc_style") else "de"
    lang = norm_lang(m.get("language_raw"), m.get("text"), hint=hint)
    ex = m.get("exam_number")
    modules.append({
        "id": "fmb-" + (ex if ex else slug(title_de or title_en)),
        "title_en": title_en or None, "title_de": title_de or None,
        "language": lang or "de",
        "faculty": "FMB",
        "cp": num_cp(m["cp"]),
        "level": "Master",
        "module_code": ex,
        "source": "Modulkatalog FMB-Masterstudiengänge (PDF)",
        "source_url": None,
        "competencies": [], "prerequisites": [], "topic_tags": [],
        "primary_cluster": None, "secondary_clusters": [], "notes": "",
        "_text": (m.get("text") or "")[:4000],
    })

# ---------- ETIT ----------
etit = json.load(open("data/raw_modules_etit.json"))
for m in etit:
    title_en = (m.get("title_en") or "").strip()
    title_de = (m.get("title_de") or "").strip()
    lang = norm_lang(m.get("language_raw"), m.get("text"))
    modules.append({
        "id": "etit-" + slug(title_en or title_de),
        "title_en": title_en or None, "title_de": title_de or None,
        "language": lang or "de",
        "faculty": "ETIT",
        "cp": num_cp(m["cp"]),
        "level": "Master",
        "module_code": None,
        "source": "Modulhandbuch " + m.get("program", "ETIT") + " (PDF)",
        "source_url": None,
        "competencies": [], "prerequisites": [], "topic_tags": [],
        "primary_cluster": None, "secondary_clusters": [], "notes": "",
        "_text": (m.get("text") or "")[:4000],
    })

# ---- CP sanitization ----
# FMB catalog modules are standardized at 5 CP (a few at 10). Parse artefacts (90,120,0,
# program totals leaking from "Modulverwendbarkeit") get clamped. "Projekt N CP" titles
# carry their CP in the name.
for m in modules:
    t = (m["title_de"] or m["title_en"] or "")
    pm = re.search(r"Projekt\s+(\d+)\s*CP", t)
    if pm:
        m["cp"] = int(pm.group(1))
        m["title_de"] = "Projektmodul (FMB)"
        m["title_en"] = m["title_en"] or "Project module (FMB)"
        m["notes"] = (m["notes"] + " CP aus Titel abgeleitet.").strip()
    if m["faculty"] == "FMB":
        if m["cp"] is None or not (3 <= (m["cp"] or 0) <= 15):
            m["notes"] = (m["notes"] + f" CP-Originalwert '{m['cp']}' unplausibel→5 (FMB-Standard).").strip()
            m["cp"] = 5

# ---- de-dup ids ----
seen = collections.Counter()
for m in modules:
    base = m["id"]
    seen[base] += 1
    if seen[base] > 1:
        m["id"] = f"{base}-{seen[base]}"

# ---- cross-faculty duplicate title check (log only) ----
titlekey = collections.defaultdict(list)
for m in modules:
    k = slug(m["title_en"] or "") or slug(m["title_de"] or "")
    if k:
        titlekey[k].append(m["faculty"])
dups = {k: v for k, v in titlekey.items() if len(set(v)) > 1}

os.makedirs("data", exist_ok=True)
json.dump(modules, open("data/modules_base.json", "w"), ensure_ascii=False, indent=1)

# ---- report ----
fac = collections.Counter(m["faculty"] for m in modules)
lang = collections.Counter(m["language"] for m in modules)
print("TOTAL modules:", len(modules))
print("by faculty:", dict(fac))
print("by language:", dict(lang))
print("missing cp:", sum(1 for m in modules if m["cp"] is None))
print("missing title (both):", sum(1 for m in modules if not m["title_en"] and not m["title_de"]))
print("\nEnglish modules by faculty:")
for f in ("FIN", "FMB", "ETIT"):
    n = sum(1 for m in modules if m["faculty"] == f and m["language"] in ("en", "both"))
    print(f"   {f}: {n} EN/both  of {fac[f]}")
print("\ncross-faculty same-title (info):", len(dups))
