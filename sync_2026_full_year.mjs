#!/usr/bin/env node
/**
 * Super Ketovore Dashboard — 2026 Full-Year Biometric & Nutrition Sync Engine
 * ===========================================================================
 * 1. Parses 2026 Google Drive exports (`MacroFactor` master .xlsx, timestamped foods .xlsx,
 *    Oura `workout.csv`) + verified 2026 `MorphoScan / Fitdays` scans & Nov 8–18 Ketovore logs.
 * 2. Pulls complete 2026 YTD (`2026-01-01` -> today) existing data from Google Health API v4 (`ghealth`).
 * 3. Deduplicates by date and backfills ONLY missing 2026 Nutrition, Weight, and Body Fat % days
 *    into Fitbit / Google Health App (`health.googleapis.com/v4`).
 * 4. Exports unified `history_2026_full.json` (322+ daily records + 11 monthly summaries) for `index.html`.
 *
 * Usage:
 *   node sync_2026_full_year.mjs --dry-run
 *   node sync_2026_full_year.mjs --execute
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FULL_PATH = path.join(__dirname, 'history_2026_full.json');
const GHEALTH_BIN = path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'ghealth.exe');
const GHEALTH_DIR = path.join(os.homedir(), '.config', 'ghealth');
const CLIENT_SECRET_PATH = path.join(GHEALTH_DIR, 'client_secret.json');
const WRITE_CREDS_PATH = path.join(GHEALTH_DIR, 'write_credentials.json');
const CREDS_PATH = path.join(GHEALTH_DIR, 'credentials.json');
const API_BASE = 'https://health.googleapis.com/v4/users/me/dataTypes';

const MF_MASTER_PATH = "G:\\My Drive\\I am sharing 'MacroFactor-20260603144040' with you";
const MF_FOODS_PATH = 'G:\\My Drive\\Download\\MacroFactor-20260527164342.xlsx';
const OURA_WORKOUT_PATH = 'G:\\My Drive\\Download\\App Data\\workout.csv';

// Verified 2026 MorphoScan / Fitdays 8-Electrode Scans & Ketovore Logs
const VERIFIED_SCANS_2026 = [
  { date: '2026-02-24', hour: 10, minute: 5, w: 189.2, bf: 20.6, fm: 39.0, ffm: 150.4, smm: 86.0, vf: 6 },
  { date: '2026-03-13', hour: 10, minute: 26, w: 199.6, bf: 21.9, fm: 43.7, ffm: 155.9, smm: 89.5, vf: 7 },
  { date: '2026-03-15', hour: 6, minute: 47, w: 203.8, bf: 22.8, fm: 46.5, ffm: 157.4, smm: 90.4, vf: 7 },
  { date: '2026-03-16', hour: 8, minute: 48, w: 207.0, bf: 23.5, fm: 48.7, ffm: 158.3, smm: 90.8, vf: 8 },
  { date: '2026-03-28', hour: 11, minute: 36, w: 191.4, bf: 20.8, fm: 39.9, ffm: 151.5, smm: 86.9, vf: 6 },
  { date: '2026-05-27', hour: 9, minute: 31, w: 203.0, bf: 24.5, fm: 49.8, ffm: 153.4, smm: 88.0, vf: 8 },
  { date: '2026-05-28', hour: 8, minute: 22, w: 200.4, bf: 24.2, fm: 48.5, ffm: 151.9, smm: 87.1, vf: 8 },
  { date: '2026-05-29', hour: 9, minute: 3, w: 198.8, bf: 24.1, fm: 47.8, ffm: 151.0, smm: 86.4, vf: 8 },
  { date: '2026-06-03', hour: 10, minute: 4, w: 197.0, bf: 23.8, fm: 47.0, ffm: 150.1, smm: 86.0, vf: 8 },
  { date: '2026-06-04', hour: 10, minute: 6, w: 196.4, bf: 23.5, fm: 46.1, ffm: 150.4, smm: 86.0, vf: 8 },
  { date: '2026-07-29', hour: 14, minute: 4, w: 205.0, bf: 26.4, fm: 54.2, ffm: 150.8, smm: 86.4, vf: 9 },
  { date: '2026-07-30', hour: 9, minute: 44, w: 201.8, bf: 25.3, fm: 51.1, ffm: 150.6, smm: 86.4, vf: 9 },
  { date: '2026-11-08', hour: 8, minute: 0, w: 209.6, bf: 28.0, fm: 58.6, ffm: 151.0, smm: null, vf: 10 },
  { date: '2026-11-09', hour: 7, minute: 59, w: 209.2, bf: 27.9, fm: 58.4, ffm: 151.0, smm: null, vf: 10 },
  { date: '2026-11-10', hour: 9, minute: 52, w: 205.4, bf: 26.7, fm: 54.9, ffm: 150.5, smm: null, vf: 10 },
  { date: '2026-11-11', hour: 8, minute: 47, w: 204.2, bf: 26.8, fm: 54.7, ffm: 149.5, smm: null, vf: 10 },
  { date: '2026-11-12', hour: 9, minute: 9, w: 201.8, bf: 25.8, fm: 52.0, ffm: 149.5, smm: 85.8, vf: 9 },
  { date: '2026-11-13', hour: 7, minute: 47, w: 200.0, bf: 25.9, fm: 51.8, ffm: 148.2, smm: 84.9, vf: 9 },
  { date: '2026-11-14', hour: 9, minute: 56, w: 200.0, bf: 26.4, fm: 52.9, ffm: 147.1, smm: null, vf: 9 },
  { date: '2026-11-15', hour: 7, minute: 35, w: 204.0, bf: 27.0, fm: 55.0, ffm: 149.0, smm: 85.3, vf: 10 },
  { date: '2026-11-16', hour: 7, minute: 38, w: 203.4, bf: 27.2, fm: 55.3, ffm: 148.4, smm: 84.9, vf: 10 },
  { date: '2026-11-17', hour: 5, minute: 20, w: 201.2, bf: 25.8, fm: 52.0, ffm: 149.5, smm: 85.5, vf: 9 },
  { date: '2026-11-18', hour: 8, minute: 10, w: 199.2, bf: 25.5, fm: 50.7, ffm: 148.4, smm: 84.9, vf: 9 },
  { date: '2026-11-19', hour: 7, minute: 58, w: 198.4, bf: 25.8, fm: 51.1, ffm: 147.3, smm: 84.2, vf: 9 },
  { date: '2026-11-20', hour: 8, minute: 41, w: 199.6, bf: 26.8, fm: 53.6, ffm: 145.7, smm: 83.3, vf: 9 },
];

const VERIFIED_KETOVORE_MEALS_NOV = [
  { date: '2026-11-08', hour: 16, minute: 30, meal: 'Sardine Fast Day 1: 2 Cans Wild Sardines in EVOO + 1 tbsp C8 MCT + Mustard', kcal: 530, protein: 44, fat: 38, carbs: 0, fiber: 0 },
  { date: '2026-11-09', hour: 16, minute: 30, meal: 'Sardine Fast Day 2: 2 Cans Wild Sardines in EVOO + 1 tbsp C8 MCT + Mustard', kcal: 530, protein: 44, fat: 38, carbs: 0, fiber: 0 },
  { date: '2026-11-10', hour: 16, minute: 30, meal: '12oz Salt & Pepper Smoked Brisket + Cafe Mocha Slate + 1 tbsp C8 MCT', kcal: 1255, protein: 120, fat: 84, carbs: 5, fiber: 1 },
  { date: '2026-11-14', hour: 17, minute: 0, meal: 'Ketovore Game-Night: 4 Oysters + 4x Bunless Cheeseburgers + 2x Chicken Kabobs', kcal: 2850, protein: 199, fat: 215, carbs: 13, fiber: 1 },
  { date: '2026-11-15', hour: 17, minute: 0, meal: 'Zero-Cheese Surf & Turf: Smoked Salmon, Filet Mignon, 8 Shrimp, 4 Eggs, Guac, MCT, Slate', kcal: 3280, protein: 235, fat: 248, carbs: 14, fiber: 4 },
  { date: '2026-11-16', hour: 18, minute: 0, meal: 'OMAD: 20oz 80/20 Ground Beef + Cafe Mocha Slate Max + 3 tbsp MCT + 3oz Red-Bag Kimchi', kcal: 1710, protein: 143, fat: 122, carbs: 6, fiber: 2 },
  { date: '2026-11-17', hour: 16, minute: 0, meal: 'Roadtrip Saltgrass: Cafe Mocha Slate + MCT + 6oz Sirloin + 6oz Steak/Shrimp + 2x Broccoli', kcal: 1545, protein: 146, fat: 93, carbs: 21, fiber: 8 },
  { date: '2026-11-18', hour: 15, minute: 45, meal: 'Ketovore Surge: 6oz 80/20 Burger w/ White American + Cafe Mocha Slate + 2.5 tbsp MCT + 3x 7oz Turkey Burgers', kcal: 1880, protein: 176, fat: 124.5, carbs: 12.5, fiber: 2 },
  { date: '2026-11-19', hour: 20, minute: 0, meal: 'Dual-OxeFit PR Day: Coffee+MCT+Slate + 16oz Grass-Fed Beef + 3x LMNT + Supps + 13x BWW Tallow Wings', kcal: 2105, protein: 209, fat: 132.1, carbs: 10.3, fiber: 2.8 },
];

const VERIFIED_KETONES_2026 = {
  '2026-03-27': { bg: 106, bhb: 0.1, gki: 59.0, dbr: 1060 },
  '2026-03-28': { bg: 88, bhb: 0.3, gki: 16.3, dbr: 293 },
  '2026-05-26': { bg: 81, bhb: 0.4, gki: 11.2, dbr: 203 },
  '2026-05-27': { bg: 94, bhb: 0.3, gki: 17.3, dbr: 313 },
  '2026-05-28': { bg: 93, bhb: 0.5, gki: 10.4, dbr: 186 },
  '2026-05-29': { bg: 95, bhb: 0.5, gki: 10.6, dbr: 190 },
  '2026-11-10': { bg: 60, bhb: 1.6, gki: 2.1, dbr: 37.5 },
  '2026-11-11': { bg: 75, bhb: 0.8, gki: 5.2, dbr: 93.8 },
  '2026-11-12': { bg: 69, bhb: 0.9, gki: 4.2, dbr: 76.7 },
  '2026-11-13': { bg: 90, bhb: 2.0, gki: 2.5, dbr: 45.0 },
  '2026-11-14': { bg: 92, bhb: 1.0, gki: 5.1, dbr: 92.0 },
  '2026-11-15': { bg: 89, bhb: 0.9, gki: 5.4, dbr: 98.9 },
  '2026-11-16': { bg: 88, bhb: 0.8, gki: 6.1, dbr: 110.0 },
  '2026-11-17': { bg: 97, bhb: 0.9, gki: 6.0, dbr: 107.8 },
  '2026-11-18': { bg: 91, bhb: 1.3, gki: 3.9, dbr: 70.0 },
  '2026-11-19': { bg: 86, bhb: 0.9, gki: 5.3, dbr: 95.6 },
};

// --- Minimal Zero-Dependency XLSX Reader ---
function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  const cdCount = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const fnLen = buf.readUInt16LE(pos + 28);
    const exLen = buf.readUInt16LE(pos + 30);
    const cmLen = buf.readUInt16LE(pos + 32);
    const lfhOffset = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
    const dataStart = lfhOffset + 30 + buf.readUInt16LE(lfhOffset + 26) + buf.readUInt16LE(lfhOffset + 28);
    const compBuf = buf.slice(dataStart, dataStart + compSize);
    entries[name] = () => (method === 0 ? compBuf : zlib.inflateRawSync(compBuf));
    pos += 46 + fnLen + exLen + cmLen;
  }
  return entries;
}

function readXlsx(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const entries = readZipEntries(fs.readFileSync(filePath));
  if (!entries) return {};
  const wbXml = entries['xl/workbook.xml']().toString('utf8');
  const relsXml = entries['xl/_rels/workbook.xml.rels']().toString('utf8');
  const ss = [];
  if (entries['xl/sharedStrings.xml']) {
    const ssXml = entries['xl/sharedStrings.xml']().toString('utf8');
    for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let s = '';
      for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += tm[1];
      ss.push(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    }
  }
  const relMap = {};
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[m[1]] = 'xl/' + m[2].replace(/^\/?xl\//, '');
  }
  const colToIdx = (c) => {
    let n = 0;
    for (let i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64);
    return n - 1;
  };
  const sheets = {};
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const sheetName = m[1].replace(/&amp;/g, '&');
    const target = relMap[m[2]];
    if (!entries[target]) continue;
    const sXml = entries[target]().toString('utf8');
    const rows = [];
    for (const rm of sXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const idx = colToIdx(cm[1]);
        const isS = /t="s"/.test(cm[2]);
        const isInl = /t="inlineStr"/.test(cm[2]);
        if (isInl) {
          const tm = cm[3].match(/<t[^>]*>([\s\S]*?)<\/t>/);
          row[idx] = tm ? tm[1] : '';
        } else {
          const vm = cm[3].match(/<v>([\s\S]*?)<\/v>/);
          if (vm) row[idx] = isS ? ss[Number(vm[1])] : vm[1];
        }
      }
      rows.push(row);
    }
    sheets[sheetName] = rows;
  }
  return sheets;
}

function excelSerialToIso(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const num = Number(val);
  if (Number.isNaN(num) || num < 40000) return null;
  const ms = Math.round((num - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

// --- Google Health API v4 Read & Write Helpers ---
async function runGhealth(args) {
  const { stdout } = await execFileAsync(GHEALTH_BIN, [...args, '--format', 'json'], { maxBuffer: 40 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout.trim()) : { dataPoints: [] };
}

async function listAll2026(dataType, extraFlags = []) {
  const all = [];
  let pageToken = null;
  do {
    const args = ['data', dataType, 'list', '--from', '2026-01-01', '--limit', '500', ...extraFlags];
    if (pageToken) args.push('--page-token', pageToken);
    const res = await runGhealth(args);
    if (res.dataPoints?.length) all.push(...res.dataPoints);
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function rollupAll2026(dataType) {
  const stepDays = dataType === 'total-calories' ? 12 : 80;
  const chunks = [];
  let cur = new Date('2026-01-01T00:00:00Z');
  const endLimit = new Date('2026-11-20T00:00:00Z');
  while (cur < endLimit) {
    const nxt = new Date(cur.getTime() + stepDays * 86400 * 1000);
    const actualEnd = nxt > endLimit ? endLimit : nxt;
    chunks.push([cur.toISOString().slice(0, 10), actualEnd.toISOString().slice(0, 10)]);
    cur = actualEnd;
  }
  const all = [];
  for (let i = 0; i < chunks.length; i += 6) {
    const batch = chunks.slice(i, i + 6);
    const results = await Promise.all(
      batch.map(([f, t]) => runGhealth(['data', dataType, 'daily-rollup', '--from', f, '--to', t]))
    );
    for (const res of results) {
      if (res.dataPoints?.length) all.push(...res.dataPoints);
    }
  }
  return all;
}

async function getValidWriteToken() {
  const targetPath = fs.existsSync(WRITE_CREDS_PATH) ? WRITE_CREDS_PATH : CREDS_PATH;
  const creds = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const expMs = creds.expiry ? new Date(creds.expiry).getTime() : 0;
  if (creds.access_token && expMs - Date.now() > 120 * 1000) return creds.access_token;

  const rawCs = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  const cs = rawCs.installed || rawCs.web || rawCs;
  const body = new URLSearchParams({
    client_id: cs.client_id,
    client_secret: cs.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(tok)}`);
  creds.access_token = tok.access_token;
  creds.expiry = new Date(Date.now() + (tok.expires_in || 3599) * 1000).toISOString();
  fs.writeFileSync(targetPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  return creds.access_token;
}

function buildTimestamps(dateStr, hour = 16, minute = 0, durationMin = 20) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const localStart = new Date(year, month - 1, day, hour, minute, 0);
  const localEnd = new Date(localStart.getTime() + durationMin * 60 * 1000);
  const offsetSeconds = -localStart.getTimezoneOffset() * 60;
  return {
    startPhysical: localStart.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endPhysical: localEnd.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    utcOffset: `${offsetSeconds}s`,
    civilStart: { date: { year, month, day }, time: { hours: localStart.getHours(), minutes: localStart.getMinutes() } },
    civilEnd: {
      date: { year: localEnd.getFullYear(), month: localEnd.getMonth() + 1, day: localEnd.getDate() },
      time: { hours: localEnd.getHours(), minutes: localEnd.getMinutes() },
    },
  };
}

async function postHealthDataPoint(token, dataType, payload) {
  const res = await fetch(`${API_BASE}/${dataType}/dataPoints`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-api-client': 'ghealth/0.1.0',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${dataType} (${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log(`Mode: ${isExecute ? 'EXECUTE LIVE BACKFILL + BUILD VAULT' : 'DRY-RUN AUDIT'}`);

  // 1. Parse MacroFactor 2026 exports
  const mfMaster = readXlsx(MF_MASTER_PATH);
  const mfFoods = readXlsx(MF_FOODS_PATH);

  // Build map of food names per date from MacroFactor timestamped export
  const foodNamesByDate = {};
  for (const row of (mfFoods['in'] || []).slice(1)) {
    const d = excelSerialToIso(row[0]);
    const fname = (row[2] || '').trim();
    if (d && d >= '2026-01-01' && fname) {
      foodNamesByDate[d] = foodNamesByDate[d] || [];
      if (!foodNamesByDate[d].includes(fname)) foodNamesByDate[d].push(fname);
    }
  }

  // Fiber map from Micronutrients sheet
  const fiberByDate = {};
  const microRows = mfMaster['Micronutrients'] || [];
  const fiberIdx = (microRows[0] || []).findIndex((h) => /^Fiber \(g\)$/i.test((h || '').trim()));
  for (const r of microRows.slice(1)) {
    const d = excelSerialToIso(r[0]);
    if (d && d >= '2026-01-01' && fiberIdx !== -1 && r[fiberIdx] != null) {
      fiberByDate[d] = Math.round(Number(r[fiberIdx]) * 10) / 10;
    }
  }

  // Candidate 2026 Nutrition Days
  const candidateNutrition = new Map();
  for (const r of (mfMaster['Calories & Macros'] || []).slice(1)) {
    const d = excelSerialToIso(r[0]);
    const kcal = Math.round(Number(r[1] || 0));
    if (d && d >= '2026-01-01' && kcal > 0) {
      const foods = foodNamesByDate[d] || [];
      let label = 'MacroFactor Daily Nutrition';
      if (foods.length > 0) {
        const top = foods.slice(0, 3).map((s) => s.slice(0, 32)).join(', ');
        label = `MacroFactor: ${top}${foods.length > 3 ? ` (+${foods.length - 3} more)` : ''}`.slice(0, 140);
      }
      candidateNutrition.set(d, {
        date: d,
        hour: 16,
        minute: 30,
        meal: label,
        kcal,
        fat: Math.round(Number(r[2] || 0) * 10) / 10,
        carbs: Math.round(Number(r[3] || 0) * 10) / 10,
        protein: Math.round(Number(r[4] || 0) * 10) / 10,
        fiber: fiberByDate[d] || 0,
      });
    }
  }
  for (const m of VERIFIED_KETOVORE_MEALS_NOV) {
    candidateNutrition.set(m.date, m);
  }

  // Candidate 2026 Weight & Body Fat Days
  const candidateWeights = new Map();
  const candidateBodyFat = new Map();
  for (const r of (mfMaster['Scale Weight'] || []).slice(1)) {
    const d = excelSerialToIso(r[0]);
    const w = Number(r[1]);
    const bf = r[2] != null && r[2] !== '' ? Number(r[2]) : null;
    if (d && d >= '2026-01-01' && w > 100) {
      candidateWeights.set(d, { date: d, hour: 8, minute: 30, w: Math.round(w * 10) / 10 });
      if (bf && bf > 5 && bf < 50) {
        candidateBodyFat.set(d, { date: d, hour: 8, minute: 30, bf: Math.round(bf * 10) / 10 });
      }
    }
  }
  // Verified MorphoScan/Fitdays scans take highest priority
  for (const s of VERIFIED_SCANS_2026) {
    candidateWeights.set(s.date, { date: s.date, hour: s.hour, minute: s.minute, w: s.w });
    if (s.bf) candidateBodyFat.set(s.date, { date: s.date, hour: s.hour, minute: s.minute, bf: s.bf });
  }

  // MacroFactor Trend & Expenditure for Dashboard Analytics
  const mfTrendByDate = {};
  for (const r of (mfMaster['Weight Trend'] || []).slice(1)) {
    const d = excelSerialToIso(r[0]);
    if (d && d >= '2026-01-01' && r[1]) mfTrendByDate[d] = Math.round(Number(r[1]) * 10) / 10;
  }
  const mfExpByDate = {};
  for (const r of (mfMaster['Expenditure'] || []).slice(1)) {
    const d = excelSerialToIso(r[0]);
    if (d && d >= '2026-01-01' && r[1]) mfExpByDate[d] = Math.round(Number(r[1]));
  }

  // 2. Pull existing 2026 Google Health API v4 state
  console.log('Querying existing 2026 Google Health API v4 records...');
  const [exNutrRollup, exWeights, exBodyFats] = await Promise.all([
    rollupAll2026('nutrition-log'),
    listAll2026('weight'),
    listAll2026('body-fat'),
  ]);

  const existingNutrDates = new Set(exNutrRollup.filter((p) => (p.energy?.kcalSum || 0) > 0).map((p) => p.date));
  const existingWeightDates = new Set(exWeights.map((p) => (p.time || '').slice(0, 10)).filter(Boolean));
  const existingBfDates = new Set(exBodyFats.map((p) => (p.time || '').slice(0, 10)).filter(Boolean));

  const missingNutr = [...candidateNutrition.values()].filter((x) => !existingNutrDates.has(x.date)).sort((a, b) => a.date.localeCompare(b.date));
  const missingWeights = [...candidateWeights.values()].filter((x) => !existingWeightDates.has(x.date)).sort((a, b) => a.date.localeCompare(b.date));
  const missingBfs = [...candidateBodyFat.values()].filter((x) => !existingBfDates.has(x.date)).sort((a, b) => a.date.localeCompare(b.date));

  console.log(`Candidate 2026 -> Nutrition: ${candidateNutrition.size}d | Weight: ${candidateWeights.size}d | Body Fat: ${candidateBodyFat.size}d`);
  console.log(`Already in Fitbit -> Nutrition: ${existingNutrDates.size}d | Weight: ${existingWeightDates.size}d | Body Fat: ${existingBfDates.size}d`);
  console.log(`Missing to Backfill -> Nutrition: ${missingNutr.length}d | Weight: ${missingWeights.length}d | Body Fat: ${missingBfs.length}d`);

  if (!isExecute) {
    console.log('Sample missing Nutrition days:', missingNutr.slice(0, 5).map((x) => `${x.date} (${x.kcal} kcal)`), '...', missingNutr.slice(-5).map((x) => `${x.date} (${x.kcal} kcal)`));
    console.log('Sample missing Weight days:', missingWeights.map((x) => `${x.date}:${x.w}`));
    console.log('Sample missing BF% days:', missingBfs.map((x) => `${x.date}:${x.bf}%`));
    return;
  }

  // 3. Execute Deduplicated Backfill to Google Health API v4
  const token = await getValidWriteToken();
  let pushedNutr = 0, pushedWt = 0, pushedBf = 0;

  for (const n of missingNutr) {
    const ts = buildTimestamps(n.date, n.hour, n.minute, 20);
    const nutrients = [
      { nutrient: 'PROTEIN', quantity: { grams: n.protein } },
      { nutrient: 'CARBOHYDRATES', quantity: { grams: n.carbs } },
    ];
    if (n.fiber > 0) nutrients.push({ nutrient: 'DIETARY_FIBER', quantity: { grams: n.fiber } });
    await postHealthDataPoint(token, 'nutrition-log', {
      nutritionLog: {
        foodDisplayName: n.meal,
        mealType: 'DINNER',
        energy: { kcal: n.kcal, userProvidedUnit: 'CALORIE' },
        totalFat: { grams: n.fat },
        totalCarbohydrate: { grams: n.carbs },
        nutrients,
        serving: { amount: 1, foodMeasurementUnit: 'users/me/dataTypes/food-measurement-unit/dataPoints/304' },
        interval: {
          startTime: ts.startPhysical,
          endTime: ts.endPhysical,
          startUtcOffset: ts.utcOffset,
          endUtcOffset: ts.utcOffset,
          civilStartTime: ts.civilStart,
          civilEndTime: ts.civilEnd,
        },
      },
    });
    pushedNutr++;
    await sleepMs(60);
  }

  for (const w of missingWeights) {
    const ts = buildTimestamps(w.date, w.hour, w.minute, 5);
    await postHealthDataPoint(token, 'weight', {
      weight: {
        weightGrams: Math.round(w.w * 453.59237),
        sampleTime: { physicalTime: ts.startPhysical, utcOffset: ts.utcOffset, civilTime: ts.civilStart },
      },
    });
    pushedWt++;
    await sleepMs(60);
  }

  for (const b of missingBfs) {
    const ts = buildTimestamps(b.date, b.hour, b.minute, 5);
    await postHealthDataPoint(token, 'body-fat', {
      bodyFat: {
        percentage: b.bf,
        sampleTime: { physicalTime: ts.startPhysical, utcOffset: ts.utcOffset, civilTime: ts.civilStart },
      },
    });
    pushedBf++;
    await sleepMs(60);
  }

  console.log(`Backfill Complete -> Pushed ${pushedNutr} Nutrition days, ${pushedWt} Weight days, ${pushedBf} Body-Fat days.`);

  // 4. Pull Complete Post-Backfill 2026 YTD Dataset for Super Ketovore Dashboard
  console.log('Pulling unified 2026 Full-Year dataset from Google Health API v4...');
  const [
    stepsRollup,
    kcalRollup,
    nutrRollup,
    sleepPts,
    rhrPts,
    hrvPts,
    spo2Pts,
    bgPts,
    wtPts,
    bfPts,
    exPts,
  ] = await Promise.all([
    rollupAll2026('steps'),
    rollupAll2026('total-calories'),
    rollupAll2026('nutrition-log'),
    listAll2026('sleep'),
    listAll2026('daily-resting-heart-rate'),
    listAll2026('daily-heart-rate-variability'),
    listAll2026('daily-oxygen-saturation'),
    listAll2026('blood-glucose'),
    listAll2026('weight'),
    listAll2026('body-fat'),
    listAll2026('exercise'),
  ]);

  const daysMap = {};
  const getDay = (d) => {
    if (!daysMap[d]) daysMap[d] = { date: d };
    return daysMap[d];
  };

  for (const p of stepsRollup) if (p.date && p.countSum !== undefined) getDay(p.date).steps = Number(p.countSum);
  for (const p of kcalRollup) if (p.date && p.kcalSum !== undefined) getDay(p.date).burn_kcal = Math.round(Number(p.kcalSum));
  for (const p of nutrRollup) {
    if (p.date && (p.energy?.kcalSum || 0) > 0) {
      const nuts = p.nutrients || [];
      const prot = nuts.find((n) => n.nutrient === 'PROTEIN')?.quantity?.gramsSum || 0;
      const fib = nuts.find((n) => n.nutrient === 'DIETARY_FIBER')?.quantity?.gramsSum || 0;
      getDay(p.date).nutrition = {
        kcal: Math.round(Number(p.energy.kcalSum)),
        protein_g: Math.round(Number(prot)),
        fat_g: Math.round(Number(p.totalFat?.gramsSum || 0)),
        carbs_g: Math.round(Number(p.totalCarbohydrate?.gramsSum || 0) * 10) / 10,
        fiber_g: Math.round(Number(fib) * 10) / 10,
      };
    }
  }
  for (const s of sleepPts) {
    const d = (s.end || '').slice(0, 10);
    if (!d || d < '2026-01-01' || s.isNap) continue;
    const asleep = Number(s.minutesAsleep || 0);
    const total = Number(s.totalMinutes || asleep + Number(s.minutesAwake || 0));
    const cur = getDay(d).sleep_min || 0;
    if (asleep > cur) {
      getDay(d).sleep_min = asleep;
      getDay(d).sleep_eff = total > 0 ? Math.round((asleep / total) * 100) : null;
    }
  }
  for (const p of rhrPts) if (p.date && p.date >= '2026-01-01' && p.beatsPerMinute !== undefined) getDay(p.date).rhr = Number(p.beatsPerMinute);
  for (const p of hrvPts) if (p.date && p.date >= '2026-01-01') getDay(p.date).hrv_ms = Math.round(Number(p.averageHeartRateVariabilityMilliseconds || 0) * 10) / 10;
  for (const p of spo2Pts) if (p.date && p.date >= '2026-01-01') getDay(p.date).spo2_pct = Math.round(Number(p.averagePercentage || 0) * 10) / 10;
  for (const p of wtPts) {
    const d = (p.time || '').slice(0, 10);
    if (d && d >= '2026-01-01' && p.weightGrams) getDay(d).weight_lb = Math.round((Number(p.weightGrams) / 453.59237) * 10) / 10;
  }
  for (const p of bfPts) {
    const d = (p.time || '').slice(0, 10);
    if (d && d >= '2026-01-01' && p.percentage) getDay(d).bf_pct = Math.round(Number(p.percentage) * 10) / 10;
  }
  // Overlay verified MorphoScan FFM / SMM / VF where available
  for (const s of VERIFIED_SCANS_2026) {
    const o = getDay(s.date);
    o.weight_lb = s.w;
    o.bf_pct = s.bf;
    o.ffm_lb = s.ffm;
    o.vf_grade = s.vf;
    if (s.smm) o.smm_lb = s.smm;
  }
  for (const p of bgPts) {
    const d = (p.time || '').slice(0, 10);
    if (d && d >= '2026-01-01' && p.bloodGlucoseMilligramsPerDeciliter) {
      const o = getDay(d);
      o.bg_list = o.bg_list || [];
      o.bg_list.push(Number(p.bloodGlucoseMilligramsPerDeciliter));
    }
  }
  for (const [d, k] of Object.entries(VERIFIED_KETONES_2026)) {
    const o = getDay(d);
    o.bhb_mmol = k.bhb;
    o.gki = k.gki;
    o.dbr = k.dbr;
    if (!o.bg_mg_dl) o.bg_mg_dl = k.bg;
  }
  for (const ex of exPts) {
    const d = (ex.start || '').slice(0, 10);
    if (d && d >= '2026-01-01') {
      const o = getDay(d);
      o.workouts = (o.workouts || 0) + 1;
    }
  }

  // Finalize daily array & monthly rollups
  const allDates = Object.keys(daysMap).filter((d) => d >= '2026-01-01').sort();
  const dailyList = allDates.map((d) => {
    const o = daysMap[d];
    if (o.bg_list?.length) {
      o.bg_mg_dl = Math.round((o.bg_list.reduce((a, b) => a + b, 0) / o.bg_list.length) * 10) / 10;
      delete o.bg_list;
    }
    if (mfTrendByDate[d]) o.trend_weight_lb = mfTrendByDate[d];
    if (mfExpByDate[d]) o.mf_expenditure_kcal = mfExpByDate[d];
    return o;
  });

  const monthsMap = {};
  for (const r of dailyList) {
    const ym = r.date.slice(0, 7);
    if (!monthsMap[ym]) monthsMap[ym] = [];
    monthsMap[ym].push(r);
  }

  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
  const monthlySummaries = Object.keys(monthsMap).sort().map((ym) => {
    const rows = monthsMap[ym];
    const wts = rows.filter((x) => x.weight_lb != null).map((x) => x.weight_lb);
    const bfs = rows.filter((x) => x.bf_pct != null).map((x) => x.bf_pct);
    const steps = rows.filter((x) => x.steps != null).map((x) => x.steps);
    const burns = rows.filter((x) => x.burn_kcal != null).map((x) => x.burn_kcal);
    const kcals = rows.filter((x) => x.nutrition?.kcal != null).map((x) => x.nutrition.kcal);
    const prots = rows.filter((x) => x.nutrition?.protein_g != null).map((x) => x.nutrition.protein_g);
    const sleeps = rows.filter((x) => x.sleep_min != null).map((x) => x.sleep_min);
    const hrvs = rows.filter((x) => x.hrv_ms != null).map((x) => x.hrv_ms);
    const rhrs = rows.filter((x) => x.rhr != null).map((x) => x.rhr);
    const workouts = rows.reduce((s, x) => s + (x.workouts || 0), 0);

    return {
      month: ym,
      days_tracked: rows.length,
      start_weight_lb: wts.length ? wts[0] : null,
      end_weight_lb: wts.length ? wts[wts.length - 1] : null,
      min_weight_lb: wts.length ? Math.min(...wts) : null,
      avg_bf_pct: avg(bfs),
      avg_steps: steps.length ? Math.round(avg(steps)) : null,
      peak_steps: steps.length ? Math.max(...steps) : null,
      avg_burn_kcal: burns.length ? Math.round(avg(burns)) : null,
      logged_nutrition_days: kcals.length,
      avg_intake_kcal: kcals.length ? Math.round(avg(kcals)) : null,
      avg_protein_g: prots.length ? Math.round(avg(prots)) : null,
      avg_sleep_hm: sleeps.length ? `${Math.floor(avg(sleeps) / 60)}h ${String(Math.round(avg(sleeps) % 60)).padStart(2, '0')}m` : null,
      avg_hrv_ms: avg(hrvs),
      avg_rhr_bpm: rhrs.length ? Math.round(avg(rhrs)) : null,
      total_workouts: workouts,
    };
  });

  const fullPayload = {
    generated_at: new Date().toISOString(),
    year: 2026,
    total_days: dailyList.length,
    backfill_summary: {
      pushed_nutrition_days: pushedNutr,
      pushed_weight_days: pushedWt,
      pushed_body_fat_days: pushedBf,
    },
    monthly_summaries: monthlySummaries,
    daily_records: dailyList,
  };

  fs.writeFileSync(OUTPUT_FULL_PATH, JSON.stringify(fullPayload, null, 2), 'utf8');
  console.log(`Wrote ${dailyList.length} daily records & ${monthlySummaries.length} monthly rollups -> ${OUTPUT_FULL_PATH}`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
