import { useEffect, useRef, useMemo, useState } from "react";
import * as d3 from "d3";

// Order clusters so FIN-leaning topics sit on one side, FMB-leaning on the other,
// bridges in between — this lays out the FIN×FMB story spatially. Unknown/new clusters
// are appended after these.
const CLUSTER_ORDER = [
  "ml_ai", "data_eng", "software_sys", "viz",
  "hci", "methods_skills", "innovation_mgmt", "logistics",
  "industry40", "robotics", "sim_num", "energy_sustain",
  "mech_mat", "manufacturing", "design_plm", "mobility",
];
const FAC_COLOR = { FIN: "#2B3A55", FMB: "#6E5A3A", FEIT: "#9A968D" };
const nodeRadius = (d) => 4 + Math.sqrt(d.cp || 5) * 1.15;

export default function ForceGraph({
  dataset, filters, selectedId, onSelect, activeProfile, showLabels, showHulls,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const selRef = useRef({});
  const zoomRef = useRef(null);
  const fitRef = useRef(null);
  const posRef = useRef(new Map());      // id -> {x,y,vx,vy}  (preserve layout across rebuilds)
  const firstRef = useRef(true);
  const prevDimsRef = useRef({ w: 0, h: 0 });
  const [dims, setDims] = useState({ w: 1000, h: 700 });
  const [tip, setTip] = useState(null);

  const colorOf = useMemo(() => Object.fromEntries(dataset.clusters.map((c) => [c.key, c.color])), [dataset.clusters]);
  const nameOf = useMemo(() => Object.fromEntries(dataset.clusters.map((c) => [c.key, c.name])), [dataset.clusters]);

  // topology signature: rebuild the sim only when nodes / cluster assignment / cluster
  // visuals / link set change (NOT when profiles, filters or selection change).
  const topoSig = useMemo(() =>
    dataset.modules.map((m) => m.id + "~" + m.cluster).join("|") + "##" +
    dataset.clusters.map((c) => c.key + c.color + c.name).join("|") + "##" + dataset.links.length,
    [dataset.modules, dataset.clusters, dataset.links]);

  const adj = useMemo(() => {
    const a = new Map();
    dataset.modules.forEach((m) => a.set(m.id, new Set()));
    dataset.links.forEach((l) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      a.get(s)?.add(t); a.get(t)?.add(s);
    });
    return a;
  }, [dataset.modules, dataset.links]);

  const profSets = useMemo(() => {
    if (!activeProfile) return null;
    return {
      eligible: new Set(activeProfile.eligible_pool),
      core: new Set(activeProfile.core_eligible_pool),
      sub: new Set(activeProfile.substitutes),
    };
  }, [activeProfile]);

  // ---- size observer ----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- build simulation + DOM (on topology / size change; positions preserved) ----
  useEffect(() => {
    const { w, h } = dims;
    const svg = d3.select(svgRef.current).attr("viewBox", [0, 0, w, h]);
    const prevTransform = svgRef.current ? d3.zoomTransform(svgRef.current) : d3.zoomIdentity;
    svg.selectAll("*").remove();

    const root = svg.append("g");
    const gHull = root.append("g");
    const gHullLabel = root.append("g");
    const gLink = root.append("g").attr("stroke-linecap", "round");
    const gNode = root.append("g");
    const gLabel = root.append("g");

    // cluster anchors on a generous VIRTUAL canvas (viewport-independent); fit afterwards.
    const present = CLUSTER_ORDER.filter((k) => dataset.modules.some((n) => n.cluster === k))
      .concat(dataset.clusters.map((c) => c.key).filter((k) => !CLUSTER_ORDER.includes(k) && dataset.modules.some((n) => n.cluster === k)));
    const cols = 4, cellW = 360, cellH = 300;
    const anchor = {};
    present.forEach((k, i) => { anchor[k] = { x: ((i % cols) + 0.5) * cellW, y: (Math.floor(i / cols) + 0.5) * cellH }; });
    const LW = cols * cellW, LH = Math.max(1, Math.ceil(present.length / cols)) * cellH;

    const saved = posRef.current;
    const nodes = dataset.modules.map((d) => {
      const p = saved.get(d.id);
      const a = anchor[d.cluster] || { x: LW / 2, y: LH / 2 };
      return { ...d, x: p?.x ?? a.x + (Math.random() - 0.5) * 80, y: p?.y ?? a.y + (Math.random() - 0.5) * 80, vx: p?.vx ?? 0, vy: p?.vy ?? 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = dataset.links
      .filter((l) => byId.has(typeof l.source === "object" ? l.source.id : l.source) && byId.has(typeof l.target === "object" ? l.target.id : l.target))
      .map((l) => ({ ...l }));

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(46).strength(0.12))
      .force("charge", d3.forceManyBody().strength(-150).distanceMax(520))
      .force("x", d3.forceX((d) => (anchor[d.cluster] || { x: LW / 2 }).x).strength(0.14))
      .force("y", d3.forceY((d) => (anchor[d.cluster] || { y: LH / 2 }).y).strength(0.14))
      .force("collide", d3.forceCollide((d) => nodeRadius(d) + 5).strength(0.9));
    simRef.current = sim;

    const link = gLink.selectAll("line").data(links).join("line")
      .attr("class", "link").attr("stroke-width", (d) => 0.6 + d.weight * 0.12);

    const node = gNode.selectAll("circle").data(nodes, (d) => d.id).join("circle")
      .attr("class", "node").attr("r", nodeRadius)
      .on("click", (e, d) => { e.stopPropagation(); onSelect(d.id); })
      .on("mouseenter", (e, d) => {
        const rect = wrapRef.current.getBoundingClientRect();
        setTip({ d, x: e.clientX - rect.left, y: e.clientY - rect.top });
      })
      .on("mouseleave", () => setTip(null))
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    const label = gLabel.selectAll("text").data(nodes, (d) => d.id).join("text")
      .attr("class", "node-label").attr("text-anchor", "middle").attr("dy", (d) => -nodeRadius(d) - 4)
      .text((d) => (d.label || "").length > 26 ? d.label.slice(0, 25) + "…" : d.label);

    const hullLine = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6));
    const clusterKeys = present;

    function drawHulls() {
      const data = clusterKeys.map((k) => ({ key: k, pts: nodes.filter((n) => n.cluster === k).map((n) => [n.x, n.y]) })).filter((d) => d.pts.length);
      const padded = (pts, pad) => {
        if (pts.length < 3) {
          const [cx, cy] = pts.length === 1 ? pts[0] : [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
          return d3.range(10).map((i) => { const a = (i / 10) * 2 * Math.PI; return [cx + Math.cos(a) * (pad + 16), cy + Math.sin(a) * (pad + 16)]; });
        }
        const hull = d3.polygonHull(pts), c = d3.polygonCentroid(hull);
        return hull.map(([x, y]) => { const dx = x - c[0], dy = y - c[1], L = Math.hypot(dx, dy) || 1; return [x + (dx / L) * pad, y + (dy / L) * pad]; });
      };
      gHull.selectAll("path").data(data, (d) => d.key).join("path")
        .attr("class", "hull")
        .attr("fill", (d) => colorOf[d.key]).attr("fill-opacity", 0.07)
        .attr("stroke", (d) => colorOf[d.key]).attr("stroke-opacity", 0.22).attr("stroke-width", 1)
        .attr("d", (d) => hullLine(padded(d.pts, 22)));
      const lsel = gHullLabel.selectAll("g").data(data, (d) => d.key).join((enter) => {
        const g = enter.append("g"); g.append("text").attr("class", "hull-label").attr("text-anchor", "middle"); return g;
      });
      lsel.each(function (d) {
        const cx = d3.mean(d.pts, (p) => p[0]), top = d3.min(d.pts, (p) => p[1]);
        d3.select(this).select("text").attr("x", cx).attr("y", top - 14)
          .attr("fill", d3.color(colorOf[d.key]).darker(1.2)).text(nameOf[d.key]);
      });
    }

    sim.on("tick", () => {
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      label.attr("x", (d) => d.x).attr("y", (d) => d.y);
      nodes.forEach((n) => saved.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }));
      if (showHullsRef.current) drawHulls();
    });

    const zoom = d3.zoom().scaleExtent([0.35, 4]).on("zoom", (e) => {
      root.attr("transform", e.transform);
      gLabel.attr("display", e.transform.k < 1.0 ? "none" : null);
    });
    zoomRef.current = zoom;
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", () => onSelect(null));

    function fitView(animate) {
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY), pad = 70;
      const k = Math.max(0.35, Math.min(2, Math.min((w - 2 * pad) / gw, (h - 2 * pad) / gh)));
      const tx = (w - k * (minX + maxX)) / 2, ty = (h - k * (minY + maxY)) / 2;
      zoom.translateExtent([[minX - 500, minY - 500], [maxX + 500, maxY + 500]]);
      (animate ? svg.transition().duration(420) : svg).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    }
    fitRef.current = fitView;
    selRef.current = { node, link, label, byId, gHull, gHullLabel, gLabel, drawHulls };

    const isFirst = firstRef.current;
    const dimsChanged = prevDimsRef.current.w !== w || prevDimsRef.current.h !== h;
    sim.alpha(isFirst ? 1 : 0.45).alphaDecay(0.022);
    sim.tick(isFirst ? 280 : 80);
    drawHulls();
    if (isFirst || dimsChanged) fitView(false);
    else svg.call(zoom.transform, prevTransform);   // preserve the user's view across an edit
    firstRef.current = false;
    prevDimsRef.current = { w, h };

    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoSig, dims.w, dims.h]);

  const showHullsRef = useRef(showHulls);
  useEffect(() => {
    showHullsRef.current = showHulls;
    const s = selRef.current;
    if (!s?.gHull) return;
    s.gHull.attr("display", showHulls ? null : "none");
    s.gHullLabel.attr("display", showHulls ? null : "none");
    if (showHulls && s.drawHulls) s.drawHulls();
  }, [showHulls]);

  useEffect(() => {
    const s = selRef.current;
    if (s?.gLabel) s.gLabel.attr("opacity", showLabels ? 1 : 0);
  }, [showLabels, topoSig, dims]);

  // ---- restyle on selection / profile / filters / cluster colours (no sim restart) ----
  useEffect(() => {
    const s = selRef.current;
    if (!s?.node) return;
    const { node, link, label } = s;

    const passFilter = (d) => {
      if (filters.faculties.size && !filters.faculties.has(d.faculty)) return false;
      if (filters.languages.size) {
        const langs = d.language === "both" ? ["en", "de"] : [d.language];
        if (!langs.some((l) => filters.languages.has(l))) return false;
      }
      if (filters.clusters.size && !filters.clusters.has(d.cluster)) return false;
      if (filters.q) {
        const hay = `${d.label} ${d.title_de || ""} ${(d.topic_tags || []).join(" ")}`.toLowerCase();
        if (!hay.includes(filters.q)) return false;
      }
      return true;
    };
    const inScope = (d) => !profSets || profSets.eligible.has(d.id) || profSets.sub.has(d.id);
    const visible = (d) => passFilter(d) && inScope(d);
    const neigh = selectedId ? adj.get(selectedId) : null;
    const emphasized = (d) => (!selectedId ? null : d.id === selectedId || neigh?.has(d.id));

    node
      .attr("opacity", (d) => { if (!visible(d)) return profSets ? 0.05 : 0.07; const e = emphasized(d); return e === null ? 1 : e ? 1 : 0.14; })
      .attr("fill", (d) => {
        if (profSets) {
          if (profSets.core.has(d.id) || profSets.eligible.has(d.id)) return colorOf[d.cluster];
          if (profSets.sub.has(d.id)) return "#FFFFFF";
          return "#D6D3CB";
        }
        return colorOf[d.cluster] || "#B9B5AC";
      })
      .attr("stroke", (d) => {
        if (d.id === selectedId) return "#1C1B19";
        if (profSets) {
          if (profSets.core.has(d.id)) return "#1C1B19";
          if (profSets.sub.has(d.id)) return colorOf[d.cluster];
          if (profSets.eligible.has(d.id)) return FAC_COLOR[d.faculty];
          return "transparent";
        }
        return FAC_COLOR[d.faculty];
      })
      .attr("stroke-width", (d) => (d.id === selectedId ? 2.6 : profSets?.core.has(d.id) ? 2 : 1.1))
      .attr("stroke-dasharray", (d) => (profSets && profSets.sub.has(d.id) && !profSets.eligible.has(d.id) ? "2 2" : null))
      .attr("r", (d) => nodeRadius(d) + (d.id === selectedId ? 2.5 : 0));

    link.attr("opacity", (d) => {
      const sv = visible(d.source), tv = visible(d.target);
      if (!sv || !tv) return 0.02;
      if (selectedId) return d.source.id === selectedId || d.target.id === selectedId ? 0.5 : 0.04;
      return d.cross_faculty ? 0.16 : 0.10;
    }).attr("stroke", (d) => (selectedId && (d.source.id === selectedId || d.target.id === selectedId) ? "#2B3A55" : "#1C1B19"));

    label.attr("opacity", (d) => (!showLabels ? 0 : !visible(d) ? 0 : selectedId ? (emphasized(d) ? 1 : 0) : 1));
  }, [selectedId, profSets, filters, adj, colorOf, showLabels, topoSig, dims.w, dims.h]);

  const zoomBy = (k) => d3.select(svgRef.current).transition().duration(220).call(zoomRef.current.scaleBy, k);
  const resetZoom = () => fitRef.current?.(true);

  return (
    <div className="canvas" ref={wrapRef}>
      <svg ref={svgRef} role="img" aria-label="Modul- und Profilierungsgraph" />
      <div className="canvas__tools">
        <button className="zoombtn" onClick={() => zoomBy(1.3)} aria-label="Hineinzoomen" title="Hineinzoomen"><Plus /></button>
        <button className="zoombtn" onClick={() => zoomBy(1 / 1.3)} aria-label="Herauszoomen" title="Herauszoomen"><Minus /></button>
        <button className="zoombtn" onClick={resetZoom} aria-label="Ansicht einpassen" title="Ansicht einpassen"><Target /></button>
      </div>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="presentation">
          <b>{tip.d.label}</b>
          <div className="tooltip__meta">{tip.d.faculty} · {tip.d.cp} CP · {tip.d.language.toUpperCase()} · {nameOf[tip.d.cluster]}</div>
        </div>
      )}
    </div>
  );
}

const Plus = () => (<svg className="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
const Minus = () => (<svg className="icon" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /></svg>);
const Target = () => (<svg className="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /></svg>);
