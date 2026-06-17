#!/usr/bin/env python3
"""Derive a module's HOME faculty from its catalog/handbook block text.

The FMB master catalog and the FEIT handbooks both aggregate imported modules from
other faculties. Each block names the responsible lecturer's institute
(e.g. "Responsible lecturer ... (FEIT-IIKT)" or "Modulverantwortlich Prof. X, FIN-IKS")
and/or a trailing faculty-name line (Maschinenbau / Informatik / Mathematik / ...).
"""
import re

_FAC_NAME = [  # search term (lower) -> code; longest/most specific first
    ("elektro- und informationstechnik", "FEIT"), ("verfahrens- und systemtechnik", "FVST"),
    ("wirtschaftswissenschaften", "FWW"), ("wirtschaftswissenschaft", "FWW"),
    ("naturwissenschaften", "FNW"), ("humanwissenschaften", "FHW"),
    ("maschinenbau", "FMB"), ("informatik", "FIN"), ("mathematik", "FMA"),
    ("elektrotechnik", "FEIT"), ("verfahrenstechnik", "FVST"),
]
_PREFIX = [("FIN", "FIN"), ("FMB", "FMB"), ("FEIT", "FEIT"), ("FET", "FEIT"),
           ("FMA", "FMA"), ("MATH", "FMA"), ("FVST", "FVST"),
           ("FNW", "FNW"), ("FHW", "FHW"), ("FWW", "FWW")]

# faculty code -> long name (for UI / reporting)
FACULTY_NAMES = {
    "FIN": "Informatik", "FMB": "Maschinenbau", "FEIT": "Elektro- und Informationstechnik",
    "FMA": "Mathematik", "FVST": "Verfahrens- und Systemtechnik",
    "FNW": "Naturwissenschaften", "FHW": "Humanwissenschaften", "FWW": "Wirtschaftswissenschaft",
}


def _code_from_token(tok):
    tok = tok.upper()
    for pre, code in _PREFIX:
        if tok.startswith(pre):
            return code
    return None


def detect_faculty(text):
    """Return a faculty code, or None if undetectable."""
    if not text:
        return None
    # 1) responsible-lecturer institute token (authoritative): "..., FIN-IKS" / "(FEIT-IIKT)"
    m = re.search(
        r"(?:Modulverantwortlich(?:er)?|Responsible lecturer)[^\n]*?\(?\b"
        r"((?:FIN|FMB|FEIT|FET|FMA|FVST|FNW|FHW|FWW)[A-Z\-]*)", text)
    if m:
        c = _code_from_token(m.group(1))
        if c:
            return c
    # 2) trailing faculty-name line (fallback) — take the LAST occurrence in the block
    low = text.lower()
    best, name = -1, None
    for term, code in _FAC_NAME:
        p = low.rfind(term)
        if p > best:
            best, name = p, code
    return name
