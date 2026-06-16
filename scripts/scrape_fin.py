#!/usr/bin/env python3
"""Scrape FIN (Fakultaet fuer Informatik) module pages from the 6 public BookStack books.
Output: data/raw_web/fin_pages.json  (list of parsed module dicts incl. full cleaned text).
Dedup happens later (by Module-ID) in the standardization step.
"""
import urllib.request, re, html, json, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://bookstack.cs.ovgu.de"
BOOKS = [
    "msc-digital-engineering-ab-sommer-2026",
    "msc-informatik-ab-sommer-2026-QKE",
    "msc-data-and-knowledge-engineering-ab-sommer-2026-U5t",
    "msc-ingenieurinformatik-ab-sommer-2026-r3L",
    "msc-visual-computing-from-summer-2026-wct",
    "msc-wirtschaftsinformatik-ab-sommer-2026-s2V",
]
# slugs that are NOT modules
EXCLUDE = re.compile(
    r"(academic-club|awareness|fachschaftsrat|^feedback$|/feedback$|credits|herzlich-willkommen|"
    r"hinweise|orientierung|uber-den|ueber-den|weitere-hinweise|modulnachricht|generativer-ki|"
    r"regelung|neuigkeit|studienverlauf|regelstudienplan|willkommen)", re.I)

UA = {"User-Agent": "Mozilla/5.0 (module-catalog-research)"}

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")

def clean(segment):
    txt = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", segment, flags=re.S | re.I)
    txt = re.sub(r"<[^>]+>", "\n", txt)
    txt = html.unescape(txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n[ \t]+", "\n", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip()

def get_page_links(book):
    url = f"{BASE}/books/{book}"
    h = fetch(url)
    links = set(re.findall(rf'href="({BASE}/books/{book}/page/[^"#?]+)"', h))
    return sorted(l for l in links if not EXCLUDE.search(l))

def field(pattern, text, flags=re.I):
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else None

def parse_page(url, book):
    h = fetch(url)
    m = re.search(r'<div class="page-content[^"]*"[^>]*>(.*?)</div>\s*(?:<div class="(?:comments|page-tags|tags|entity-meta))', h, re.S)
    if not m:
        m = re.search(r'<main[^>]*class="content-wrap[^"]*"[^>]*>(.*?)</main>', h, re.S)
    body = clean(m.group(1)) if m else clean(h)
    # title from <h1> in content
    title = field(r"<h1[^>]*>(.*?)</h1>", h, re.S | re.I)
    if title:
        title = clean(title)
    module_id = field(r"Module?[ \-]?ID\s*:?\s*([A-Za-z0-9._/-]+)", body)
    cp = field(r"(?:Credit Points|Leistungspunkte)\s*[:\n]?\s*([0-9]+(?:[.,][0-9]+)?)", body)
    language = field(r"(?:Language|Sprache)\s*[:\n]?\s*([A-Za-zöäüÖÄÜ/ ,()-]+)", body)
    level = field(r"(?:Level|Niveau)\s*[:\n]?\s*([A-Za-z]+)", body)
    abbrev = field(r"(?:Abbreviation|Kürzel|Kuerzel)\s*[:\n]?\s*([A-Za-z0-9 /._-]+)", body)
    applic = field(r"(?:Applicability in curriculum|Verwendbarkeit)\s*:?(.*?)(?:Abbreviation|Kürzel|Credit Points|Leistungspunkte)", body, re.I | re.S)
    is_module = bool(module_id or cp)
    return {
        "url": url, "book": book, "title": title, "module_id": module_id,
        "cp": cp, "language": language, "level": level, "abbrev": abbrev,
        "applicability": (re.sub(r"\s+", " ", applic).strip()[:600] if applic else None),
        "is_module": is_module, "text": body[:6000],
    }

def main():
    all_links = []
    for b in BOOKS:
        try:
            ls = get_page_links(b)
            print(f"book {b}: {len(ls)} candidate pages", file=sys.stderr)
            for l in ls:
                all_links.append((l, b))
        except Exception as e:
            print(f"BOOK FAIL {b}: {e}", file=sys.stderr)
    print(f"total candidate pages: {len(all_links)}", file=sys.stderr)

    results, failed = [], []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(parse_page, url, book): (url, book) for url, book in all_links}
        for fut in as_completed(futs):
            url, book = futs[fut]
            try:
                results.append(fut.result())
            except Exception as e:
                failed.append({"url": url, "book": book, "error": str(e)})

    modules = [r for r in results if r["is_module"]]
    nonmod = [r for r in results if not r["is_module"]]
    os.makedirs("data/raw_web", exist_ok=True)
    json.dump(results, open("data/raw_web/fin_pages.json", "w"), ensure_ascii=False, indent=1)
    json.dump(failed, open("data/raw_web/fin_failed.json", "w"), ensure_ascii=False, indent=1)
    print(f"\nfetched={len(results)}  modules={len(modules)}  non-module={len(nonmod)}  failed={len(failed)}")
    # unique module ids
    ids = {}
    for m in modules:
        ids.setdefault(m["module_id"] or m["title"], 0)
        ids[m["module_id"] or m["title"]] += 1
    print(f"unique module-id/title keys: {len(ids)}")

if __name__ == "__main__":
    main()
