'use strict';
/* תזרים מזומנים - כל הנתונים נשמרים רק במכשיר (localStorage). */

const KEY = 'cashflow.v1';
const VERSION = '2026-10-09-f';
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const CARD_CAT = 'כרטיס אשראי';          // חיוב אשראי בעו"ש
const INTERNAL = 'פנימי';
const SAV = 'חיסכון והשקעות';
const INCOME_CATS = ['משכורת', 'קצבאות והחזרים', 'הכנסה אחרת'];

const CATS = {
  'דיור': '🏠', 'מזון': '🛒', 'מסעדות ובילויים': '🍽️', 'תחבורה ודלק': '🚗', 'בריאות': '💊',
  'ביטוח': '🛡️', 'תקשורת ומנויים': '📱', 'קניות וטיפוח': '🛍️', 'נסיעות וחופשות': '✈️',
  'מיסים ועירייה': '🏛️', 'ריבית ועמלות': '🏦', 'החזר הלוואות': '💳', 'מזומן': '💵',
  'העברות': '🔁', 'תרומות': '🤲', 'אחר': '📦',
  'משכורת': '💼', 'קצבאות והחזרים': '🧾', 'הכנסה אחרת': '💰',
  [SAV]: '📈', [CARD_CAT]: '💳', [INTERNAL]: '↔️',
};
const LABEL = { [CARD_CAT]: 'אשראי (ללא פירוט)', [INTERNAL]: 'העברה פנימית' };
const label = c => LABEL[c] || c;

// קטגוריות של דיסקונט -> הקטגוריות שלנו
const CARD_MAP = {
  'מזון וצריכה': 'מזון', 'מסעדות, קפה וברים': 'מסעדות ובילויים', 'תחבורה ורכבים': 'תחבורה ודלק',
  'דלק, חשמל וגז': 'תחבורה ודלק', 'פנאי, בידור וספורט': 'מסעדות ובילויים', 'רפואה ובתי מרקחת': 'בריאות',
  'שירותי תקשורת': 'תקשורת ומנויים', 'חשמל ומחשבים': 'קניות וטיפוח', 'אופנה': 'קניות וטיפוח',
  'עיצוב הבית': 'קניות וטיפוח', 'קוסמטיקה וטיפוח': 'קניות וטיפוח', 'ספרים ודפוס': 'קניות וטיפוח',
  'חיות מחמד': 'קניות וטיפוח', 'טיסות ותיירות': 'נסיעות וחופשות', 'ביטוח': 'ביטוח',
  'עירייה וממשלה': 'מיסים ועירייה', 'העברת כספים': 'העברות', 'משיכת מזומן': 'מזומן',
};

const DONATE = /עמותת|עמותה|תרומה|תרומות|ע"ר\)|תמיכה וסיוע/;

const INVEST = /ביטס אוף|בלינק|blink|אינטראקטיב|interactive|אקסלנס|מיטב|איביאי|\bIBI\b|אלטשולר|פסגות/i;

// כללים לתנועות בנק (לפי סדר)
const BANK_RULES = [
  [/משכורת/, 'משכורת', 1],
  [/ביטוח לאומי|בטוח לאומי|מס.?הכנסה/, 'קצבאות והחזרים', 1],
  [/הקמת הלוואה/, INTERNAL],
  [/רווח.*(מפיק|הפק)|מס על רווח|מס במקור|חיוב מס/, INTERNAL],
  [/פיקדון|פקדון|הפקדה/, SAV],
  [INVEST, SAV],
  [/פירעון הלוואה|החזר הלוואה/, 'החזר הלוואות'],
  [/ריבית|עמלה|חיוב זמני|יתרת זכות|ביטול תשלום|ביטול קבלת/, 'ריבית ועמלות'],
  [/שכר דירה/, 'דיור'],
  [DONATE, 'תרומות'],
  [/מקס איט פי|חיוב לכרטיס/, CARD_CAT],
  [/מכספומט|משיכת מזומן/, 'מזומן'],
  [/ביט|בלינק|העברה/, null],
];

/* ---------- state ---------- */
let S = load();
let storageOk = true;
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.txns) return Object.assign(blank(), s);
  } catch (e) {}
  return blank();
}
function blank() { return { txns: [], rules: {}, checks: {}, budgets: {}, loan: null, settings: { rate: 3 }, lastImport: null }; }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageOk = true; }
  catch (e) { storageOk = false; toast('לא ניתן לשמור במכשיר – עשה גיבוי'); }
  cache = null;
}

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const money = n => (n < 0 ? '-' : '') + '₪' + nf.format(Math.abs(Math.round(n)));
const ym = d => d.slice(0, 7);
const startDay = () => Math.min(28, Math.max(1, S.settings.startDay || 1));
function per(date) {                       // the financial period a date belongs to
  const sd = startDay();
  if (sd === 1) return date.slice(0, 7);
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (sd - 1));
  return d.toISOString().slice(0, 7);
}
function perStart(m) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, startDay())).toISOString().slice(0, 10); }
function perEnd(m) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, startDay() - 1)).toISOString().slice(0, 10); }
const dm = iso => +iso.slice(8) + '.' + +iso.slice(5, 7);
const perRange = m => startDay() === 1 ? '' : `מ-${dm(perStart(m))} עד ${dm(perEnd(m))}`;
const lastData = () => { const t0 = todayISO(); return S.txns.reduce((a, t) => t.date > a && t.date <= t0 ? t.date : a, ''); };
const mLabel = m => MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
const mShort = m => MONTHS[+m.slice(5) - 1].slice(0, 3);
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3000); }
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function norm(desc) {
  return String(desc).toUpperCase().replace(/[0-9*#.,'"\-_\/\\()]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

/* ---------- derived data ---------- */
function incLabel(t) {
  if (/הקמת הלוואה/.test(t.desc)) return 'הלוואה שנלקחה';
  if (t.cat === INTERNAL) return 'העברות מחשבון אחר שלך';
  if (t.cat === SAV) return 'משיכה מחיסכון והשקעות';
  return label(t.cat);
}
let cache = null;
function derived() {
  if (cache) return cache;
  // איזה כרטיסים יש להם פירוט, ומאיזה תאריך
  const cardFrom = {}; let anyFrom = null;
  for (const t of S.txns) if (t.src === 'card') {
    if (!cardFrom[t.card] || t.date < cardFrom[t.card]) cardFrom[t.card] = t.date;
    if (!anyFrom || t.date < anyFrom) anyFrom = t.date;
  }
  const kind = t => {
    if (t.cat === CARD_CAT) {
      const m = t.desc.match(/\b(\d{4})\b/);
      const from = m ? cardFrom[m[1]] : anyFrom;
      return from && t.date >= from ? 'int' : 'exp';
    }
    if (t.cat === INTERNAL) return t.amount > 0 && t.src === 'bank' ? 'fin' : 'int';
    if (t.cat === SAV) return t.amount > 0 && t.src === 'bank' ? 'fin' : 'sav';
    return INCOME_CATS.includes(t.cat) ? 'inc' : 'exp';
  };
  const byMonth = {};
  const items = S.txns.map(t => ({ ...t, kind: kind(t) }));
  for (const t of items) {
    const m = (byMonth[per(t.date)] ??= { inc: 0, exp: 0, sav: 0, fin: 0, cats: {}, src: {}, finSrc: {}, n: 0 });
    m.n++;
    if (t.cat === SAV) m.sav -= t.amount;
    if (t.kind === 'inc') { m.inc += t.amount; const l = incLabel(t); m.src[l] = (m.src[l] || 0) + t.amount; }
    else if (t.kind === 'fin') { m.fin += t.amount; const l = incLabel(t); m.finSrc[l] = (m.finSrc[l] || 0) + t.amount; }
    else if (t.kind === 'exp') { m.exp -= t.amount; m.cats[t.cat] = (m.cats[t.cat] || 0) - t.amount; }
  }
  const months = Object.keys(byMonth).sort();
  cache = { items, byMonth, months, cardFrom, anyFrom };
  return cache;
}
let selMonth = null;
function curMonth() {
  const d = derived();
  if (!d.months.length) return null;
  if (!selMonth || !d.byMonth[selMonth]) {
    const last = lastData();
    const done = d.months.filter(m => perEnd(m) <= last);
    selMonth = done.length ? done[done.length - 1] : d.months[d.months.length - 1];
  }
  return selMonth;
}
function fullMonths(d) { const last = lastData(); const c = d.months.filter(m => perEnd(m) <= last); return c.length > 1 ? c.slice(1) : c; }

function position(d) {
  let best = null;
  for (const t of S.txns) if (t.src === 'bank' && t.bal != null && (!best || t.date > best.date)) best = t;
  const netDep = -S.txns.filter(t => t.cat === SAV && /פיקדון|פקדון/.test(t.desc)).reduce((a, t) => a + t.amount, 0);
  const manual = Number(S.settings.savings) > 0 ? Number(S.settings.savings) : null;
  return { curBal: best ? best.bal : null, netDep, extra: manual != null ? manual : Math.max(0, netDep), manual };
}
function health(d) {
  const fm = fullMonths(d); if (!fm.length) return null;
  const inc = fm.reduce((a, m) => a + d.byMonth[m].inc, 0), exp = fm.reduce((a, m) => a + d.byMonth[m].exp, 0);
  const avgExp = exp / fm.length;
  const { curBal, extra, manual } = position(d);
  const liquid = curBal == null ? null : curBal + extra;
  const fin = fm.reduce((a, x) => a + (d.byMonth[x].fin || 0), 0);
  const negM = fm.filter(x => d.byMonth[x].inc - d.byMonth[x].exp < 0).length;
  const [y, mo] = d.months[d.months.length - 1].split('-').map(Number);
  const from = new Date(Date.UTC(y, mo - 12, 1)).toISOString().slice(0, 7);
  const cost = d.items.filter(t => t.cat === 'ריבית ועמלות' && t.kind === 'exp' && per(t.date) >= from).reduce((a, t) => a - t.amount, 0);
  return { cost: Math.max(0, cost), rate: inc > 0 ? (inc - exp) / inc : null, avgExp, runway: liquid != null && avgExp > 0 ? liquid / avgExp : null, liquid, manual, fin, negM, nMonths: fm.length };
}
function review(d, m) {
  const fm = fullMonths(d);
  const others = fm.filter(x => x !== m);
  if (!fm.includes(m) || others.length < 2) return [];
  const cur = d.byMonth[m].cats, out = [];
  for (const c of Object.keys(cur)) {
    if (c === CARD_CAT) continue;
    const avg = others.reduce((a, x) => a + (d.byMonth[x].cats[c] || 0), 0) / others.length;
    const diff = cur[c] - avg;
    if (diff > 150 && diff > avg * 0.15) out.push({ c, diff, pct: avg > 0 ? Math.round(diff / avg * 100) : null });
  }
  return out.sort((a, b) => b.diff - a.diff).slice(0, 4);
}
function catAvg(d, c) {
  const fm = fullMonths(d); if (!fm.length) return 0;
  return fm.reduce((a, m) => a + (d.byMonth[m].cats[c] || 0), 0) / fm.length;
}

function recurring(d) {
  const g = {};
  for (const t of d.items) {
    if (t.kind !== 'exp' || t.amount >= 0 || [CARD_CAT, 'מזומן', 'העברות'].includes(t.cat)) continue;
    const k = norm(t.desc); if (!k) continue;
    (g[k] ??= []).push(t);
  }
  const out = [];
  for (const [k, arr] of Object.entries(g)) {
    const months = [...new Set(arr.map(t => per(t.date)))];
    if (months.length < 3) continue;
    const amts = arr.map(t => -t.amount).sort((a, b) => a - b);
    const med = amts[Math.floor(amts.length / 2)];
    const stable = amts.filter(a => Math.abs(a - med) <= med * 0.25).length / amts.length;
    if (stable < 0.7) continue;
    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    const perMonth = arr.reduce((s, t) => s - t.amount, 0) / months.length;
    const bm = {}; for (const t of arr) bm[per(t.date)] = (bm[per(t.date)] || 0) - t.amount;
    out.push({ bm, name: arr[0].desc, cat: arr[0].cat, months: months.length, monthly: perMonth, yearly: perMonth * 12,
      first: -sorted[0].amount, last: -sorted[sorted.length - 1].amount });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

/* ---------- import ---------- */
function serialToISO(n) {
  const d = new Date(Math.round((n - 25569) * 86400) * 1000);
  return d.toISOString().slice(0, 10);
}
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialToISO(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const num = v => typeof v === 'number' ? v : (parseFloat(String(v ?? '').replace(/[,₪\s]/g, '')) || 0);
const clean = s => String(s ?? '').replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim();

function isOwnTransfer(desc) {
  const h = S.settings.holder;
  return !!(h && h.length >= 2 && /העברה|הע\.|ביט/.test(desc) && h.filter(w => desc.includes(w)).length >= 2);
}
function classifyBank(desc, amount) {
  if (isOwnTransfer(desc)) return INTERNAL;
  for (const [re, cat, onlyPos] of BANK_RULES) {
    if (!re.test(desc)) continue;
    if (onlyPos && amount <= 0) continue;
    if (cat) return cat;
    return amount > 0 ? 'הכנסה אחרת' : 'העברות';
  }
  return amount > 0 ? 'הכנסה אחרת' : 'אחר';
}
function reclassify() {
  for (const t of S.txns) {
    if (t.manual) continue;
    if (t.src === 'bank') t.cat = S.rules[norm(t.desc)] || classifyBank(t.desc, t.amount);
    else if (t.src === 'card' && INVEST.test(t.desc) && !S.rules[norm(t.desc)]) t.cat = SAV;
  }
}
function applyRule(t) {
  const r = S.rules[norm(t.desc)];
  return r || t.cat;
}

/* Discount's CSV export is UTF-16, tab separated, with "6,180.00" style amounts.
   Handing that to SheetJS made it guess dates in US order, so 09/10 (9 Oct)
   came back as 10 September and the amounts came back as strings. Parse text
   files ourselves instead, and keep SheetJS for real .xlsx workbooks. */
function splitRow(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(x => { const t = x.trim(); return t === '' ? null : t; });
}

function textSheet(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 2 || (b[0] === 0x50 && b[1] === 0x4b)) return null;   // PK.. = xlsx
  let txt;
  try {
    if (b[0] === 0xff && b[1] === 0xfe) txt = new TextDecoder('utf-16le').decode(b);
    else if (b[0] === 0xfe && b[1] === 0xff) txt = new TextDecoder('utf-16be').decode(b);
    else {
      txt = new TextDecoder('utf-8').decode(b);
      if (txt.includes('�')) txt = new TextDecoder('windows-1255').decode(b);
    }
  } catch (e) { return null; }
  if (!txt || txt.includes('\u0000')) return null;
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return null;
  const h = lines[0], n = ch => h.split(ch).length - 1;
  const sep = n('\t') ? '\t' : n(';') > n(',') ? ';' : ',';
  if (!n(sep)) return null;
  return lines.map(l => splitRow(l, sep));
}

/* a cell's number whether it arrived as 6180, "6,180.00" or "₪6,180" */
const cellNum = v => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').replace(/[,₪\s]/g, '');
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
};

function parseWorkbook(buf) {
  const out = { txns: [], kinds: new Set() };
  const tr = textSheet(buf);
  let sheets;
  if (tr) sheets = [{ rows: tr, card: false }];
  else {
    const wb = XLSX.read(buf, { type: 'array' });
    sheets = wb.SheetNames.map(n => ({
      rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }),
      card: !!wb.Sheets[n]['!card'] }));
  }
  for (const sh of sheets) for (const r of sh.rows.slice(0, 8)) {
    const c = String(r[0] ?? '');
    if (c.includes('חשבון') && c.includes('|') && !sh.card) {
      const tokens = c.split('|').pop().trim().split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
      if (tokens.length >= 2) { S.settings.holder = tokens; out.holder = true; }
    }
  }
  for (const sh of sheets) {
    const rows = sh.rows;
    const hi = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'תאריך עסקה') || r.some(c => String(c ?? '').includes('תיאור התנועה')) || r.some(c => String(c ?? '').trim() === 'חודש חיוב'));
    if (hi < 0) continue;
    const head = rows[hi].map(c => String(c ?? '').trim());
    const col = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
    if (head.includes('תאריך עסקה')) {
      out.kinds.add('card');
      const c = { date: col('תאריך עסקה'), name: col('שם בית העסק'), cat: col('קטגוריה'), card: col('4 ספרות'), type: col('סוג עסקה'), amt: col('סכום חיוב'), cdate: col('תאריך חיוב') };
      const seen = {};
      for (const r of rows.slice(hi + 1)) {
        let date = parseDate(r[c.date]); const a = cellNum(r[c.amt]);
        if (!date || a == null) continue;
        const cd = parseDate(r[c.cdate]);
        const imm = String(r[c.type] ?? '').includes('מיידי') || undefined;
        if (String(r[c.type] ?? '').includes('תשלומים')) date = cd || date;
        const desc = clean(r[c.name]);
        const card = String(r[c.card] ?? '').trim();
        const amount = -a;
        const base = ['card', date, amount, desc, card].join('|');
        const n = seen[base] = (seen[base] || 0) + 1;
        const cat = INVEST.test(desc) ? SAV : DONATE.test(desc) ? 'תרומות' : CARD_MAP[String(r[c.cat] ?? '').trim()] || 'אחר';
        out.txns.push({ id: hash(base) + '#' + n, date, desc, amount, src: 'card', card, cat, cd, imm });
      }
    } else if (head.some(h => h.includes('תיאור התנועה'))) {
      out.kinds.add('bank');
      const c = { date: col('תאריך'), desc: col('תיאור התנועה'), amt: col('זכות/חובה'), bal: col('יתרה'), ref: col('אסמכתה') };
      const seen = {};
      for (const r of rows.slice(hi + 1)) {
        const date = parseDate(r[c.date]); const amount = cellNum(r[c.amt]);
        if (!date || amount == null) continue;
        const desc = clean(r[c.desc]);
        const bal = cellNum(r[c.bal]);
        const ref = String(r[c.ref] ?? '').replace(/\s+/g, '').split('/')[0] || null;
        const base = ['bank', date, amount, desc, bal].join('|');
        const n = seen[base] = (seen[base] || 0) + 1;
        out.txns.push({ id: hash(base) + '#' + n, date, desc, amount, src: 'bank', bal, ref, cat: classifyBank(desc, amount) });
      }
    } else if (head.includes('חודש חיוב')) {
      out.kinds.add('summary');
    }
  }
  return out;
}

function sources() {
  const o = { bank: 0, card: 0, manual: 0, from: '', to: '' };
  for (const t of S.txns) {
    o[t.src] = (o[t.src] || 0) + 1;
    if (!o.from || t.date < o.from) o.from = t.date;
    if (t.date > o.to) o.to = t.date;
  }
  return o;
}
function upcoming() {
  const today = todayISO(), by = {};
  for (const t of S.txns) {
    if (t.src !== 'card' || !t.cd || t.cd <= today || t.amount >= 0) continue;
    const k = t.cd + (t.imm ? '|i' : '');
    (by[k] ??= { date: t.cd, imm: !!t.imm, sum: 0, n: 0 });
    by[k].sum -= t.amount; by[k].n++;
  }
  return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
}
function headline() {
  const d = derived(); selMonth = null; const m = curMonth(); if (!m) return '';
  const R = reviewData(d, m), c = R.cur, free = c.inc - c.exp, flags = R.catRows.filter(r => r.flag).slice(0, 3);
  return `<h2>מה חדש ב${mLabel(m)}</h2><div class="card story">
    <p>נשאר <b class="${free >= 0 ? 'pos' : 'neg'}">${money(free)}</b>${R.avgFree != null ? ` לעומת ממוצע ${money(R.avgFree)}` : ''}.</p>
    ${flags.length ? `<p>⚠️ חריגות מהממוצע: ${flags.map(r => `${esc(label(r.c))} (+${money(r.v - r.a)})`).join(', ')}.</p>` : '<p>אין חריגות גדולות מהממוצע.</p>'}
    ${R.rises.length ? `<p>▲ התייקרויות: ${R.rises.map(x => esc(x.name.slice(0, 18))).join(', ')}.</p>` : ''}
    ${R.actions[0] ? `<p>💡 הפעולה המשתלמת ביותר: ${esc(R.actions[0].title)} (כ-${money(R.actions[0].impact)} בחודש).</p>` : ''}
    <button class="btn block" data-go="insights">לסקירה המלאה</button></div>`;
}

/* The same transaction is not identical in the two Discount exports: the xlsx
   truncates the description, the csv does not, the running balance can differ by
   a charge that was still pending, and a pending row is re-dated once it settles.
   Hashing the whole row therefore imported it twice. Match on the bank's own
   reference number first, then fall back to amount + description + a few days. */
const descKey = d => String(d).replace(/\s+/g, ' ').trim().slice(0, 14);
const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

function addToIndex(idx, t) {
  idx.id.set(t.id, t);
  if (t.ref) idx.ref.set(t.src + '|' + t.ref, t);
  if (t.src === 'bank') {
    const k = t.amount + '|' + descKey(t.desc);
    (idx.loose.get(k) || idx.loose.set(k, []).get(k)).push(t);
  }
}
function buildIndex(txns) {
  const idx = { id: new Map(), ref: new Map(), loose: new Map() };
  for (const t of txns) addToIndex(idx, t);
  return idx;
}
function findSame(t, idx, used) {
  const byId = idx.id.get(t.id); if (byId) return byId;
  if (t.ref) { const r = idx.ref.get(t.src + '|' + t.ref); if (r) return r; }
  if (t.src !== 'bank') return null;
  const list = idx.loose.get(t.amount + '|' + descKey(t.desc));
  if (list) for (const e of list) if (!used.has(e) && dayGap(e.date, t.date) <= 7) return e;
  return null;
}

async function importFiles(files) {
  const results = [];
  for (const f of files) {
    try {
      const p = parseWorkbook(await f.arrayBuffer());
      const idx = buildIndex(S.txns), used = new Set();
      let added = 0, dup = 0;
      for (const t of p.txns) {
        const e = findSame(t, idx, used);
        if (e) {
          dup++; used.add(e);
          if (t.cd && !e.cd) { e.cd = t.cd; e.imm = t.imm; }
          if (t.ref && !e.ref) e.ref = t.ref;
          if (t.src === 'bank') {            // the later export is the settled truth
            if (t.desc.length > e.desc.length) e.desc = t.desc;
            e.date = t.date;
            if (t.bal != null) e.bal = t.bal;
          }
          continue;
        }
        t.cat = applyRule(t); S.txns.push(t); addToIndex(idx, t); used.add(t); added++;
      }
      let kind = p.kinds.has('bank') ? 'חשבון עו"ש' : p.kinds.has('card') ? 'כרטיס אשראי' : p.kinds.has('summary') ? 'סיכום חיובי אשראי' : null;
      results.push({ name: f.name, kind, added, dup, summary: p.kinds.has('summary') && !p.txns.length });
    } catch (e) { results.push({ name: f.name, kind: null, added: 0, dup: 0, err: true }); }
  }
  reclassify();
  S.lastImport = todayISO(); save();
  return results;
}

/* ---------- insights ---------- */
const FIXED_CATS = ['דיור', 'ביטוח', 'החזר הלוואות', 'מיסים ועירייה', 'בריאות', 'תרומות'];
function insightsData(d, m) {
  const cur = d.byMonth[m], others = fullMonths(d).filter(x => x !== m);
  const avg = k => others.length ? others.reduce((a, x) => a + d.byMonth[x][k], 0) / others.length : null;
  const avgExp = avg('exp'), avgInc = avg('inc');
  const cats = Object.entries(cur.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = d.items.filter(t => per(t.date) === m && t.kind === 'exp' && t.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 5);
  const tips = [], good = [];
  for (const r of review(d, m)) {
    const fixed = FIXED_CATS.includes(r.c) || r.c === 'העברות';
    tips.push({ icon: CATS[r.c], title: `${label(r.c)} גבוה מהרגיל`, save: fixed ? 0 : r.diff,
      text: fixed ? `₪${nf.format(r.diff)} מעל הממוצע שלך. בדוק אם זו הוצאה חד-פעמית (למשל העברה גדולה) ולא הרגל.` : `₪${nf.format(r.diff)} מעל הממוצע החודשי שלך. חזרה לרמה הרגילה חוסכת ${money(r.diff)} בחודש.` });
  }
  const rec = recurring(d);
  for (const r of rec.filter(r => r.last > r.first * 1.05 && r.last - r.first >= 5).slice(0, 3))
    tips.push({ icon: '▲', title: `${r.name.slice(0, 26)} התייקר`, save: r.last - r.first,
      text: `מ-${money(r.first)} ל-${money(r.last)} לחודש (${money((r.last - r.first) * 12)} בשנה). שווה לבקש הנחה או להשוות.` });
  const subs = rec.filter(r => !FIXED_CATS.includes(r.cat) && r.cat !== 'דיור' && r.monthly <= 400);
  if (subs.length >= 3) { const mo = subs.reduce((a, r) => a + r.monthly, 0);
    tips.push({ icon: '🔁', title: `${subs.length} מנויים וחיובים קבועים`, save: 0, text: `${money(mo)} בחודש, ${money(mo * 12)} בשנה. עבור עליהם בלשונית כלים וצא מהמנויים שלא בשימוש.` }); }
  if ((cur.cats['מזומן'] || 0) > 300) tips.push({ icon: '💵', title: 'משיכות מזומן', save: 0, text: `${money(cur.cats['מזומן'])} במזומן החודש. כסף שלא מתועד קשה להבין לאן הלך. אפשר להוסיף הוצאות מזומן עם כפתור +.` });
  const H = health(d);
  if (H && H.cost > 100) tips.push({ icon: '🏦', title: 'ריבית ועמלות', save: 0, text: `שילמת ${money(H.cost)} ב-12 החודשים האחרונים. בדוק פטור מעמלות והקטנת מסגרת אוברדרפט.` });
  const unc = d.items.filter(t => per(t.date) === m && t.cat === 'אחר' && t.kind === 'exp');
  if (unc.length) tips.push({ icon: '🏷️', title: `${unc.length} תנועות ללא קטגוריה`, save: 0, text: `${money(unc.reduce((a, t) => a - t.amount, 0))} שלא מסווגים. סיווג משפר את הדיוק של כל התובנות.` });
  if (cur.cats[CARD_CAT] > 0) tips.push({ icon: '💳', title: 'אשראי ללא פירוט', save: 0, text: `${money(cur.cats[CARD_CAT])} מכרטיס שאין לו קובץ עסקאות. ייבא את הקובץ המפורט כדי לראות לאן הלך הכסף.` });
  if (H && avgInc != null && H.rate != null && H.rate < 0.1) {
    const need = 0.1 * avgInc - (avgInc - avgExp);
    if (need > 0) tips.push({ icon: '🎯', title: 'פער לחיסכון של 10%', save: 0, text: `כדי לחסוך 10% מההכנסה צריך להקטין הוצאות או להגדיל הכנסה ב-${money(need)} בחודש.` });
  }
  if (others.length >= 2) for (const c of Object.keys(CATS)) {
    if (c === CARD_CAT || INCOME_CATS.includes(c) || c === INTERNAL) continue;
    const a = others.reduce((x, o) => x + (d.byMonth[o].cats[c] || 0), 0) / others.length, v = cur.cats[c] || 0;
    if (a - v > 150 && a - v > a * 0.15) good.push({ c, diff: a - v });
  }
  good.sort((a, b) => b.diff - a.diff);
  tips.sort((a, b) => b.save - a.save);
  const savable = tips.reduce((a, t) => a + t.save, 0);
  return { cur, avgExp, avgInc, cats, top, tips, good: good.slice(0, 3), savable };
}
function prevMonth(m) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); }
function balanceAt(m) {
  let best = null;
  for (const t of S.txns) if (t.src === 'bank' && t.bal != null && per(t.date) <= m && (!best || t.date > best.date)) best = t;
  return best ? best.bal : null;
}
function loanPlan(L) {
  if (!L || !(L.balance > 0) || !(L.pay > 0)) return null;
  const r = (L.rate || 0) / 1200;
  if (r > 0 && L.pay <= L.balance * r) return { bad: true };
  const n = r > 0 ? -Math.log(1 - L.balance * r / L.pay) / Math.log(1 + r) : L.balance / L.pay;
  const end = new Date(); end.setMonth(end.getMonth() + Math.ceil(n));
  return { months: Math.ceil(n), interest: Math.max(0, n * L.pay - L.balance), end: `${end.getMonth() + 1}/${end.getFullYear()}` };
}
function reviewData(d, m) {
  const cur = d.byMonth[m], pm = prevMonth(m);
  const others = fullMonths(d).filter(x => x !== m);
  const avg = f => others.length ? others.reduce((a, x) => a + f(d.byMonth[x]), 0) / others.length : null;
  const avgInc = avg(b => b.inc), avgExp = avg(b => b.exp);
  const avgFree = avgInc != null ? avgInc - avgExp : null;
  // 1. categories vs average
  const names = new Set(Object.keys(cur.cats));
  others.forEach(x => Object.keys(d.byMonth[x].cats).forEach(k => names.add(k)));
  const catRows = [...names].map(c => {
    const v = cur.cats[c] || 0, a = others.length ? others.reduce((x, o) => x + (d.byMonth[o].cats[c] || 0), 0) / others.length : null;
    return { c, v, a, flag: a != null && others.length >= 2 && v > a * 1.15 && v - a >= 100 };
  }).filter(r => r.v > 0 || (r.a || 0) > 100).sort((x, y) => y.v - x.v);
  // 2. new recurring + price increases
  const groups = {};
  for (const t of d.items) {
    if (t.kind !== 'exp' || t.amount >= 0 || [CARD_CAT, 'מזומן', 'העברות', 'החזר הלוואות'].includes(t.cat)) continue;
    const k = norm(t.desc); if (k) (groups[k] ??= []).push(t);
  }
  const fresh = [];
  if (pm > d.months[0]) for (const arr of Object.values(groups)) {
    const ms = [...new Set(arr.map(t => per(t.date)))].sort();
    if (ms[0] < pm || !ms.includes(m) || !ms.includes(pm)) continue;
    const a1 = arr.filter(t => per(t.date) === pm).reduce((x, t) => x - t.amount, 0), a2 = arr.filter(t => per(t.date) === m).reduce((x, t) => x - t.amount, 0);
    if (arr[0].cat !== 'תרומות' && Math.abs(a2 - a1) <= a1 * 0.02) fresh.push({ name: arr[0].desc, amount: a2 });
  }
  const rises = [];
  for (const r of recurring(d)) {
    if (r.bm[m] == null) continue;
    const prior = Object.entries(r.bm).filter(([k]) => k < m).map(([, v]) => v).sort((x, y) => x - y);
    if (!prior.length) continue;
    const med = prior[Math.floor(prior.length / 2)];
    if (r.bm[m] > med * 1.05 && r.bm[m] - med >= 3) rises.push({ name: r.name, from: med, to: r.bm[m] });
  }
  // 3. savings + idle cash
  const sv = x => d.items.filter(t => t.kind === 'sav' && per(t.date) === x);
  const deposits = x => sv(x).filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0);
  const dep = deposits(m), pastDep = others.map(deposits);
  const habit = pastDep.filter(v => v > 0).length >= 3;
  const avgDep = pastDep.length ? pastDep.reduce((a, v) => a + v, 0) / pastDep.length : null;
  const bal = balanceAt(m), buffer = avgExp, idle = bal != null && buffer != null ? Math.max(0, bal - buffer) : null;
  // 4. debt
  const loans = d.items.filter(t => t.cat === 'החזר הלוואות' && t.kind === 'exp');
  const paidM = loans.filter(t => per(t.date) === m).reduce((a, t) => a - t.amount, 0);
  const paidAll = loans.reduce((a, t) => a - t.amount, 0);
  const taken = d.items.filter(t => /הקמת הלוואה/.test(t.desc) && t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const feesM = d.items.filter(t => t.cat === 'ריבית ועמלות' && t.kind === 'exp' && per(t.date) === m).reduce((a, t) => a - t.amount, 0);
  // 5. actions (₪ per month)
  const acts = [];
  for (const r of catRows.filter(r => r.flag && !FIXED_CATS.includes(r.c) && r.c !== 'העברות' && r.c !== CARD_CAT))
    acts.push({ icon: CATS[r.c], impact: r.v - r.a, title: `החזר את ${label(r.c)} לרמה הרגילה`, text: `החודש ${money(r.v)} לעומת ממוצע ${money(r.a)}.` });
  for (const r of rises) acts.push({ icon: '▲', impact: r.to - r.from, title: `בקש הנחה על ${r.name.slice(0, 24)}`, text: `התייקר מ-${money(r.from)} ל-${money(r.to)} לחודש.` });
  if (feesM > 0) acts.push({ icon: '🏦', impact: feesM, title: 'הפחת ריבית ועמלות בנק', text: `שילמת ${money(feesM)} החודש. בקש פטור מעמלות והקטנת מסגרת.` });
  if (idle > 1000) acts.push({ icon: '💰', impact: idle * S.settings.rate / 1200, title: `הזז ${money(idle)} מהעו"ש לפיקדון או קרן כספית`, text: `כסף שיושב מעל הבאפר. בריבית ${S.settings.rate}% זה כ-${money(idle * S.settings.rate / 100)} בשנה.` });
  acts.sort((a, b) => b.impact - a.impact);
  const out3 = acts.slice(0, 3);
  if (out3.length < 3 && avgInc > 0 && (!habit || dep === 0))
    out3.push({ icon: '🎯', impact: avgInc * 0.05, title: 'הוראת קבע לחיסכון ביום משכורת', text: `הפרשה של 5% מההכנסה הממוצעת (${money(avgInc * 0.05)} בחודש) לפני שמספיקים להוציא.` });
  return { cur, others, avgInc, avgExp, avgFree, catRows, fresh, rises, dep, avgDep, habit, bal, buffer, idle, paidM, paidAll, taken, feesM, actions: out3.slice(0, 3) };
}

function aiSummary(d, m) {
  const R = reviewData(d, m), c = R.cur, f = v => v == null ? 'לא ידוע' : Math.round(v);
  return `אני מעלה סיכום חודשי של הכסף שלי (בשקלים, בלי פרטים אישיים). ענה בעברית.
השווה את החודש לפרופיל הבסיס שלי (ממוצע חודשי):
1. הכנסות, הוצאות לפי קטגוריה ויתרה פנויה מול הממוצע שלי. סמן כל סעיף שחרג ביותר מ-15%.
2. חיובים קבועים חדשים או התייקרויות.
3. האם בוצעה העברה לחיסכון? כמה כסף יושב בעו"ש מעל הבאפר?
4. התקדמות בפירעון חובות ובחיסכון.
5. שלוש פעולות לחודש הזה, מדורגות לפי השפעה ב-₪.
אל תמליץ על מוצרי השקעה ספציפיים. חשב בקוד ואל תנחש מספרים, ושאל אותי אם חסר מידע.

נתוני ${mLabel(m)}:
הכנסות ${f(c.inc)} (ממוצע ${f(R.avgInc)}). הוצאות ${f(c.exp)} (ממוצע ${f(R.avgExp)}). נשאר ${f(c.inc - c.exp)} (ממוצע ${f(R.avgFree)}).
משיכות מחיסכון ומחשבונות אחרים שלי שנכנסו לחשבון החודש (לא הכנסה): ${f(c.fin || 0)}.
קטגוריות (החודש / ממוצע):
${R.catRows.map(r => `- ${label(r.c)}: ${f(r.v)} / ${f(r.a)}${r.flag ? ' (חריגה)' : ''}`).join('\n')}
חיובים קבועים: ${recurring(d).slice(0, 8).map(r => `${r.name.slice(0, 20)} ${Math.round(r.monthly)}/חודש`).join('; ')}
חדשים: ${R.fresh.map(x => x.name.slice(0, 20) + ' ' + Math.round(x.amount)).join('; ') || 'אין'}. התייקרויות: ${R.rises.map(x => `${x.name.slice(0, 20)} ${Math.round(x.from)}→${Math.round(x.to)}`).join('; ') || 'אין'}
הפקדה לחיסכון והשקעות החודש: ${f(R.dep)} (ממוצע ${f(R.avgDep)}). יתרה בעו"ש: ${f(R.bal)}, באפר (חודש הוצאות): ${f(R.buffer)}.
החזרי הלוואות החודש: ${f(R.paidM)}, סה"כ בתקופה: ${f(R.paidAll)}, הלוואות שנלקחו: ${f(R.taken)}.`;
}

/* ---------- views ---------- */
let tab = 'home';
let filter = { q: '', kind: 'all' };

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').style.display = (tab === 'home' || tab === 'txns') ? '' : 'none';
  $('#view').innerHTML = ({ home: viewHome, insights: viewInsights, txns: viewTxns, import: viewImport, tools: viewTools })[tab]();
  if (tab === 'insights' && $('#copyAI')) $('#copyAI').onclick = async () => {
    const txt = aiSummary(derived(), curMonth());
    try { await navigator.clipboard.writeText(txt); toast('הסיכום הועתק'); }
    catch (e) { openSheet(`<h3>העתק ידנית</h3><textarea style="width:100%;height:240px" readonly>${esc(txt)}</textarea>`); }
  };
  if (tab === 'tools') bindTools();
  if (tab === 'txns') bindTxns();
}

function emptyState() {
  return `<div class="empty"><div class="icon">📊</div><h2>עוד אין נתונים</h2>
    <p>ייבא קבצי אקסל מהבנק ומהאשראי והאפליקציה תסווג הכל לבד.</p>
    <button class="btn" data-go="import">להתחלה</button></div>`;
}

function reminderBanner() {
  const cycle = perStart(per(todayISO()));
  if (todayISO() >= cycle && (!S.lastImport || S.lastImport < cycle) && S.txns.length)
    return `<div class="banner">📅 הגיע הזמן לעדכון החודשי – העלה קבצים חדשים מהבנק ומהאשראי. <button class="chip" data-go="import">לייבוא</button></div>`;
  return '';
}

function lastDay(m) {
  const x = S.txns.filter(t => per(t.date) === m).reduce((a, t) => t.date > a ? t.date : a, '');
  return x ? +x.slice(8) + '.' + +x.slice(5, 7) : '';
}
let showAllCats = false;

/* one list of everything that needs a decision, most trust-breaking first */
function attention(d, m) {
  const cur = d.byMonth[m], out = [], src = sources();
  if (!src.bank) out.push({ ic: '!', tone: 'r', t: 'ייבאת רק קובץ אשראי',
    s: 'בלי קובץ עובר ושב אין הכנסות, וכל המספרים מוטים.', go: 'import', btn: 'לייבוא' });
  const cycle = perStart(per(todayISO())), last = lastData();
  const gap = last ? Math.round((Date.parse(todayISO()) - Date.parse(last)) / 864e5) : 0;
  const newCycle = todayISO() >= cycle && (!S.lastImport || S.lastImport < cycle);
  if (S.txns.length && (gap >= 4 || newCycle))
    out.push({ ic: '↻', tone: gap >= 10 ? 'r' : 'y',
      t: gap >= 4 ? `הנתונים מסתיימים ב-${dm(last)}` : 'הגיע הזמן לעדכון החודשי',
      s: gap >= 4 ? `חסרים ${gap} ימים. משכורת או חיוב שנכנסו מאז עדיין לא מופיעים כאן.` : 'העלה קבצים חדשים מהבנק ומהאשראי.',
      go: 'import', btn: 'לייבוא' });
  const u = upcoming();
  if (u.length) { const total = u.reduce((a, x) => a + x.sum, 0), n = u.reduce((a, x) => a + x.n, 0);
    out.push({ ic: '₪', tone: 'y', t: `חיובי אשראי שטרם ירדו: ${money(total)}`,
      s: `${n} עסקאות, הקרוב ב-${u[0].date.split('-').reverse().slice(0, 2).join('/')}. כדאי להשאיר את הסכום בחשבון.` }); }
  if (cur.cats[CARD_CAT] > 0) {
    const cards = [...new Set(d.items.filter(t => per(t.date) === m && t.cat === CARD_CAT && t.kind === 'exp')
      .map(t => (t.desc.match(/\b(\d{4})\b/) || [])[1]).filter(Boolean))];
    out.push({ ic: '?', tone: 'y', t: `${money(cur.cats[CARD_CAT])} אשראי בלי פירוט`,
      s: `לכרטיס ${cards.join(', ') || 'הזה'} אין קובץ עסקאות, אז לא רואים לאן הכסף הלך.`, go: 'import', btn: 'לייבוא' });
  }
  for (const r of review(d, m).slice(0, 2))
    out.push({ ic: CATS[r.c] || '📦', emoji: true, tone: 'r', t: `${label(r.c)} גבוה ב-${money(r.diff)} מהממוצע`,
      s: 'שווה לבדוק אם זה חד-פעמי או הרגל שנוצר.', go: 'insights', btn: 'לסקירה' });
  const unc = d.items.filter(t => per(t.date) === m && t.cat === 'אחר' && t.kind === 'exp');
  if (unc.length) out.push({ ic: '•', tone: 'n', t: `${unc.length} תנועות ללא קטגוריה`,
    s: `${money(unc.reduce((a, t) => a - t.amount, 0))} שלא מסווגים פוגעים בדיוק של כל השאר.`, other: 1, btn: 'לסיווג' });
  return out;
}

function healthCard(d) {
  const H = health(d); if (!H) return '';
  const dot = c => `<i class="dot ${c}"></i>`;
  const rateC = H.rate != null ? (H.rate >= 0.2 ? 'g' : H.rate >= 0.1 ? 'y' : 'r') : '';
  const runC = H.runway != null ? (H.runway >= 3 ? 'g' : H.runway >= 1 ? 'y' : 'r') : '';
  const costC = H.cost < 300 ? 'g' : H.cost < 1000 ? 'y' : 'r';
  return `<div class="card health">
    ${H.rate != null ? `<div class="hrow">${dot(rateC)}<div class="grow"><b>שיעור חיסכון: ${Math.round(H.rate * 100)}%</b><div class="muted">${H.rate >= 0.2 ? 'מצוין – 20% ומעלה.' : H.rate >= 0.1 ? 'סביר. היעד המקובל הוא 20%.' : H.rate >= 0 ? 'נמוך. כדאי לחפש דליפות בכלים.' : 'ההוצאות גבוהות מההכנסות בממוצע.'}</div></div></div>` : ''}
    ${H.runway != null ? `<div class="hrow">${dot(runC)}<div class="grow"><b>כרית ביטחון: ${H.runway.toFixed(1)} חודשי הוצאה</b><div class="muted">${money(H.liquid)} נזילים${H.manual ? ' (עו"ש + חיסכון שהזנת בכלים)' : '. חיסכון וחשבונות אחרים לא נספרים – אפשר להזין אותם בכלים'}. מקובל 3–6 חודשים.</div></div></div>` : ''}
    ${H.fin > 0 ? `<div class="hrow">${dot(H.negM > H.nMonths / 2 ? 'r' : 'y')}<div class="grow"><b>כיסוי ממשיכות: ${money(H.fin)} ב-${H.nMonths} חודשים</b><div class="muted">זה הכסף שמשכת מחיסכון או מחשבון אחר כדי לסגור חודשים. ב-${H.negM} מתוך ${H.nMonths} חודשים ההוצאות היו גבוהות מההכנסה. זו הסיבה שהיתרה בעו"ש נמוכה.</div></div></div>` : ''}
    <div class="hrow">${dot(costC)}<div class="grow"><b>ריבית ועמלות ב-12 חודשים: ${money(H.cost)}</b><div class="muted">${H.cost < 300 ? 'נמוך, יופי.' : 'אפשר להוריד: הקטן מסגרת אוברדרפט ובדוק פטור מעמלות.'}</div></div></div>
  </div>`;
}

function monthNav(d, m) {
  const idx = d.months.indexOf(m);
  return `<div class="months">
    <button data-m="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="חודש קודם">›</button>
    <div class="title">${mLabel(m)}${perRange(m) ? `<div class="muted" style="font-size:12px;font-weight:400">${perRange(m)}</div>` : ''}</div>
    <button data-m="1" ${idx >= d.months.length - 1 ? 'disabled' : ''} aria-label="חודש הבא">‹</button>
  </div>`;
}

function openStrip(d, m) {
  const cp = per(todayISO()), b = d.byMonth[cp];
  if (m === cp || !b) return '';
  const net = b.inc - b.exp;
  return `<button class="strip" data-pick="${cp}">
    <span class="grow"><b>${mLabel(cp)} עד כה</b><span class="k">נכנס ${money(b.inc)} · יצא ${money(b.exp)}</span></span>
    <span class="${net >= 0 ? 'pos' : 'neg'}">${money(net)}</span><span class="go">‹</span></button>`;
}

/* "חרגת" is income minus expenses. The account can still climb in the same month,
   because money pulled in from savings is not income and card bills land late.
   Without the account's own movement next to it the two look like a contradiction. */
function reconcile(d, m) {
  const bank = d.items.filter(t => t.src === 'bank' && per(t.date) === m);
  if (!bank.length) return '';
  const flow = bank.reduce((a, t) => a + t.amount, 0);
  if (Math.abs(flow) < 1) return '';
  const b = d.byMonth[m], free = b.inc - b.exp, fin = b.fin || 0, up = flow > 0;
  const amt = `<b class="${up ? 'pos' : 'neg'}">${money(Math.abs(flow))}</b>`;
  let txt;
  if (free < 0 && up) txt = fin > 0
    ? `היתרה בחשבון דווקא עלתה ב-${amt} — בעיקר בזכות ${money(fin)} שמשכת מחיסכון או מחשבון אחר.`
    : `היתרה בחשבון דווקא עלתה ב-${amt}, בגלל הפרש העיתוי בין מועד הקנייה למועד החיוב.`;
  else if (free > 0 && !up) txt = `היתרה בחשבון ירדה ב-${amt}, בגלל חיובי אשראי שירדו החודש על קניות קודמות.`;
  else txt = `היתרה בחשבון ${up ? 'עלתה' : 'ירדה'} ב-${amt} בתקופה הזו.`;
  return `<div class="recon">${txt}</div>`;
}

function viewHome() {
  const d = derived(), m = curMonth();
  if (!m) return `<h1>תזרים מזומנים</h1>${emptyState()}`;
  const cur = d.byMonth[m], free = cur.inc - cur.exp, fin = cur.fin || 0;
  const idx = d.months.indexOf(m);
  const others = fullMonths(d).filter(x => x !== m);
  const avgExp = others.length ? others.reduce((s, x) => s + d.byMonth[x].exp, 0) / others.length : null;
  const cats = Object.entries(cur.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;
  const shown = showAllCats ? cats : cats.slice(0, 5);
  const last6 = d.months.slice(-6);
  const tmax = Math.max(1, ...last6.map(x => Math.max(d.byMonth[x].inc, d.byMonth[x].exp)));
  const partial = idx === 0 || perEnd(m) > lastData();
  const att = attention(d, m), show = att.slice(0, 3);

  return `${monthNav(d, m)}
  ${openStrip(d, m)}
  <div class="card hero">
    <div class="label">${free >= 0 ? 'נשאר לך' : 'חרגת ב'}</div>
    <div class="big ${free >= 0 ? 'pos' : 'neg'}">${money(Math.abs(free))}</div>
    <div class="split">
      <div class="tap" data-fin="1"><span>נכנס</span><b class="pos">${money(cur.inc)}</b><i>הכנסה אמיתית ‹</i></div>
      <div><span>יצא</span><b>${money(cur.exp)}</b><i>${avgExp != null ? `ממוצע ${money(avgExp)}` : '&nbsp;'}</i></div>
      ${fin > 0 ? `<div class="tap" data-fin="1"><span>נמשך</span><b>${money(fin)}</b><i>לא הכנסה ‹</i></div>` : ''}
    </div>
    ${reconcile(d, m)}
    ${partial ? `<div class="pill">תקופה חלקית · הנתונים עד ${dm(lastData())}${perEnd(m) > lastData() ? ', המחזור נסגר ב-' + dm(perEnd(m)) : ''}</div>` : ''}
  </div>

  ${show.length ? `<h2 class="sec">דורש תשומת לב</h2>
  <div class="card att">${show.map(a => `<div class="arow">
      <div class="aic ${a.emoji ? 'e' : a.tone}">${a.ic}</div>
      <div class="grow"><b>${esc(a.t)}</b><div class="muted">${esc(a.s)}</div></div>
      ${a.btn ? `<button class="chip" ${a.go ? `data-go="${a.go}"` : 'data-other="1"'}>${a.btn}</button>` : ''}
    </div>`).join('')}
    ${att.length > show.length ? `<button class="more" data-go="insights">עוד ${att.length - show.length} בסקירה המלאה</button>` : ''}
  </div>` : ''}

  <h2 class="sec">לאן הלך הכסף</h2>
  <div class="card">${shown.length ? shown.map(([c, v]) => { const b = S.budgets[c], over = b && v > b; return `
    <div class="bar-row" data-bud="${esc(c)}"><div class="emoji">${CATS[c] || '📦'}</div>
      <div><div>${esc(label(c))}${b ? ` <span class="muted">מתוך ${money(b)}</span>` : ''}</div><div class="track"><div class="fill ${over ? 'over' : ''}" style="width:${Math.min(100, Math.max(3, v / (b ? Math.max(b, v) : max) * 100))}%"></div></div></div>
      <div><b class="${over ? 'neg' : ''}">${money(v)}</b></div></div>`; }).join('') : '<div class="muted">אין הוצאות בחודש הזה</div>'}
    ${cats.length > 5 ? `<button class="more" data-allcats="1">${showAllCats ? 'הצג פחות' : `עוד ${cats.length - 5} קטגוריות`}</button>` : ''}
  </div>

  <h2 class="sec">6 חודשים אחרונים</h2>
  <div class="card"><div class="trend">${last6.map(x => `
    <div class="col ${x === m ? 'sel' : ''}" data-pick="${x}"><div class="pair">
      <div class="b i" style="height:${d.byMonth[x].inc / tmax * 100}%"></div>
      <div class="b e" style="height:${d.byMonth[x].exp / tmax * 100}%"></div></div>
      <div class="m">${mShort(x)}</div></div>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--pos)"></i>הכנסות</span><span><i style="background:var(--neg)"></i>הוצאות</span></div></div>`;
}

function finSheet() {
  const d = derived(), m = curMonth(), cur = d.byMonth[m];
  const rows = o => Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div class="bar-row" style="grid-template-columns:1fr auto"><div>${esc(k)}</div><div><b>${money(v)}</b></div></div>`).join('');
  openSheet(`<h3>מאיפה נכנס הכסף ב${mLabel(m)}</h3>
    ${Object.keys(cur.src).length ? `<div class="muted">הכנסה אמיתית – ${money(cur.inc)}</div>${rows(cur.src)}` : '<div class="muted">לא זוהתה הכנסה החודש.</div>'}
    ${Object.keys(cur.finSrc).length ? `<div class="muted" style="margin-top:18px">לא הכנסה – כסף שהעברת לעצמך, ${money(cur.fin)}</div>${rows(cur.finSrc)}
      <div class="note" style="margin-top:12px">משיכה מהפיקדון, מההשקעות או מחשבון אחר שלך היא לא הכנסה חדשה – זה כסף שכבר היה שלך. לכן הוא לא נספר ב"נשאר לך", אבל כן נכנס לחשבון.</div>` : ''}`);
}

function viewInsights() {
  const d = derived(), m = curMonth();
  if (!m) return `<h1>סקירה חודשית</h1>${emptyState()}`;
  const idx = d.months.indexOf(m), I = insightsData(d, m), R = reviewData(d, m), c = R.cur, free = c.inc - c.exp;
  const partial = !fullMonths(d).includes(m), noBase = R.others.length < 2;
  const rate = S.settings.rate;
  const diffTxt = (v, a) => a == null ? '' : `${v >= a ? '+' : '-'}${money(Math.abs(v - a)).replace('-', '')}`;
  return `${monthNav(d, m)}
  ${partial ? `<div class="note">זה חודש חלקי${idx === d.months.length - 1 ? ' (הנתונים עד ' + lastDay(m) + ')' : ''}, אז ההשוואה לממוצע פחות מדויקת.</div>` : ''}
  ${noBase ? '<div class="note">אין עדיין מספיק חודשים מלאים כדי לחשב ממוצע. ייבא נתונים של לפחות 3 חודשים.</div>' : ''}

  <h2 class="sec">מצב פיננסי</h2>
  ${healthCard(d)}

  <h2>1. הכנסות, הוצאות ויתרה פנויה מול הממוצע</h2>
  <div class="card story">
    <p>נכנסו <b class="pos">${money(c.inc)}</b>${R.avgInc != null ? ` <span class="muted">(ממוצע ${money(R.avgInc)})</span>` : ''}, יצאו <b class="neg">${money(c.exp)}</b>${R.avgExp != null ? ` <span class="muted">(ממוצע ${money(R.avgExp)})</span>` : ''}.</p>
    <p>${free >= 0 ? 'נשאר' : 'חרגת ב-'} <b class="${free >= 0 ? 'pos' : 'neg'}">${money(Math.abs(free))}</b>${R.avgFree != null ? ` <span class="muted">(ממוצע ${money(R.avgFree)})</span>` : ''}.</p>
  </div>
  <div class="card"><table class="t"><tr><th>קטגוריה</th><th class="n">החודש</th><th class="n">ממוצע</th><th class="n">סטייה</th></tr>
    ${R.catRows.slice(0, 12).map(r => `<tr><td>${CATS[r.c] || ''} ${esc(label(r.c))}${r.flag ? ' ⚠️' : ''}</td><td class="n ${r.flag ? 'neg' : ''}"><b>${money(r.v)}</b></td><td class="n">${r.a == null ? '—' : money(r.a)}</td><td class="n ${r.flag ? 'neg' : 'muted'}">${diffTxt(r.v, r.a)}</td></tr>`).join('')}</table>
    <p class="muted">⚠️ = יותר מ-15% מעל הממוצע שלך.</p></div>

  <h2>2. חיובים קבועים חדשים והתייקרויות</h2>
  <div class="card">
    ${R.fresh.length ? `<b>נראים כחיובים חדשים שחוזרים:</b>${R.fresh.map(x => `<div class="bar-row" style="grid-template-columns:1fr auto"><div>🆕 ${esc(x.name.slice(0, 30))}</div><div><b>${money(x.amount)}</b></div></div>`).join('')}` : '<div class="muted">לא זוהו חיובים קבועים חדשים.</div>'}
    ${R.rises.length ? `<div style="margin-top:10px"><b>התייקרויות:</b></div>${R.rises.map(x => `<div class="bar-row" style="grid-template-columns:1fr auto"><div>▲ ${esc(x.name.slice(0, 30))}</div><div><span class="muted">${money(x.from)} ←</span> <b class="neg">${money(x.to)}</b></div></div>`).join('')}` : '<div class="muted" style="margin-top:6px">אין התייקרויות בחיובים הקבועים.</div>'}
  </div>

  <h2>3. חיסכון וכסף שיושב בעו"ש</h2>
  <div class="card">
    <p>${R.dep > 0 ? `✅ הפקדת <b>${money(R.dep)}</b> לחיסכון והשקעות החודש${R.avgDep != null ? ` <span class="muted">(ממוצע ${money(R.avgDep)})</span>` : ''}.` : (R.habit ? '⚠️ לא זוהתה העברה לחיסכון החודש, אף על פי שבדרך כלל יש.' : '⚠️ לא זוהתה העברה לחיסכון החודש.')}</p>
    ${R.bal != null ? `<p>יתרה בעו"ש בסוף החודש: <b>${money(R.bal)}</b>. באפר מומלץ (חודש הוצאות): ${money(R.buffer)}.<br>${R.idle > 0 ? `כסף שיושב מעל הבאפר: <b class="pos">${money(R.idle)}</b>, כ-${money(R.idle * rate / 100)} בשנה בריבית ${rate}%.` : 'אין כסף עודף מעל הבאפר.'}</p>` : ''}
  </div>

  <h2>4. התקדמות בחובות ובחיסכון</h2>
  <div class="card">
    <p>החזרי הלוואות החודש: <b>${money(R.paidM)}</b>. סה"כ ששולם בתקופה: ${money(R.paidAll)}.</p>
    ${S.loan && S.loan.balance > 0 ? (() => { const P = loanPlan(S.loan); return `<p>יתרת ההלוואה (כפי שעדכנת ב-${S.loan.updated.split('-').reverse().join('/')}): <b>${money(S.loan.balance)}</b>, החזר חודשי ${money(S.loan.pay)}.${P && !P.bad ? `<br>נשארו כ-<b>${P.months}</b> חודשים (סיום בערך ${P.end}), ריבית עד הסוף כ-${money(P.interest)}.` : P ? '<br>⚠️ ההחזר החודשי לא מכסה את הריבית.' : ''}</p>`; })() : (R.taken ? `<p>הלוואות שנלקחו: ${money(R.taken)} – נשאר בערך ${money(Math.max(0, R.taken - R.paidAll))} <span class="muted">(הערכה בלי ריבית. לדיוק, עדכן את ההלוואה בלשונית כלים)</span>.</p>` : '')}
    ${R.feesM > 0 ? `<p>ריבית ועמלות בנק החודש: <b class="neg">${money(R.feesM)}</b>.</p>` : ''}
    ${c.sav ? `<p>${c.sav > 0 ? 'חיסכון והשקעות נטו החודש' : 'נמשך מהחיסכון נטו החודש'}: <b class="${c.sav > 0 ? 'pos' : 'neg'}">${money(Math.abs(c.sav))}</b>.</p>` : ''}
  </div>

  <h2>5. שלוש פעולות לחודש הזה</h2>
  ${R.actions.length ? R.actions.map((t, i) => `<div class="card tip"><div class="row"><div class="emoji" style="font-size:24px">${t.icon}</div><div class="grow"><b>${i + 1}. ${esc(t.title)}</b> <span class="pos">· כ-${money(t.impact)} בחודש</span><div class="muted">${t.text}</div></div></div></div>`).join('') : '<div class="card"><div class="muted">אין פעולות דחופות החודש. המשך כך.</div></div>'}
  ${I.good.length ? `<div class="card"><b>מה הלך טוב:</b>${I.good.map(g => `<div class="bar-row" style="grid-template-columns:28px 1fr auto"><div class="emoji">${CATS[g.c] || '📦'}</div><div>${esc(label(g.c))} נמוך מהרגיל</div><div><b class="pos">-${money(g.diff)}</b></div></div>`).join('')}</div>` : ''}

  <h2>רוצה לשאול AI?</h2>
  <div class="card"><div class="muted">מעתיק את שאלות הסקירה יחד עם הנתונים של החודש (בלי שמות, ת"ז או מספרי חשבון). הדבק בצ'אט עם Claude או ChatGPT לניתוח עמוק יותר.</div>
    <p><button class="btn ghost block" id="copyAI">📋 העתקת סיכום ל-AI</button></p></div>
  <p class="muted" style="text-align:center">תוכן לימודי בלבד. אינו ייעוץ השקעות, מס או פנסיה.</p>`;
}

function txRow(t) {
  const sign = t.amount > 0 ? '+' : '';
  const name = t.src === 'manual' ? '✍️ ' + t.desc : t.desc;
  return `<button class="tx ${t.kind === 'int' ? 'int' : ''}" data-id="${esc(t.id)}">
    <div class="emoji">${CATS[t.cat] || '📦'}</div>
    <div class="grow"><div class="name">${esc(name)}</div><div class="sub">${esc(label(t.cat))}${t.kind === 'int' ? ' · לא נספר' : t.kind === 'sav' ? ' · לא הוצאה' : ''}</div></div>
    <div class="amt ${t.amount > 0 ? 'pos' : ''}">${sign}${money(t.amount)}</div></button>`;
}

function viewTxns() {
  const d = derived(), m = curMonth();
  if (!m) return `<h1>תנועות</h1>${emptyState()}`;
  const idx = d.months.indexOf(m);
  let list = d.items.filter(t => per(t.date) === m);
  if (filter.kind === 'exp') list = list.filter(t => t.kind === 'exp');
  if (filter.kind === 'inc') list = list.filter(t => t.kind === 'inc');
  if (filter.kind === 'other') list = list.filter(t => t.cat === 'אחר');
  if (filter.q) list = list.filter(t => (t.desc + label(t.cat)).toLowerCase().includes(filter.q.toLowerCase()));
  list.sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
  let html = '', day = '';
  for (const t of list) {
    if (t.date !== day) { if (day) html += '</div>'; day = t.date; html += `<div class="day">${+t.date.slice(8)} ב${MONTHS[+t.date.slice(5, 7) - 1]}</div><div class="list">`; }
    html += txRow(t);
  }
  if (day) html += '</div>';
  return `${monthNav(d, m)}
  <input class="search" id="q" type="search" placeholder="חיפוש בית עסק..." value="${esc(filter.q)}">
  <div class="chips">${[['all', 'הכל'], ['exp', 'הוצאות'], ['inc', 'הכנסות'], ['other', 'ללא קטגוריה']].map(([k, l]) => `<button class="chip ${filter.kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>
  ${html || '<div class="empty">אין תנועות</div>'}`;
}
function bindTxns() {
  const q = $('#q');
  q.addEventListener('input', () => {
    filter.q = q.value; const pos = q.selectionStart;
    render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos);
  });
}

function viewImport() {
  const last = S.lastImport ? `עודכן לאחרונה ב-${S.lastImport.split('-').reverse().join('/')}` : 'עוד לא ייבאת קבצים';
  return `<h1>ייבוא נתונים</h1>
  <div class="drop">
    <div class="icon">📥</div>
    <p><b>בחר את קבצי האקסל מהבנק ומהאשראי</b><br><span class="muted">אפשר לבחור כמה קבצים יחד. האפליקציה מזהה לבד מה כל קובץ.</span></p>
    <button class="btn" id="pick">בחירת קבצים</button>
    <input type="file" id="file" accept=".xlsx,.xls,.csv" multiple hidden>
    <div class="muted" style="margin-top:10px">${last}</div>
  </div>
  <div id="importResult"></div>
  <h2>איך מורידים?</h2>
  <div class="card">
    <ol class="steps">
      <li><b>עו"ש:</b> באתר/אפליקציית דיסקונט ← עובר ושב ← ייצוא לאקסל.</li>
      <li><b>אשראי:</b> כרטיסי אשראי ← פירוט עסקאות ← ייצוא לאקסל.</li>
      <li><b>מהדרייב:</b> לחץ "בחירת קבצים" ובחלון שנפתח בחר Drive (באייפון: <b>עיון</b> ← Google Drive, אחרי שהפעלת אותו ב"מיקומים" באפליקציית קבצים). אפשר לבחור כמה קבצים יחד.</li>
      <li>אפשר להעלות גם קבצים שחופפים לתקופה שכבר ייבאת – כפילויות מסוננות לבד.</li>
    </ol>
  </div>
  <div class="note">🔒 הקבצים נקראים בתוך הטלפון בלבד ולא נשלחים לשום מקום. נשמרים רק תאריך, בית עסק וסכום – בלי שם, ת"ז או מספרי חשבון.</div>`;
}

function loanFee(amount, rate, years, fee) {
  const mr = Math.pow(1 + rate / 100, 1 / 12) - 1;
  return amount * Math.pow((1 + mr) * (1 - fee / 100 / 12), years * 12);
}

function viewTools() {
  const d = derived();
  const rec = recurring(d);
  const recTotal = rec.reduce((s, r) => s + r.yearly, 0);
  const fm = fullMonths(d);
  const avgExp = fm.length ? fm.reduce((s, x) => s + d.byMonth[x].exp, 0) / fm.length : 0;
  const bank = S.txns.filter(t => t.src === 'bank' && t.bal != null);
  const curBal = position(d).curBal;
  const minBal = bank.length ? Math.min(...bank.map(t => t.bal)) : null;
  const buffer = avgExp;
  const idle = curBal != null ? Math.max(0, curBal - buffer) : 0;
  const rate = S.settings.rate;

  const CHECK = [
    ['שבוע 1 – לראות את האמת', ['לכבות אימון ו"זיכרון" באפליקציית ה-AI שלי', 'לייצא 12 חודשים: בנק + כל כרטיס אשראי', 'להסיר ת"ז ומספרי חשבון/כרטיס מהקבצים', 'לייבא לאפליקציה ולרשום את ה"נשאר לי" החודשי']],
    ['שבועות 2–3 – לפנות כסף', ['לבטל לפחות 3 דליפות (מסך המנויים)', 'לנהל משא ומתן על סלולר / אינטרנט / ביטוחים', 'להתחיל תוכנית לסגירת חובות', 'לבקש מהבנק להקטין את מסגרת האוברדרפט', 'להגדיר באפר ולהעביר את היתר מהעו"ש']],
    ['שבוע 4 – לגרום לזה לצבור', ['להפיק דוח מסלקה פנסיונית ולבדוק דמי ניהול', 'לבקש הורדת דמי ניהול בפנסיה', 'לחפש בהר הכסף ובהר הביטוח', 'לבדוק החזרי מס ל-6 שנים אחורה', 'הוראת קבע "שלם לעצמך קודם" ביום משכורת', 'תזכורת קבועה לעדכון חודשי באפליקציה']],
  ];
  const done = Object.values(S.checks).filter(Boolean).length, totalC = CHECK.reduce((s, c) => s + c[1].length, 0);

  return `<h1>כלים</h1>
  <details open><summary>🔁 מנויים וחיובים חוזרים</summary><div class="inner">
    ${rec.length ? `<p class="muted">נמצאו ${rec.length} חיובים קבועים, בסך <b>${money(recTotal)}</b> בשנה.</p>
    <table class="t">${rec.slice(0, 15).map(r => `<tr><td>${CATS[r.cat] || ''} ${esc(r.name.slice(0, 22))}${r.last > r.first * 1.05 ? ' <span title="עלה במחיר" class="neg">▲</span>' : ''}</td>
      <td class="n">${money(r.monthly)}/חו'</td><td class="n"><b>${money(r.yearly)}</b></td></tr>`).join('')}</table>
    <p class="muted">▲ = המחיר עלה מאז החיוב הראשון. בדוק מה אפשר לבטל או להוזיל.</p>
    ${avgExp > 0 ? `<p class="muted">חיובים קבועים הם בערך ${Math.round(recTotal / 12 / avgExp * 100)}% מההוצאה החודשית שלך – זה החלק הקשה לשינוי, אז שווה לבדוק אותו פעם בשנה.</p>` : ''}` : '<p class="muted">עוד אין מספיק נתונים – צריך לפחות 3 חודשים.</p>'}
  </div></details>

  <details><summary>📅 סיכום חודשי</summary><div class="inner">
    ${d.months.length ? `<table class="t"><tr><th></th><th class="n">הכנסות</th><th class="n">הוצאות</th><th class="n">נשאר</th><th class="n">נמשך</th></tr>
    ${[...d.months].reverse().map(x => { const b = d.byMonth[x], f = b.inc - b.exp; return `<tr><td>${mShort(x)} ${x.slice(2, 4)}${fullMonths(d).includes(x) ? '' : '*'}</td><td class="n">${money(b.inc)}</td><td class="n">${money(b.exp)}</td><td class="n ${f >= 0 ? 'pos' : 'neg'}"><b>${money(f)}</b></td><td class="n muted">${b.fin ? money(b.fin) : ''}</td></tr>`; }).join('')}</table>
    <p class="muted">* חודש חלקי – חסרים נתונים בקצה הטווח. "נמשך" = כסף שהעברת לעצמך מחיסכון או מחשבון אחר, ולכן אינו נספר כהכנסה.</p>` : '<p class="muted">אין נתונים.</p>'}
  </div></details>

  <details><summary>💰 כסף שיושב בחשבון בלי לעבוד</summary><div class="inner">
    ${curBal == null ? '<p class="muted">ייבא קובץ עו"ש כדי לראות.</p>' : `
    <table class="t">
      <tr><td>יתרה נוכחית בעו"ש</td><td class="n">${money(curBal)}</td></tr>
      <tr><td>היתרה הנמוכה ביותר בתקופה</td><td class="n">${money(minBal)}</td></tr>
      <tr><td>באפר מומלץ (חודש הוצאות)</td><td class="n">${money(buffer)}</td></tr>
      <tr><td><b>כסף שאפשר להזיז</b></td><td class="n"><b>${money(idle)}</b></td></tr>
    </table>
    <div class="field"><span>ריבית שנתית (פיקדון / קרן כספית)</span><input type="number" id="rate" step="0.25" value="${rate}"></div>
    <p>רווח שנתי משוער: <b class="pos">${money(idle * rate / 100)}</b> <span class="muted">לפני מס ועמלות</span></p>
    <p class="muted">קרן חירום: 3–6 חודשי הוצאה = ${money(avgExp * 3)} – ${money(avgExp * 6)}. הבנק משלם בערך 0.1% על עו"ש. את ההעברה עושים בעצמך.</p>`}
  </div></details>

  <details><summary>📅 תחילת המחזור החודשי</summary><div class="inner">
    <p class="muted">באיזה יום מתחיל אצלך החודש הכספי? אם המשכורת נכנסת וחיוב האשראי יורד ב-10, בחר 10, וכל תקופה תתאר מחזור שלם: 10 לחודש עד 9 לחודש הבא.</p>
    <div class="field"><span>היום בחודש</span><input type="number" id="sd" min="1" max="28" value="${startDay()}"></div>
    <div class="field"><span>יתרה בחיסכון / השקעות (₪)</span><input type="number" id="svb" min="0" step="100" value="${S.settings.savings || ''}" placeholder="לא הוזן"></div>
    <p class="muted">כסף נזיל שלך מחוץ לעו"ש הזה (פיקדון, קרן כספית, בלינק וכו'). משמש רק לחישוב כרית הביטחון.</p>
    <div class="note">${startDay() === 1 ? 'כרגע: חודש לוח רגיל (1 עד סוף החודש).' : `כרגע: מה-${startDay()} לחודש עד ה-${startDay() - 1} בחודש הבא.`}</div>
  </div></details>

  <details><summary>💳 עדכון הלוואה</summary><div class="inner">
    <p class="muted">אופציונלי. מספיק לעדכן כשההלוואה משתנה (פירעון מוקדם, מחזור או החזר חדש). בלי עדכון האפליקציה מעריכה לפי התנועות בעו"ש.</p>
    <div class="field"><span>יתרה לסילוק (₪)</span><input type="number" id="lb" value="${S.loan ? S.loan.balance : ''}"></div>
    <div class="field"><span>החזר חודשי (₪)</span><input type="number" id="lp" value="${S.loan ? S.loan.pay : ''}"></div>
    <div class="field"><span>ריבית שנתית (%)</span><input type="number" id="lr" step="0.1" value="${S.loan ? S.loan.rate : ''}"></div>
    <div id="loanOut" class="note"></div>
    <button class="btn ghost block" id="lclr">ניקוי עדכון</button>
  </div></details>

  <details><summary>📉 כמה עולים דמי ניהול</summary><div class="inner">
    <div class="field"><span>סכום (₪)</span><input type="number" id="fa" value="100000"></div>
    <div class="field"><span>תשואה שנתית (%)</span><input type="number" id="fr" value="7" step="0.5"></div>
    <div class="field"><span>שנים</span><input type="number" id="fy" value="30"></div>
    <div class="field"><span>דמי ניהול שלך (%)</span><input type="number" id="f1" value="1" step="0.05"></div>
    <div class="field"><span>דמי ניהול מוצעים (%)</span><input type="number" id="f2" value="0.22" step="0.05"></div>
    <div id="feeOut" class="note"></div>
  </div></details>

  <details><summary>✅ צ'קליסט 30 יום (${done}/${totalC})</summary><div class="inner">
    ${CHECK.map(([h, items], i) => `<div class="weekh">${h}</div>${items.map((t, j) => `
      <label class="check ${S.checks[i + '-' + j] ? 'done' : ''}"><input type="checkbox" data-ck="${i}-${j}" ${S.checks[i + '-' + j] ? 'checked' : ''}><span>${t}</span></label>`).join('')}`).join('')}
  </div></details>

  <details><summary>⚙️ גיבוי והגדרות</summary><div class="inner">
    <p class="muted">הנתונים שמורים רק בדפדפן של הטלפון הזה. אם תמחק את האפליקציה או תחליף מכשיר – הם יאבדו. עשה גיבוי מדי פעם.</p>
    <p><button class="btn block" id="bk">⬇️ שמירת גיבוי</button></p>
    <p><button class="btn ghost block" id="rs">⬆️ שחזור מגיבוי</button><input type="file" id="rsf" accept=".json" hidden></p>
    <p><button class="btn danger block" id="wipe">🗑️ מחיקת כל הנתונים</button></p>
    <p><button class="btn ghost block" id="upd">🔄 עדכון לגרסה האחרונה</button></p>
    <p class="muted">מקורות: ${sources().bank} תנועות עו"ש · ${sources().card} עסקאות אשראי · ${sources().manual} ידניות${sources().from ? ` · מ-${sources().from.split('-').reverse().join('/')} עד ${sources().to.split('-').reverse().join('/')}` : ''}</p>
    <p class="muted">גרסה ${VERSION} · ${S.txns.length} תנועות שמורות${storageOk ? '' : ' · ⚠️ השמירה במכשיר נכשלה'}</p>
  </div></details>
  <p class="muted" style="text-align:center">תוכן לימודי בלבד. אינו ייעוץ השקעות, מס או פנסיה.</p>`;
}
function bindTools() {
  const calc = () => {
    const v = id => parseFloat($('#' + id).value) || 0;
    const a = loanFee(v('fa'), v('fr'), v('fy'), v('f1')), b = loanFee(v('fa'), v('fr'), v('fy'), v('f2'));
    $('#feeOut').innerHTML = `אחרי ${v('fy')} שנים:<br>עם ${v('f1')}% → <b>${money(a)}</b><br>עם ${v('f2')}% → <b>${money(b)}</b><br>ההפרש: <b class="pos">${money(b - a)}</b>`;
  };
  ['fa', 'fr', 'fy', 'f1', 'f2'].forEach(id => $('#' + id).addEventListener('input', calc)); calc();
  const sv = $('#svb');
  if (sv) sv.addEventListener('change', () => {
    const v = parseFloat(sv.value);
    S.settings.savings = v > 0 ? v : undefined; save(); render(); toast('עודכן');
  });
  $('#sd').addEventListener('change', e => {
    const v = Math.min(28, Math.max(1, parseInt(e.target.value) || 1));
    S.settings.startDay = v; save(); cache = null; selMonth = null; render(); toast('המחזור עודכן');
  });
  const lc = () => {
    const v = id => parseFloat($('#' + id).value) || 0;
    S.loan = v('lb') > 0 ? { balance: v('lb'), pay: v('lp'), rate: v('lr'), updated: todayISO() } : null; save();
    const P = loanPlan(S.loan);
    $('#loanOut').innerHTML = !S.loan ? 'אין עדכון שמור.' : !P ? 'הזן גם החזר חודשי.' : P.bad ? '⚠️ ההחזר החודשי לא מכסה את הריבית.' : `נשארו כ-<b>${P.months}</b> חודשים (עד ${P.end}). ריבית עד הסוף: <b>${money(P.interest)}</b>.`;
  };
  ['lb', 'lp', 'lr'].forEach(id => $('#' + id).addEventListener('change', lc)); lc();
  $('#lclr').onclick = () => { S.loan = null; save(); ['lb', 'lp', 'lr'].forEach(id => $('#' + id).value = ''); lc(); };
  const r = $('#rate'); if (r) r.addEventListener('change', () => { S.settings.rate = parseFloat(r.value) || 0; save(); const o = document.querySelectorAll('details'); const open = [...o].map(x => x.open); render(); document.querySelectorAll('details').forEach((x, i) => x.open = open[i]); });
  document.querySelectorAll('[data-ck]').forEach(c => c.addEventListener('change', () => {
    S.checks[c.dataset.ck] = c.checked; save(); c.closest('.check').classList.toggle('done', c.checked);
  }));
  $('#bk').onclick = () => {
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cashflow-backup-${todayISO()}.json`; a.click();
    toast('הגיבוי נשמר');
  };
  $('#upd').onclick = async () => {
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
    location.reload();
  };
  $('#rs').onclick = () => $('#rsf').click();
  $('#rsf').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (!j.txns) throw 0;
      S = Object.assign(blank(), j); save(); render(); toast('הנתונים שוחזרו');
    } catch (err) { toast('קובץ הגיבוי לא תקין'); }
  };
  $('#wipe').onclick = () => {
    if (confirm('למחוק את כל הנתונים מהמכשיר? אי אפשר לבטל.')) { S = blank(); save(); selMonth = null; render(); toast('הכל נמחק'); }
  };
}

/* ---------- sheets ---------- */
function openSheet(html) { $('#sheet .sheet-body').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

function editTx(id) {
  const t = derived().items.find(x => x.id === id); if (!t) return;
  const cats = Object.keys(CATS);
  let pick = t.cat;
  openSheet(`<h3>${esc(t.desc)}</h3>
    <div class="muted">${t.date.split('-').reverse().join('/')} · <b class="${t.amount > 0 ? 'pos' : ''}">${money(t.amount)}</b></div>
    <div class="catgrid">${cats.map(c => `<button data-c="${esc(c)}" class="${c === pick ? 'on' : ''}"><span class="e">${CATS[c]}</span>${esc(label(c))}</button>`).join('')}</div>
    ${t.src !== 'manual' ? `<label class="check"><input type="checkbox" id="all" checked><span>החל על כל התנועות של "${esc(norm(t.desc) || t.desc)}"</span></label>` : ''}
    <div class="row"><button class="btn grow" id="ok">שמירה</button>
    ${t.src === 'manual' ? '<button class="btn danger" id="del">מחיקה</button>' : ''}</div>`);
  const body = $('#sheet .sheet-body');
  body.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { pick = b.dataset.c; body.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
  $('#ok').onclick = () => {
    const all = $('#all')?.checked;
    const key = norm(t.desc);
    for (const x of S.txns) if (x.id === id || (all && key && norm(x.desc) === key)) { x.cat = pick; x.manual = true; }
    if (all && key) S.rules[key] = pick;
    save(); closeSheet(); render(); toast('נשמר');
  };
  const del = $('#del'); if (del) del.onclick = () => { S.txns = S.txns.filter(x => x.id !== id); save(); closeSheet(); render(); };
}

function setBudget(c) {
  const d = derived(), sug = Math.round(catAvg(d, c) / 50) * 50;
  openSheet(`<h3>${CATS[c] || ''} תקציב חודשי – ${esc(label(c))}</h3>
    <div class="muted">${sug ? 'הממוצע החודשי שלך בקטגוריה: ' + money(catAvg(d, c)) : ''}</div>
    <input class="bigin" id="bv" type="number" inputmode="numeric" placeholder="₪" value="${S.budgets[c] || sug || ''}">
    <div class="row" style="margin-top:12px"><button class="btn grow" id="ok">שמירה</button>${S.budgets[c] ? '<button class="btn ghost" id="rm">הסרה</button>' : ''}</div>`);
  $('#ok').onclick = () => { const v = parseFloat($('#bv').value); if (v > 0) S.budgets[c] = v; else delete S.budgets[c]; save(); closeSheet(); render(); };
  const rm = $('#rm'); if (rm) rm.onclick = () => { delete S.budgets[c]; save(); closeSheet(); render(); };
}

function addTx() {
  let type = 'exp', cat = 'אחר';
  const cats = Object.keys(CATS).filter(c => c !== CARD_CAT && c !== INTERNAL);
  const draw = () => {
    const list = cats.filter(c => (type === 'inc') === INCOME_CATS.includes(c));
    if (!list.includes(cat)) cat = list.includes('אחר') ? 'אחר' : list[0];
    $('#cg').innerHTML = list.map(c => `<button data-c="${esc(c)}" class="${c === cat ? 'on' : ''}"><span class="e">${CATS[c]}</span>${esc(label(c))}</button>`).join('');
    $('#cg').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cat = b.dataset.c; draw(); });
  };
  openSheet(`<h3>הוספת תנועה (למשל מזומן)</h3>
    <div class="seg"><button data-t="exp" class="on">הוצאה</button><button data-t="inc">הכנסה</button></div>
    <input class="bigin" id="amt" type="number" inputmode="decimal" placeholder="0" autofocus>
    <div class="field"><span>תיאור</span><input type="text" id="dsc" placeholder="מה זה היה?"></div>
    <div class="field"><span>תאריך</span><input type="date" id="dt" value="${todayISO()}"></div>
    <div class="catgrid" id="cg"></div>
    <button class="btn block" id="ok">הוספה</button>`);
  draw();
  document.querySelectorAll('.seg [data-t]').forEach(b => b.onclick = () => { type = b.dataset.t; document.querySelectorAll('.seg [data-t]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#ok').onclick = () => {
    const v = Math.abs(parseFloat($('#amt').value));
    if (!v) { toast('הכנס סכום'); return; }
    const date = $('#dt').value || todayISO();
    const desc = $('#dsc').value.trim() || label(cat);
    S.txns.push({ id: 'm' + Date.now().toString(36), date, desc, amount: type === 'inc' ? v : -v, src: 'manual', cat });
    selMonth = per(date); save(); closeSheet(); render(); toast('נוסף');
  };
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-tab],[data-go],[data-m],[data-pick],[data-kind],[data-id],[data-bud],[data-other],[data-fin],[data-allcats],#pick,#fab,.sheet-bg');
  if (!el) return;
  if (el.dataset.tab) { tab = el.dataset.tab; render(); scrollTo(0, 0); }
  else if (el.dataset.go) { tab = el.dataset.go; render(); scrollTo(0, 0); }
  else if (el.dataset.m) { const d = derived(), i = d.months.indexOf(curMonth()) + (+el.dataset.m); if (d.months[i]) { selMonth = d.months[i]; render(); } }
  else if (el.dataset.pick) { selMonth = el.dataset.pick; render(); }
  else if (el.dataset.kind) { filter.kind = el.dataset.kind; render(); }
  else if (el.dataset.id) editTx(el.dataset.id);
  else if (el.dataset.bud) setBudget(el.dataset.bud);
  else if (el.dataset.other) { filter.kind = 'other'; tab = 'txns'; render(); scrollTo(0, 0); }
  else if (el.dataset.fin) finSheet();
  else if (el.dataset.allcats) { showAllCats = !showAllCats; render(); }
  else if (el.id === 'pick') { const f = $('#file'); f.onchange = async () => {
      const files = [...f.files]; if (!files.length) return;
      $('#importResult').innerHTML = '<div class="note">קורא קבצים…</div>';
      const res = await importFiles(files);
      derived(); selMonth = null;
      $('#importResult').innerHTML = `<h2>תוצאות</h2><div class="card">${res.map(r => `
        <div class="result"><span>${r.err || !r.kind ? '⚠️' : '✅'}</span><div class="grow"><b>${esc(r.name)}</b><div class="muted">${
          r.err || !r.kind ? 'לא זוהה כקובץ בנק או אשראי' :
          r.summary ? `${r.kind} – זה קובץ סיכום חודשי בלי פירוט עסקאות, לכן החיובים נספרים לפי התשלום מהעו"ש.` :
          `${r.kind}: נוספו ${r.added} תנועות${r.dup ? `, ${r.dup} כבר היו קיימות` : ''}`}</div></div></div>`).join('')}
        </div>${headline()}`;
      f.value = '';
    }; f.click(); }
  else if (el.id === 'fab') addTx();
  else if (el.classList.contains('sheet-bg')) closeSheet();
});

if (S.v !== 3) { reclassify(); S.v = 3; save(); }
if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
  navigator.serviceWorker.register('sw.js').catch(() => {});
render();
