#!/usr/bin/env python3
"""Parse the 5 ETIT handbooks into raw module records (substitutes-only pool).
Output: data/raw_modules_etit.json  (deduped across files by normalized English/German title)."""
import re, json, os, glob, collections, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from faculty import detect_faculty

FILES = {
    "Module_Descriptions_M_Sc_Electrical_Engineering_and_Information_Technology_from_March_04_2026.txt": "M.Sc. Electrical Engineering and IT (EN)",
    "Modulhandbuch_M_Sc_Elektro_und_Informationstechnik_vom_04_03_2026.txt": "M.Sc. Elektro- und Informationstechnik",
    "Modulhandbuch_M_Sc_Mechatronik_vom_04_03_2026.txt": "M.Sc. Mechatronik",
    "Modulhandbuch_M_Sc_Systemtechnik_und_Technische_Kybernetik_vom_04_03_2026.txt": "M.Sc. Systemtechnik und Technische Kybernetik",
    "Modulhandbuch_M_Sc_Wirtschaftsingenieurwesen_fu_r_Elektro_und_Informationstechnik_vom_25_06_2025.txt": "M.Sc. Wirtschaftsingenieurwesen EIT",
}
RT = "data/raw_text"

def clean_furniture(t):
    t = re.sub(r"<<<PAGE \d+>>>", "\n", t)
    t = re.sub(r"Modulhandbuch[^\n]*Seite \d+[^\n]*\n", "\n", t)
    t = re.sub(r"Module Descriptions[^\n]*\n", "\n", t)
    return t

def field(pat, block, flags=re.I):
    m = re.search(pat, block, flags)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None

def cp_of(block):
    m = re.search(r"(?:Leistungspunkte|Credit\s*[Pp]oints?|ECTS)\D{0,40}?(\d+(?:[.,]\d+)?)", block)
    if not m:
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:CP|LP|ECTS|Credit)\b", block)
    return m.group(1).replace(",", ".") if m else None

def lang_of(block):
    m = re.search(r"(?:Sprache|Language)\s*[:\n]?\s*(Deutsch|Englisch|English|German|Deutsch/Englisch|Englisch/Deutsch|englisch|deutsch|English/German|German/English)", block)
    return m.group(1) if m else None

def parse_file(fname, prog):
    t = clean_furniture(open(os.path.join(RT, fname), encoding="utf-8").read())
    mods = []
    if t.count("Name des Moduls") > 15:
        # Systemtechnik / FMB-style
        anchors = list(re.finditer(r"Name des Moduls\s+(.+?)(?:\s+Pr.fungsnummer|\n)", t))
        for i, a in enumerate(anchors):
            blk = t[a.start(): anchors[i+1].start() if i+1 < len(anchors) else len(t)]
            title_de = re.sub(r"\s+", " ", a.group(1)).strip()
            title_en = field(r"(?:Englischer Titel|English title)\s+(.+?)\n", blk)
            mods.append((title_de, title_en, blk))
    else:
        en_doc = t.count("English title") > t.count("Englischer Titel")
        label = "English title" if en_doc else "Englischer Titel"
        anchors = list(re.finditer(re.escape(label) + r"\s+(.+?)\n", t))
        for i, a in enumerate(anchors):
            start = a.start()
            end = anchors[i+1].start() if i+1 < len(anchors) else len(t)
            # module name = nearest preceding numbered header without dot-leaders
            pre = t[max(0, start-400):start]
            hdrs = re.findall(r"(?m)^\d+(?:\.\d+)+\s+([^\n.]+?)\s*$", pre)
            name = hdrs[-1].strip() if hdrs else None
            blk = t[start:end]
            eng = re.sub(r"\s+", " ", a.group(1)).strip()
            if en_doc:
                title_en, title_de = (eng, name)
            else:
                title_en, title_de = (eng, name)  # 'name' is the German section header
                if not title_de: title_de = name
            mods.append((title_de, title_en, blk))
    out = []
    for title_de, title_en, blk in mods:
        if not (title_de or title_en):
            continue
        out.append({
            "source": fname.replace(".txt", ".pdf"),
            "program": prog, "faculty": detect_faculty(blk) or "FEIT",
            "title_de": title_de, "title_en": title_en,
            "cp": cp_of(blk), "language_raw": lang_of(blk),
            "text": blk[:4500],
        })
    return out

allmods = []
for f, prog in FILES.items():
    ms = parse_file(f, prog)
    print(f"{prog:48s} -> {len(ms)} modules")
    allmods += ms

# dedup by normalized english-or-german title; keep richest text
def norm(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower())
by = {}
for m in allmods:
    key = norm(m["title_en"]) or norm(m["title_de"])
    if not key: continue
    if key not in by or len(m["text"]) > len(by[key]["text"]):
        # merge: keep cp/lang if present
        if key in by:
            for fld in ("cp", "language_raw", "title_en", "title_de"):
                if not m.get(fld) and by[key].get(fld): m[fld] = by[key][fld]
        by[key] = m
deduped = list(by.values())
os.makedirs("data", exist_ok=True)
json.dump(deduped, open("data/raw_modules_etit.json", "w"), ensure_ascii=False, indent=1)
print(f"\nETIT raw total: {len(allmods)}  | deduped: {len(deduped)}")
print("missing cp:", sum(1 for x in deduped if not x["cp"]), "| missing lang:", sum(1 for x in deduped if not x["language_raw"]))
print("lang dist:", dict(collections.Counter((x["language_raw"] or "?") for x in deduped)))
print("\nsample:")
for x in deduped[:10]:
    print(f"  cp={str(x['cp']):4s} {str(x['language_raw'])[:8]:8s} | EN='{str(x['title_en'])[:38]}' DE='{str(x['title_de'])[:34]}'")
