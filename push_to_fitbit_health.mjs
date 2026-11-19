#!/usr/bin/env node
/**
 * Super Ketovore Dashboard -> Fitbit Air / Google Health App Direct Push Engine
 * ==============================================================================
 * Pushes verified Ketovore Meals (Calories, Protein, Fat, Total Carbs, Fiber)
 * AND MorphoScan Scale Weight (lb) + Body Fat (%) directly into Shaun's
 * Fitbit Air / Google Health App via Google Health API v4 (`health.googleapis.com/v4`).
 *
 *Note on Scopes:
 *  `ghealth` v0.1.0 omits the `.writeonly` suffix required by Google Health API v4
 *  (`googlehealth.nutrition.writeonly`, `googlehealth.health_metrics_and_measurements.writeonly`)
 *  and adds `cloud-platform` (disallowed). Run `node push_to_fitbit_health.mjs --login` once to
 *  authorize the exact valid `.readonly` + `.writeonly` scopes.
 *
 * Usage:
 *   node push_to_fitbit_health.mjs --login
 *   node push_to_fitbit_health.mjs --meal "Ketovore Meal" --kcal 1045 --protein 111 --fat 62 --carbs 9.5 --fiber 2 --meal-type DINNER --date 2026-11-18 --hour 15 --minute 30
 *   node push_to_fitbit_health.mjs --weight 199.2 --body-fat 25.5 --date 2026-11-18 --hour 8 --minute 10
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const GHEALTH_DIR = path.join(os.homedir(), '.config', 'ghealth');
const CLIENT_SECRET_PATH = path.join(GHEALTH_DIR, 'client_secret.json');
const CREDS_PATH = path.join(GHEALTH_DIR, 'credentials.json');
const WRITE_CREDS_PATH = path.join(GHEALTH_DIR, 'write_credentials.json');
const API_BASE = 'https://health.googleapis.com/v4/users/me/dataTypes';

const VALID_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.writeonly',
  'https://www.googleapis.com/auth/googlehealth.profile.readonly',
  'https://www.googleapis.com/auth/googlehealth.settings.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
  'https://www.googleapis.com/auth/googlehealth.ecg.readonly',
  'https://www.googleapis.com/auth/googlehealth.irn.readonly',
];

function getClientSecret() {
  const raw = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  return raw.installed || raw.web || raw;
}

async function runOAuthLogin() {
  const cs = getClientSecret();
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const addr = server.address();
        if (!addr) {
          res.writeHead(200);
          res.end();
          return;
        }
        const reqUrl = new URL(req.url, `http://127.0.0.1:${addr.port}`);
        const code = reqUrl.searchParams.get('code');
        const err = reqUrl.searchParams.get('error');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h2>Authorization failed: ${err}</h2>`);
          server.close();
          return reject(new Error(`OAuth error: ${err}`));
        }
        if (!code) {
          res.writeHead(200);
          res.end('Waiting for code...');
          return;
        }

        const redirectUri = `http://127.0.0.1:${server.address().port}/`;
        const body = new URLSearchParams({
          code,
          client_id: cs.client_id,
          client_secret: cs.client_secret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });

        const tokRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
        const tok = await tokRes.json();
        if (!tokRes.ok || !tok.access_token) {
          throw new Error(`Token exchange failed: ${JSON.stringify(tok)}`);
        }

        const existing = fs.existsSync(CREDS_PATH) ? JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')) : {};
        const saved = {
          access_token: tok.access_token,
          refresh_token: tok.refresh_token || existing.refresh_token,
          token_type: tok.token_type || 'Bearer',
          expiry: new Date(Date.now() + (tok.expires_in || 3599) * 1000).toISOString(),
          granted_scope_str: tok.scope || '',
          scopes: (tok.scope || '').split(' ').filter(Boolean).map((s) => s.replace('https://www.googleapis.com/auth/googlehealth.', '')),
        };

        fs.writeFileSync(WRITE_CREDS_PATH, JSON.stringify(saved, null, 2), { mode: 0o600 });
        fs.writeFileSync(CREDS_PATH, JSON.stringify(saved, null, 2), { mode: 0o600 });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Google Health Read/Write Authorized! You can close this tab and return to Antigravity.</h2>');
        console.log('Authorized scopes:', tok.scope);
        server.close(() => resolve(saved));
      } catch (e) {
        res.writeHead(500);
        res.end('Error completing auth');
        server.close();
        reject(e);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/`;
      const authUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
          access_type: 'offline',
          prompt: 'consent',
          client_id: cs.client_id,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: VALID_SCOPES.join(' '),
          state,
        }).toString();

      console.log('\nOpen this URL in your browser (make sure all checkboxes are checked):\n');
      console.log(authUrl);
      console.log(`\nListening on ${redirectUri} ...`);

      if (process.platform === 'win32') {
        execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${authUrl}'; Set-Clipboard -Value '${authUrl}'`], () => {});
      }
    });
  });
}

async function getValidWriteToken() {
  const targetPath = fs.existsSync(WRITE_CREDS_PATH) ? WRITE_CREDS_PATH : CREDS_PATH;
  const creds = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const expMs = creds.expiry ? new Date(creds.expiry).getTime() : 0;

  if (creds.access_token && expMs - Date.now() > 120 * 1000) {
    return creds.access_token;
  }

  const cs = getClientSecret();
  const body = new URLSearchParams({
    client_id: cs.client_id,
    client_secret: cs.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) {
    throw new Error(`Refresh failed: ${JSON.stringify(tok)}`);
  }
  creds.access_token = tok.access_token;
  creds.expiry = new Date(Date.now() + (tok.expires_in || 3599) * 1000).toISOString();
  fs.writeFileSync(targetPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  return creds.access_token;
}

function buildTimestamps(dateStr, hour, minute, durationMin = 20) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const localStart = new Date(year, month - 1, day, hour, minute, 0);
  const localEnd = new Date(localStart.getTime() + durationMin * 60 * 1000);
  const offsetSeconds = -localStart.getTimezoneOffset() * 60;

  return {
    startPhysical: localStart.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endPhysical: localEnd.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    utcOffset: `${offsetSeconds}s`,
    civilStart: {
      date: { year, month, day },
      time: { hours: localStart.getHours(), minutes: localStart.getMinutes() },
    },
    civilEnd: {
      date: {
        year: localEnd.getFullYear(),
        month: localEnd.getMonth() + 1,
        day: localEnd.getDate(),
      },
      time: { hours: localEnd.getHours(), minutes: localEnd.getMinutes() },
    },
  };
}

async function postHealthDataPoint(token, dataType, payload) {
  const url = `${API_BASE}/${dataType}/dataPoints`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-api-client': 'ghealth/0.1.0',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${dataType} failed (HTTP ${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : fallback;
}

async function main() {
  if (process.argv.includes('--login')) {
    await runOAuthLogin();
    return;
  }

  const now = new Date();
  const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const dateStr = getArg('--date', defaultDate);
  const hour = Number(getArg('--hour', now.getHours()));
  const minute = Number(getArg('--minute', now.getMinutes()));

  const mealName = getArg('--meal');
  const weightLb = getArg('--weight');
  const bodyFatPct = getArg('--body-fat');

  if (!mealName && !weightLb && !bodyFatPct) {
    console.error('Pass --login, or --meal "..." (with --kcal, --protein, --fat, --carbs, --fiber) and/or --weight <lb> --body-fat <pct>');
    process.exit(1);
  }

  const token = await getValidWriteToken();
  const ts = buildTimestamps(dateStr, hour, minute, 20);

  if (mealName) {
    const kcal = Number(getArg('--kcal', 0));
    const protein = Number(getArg('--protein', 0));
    const fat = Number(getArg('--fat', 0));
    const totalCarbs = Number(getArg('--carbs', 0));
    const fiber = Number(getArg('--fiber', 0));
    const mealType = getArg('--meal-type', 'DINNER').toUpperCase();

    const nutrients = [
      { nutrient: 'PROTEIN', quantity: { grams: protein } },
      { nutrient: 'CARBOHYDRATES', quantity: { grams: totalCarbs } },
    ];
    if (fiber > 0) {
      nutrients.push({ nutrient: 'DIETARY_FIBER', quantity: { grams: fiber } });
    }

    const payload = {
      nutritionLog: {
        foodDisplayName: mealName,
        mealType,
        energy: { kcal, userProvidedUnit: 'CALORIE' },
        totalFat: { grams: fat },
        totalCarbohydrate: { grams: totalCarbs },
        nutrients,
        serving: {
          amount: 1,
          foodMeasurementUnit: 'users/me/dataTypes/food-measurement-unit/dataPoints/304',
        },
        interval: {
          startTime: ts.startPhysical,
          endTime: ts.endPhysical,
          startUtcOffset: ts.utcOffset,
          endUtcOffset: ts.utcOffset,
          civilStartTime: ts.civilStart,
          civilEndTime: ts.civilEnd,
        },
      },
    };

    const result = await postHealthDataPoint(token, 'nutrition-log', payload);
    console.log(`Pushed meal: "${mealName}" (${kcal} kcal | ${protein}g P | ${fat}g F | ${totalCarbs}g C) ->`, JSON.stringify(result));
  }

  if (weightLb) {
    const grams = Math.round(Number(weightLb) * 453.59237);
    let notes = getArg('--notes');
    if (!notes) {
      const liveSyncPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'health_connect_live_sync.json');
      if (fs.existsSync(liveSyncPath)) {
        try {
          const bs = JSON.parse(fs.readFileSync(liveSyncPath, 'utf8')).custom_bio_states;
          if (bs) {
            notes = `CNS:${bs.cns_readiness.tier}(${bs.cns_readiness.score}) | Nadir:${bs.circadian_nadir.nadir_bpm}bpm@${bs.circadian_nadir.nadir_clock} | TrueFat:${bs.true_fat_split.true_fat_delta_lb}lb | VMVI:${bs.visceral_melt_velocity.score}/100`;
          }
        } catch {}
      }
    }
    const payload = {
      weight: {
        weightGrams: grams,
        ...(notes ? { notes } : {}),
        sampleTime: {
          physicalTime: ts.startPhysical,
          utcOffset: ts.utcOffset,
          civilTime: ts.civilStart,
        },
      },
    };
    const result = await postHealthDataPoint(token, 'weight', payload);
    console.log(`Pushed weight: ${weightLb} lb (${grams}g)${notes ? ` [Notes: ${notes}]` : ''} ->`, JSON.stringify(result));
  }

  if (bodyFatPct) {
    const payload = {
      bodyFat: {
        percentage: Number(bodyFatPct),
        sampleTime: {
          physicalTime: ts.startPhysical,
          utcOffset: ts.utcOffset,
          civilTime: ts.civilStart,
        },
      },
    };
    const result = await postHealthDataPoint(token, 'body-fat', payload);
    console.log(`Pushed body fat: ${bodyFatPct}% ->`, JSON.stringify(result));
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
