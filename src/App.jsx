import { useState, useEffect, useMemo, useCallback } from "react";
import ForceGraph from "./ForceGraph.jsx";

/* ───────────────────────── icons (single consistent line set) ───────────── */
const I = {
  search: <svg className="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  close: <svg className="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  layers: <svg className="icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
  reset: <svg className="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>,
  filter: <svg className="icon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>,
  check: <svg className="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>,
  ext: <svg className="icon" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>,
};

const LANG_LABEL = { en: "Englisch", de: "Deutsch", both: "Zweisprachig" };
const KIND_LABEL = { course: "Vorlesung", seminar: "Seminar", project: "Projekt", lab: "Labor", thesis: "Abschlussarbeit", skills: "Schlüsselkompetenz" };
const LEVEL_LABEL = { introductory: "Einführung", core: "Kern", advanced: "Vertiefung" };

export default function App() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filters, setFilters] = useState({ faculties: new Set(), languages: new Set(), clusters: new Set(), q: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showHulls, setShowHulls] = useState(true);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}de_dataset.json`)
      .then((r) => r.json()).then(setData).catch((e) => setErr(String(e)));
  }, []);

  const byId = useMemo(() => {
    const m = new Map();
    data?.modules.forEach((x) => m.set(x.id, x));
    return m;
  }, [data]);
  const clusterById = useMemo(() => {
    const m = new Map();
    data?.clusters.forEach((c) => m.set(c.key, c));
    return m;
  }, [data]);

  const activeProfile = useMemo(
    () => data?.profiles.find((p) => p.id === profileId) || null,
    [data, profileId]
  );
  const selected = selectedId ? byId.get(selectedId) : null;

  // keyboard: Esc closes things
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (dialogOpen) setDialogOpen(false);
      else if (selectedId) setSelectedId(null);
      else if (railOpen) setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, selectedId, railOpen]);

  const toggleSet = useCallback((key, val) => {
    setFilters((f) => {
      const s = new Set(f[key]);
      s.has(val) ? s.delete(val) : s.add(val);
      return { ...f, [key]: s };
    });
  }, []);
  const anyFilter = filters.faculties.size || filters.languages.size || filters.clusters.size || filters.q || profileId;
  const resetAll = () => {
    setFilters({ faculties: new Set(), languages: new Set(), clusters: new Set(), q: "" });
    setProfileId(null); setSelectedId(null);
  };

  if (err) return <div style={{ padding: 40 }}>Daten konnten nicht geladen werden: {err}</div>;
  if (!data) return <div style={{ padding: 40, color: "var(--ink-3)" }}>Lädt Modul- & Profilierungsgraph …</div>;

  const m = data.meta;

  return (
    <div className="app">
      <header className="app__head">
        <div className="head">
          <button className="btn btn--ghost rail-toggle" onClick={() => setRailOpen((v) => !v)} aria-label="Filter ein-/ausblenden">{I.filter}</button>
          <div className="head__brand">
            <h1 className="head__title">M.Sc. Digital Engineering</h1>
            <span className="head__sub">Modul- &amp; Profilierungsgraph · FIN · FMB · ETIT</span>
          </div>
          <div className="head__spacer" />
          <div className="head__stats" aria-hidden="true">
            <div className="head__stat"><b className="num">{m.n_modules}</b><span>Module</span></div>
            <div className="head__stat"><b className="num">{m.n_clusters}</b><span>Cluster</span></div>
            <div className="head__stat"><b className="num">{m.n_profiles}</b><span>Profile</span></div>
          </div>
          <button className="btn btn--primary" onClick={() => setDialogOpen(true)}>
            {I.layers}<span>Profilierung</span>
          </button>
          {anyFilter ? <button className="btn" onClick={resetAll}>{I.reset}<span>Zurücksetzen</span></button> : null}
        </div>
      </header>

      <aside className="app__rail" data-open={railOpen}>
        <Rail
          data={data} filters={filters} setFilters={setFilters} toggleSet={toggleSet}
          showLabels={showLabels} setShowLabels={setShowLabels}
          showHulls={showHulls} setShowHulls={setShowHulls}
        />
      </aside>

      <main className="app__main">
        <ForceGraph
          dataset={data} filters={filters}
          selectedId={selectedId} onSelect={setSelectedId}
          activeProfile={activeProfile}
          showLabels={showLabels} showHulls={showHulls}
        />

        {activeProfile && (
          <ProfileBanner profile={activeProfile} onClear={() => setProfileId(null)} onDetails={() => setDialogOpen(true)} />
        )}

        <div className="canvas__hint" aria-hidden="true">
          <span>Knoten = Modul · Fläche = Themencluster</span>
          <span>·</span>
          <span>Klick für Details · <span className="kbd">Esc</span> schließt</span>
        </div>

        <DetailPanel module={selected} clusterById={clusterById} onClose={() => setSelectedId(null)} activeProfile={activeProfile} />
      </main>

      {dialogOpen && (
        <ProfileDialog
          data={data} profileId={profileId} clusterById={clusterById}
          onPick={(id) => { setProfileId(id); setDialogOpen(false); setSelectedId(null); }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

/* ───────────────────────────────── Rail ──────────────────────────────────── */
function Rail({ data, filters, setFilters, toggleSet, showLabels, setShowLabels, showHulls, setShowHulls }) {
  const clusterCounts = useMemo(() => {
    const c = {};
    data.modules.forEach((x) => (c[x.cluster] = (c[x.cluster] || 0) + 1));
    return c;
  }, [data]);

  return (
    <div className="rail__scroll">
      <div className="rail__section">
        <div className="field">
          {I.search}
          <input className="input" placeholder="Module, Tags suchen …" value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value.toLowerCase() }))}
            aria-label="Module suchen" />
        </div>
      </div>

      <div className="rail__section">
        <div className="rail__head"><span className="eyebrow">Fakultät</span></div>
        <div className="seg" role="group" aria-label="Fakultät filtern">
          {["FIN", "FMB", "ETIT"].map((f) => (
            <button key={f} aria-pressed={filters.faculties.has(f)} onClick={() => toggleSet("faculties", f)}>{f}</button>
          ))}
        </div>
        <div style={{ height: 12 }} />
        <div className="rail__head"><span className="eyebrow">Sprache</span></div>
        <div className="seg" role="group" aria-label="Sprache filtern">
          {[["en", "Englisch"], ["de", "Deutsch"]].map(([k, l]) => (
            <button key={k} aria-pressed={filters.languages.has(k)} onClick={() => toggleSet("languages", k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="rail__section">
        <div className="rail__head">
          <span className="eyebrow">Themencluster</span>
          {filters.clusters.size ? (
            <button className="btn btn--ghost btn--sm" onClick={() => setFilters((f) => ({ ...f, clusters: new Set() }))}>Alle</button>
          ) : null}
        </div>
        <div className="rail__list">
          {data.clusters.map((c) => {
            const on = filters.clusters.has(c.key);
            const dim = filters.clusters.size > 0 && !on;
            return (
              <button key={c.key} className="clrow" aria-pressed={on} data-dim={dim}
                onClick={() => toggleSet("clusters", c.key)} title={c.description}>
                <span className="swatch" style={{ background: c.color }} />
                <span>{c.name}</span>
                <span className="clrow__count">{clusterCounts[c.key] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rail__section">
        <div className="rail__head"><span className="eyebrow">Darstellung</span></div>
        <label className="row gap2" style={{ fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          <input type="checkbox" checked={showHulls} onChange={(e) => setShowHulls(e.target.checked)} />
          Clusterflächen
        </label>
        <label className="row gap2" style={{ fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          Modulbeschriftungen
        </label>
      </div>

      <div className="rail__section" style={{ borderBottom: "none" }}>
        <div className="rail__head"><span className="eyebrow">Legende</span></div>
        <div className="legend">
          <span className="legend__item"><span className="swatch" style={{ borderRadius: "50%", border: "1.5px solid var(--fin)", background: "transparent" }} />FIN</span>
          <span className="legend__item"><span className="swatch" style={{ borderRadius: "50%", border: "1.5px solid var(--fmb)", background: "transparent" }} />FMB</span>
          <span className="legend__item"><span className="swatch" style={{ borderRadius: "50%", border: "1.5px solid var(--etit)", background: "transparent" }} />ETIT</span>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
          Knotengröße ∝ Creditpoints. Bei aktiver Profilierung erscheinen anrechenbare englische
          FIN+FMB-Module farbig, Substitute (deutsch/ETIT) hohl-gestrichelt.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Module detail panel ─────────────────────────── */
function DetailPanel({ module, clusterById, onClose, activeProfile }) {
  const c = module ? clusterById.get(module.cluster) : null;
  let profStatus = null;
  if (module && activeProfile) {
    if (activeProfile.core_eligible_pool.includes(module.id)) profStatus = { t: "Kernmodul dieser Profilierung", k: "core" };
    else if (activeProfile.eligible_pool.includes(module.id)) profStatus = { t: "Anrechenbar (englisch, FIN+FMB)", k: "elig" };
    else if (activeProfile.substitutes.includes(module.id)) profStatus = { t: "Optionales Substitut (deutsch/ETIT)", k: "sub" };
    else profStatus = { t: "Nicht Teil dieser Profilierung", k: "out" };
  }
  return (
    <div className="detail" data-open={!!module} aria-hidden={!module}>
      {module && (
        <>
          <div className="detail__head">
            <button className="btn btn--ghost detail__close" onClick={onClose} aria-label="Detailpanel schließen">{I.close}</button>
            <div className="row gap2">
              <span className="swatch" style={{ background: c?.color }} />
              <span className="eyebrow">{c?.name}</span>
            </div>
            <h2 className="detail__title">{module.label}</h2>
            {module.title_de && module.title_de !== module.label && (
              <div className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 6 }}>{module.title_de}</div>
            )}
            <div className="detail__row">
              <span className={`badge badge--${module.faculty.toLowerCase()}`}>{module.faculty}</span>
              <span className={`badge badge--${module.language === "de" ? "de" : "en"}`}>{LANG_LABEL[module.language]}</span>
              <span className="badge">{module.cp} CP</span>
              <span className="badge">{LEVEL_LABEL[module.level_band] || module.level_band}</span>
              {module.kind !== "course" && <span className="badge">{KIND_LABEL[module.kind] || module.kind}</span>}
            </div>
          </div>

          <div className="detail__scroll">
            {profStatus && (
              <div className="card" style={{ padding: "10px 12px", marginBottom: 16, borderColor: profStatus.k === "out" ? "var(--line)" : "var(--accent)" }}>
                <div className="row gap2" style={{ fontSize: 12.5, fontWeight: 550 }}>
                  {profStatus.k !== "out" && <span style={{ color: "var(--accent)" }}>{I.check}</span>}
                  {profStatus.t}
                </div>
              </div>
            )}

            {module.description_en && <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{module.description_en}</p>}

            {module.competencies?.length > 0 && (
              <>
                <div className="section-title">Kompetenzen</div>
                <ul className="bullets">{module.competencies.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </>
            )}

            {module.topic_tags?.length > 0 && (
              <>
                <div className="section-title">Themen-Tags</div>
                <div className="taglist">{module.topic_tags.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div>
              </>
            )}

            <div className="section-title">Metadaten</div>
            <dl className="kv">
              <dt>Fakultät</dt><dd>{module.faculty}</dd>
              <dt>Sprache</dt><dd>{LANG_LABEL[module.language]}</dd>
              <dt>Creditpoints</dt><dd>{module.cp} CP</dd>
              {module.module_code && (<><dt>Modulcode</dt><dd className="mono">{module.module_code}</dd></>)}
              <dt>Quelle</dt><dd style={{ fontSize: 12 }}>{module.source}</dd>
            </dl>

            {module.source_url && (
              <a className="btn btn--sm" href={module.source_url} target="_blank" rel="noreferrer">
                {I.ext}<span>Modulseite öffnen</span>
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Profile banner ────────────────────────────── */
function ProfileBanner({ profile, onClear, onDetails }) {
  return (
    <div className="pbanner" role="status">
      <span className="eyebrow">Profilierung</span>
      <span className="pbanner__name">{profile.name}</span>
      <span className="pbanner__sep" />
      <span className="pbanner__rule">≥ {profile.threshold_cp} CP · ≥ {profile.core_min_cp} aus Kern · {profile.stats.n_eligible} anrechenbare EN-Module</span>
      <span className="pbanner__rule row gap2" style={{ color: "var(--accent)", fontWeight: 600 }}>{I.check} erfüllbar</span>
      <button className="btn btn--ghost btn--sm" onClick={onDetails}>Ändern</button>
      <button className="btn btn--ghost btn--sm" onClick={onClear} aria-label="Profilierung entfernen">{I.close}</button>
    </div>
  );
}

/* ───────────────────────────── Profile dialog ────────────────────────────── */
function ProfileDialog({ data, profileId, clusterById, onPick, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Profilierung wählen" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 className="modal__title">Profilierung wählen</h2>
            <p className="modal__sub">
              Eine Profilierung wird vergeben, wenn ≥ {data.meta.profile_threshold_cp} CP aus den zugehörigen
              Clustern erbracht werden (≥ {data.meta.profile_core_min_cp} aus dem Kern). Jede Profilierung ist
              allein mit englischen FIN+FMB-Modulen erfüllbar.
            </p>
          </div>
          <div className="head__spacer" />
          <button className="btn btn--ghost" onClick={onClose} aria-label="Dialog schließen">{I.close}</button>
        </div>

        <div className="modal__grid">
          {data.profiles.map((p) => {
            const active = p.id === profileId;
            return (
              <button key={p.id} className={`card card--hover pcard ${active ? "card--active" : ""}`} onClick={() => onPick(p.id)}>
                <div className="pcard__name">{p.name}</div>
                <div className="pcard__tag">{p.tagline}</div>
                <div className="pcard__clusters">
                  {p.core_clusters.map((k) => {
                    const c = clusterById.get(k);
                    return <span className="chip" key={k} style={{ pointerEvents: "none" }}><span className="chip__dot" style={{ background: c?.color }} />{c?.name}</span>;
                  })}
                </div>
                <div className="pcard__foot">
                  <span>{p.stats.n_core_eligible} Kernmodule · {p.stats.n_eligible} anrechenbar</span>
                  <span className="row gap2" style={{ color: "var(--accent)" }}>{I.check}{p.threshold_cp} CP</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="modal__foot">
          <span className="muted" style={{ fontSize: 12 }}>{data.profiles.length} Profilierungen · alle C1 (englisch) &amp; C2 (FIN+FMB) maschinell geprüft</span>
          <button className="btn" onClick={() => onPick(null)}>Keine Profilierung</button>
        </div>
      </div>
    </div>
  );
}
