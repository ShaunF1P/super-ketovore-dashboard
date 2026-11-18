#!/usr/bin/env node
/**
 * Super Ketovore Dashboard — Daily Google Health API v4 & Android Health Connect Ingest Engine
 * ============================================================================================
 * Pulls daily wearable & Health Connect-bridged biometrics in parallel via `ghealth` (`shaun-health-app`):
 *   - Fitbit Air Sleep Architecture (duration, efficiency %, REM, Deep, Light, Awake, start/end)
 *   - Fitbit Air Overnight Recovery Vitals (RHR, HRV / Deep-Sleep RMSSD, Non-REM HR, SpO2, Resp Rate, Temp)
 *   - Daily Activity Rollups (Steps `countSum`, Total Burned Calories `kcalSum`, Exercise Sessions)
 *   - Health Connect -> Fitbit Bridged Biomarkers:
 *       * Blood Glucose (`com.mymojohealth.app` capillary mg/dL)
 *       * Scale Weight & Body Fat % (`MorphoScan` / `Fitdays` / `FITBIT`)
 *   - Optional Android 14+ Health Connect Scheduled Export `.zip` check on `G:\My Drive`
 *
 * Usage:
 *   node sync_health_daily.mjs
 *   node sync_health_daily.mjs --days 14
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

function resolveGhealthBin() {
  if (fs.existsSync(DEFAULT_GHEALTH_BIN)) return DEFAULT_GHEALTH_BIN;
  return 'ghealth';
}

async function runGhealth(bin, args) {
  const fullArgs = [...args, '--format', 'json'];
  const { stdout } = await execFileAsync(bin, fullArgs, { maxBuffer: 20 * 1024 * 1024 });
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
          matches.push({
            path: full,
            modified_at: st.mtime.toISOString(),
            size_bytes: st.size,
          });
        }
      }
    } catch {
      // Ignore permission errors on unrelated Drive folders
    }
  };
  scanDir(GDRIVE_ROOT);
  const sub = path.join(GDRIVE_ROOT, 'Health Connect');
  if (fs.existsSync(sub)) scanDir(sub);
  return matches.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 5);
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
        source: g.source,
        specimen: g.specimen,
      });
    }
  }

  for (const ex of exRes.dataPoints || []) {
    const ts = ex.start || '';
    const d = ts.slice(0, 10);
    if (d) {
      const ms = ex.metricsSummary || {};
      const dayObj = ensureDay(d);
      dayObj.exercises = dayObj.exercises || [];
      dayObj.exercises.push({
        name: ex.displayName,
        type: ex.exerciseType,
        start: ts,
        end: ex.end,
        active_seconds: parseInt(String(ex.activeDuration || '0s').replace(/s$/, ''), 10) || 0,
        calories_kcal: ms.caloriesKcal ?? null,
        avg_hr_bpm: ms.averageHeartRateBeatsPerMinute !== undefined ? Number(ms.averageHeartRateBeatsPerMinute) : null,
        steps: ms.steps !== undefined ? Number(ms.steps) : null,
        source: ex.source,
      });
    }
  }

  const sortedDays = Object.keys(daily)
    .sort((a, b) => b.localeCompare(a))
    .map((k) => daily[k]);

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
    gdrive_health_connect_exports: checkGdriveHealthConnectExports(),
    daily_records: sortedDays,
  };

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Synced ${sortedDays.length} days -> ${OUTPUT_JSON_PATH}`);
  for (const dev of payload.paired_devices) {
    if (dev.battery_pct !== null) {
      console.log(`Device: ${dev.name} (${dev.battery_pct}% battery, last sync ${dev.last_sync_utc})`);
    }
  }
  console.log('-'.repeat(98));
  console.log(
    `${'Date'.padEnd(11)} | ${'Steps'.padStart(7)} | ${'Burn'.padStart(9)} | ${'Sleep (Eff / REM / Deep)'.padEnd(30)} | ${'HRV / SpO2'.padEnd(14)} | BG / Weight`
  );
  console.log('-'.repeat(98));

  for (const rec of sortedDays) {
    const steps = rec.steps !== undefined ? rec.steps.toLocaleString() : '--';
    const burn = rec.total_calories_burned_kcal !== undefined ? `${rec.total_calories_burned_kcal.toLocaleString()} kcal` : '--';
    let sleepStr = '--';
    if (rec.sleep) {
      sleepStr = `${rec.sleep.asleep_hm} (${rec.sleep.efficiency_pct}% | R:${rec.sleep.rem_minutes}m D:${rec.sleep.deep_minutes}m)`;
    } else if (rec.naps?.length) {
      const napM = rec.naps.reduce((s, n) => s + n.asleep_minutes, 0);
      sleepStr = `Nap ${fmtHm(napM)} (<3h fragmented)`;
    }
    const hrvVal = rec.hrv?.avg_rmssd_ms ?? '--';
    const spo2Val = rec.spo2?.avg_pct ?? '--';
    const vitalsStr = `${hrvVal}ms/${spo2Val}%`;
    const bgStr = rec.blood_glucose_readings?.length ? `BG ${rec.blood_glucose_readings[0].glucose_mg_dl_raw}` : '';
    const wtStr = rec.weights?.length ? `Wt ${rec.weights[0].weight_lb}lb` : '';
    const combo = [bgStr, wtStr].filter(Boolean).join(' / ') || '--';
    console.log(
      `${rec.date.padEnd(11)} | ${steps.padStart(7)} | ${burn.padStart(9)} | ${sleepStr.padEnd(30)} | ${vitalsStr.padEnd(14)} | ${combo}`
    );
  }
}

main().catch((err) => {
  console.error('Health sync failed:', err.message);
  process.exit(1);
});
