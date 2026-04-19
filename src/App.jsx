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

/* ── Compute structural weight per node: number of transitive descendants ── */
function computeNodeWeights(allNodes, allLinks) {
  // Build children lookup: parent → [child ids]
  const childMap = new Map();
  allLinks.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (!childMap.has(s)) childMap.set(s, []);
    childMap.get(s).push(t);
  });
  // BFS forward from each node to count all transitive descendants
  const weights = new Map();
  for (const node of allNodes) {
    const visited = new Set();
    let frontier = [node.id];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const cid of (childMap.get(id) || [])) {
          if (!visited.has(cid)) {
            visited.add(cid);
            next.push(cid);
          }
        }
      }
      frontier = next;
    }
    weights.set(node.id, visited.size); // 0 for leaves
  }
  return weights;
}

/* ── Recursively collect the full prerequisite chain (BFS, level by level) ── */
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

function ForceGraph({ nodes, links, selectedId, onSelect, fullPathIds, weighted, nodeWeights, maxWeight }) {
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

  // Visual update on selection
  useEffect(() => {
    if (!gRef.current) return;
    const g = gRef.current;
    const directSet = new Set([...prereqIds, ...depIds]);
    const hasSel = !!selectedId;

    g.selectAll("circle")
      .attr("r",            d => d.id === selectedId ? 14 : 5 + (d.level-1)*2.5)
      .attr("fill-opacity", d => !hasSel ? 0.85 :
        fullPathIds.has(d.id)||d.id===selectedId ? 1 :
        directSet.has(d.id) ? 0.85 : 0.12)
      .attr("stroke",       d => d.id === selectedId ? "#1F2937" :
        fullPathIds.has(d.id) ? "#D97706" : "#fff")
      .attr("stroke-width", d => d.id === selectedId ? 3 : fullPathIds.has(d.id) ? 2 : 1);

    g.selectAll("text")
      .attr("fill", d => !hasSel ? "#374151" :
        d.id===selectedId ? "#111827" :
        fullPathIds.has(d.id) ? "#1F2937" :
        directSet.has(d.id) ? "#374151" : "#D1D5DB");

    g.selectAll("line")
      .attr("stroke", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        const t = typeof d.target==="object"?d.target.id:d.target;
        if (!hasSel) return "#94A3B8";
        if (s===selectedId) return "#059669";
        if (t===selectedId) return "#DC2626";
        if (fullPathIds.has(s) && fullPathIds.has(t)) return "#D97706";
        return "#CBD5E1";
      })
      .attr("stroke-width", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        const t = typeof d.target==="object"?d.target.id:d.target;
        if (s===selectedId||t===selectedId) return 3.5;
        if (fullPathIds.has(s) && fullPathIds.has(t)) return 2.5;
        if (weighted && maxWeight) {
          const w = nodeWeights.get(s) || 0;
          return 0.5 + (w / maxWeight) * 4;
        }
        return 1;
      })
      .attr("stroke-opacity", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        const t = typeof d.target==="object"?d.target.id:d.target;
        if (!hasSel) return 1;
        if (s===selectedId||t===selectedId) return 1;
        if (fullPathIds.has(s) && fullPathIds.has(t)) return 0.9;
        return 0.25;
      })
      .attr("marker-end", d => {
        const s = typeof d.source==="object"?d.source.id:d.source;
        return s===selectedId ? "url(#arrow-sel)" : "url(#arrow-default)";
      });
  }, [selectedId, prereqIds, depIds, fullPathIds]);

  return (
    <svg ref={svgRef}
      style={{ width:"100%", height:"100%", background:"#F8FAFC" }}
      onClick={() => onSelect(null)}
    />
  );
}

export default function App() {
  const [allNodes,   setAllNodes]   = useState([]);
  const [allLinks,   setAllLinks]   = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [domFilter,  setDomFilter]  = useState(null);
  const [search,     setSearch]     = useState("");
  const [view,       setView]       = useState("graph");
  const [loading,    setLoading]    = useState(true);
  const [pathMode,   setPathMode]   = useState("domain");
  const [openGroups, setOpenGroups] = useState({});
  const [weighted,   setWeighted]   = useState(false);
  const [levelFilter, setLevelFilter] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}competency_tree.json`)
      .then(r => r.text())
      .then(text => {
        const cleaned = text.replace(/^\s*\/\/.*$/gm, "");
        return JSON.parse(cleaned);
      })
      .then(data => {
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
        setLoading(false);
      })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  // Compute structural weights: how many transitive descendants each node has
  const nodeWeights = useMemo(() =>
    allNodes.length ? computeNodeWeights(allNodes, allLinks) : new Map(),
    [allNodes, allLinks]
  );
  const maxWeight = useMemo(() =>
    Math.max(1, ...nodeWeights.values()),
    [nodeWeights]
  );

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

  const visNodes = allNodes.filter(n => {
    if (domFilter && n.domain !== domFilter) return false;
    if (levelFilter && n.level !== levelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return n.label.toLowerCase().includes(q) || n.description?.toLowerCase().includes(q);
    }
    return true;
  });
  const visIds   = new Set(visNodes.map(n => n.id));
  const visLinks = allLinks.filter(l => {
    const s = typeof l.source==="object"?l.source.id:l.source;
    const t = typeof l.target==="object"?l.target.id:l.target;
    return visIds.has(s) && visIds.has(t);
  });

  const domainStats = Object.keys(DOMAINS).map(k => ({
    key: k,
    count: allNodes.filter(n => n.domain === k).length,
  }));

  const handleSelect = (id) => setSelectedId(prev => prev === id ? null : id);

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
        display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
        boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <div>
          <div style={{fontSize:12,color:"#64748B",letterSpacing:2,fontWeight:700}}>KOMPETENZGRAPH</div>
          <div style={{fontSize:20,fontWeight:700,color:"#0F172A"}}>
            Maschinenbau B.Sc.
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:14,color:"#475569"}}>
            <span style={{color:"#2563EB",fontWeight:700}}>{allNodes.length}</span> Kompetenzen &nbsp;
            <span style={{color:"#059669",fontWeight:700}}>{allLinks.length}</span> Abhängigkeiten
          </span>
          <input
            placeholder="Suchen…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background:"#F8FAFC",border:"1px solid #CBD5E1",
              color:"#1F2937",padding:"8px 14px",borderRadius:6,
              fontSize:14,outline:"none",width:200,fontFamily:"inherit",
            }}
          />
          {["graph","list"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              background:view===v?"#EFF6FF":"#FFFFFF",
              border:`1px solid ${view===v?"#2563EB":"#CBD5E1"}`,
              color:view===v?"#2563EB":"#64748B",
              padding:"8px 16px",borderRadius:6,cursor:"pointer",
              fontSize:14,fontFamily:"inherit",fontWeight:view===v?600:400,
            }}>{v==="graph"?"◉ Graph":"☰ Liste"}</button>
          ))}
          <button onClick={() => setWeighted(w => !w)} style={{
            background:weighted?"#FFF7ED":"#FFFFFF",
            border:`1px solid ${weighted?"#EA580C":"#CBD5E1"}`,
            color:weighted?"#EA580C":"#64748B",
            padding:"8px 16px",borderRadius:6,cursor:"pointer",
            fontSize:14,fontFamily:"inherit",fontWeight:weighted?600:400,
          }}>{weighted?"⬤ Gewichtet":"○ Gleichmäßig"}</button>
          {selectedId && (
            <button onClick={() => setSelectedId(null)} style={{
              background:"#FFFFFF",border:"1px solid #CBD5E1",
              color:"#64748B",padding:"8px 16px",borderRadius:6,
              cursor:"pointer",fontSize:14,fontFamily:"inherit",
            }}>✕ Reset</button>
          )}
        </div>
      </div>

      {/* Domain filter */}
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

        {/* Level filter L1–L4 */}
        <span style={{width:1,height:20,background:"#E2E8F0",margin:"0 4px"}}/>
        {[1,2,3,4].map(l => {
          const active = levelFilter === l;
          const cnt = allNodes.filter(n => n.level === l && (!domFilter || n.domain === domFilter)).length;
          const names = ["Grundlage","Aufbau","Vertiefung","Experte"];
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
              L{l} {names[l-1]} <span style={{opacity:0.5}}>({cnt})</span>
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
              }}
            >
              <span style={{width:8,height:8,borderRadius:2,background:dc.color}}/>
              {dc.label} {count>0&&<span style={{opacity:0.5}}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Main */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* Graph/List area */}
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
            />
          ) : (
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
                    <span style={{fontSize:14,color:"#1F2937",flex:1}}>{n.label}</span>
                    <span style={{fontSize:12,color:"#94A3B8",whiteSpace:"nowrap"}}>{DOMAINS[n.domain]?.label}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
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

              {/* Level bar */}
              <div style={{display:"flex",gap:5,marginBottom:20}}>
                {[1,2,3,4].map(l => (
                  <div key={l} style={{
                    flex:1,height:5,borderRadius:3,
                    background:l<=selectedNode.level?LEVEL_COLORS[l]:"#E2E8F0",
                  }}/>
                ))}
              </div>

              {/* Direct Prereqs */}
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

              {/* Direct Deps */}
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

              {/* ═══ LEARNING PATH — grouped by domain ═══ */}
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
                const totalCount = filtered.length;

                return (
                  <div style={{
                    marginTop:8,paddingTop:16,
                    borderTop:"1px solid #E2E8F0",
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:13,color:"#B45309",letterSpacing:1,fontWeight:700}}>
                        ★ LERNPFAD ({totalCount})
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

                    <div style={{fontSize:12,color:"#94A3B8",marginBottom:12,lineHeight:1.5}}>
                      {pathMode==="domain"
                        ? `Nur ${DOMAINS[selectedNode.domain]?.label}-Voraussetzungen:`
                        : "Alle Domänen — klick zum Auf-/Zuklappen:"}
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
                          <div onClick={toggleGroup}
                            style={{
                              display:"flex",alignItems:"center",gap:8,
                              padding:"7px 10px",borderRadius:5,
                              background:isOwnDomain?`${dc.color}08`:"#F8FAFC",
                              cursor:isOwnDomain?"default":"pointer",
                              border:`1px solid ${isOwnDomain?dc.color+"33":"#E2E8F0"}`,
                            }}>
                            {!isOwnDomain && (
                              <span style={{color:"#94A3B8",fontSize:11,width:14,textAlign:"center"}}>
                                {isOpen?"▼":"▶"}
                              </span>
                            )}
                            <span style={{width:8,height:8,borderRadius:2,background:dc.color,flexShrink:0}}/>
                            <span style={{fontSize:13,color:dc.color,fontWeight:600,flex:1}}>
                              {dc.label}
                            </span>
                            <span style={{fontSize:12,color:"#94A3B8",fontWeight:600}}>{items.length}</span>
                          </div>

                          {isOpen && items.map(n => (
                            <div key={n.id}
                              onClick={() => handleSelect(n.id)}
                              style={{
                                fontSize:13,color:"#374151",padding:"5px 8px 5px 22px",marginTop:1,
                                cursor:"pointer",display:"flex",gap:8,alignItems:"center",
                                borderLeft:`3px solid ${dc.color}44`,
                                marginLeft:4,
                              }}>
                              <span style={{
                                fontSize:10,padding:"1px 6px",borderRadius:3,fontWeight:600,
                                background:`${LEVEL_COLORS[n.level]}12`,
                                color:LEVEL_COLORS[n.level],
                              }}>L{n.level}</span>
                              <span style={{flex:1}}>{n.label}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}

                    <div style={{textAlign:"center",color:"#CBD5E1",fontSize:18,padding:"4px 0"}}>↓</div>

                    <div style={{
                      fontSize:14,fontWeight:700,color:"#B45309",padding:"10px 12px",
                      background:"#FFFBEB",borderRadius:6,
                      border:"1px solid #FDE68A",
                      display:"flex",gap:8,alignItems:"center",
                    }}>
                      <span style={{fontSize:10,padding:"2px 6px",borderRadius:3,fontWeight:600,
                        background:`${LEVEL_COLORS[selectedNode.level]}15`,
                        color:LEVEL_COLORS[selectedNode.level],
                      }}>L{selectedNode.level}</span>
                      ★ {selectedNode.label}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{padding:18}}>
              <div style={{fontSize:14,color:"#94A3B8",lineHeight:2.2}}>
                → Knoten klicken<br/>
                → Ziehen zum Positionieren<br/>
                → Scroll zum Zoomen<br/>
                → Filter oben<br/>
                → Suche nach Begriff
              </div>
              <div style={{marginTop:24}}>
                <div style={{fontSize:13,color:"#64748B",letterSpacing:1,marginBottom:10,fontWeight:700}}>LEVEL-VERTEILUNG</div>
                {[1,2,3,4].map(l => {
                  const cnt = allNodes.filter(n=>n.level===l).length;
                  const pct = allNodes.length?(cnt/allNodes.length*100):0;
                  return (
                    <div key={l} style={{marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#475569",marginBottom:3}}>
                        <span style={{color:LEVEL_COLORS[l],fontWeight:600}}>
                          L{l} {["Grundlage","Aufbau","Vertiefung","Experte"][l-1]}
                        </span>
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
      </div>
    </div>
  );
}
