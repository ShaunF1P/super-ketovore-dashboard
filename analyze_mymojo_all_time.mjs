import fs from 'fs';

const logPath = 'C:/Users/shaun/.gemini/antigravity/brain/3f84b8b7-c0ec-41f5-b018-abf623dc3ba5/.system_generated/logs/transcript_full.jsonl';
const vaultPath = './mymojohealth_all_time_vault.json';

let rawRows = null;

if (fs.existsSync(logPath)) {
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = JSON.parse(lines[i]);
    const candidates = [];
    if (typeof obj.content === 'string') candidates.push(obj.content);
    if (Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        const args = tc?.args || tc?.arguments || {};
        if (typeof args.Message === 'string') candidates.push(args.Message);
      }
    }
    for (const c of candidates) {
      const idx = c.indexOf('```json');
      if (idx !== -1) {
        const end = c.indexOf('```', idx + 7);
        if (end !== -1) {
          try {
            const parsed = JSON.parse(c.slice(idx + 7, end).trim());
            if (Array.isArray(parsed) && parsed.length > 50) {
              rawRows = parsed;
              break;
            }
          } catch {}
        }
      }
    }
    if (rawRows) break;
  }
}

if (!rawRows && fs.existsSync(vaultPath)) {
  rawRows = JSON.parse(fs.readFileSync(vaultPath, 'utf8')).readings;
}

if (!rawRows) {
  console.error('Could not locate MyMojoHealth JSON array');
  process.exit(1);
}

// Group readings into paired daily/session summaries by local date + approximate minute window (within 10 min)
const byDate = new Map();
for (const r of rawRows) {
  const date = r.ts.slice(0, 10);
  if (!byDate.has(date)) {
    byDate.set(date, {
      date,
      blood_glucose_mg_dl: [],
      ketones_mmol_l: [],
      gki_values: [],
      cgm_glucose_mg_dl: [],
      raw: []
    });
  }
  const d = byDate.get(date);
  d.raw.push(r);
  if (r.type === 'Glucose Blood' && r.glucose != null) d.blood_glucose_mg_dl.push({ ts: r.ts, val: r.glucose, src: r.src });
  if (r.type === 'Ketones Blood' && r.ketone != null) d.ketones_mmol_l.push({ ts: r.ts, val: r.ketone, src: r.src });
  if (r.type === 'GKI' && r.gki != null) d.gki_values.push({ ts: r.ts, val: r.gki, src: r.src });
  if (r.type === 'Glucose CGM' && r.glucose != null) d.cgm_glucose_mg_dl.push({ ts: r.ts, val: r.glucose, src: r.src });
}

const dailySummaries = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).map((d) => {
  // Primary morning / best reading of day
  const bestBhb = d.ketones_mmol_l.length ? Math.max(...d.ketones_mmol_l.map((x) => x.val)) : null;
  const firstBg = d.blood_glucose_mg_dl.length ? d.blood_glucose_mg_dl[d.blood_glucose_mg_dl.length - 1].val : null;
  const bestGki = d.gki_values.length ? Math.min(...d.gki_values.map((x) => x.val)) : (firstBg != null && bestBhb ? Number(((firstBg / 18) / bestBhb).toFixed(1)) : null);
  const dbr = firstBg != null && bestBhb ? Number((firstBg / bestBhb).toFixed(1)) : null;
  return {
    date: d.date,
    bg_mg_dl: firstBg,
    bhb_mmol_l: bestBhb,
    gki: bestGki,
    dbr,
    bg_count: d.blood_glucose_mg_dl.length,
    bhb_count: d.ketones_mmol_l.length,
    cgm_count: d.cgm_glucose_mg_dl.length
  };
});

const vault = {
  extracted_at: new Date().toISOString(),
  source: 'https://app.mymojohealth.com/my/readings',
  meter_device: 'GK+E64F',
  total_rows: rawRows.length,
  unique_days: dailySummaries.length,
  ketone_days: dailySummaries.filter((d) => d.bhb_mmol_l != null).length,
  blood_glucose_days: dailySummaries.filter((d) => d.bg_mg_dl != null).length,
  earliest_ts: rawRows[rawRows.length - 1].ts,
  latest_ts: rawRows[0].ts,
  daily_summaries: dailySummaries,
  readings: rawRows
};

fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2));

console.log(`Saved ${rawRows.length} rows across ${dailySummaries.length} unique days (${vault.ketone_days} ketone days, ${vault.blood_glucose_days} blood glucose days)`);
console.log(`Range: ${vault.earliest_ts} -> ${vault.latest_ts}`);

const topKetones = dailySummaries.filter((d) => d.bhb_mmol_l != null).sort((a, b) => b.bhb_mmol_l - a.bhb_mmol_l).slice(0, 15);
console.log('\nTOP 15 ALL-TIME KETONE DAYS:');
for (const k of topKetones) {
  console.log(`  ${k.date}: BHB ${k.bhb_mmol_l} mmol/L | BG ${k.bg_mg_dl ?? '--'} mg/dL | GKI ${k.gki ?? '--'} | DBR ${k.dbr ?? '--'}`);
}

const byMonth = new Map();
for (const d of dailySummaries) {
  const ym = d.date.slice(0, 7);
  if (!byMonth.has(ym)) byMonth.set(ym, { ym, days: 0, bhb: [], bg: [], gki: [] });
  const m = byMonth.get(ym);
  m.days++;
  if (d.bhb_mmol_l != null) m.bhb.push(d.bhb_mmol_l);
  if (d.bg_mg_dl != null) m.bg.push(d.bg_mg_dl);
  if (d.gki != null) m.gki.push(d.gki);
}
const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '--';
console.log('\nMONTHLY ROLLUP:');
for (const [ym, m] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const maxBhb = m.bhb.length ? Math.max(...m.bhb).toFixed(1) : '--';
  const minGki = m.gki.length ? Math.min(...m.gki).toFixed(1) : '--';
  console.log(`  ${ym}: ${m.bhb.length} BHB days (Avg ${avg(m.bhb)}, Max ${maxBhb}) | ${m.bg.length} BG days (Avg ${avg(m.bg)}) | Avg GKI ${avg(m.gki)} (Best ${minGki})`);
}
