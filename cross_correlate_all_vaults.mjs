import fs from 'node:fs';
import zlib from 'node:zlib';

const MF_MASTER_PATH = "G:\\My Drive\\I am sharing 'MacroFactor-20260603144040' with you";
const MF_FOODS_PATH = 'G:\\My Drive\\Download\\MacroFactor-20260527164342.xlsx';
const MYMOJO_PATH = 'c:\\projects\\Ketovore\\super-ketovore-dashboard\\mymojohealth_all_time_vault.json';
const OXEFIT_PATH = 'c:\\projects\\Ketovore\\super-ketovore-dashboard\\oxefit_all_time_vault.json';
const HIST26_PATH = 'c:\\projects\\Ketovore\\super-ketovore-dashboard\\history_2026_full.json';

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

function addDays(iso, delta) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const fmt = (v, dec = 2) => (v == null || Number.isNaN(v) ? '--' : v.toFixed(dec));

const mfMaster = readXlsx(MF_MASTER_PATH);
const mfFoods = readXlsx(MF_FOODS_PATH);
const mymojo = JSON.parse(fs.readFileSync(MYMOJO_PATH, 'utf8'));
const oxefit = JSON.parse(fs.readFileSync(OXEFIT_PATH, 'utf8'));
const hist26 = JSON.parse(fs.readFileSync(HIST26_PATH, 'utf8'));

// Build unified day ledger across 2024-09 -> 2026-11
const days = new Map();
const getDay = (d) => {
  if (!days.has(d)) {
    days.set(d, {
      date: d,
      foods: [],
      first_bite_hr: null,
      last_bite_hr: null,
      kcal: null,
      fat: null,
      carbs: null,
      protein: null,
      fiber: null,
      sodium_mg: null,
      potassium_mg: null,
      omega3_g: null,
      caffeine_mg: null,
      steps: null,
      weight_lb: null,
      oxefit_vol: 0,
      oxefit_sessions: 0,
      sleep_min: null,
      hrv_ms: null,
      am_bg: null,
      am_bhb: null,
      am_gki: null,
      am_prick_hr: null,
      pm8_cgm: null,
    });
  }
  return days.get(d);
};

// 1. MF Macros
for (const r of (mfMaster['Calories & Macros'] || []).slice(1)) {
  const d = excelSerialToIso(r[0]);
  const kcal = Number(r[1] || 0);
  if (d && kcal > 0) {
    const o = getDay(d);
    o.kcal = kcal;
    o.fat = Number(r[2] || 0);
    o.carbs = Number(r[3] || 0);
    o.protein = Number(r[4] || 0);
  }
}

// 2. MF Steps & Scale Weight
for (const r of (mfMaster['Steps'] || []).slice(1)) {
  const d = excelSerialToIso(r[0]);
  if (d && r[1] != null) getDay(d).steps = Number(r[1]);
}
for (const r of (mfMaster['Scale Weight'] || []).slice(1)) {
  const d = excelSerialToIso(r[0]);
  if (d && Number(r[1]) > 100) getDay(d).weight_lb = Number(r[1]);
}

// 3. MF Itemized Foods + Meal Clock Times + Micros
for (const r of (mfFoods['in'] || []).slice(1)) {
  const d = excelSerialToIso(r[0]);
  const hr = r[1] != null && r[1] !== '' ? Number(r[1]) * 24 : null;
  const name = (r[2] || '').trim();
  const kcal = Number(r[6] || 0);
  if (!d || !name) continue;
  const o = getDay(d);
  o.foods.push({
    name,
    hr,
    kcal,
    fat: Number(r[7] || 0),
    carbs: Number(r[8] || 0),
    protein: Number(r[9] || 0),
    caffeine: Number(r[17] || 0),
    choline: Number(r[20] || 0),
    fiber: Number(r[27] || 0),
    omega3: Number(r[40] || 0) + Number(r[38] || 0) + Number(r[39] || 0),
    potassium: Number(r[44] || 0),
    sodium: Number(r[46] || 0),
  });
  // Only count real caloric bites (>25 kcal) for eating window start/cutoff
  if (hr != null && kcal >= 25) {
    if (o.first_bite_hr == null || hr < o.first_bite_hr) o.first_bite_hr = hr;
    if (o.last_bite_hr == null || hr > o.last_bite_hr) o.last_bite_hr = hr;
  }
}

for (const o of days.values()) {
  if (o.foods.length > 0) {
    o.fiber = o.foods.reduce((s, f) => s + f.fiber, 0);
    o.sodium_mg = o.foods.reduce((s, f) => s + f.sodium, 0);
    o.potassium_mg = o.foods.reduce((s, f) => s + f.potassium, 0);
    o.omega3_g = o.foods.reduce((s, f) => s + f.omega3, 0);
    o.caffeine_mg = o.foods.reduce((s, f) => s + f.caffeine, 0);
  }
}

// 4. Overlay 2026 Full History (includes Nov 2026 verified meals, weights, steps, sleep, HRV)
for (const r of hist26.daily_records || []) {
  const o = getDay(r.date);
  if (r.steps != null) o.steps = r.steps;
  if (r.weight_lb != null) o.weight_lb = r.weight_lb;
  if (r.sleep_min != null) o.sleep_min = r.sleep_min;
  if (r.hrv_ms != null) o.hrv_ms = r.hrv_ms;
  if (r.nutrition && !o.kcal) {
    o.kcal = r.nutrition.kcal;
    o.protein = r.nutrition.protein_g;
    o.fat = r.nutrition.fat_g;
    o.carbs = r.nutrition.carbs_g;
    o.fiber = r.nutrition.fiber_g;
  }
}

// Add Nov 2026 verified meal clock times & food items explicitly
const NOV26_MEALS = [
  { d: '2026-11-08', first: 16.0, last: 16.5, foods: ['sardine', 'mct oil'], kcal: 530, p: 44, f: 38, c: 0 },
  { d: '2026-11-09', first: 16.0, last: 16.5, foods: ['sardine', 'mct oil'], kcal: 530, p: 44, f: 38, c: 0 },
  { d: '2026-11-10', first: 16.0, last: 17.0, foods: ['beef brisket', 'slate', 'mct oil'], kcal: 1255, p: 120, f: 84, c: 5 },
  { d: '2026-11-11', first: 12.0, last: 17.0, foods: ['beef', 'eggs', 'mct oil'], kcal: 1550, p: 145, f: 105, c: 5 },
  { d: '2026-11-12', first: 12.5, last: 17.2, foods: ['sardine', 'beef', 'mct oil', 'eggs'], kcal: 1480, p: 140, f: 98, c: 4 },
  { d: '2026-11-13', first: 12.0, last: 17.5, foods: ['beef short rib', 'eggs', 'mct oil'], kcal: 1680, p: 155, f: 112, c: 6 },
  { d: '2026-11-14', first: 11.5, last: 19.5, foods: ['oysters', 'beef burger', 'cheese', 'chicken'], kcal: 2850, p: 199, f: 215, c: 13 },
  { d: '2026-11-15', first: 13.3, last: 19.5, foods: ['salmon', 'beef filet', 'shrimp', 'eggs', 'guacamole', 'mct oil', 'slate', 'butter'], kcal: 3280, p: 235, f: 248, c: 14 },
  { d: '2026-11-16', first: 18.0, last: 18.3, foods: ['ground beef', 'slate', 'mct oil', 'kimchi'], kcal: 1710, p: 143, f: 122, c: 6 },
  { d: '2026-11-17', first: 8.0, last: 16.0, foods: ['slate', 'mct oil', 'beef sirloin', 'shrimp', 'broccoli'], kcal: 1545, p: 146, f: 93, c: 21 },
  { d: '2026-11-18', first: 9.5, last: 15.75, foods: ['ground beef', 'cheese', 'slate', 'mct oil', 'turkey burger'], kcal: 1880, p: 176, f: 124.5, c: 12.5 },
  { d: '2026-11-19', first: 8.5, last: 20.3, foods: ['mct oil', 'slate', 'ground beef', 'chicken wings'], kcal: 2105, p: 209, f: 132.1, c: 10.3 },
];
for (const m of NOV26_MEALS) {
  const o = getDay(m.d);
  o.first_bite_hr = m.first;
  o.last_bite_hr = m.last;
  o.kcal = m.kcal;
  o.protein = m.p;
  o.fat = m.f;
  o.carbs = m.c;
  if (!o.foods.length) {
    o.foods = m.foods.map((name) => ({ name, hr: m.last, kcal: m.kcal / m.foods.length, fat: 0, carbs: 0, protein: 0, caffeine: 0, choline: 0, fiber: 0, omega3: 0, potassium: 0, sodium: 0 }));
  }
}

// 5. OxeFit Sessions
const oxeSessions = oxefit.sessions || oxefit.workouts || (Array.isArray(oxefit) ? oxefit : []);
for (const s of oxeSessions) {
  const rawDate = (s.date || s.startTime || s.createdAt || s.started_at || '').slice(0, 10);
  if (rawDate) {
    const o = getDay(rawDate);
    o.oxefit_vol += Number(s.totalVolume || s.volume || s.total_volume_lb || 0);
    o.oxefit_sessions += 1;
  }
}

// 6. MyMojoHealth Readings (All 603 rows)
const allMojoReadings = mymojo.readings || [];
for (const r of allMojoReadings) {
  const d = r.ts.slice(0, 10);
  const hr = Number(r.ts.slice(11, 13)) + Number(r.ts.slice(14, 16)) / 60;
  const o = getDay(d);
  if (r.type === 'Ketones Blood' && r.ketone != null) {
    // Prefer morning reading (04:00 - 13:30) as AM check, else first of day
    if (o.am_bhb == null || (hr >= 4 && hr <= 13.5)) {
      o.am_bhb = r.ketone;
      o.am_prick_hr = hr;
    }
  }
  if (r.type === 'Glucose Blood' && r.glucose != null) {
    if (o.am_bg == null || (hr >= 4 && hr <= 13.5)) {
      o.am_bg = r.glucose;
      if (o.am_prick_hr == null) o.am_prick_hr = hr;
    }
  }
  if (r.type === 'GKI' && r.gki != null) {
    if (o.am_gki == null || (hr >= 4 && hr <= 13.5)) {
      o.am_gki = r.gki;
    }
  }
  if (r.type === 'Glucose CGM' && r.glucose != null && hr >= 18) {
    o.pm8_cgm = r.glucose;
  }
}
for (const o of days.values()) {
  if (o.am_gki == null && o.am_bg != null && o.am_bhb != null && o.am_bhb > 0) {
    o.am_gki = Number(((o.am_bg / 18) / o.am_bhb).toFixed(1));
  }
}

// --- BUILD PRIOR-DAY (D) -> NEXT-MORNING (D+1) PAIRS ---
const pairs = [];
for (const [d, today] of days.entries()) {
  const next = days.get(addDays(d, 1));
  if (!next) continue;
  const wtDelta = today.weight_lb != null && next.weight_lb != null ? next.weight_lb - today.weight_lb : null;
  pairs.push({
    d,
    nextDate: next.date,
    today,
    nextBg: next.am_bg,
    nextBhb: next.am_bhb,
    nextGki: next.am_gki,
    nextPrickHr: next.am_prick_hr,
    wtDelta,
    sameNightCgm: today.pm8_cgm,
  });
}

function summarizeGroup(label, list) {
  const bhbs = list.filter((x) => x.nextBhb != null).map((x) => x.nextBhb);
  const bgs = list.filter((x) => x.nextBg != null).map((x) => x.nextBg);
  const gkis = list.filter((x) => x.nextGki != null).map((x) => x.nextGki);
  const wts = list.filter((x) => x.wtDelta != null).map((x) => x.wtDelta);
  const cgms = list.filter((x) => x.sameNightCgm != null).map((x) => x.sameNightCgm);
  console.log(
    `  ${label.padEnd(36)} | N_tot=${String(list.length).padStart(3)} | BHB(n=${String(bhbs.length).padStart(2)}): ${fmt(avg(bhbs))} | BG(n=${String(bgs.length).padStart(2)}): ${fmt(avg(bgs), 1)} | GKI: ${fmt(avg(gkis), 2)} | dWt(n=${String(wts.length).padStart(3)}): ${fmt(avg(wts), 2)} lb | 8pCGM(n=${String(cgms.length).padStart(2)}): ${fmt(avg(cgms), 1)}`
  );
}

console.log('\n=== 1. SPECIFIC FOOD CATEGORIES ON DAY D -> DAY D+1 KETONES, GLUCOSE, GKI & WEIGHT DELTA ===');
const foodLoggedPairs = pairs.filter((p) => p.today.foods.length > 0);
console.log(`Total Days with Itemized Foods: ${foodLoggedPairs.length}`);

const foodCategories = [
  ['Sardines / Mackerel / Canned Fish', /sardine|mackerel|kipper|herring|anchov/i],
  ['MCT Oil / Coconut Oil', /\bmct\b|coconut oil|caprylic/i],
  ['Beef / Steak / Ribeye / Brisket / Burger', /\bbeef\b|ribeye|sirloin|steak|brisket|chuck|short rib|filet|burger/i],
  ['Whole Eggs / Egg Whites', /\begg\b|\beggs\b/i],
  ['Chicken / Wings / Poultry', /chicken|wing|thigh|drumstick|rotisserie/i],
  ['Turkey (Ground / Burgers / Breast)', /turkey/i],
  ['Salmon / Shrimp / Oysters / Seafood', /salmon|shrimp|oyster|cod|tuna|mah|crab|lobster|fish/i],
  ['Pork / Bacon / Sausage / Ham', /pork|bacon|sausage|ham|chorizo|pepperoni|salami/i],
  ['Cheese / Cream / Yogurt / Dairy', /cheese|cheddar|mozzarella|parmesan|cream|yogurt|cottage|american|swiss|provolone/i],
  ['Protein Shake / Slate / Whey / Bar', /slate|whey|shake|protein bar|quest|fairlife|premier|isolate|casein/i],
  ['Butter / Ghee / Tallow', /butter|ghee|tallow/i],
  ['Avocado / Guacamole / Olive Oil', /avocado|guac|olive oil/i],
  ['Nuts / Nut Butter (Almond/Peanut/Mac)', /almond|peanut|walnut|pecan|cashew|macadamia|pistachio|brazil/i],
  ['Fermented / Veggies (Kimchi/Broccoli)', /kimchi|broccoli|asparagus|spinach|salad|lettuce|pickle|sauerkraut/i],
  ['High-Carb / Bread / Rice / Sugar / Fruit', /bread|rice|pasta|pizza|potato|fries|chip|cookie|cake|ice cream|tortilla|bun|oat|banana|apple|berry|sugar|candy|honey/i],
];

for (const [label, rx] of foodCategories) {
  const matching = foodLoggedPairs.filter((p) => p.today.foods.some((f) => rx.test(f.name)));
  if (matching.length >= 3) summarizeGroup(label, matching);
}

console.log('\n=== 2. LAST BITE CLOCK TIME (KITCHEN CUTOFF) ON DAY D -> DAY D+1 METRICS ===');
const timedPairs = pairs.filter((p) => p.today.last_bite_hr != null);
summarizeGroup('Cutoff <= 4:30 PM (<=16.5h)', timedPairs.filter((p) => p.today.last_bite_hr <= 16.5));
summarizeGroup('Cutoff 4:31 - 6:00 PM (16.5-18h)', timedPairs.filter((p) => p.today.last_bite_hr > 16.5 && p.today.last_bite_hr <= 18.0));
summarizeGroup('Cutoff 6:01 - 7:30 PM (18-19.5h)', timedPairs.filter((p) => p.today.last_bite_hr > 18.0 && p.today.last_bite_hr <= 19.5));
summarizeGroup('Cutoff > 7:30 PM (>19.5h)', timedPairs.filter((p) => p.today.last_bite_hr > 19.5));

console.log('\n=== 3. DAILY EATING WINDOW WIDTH (LAST BITE - FIRST BITE) -> DAY D+1 METRICS ===');
const winPairs = timedPairs.filter((p) => p.today.first_bite_hr != null);
summarizeGroup('OMAD / Tight <= 2.0h Window', winPairs.filter((p) => (p.today.last_bite_hr - p.today.first_bite_hr) <= 2.0));
summarizeGroup('Compact eTRE 2.1 - 5.5h Window', winPairs.filter((p) => { const w = p.today.last_bite_hr - p.today.first_bite_hr; return w > 2.0 && w <= 5.5; }));
summarizeGroup('Moderate 5.6 - 8.5h Window', winPairs.filter((p) => { const w = p.today.last_bite_hr - p.today.first_bite_hr; return w > 5.5 && w <= 8.5; }));
summarizeGroup('Wide Grazing > 8.5h Window', winPairs.filter((p) => (p.today.last_bite_hr - p.today.first_bite_hr) > 8.5));

console.log('\n=== 4. CALORIE & PROTEIN BRACKETS ON DAY D -> DAY D+1 METRICS ===');
const macroPairs = pairs.filter((p) => p.today.kcal != null);
summarizeGroup('Kcal <= 850 (Sardine/Fast Blitz)', macroPairs.filter((p) => p.today.kcal <= 850));
summarizeGroup('Kcal 851 - 1,450 (Steep Cut)', macroPairs.filter((p) => p.today.kcal > 850 && p.today.kcal <= 1450));
summarizeGroup('Kcal 1,451 - 1,900 (Sweet Spot)', macroPairs.filter((p) => p.today.kcal > 1450 && p.today.kcal <= 1900));
summarizeGroup('Kcal 1,901 - 2,400 (Recomp)', macroPairs.filter((p) => p.today.kcal > 1900 && p.today.kcal <= 2400));
summarizeGroup('Kcal > 2,400 (Refeed / Surplus)', macroPairs.filter((p) => p.today.kcal > 2400));

console.log('\n--- Daily Protein Brackets ---');
summarizeGroup('Protein < 90g (Sardine Fast)', macroPairs.filter((p) => p.today.protein < 90));
summarizeGroup('Protein 90 - 145g', macroPairs.filter((p) => p.today.protein >= 90 && p.today.protein <= 145));
summarizeGroup('Protein 146 - 185g (Target Floor)', macroPairs.filter((p) => p.today.protein > 145 && p.today.protein <= 185));
summarizeGroup('Protein 186 - 220g', macroPairs.filter((p) => p.today.protein > 185 && p.today.protein <= 220));
summarizeGroup('Protein > 220g (Gluconeogenic)', macroPairs.filter((p) => p.today.protein > 220));

console.log('\n--- Net Carbs Brackets (Low-Carb Days <=50g vs Higher) ---');
summarizeGroup('Total Carbs <= 10g (Pure Ketovore)', macroPairs.filter((p) => p.today.carbs <= 10));
summarizeGroup('Total Carbs 10.1 - 25g', macroPairs.filter((p) => p.today.carbs > 10 && p.today.carbs <= 25));
summarizeGroup('Total Carbs 25.1 - 60g', macroPairs.filter((p) => p.today.carbs > 25 && p.today.carbs <= 60));
summarizeGroup('Total Carbs > 60g', macroPairs.filter((p) => p.today.carbs > 60));

console.log('\n--- Fat-to-Protein Gram Ratio (on Low-Carb <=30g C Days) ---');
const ketoMacroPairs = macroPairs.filter((p) => p.today.carbs <= 30 && p.today.protein > 0);
summarizeGroup('Lean PSMF Ratio (Fat/Prot < 0.65)', ketoMacroPairs.filter((p) => (p.today.fat / p.today.protein) < 0.65));
summarizeGroup('Balanced Ketovore (Fat/Prot 0.65-0.95)', ketoMacroPairs.filter((p) => { const r = p.today.fat / p.today.protein; return r >= 0.65 && r <= 0.95; }));
summarizeGroup('High-Fat Ketogenic (Fat/Prot > 0.95)', ketoMacroPairs.filter((p) => (p.today.fat / p.today.protein) > 0.95));

console.log('\n=== 5. DAILY STEPS & OXEFIT LIFTING ON DAY D -> DAY D+1 METRICS ===');
const stepPairs = pairs.filter((p) => p.today.steps != null);
summarizeGroup('Steps < 7,000 (Desk / Drive)', stepPairs.filter((p) => p.today.steps < 7000));
summarizeGroup('Steps 7,000 - 11,999', stepPairs.filter((p) => p.today.steps >= 7000 && p.today.steps < 12000));
summarizeGroup('Steps 12,000 - 16,999 (Switch Zone)', stepPairs.filter((p) => p.today.steps >= 12000 && p.today.steps < 17000));
summarizeGroup('Steps >= 17,000 (Furnace Zone)', stepPairs.filter((p) => p.today.steps >= 17000));

console.log('\n--- OxeFit Training Day vs Non-OxeFit Day (During Active Ketovore Months Dec25-Feb26 & Nov26) ---');
const activeEraPairs = pairs.filter((p) => (p.d >= '2025-12-01' && p.d <= '2026-02-28') || p.d >= '2026-11-08');
summarizeGroup('OxeFit Lift Day (>0 lb Vol)', activeEraPairs.filter((p) => p.today.oxefit_vol > 0));
summarizeGroup('Heavy OxeFit Day (>=8,000 lb Vol)', activeEraPairs.filter((p) => p.today.oxefit_vol >= 8000));
summarizeGroup('Rest / Steps-Only Day (0 OxeFit)', activeEraPairs.filter((p) => p.today.oxefit_vol === 0));

console.log('\n=== 6. METER PRICK CLOCK TIME (DAWN PHENOMENON CURVE ACROSS ALL 603 READINGS) ===');
// Pair raw blood glucose & blood ketone readings within 15 minutes of each other
const bgRows = allMojoReadings.filter((r) => r.type === 'Glucose Blood' && r.glucose != null);
const bhbRows = allMojoReadings.filter((r) => r.type === 'Ketones Blood' && r.ketone != null);

function summarizeMeterWindow(label, minHr, maxHr) {
  const bgs = bgRows.filter((r) => { const h = Number(r.ts.slice(11, 13)) + Number(r.ts.slice(14, 16)) / 60; return h >= minHr && h < maxHr; }).map((r) => r.glucose);
  const bhbs = bhbRows.filter((r) => { const h = Number(r.ts.slice(11, 13)) + Number(r.ts.slice(14, 16)) / 60; return h >= minHr && h < maxHr; }).map((r) => r.ketone);
  console.log(`  ${label.padEnd(36)} | BG(n=${String(bgs.length).padStart(2)}): ${fmt(avg(bgs), 1)} mg/dL | BHB(n=${String(bhbs.length).padStart(2)}): ${fmt(avg(bhbs), 2)} mmol/L`);
}
summarizeMeterWindow('Early Dawn (05:00 - 07:59 AM)', 5, 8);
summarizeMeterWindow('Mid Morning (08:00 - 09:29 AM)', 8, 9.5);
summarizeMeterWindow('Late Morning (09:30 - 11:29 AM)', 9.5, 11.5);
summarizeMeterWindow('Midday / Early PM (11:30a - 4:59p)', 11.5, 17);
summarizeMeterWindow('Evening (5:00 PM - 11:59 PM)', 17, 24);

console.log('\n=== 7. EXACT FOODS ON TOP 12 HIGHEST KETONE MORNINGS (WHAT YOU ATE THE DAY BEFORE!) ===');
const sortedByNextBhb = pairs.filter((p) => p.nextBhb != null && (p.today.foods.length > 0 || p.today.kcal != null)).sort((a, b) => b.nextBhb - a.nextBhb);
for (const p of sortedByNextBhb.slice(0, 14)) {
  const fList = p.today.foods.map((f) => `${f.name.slice(0, 28)}${f.hr != null ? '@' + Math.floor(f.hr) + ':' + String(Math.round((f.hr % 1) * 60)).padStart(2, '0') : ''}`).join(' + ');
  console.log(`  Eat ${p.d} (${p.today.kcal ?? '--'} kcal, ${p.today.protein ?? '--'}P/${p.today.fat ?? '--'}F/${p.today.carbs ?? '--'}C, Steps=${p.today.steps ?? '--'}, Oxe=${Math.round(p.today.oxefit_vol)}lb, Last=${fmt(p.today.last_bite_hr, 1)}h) -> ${p.nextDate}: BHB ${p.nextBhb} | BG ${p.nextBg ?? '--'} | GKI ${p.nextGki ?? '--'} | dWt ${fmt(p.wtDelta, 1)} | [${fList.slice(0, 110)}]`);
}

console.log('\n=== 8. EXACT FOODS ON WORST KETONE CRASHES (<0.5 mmol/L DURING ACTIVE KETOVORE ERAS) ===');
const crashPairs = activeEraPairs.filter((p) => p.nextBhb != null && p.nextBhb <= 0.5 && (p.today.foods.length > 0 || p.today.kcal != null)).sort((a, b) => a.nextBhb - b.nextBhb);
for (const p of crashPairs.slice(0, 14)) {
  const fList = p.today.foods.map((f) => `${f.name.slice(0, 28)}${f.hr != null ? '@' + Math.floor(f.hr) + ':' + String(Math.round((f.hr % 1) * 60)).padStart(2, '0') : ''}`).join(' + ');
  console.log(`  Eat ${p.d} (${p.today.kcal ?? '--'} kcal, ${p.today.protein ?? '--'}P/${p.today.fat ?? '--'}F/${p.today.carbs ?? '--'}C, Steps=${p.today.steps ?? '--'}, Oxe=${Math.round(p.today.oxefit_vol)}lb, Last=${fmt(p.today.last_bite_hr, 1)}h) -> ${p.nextDate}: BHB ${p.nextBhb} | BG ${p.nextBg ?? '--'} | GKI ${p.nextGki ?? '--'} | dWt ${fmt(p.wtDelta, 1)} | [${fList.slice(0, 110)}]`);
}

console.log('\n=== 9. ELECTROLYTES & MARINE OMEGA-3 ON LOW-CARB (>=800 kcal, <=35g C) DAYS ===');
const micPairs = pairs.filter((p) => p.today.foods.length >= 2 && p.today.kcal >= 800 && p.today.carbs <= 35);
summarizeGroup('Marine Omega-3 >= 1.5g (FADS1 TT)', micPairs.filter((p) => (p.today.omega3_g || 0) >= 1.5));
summarizeGroup('Marine Omega-3 < 1.5g', micPairs.filter((p) => (p.today.omega3_g || 0) < 1.5));
summarizeGroup('Potassium >= 2,500 mg', micPairs.filter((p) => (p.today.potassium_mg || 0) >= 2500));
summarizeGroup('Potassium < 2,500 mg', micPairs.filter((p) => (p.today.potassium_mg || 0) < 2500));
summarizeGroup('Logged Food Sodium <= 3,500 mg', micPairs.filter((p) => (p.today.sodium_mg || 0) <= 3500));
summarizeGroup('Logged Food Sodium > 3,500 mg', micPairs.filter((p) => (p.today.sodium_mg || 0) > 3500));

