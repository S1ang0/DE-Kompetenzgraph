#!/usr/bin/env python3
"""Dump full text of every module-handbook PDF to data/raw_text/*.txt (deterministic)."""
import pypdf, os, glob, re

SRC = "modulhandbuecher_modulkataloge"
OUT = "data/raw_text"
os.makedirs(OUT, exist_ok=True)

def slug(name):
    name = os.path.splitext(os.path.basename(name))[0]
    name = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")
    return name

for f in sorted(glob.glob(SRC + "/*.pdf")):
    try:
        r = pypdf.PdfReader(f)
        pages = []
        for i, p in enumerate(r.pages):
            t = p.extract_text() or ""
            pages.append(f"\n<<<PAGE {i+1}>>>\n" + t)
        text = "".join(pages)
        out = os.path.join(OUT, slug(f) + ".txt")
        with open(out, "w") as fh:
            fh.write(text)
        print(f"{os.path.basename(f):72s} pages={len(r.pages):4d} chars={len(text):8d} -> {out}")
    except Exception as e:
        print(f"ERROR {f}: {e}")
