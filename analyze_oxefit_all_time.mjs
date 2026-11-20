#!/usr/bin/env node
/**
 * Extract & Cross-Correlate All-Time OxeFit XS1 Vault (Day 1: 2024-12-19 -> Present)
 * against MorphoScan Body Composition, Fitbit Air / Oura Steps & Sleep, and MacroFactor Nutrition.
 */
import fs from 'node:fs';
import path from 'node:path';

const STEP_RAW = 'C:/Users/shaun/.gemini/antigravity/brain/222cc12b-d116-4311-b063-dab4ad5e0f32/.system_generated/steps/741/output.txt';
const VAULT_OUT = 'c:/projects/Ketovore/super-ketovore-dashboard/oxefit_all_time_vault.json';
const HIST_2026 = 'c:/projects/Ketovore/super-ketovore-dashboard/history_2026_full.json';

const rawTxt = fs.readFileSync(STEP_RAW, 'utf8');
const jsonStart = rawTxt.indexOf('```json');
const jsonEnd = rawTxt.lastIndexOf('```');
const jsonStr = jsonStart !== -1 ? rawTxt.slice(jsonStart + 7, jsonEnd).trim() : rawTxt.slice(rawTxt.indexOf('{')).trim();
const vault = JSON.parse(jsonStr);

fs.writeFileSync(VAULT_OUT, JSON.stringify(vault, null, 2), 'utf8');
console.log(`Saved ${vault.total_sessions} sessions (${vault.first_session_date} -> ${vault.latest_session_date}) to ${VAULT_OUT}`);

const hist2026 = JSON.parse(fs.readFileSync(HIST_2026, 'utf8'));
const dayMap2026 = {};
for (const r of hist2026.daily_records) dayMap2026[r.date] = r;

// Sort sessions chronologically ascending
const sessions = [...vault.sessions].sort((a, b) => (a.started || a.date).localeCompare(b.started || b.date));

// 1. Monthly Rollup across 2024-12 -> 2026-11
const byMonth = {};
for (const s of sessions) {
  const ym = s.date.slice(0, 7);
  if (!byMonth[ym]) byMonth[ym] = { ym, sessions: 0, sets: 0, volume_lb: 0, tut_sec: 0, max_pwr: 0, exercises: new Set(), wall_mins: [] };
  const m = byMonth[ym];
  m.sessions++;
  m.sets += s.set_count || 0;
  m.volume_lb += s.total_volume_lb || 0;
  m.tut_sec += s.tut_sec || 0;
  if (s.session_wall_sec && s.session_wall_sec < 14400) m.wall_mins.push(Math.round(s.session_wall_sec / 60));
  for (const e of s.exercises || []) {
    m.exercises.add(e.name);
    if ((e.power_max_w || 0) > m.max_pwr) m.max_pwr = e.power_max_w;
  }
}

console.log('\n=== MONTHLY OXEFIT ROLLUP (DEC 2024 -> NOV 2026) ===');
for (const ym of Object.keys(byMonth).sort()) {
  const m = byMonth[ym];
  const avgVol = Math.round(m.volume_lb / m.sessions);
  const avgWall = m.wall_mins.length ? Math.round(m.wall_mins.reduce((a, b) => a + b, 0) / m.wall_mins.length) : 0;
  console.log(`${ym}: ${String(m.sessions).padStart(2)} sess | ${String(m.sets).padStart(3)} sets | Vol: ${m.volume_lb.toLocaleString().padStart(7)} lb (${avgVol.toLocaleString()} lb/sess) | PeakW: ${m.max_pwr}W | AvgWall: ${avgWall}m | UniqueEx: ${m.exercises.size}`);
}

// 2. Exercise Leaderboard & All-Time PRs
const byEx = {};
let advModeCount = 0;
const advModesSeen = {};
for (const s of sessions) {
  for (const st of s.sets || []) {
    if (st.adv && Object.keys(st.adv).length) {
      advModeCount++;
      const k = JSON.stringify(st.adv);
      advModesSeen[k] = (advModesSeen[k] || 0) + 1;
    }
  }
  for (const e of s.exercises || []) {
    if (!byEx[e.name]) {
      byEx[e.name] = {
        name: e.name,
        code: e.code,
        sessions: 0,
        total_sets: 0,
        total_reps: 0,
        total_vol_lb: 0,
        max_base_lb: 0,
        max_base_date: '',
        max_e1rm_lb: 0,
        max_e1rm_date: '',
        max_pwr_w: 0,
        max_pwr_date: '',
        max_vel_ms: 0,
        latest_date: '',
        latest_base_lb: 0,
        latest_e1rm_lb: 0,
        latest_pwr_w: 0,
      };
    }
    const x = byEx[e.name];
    x.sessions++;
    x.total_sets += e.sets || 0;
    x.total_reps += e.reps || 0;
    x.total_vol_lb += e.volume_lb || 0;
    if ((e.base_lb || 0) >= x.max_base_lb) { x.max_base_lb = e.base_lb || 0; x.max_base_date = s.date; }
    if ((e.pred_1rm_lb || 0) >= x.max_e1rm_lb) { x.max_e1rm_lb = e.pred_1rm_lb || 0; x.max_e1rm_date = s.date; }
    if ((e.power_max_w || 0) >= x.max_pwr_w) { x.max_pwr_w = e.power_max_w || 0; x.max_pwr_date = s.date; }
    if ((e.vel_max_ms || 0) > x.max_vel_ms) x.max_vel_ms = e.vel_max_ms;
    x.latest_date = s.date;
    x.latest_base_lb = e.base_lb || 0;
    x.latest_e1rm_lb = e.pred_1rm_lb || 0;
    x.latest_pwr_w = e.power_max_w || 0;
  }
}

console.log('\n=== TOP 20 EXERCISES BY TOTAL ALL-TIME VOLUME & PRs ===');
const topEx = Object.values(byEx).sort((a, b) => b.total_vol_lb - a.total_vol_lb).slice(0, 22);
for (const x of topEx) {
  console.log(`${x.name.padEnd(28)} | ${String(x.sessions).padStart(2)}x (${String(x.total_sets).padStart(3)} sets) | Vol: ${x.total_vol_lb.toLocaleString().padStart(7)} lb | MaxLoad: ${x.max_base_lb} lb (${x.max_base_date}) | Max1RM: ${x.max_e1rm_lb} lb (${x.max_e1rm_date}) | PeakW: ${x.max_pwr_w}W (${x.max_pwr_date}) | Latest: ${x.latest_base_lb}lb/${x.latest_e1rm_lb}e1RM (${x.latest_date})`);
}

console.log('\n=== ADVANCED RESISTANCE MODES USED ACROSS ALL SETS ===');
console.log('Total sets with advancedSettings:', advModeCount, advModesSeen);

// 3. Epoch / Era Forensic Comparison in 2025-2026
function analyzeEra(label, start, end) {
  const eraSess = sessions.filter(s => s.date >= start && s.date <= end);
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
  const weeks = days / 7;
  const totVol = eraSess.reduce((a, b) => a + (b.total_volume_lb || 0), 0);
  const totSets = eraSess.reduce((a, b) => a + (b.set_count || 0), 0);
  const totTut = eraSess.reduce((a, b) => a + (b.tut_sec || 0), 0);
  const exCounts = {};
  const hourBuckets = { morning_lt12: 0, prime_12_17: 0, evening_gt17: 0 };
  for (const s of eraSess) {
    // Convert UTC started to EST/EDT approx (-5h)
    const utcH = s.started ? new Date(s.started).getUTCHours() : 17;
    const estH = (utcH - 5 + 24) % 24;
    if (estH < 12) hourBuckets.morning_lt12++;
    else if (estH < 17) hourBuckets.prime_12_17++;
    else hourBuckets.evening_gt17++;
    for (const e of s.exercises || []) exCounts[e.name] = (exCounts[e.name] || 0) + 1;
  }
  const top3Ex = Object.entries(exCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(', ');

  // 2026 biometric cross-ref if in 2026
  const dRows = hist2026.daily_records.filter(r => r.date >= start && r.date <= end);
  const avgSteps = dRows.length ? Math.round(dRows.reduce((s, r) => s + (r.steps || 0), 0) / dRows.length) : null;
  const kcalRows = dRows.filter(r => r.nutrition?.kcal);
  const avgKcal = kcalRows.length ? Math.round(kcalRows.reduce((s, r) => s + r.nutrition.kcal, 0) / kcalRows.length) : null;
  const avgProt = kcalRows.length ? Math.round(kcalRows.reduce((s, r) => s + (r.nutrition.protein_g || 0), 0) / kcalRows.length) : null;
  const slRows = dRows.filter(r => r.sleep_min);
  const avgSleepMin = slRows.length ? Math.round(slRows.reduce((s, r) => s + r.sleep_min, 0) / slRows.length) : null;
  const wtRows = dRows.filter(r => r.weight_lb != null);
  const wStart = wtRows.length ? wtRows[0].weight_lb : null;
  const wEnd = wtRows.length ? wtRows[wtRows.length - 1].weight_lb : null;

  console.log(`\n[${label}] (${start} -> ${end}, ${days}d / ${weeks.toFixed(1)}wk)`);
  console.log(`  OxeFit: ${eraSess.length} sessions (${(eraSess.length / weeks).toFixed(2)}/wk) | Sets: ${totSets} (${(totSets / weeks).toFixed(1)}/wk) | Vol: ${totVol.toLocaleString()} lb (${Math.round(totVol / weeks).toLocaleString()} lb/wk, ${eraSess.length ? Math.round(totVol / eraSess.length).toLocaleString() : 0} lb/sess) | TUT: ${Math.round(totTut / 60)}m`);
  console.log(`  Time-of-Day (EST): AM(<12p)=${hourBuckets.morning_lt12}, Prime(12-5p)=${hourBuckets.prime_12_17}, Eve(>5p)=${hourBuckets.evening_gt17}`);
  console.log(`  Core Lifts: ${top3Ex}`);
  if (dRows.length) {
    console.log(`  Biometrics: Weight ${wStart} -> ${wEnd} lb | Avg Steps: ${avgSteps?.toLocaleString()}/d | Avg Intake: ${avgKcal || '--'} kcal (${avgProt || '--'}g P) | Avg Sleep: ${avgSleepMin ? `${Math.floor(avgSleepMin/60)}h${avgSleepMin%60}m` : '--'}`);
  }
}

analyzeEra('ERA 0: Initial XS1 Launch & Pre-Acromion Ramp', '2024-12-19', '2025-03-12');
analyzeEra('ERA 1: Post-Acromion / Pre-Bicep Block', '2025-03-13', '2025-07-10');
analyzeEra('ERA 2: Post-Bicep Rehab & Late-2025 Rebuild', '2025-07-11', '2025-12-31');
analyzeEra('ERA 3: 2026 Leanest Shred Peak (189.2 lb / VF 6!)', '2026-01-01', '2026-02-24');
analyzeEra('ERA 4: 2026 All-Time Muscle Peak (158.3 lb FFM / 90.8 SMM!)', '2026-02-25', '2026-03-16');
analyzeEra('ERA 5: Spring Crash Cut (FFM -6.8 lb Bleed)', '2026-03-17', '2026-03-28');
analyzeEra('ERA 6: Apr-May Moderate Block', '2026-03-29', '2026-06-04');
analyzeEra('ERA 7: Summer-Fall Work Crunch & Drift (to 209.6 lb)', '2026-06-05', '2026-11-07');
analyzeEra('ERA 8: Current Ketovore Surge (209.6 -> 198.4 lb!)', '2026-11-08', '2026-11-19');

console.log('\n=== LAST 8 SESSIONS DETAIL ===');
for (const s of sessions.slice(-8)) {
  console.log(`${s.date} (${s.started.slice(11,16)}Z) | ${s.set_count} sets | ${s.total_volume_lb.toLocaleString()} lb | TUT ${s.tut_sec}s | HRmax ${s.hr_max} | ` +
    s.exercises.map(e => `${e.name}: ${e.sets}x (${e.reps} reps @ ${e.base_lb}lb, e1RM ${e.pred_1rm_lb}lb, ${e.power_max_w}W)`).join(' + '));
}
