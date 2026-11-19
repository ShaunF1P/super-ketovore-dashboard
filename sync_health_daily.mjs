#!/usr/bin/env node
/**
 * Super Ketovore Dashboard — Daily Google Health API v4, Fitbit Air & Custom Bio-States Engine
 * ============================================================================================
 * Pulls daily wearable & Health Connect-bridged biometrics in parallel via `ghealth` (`shaun-health-app`)
 * AND computes Shaun's 5 Proprietary Fitbit Air Bio-States from raw 1-second HR, Sleep Stages & TDEE:
 *   1. OxeFit CNS & Tendon Readiness State (0–100, GREEN / AMBER / RED)
 *   2. Evening Shaun Circadian & HR-Nadir Clock (1-second overnight HR nadir + % sleep timing)
 *   3. True Fat vs. Water/GI Split Engine (Thermodynamic adipose delta vs. fluid/gut variance)
 *   4. Visceral Melt Velocity Index (VMVI 0–100 momentum toward Sub-5 VF)
 *   5. Post-Workout Vagal Recovery (HRR-60 & HRR-180 from 1-second Fitbit Air HR post-exercise)
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSON_PATH = path.join(__dirname, 'health_connect_live_sync.json');
const DEFAULT_GHEALTH_BIN = path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'ghealth.exe');
const GDRIVE_ROOT = 'G:\\My Drive';

// Verified Ketone / DBR lookup for VMVI calculation
const KNOWN_KETONES = {
  '2026-11-12': { bg: 69, bhb: 0.9, gki: 4.2, dbr: 76.7 },
  '2026-11-13': { bg: 90, bhb: 2.0, gki: 2.5, dbr: 45.0 },
  '2026-11-14': { bg: 92, bhb: 1.0, gki: 5.1, dbr: 92.0 },
  '2026-11-15': { bg: 89, bhb: 0.9, gki: 5.4, dbr: 98.9 },
  '2026-11-16': { bg: 88, bhb: 0.8, gki: 6.1, dbr: 110.0 },
  '2026-11-17': { bg: 97, bhb: 0.9, gki: 6.0, dbr: 107.8 },
  '2026-11-18': { bg: 91, bhb: 1.3, gki: 3.9, dbr: 70.0 },
};

function resolveGhealthBin() {
  if (fs.existsSync(DEFAULT_GHEALTH_BIN)) return DEFAULT_GHEALTH_BIN;
  return 'ghealth';
}

async function runGhealth(bin, args) {
  const fullArgs = [...args, '--format', 'json'];
  const { stdout } = await execFileAsync(bin, fullArgs, { maxBuffer: 30 * 1024 * 1024 });
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : { dataPoints: [] };
}

function fmtHm(mins) {
  const m = Math.round(Number(mins) || 0);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function isoDateLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function checkGdriveHealthConnectExports() {
  if (!fs.existsSync(GDRIVE_ROOT)) return [];
  const matches = [];
  const scanDir = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /health[_ ]?connect.*\.zip$/i.test(entry.name)) {
          const full = path.join(dir, entry.name);
          const st = fs.statSync(full);
          matches.push({ path: full, modified_at: st.mtime.toISOString(), size_bytes: st.size });
        }
      }
    } catch {}
  };
  scanDir(GDRIVE_ROOT);
  const sub = path.join(GDRIVE_ROOT, 'Health Connect');
  if (fs.existsSync(sub)) scanDir(sub);
  return matches.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 5);
}

async function computeSleepHrNadir(bin, sleepRec) {
  if (!sleepRec?.start || !sleepRec?.end) return null;
  try {
    const startMs = new Date(sleepRec.start).getTime();
    const endMs = new Date(sleepRec.end).getTime();
    const chunkMs = 3 * 3600 * 1000; // 3-hour slices so 8-10h sleeps never hit 10k sample cap
    const slices = [];
    for (let cur = startMs; cur < endMs; cur += chunkMs) {
      const next = Math.min(endMs, cur + chunkMs);
      const sUtc = new Date(cur).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const eUtc = new Date(next).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const filter = `heart_rate.sample_time.physical_time >= "${sUtc}" AND heart_rate.sample_time.physical_time < "${eUtc}"`;
      slices.push(runGhealth(bin, ['data', 'heart-rate', 'list', '--filter', filter, '--limit', '10000']));
    }
    const results = await Promise.all(slices);
    const pts = results.flatMap((r) => r.dataPoints || []);
    if (!pts.length) return null;
    let minPt = null;
    for (const p of pts) {
      const bpm = Number(p.beatsPerMinute);
      if (!minPt || bpm < Number(minPt.beatsPerMinute)) minPt = p;
    }
    const nadirMs = new Date(minPt.time).getTime();
    const pctThroughSleep = Math.round(((nadirMs - startMs) / Math.max(1, endMs - startMs)) * 100);
    const localClock = minPt.time.slice(11, 16);
    return {
      nadir_bpm: Number(minPt.beatsPerMinute),
      nadir_time: minPt.time,
      nadir_clock: localClock,
      pct_through_sleep: pctThroughSleep,
      samples_analyzed: pts.length,
    };
  } catch {
    return null;
  }
}

async function computeLatestWorkoutHrr(bin, exercises) {
  if (!exercises?.length) return null;
  // Prefer most recent workout/strength/spinning/walk with >= 15 min active duration
  const target = exercises.find((e) => e.active_seconds >= 900) || exercises[0];
  if (!target?.end) return null;
  try {
    const endMs = new Date(target.end).getTime();
    const winStart = new Date(endMs - 120 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const winEnd = new Date(endMs + 195 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const filter = `heart_rate.sample_time.physical_time >= "${winStart}" AND heart_rate.sample_time.physical_time < "${winEnd}"`;
    const res = await runGhealth(bin, ['data', 'heart-rate', 'list', '--filter', filter, '--limit', '1000']);
    const pts = (res.dataPoints || []).map((p) => ({
      ms: new Date(p.time).getTime(),
      bpm: Number(p.beatsPerMinute),
      time: p.time,
    })).sort((a, b) => a.ms - b.ms);
    if (pts.length < 4) return null;

    // Peak HR in the last 120s of the session (<= endMs + 15s)
    const endWindow = pts.filter((p) => p.ms <= endMs + 15000);
    const peakPt = (endWindow.length ? endWindow : pts).reduce((a, b) => (b.bpm > a.bpm ? b : a));
    const after60 = pts.filter((p) => p.ms >= peakPt.ms + 50000 && p.ms <= peakPt.ms + 85000);
    const after180 = pts.filter((p) => p.ms >= peakPt.ms + 130000);

    const hr60 = after60.length ? Math.min(...after60.map((p) => p.bpm)) : null;
    const hr180 = after180.length ? Math.min(...after180.map((p) => p.bpm)) : pts[pts.length - 1].bpm;

    return {
      workout_date: target.start.slice(0, 10),
      workout_name: target.name,
      peak_end_bpm: peakPt.bpm,
      hr_at_60s_bpm: hr60,
      hrr_60_drop_bpm: hr60 !== null ? peakPt.bpm - hr60 : null,
      hr_at_180s_bpm: hr180,
      hrr_180_drop_bpm: hr180 !== null ? peakPt.bpm - hr180 : null,
    };
  } catch {
    return null;
  }
}

function computeCustomBioStates(sortedDays, nadirInfo, hrrInfo) {
  const today = sortedDays[0] || {};
  const yesterday = sortedDays[1] || {};

  // 1. OxeFit CNS & Tendon Readiness State (0-100)
  const deepRmssd = today.hrv?.deep_sleep_rmssd_ms ?? yesterday.hrv?.deep_sleep_rmssd_ms ?? 38;
  const nonRemHr = today.hrv?.non_rem_hr_bpm ?? today.resting_hr_bpm ?? 61;
  const sleepMin = today.sleep?.asleep_minutes ?? 390;
  const sleepEff = today.sleep?.efficiency_pct ?? 90;
  const spo2 = today.spo2?.avg_pct ?? 96.8;

  const hrvScore = Math.min(35, Math.max(10, Math.round((deepRmssd / 46) * 35)));
  const sleepScore = Math.min(30, Math.round((Math.min(465, sleepMin) / 450) * 22 + (sleepEff / 98) * 8));
  const hrScore = Math.min(20, Math.max(5, Math.round(((70 - nonRemHr) / 16) * 20)));
  const spo2Score = Math.min(15, Math.max(6, Math.round(((spo2 - 93) / 4.8) * 15)));
  const cnsTotal = Math.min(100, hrvScore + sleepScore + hrScore + spo2Score);
  const cnsTier = cnsTotal >= 78 ? 'GREEN' : cnsTotal >= 62 ? 'AMBER' : 'RED';
  const cnsAction =
    cnsTier === 'GREEN'
      ? 'Push OxeFit Chains Overload + Keith Baar 4x30s Isometric Holds (50m Cap)'
      : cnsTier === 'AMBER'
        ? 'Train @ 2 RIR Velocity Cap (>0.50 m/s) + Full Tendon Pre-Load'
        : 'COMT GG Cortisol Flush: Zone 2 Nasal Walk + Mobility Only';

  // 2. Evening Shaun Circadian & HR-Nadir Score (0-100)
  let bedPenalty = 0;
  if (today.sleep?.start) {
    const startHr = new Date(today.sleep.start).getHours() + new Date(today.sleep.start).getMinutes() / 60;
    // Target <= 23.25 (11:15 PM); if 0..5 AM, treat as 24 + startHr
    const adjHr = startHr < 12 ? startHr + 24 : startHr;
    bedPenalty = Math.max(0, Math.round((adjHr - 23.25) * 12));
  }
  const nadirPenalty = nadirInfo ? Math.max(0, Math.round((nadirInfo.pct_through_sleep - 45) * 0.35)) : 8;
  const effBonus = Math.min(40, Math.round(((today.sleep?.efficiency_pct || 90) / 98) * 40));
  const circadianScore = Math.max(35, Math.min(100, 60 + effBonus - bedPenalty - nadirPenalty));

  // 3. True Fat vs. Water/GI Split Engine (using Yesterday's completed burn vs intake -> Today's AM scale move)
  const yBurn = yesterday.total_calories_burned_kcal || 2750;
  const yIntake = yesterday.intake_kcal || 1545;
  const yNetDeficit = yIntake - yBurn; // negative = deficit
  const trueFatDeltaLb = Number((yNetDeficit / 3500).toFixed(2));
  const tWeight = today.weights?.[0]?.weight_lb ?? null;
  const yWeight = yesterday.weights?.[0]?.weight_lb ?? null;
  const scaleDeltaLb = tWeight !== null && yWeight !== null ? Number((tWeight - yWeight).toFixed(2)) : null;
  const waterGiDeltaLb = scaleDeltaLb !== null ? Number((scaleDeltaLb - trueFatDeltaLb).toFixed(2)) : null;

  // 4. Visceral Melt Velocity Index (VMVI 0-100)
  const kt = KNOWN_KETONES[today.date] || KNOWN_KETONES[yesterday.date] || { dbr: 75, gki: 4.2 };
  const dbrPts = kt.dbr <= 50 ? 35 : kt.dbr <= 80 ? 30 : kt.dbr <= 100 ? 22 : 14;
  const defPts = yNetDeficit <= -900 ? 30 : yNetDeficit <= -500 ? 24 : yNetDeficit < 0 ? 16 : 8;
  const activeSteps = Math.max(today.steps || 0, yesterday.steps || 0);
  const stepPts = Math.min(20, Math.round((activeSteps / 12000) * 20));
  const slPts = (today.sleep?.efficiency_pct || 90) >= 92 ? 15 : 10;
  const vmviScore = Math.min(100, dbrPts + defPts + stepPts + slPts);

  return {
    cns_readiness: {
      score: cnsTotal,
      tier: cnsTier,
      deep_rmssd_ms: deepRmssd,
      non_rem_hr_bpm: nonRemHr,
      prescription: cnsAction,
    },
    circadian_nadir: {
      score: circadianScore,
      nadir_bpm: nadirInfo?.nadir_bpm ?? nonRemHr,
      nadir_clock: nadirInfo?.nadir_clock ?? '--:--',
      pct_through_sleep: nadirInfo?.pct_through_sleep ?? null,
      samples_analyzed: nadirInfo?.samples_analyzed ?? 0,
      bedtime_iso: today.sleep?.start ?? null,
    },
    true_fat_split: {
      yesterday_date: yesterday.date,
      yesterday_burn_kcal: yBurn,
      yesterday_intake_kcal: yIntake,
      net_kcal: yNetDeficit,
      true_fat_delta_lb: trueFatDeltaLb,
      scale_delta_lb: scaleDeltaLb,
      water_gi_delta_lb: waterGiDeltaLb,
    },
    visceral_melt_velocity: {
      score: vmviScore,
      am_dbr: kt.dbr,
      am_gki: kt.gki,
      active_step_flux: activeSteps,
    },
    vagal_hrr: hrrInfo,
  };
}

async function main() {
  const daysIdx = process.argv.indexOf('--days');
  const days = daysIdx !== -1 && process.argv[daysIdx + 1] ? parseInt(process.argv[daysIdx + 1], 10) : 7;

  const bin = resolveGhealthBin();
  const now = new Date();
  const startObj = new Date(now);
  startObj.setDate(now.getDate() - days);
  const tomorrowObj = new Date(now);
  tomorrowObj.setDate(now.getDate() + 1);

  const startDate = isoDateLocal(startObj);
  const todayDate = isoDateLocal(now);
  const tomorrowDate = isoDateLocal(tomorrowObj);

  const [
    pairedRes,
    sleepRes,
    stepsRes,
    kcalRes,
    nutrRes,
    rhrRes,
    hrvRes,
    spo2Res,
    respRes,
    tempRes,
    weightRes,
    bfRes,
    bgRes,
    exRes,
  ] = await Promise.all([
    runGhealth(bin, ['user', 'paired-devices', 'list']),
    runGhealth(bin, ['data', 'sleep', 'list', '--from', startDate, '--detail']),
    runGhealth(bin, ['data', 'steps', 'daily-rollup', '--from', startDate, '--to', tomorrowDate]),
    runGhealth(bin, ['data', 'total-calories', 'daily-rollup', '--from', startDate, '--to', tomorrowDate]),
    runGhealth(bin, ['data', 'nutrition-log', 'daily-rollup', '--from', startDate, '--to', tomorrowDate]),
    runGhealth(bin, ['data', 'daily-resting-heart-rate', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'daily-heart-rate-variability', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'daily-oxygen-saturation', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'daily-respiratory-rate', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'daily-sleep-temperature-derivations', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'weight', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'body-fat', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'blood-glucose', 'list', '--from', startDate]),
    runGhealth(bin, ['data', 'exercise', 'list', '--from', startDate, '--limit', '25']),
  ]);

  const daily = {};
  const ensureDay = (d) => {
    if (!daily[d]) daily[d] = { date: d };
    return daily[d];
  };

  for (const p of stepsRes.dataPoints || []) {
    if (p.date && p.countSum !== undefined) ensureDay(p.date).steps = Number(p.countSum);
  }
  for (const p of kcalRes.dataPoints || []) {
    if (p.date && p.kcalSum !== undefined) ensureDay(p.date).total_calories_burned_kcal = Math.round(Number(p.kcalSum));
  }
  for (const p of nutrRes.dataPoints || []) {
    if (p.date && p.energy?.kcalSum) ensureDay(p.date).intake_kcal = Math.round(Number(p.energy.kcalSum));
  }
  for (const p of rhrRes.dataPoints || []) {
    if (p.date && p.beatsPerMinute !== undefined) ensureDay(p.date).resting_hr_bpm = Number(p.beatsPerMinute);
  }
  for (const p of hrvRes.dataPoints || []) {
    if (p.date) {
      ensureDay(p.date).hrv = {
        avg_rmssd_ms: Number(Number(p.averageHeartRateVariabilityMilliseconds || 0).toFixed(1)),
        deep_sleep_rmssd_ms: Number(Number(p.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds || 0).toFixed(1)),
        non_rem_hr_bpm: p.nonRemHeartRateBeatsPerMinute !== undefined ? Number(p.nonRemHeartRateBeatsPerMinute) : null,
      };
    }
  }
  for (const p of spo2Res.dataPoints || []) {
    if (p.date) {
      ensureDay(p.date).spo2 = {
        avg_pct: Number(Number(p.averagePercentage || 0).toFixed(1)),
        min_pct: Number(Number(p.lowerBoundPercentage || 0).toFixed(1)),
        max_pct: Number(Number(p.upperBoundPercentage || 0).toFixed(1)),
      };
    }
  }
  for (const p of respRes.dataPoints || []) {
    if (p.date && p.breathsPerMinute !== undefined) {
      ensureDay(p.date).respiratory_rate_brpm = Number(Number(p.breathsPerMinute).toFixed(1));
    }
  }
  for (const p of tempRes.dataPoints || []) {
    if (p.date && p.nightlyTemperatureCelsius !== undefined && p.baselineTemperatureCelsius !== undefined) {
      const deltaC = Number(p.nightlyTemperatureCelsius) - Number(p.baselineTemperatureCelsius);
      ensureDay(p.date).sleep_skin_temp_delta_f = Number((deltaC * 1.8).toFixed(2));
    }
  }

  for (const s of sleepRes.dataPoints || []) {
    const endTs = s.end || '';
    const d = endTs.slice(0, 10);
    if (!d) continue;
    const asleep = Number(s.minutesAsleep || 0);
    const awake = Number(s.minutesAwake || 0);
    const total = Number(s.totalMinutes || asleep + awake);
    const eff = total > 0 ? Math.round((asleep / total) * 100) : 0;
    const stages = s.stageMinutes || {};
    const rec = {
      start: s.start,
      end: endTs,
      asleep_minutes: asleep,
      asleep_hm: fmtHm(asleep),
      awake_minutes: awake,
      total_minutes: total,
      efficiency_pct: eff,
      deep_minutes: Number(stages.DEEP || 0),
      rem_minutes: Number(stages.REM || 0),
      light_minutes: Number(stages.LIGHT || 0),
      is_nap: Boolean(s.isNap),
      source: s.source,
    };
    const dayObj = ensureDay(d);
    if (rec.is_nap) {
      dayObj.naps = dayObj.naps || [];
      dayObj.naps.push(rec);
    } else if (!dayObj.sleep || rec.asleep_minutes > dayObj.sleep.asleep_minutes) {
      dayObj.sleep = rec;
    }
  }

  for (const w of weightRes.dataPoints || []) {
    const ts = w.time || '';
    const d = ts.slice(0, 10);
    if (d && w.weightGrams !== undefined) {
      const lb = Number((Number(w.weightGrams) / 453.59237).toFixed(1));
      const dayObj = ensureDay(d);
      dayObj.weights = dayObj.weights || [];
      dayObj.weights.push({ time: ts, weight_lb: lb, source: w.source });
    }
  }

  for (const b of bfRes.dataPoints || []) {
    const ts = b.time || '';
    const d = ts.slice(0, 10);
    if (d && b.percentage !== undefined) {
      const dayObj = ensureDay(d);
      dayObj.body_fat_readings = dayObj.body_fat_readings || [];
      dayObj.body_fat_readings.push({
        time: ts,
        body_fat_pct: Number(Number(b.percentage).toFixed(1)),
        source: b.source,
      });
    }
  }

  for (const g of bgRes.dataPoints || []) {
    const ts = g.time || '';
    const d = ts.slice(0, 10);
    if (d && g.bloodGlucoseMilligramsPerDeciliter !== undefined) {
      const val = Number(g.bloodGlucoseMilligramsPerDeciliter);
      const dayObj = ensureDay(d);
      dayObj.blood_glucose_readings = dayObj.blood_glucose_readings || [];
      dayObj.blood_glucose_readings.push({
        time: ts,
        glucose_mg_dl_raw: Number(val.toFixed(1)),
        glucose_mg_dl_meter: Math.floor(val),
        source: g.get ? g.get('source') : g.source,
        specimen: g.specimen,
      });
    }
  }

  const allExercises = [];
  for (const ex of exRes.dataPoints || []) {
    const ts = ex.start || '';
    const d = ts.slice(0, 10);
    if (d) {
      const ms = ex.metricsSummary || {};
      const item = {
        name: ex.displayName,
        type: ex.exerciseType,
        start: ts,
        end: ex.end,
        active_seconds: parseInt(String(ex.activeDuration || '0s').replace(/s$/, ''), 10) || 0,
        calories_kcal: ms.caloriesKcal ?? null,
        avg_hr_bpm: ms.averageHeartRateBeatsPerMinute !== undefined ? Number(ms.averageHeartRateBeatsPerMinute) : null,
        steps: ms.steps !== undefined ? Number(ms.steps) : null,
        source: ex.source,
      };
      allExercises.push(item);
      const dayObj = ensureDay(d);
      dayObj.exercises = dayObj.exercises || [];
      dayObj.exercises.push(item);
    }
  }

  const sortedDays = Object.keys(daily)
    .sort((a, b) => b.localeCompare(a))
    .map((k) => daily[k]);

  // High-resolution 1-second Fitbit Air HR queries for Sleep Nadir & Post-Workout HRR
  const latestSleepDay = sortedDays.find((r) => r.sleep) || sortedDays[0];
  const [nadirInfo, hrrInfo] = await Promise.all([
    computeSleepHrNadir(bin, latestSleepDay?.sleep),
    computeLatestWorkoutHrr(bin, allExercises),
  ]);

  const customBioStates = computeCustomBioStates(sortedDays, nadirInfo, hrrInfo);

  const payload = {
    generated_at: new Date().toISOString(),
    window_start: startDate,
    window_end: todayDate,
    paired_devices: (pairedRes.pairedDevices || []).map((dev) => ({
      name: dev.deviceVersion,
      type: dev.deviceType,
      battery_pct: dev.batteryLevel ?? null,
      last_sync_utc: dev.lastSyncTime ?? null,
    })),
    custom_bio_states: customBioStates,
    gdrive_health_connect_exports: checkGdriveHealthConnectExports(),
    daily_records: sortedDays,
  };

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Synced ${sortedDays.length} days + 5 Custom Fitbit Air Bio-States -> ${OUTPUT_JSON_PATH}`);
  console.log(
    `[BIO-STATES] CNS: ${customBioStates.cns_readiness.tier} (${customBioStates.cns_readiness.score}/100) | HR Nadir: ${customBioStates.circadian_nadir.nadir_bpm} bpm @ ${customBioStates.circadian_nadir.nadir_clock} (${customBioStates.circadian_nadir.pct_through_sleep}% sleep) | True Fat: ${customBioStates.true_fat_split.true_fat_delta_lb} lb (Water/GI: ${customBioStates.true_fat_split.water_gi_delta_lb} lb) | VMVI: ${customBioStates.visceral_melt_velocity.score}/100 | HRR-180: -${customBioStates.vagal_hrr?.hrr_180_drop_bpm ?? '--'} bpm`
  );
}

main().catch((err) => {
  console.error('Health sync failed:', err.message);
  process.exit(1);
});
