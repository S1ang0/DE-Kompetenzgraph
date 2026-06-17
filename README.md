# M.Sc. Digital Engineering — Modul- & Profilierungsgraph

Interaktiver Wissensgraph für das Masterprogramm **Digital Engineering** (gemeinsam getragen von
FIN & FMB): **330 Module** aus den Fakultäten Informatik (FIN), Maschinenbau (FMB) und
Elektro-/Informationstechnik (FEIT), gruppiert in **16 Themencluster**, mit **11 CP-schwellen­basierten
Profilierungen** als auswählbare Overlays.

Aufbauend auf dem B.Sc.-Kompetenzgraphen eines Kollegen (React + Vite + D3); dessen Daten bleiben
im Repo erhalten (`public/competency_tree.json`, `public/career_fields.json`).

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # Produktionsbuild nach dist/  (GitHub Pages)
npm run lint
```

Die App lädt ein einziges Datenbundle: `public/de_dataset.json`.

## Profilierungen

Eine Profilierung („*M.Sc. Digital Engineering mit der Profilierung [Name]*") wird vergeben, wenn
**≥ 30 CP** aus den zugehörigen Themenclustern erbracht werden (**≥ 18 CP** aus dem Kerncluster).
Harte Constraints, maschinell geprüft (`scripts/validate_profiles.py`, **11/11 PASS**):

- **C1** — jede Profilierung ist allein mit **englischsprachigen** Modulen erfüllbar; deutsche Module nur als optionale Substitute.
- **C2** — jede Profilierung ist allein mit Modulen aus **FIN + FMB** erfüllbar; FEIT-Module nur als optionale Substitute.

## Datenpipeline (`scripts/`)

`dump_pdfs` → `scrape_fin` / `parse_fmb` / `parse_etit` → `unify_base` → *LLM-Enrichment* →
`merge_enrich` (**`data/modules.json`** = Quelle der Wahrheit, + CSV) → `build_profiles` →
`validate_profiles` → `build_graph` (**`public/de_dataset.json`**). Integrität: `check_dataset`.

## Dokumentation

- **`REPORT.md`** — Abschlussbericht (Architektur, Statistik, Cluster, Profilierungen, Validierung, Design, offene Fragen).
- **`DECISIONS.md`** — Annahmen/Interpretationen (zur Prüfung markiert).
- **`OPEN_ITEMS.md`** — Lücken/Übersprungenes. · **`PROGRESS.md`** — Verlaufsprotokoll.

## Editor

Header → **Bearbeiten**: Themencluster (umbenennen/Farbe/neu/löschen), Module (Cluster zuweisen/löschen)
und Profilierungen (anlegen/bearbeiten/löschen mit **live** geprüfter C1/C2/CP-Erfüllbarkeit). Änderungen
werden im **Browser (localStorage)** gespeichert; **Export/Import** als JSON und „Auf Original zurücksetzen"
stehen bereit. Edits sind browser-lokal und verändern die Repo-Dateien nicht (für Dauerhaftigkeit: Export →
in die Pipeline einpflegen).
