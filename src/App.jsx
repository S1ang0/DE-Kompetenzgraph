import { useState, useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";

const DOMAINS = {
  math:          { label: "Mathematik",            color: "#2563EB" },
  mechanics:     { label: "Mechanik",              color: "#D97706" },
  materials:     { label: "Werkstoffe",            color: "#059669" },
  thermal:       { label: "Thermodynamik",         color: "#DC2626" },
  fluid:         { label: "Strömungslehre",        color: "#7C3AED" },
  design:        { label: "Konstruktion/CAD",      color: "#EA580C" },
  manufacturing: { label: "Fertigung",             color: "#0891B2" },
  simulation:    { label: "Simulation/FEM",        color: "#4F46E5" },
  control:       { label: "Regelungstechnik",      color: "#DB2777" },
  electrical:    { label: "Elektrotechnik",        color: "#CA8A04" },
  measurement:   { label: "Messtechnik",           color: "#64748B" },
  programming:   { label: "Programmierung",        color: "#16A34A" },
};

const LEVEL_COLORS = { 1: "#2563EB", 2: "#059669", 3: "#D97706", 4: "#DC2626" };
const LEVEL_NAMES  = { 1: "Grundlage", 2: "Aufbau", 3: "Vertiefung", 4: "Experte" };

// Default if not overridden by career_fields.json meta
const DEFAULT_HOURS_PER_LEVEL = { 1: 2, 2: 4, 3: 6, 4: 10 };
const DEFAULT_HOURS_PER_WEEK = 25;

/* ─────────────────────────────────────────────────────────────
 *  Graph / Plan helpers
 * ───────────────────────────────────────────────────────────── */

function computeNodeWeights(allNodes, allLinks) {
  const childMap = new Map();
  allLinks.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (!childMap.has(s)) childMap.set(s, []);
    childMap.get(s).push(t);
  });
  const weights = new Map();
  for (const node of allNodes) {
    const visited = new Set();
    let frontier = [node.id];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const cid of (childMap.get(id) || [])) {
          if (!visited.has(cid)) { visited.add(cid); next.push(cid); }
        }
      }
      frontier = next;
    }
    weights.set(node.id, visited.size);
  }
  return weights;
}

function getFullPath(targetId, allNodes, allLinks) {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const prereqMap = new Map();
  allLinks.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (!prereqMap.has(t)) prereqMap.set(t, []);
    prereqMap.get(t).push(s);
  });
  const layers = [];
  const visited = new Set([targetId]);
  let frontier = [targetId];
  while (frontier.length) {
    const nextFrontier = [];
    const layer = [];
    for (const id of frontier) {
      const parents = prereqMap.get(id) || [];
      for (const pid of parents) {
        if (!visited.has(pid)) {
          visited.add(pid);
          nextFrontier.push(pid);
          layer.push(nodeMap.get(pid));
        }
      }
    }
    if (layer.length) layers.push(layer);
    frontier = nextFrontier;
  }
  layers.reverse();
  return layers;
}

/**
 * Build an individual study plan from a set of target competency IDs.
 * Returns { orderedNodes, weeks, totalHours, totalCount }.
 * - Transitive closure of prerequisites
 * - Topological sort (Kahn), ties broken by level asc then label
 * - Packed into weeks capped by hoursPerWeek
 */
function computePlan(targetIds, allNodes, allLinks, hoursPerLevel, hoursPerWeek) {
  if (!targetIds.size) return null;
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  // Build prereq & child maps (restricted to existing ids)
  const prereqMap = new Map();
  const childMap  = new Map();
  allLinks.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (!prereqMap.has(t)) prereqMap.set(t, []);
    prereqMap.get(t).push(s);
    if (!childMap.has(s)) childMap.set(s, []);
    childMap.get(s).push(t);
  });

  // BFS backward from every target → full required set
  const required = new Set();
  const stack = [...targetIds];
  while (stack.length) {
    const id = stack.pop();
    if (required.has(id)) continue;
    required.add(id);
    (prereqMap.get(id) || []).forEach(p => { if (!required.has(p)) stack.push(p); });
  }

  // Build restricted graph over required
  const inDeg = new Map();
  required.forEach(id => inDeg.set(id, 0));
  required.forEach(id => {
    (prereqMap.get(id) || []).forEach(p => {
      if (required.has(p)) inDeg.set(id, (inDeg.get(id) || 0) + 1);
    });
  });

  // Kahn's topological sort, ties broken by level asc, then label asc
  const cmp = (a, b) => {
    const na = nodeMap.get(a), nb = nodeMap.get(b);
    if (na.level !== nb.level) return na.level - nb.level;
    return na.label.localeCompare(nb.label);
  };
  const ready = [...required].filter(id => (inDeg.get(id) || 0) === 0).sort(cmp);
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(id);
    (childMap.get(id) || []).forEach(c => {
      if (!required.has(c)) return;
      const d = inDeg.get(c) - 1;
      inDeg.set(c, d);
      if (d === 0) {
        // insert sorted
        let i = 0;
        while (i < ready.length && cmp(ready[i], c) < 0) i++;
        ready.splice(i, 0, c);
      }
    });
  }

  const orderedNodes = ordered.map(id => nodeMap.get(id));

  // Pack into weeks — respecting topology (never put a competency in a week
  // before all prerequisites are in an earlier or same week)
  const weeks = [];
  let current = { items: [], hours: 0 };
  const placed = new Map();   // id → week idx
  const flushWeek = () => {
    if (current.items.length) {
      weeks.push(current);
      current = { items: [], hours: 0 };
    }
  };

  for (const node of orderedNodes) {
    const hrs = hoursPerLevel[node.level] || 4;
    const prereqsInPlan = (prereqMap.get(node.id) || []).filter(p => required.has(p));
    const maxPrereqWeek = prereqsInPlan.reduce(
      (m, p) => Math.max(m, placed.has(p) ? placed.get(p) : -1), -1
    );
    // target week: current one, but must be > any prereq's week
    let targetWeek = weeks.length;
    if (maxPrereqWeek >= targetWeek) {
      // Need to advance — flush and push empties if needed
      flushWeek();
      while (weeks.length <= maxPrereqWeek) {
        weeks.push({ items: [], hours: 0 });
      }
      targetWeek = weeks.length;
    }

    // Does it fit in current (targetWeek) within hours cap?
    if (current.hours + hrs > hoursPerWeek && current.items.length > 0) {
      flushWeek();
      targetWeek = weeks.length;
    }
    current.items.push({ node, hours: hrs });
    current.hours += hrs;
    placed.set(node.id, targetWeek);
  }
  flushWeek();

  const totalHours = orderedNodes.reduce((s, n) => s + (hoursPerLevel[n.level] || 4), 0);

  return {
    orderedNodes,
    weeks,
    totalHours,
    totalCount: orderedNodes.length,
    targetSet: new Set(targetIds),
    requiredSet: required,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Force Graph
 * ───────────────────────────────────────────────────────────── */

function ForceGraph({ nodes, links, selectedId, onSelect, fullPathIds, weighted, nodeWeights, maxWeight, targetIds, planIds }) {
  const svgRef = useRef(null);
  const gRef   = useRef(null);

  const prereqIds = useMemo(() =>
    links.filter(l => {
      const t = typeof l.target === "object" ? l.target.id : l.target;
      return t === selectedId;
    }).map(l => typeof l.source === "object" ? l.source.id : l.source),
    [links, selectedId]
  );

  const depIds = useMemo(() =>
    links.filter(l => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      return s === selectedId;
    }).map(l => typeof l.target === "object" ? l.target.id : l.target),
    [links, selectedId]
  );

  useEffect(() => {
    if (!nodes.length || !svgRef.current) return;
    const W = svgRef.current.clientWidth  || 1000;
    const H = svgRef.current.clientHeight || 700;
    d3.select(svgRef.current).selectAll("*").remove();
    const svg = d3.select(svgRef.current);

    const defs = svg.append("defs");
    ["default","sel"].forEach(id => {
      defs.append("marker")
        .attr("id", `arrow-${id}`)
        .attr("viewBox","0 -4 8 8").attr("refX",13).attr("refY",0)
        .attr("markerWidth",4).attr("markerHeight",4).attr("orient","auto")
        .attr("markerUnits","userSpaceOnUse")
        .append("path").attr("d","M0,-4L8,0L0,4")
        .attr("fill", id === "sel" ? "#059669" : "#64748B");
    });

    const g = svg.append("g");
    gRef.current = g;

    const zoom = d3.zoom().scaleExtent([0.04, 5])
      .on("zoom", e => g.attr("transform", e.transform));
    svg.call(zoom);

    const sim = d3.forceSimulation(nodes)
      .force("link",    d3.forceLink(links).id(d => d.id).distance(80).strength(0.4))
      .force("charge",  d3.forceManyBody().strength(-250))
      .force("center",  d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide(35))
      .force("x",       d3.forceX(d => W * 0.1 + (d.level - 1) * W * 0.25).strength(0.08))
      .force("y",       d3.forceY(H / 2).strength(0.02));

    const linkSel = g.append("g").selectAll("line").data(links).join("line")
      .attr("stroke","#94A3B8")
      .attr("stroke-width", d => {
        if (!weighted || !maxWeight) return 1.5;
        const sid = typeof d.source === "object" ? d.source.id : d.source;
        const w = nodeWeights.get(sid) || 0;
        return 0.5 + (w / maxWeight) * 4;
      })
      .attr("marker-end","url(#arrow-default)");

    const nodeSel = g.append("g").selectAll("g").data(nodes).join("g")
      .attr("cursor","pointer")
      .call(d3.drag()
        .on("start", (e,d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
        .on("drag",  (e,d) => { d.fx=e.x; d.fy=e.y; })
        .on("end",   (e,d) => { if (!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }))
      .on("click", (e,d) => { e.stopPropagation(); onSelect(d.id); });

    nodeSel.append("circle")
      .attr("r", d => {
        if (!weighted || !maxWeight) return 5 + (d.level - 1) * 2.5;
        const w = nodeWeights.get(d.id) || 0;
        return 4 + (w / maxWeight) * 12;
      })
      .attr("fill", d => DOMAINS[d.domain]?.color || "#2563EB")
      .attr("fill-opacity", 0.85)
      .attr("stroke","#fff").attr("stroke-width",1);

    // Gold target star (always drawn, scale via opacity)
    nodeSel.append("text")
      .attr("class","target-star")
      .attr("x", 0).attr("y", -12)
      .attr("text-anchor","middle")
      .attr("font-size","13px")
      .attr("fill","#D97706")
      .attr("pointer-events","none")
      .text("★");

    nodeSel.append("text")
      .attr("x", 10).attr("y", 4)
      .attr("fill","#374151").attr("font-size","9px")
      .attr("font-family","system-ui, sans-serif")
      .attr("pointer-events","none")
      .text(d => d.label.length > 28 ? d.label.slice(0,28)+"…" : d.label);

    sim.on("tick", () => {
      linkSel
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    setTimeout(() => {
      const bbox = g.node().getBBox();
      if (!bbox.width) return;
      const scale = Math.min(0.85, Math.min(W / bbox.width, H / bbox.height) * 0.8);
      const tx = W/2 - (bbox.x + bbox.width/2) * scale;
      const ty = H/2 - (bbox.y + bbox.height/2) * scale;
      svg.transition().duration(900)
        .call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
    }, 3000);

    return () => sim.stop();
  }, [nodes.length, links.length, weighted]);

  // Visual update on selection / plan / targets
  useEffect(() => {
    if (!gRef.current) return;
    const g = gRef.current;
    const directSet = new Set([...prereqIds, ...depIds]);
    const hasSel = !!selectedId;
    const hasPlan = planIds && planIds.size > 0;

    g.selectAll("circle")
      .attr("r", d => d.id === selectedId ? 14
        : (weighted && maxWeight) ? 4 + ((nodeWeights.get(d.id)||0) / maxWeight) * 12
        : 5 + (d.level-1)*2.5)
      .attr("fill-opacity", d => {
        if (hasSel) {
          if (fullPathIds.has(d.id) || d.id === selectedId) return 1;
          if (directSet.has(d.id)) return 0.85;
          return 0.12;
        }
        if (hasPlan) {
          if (planIds.has(d.id)) return 0.95;
          return 0.08;
        }
        return 0.85;
      })
      .attr("stroke", d => {
        if (d.id === selectedId) return "#1F2937";
        if (targetIds && targetIds.has(d.id)) return "#D97706";
        if (fullPathIds.has(d.id)) return "#D97706";
        return "#fff";
      })
      .attr("stroke-width", d => {
        if (d.id === selectedId) return 3;
        if (targetIds && targetIds.has(d.id)) return 3;
        if (fullPathIds.has(d.id)) return 2;
        return 1;
      });

    g.selectAll("text.target-star")
      .attr("opacity", d => (targetIds && targetIds.has(d.id)) ? 1 : 0);

    g.selectAll("text:not(.target-star)")
      .attr("fill", d => !hasSel && !hasPlan ? "#374151"
        : d.id === selectedId ? "#111827"
        : hasSel && fullPathIds.has(d.id) ? "#1F2937"
        : hasSel && directSet.has(d.id) ? "#374151"
        : hasPlan && planIds.has(d.id) ? "#1F2937"
        : "#D1D5DB");

    g.selectAll("line")
      .attr("stroke", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        const t = typeof d.target==="object"?d.target.id:d.target;
        if (s===selectedId) return "#059669";
        if (t===selectedId) return "#DC2626";
        if (fullPathIds.has(s) && fullPathIds.has(t)) return "#D97706";
        if (hasPlan && planIds.has(s) && planIds.has(t)) return "#D97706";
        return "#94A3B8";
      })
      .attr("stroke-width", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        const t = typeof d.target==="object"?d.target.id:d.target;
        if (s===selectedId||t===selectedId) return 3.5;
        if (fullPathIds.has(s) && fullPathIds.has(t)) return 2.5;
        if (hasPlan && planIds.has(s) && planIds.has(t)) return 2;
        if (weighted && maxWeight) {
          const w = nodeWeights.get(s) || 0;
          return 0.5 + (w / maxWeight) * 4;
        }
        return 1;
      })
      .attr("stroke-opacity", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        const t = typeof d.target==="object"?d.target.id:d.target;
        if (hasSel) {
          if (s===selectedId||t===selectedId) return 1;
          if (fullPathIds.has(s) && fullPathIds.has(t)) return 0.9;
          return 0.18;
        }
        if (hasPlan) {
          if (planIds.has(s) && planIds.has(t)) return 0.9;
          return 0.08;
        }
        return 1;
      })
      .attr("marker-end", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        return s===selectedId ? "url(#arrow-sel)" : "url(#arrow-default)";
      });
  }, [selectedId, prereqIds, depIds, fullPathIds, targetIds, planIds, weighted, maxWeight, nodeWeights]);

  return (
    <svg ref={svgRef}
      style={{ width:"100%", height:"100%", background:"#F8FAFC" }}
      onClick={() => onSelect(null)}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Career Picker (overlay)
 * ───────────────────────────────────────────────────────────── */

function CareerPicker({ fields, selected, onToggle, onClose, onConfirm }) {
  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, background:"rgba(15,23,42,0.6)",
        display:"flex", alignItems:"center", justifyContent:"center",
        zIndex:100, padding:24, overflowY:"auto",
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:"#FFFFFF", borderRadius:16, maxWidth:980, width:"100%",
          padding:32, boxShadow:"0 20px 60px rgba(0,0,0,0.2)",
        }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:13,color:"#64748B",letterSpacing:2,fontWeight:700}}>SCHRITT 1</div>
            <div style={{fontSize:24,fontWeight:700,color:"#0F172A"}}>Berufsziele wählen</div>
            <div style={{fontSize:14,color:"#64748B",marginTop:4}}>
              Wähle ein oder mehrere Zielberufe. Das System berechnet daraus deinen individuellen Studienplan.
            </div>
          </div>
          <button onClick={onClose} style={{
            background:"transparent",border:"1px solid #CBD5E1",color:"#64748B",
            padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:14,fontFamily:"inherit",
          }}>✕</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(380px, 1fr))",gap:16}}>
          {fields.map(f => {
            const isSel = selected.has(f.id);
            return (
              <div key={f.id}
                onClick={() => onToggle(f.id)}
                style={{
                  padding:20,borderRadius:12,cursor:"pointer",
                  background:isSel?`${f.color}08`:"#F8FAFC",
                  border:`2px solid ${isSel?f.color:"#E2E8F0"}`,
                  transition:"all 0.15s",
                }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                  <div style={{fontSize:28}}>{f.emoji}</div>
                  <div style={{fontSize:17,fontWeight:700,color:"#0F172A",flex:1}}>{f.label}</div>
                  <div style={{
                    width:24,height:24,borderRadius:"50%",
                    background:isSel?f.color:"transparent",
                    border:`2px solid ${isSel?f.color:"#CBD5E1"}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    color:"#fff",fontSize:14,fontWeight:700,
                  }}>{isSel?"✓":""}</div>
                </div>
                <div style={{fontSize:13,color:"#475569",marginBottom:10,lineHeight:1.6}}>
                  {f.description}
                </div>
                <div style={{fontSize:11,color:"#94A3B8",letterSpacing:1,marginBottom:6,fontWeight:600}}>
                  KOMPETENZEN AM ENDE
                </div>
                <ul style={{margin:0,paddingLeft:18,fontSize:12,color:"#475569",lineHeight:1.7}}>
                  {f.outcomes.map((o,i) => <li key={i}>{o}</li>)}
                </ul>
                <div style={{fontSize:11,color:"#94A3B8",marginTop:10}}>
                  {f.targets.length} Ziel-Kompetenzen · alle Voraussetzungen werden automatisch ergänzt
                </div>
              </div>
            );
          })}
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:24,paddingTop:20,borderTop:"1px solid #E2E8F0"}}>
          <div style={{fontSize:13,color:"#64748B"}}>
            <span style={{fontWeight:700,color:"#0F172A"}}>{selected.size}</span> Berufsziel{selected.size===1?"":"e"} gewählt
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={onClose} style={{
              background:"transparent",border:"1px solid #CBD5E1",color:"#475569",
              padding:"10px 20px",borderRadius:8,cursor:"pointer",fontSize:14,fontFamily:"inherit",
            }}>Abbrechen</button>
            <button
              onClick={onConfirm}
              disabled={selected.size === 0}
              style={{
                background:selected.size ? "#2563EB" : "#CBD5E1",
                border:"none", color:"#fff",
                padding:"10px 24px",borderRadius:8,
                cursor:selected.size?"pointer":"not-allowed",
                fontSize:14,fontFamily:"inherit",fontWeight:600,
              }}>Studienplan erstellen →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Plan View (weekly timeline)
 * ───────────────────────────────────────────────────────────── */

function PlanView({ plan, selectedCareers, careerFields, onSelectWeek, onSelectNode }) {
  if (!plan) {
    return (
      <div style={{padding:40,textAlign:"center",color:"#94A3B8",fontSize:15}}>
        Noch kein Studienplan erstellt. Klicke oben auf <b>{"„Mein Studium erstellen"}</b>.
      </div>
    );
  }

  const hoursPerWeek = plan.weeks.length > 0
    ? Math.ceil(Math.max(...plan.weeks.map(w => w.hours)))
    : 25;
  const semesters = (plan.weeks.length / 14).toFixed(1);

  return (
    <div style={{height:"100%",overflowY:"auto",padding:"20px 28px",background:"#F8FAFC"}}>

      {/* Stats banner */}
      <div style={{
        display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:14,marginBottom:22,
      }}>
        {[
          { label: "KOMPETENZEN", val: plan.totalCount, sub: `davon ${plan.targetSet.size} Ziele` },
          { label: "LERNSTUNDEN", val: plan.totalHours, sub: `≈ ${hoursPerWeek} h/Woche` },
          { label: "WOCHEN",      val: plan.weeks.length, sub: `≈ ${semesters} Semester` },
          { label: "BERUFSZIELE", val: selectedCareers.length, sub: selectedCareers.map(c=>c.emoji).join(" ") },
        ].map((s,i) => (
          <div key={i} style={{
            background:"#FFFFFF",borderRadius:10,padding:"14px 18px",
            border:"1px solid #E2E8F0",
          }}>
            <div style={{fontSize:11,color:"#94A3B8",letterSpacing:1.5,fontWeight:700}}>{s.label}</div>
            <div style={{fontSize:30,fontWeight:700,color:"#0F172A",lineHeight:1.1,marginTop:4}}>{s.val}</div>
            <div style={{fontSize:12,color:"#64748B",marginTop:2}}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Career chips */}
      <div style={{display:"flex",gap:8,marginBottom:22,flexWrap:"wrap"}}>
        {selectedCareers.map(c => (
          <div key={c.id} style={{
            display:"flex",alignItems:"center",gap:8,
            padding:"6px 14px",borderRadius:20,
            background:`${c.color}10`,border:`1px solid ${c.color}55`,
            color:c.color,fontWeight:600,fontSize:13,
          }}>
            <span style={{fontSize:16}}>{c.emoji}</span>
            {c.label}
          </div>
        ))}
      </div>

      {/* Weekly timeline */}
      <div style={{fontSize:14,color:"#64748B",letterSpacing:1,marginBottom:10,fontWeight:700}}>
        WOCHENPLAN · klicke auf eine Woche für den Stundenplan
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {plan.weeks.map((w, wi) => (
          <div key={wi}
            onClick={() => onSelectWeek(wi)}
            style={{
              background:"#FFFFFF",borderRadius:10,padding:"14px 18px",
              border:"1px solid #E2E8F0",cursor:"pointer",
              display:"grid",gridTemplateColumns:"80px 1fr 120px",gap:16,alignItems:"center",
              transition:"box-shadow 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(37,99,235,0.15)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
          >
            <div style={{
              background:"#EFF6FF",color:"#2563EB",
              padding:"8px 0",borderRadius:8,textAlign:"center",fontWeight:700,fontSize:14,
            }}>WOCHE<br/><span style={{fontSize:22}}>{wi+1}</span></div>

            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {w.items.map(({node, hours}) => {
                const isTarget = plan.targetSet.has(node.id);
                const dc = DOMAINS[node.domain];
                return (
                  <div key={node.id}
                    onClick={e => { e.stopPropagation(); onSelectNode(node.id); }}
                    style={{
                      display:"flex",alignItems:"center",gap:6,
                      padding:"4px 10px",borderRadius:16,
                      background:isTarget ? "#FFFBEB" : `${dc.color}08`,
                      border:`1px solid ${isTarget ? "#F59E0B" : dc.color+"44"}`,
                      fontSize:12,color:"#374151",cursor:"pointer",
                    }}>
                    {isTarget && <span style={{color:"#D97706"}}>★</span>}
                    <span style={{width:6,height:6,borderRadius:2,background:dc.color}}/>
                    <span>{node.label}</span>
                    <span style={{color:"#94A3B8",fontSize:11}}>{hours}h</span>
                  </div>
                );
              })}
            </div>

            <div style={{textAlign:"right"}}>
              <div style={{fontSize:18,fontWeight:700,color:"#0F172A"}}>{w.hours} h</div>
              <div style={{fontSize:11,color:"#94A3B8"}}>{w.items.length} Kompetenzen</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{textAlign:"center",marginTop:30,fontSize:12,color:"#94A3B8",lineHeight:1.8}}>
        Zeiten inkl. Self-Study, Übung und Kompetenzfreigabe.<br/>
        Reihenfolge topologisch korrekt — keine Kompetenz ohne ihre Voraussetzungen.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Week View (example schedule)
 * ───────────────────────────────────────────────────────────── */

function WeekView({ weekIdx, week, onBack }) {
  // Build a believable weekly calendar from the competencies in this week
  const days = ["Mo", "Di", "Mi", "Do", "Fr"];
  const hourLabels = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17"];

  const comp1 = week.items[0]?.node;
  const comp2 = week.items[1]?.node;
  const comp3 = week.items[2]?.node;

  // Activities: type, day, startHour, duration, title, subtitle, color
  const activities = [
    { day:0, start:0,  dur:2, type:"focus",    title:"Fokus-Block",       sub: comp1 ? comp1.label : "Theorie + Simulation",           color:"#2563EB", icon:"🎯" },
    { day:0, start:2,  dur:1.5, type:"drill",  title:"KI-Tutor Drill",    sub:"Übungen bis 90 % Trefferquote",                           color:"#16A34A", icon:"🤖" },
    { day:0, start:6,  dur:1.5, type:"peer",   title:"Peer-Lerngruppe",   sub:"3er-Gruppe · gegenseitig erklären",                       color:"#DB2777", icon:"👥" },
    { day:0, start:8,  dur:0.5, type:"review", title:"Spaced Repetition", sub:"alte Kompetenzen auffrischen",                            color:"#7C3AED", icon:"🔁" },

    { day:1, start:1,  dur:3, type:"project",  title:"Industrie-Challenge", sub:"echtes Problem aus Unternehmenspartner",                color:"#EA580C", icon:"🏗️" },
    { day:1, start:5,  dur:2, type:"lab",      title:"Labor / Maker Space", sub:"betreut durch Tutor:in",                                color:"#0891B2", icon:"🔧" },

    { day:2, start:2,  dur:2, type:"focus",    title:"Fokus-Block",       sub: comp2 ? comp2.label : "Neue Kompetenz",                   color:"#2563EB", icon:"🎯" },
    { day:2, start:5,  dur:0.5, type:"feedback", title:"Prof-Feedback",   sub:"20 min Colloquium",                                       color:"#D97706", icon:"🎓" },
    { day:2, start:6,  dur:0.5, type:"assess", title:"Kompetenzfreigabe", sub: comp1 ? `\u2713 \u201E${comp1.label}\u201C bestanden` : "Meilenstein",  color:"#059669", icon:"⭐" },

    { day:3, start:0,  dur:2, type:"focus",    title:"Fokus-Block",       sub: comp3 ? comp3.label : "Vertiefung",                       color:"#2563EB", icon:"🎯" },
    { day:3, start:3,  dur:2, type:"project",  title:"Projekt-Arbeit",    sub:"Industrie-Challenge fortsetzen",                           color:"#EA580C", icon:"🏗️" },
    { day:3, start:6,  dur:1, type:"mentor",   title:"Industriementor",   sub:"30 min Karriere-Gespräch",                                color:"#0F766E", icon:"💼" },

    { day:4, start:1,  dur:2, type:"drill",    title:"Mastery-Check",     sub:"Ergebnisse mit KI-Tutor validieren",                      color:"#16A34A", icon:"🤖" },
    { day:4, start:4,  dur:2, type:"focus",    title:"Vertiefung",        sub:"Freier Block · individuell wählbar",                      color:"#2563EB", icon:"🎯" },
    { day:4, start:7,  dur:1, type:"review",   title:"Wochenreflexion",   sub:"Fortschritt + Plan-Anpassung",                            color:"#7C3AED", icon:"🔁" },
  ];

  const HOUR = 46;
  const DAY_COL = 170;
  const LABEL_COL = 50;

  return (
    <div style={{height:"100%",overflow:"auto",padding:"20px 28px",background:"#F8FAFC"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <button onClick={onBack} style={{
            background:"transparent",border:"1px solid #CBD5E1",color:"#475569",
            padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:"inherit",marginBottom:10,
          }}>← Zurück zum Wochenplan</button>
          <div style={{fontSize:13,color:"#64748B",letterSpacing:2,fontWeight:700}}>BEISPIEL-STUNDENPLAN</div>
          <div style={{fontSize:24,fontWeight:700,color:"#0F172A"}}>Woche {weekIdx + 1}</div>
          <div style={{fontSize:14,color:"#64748B",marginTop:4}}>
            {week.items.length} Kompetenzen · {week.hours} Stunden — individuell auf dich zugeschnitten
          </div>
        </div>
        <div style={{textAlign:"right",fontSize:11,color:"#94A3B8",lineHeight:1.8}}>
          Keine Frontal-Vorlesung · Prof-Zeit gezielt eingesetzt<br/>
          Reine Lernzeit — Pausen/Mahlzeiten nicht dargestellt
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{
        background:"#FFFFFF",borderRadius:12,padding:20,border:"1px solid #E2E8F0",overflowX:"auto",
      }}>
        <div style={{display:"flex",position:"relative",minWidth: LABEL_COL + DAY_COL*5 + 10}}>
          {/* Hour labels */}
          <div style={{width:LABEL_COL,paddingTop:34}}>
            {hourLabels.map((h,i) => (
              <div key={i} style={{
                height:HOUR,fontSize:11,color:"#94A3B8",fontWeight:600,
                textAlign:"right",paddingRight:8,borderTop:"1px solid #F1F5F9",
              }}>{h}:00</div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, di) => (
            <div key={di} style={{width:DAY_COL,position:"relative",borderLeft:"1px solid #F1F5F9"}}>
              <div style={{
                height:34,display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:13,color:"#64748B",fontWeight:700,letterSpacing:1,
              }}>{day}</div>
              <div style={{position:"relative"}}>
                {hourLabels.map((_,i) => (
                  <div key={i} style={{height:HOUR,borderTop:"1px solid #F1F5F9"}}/>
                ))}
                {activities.filter(a => a.day === di).map((a,i) => {
                  const h = a.dur * HOUR - 6;
                  const tight = h < 42;        // too small for two lines
                  const veryTight = h < 24;    // too small even for comfortable single line
                  return (
                    <div key={i}
                      title={`${a.title} — ${a.sub}`}
                      style={{
                        position:"absolute",
                        top: a.start * HOUR + 4,
                        left:4, right:4,
                        height: h,
                        background:`${a.color}12`,
                        border:`1.5px solid ${a.color}`,
                        borderLeft:`4px solid ${a.color}`,
                        borderRadius:6,
                        padding: veryTight ? "2px 6px" : (tight ? "4px 7px" : "6px 8px"),
                        fontSize:11,
                        overflow:"hidden",
                        display:"flex",flexDirection:"column",
                        justifyContent:tight?"center":"flex-start",
                        gap:2,
                      }}>
                      <div style={{
                        display:"flex",alignItems:"center",gap:4,
                        color:a.color,fontWeight:700,
                        fontSize: veryTight ? 10 : tight ? 11 : 12,
                        minWidth:0,
                      }}>
                        <span style={{flexShrink:0}}>{a.icon}</span>
                        <span style={{
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0,
                        }}>{a.title}</span>
                      </div>
                      {!tight && (
                        <div style={{
                          color:"#475569",lineHeight:1.3,
                          overflow:"hidden",textOverflow:"ellipsis",
                          display:"-webkit-box",
                          WebkitBoxOrient:"vertical",
                          WebkitLineClamp: 2,
                        }}>{a.sub}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{marginTop:20,background:"#FFFFFF",borderRadius:12,padding:"16px 20px",border:"1px solid #E2E8F0"}}>
        <div style={{fontSize:12,color:"#94A3B8",letterSpacing:1.5,fontWeight:700,marginBottom:10}}>BAUSTEINE DIESES INDIVIDUELLEN STUDIUMS</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:10,fontSize:12,color:"#475569"}}>
          {[
            {icon:"🎯",t:"Fokus-Block",      d:"90–120 min Deep Work an einer Kompetenz"},
            {icon:"🤖",t:"KI-Tutor Drill",   d:"Übungen generiert, adaptiv, 24/7"},
            {icon:"👥",t:"Peer-Lerngruppe",  d:"Erkl\u00E4ren festigt \u2014 \u201EProt\u00E9g\u00E9-Effekt\u201C"},
            {icon:"🔁",t:"Spaced Repetition",d:"Alte Kompetenzen im Zyklus auffrischen"},
            {icon:"🏗️",t:"Industrie-Challenge",d:"Echtes Problem integriert mehrere Kompetenzen"},
            {icon:"🔧",t:"Labor / Maker Space",d:"Haptisches Können, Experimente, betreut"},
            {icon:"🎓",t:"Prof-Feedback",    d:"1:1 oder 3er-Runde, gezielt statt Frontal"},
            {icon:"⭐",t:"Kompetenzfreigabe", d:"Formaler Meilenstein — Open Badge"},
            {icon:"💼",t:"Industriementor",  d:"Kontakt zum Zielberufsfeld"},
          ].map((x,i) => (
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
              <div style={{fontSize:20,lineHeight:1}}>{x.icon}</div>
              <div>
                <div style={{fontWeight:600,color:"#1F2937"}}>{x.t}</div>
                <div style={{fontSize:11,color:"#94A3B8"}}>{x.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Concepts View
 * ───────────────────────────────────────────────────────────── */

function ConceptsView() {
  const concepts = [
    { icon:"🎓", title:"Professor:in neu gedacht", color:"#D97706",
      text:"Vorlesung entfällt. Professor:innen prüfen, coachen, kuratieren. Ihre Zeit fließt in 1:1 Feedback, Kompetenzfreigaben und Pfad-Qualität — nicht mehr in Frontal-Vorträge.",
      items:["Kompetenzfreigabe (formale Bestätigung)","Feedback-Sprechstunden","Kuratierung der Lernpfade"]
    },
    { icon:"🤖", title:"KI als persönlicher Tutor", color:"#16A34A",
      text:"LLM-Tutor rund um die Uhr: erklärt, übt, prüft. Kompetenz-Kontext steckt im System drin — der Tutor weiß was du schon kannst und wo du stehst.",
      items:["Adaptive Übungen","Sokratische Dialoge","Fehler-Diagnostik"]
    },
    { icon:"⭐", title:"Mastery-based progression", color:"#059669",
      text:"N\u00E4chste Kompetenz erst wenn die vorige wirklich sitzt. Keine Noten \u2014 nur \u201Ekann / kann noch nicht\u201C. Open Badges als kryptographisch signierter Nachweis.",
      items:["Bloom 2σ-Mastery-Modell","Open Badges / Verifiable Credentials","Kein Durch-Rauschen"]
    },
    { icon:"🔁", title:"Spaced Repetition", color:"#7C3AED",
      text:"Gelernte Kompetenzen werden im Kalender automatisch zur Wiederholung eingeplant. Wissen verflüchtigt sich nicht — Ziel ist lebenslange Verfügbarkeit.",
      items:["SuperMemo-Algorithmus","Feedback-getrieben","Lifelong Learning Konto"]
    },
    { icon:"👥", title:"Peer-Learning & Cohort", color:"#DB2777",
      text:"Studierende in derselben Kompetenz-Phase arbeiten zusammen. Erkl\u00E4ren ist der st\u00E4rkste Lernhebel (\u201EProt\u00E9g\u00E9-Effekt\u201C). Bringt auch soziales Studentenleben zur\u00FCck.",
      items:["Peer-Teaching","Cohort-Challenges","Study-Buddies automatisch gematcht"]
    },
    { icon:"🏗️", title:"Projekt- statt Fachstruktur", color:"#EA580C",
      text:"Statt Kompetenzen getrennt zu pauken, integriert ein echtes Projekt mehrere Kompetenzen. Industriepartner liefern authentische Probleme.",
      items:["Problem-Based Learning","Stage-Gate-Reviews","Capstone-Projekt am Ende"]
    },
    { icon:"💼", title:"Industrie im Lernsystem", color:"#0F766E",
      text:"Unternehmen sind nicht nur Arbeitgeber am Ende — sie sind Mentor:innen, Challenge-Steller:innen, Freigabe-Partner:innen während des Studiums.",
      items:["Industrie-Mentor pro Studi","Echte Challenges mit Budget","Frühzeitiges Matching"]
    },
    { icon:"🔧", title:"VR/AR + Digital Twins", color:"#0891B2",
      text:"Teure oder gefährliche Experimente virtuell, realitätsnah. Digital Twins echter Maschinen fernsteuerbar für Lernzwecke. Das skaliert Laborarbeit.",
      items:["VR-Schmelzprozesse","AR-Monteur-Training","Ferngesteuerte Labore"]
    },
    { icon:"📊", title:"Transparenter Fortschritt", color:"#2563EB",
      text:"Der Studierende sieht live wo er steht. Professor:innen sehen Kohorten-Muster. Arbeitgeber erhalten das Kompetenzprofil — nicht nur einen Notendurchschnitt.",
      items:["Live-Dashboard","Aggregierte Analytics","Portable Credentials"]
    },
  ];
  return (
    <div style={{height:"100%",overflowY:"auto",padding:"24px 28px",background:"#F8FAFC"}}>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:13,color:"#64748B",letterSpacing:2,fontWeight:700}}>BAUSTEINE</div>
        <div style={{fontSize:26,fontWeight:700,color:"#0F172A"}}>Was ersetzt die klassische Vorlesung?</div>
        <div style={{fontSize:15,color:"#64748B",marginTop:6,maxWidth:780,lineHeight:1.6}}>
          Die Vorlesung war ein Format für Informations­übertragung in einer Zeit ohne Internet.
          Heute kommt Wissen aus vielen Quellen. Die Universität fügt <b>Meisterschaft</b>, <b>Feedback</b> und <b>Netzwerk</b> hinzu — mit diesen Bausteinen:
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))",gap:14}}>
        {concepts.map((c,i) => (
          <div key={i} style={{
            background:"#FFFFFF",borderRadius:12,padding:20,
            border:"1px solid #E2E8F0",borderTop:`3px solid ${c.color}`,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{fontSize:26}}>{c.icon}</div>
              <div style={{fontSize:16,fontWeight:700,color:c.color}}>{c.title}</div>
            </div>
            <div style={{fontSize:13,color:"#475569",lineHeight:1.6,marginBottom:12}}>{c.text}</div>
            <ul style={{margin:0,paddingLeft:18,fontSize:12,color:"#64748B",lineHeight:1.8}}>
              {c.items.map((x,j) => <li key={j}>{x}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Main App
 * ───────────────────────────────────────────────────────────── */

export default function App() {
  const [allNodes,   setAllNodes]   = useState([]);
  const [allLinks,   setAllLinks]   = useState([]);
  const [careerFields, setCareerFields] = useState([]);
  const [careerMeta,   setCareerMeta]   = useState({ hoursPerLevel: DEFAULT_HOURS_PER_LEVEL, hoursPerWeek: DEFAULT_HOURS_PER_WEEK });

  const [selectedId, setSelectedId] = useState(null);
  const [domFilter,  setDomFilter]  = useState(null);
  const [levelFilter, setLevelFilter] = useState(null);
  const [search,     setSearch]     = useState("");
  const [view,       setView]       = useState("graph"); // graph | list | plan | concepts
  const [loading,    setLoading]    = useState(true);
  const [pathMode,   setPathMode]   = useState("domain");
  const [openGroups, setOpenGroups] = useState({});
  const [weighted,   setWeighted]   = useState(false);

  const [selectedCareerIds, setSelectedCareerIds] = useState(new Set());
  const [showPicker,      setShowPicker]      = useState(false);
  const [selectedWeek,    setSelectedWeek]    = useState(null);

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}competency_tree.json`).then(r => r.text()),
      fetch(`${import.meta.env.BASE_URL}career_fields.json`).then(r => r.json()).catch(() => null),
    ]).then(([tree, careers]) => {
      const cleaned = tree.replace(/^\s*\/\/.*$/gm, "");
      const data = JSON.parse(cleaned);
      const comps = data.competencies;
      const idSet = new Set(comps.map(c => c.id));
      const nodes = comps.map(c => ({ ...c }));
      const links = [];
      comps.forEach(c => {
        (c.prerequisites || []).forEach(pid => {
          if (idSet.has(pid)) links.push({ source: pid, target: c.id });
        });
      });
      setAllNodes(nodes);
      setAllLinks(links);
      if (careers) {
        setCareerFields(careers.fields || []);
        const hpl = careers.meta?.hoursPerCompetencyByLevel;
        const hpw = careers.meta?.hoursPerWeek;
        setCareerMeta({
          hoursPerLevel: hpl ? Object.fromEntries(Object.entries(hpl).map(([k,v])=>[+k,v])) : DEFAULT_HOURS_PER_LEVEL,
          hoursPerWeek: hpw || DEFAULT_HOURS_PER_WEEK,
        });
      }
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, []);

  const nodeWeights = useMemo(() =>
    allNodes.length ? computeNodeWeights(allNodes, allLinks) : new Map(),
    [allNodes, allLinks]
  );
  const maxWeight = useMemo(() => Math.max(1, ...nodeWeights.values()), [nodeWeights]);

  const selectedNode = allNodes.find(n => n.id === selectedId);

  const prereqIds = allLinks
    .filter(l => (typeof l.target==="object"?l.target.id:l.target) === selectedId)
    .map(l => typeof l.source==="object"?l.source.id:l.source);
  const depIds = allLinks
    .filter(l => (typeof l.source==="object"?l.source.id:l.source) === selectedId)
    .map(l => typeof l.target==="object"?l.target.id:l.target);

  const fullPathLayers = useMemo(() =>
    selectedId ? getFullPath(selectedId, allNodes, allLinks) : [],
    [selectedId, allNodes, allLinks]
  );
  const fullPathIds = useMemo(() => {
    const s = new Set();
    const selDomain = selectedNode?.domain;
    fullPathLayers.forEach(layer => layer.forEach(n => {
      if (pathMode === "all" || n.domain === selDomain) s.add(n.id);
    }));
    if (selectedId) s.add(selectedId);
    return s;
  }, [fullPathLayers, selectedId, pathMode, selectedNode?.domain]);

  // Career-driven selections
  const selectedCareers = useMemo(
    () => careerFields.filter(f => selectedCareerIds.has(f.id)),
    [careerFields, selectedCareerIds]
  );
  const targetIds = useMemo(() => {
    const s = new Set();
    selectedCareers.forEach(f => f.targets.forEach(t => s.add(t)));
    return s;
  }, [selectedCareers]);

  const plan = useMemo(() => computePlan(
    targetIds, allNodes, allLinks,
    careerMeta.hoursPerLevel, careerMeta.hoursPerWeek
  ), [targetIds, allNodes, allLinks, careerMeta]);

  const planIds = plan ? plan.requiredSet : new Set();

  // Visible filtered nodes (graph/list only)
  const visNodes = allNodes.filter(n => {
    if (domFilter && n.domain !== domFilter) return false;
    if (levelFilter && n.level !== levelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return n.label.toLowerCase().includes(q) || n.description?.toLowerCase().includes(q);
    }
    return true;
  });
  const visIdSet = new Set(visNodes.map(n => n.id));
  const visLinks = allLinks.filter(l => {
    const s = typeof l.source==="object"?l.source.id:l.source;
    const t = typeof l.target==="object"?l.target.id:l.target;
    return visIdSet.has(s) && visIdSet.has(t);
  });

  const domainStats = Object.keys(DOMAINS).map(k => ({
    key: k,
    count: allNodes.filter(n => n.domain === k).length,
  }));

  const handleSelect = (id) => setSelectedId(prev => prev === id ? null : id);

  const openPicker = () => { setShowPicker(true); };
  const closePicker = () => setShowPicker(false);
  const toggleCareer = (id) => {
    setSelectedCareerIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const confirmPicker = () => {
    setShowPicker(false);
    if (selectedCareerIds.size) setView("plan");
  };
  const resetCareers = () => {
    setSelectedCareerIds(new Set());
    setSelectedWeek(null);
  };

  return (
    <div style={{
      background:"#F1F5F9", height:"100vh", display:"flex",
      flexDirection:"column", color:"#1F2937",
      fontFamily:"system-ui, -apple-system, 'Segoe UI', sans-serif", overflow:"hidden",
    }}>

      {/* Header */}
      <div style={{
        padding:"12px 20px", background:"#FFFFFF",
        borderBottom:"1px solid #E2E8F0",
        display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
        boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <div>
          <div style={{fontSize:12,color:"#64748B",letterSpacing:2,fontWeight:700}}>KOMPETENZGRAPH · DEMO</div>
          <div style={{fontSize:20,fontWeight:700,color:"#0F172A"}}>Individuelles Studium</div>
        </div>

        <button onClick={openPicker} style={{
          background: selectedCareerIds.size ? "#FFFFFF" : "#2563EB",
          border: `1px solid ${selectedCareerIds.size ? "#2563EB" : "#2563EB"}`,
          color: selectedCareerIds.size ? "#2563EB" : "#FFFFFF",
          padding:"9px 20px",borderRadius:8,cursor:"pointer",
          fontSize:14,fontFamily:"inherit",fontWeight:700,
          marginLeft:12,
        }}>
          {selectedCareerIds.size
            ? `✓ ${selectedCareerIds.size} Berufsziel${selectedCareerIds.size>1?"e":""} — anpassen`
            : "✨ Mein Studium erstellen"}
        </button>
        {selectedCareerIds.size > 0 && (
          <button onClick={resetCareers} style={{
            background:"transparent",border:"1px solid #CBD5E1",color:"#64748B",
            padding:"8px 12px",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"inherit",
          }}>zurücksetzen</button>
        )}

        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input
            placeholder="Suchen…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background:"#F8FAFC",border:"1px solid #CBD5E1",
              color:"#1F2937",padding:"8px 14px",borderRadius:6,
              fontSize:14,outline:"none",width:180,fontFamily:"inherit",
            }}
          />
          {[
            {k:"graph",    label:"◉ Graph"},
            {k:"list",     label:"☰ Liste"},
            {k:"plan",     label:"📋 Plan", disabled: !plan},
            {k:"concepts", label:"💡 Konzepte"},
          ].map(v => (
            <button key={v.k}
              onClick={() => { if (!v.disabled) { setView(v.k); setSelectedWeek(null); } }}
              disabled={v.disabled}
              style={{
                background:view===v.k?"#EFF6FF":"#FFFFFF",
                border:`1px solid ${view===v.k?"#2563EB":"#CBD5E1"}`,
                color:view===v.k?"#2563EB":v.disabled?"#CBD5E1":"#64748B",
                padding:"8px 14px",borderRadius:6,
                cursor:v.disabled?"not-allowed":"pointer",
                fontSize:14,fontFamily:"inherit",fontWeight:view===v.k?600:400,
              }}>{v.label}</button>
          ))}
          <button onClick={() => setWeighted(w => !w)} style={{
            background:weighted?"#FFF7ED":"#FFFFFF",
            border:`1px solid ${weighted?"#EA580C":"#CBD5E1"}`,
            color:weighted?"#EA580C":"#64748B",
            padding:"8px 14px",borderRadius:6,cursor:"pointer",
            fontSize:13,fontFamily:"inherit",fontWeight:weighted?600:400,
          }}>{weighted?"⬤ Gewichtet":"○ Gleichmäßig"}</button>
        </div>
      </div>

      {/* Career chips bar (only if any selected) */}
      {selectedCareers.length > 0 && (
        <div style={{
          padding:"8px 20px",background:"#FFFBEB",borderBottom:"1px solid #FDE68A",
          display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:13,
        }}>
          <span style={{color:"#92400E",fontWeight:700}}>Deine Berufsziele:</span>
          {selectedCareers.map(c => (
            <span key={c.id} style={{
              display:"inline-flex",alignItems:"center",gap:6,
              padding:"3px 10px",borderRadius:14,
              background:"#FFFFFF",border:`1px solid ${c.color}55`,color:c.color,fontWeight:600,
            }}>
              {c.emoji} {c.label}
            </span>
          ))}
          {plan && (
            <span style={{marginLeft:"auto",color:"#92400E"}}>
              <b>{plan.totalCount}</b> Kompetenzen · <b>{plan.totalHours}</b> h · <b>{plan.weeks.length}</b> Wochen
            </span>
          )}
        </div>
      )}

      {/* Domain & Level filter (only on graph/list views) */}
      {(view === "graph" || view === "list") && (
        <div style={{
          padding:"10px 20px",borderBottom:"1px solid #E2E8F0",background:"#FFFFFF",
          display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",flexShrink:0,
        }}>
          <button onClick={() => setDomFilter(null)} style={{
            background:!domFilter?"#EFF6FF":"#FFFFFF",
            border:`1px solid ${!domFilter?"#2563EB":"#CBD5E1"}`,
            color:!domFilter?"#2563EB":"#475569",
            padding:"6px 14px",borderRadius:5,cursor:"pointer",
            fontSize:13,letterSpacing:1,whiteSpace:"nowrap",fontFamily:"inherit",
            fontWeight:!domFilter?600:400,
          }}>ALLE ({allNodes.length})</button>

          <span style={{width:1,height:20,background:"#E2E8F0",margin:"0 4px"}}/>
          {[1,2,3,4].map(l => {
            const active = levelFilter === l;
            const cnt = allNodes.filter(n => n.level === l && (!domFilter || n.domain === domFilter)).length;
            return (
              <button key={l}
                onClick={() => setLevelFilter(active ? null : l)}
                style={{
                  background:active?`${LEVEL_COLORS[l]}15`:"#FFFFFF",
                  border:`1px solid ${active?LEVEL_COLORS[l]:"#CBD5E1"}`,
                  color:active?LEVEL_COLORS[l]:"#475569",
                  padding:"6px 12px",borderRadius:5,cursor:"pointer",
                  fontSize:13,whiteSpace:"nowrap",fontFamily:"inherit",
                  fontWeight:active?700:400,
                  display:"flex",alignItems:"center",gap:5,
                }}
              >
                L{l} {LEVEL_NAMES[l]} <span style={{opacity:0.5}}>({cnt})</span>
              </button>
            );
          })}
          <span style={{width:1,height:20,background:"#E2E8F0",margin:"0 4px"}}/>

          {domainStats.map(({key,count}) => {
            const dc = DOMAINS[key];
            const active = domFilter === key;
            return (
              <button key={key}
                onClick={() => setDomFilter(active ? null : key)}
                style={{
                  background:active?`${dc.color}10`:"#FFFFFF",
                  border:`1px solid ${active?dc.color:"#CBD5E1"}`,
                  color:active?dc.color:"#475569",
                  padding:"6px 14px",borderRadius:5,cursor:"pointer",
                  fontSize:13,whiteSpace:"nowrap",fontFamily:"inherit",
                  display:"flex",alignItems:"center",gap:6,
                  fontWeight:active?600:400,
                }}>
                <span style={{width:8,height:8,borderRadius:2,background:dc.color}}/>
                {dc.label} {count>0&&<span style={{opacity:0.5}}>({count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Main area */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <div style={{flex:1,position:"relative",overflow:"hidden"}}>
          {loading ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#94A3B8",fontSize:14,letterSpacing:2}}>
              LADEN…
            </div>
          ) : view === "graph" ? (
            <ForceGraph
              nodes={visNodes}
              links={visLinks}
              selectedId={selectedId}
              onSelect={handleSelect}
              fullPathIds={fullPathIds}
              weighted={weighted}
              nodeWeights={nodeWeights}
              maxWeight={maxWeight}
              targetIds={targetIds}
              planIds={planIds}
            />
          ) : view === "list" ? (
            <div style={{height:"100%",overflowY:"auto",padding:"12px 20px",background:"#F8FAFC"}}>
              {visNodes
                .sort((a,b) => a.domain.localeCompare(b.domain)||a.level-b.level||a.label.localeCompare(b.label))
                .map(n => (
                  <div key={n.id}
                    onClick={() => handleSelect(n.id)}
                    style={{
                      padding:"8px 14px",marginBottom:3,cursor:"pointer",
                      background:n.id===selectedId?"#EFF6FF":"#FFFFFF",
                      border:`1px solid ${n.id===selectedId?DOMAINS[n.domain]?.color+"44":"#E2E8F0"}`,
                      borderLeft:`3px solid ${DOMAINS[n.domain]?.color||"#94A3B8"}`,
                      borderRadius:4,display:"flex",alignItems:"center",gap:12,
                    }}
                  >
                    <span style={{
                      fontSize:11,padding:"2px 7px",borderRadius:3,
                      background:`${LEVEL_COLORS[n.level]}15`,
                      color:LEVEL_COLORS[n.level],letterSpacing:1,whiteSpace:"nowrap",fontWeight:600,
                    }}>L{n.level}</span>
                    {targetIds.has(n.id) && <span style={{color:"#D97706",fontWeight:700}}>★</span>}
                    <span style={{fontSize:14,color:"#1F2937",flex:1}}>{n.label}</span>
                    <span style={{fontSize:12,color:"#94A3B8",whiteSpace:"nowrap"}}>{DOMAINS[n.domain]?.label}</span>
                  </div>
                ))}
            </div>
          ) : view === "plan" ? (
            selectedWeek !== null && plan?.weeks[selectedWeek] ? (
              <WeekView
                weekIdx={selectedWeek}
                week={plan.weeks[selectedWeek]}
                onBack={() => setSelectedWeek(null)}
              />
            ) : (
              <PlanView
                plan={plan}
                selectedCareers={selectedCareers}
                careerFields={careerFields}
                onSelectWeek={wi => setSelectedWeek(wi)}
                onSelectNode={id => { setView("graph"); setSelectedId(id); }}
              />
            )
          ) : view === "concepts" ? (
            <ConceptsView />
          ) : null}
        </div>

        {/* Sidebar — only on graph/list views */}
        {(view === "graph" || view === "list") && (
          <div style={{
            width:320,borderLeft:"1px solid #E2E8F0",
            background:"#FFFFFF",overflowY:"auto",flexShrink:0,
          }}>
            {selectedNode ? (
              <div style={{padding:18}}>
                <div style={{
                  fontSize:12,letterSpacing:2,marginBottom:8,fontWeight:600,
                  color:DOMAINS[selectedNode.domain]?.color||"#2563EB",
                }}>
                  {DOMAINS[selectedNode.domain]?.label?.toUpperCase()} · LEVEL {selectedNode.level}
                  {targetIds.has(selectedNode.id) && <span style={{color:"#D97706",marginLeft:8}}>★ ZIEL</span>}
                </div>
                <div style={{fontSize:17,fontWeight:700,color:"#0F172A",marginBottom:10,lineHeight:1.5}}>
                  {selectedNode.label}
                </div>
                <div style={{fontSize:14,color:"#475569",lineHeight:1.7,marginBottom:12}}>
                  {selectedNode.description}
                </div>
                {weighted && (
                  <div style={{
                    fontSize:12,color:"#EA580C",marginBottom:16,padding:"6px 10px",
                    background:"#FFF7ED",borderRadius:5,border:"1px solid #FDBA7440",
                    display:"flex",justifyContent:"space-between",
                  }}>
                    <span>Nachfolger (transitiv)</span>
                    <span style={{fontWeight:700}}>{nodeWeights.get(selectedId)||0}</span>
                  </div>
                )}

                <div style={{display:"flex",gap:5,marginBottom:20}}>
                  {[1,2,3,4].map(l => (
                    <div key={l} style={{
                      flex:1,height:5,borderRadius:3,
                      background:l<=selectedNode.level?LEVEL_COLORS[l]:"#E2E8F0",
                    }}/>
                  ))}
                </div>

                {prereqIds.length > 0 && (
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:12,color:"#DC2626",letterSpacing:1,marginBottom:6,fontWeight:700}}>
                      ▲ DIREKTE VORAUSSETZUNGEN ({prereqIds.length})
                    </div>
                    {prereqIds.map(id => {
                      const n = allNodes.find(x => x.id===id);
                      if (!n) return null;
                      return (
                        <div key={id} onClick={() => handleSelect(id)}
                          style={{fontSize:13,color:"#1F2937",padding:"5px 0",
                            cursor:"pointer",display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{width:8,height:8,borderRadius:2,
                            background:DOMAINS[n.domain]?.color,flexShrink:0}}/>
                          {n.label}
                        </div>
                      );
                    })}
                  </div>
                )}

                {depIds.length > 0 && (
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:12,color:"#059669",letterSpacing:1,marginBottom:6,fontWeight:700}}>
                      ▼ SCHALTET FREI ({depIds.length})
                    </div>
                    {depIds.map(id => {
                      const n = allNodes.find(x => x.id===id);
                      if (!n) return null;
                      return (
                        <div key={id} onClick={() => handleSelect(id)}
                          style={{fontSize:13,color:"#1F2937",padding:"5px 0",
                            cursor:"pointer",display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{width:8,height:8,borderRadius:2,
                            background:DOMAINS[n.domain]?.color,flexShrink:0}}/>
                          {n.label}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Learning path */}
                {fullPathLayers.length > 0 && (() => {
                  const allPathNodes = fullPathLayers.flat();
                  const filtered = pathMode === "domain"
                    ? allPathNodes.filter(n => n.domain === selectedNode.domain)
                    : allPathNodes;
                  const groups = {};
                  filtered.forEach(n => {
                    if (!groups[n.domain]) groups[n.domain] = [];
                    groups[n.domain].push(n);
                  });
                  Object.values(groups).forEach(g => g.sort((a,b) => a.level - b.level));
                  const sortedDomains = Object.keys(groups).sort((a,b) => {
                    if (a === selectedNode.domain) return -1;
                    if (b === selectedNode.domain) return 1;
                    return groups[b].length - groups[a].length;
                  });
                  return (
                    <div style={{marginTop:8,paddingTop:16,borderTop:"1px solid #E2E8F0"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontSize:13,color:"#B45309",letterSpacing:1,fontWeight:700}}>
                          ★ LERNPFAD ({filtered.length})
                        </div>
                        <div style={{display:"flex",gap:4}}>
                          {["domain","all"].map(m => (
                            <button key={m} onClick={() => { setPathMode(m); setOpenGroups({}); }}
                              style={{
                                background:pathMode===m?"#FFFBEB":"#FFFFFF",
                                border:`1px solid ${pathMode===m?"#D97706":"#CBD5E1"}`,
                                color:pathMode===m?"#B45309":"#94A3B8",
                                padding:"4px 10px",borderRadius:4,cursor:"pointer",
                                fontSize:12,fontFamily:"inherit",fontWeight:pathMode===m?600:400,
                              }}>
                              {m==="domain"?"Fach":"Alle"}
                            </button>
                          ))}
                        </div>
                      </div>
                      {sortedDomains.map(domKey => {
                        const dc = DOMAINS[domKey];
                        const items = groups[domKey];
                        const isOwnDomain = domKey === selectedNode.domain;
                        const isOpen = isOwnDomain || openGroups[domKey];
                        const toggleGroup = () => {
                          if (isOwnDomain) return;
                          setOpenGroups(prev => ({...prev, [domKey]: !prev[domKey]}));
                        };
                        return (
                          <div key={domKey} style={{marginBottom:8}}>
                            <div onClick={toggleGroup} style={{
                              display:"flex",alignItems:"center",gap:8,
                              padding:"7px 10px",borderRadius:5,
                              background:isOwnDomain?`${dc.color}08`:"#F8FAFC",
                              cursor:isOwnDomain?"default":"pointer",
                              border:`1px solid ${isOwnDomain?dc.color+"33":"#E2E8F0"}`,
                            }}>
                              {!isOwnDomain && <span style={{color:"#94A3B8",fontSize:11,width:14,textAlign:"center"}}>{isOpen?"▼":"▶"}</span>}
                              <span style={{width:8,height:8,borderRadius:2,background:dc.color,flexShrink:0}}/>
                              <span style={{fontSize:13,color:dc.color,fontWeight:600,flex:1}}>{dc.label}</span>
                              <span style={{fontSize:12,color:"#94A3B8",fontWeight:600}}>{items.length}</span>
                            </div>
                            {isOpen && items.map(n => (
                              <div key={n.id} onClick={() => handleSelect(n.id)} style={{
                                fontSize:13,color:"#374151",padding:"5px 8px 5px 22px",marginTop:1,
                                cursor:"pointer",display:"flex",gap:8,alignItems:"center",
                                borderLeft:`3px solid ${dc.color}44`,marginLeft:4,
                              }}>
                                <span style={{
                                  fontSize:10,padding:"1px 6px",borderRadius:3,fontWeight:600,
                                  background:`${LEVEL_COLORS[n.level]}12`,color:LEVEL_COLORS[n.level],
                                }}>L{n.level}</span>
                                <span style={{flex:1}}>{n.label}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{padding:18}}>
                {selectedCareerIds.size === 0 && (
                  <div style={{
                    background:"#EFF6FF",padding:14,borderRadius:8,marginBottom:20,
                    border:"1px solid #BFDBFE",
                  }}>
                    <div style={{fontSize:14,fontWeight:700,color:"#1E40AF",marginBottom:4}}>
                      ✨ Starte deinen individuellen Plan
                    </div>
                    <div style={{fontSize:13,color:"#1E40AF",lineHeight:1.5}}>
                      Klicke oben auf <b>{"„Mein Studium erstellen"}</b> — wähle Berufsziele und bekomme automatisch deinen Studienplan.
                    </div>
                  </div>
                )}
                <div style={{fontSize:14,color:"#94A3B8",lineHeight:2.2}}>
                  → Knoten klicken<br/>
                  → Ziehen zum Positionieren<br/>
                  → Scroll zum Zoomen<br/>
                  → Filter / Suche oben
                </div>
                <div style={{marginTop:24}}>
                  <div style={{fontSize:13,color:"#64748B",letterSpacing:1,marginBottom:10,fontWeight:700}}>LEVEL-VERTEILUNG</div>
                  {[1,2,3,4].map(l => {
                    const cnt = allNodes.filter(n=>n.level===l).length;
                    const pct = allNodes.length?(cnt/allNodes.length*100):0;
                    return (
                      <div key={l} style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#475569",marginBottom:3}}>
                          <span style={{color:LEVEL_COLORS[l],fontWeight:600}}>L{l} {LEVEL_NAMES[l]}</span>
                          <span>{cnt}</span>
                        </div>
                        <div style={{height:5,background:"#E2E8F0",borderRadius:3}}>
                          <div style={{height:"100%",width:`${pct}%`,background:LEVEL_COLORS[l],borderRadius:3}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{marginTop:24}}>
                  <div style={{fontSize:13,color:"#64748B",letterSpacing:1,marginBottom:10,fontWeight:700}}>DOMÄNEN</div>
                  {domainStats.filter(d=>d.count>0).map(({key,count}) => {
                    const dc = DOMAINS[key];
                    return (
                      <div key={key} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                        <span style={{width:8,height:8,borderRadius:2,background:dc.color,flexShrink:0}}/>
                        <span style={{fontSize:14,color:"#374151",flex:1}}>{dc.label}</span>
                        <span style={{fontSize:14,color:dc.color,fontWeight:700}}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Career Picker Overlay */}
      {showPicker && (
        <CareerPicker
          fields={careerFields}
          selected={selectedCareerIds}
          onToggle={toggleCareer}
          onClose={closePicker}
          onConfirm={confirmPicker}
        />
      )}
    </div>
  );
}
