import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ForceGraph from "./ForceGraph.jsx";
import { computeProfiles, computeProfile, toDef } from "./profiles.js";

/* ───────────────────────── icons (single consistent line set) ───────────── */
const I = {
  search: <svg className="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  close: <svg className="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  layers: <svg className="icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
  reset: <svg className="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>,
  filter: <svg className="icon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>,
  check: <svg className="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>,
  ext: <svg className="icon" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>,
  edit: <svg className="icon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>,
  plus: <svg className="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  trash: <svg className="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
  dl: <svg className="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  ul: <svg className="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
};

const LANG_LABEL = { en: "Englisch", de: "Deutsch", both: "Zweisprachig" };
const KIND_LABEL = { course: "Vorlesung", seminar: "Seminar", project: "Projekt", lab: "Labor", thesis: "Abschlussarbeit", skills: "Schlüsselkompetenz" };
const LEVEL_LABEL = { introductory: "Einführung", core: "Kern", advanced: "Vertiefung" };
const NEW_COLORS = ["#5B7DB1", "#4E9C8B", "#9A6FA8", "#B07C57", "#6F8C4E", "#A86C86", "#557A9E", "#8C8C8C"];

const LS_KEY = "de_workspace_v2";
const loadLS = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
const uid = (p) => p + Math.random().toString(36).slice(2, 7);

export default function App() {
  const [base, setBase] = useState(null);
  const [err, setErr] = useState(null);
  const [ws, setWs] = useState(null);   // editable workspace: { clusters, modules, profileDefs }
  const [filters, setFilters] = useState({ faculties: new Set(), languages: new Set(), clusters: new Set(), q: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showHulls, setShowHulls] = useState(true);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}de_dataset.json`).then((r) => r.json()).then((j) => {
      setBase(j);
      const saved = loadLS();
      setWs(saved?.clusters && saved?.modules && saved?.profileDefs ? saved : {
        clusters: j.clusters.map((c) => ({ key: c.key, name: c.name, color: c.color, description: c.description })),
        modules: j.modules.map((m) => ({ ...m })),
        profileDefs: j.profiles.map(toDef),
      });
    }).catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => { if (ws) { try { localStorage.setItem(LS_KEY, JSON.stringify(ws)); } catch { /* quota */ } } }, [ws]);

  const clusterById = useMemo(() => new Map((ws?.clusters || []).map((c) => [c.key, c])), [ws]);
  const byId = useMemo(() => new Map((ws?.modules || []).map((m) => [m.id, m])), [ws]);
  const profiles = useMemo(() => (ws ? computeProfiles(ws.profileDefs, ws.modules) : []), [ws]);
  const graphData = useMemo(() => (ws && base ? { clusters: ws.clusters, modules: ws.modules, links: base.links } : null), [ws, base]);
  const activeProfile = useMemo(() => profiles.find((p) => p.id === profileId) || null, [profiles, profileId]);
  const selected = selectedId ? byId.get(selectedId) : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (editorOpen) setEditorOpen(false);
      else if (dialogOpen) setDialogOpen(false);
      else if (selectedId) setSelectedId(null);
      else if (railOpen) setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, dialogOpen, selectedId, railOpen]);

  const toggleSet = useCallback((key, val) => {
    setFilters((f) => { const s = new Set(f[key]); s.has(val) ? s.delete(val) : s.add(val); return { ...f, [key]: s }; });
  }, []);
  const anyFilter = filters.faculties.size || filters.languages.size || filters.clusters.size || filters.q || profileId;
  const resetAll = () => { setFilters({ faculties: new Set(), languages: new Set(), clusters: new Set(), q: "" }); setProfileId(null); setSelectedId(null); };

  // ── editor operations ──
  const ops = useMemo(() => ({
    renameCluster: (key, name) => setWs((w) => ({ ...w, clusters: w.clusters.map((c) => c.key === key ? { ...c, name } : c) })),
    recolorCluster: (key, color) => setWs((w) => ({ ...w, clusters: w.clusters.map((c) => c.key === key ? { ...c, color } : c) })),
    addCluster: () => setWs((w) => { const key = uid("cl_"); return { ...w, clusters: [...w.clusters, { key, name: "Neuer Cluster", color: NEW_COLORS[w.clusters.length % NEW_COLORS.length], description: "" }] }; }),
    deleteCluster: (key) => setWs((w) => {
      if (w.clusters.length <= 1) return w;
      const fallback = w.clusters.find((c) => c.key !== key).key;
      return {
        ...w,
        clusters: w.clusters.filter((c) => c.key !== key),
        modules: w.modules.map((m) => ({ ...m, cluster: m.cluster === key ? fallback : m.cluster, secondary_clusters: (m.secondary_clusters || []).filter((s) => s !== key) })),
        profileDefs: w.profileDefs.map((p) => ({ ...p, core_clusters: p.core_clusters.filter((k) => k !== key), allied_clusters: p.allied_clusters.filter((k) => k !== key) })),
      };
    }),
    setModuleCluster: (id, key) => setWs((w) => ({ ...w, modules: w.modules.map((m) => m.id === id ? { ...m, cluster: key } : m) })),
    deleteModule: (id) => setWs((w) => ({ ...w, modules: w.modules.filter((m) => m.id !== id) })),
    saveProfile: (def) => setWs((w) => { const exists = w.profileDefs.some((p) => p.id === def.id); return { ...w, profileDefs: exists ? w.profileDefs.map((p) => p.id === def.id ? def : p) : [...w.profileDefs, def] }; }),
    deleteProfile: (id) => setWs((w) => ({ ...w, profileDefs: w.profileDefs.filter((p) => p.id !== id) })),
  }), []);

  const exportWs = () => {
    const blob = new Blob([JSON.stringify(ws, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "de_workspace.json"; a.click();
    URL.revokeObjectURL(a.href);
  };
  const importWs = (file) => {
    const r = new FileReader();
    r.onload = () => { try { const j = JSON.parse(r.result); if (j.clusters && j.modules && j.profileDefs) { setWs(j); setSelectedId(null); setProfileId(null); } else alert("Ungültige Workspace-Datei."); } catch { alert("Datei konnte nicht gelesen werden."); } };
    r.readAsText(file);
  };
  const resetWs = () => {
    if (!confirm("Alle Änderungen verwerfen und Originaldaten laden?")) return;
    localStorage.removeItem(LS_KEY);
    setWs({ clusters: base.clusters.map((c) => ({ key: c.key, name: c.name, color: c.color, description: c.description })), modules: base.modules.map((m) => ({ ...m })), profileDefs: base.profiles.map(toDef) });
    setSelectedId(null); setProfileId(null);
  };

  if (err) return <div style={{ padding: 40 }}>Daten konnten nicht geladen werden: {err}</div>;
  if (!ws || !graphData) return <div style={{ padding: 40, color: "var(--ink-3)" }}>Lädt Modul- &amp; Profilierungsgraph …</div>;

  return (
    <div className="app">
      <header className="app__head">
        <div className="head">
          <button className="btn btn--ghost rail-toggle" onClick={() => setRailOpen((v) => !v)} aria-label="Filter ein-/ausblenden">{I.filter}</button>
          <div className="head__brand">
            <h1 className="head__title">M.Sc. Digital Engineering</h1>
            <span className="head__sub">Modul- &amp; Profilierungsgraph · FIN · FMB · FEIT</span>
          </div>
          <div className="head__spacer" />
          <div className="head__stats" aria-hidden="true">
            <div className="head__stat"><b className="num">{ws.modules.length}</b><span>Module</span></div>
            <div className="head__stat"><b className="num">{ws.clusters.length}</b><span>Cluster</span></div>
            <div className="head__stat"><b className="num">{profiles.length}</b><span>Profile</span></div>
          </div>
          <button className="btn" onClick={() => setEditorOpen(true)} title="Bearbeiten">{I.edit}<span>Bearbeiten</span></button>
          <button className="btn btn--primary" onClick={() => setDialogOpen(true)}>{I.layers}<span>Profilierung</span></button>
          {anyFilter ? <button className="btn" onClick={resetAll}>{I.reset}<span>Zurücksetzen</span></button> : null}
        </div>
      </header>

      <aside className="app__rail" data-open={railOpen}>
        <Rail data={ws} filters={filters} setFilters={setFilters} toggleSet={toggleSet}
          showLabels={showLabels} setShowLabels={setShowLabels} showHulls={showHulls} setShowHulls={setShowHulls} />
      </aside>

      <main className="app__main">
        <ForceGraph dataset={graphData} filters={filters} selectedId={selectedId} onSelect={setSelectedId}
          activeProfile={activeProfile} showLabels={showLabels} showHulls={showHulls} />

        {activeProfile && <ProfileBanner profile={activeProfile} onClear={() => setProfileId(null)} onDetails={() => setDialogOpen(true)} />}

        <div className="canvas__hint" aria-hidden="true">
          <span>Knoten = Modul · Fläche = Themencluster</span><span>·</span>
          <span>Klick für Details · <span className="kbd">Esc</span> schließt</span>
        </div>

        <DetailPanel module={selected} clusterById={clusterById} onClose={() => setSelectedId(null)} activeProfile={activeProfile} />
      </main>

      {dialogOpen && (
        <ProfileDialog profiles={profiles} profileId={profileId} clusterById={clusterById}
          onPick={(id) => { setProfileId(id); setDialogOpen(false); setSelectedId(null); }}
          onClose={() => setDialogOpen(false)} onEdit={() => { setDialogOpen(false); setEditorOpen(true); }} />
      )}

      {editorOpen && (
        <Editor ws={ws} profiles={profiles} ops={ops}
          onClose={() => setEditorOpen(false)} onExport={exportWs} onImport={importWs} onReset={resetWs}
          onActivateProfile={(id) => { setProfileId(id); }} />
      )}
    </div>
  );
}

/* ───────────────────────────────── Rail ──────────────────────────────────── */
function Rail({ data, filters, setFilters, toggleSet, showLabels, setShowLabels, showHulls, setShowHulls }) {
  const clusterCounts = useMemo(() => { const c = {}; data.modules.forEach((x) => (c[x.cluster] = (c[x.cluster] || 0) + 1)); return c; }, [data]);
  return (
    <div className="rail__scroll">
      <div className="rail__section">
        <div className="field">{I.search}
          <input className="input" placeholder="Module, Tags suchen …" value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value.toLowerCase() }))} aria-label="Module suchen" />
        </div>
      </div>
      <div className="rail__section">
        <div className="rail__head"><span className="eyebrow">Fakultät</span></div>
        <div className="seg" role="group" aria-label="Fakultät filtern">
          {["FIN", "FMB", "FEIT"].map((f) => (<button key={f} aria-pressed={filters.faculties.has(f)} onClick={() => toggleSet("faculties", f)}>{f}</button>))}
        </div>
        <div style={{ height: 12 }} />
        <div className="rail__head"><span className="eyebrow">Sprache</span></div>
        <div className="seg" role="group" aria-label="Sprache filtern">
          {[["en", "Englisch"], ["de", "Deutsch"]].map(([k, l]) => (<button key={k} aria-pressed={filters.languages.has(k)} onClick={() => toggleSet("languages", k)}>{l}</button>))}
        </div>
      </div>
      <div className="rail__section">
        <div className="rail__head"><span className="eyebrow">Themencluster</span>
          {filters.clusters.size ? <button className="btn btn--ghost btn--sm" onClick={() => setFilters((f) => ({ ...f, clusters: new Set() }))}>Alle</button> : null}
        </div>
        <div className="rail__list">
          {data.clusters.map((c) => {
            const on = filters.clusters.has(c.key), dim = filters.clusters.size > 0 && !on;
            return (
              <button key={c.key} className="clrow" aria-pressed={on} data-dim={dim} onClick={() => toggleSet("clusters", c.key)} title={c.description}>
                <span className="swatch" style={{ background: c.color }} /><span>{c.name}</span>
                <span className="clrow__count">{clusterCounts[c.key] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="rail__section">
        <div className="rail__head"><span className="eyebrow">Darstellung</span></div>
        <label className="row gap2" style={{ fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          <input type="checkbox" checked={showHulls} onChange={(e) => setShowHulls(e.target.checked)} />Clusterflächen
        </label>
        <label className="row gap2" style={{ fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />Modulbeschriftungen
        </label>
      </div>
      <div className="rail__section" style={{ borderBottom: "none" }}>
        <div className="rail__head"><span className="eyebrow">Legende</span></div>
        <div className="legend">
          <span className="legend__item"><span className="swatch" style={{ borderRadius: "50%", border: "1.5px solid var(--fin)", background: "transparent" }} />FIN</span>
          <span className="legend__item"><span className="swatch" style={{ borderRadius: "50%", border: "1.5px solid var(--fmb)", background: "transparent" }} />FMB</span>
          <span className="legend__item"><span className="swatch" style={{ borderRadius: "50%", border: "1.5px solid var(--feit)", background: "transparent" }} />FEIT</span>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
          Knotengröße ∝ Creditpoints. Bei aktiver Profilierung erscheinen anrechenbare englische
          FIN+FMB-Module farbig, Substitute (deutsch/FEIT) hohl-gestrichelt.
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
    else if (activeProfile.substitutes.includes(module.id)) profStatus = { t: "Optionales Substitut (deutsch/FEIT)", k: "sub" };
    else profStatus = { t: "Nicht Teil dieser Profilierung", k: "out" };
  }
  return (
    <div className="detail" data-open={!!module} aria-hidden={!module}>
      {module && (
        <>
          <div className="detail__head">
            <button className="btn btn--ghost detail__close" onClick={onClose} aria-label="Detailpanel schließen">{I.close}</button>
            <div className="row gap2"><span className="swatch" style={{ background: c?.color }} /><span className="eyebrow">{c?.name}</span></div>
            <h2 className="detail__title">{module.label}</h2>
            {module.title_de && module.title_de !== module.label && (<div className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 6 }}>{module.title_de}</div>)}
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
                <div className="row gap2" style={{ fontSize: 12.5, fontWeight: 550 }}>{profStatus.k !== "out" && <span style={{ color: "var(--accent)" }}>{I.check}</span>}{profStatus.t}</div>
              </div>
            )}
            {module.description_en && <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{module.description_en}</p>}
            {module.competencies?.length > 0 && (<><div className="section-title">Kompetenzen</div><ul className="bullets">{module.competencies.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
            {module.topic_tags?.length > 0 && (<><div className="section-title">Themen-Tags</div><div className="taglist">{module.topic_tags.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div></>)}
            <div className="section-title">Metadaten</div>
            <dl className="kv">
              <dt>Fakultät</dt><dd>{module.faculty}</dd>
              <dt>Sprache</dt><dd>{LANG_LABEL[module.language]}</dd>
              <dt>Creditpoints</dt><dd>{module.cp} CP</dd>
              {module.module_code && (<><dt>Modulcode</dt><dd className="mono">{module.module_code}</dd></>)}
              <dt>Quelle</dt><dd style={{ fontSize: 12 }}>{module.source}</dd>
            </dl>
            {module.source_url && (<a className="btn btn--sm" href={module.source_url} target="_blank" rel="noreferrer">{I.ext}<span>Modulseite öffnen</span></a>)}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Profile banner ────────────────────────────── */
function ProfileBanner({ profile, onClear, onDetails }) {
  const ok = profile.reachable_en_finfmb;
  return (
    <div className="pbanner" role="status">
      <span className="eyebrow">Profilierung</span>
      <span className="pbanner__name">{profile.name}</span>
      <span className="pbanner__sep" />
      <span className="pbanner__rule">≥ {profile.threshold_cp} CP · ≥ {profile.core_min_cp} aus Kern · {profile.stats.n_eligible} anrechenbare EN-Module</span>
      <span className="pbanner__rule row gap2" style={{ color: ok ? "var(--accent)" : "#A6432E", fontWeight: 600 }}>{ok ? I.check : null}{ok ? "erfüllbar" : "nicht erfüllbar"}</span>
      <button className="btn btn--ghost btn--sm" onClick={onDetails}>Ändern</button>
      <button className="btn btn--ghost btn--sm" onClick={onClear} aria-label="Profilierung entfernen">{I.close}</button>
    </div>
  );
}

/* ───────────────────────────── Profile dialog ────────────────────────────── */
function ProfileDialog({ profiles, profileId, clusterById, onPick, onClose, onEdit }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Profilierung wählen" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 className="modal__title">Profilierung wählen</h2>
            <p className="modal__sub">Eine Profilierung wird vergeben, wenn die CP-Schwelle aus den zugehörigen Clustern erreicht wird — allein mit englischen FIN+FMB-Modulen.</p>
          </div>
          <div className="head__spacer" />
          <button className="btn btn--ghost" onClick={onEdit} title="Profile bearbeiten">{I.edit}</button>
          <button className="btn btn--ghost" onClick={onClose} aria-label="Dialog schließen">{I.close}</button>
        </div>
        <div className="modal__grid">
          {profiles.map((p) => {
            const active = p.id === profileId;
            return (
              <button key={p.id} className={`card card--hover pcard ${active ? "card--active" : ""}`} onClick={() => onPick(p.id)}>
                <div className="row gap2" style={{ justifyContent: "space-between" }}>
                  <div className="pcard__name">{p.name}</div>
                  {!p.reachable_en_finfmb && <span className="badge badge--de" title="Mit englischen FIN+FMB-Modulen nicht erreichbar">⚠ n. erfüllbar</span>}
                </div>
                <div className="pcard__tag">{p.tagline}</div>
                <div className="pcard__clusters">
                  {p.core_clusters.map((k) => { const c = clusterById.get(k); return <span className="chip" key={k} style={{ pointerEvents: "none" }}><span className="chip__dot" style={{ background: c?.color }} />{c?.name || k}</span>; })}
                </div>
                <div className="pcard__foot">
                  <span>{p.stats.n_core_eligible} Kernmodule · {p.stats.n_eligible} anrechenbar</span>
                  <span className="row gap2" style={{ color: p.reachable_en_finfmb ? "var(--accent)" : "var(--ink-4)" }}>{p.reachable_en_finfmb ? I.check : null}{p.threshold_cp} CP</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="modal__foot">
          <span className="muted" style={{ fontSize: 12 }}>{profiles.length} Profilierungen · {profiles.filter((p) => p.reachable_en_finfmb).length} erfüllbar (C1 englisch &amp; C2 FIN+FMB)</span>
          <button className="btn" onClick={() => onPick(null)}>Keine Profilierung</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════ Editor ═════════════════════════════════ */
function Editor({ ws, profiles, ops, onClose, onExport, onImport, onReset, onActivateProfile }) {
  const [tab, setTab] = useState("clusters");
  const fileRef = useRef(null);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="editor" role="dialog" aria-modal="true" aria-label="Editor" onClick={(e) => e.stopPropagation()}>
        <div className="editor__head">
          <div><h2 className="modal__title">Editor</h2><p className="modal__sub">Änderungen werden lokal im Browser gespeichert.</p></div>
          <div className="head__spacer" />
          <button className="btn btn--ghost" onClick={onClose} aria-label="Editor schließen">{I.close}</button>
        </div>
        <div className="editor__tabs" role="tablist">
          {[["clusters", "Themencluster"], ["modules", "Module"], ["profiles", "Profilierungen"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="editor__body">
          {tab === "clusters" && <ClustersTab ws={ws} ops={ops} />}
          {tab === "modules" && <ModulesTab ws={ws} ops={ops} />}
          {tab === "profiles" && <ProfilesTab ws={ws} profiles={profiles} ops={ops} onActivateProfile={onActivateProfile} />}
        </div>
        <div className="editor__foot">
          <div className="row gap2">
            <button className="btn btn--sm" onClick={onExport}>{I.dl}<span>Export</span></button>
            <button className="btn btn--sm" onClick={() => fileRef.current.click()}>{I.ul}<span>Import</span></button>
            <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
          </div>
          <button className="btn btn--sm" onClick={onReset}>{I.reset}<span>Auf Original zurücksetzen</span></button>
        </div>
      </div>
    </div>
  );
}

function ClustersTab({ ws, ops }) {
  const counts = useMemo(() => { const c = {}; ws.modules.forEach((m) => (c[m.cluster] = (c[m.cluster] || 0) + 1)); return c; }, [ws]);
  const [confirm, setConfirm] = useState(null);
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>{ws.clusters.length} Cluster</span>
        <button className="btn btn--sm" onClick={ops.addCluster}>{I.plus}<span>Neuer Cluster</span></button>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {ws.clusters.map((c) => (
          <div key={c.key} className="erow">
            <input type="color" className="swatch-input" value={c.color} onChange={(e) => ops.recolorCluster(c.key, e.target.value)} aria-label="Farbe" title="Farbe" />
            <input className="input erow__name" value={c.name} onChange={(e) => ops.renameCluster(c.key, e.target.value)} aria-label="Clustername" />
            <span className="clrow__count" style={{ width: 64, textAlign: "right" }}>{counts[c.key] || 0} Mod.</span>
            {confirm === c.key ? (
              <span className="row gap2">
                <button className="btn btn--sm" style={{ color: "#A6432E" }} onClick={() => { ops.deleteCluster(c.key); setConfirm(null); }}>Löschen</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(null)}>Abbr.</button>
              </span>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(c.key)} aria-label="Cluster löschen" disabled={ws.clusters.length <= 1}>{I.trash}</button>
            )}
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>Beim Löschen werden enthaltene Module dem ersten verbleibenden Cluster zugeordnet und der Cluster aus allen Profilierungen entfernt.</p>
    </div>
  );
}

function ModulesTab({ ws, ops }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.toLowerCase();
    return ws.modules.filter((m) => !t || (m.label || "").toLowerCase().includes(t) || (m.title_de || "").toLowerCase().includes(t) || m.faculty.toLowerCase().includes(t));
  }, [ws.modules, q]);
  const shown = list.slice(0, 140);
  return (
    <div>
      <div className="field" style={{ marginBottom: 12 }}>{I.search}
        <input className="input" placeholder="Modul suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Modul suchen" />
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>{list.length} Module{list.length > shown.length ? ` · zeige ${shown.length}` : ""}</span>
        <span className="muted" style={{ fontSize: 12 }}>Primärcluster zuweisen</span>
      </div>
      <div className="stack" style={{ gap: 5 }}>
        {shown.map((m) => (
          <div key={m.id} className="erow">
            <span className={`badge badge--${m.faculty.toLowerCase()}`} style={{ flex: "none" }}>{m.faculty}</span>
            <span className="erow__name" title={m.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{m.label}</span>
            <select className="select" style={{ width: 200, flex: "none" }} value={m.cluster} onChange={(e) => ops.setModuleCluster(m.id, e.target.value)} aria-label="Cluster">
              {ws.clusters.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
            <button className="btn btn--ghost btn--sm" onClick={() => ops.deleteModule(m.id)} aria-label="Modul löschen">{I.trash}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfilesTab({ ws, profiles, ops, onActivateProfile }) {
  const [editing, setEditing] = useState(null);   // a def being edited (or null)
  if (editing) return <ProfileForm def={editing} ws={ws} onCancel={() => setEditing(null)} onSave={(d) => { ops.saveProfile(d); setEditing(null); }} />;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>{profiles.length} Profilierungen</span>
        <button className="btn btn--sm" onClick={() => setEditing({ id: "p_" + Math.random().toString(36).slice(2, 7), name: "Neue Profilierung", tagline: "", description: "", core_clusters: [], allied_clusters: [], threshold_cp: 30, core_min_cp: 18 })}>{I.plus}<span>Neue Profilierung</span></button>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {profiles.map((p) => (
          <div key={p.id} className="erow">
            <span className="erow__name" style={{ fontSize: 13, fontWeight: 550 }}>{p.name}</span>
            <span className="badge" style={{ flex: "none", color: p.reachable_en_finfmb ? "#2E5E5A" : "#A6432E", borderColor: p.reachable_en_finfmb ? "#C5DAD6" : "#E2D2C2" }}>
              {p.reachable_en_finfmb ? "erfüllbar" : "n. erfüllbar"}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={() => onActivateProfile(p.id)} title="Im Graph zeigen">{I.layers}</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(toDef(p))} aria-label="Bearbeiten">{I.edit}</button>
            <button className="btn btn--ghost btn--sm" onClick={() => ops.deleteProfile(p.id)} aria-label="Löschen">{I.trash}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileForm({ def, ws, onCancel, onSave }) {
  const [d, setD] = useState(def);
  const preview = useMemo(() => computeProfile(d, ws.modules), [d, ws.modules]);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const toggleCluster = (field, key) => setD((x) => {
    const has = x[field].includes(key);
    const other = field === "core_clusters" ? "allied_clusters" : "core_clusters";
    return { ...x, [field]: has ? x[field].filter((k) => k !== key) : [...x[field], key], [other]: x[other].filter((k) => k !== key) };
  });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="fld"><span className="fld__l">Name</span><input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="fld"><span className="fld__l">Kurztext</span><input className="input" value={d.tagline} onChange={(e) => set({ tagline: e.target.value })} /></label>
      <label className="fld"><span className="fld__l">Beschreibung</span><textarea className="input" rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} /></label>
      <div className="row gap4">
        <label className="fld" style={{ flex: 1 }}><span className="fld__l">CP-Schwelle</span><input type="number" className="input" value={d.threshold_cp} onChange={(e) => set({ threshold_cp: +e.target.value })} /></label>
        <label className="fld" style={{ flex: 1 }}><span className="fld__l">davon aus Kern</span><input type="number" className="input" value={d.core_min_cp} onChange={(e) => set({ core_min_cp: +e.target.value })} /></label>
      </div>
      <div>
        <div className="fld__l" style={{ marginBottom: 6 }}>Kerncluster <span className="muted">(Fokus)</span></div>
        <div className="chkgrid">{ws.clusters.map((c) => (
          <label key={c.key} className={`chk ${d.core_clusters.includes(c.key) ? "chk--on" : ""}`}><input type="checkbox" checked={d.core_clusters.includes(c.key)} onChange={() => toggleCluster("core_clusters", c.key)} /><span className="chip__dot" style={{ background: c.color }} />{c.name}</label>
        ))}</div>
      </div>
      <div>
        <div className="fld__l" style={{ marginBottom: 6 }}>Verbündete Cluster <span className="muted">(anrechenbar)</span></div>
        <div className="chkgrid">{ws.clusters.map((c) => (
          <label key={c.key} className={`chk ${d.allied_clusters.includes(c.key) ? "chk--on" : ""}`}><input type="checkbox" checked={d.allied_clusters.includes(c.key)} onChange={() => toggleCluster("allied_clusters", c.key)} /><span className="chip__dot" style={{ background: c.color }} />{c.name}</label>
        ))}</div>
      </div>
      <div className="card" style={{ padding: 12, borderColor: preview.reachable_en_finfmb ? "var(--accent)" : "#D8B9A9" }}>
        <div className="row gap2" style={{ fontWeight: 600, fontSize: 13, color: preview.reachable_en_finfmb ? "var(--accent)" : "#A6432E" }}>
          {preview.reachable_en_finfmb ? I.check : null}{preview.reachable_en_finfmb ? "Erfüllbar mit englischen FIN+FMB-Modulen" : "Nicht erfüllbar (zu wenige englische FIN+FMB-Module)"}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {preview.stats.n_eligible} anrechenbar ({preview.stats.total_en_cp} CP) · {preview.stats.n_core_eligible} im Kern ({preview.stats.core_en_cp} CP) · {preview.stats.n_substitutes} Substitute · C1/C2 per Konstruktion erfüllt
        </div>
      </div>
      <div className="row gap2" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>Abbrechen</button>
        <button className="btn btn--primary" onClick={() => onSave(d)} disabled={!d.name.trim()}>Speichern</button>
      </div>
    </div>
  );
}
