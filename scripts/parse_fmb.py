#!/usr/bin/env python3
"""Parse the FMB master module catalog (data/raw_text/Modulkatalog_FMB...txt) into
raw module records. Output: data/raw_modules_fmb.json"""
import re, json, os

F = "data/raw_text/Modulkatalog_FMB_Masterstudienga_nge.txt"
text = open(F, encoding="utf-8").read()

# strip repeating page furniture
text = re.sub(r"<<<PAGE \d+>>>", "\n", text)
text = re.sub(r"Master-Modulkatalog FMB \([^)]*\) Seite \d+ von \d+ Zur.ck zum Inhaltsverzeichnis", "", text)
text = re.sub(r"FIN\s*\|\s*FHW\s*\|\s*FNW\s*\|\s*FVST\s*\|\s*FMA\s*\|\s*FEIT\s*\|\s*FWW\s*FMB", "", text)

# header line of each module block: "Name des Moduls X Prüfungsnummer" or "Course name X Exam number:"
hdr = re.compile(r"(?:Name des Moduls|Course name)\s+(.+?)\s+(?:Prüfungsnummer|Exam number):?\s*", re.I)
matches = list(hdr.finditer(text))
print(f"module header matches: {len(matches)}")

def lang_normalize(block, title_line):
    m = re.search(r"Lehrformen\s*/\s*Sprache.*?(Deutsch|Englisch|English|German|Deutsch/Englisch|Englisch/Deutsch)\s*\n", block, re.I)
    raw = None
    if m: raw = m.group(1)
    if not raw:
        m = re.search(r"(?:Sprache|Language)\s*[:\n]\s*(Deutsch|Englisch|English|German|Deutsch und Englisch)", block, re.I)
        if m: raw = m.group(1)
    return raw

mods = []
for i, m in enumerate(matches):
    start = m.start()
    end = matches[i+1].start() if i+1 < len(matches) else len(text)
    block = text[start:end].strip()
    header_label = text[m.start():m.start()+15]
    title_a = re.sub(r"\s+", " ", m.group(1)).strip()
    # the "other title" line + exam number
    other = re.search(r"(?:Englischer Titel|German title)\s+(.+?)\s+(\d{5,7})\s*\n", block)
    title_b, exam = None, None
    if other:
        title_b = re.sub(r"\s+", " ", other.group(1)).strip()
        exam = other.group(2)
    if not exam:
        em = re.search(r"\b(\d{6})\b", block[:400])
        exam = em.group(1) if em else None
    # english-doc style?  header used "Course name" => title_a is EN
    english_doc = bool(re.match(r"Course name", text[m.start():m.start()+12], re.I))
    if english_doc:
        title_en, title_de = title_a, title_b
    else:
        title_de, title_en = title_a, title_b
    # CP
    cpm = re.search(r"Leistungspunkte[^\n]*\n?\s*(?:und\s*\n?\s*Noten\s*\n?\s*)?(\d+(?:[.,]\d+)?)\s*(?:CP|LP|ECTS|Credit)", block, re.I)
    if not cpm:
        cpm = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:CP|ECTS|Credit Points)\b", block)
    cp = cpm.group(1).replace(",", ".") if cpm else None
    lang_raw = lang_normalize(block, m.group(0))
    mods.append({
        "source": "Modulkatalog_FMB-Masterstudiengaenge.pdf",
        "faculty": "FMB",
        "exam_number": exam,
        "title_de": title_de,
        "title_en": title_en,
        "cp": cp,
        "language_raw": lang_raw,
        "english_doc_style": english_doc,
        "text": block[:5000],
    })

os.makedirs("data", exist_ok=True)
json.dump(mods, open("data/raw_modules_fmb.json", "w"), ensure_ascii=False, indent=1)

# diagnostics
import collections
print("parsed:", len(mods))
print("missing exam_number:", sum(1 for x in mods if not x["exam_number"]))
print("missing cp:", sum(1 for x in mods if not x["cp"]))
print("missing both titles:", sum(1 for x in mods if not x["title_de"] and not x["title_en"]))
print("language_raw dist:", dict(collections.Counter(x["language_raw"] for x in mods)))
print("cp dist:", dict(collections.Counter(x["cp"] for x in mods)))
print("\nfirst 6:")
for x in mods[:6]:
    print(f"  exam={x['exam_number']} cp={x['cp']} lang={x['language_raw']} | DE='{str(x['title_de'])[:40]}' EN='{str(x['title_en'])[:40]}'")
