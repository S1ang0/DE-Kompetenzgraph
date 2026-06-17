// Live profile computation — mirrors scripts/build_profiles.py + validate_profiles.py.
// A profile DEFINITION is { id, name, tagline, description, core_clusters[], allied_clusters[],
// threshold_cp, core_min_cp }. From it + the current modules we derive the eligible pool,
// substitutes and feasibility (C1 English-only, C2 FIN+FMB-only, CP reachable) — all live, so
// editing modules/clusters/profiles updates the graph and overlays immediately.

export const PROFILE_KINDS = new Set(["course", "lab", "seminar", "project"]);

export const isEnFinFmb = (m) =>
  (m.faculty === "FIN" || m.faculty === "FMB") && (m.language === "en" || m.language === "both");

const cp = (m) => m.cp || 0;
const sum = (arr) => arr.reduce((a, m) => a + cp(m), 0);

export function computeProfile(def, modules) {
  const core = new Set(def.core_clusters || []);
  const allied = new Set(def.allied_clusters || []);
  const all = new Set([...core, ...allied]);
  const threshold = def.threshold_cp ?? 30;
  const coreMin = def.core_min_cp ?? 18;

  const inScope = (m) =>
    all.has(m.cluster) || (m.secondary_clusters || []).some((s) => all.has(s));
  const scope = modules.filter((m) => inScope(m) && PROFILE_KINDS.has(m.kind));
  const eligible = scope.filter(isEnFinFmb);                 // required pool (C1+C2 hold by construction)
  const substitutes = scope.filter((m) => !isEnFinFmb(m));   // German FIN/FMB or FEIT — optional only
  const coreEligible = eligible.filter((m) => core.has(m.cluster));

  const coreCP = sum(coreEligible);
  const totalCP = sum(eligible);

  // greedy example: fill the core requirement, then widen to the threshold
  const chosen = [];
  let cs = 0, ts = 0;
  for (const m of [...coreEligible].sort((a, b) => cp(b) - cp(a))) {
    if (cs >= coreMin) break;
    chosen.push(m); cs += cp(m); ts += cp(m);
  }
  const ids = new Set(chosen.map((m) => m.id));
  for (const m of [...eligible].sort((a, b) => cp(b) - cp(a))) {
    if (ts >= threshold) break;
    if (ids.has(m.id)) continue;
    chosen.push(m); ids.add(m.id); ts += cp(m);
  }
  const reachable = cs >= coreMin && ts >= threshold;

  return {
    ...def,
    threshold_cp: threshold,
    core_min_cp: coreMin,
    eligible_pool: eligible.map((m) => m.id),
    core_eligible_pool: coreEligible.map((m) => m.id),
    substitutes: substitutes.map((m) => m.id),
    stats: {
      n_eligible: eligible.length,
      n_core_eligible: coreEligible.length,
      n_substitutes: substitutes.length,
      core_en_cp: coreCP,
      total_en_cp: totalCP,
    },
    example_selection: reachable ? chosen.map((m) => m.id) : null,
    example_total_cp: reachable ? ts : null,
    example_core_cp: reachable ? cs : null,
    reachable_en_finfmb: reachable,
  };
}

export const computeProfiles = (defs, modules) =>
  defs.map((d) => computeProfile(d, modules));

// extract a plain definition from a (possibly computed) profile object
export const toDef = (p) => ({
  id: p.id,
  name: p.name,
  tagline: p.tagline || "",
  description: p.description || "",
  core_clusters: [...(p.core_clusters || [])],
  allied_clusters: [...(p.allied_clusters || [])],
  threshold_cp: p.threshold_cp ?? 30,
  core_min_cp: p.core_min_cp ?? 18,
});
