'use strict';
/* תזרים מזומנים - כל הנתונים נשמרים רק במכשיר (localStorage). */

const KEY = 'cashflow.v1';
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const CARD_CAT = 'כרטיס אשראי';          // חיוב אשראי בעו"ש
const INTERNAL = 'פנימי';
const INCOME_CATS = ['משכורת', 'קצבאות והחזרים', 'הכנסה אחרת'];

const CATS = {
  'דיור': '🏠', 'מזון': '🛒', 'מסעדות ובילויים': '🍽️', 'תחבורה ודלק': '🚗', 'בריאות': '💊',
  'ביטוח': '🛡️', 'תקשורת ומנויים': '📱', 'קניות וטיפוח': '🛍️', 'נסיעות וחופשות': '✈️',
  'מיסים ועירייה': '🏛️', 'ריבית ועמלות': '🏦', 'החזר הלוואות': '💳', 'מזומן': '💵',
  'העברות': '🔁', 'תרומות': '🤲', 'אחר': '📦',
  'משכורת': '💼', 'קצבאות והחזרים': '🧾', 'הכנסה אחרת': '💰',
  [CARD_CAT]: '💳', [INTERNAL]: '↔️',
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

// כללים לתנועות בנק (לפי סדר)
const BANK_RULES = [
  [/משכורת/, 'משכורת', 1],
  [/ביטוח לאומי|בטוח לאומי|מס.?הכנסה/, 'קצבאות והחזרים', 1],
  [/הקמת הלוואה|פיקדון|פקדון|הפקדה|רווח.*מפיק|מס על רווח|מס במקור|חיוב מס/, INTERNAL],
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
function blank() { return { txns: [], rules: {}, checks: {}, budgets: {}, settings: { rate: 3 }, lastImport: null }; }
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
const mLabel = m => MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
const mShort = m => MONTHS[+m.slice(5) - 1].slice(0, 3);
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3000); }
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function norm(desc) {
  return String(desc).toUpperCase().replace(/[0-9*#.,'"\-_\/\\()]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

/* ---------- derived data ---------- */
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
    if (t.cat === INTERNAL) return 'int';
    return INCOME_CATS.includes(t.cat) ? 'inc' : 'exp';
  };
  const byMonth = {};
  const items = S.txns.map(t => ({ ...t, kind: kind(t) }));
  for (const t of items) {
    const m = (byMonth[ym(t.date)] ??= { inc: 0, exp: 0, cats: {}, n: 0 });
    m.n++;
    if (t.kind === 'inc') m.inc += t.amount;
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
  if (!selMonth || !d.byMonth[selMonth]) selMonth = d.months[d.months.length - 1];
  return selMonth;
}
function fullMonths(d) { return d.months.length > 2 ? d.months.slice(1, -1) : d.months; }

function position(d) {
  let best = null;
  for (const t of S.txns) if (t.src === 'bank' && t.bal != null && (!best || t.date > best.date)) best = t;
  const netDep = -S.txns.filter(t => t.cat === INTERNAL && /פיקדון|פקדון/.test(t.desc)).reduce((a, t) => a + t.amount, 0);
  return { curBal: best ? best.bal : null, netDep };
}
function health(d) {
  const fm = fullMonths(d); if (!fm.length) return null;
  const inc = fm.reduce((a, m) => a + d.byMonth[m].inc, 0), exp = fm.reduce((a, m) => a + d.byMonth[m].exp, 0);
  const avgExp = exp / fm.length;
  const { curBal, netDep } = position(d);
  const liquid = curBal == null ? null : curBal + Math.max(0, netDep);
  const [y, mo] = d.months[d.months.length - 1].split('-').map(Number);
  const from = new Date(Date.UTC(y, mo - 12, 1)).toISOString().slice(0, 7);
  const cost = d.items.filter(t => t.cat === 'ריבית ועמלות' && t.kind === 'exp' && ym(t.date) >= from).reduce((a, t) => a - t.amount, 0);
  return { cost: Math.max(0, cost), rate: inc > 0 ? (inc - exp) / inc : null, avgExp, runway: liquid != null && avgExp > 0 ? liquid / avgExp : null, liquid };
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
    const months = [...new Set(arr.map(t => ym(t.date)))];
    if (months.length < 3) continue;
    const amts = arr.map(t => -t.amount).sort((a, b) => a - b);
    const med = amts[Math.floor(amts.length / 2)];
    const stable = amts.filter(a => Math.abs(a - med) <= med * 0.25).length / amts.length;
    if (stable < 0.7) continue;
    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    const perMonth = arr.reduce((s, t) => s - t.amount, 0) / months.length;
    out.push({ name: arr[0].desc, cat: arr[0].cat, months: months.length, monthly: perMonth, yearly: perMonth * 12,
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

function classifyBank(desc, amount) {
  for (const [re, cat, onlyPos] of BANK_RULES) {
    if (!re.test(desc)) continue;
    if (onlyPos && amount <= 0) continue;
    if (cat) return cat;
    return amount > 0 ? 'הכנסה אחרת' : 'העברות';
  }
  return amount > 0 ? 'הכנסה אחרת' : 'אחר';
}
function applyRule(t) {
  const r = S.rules[norm(t.desc)];
  return r || t.cat;
}

function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const out = { txns: [], kinds: new Set() };
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const hi = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'תאריך עסקה') || r.some(c => String(c ?? '').includes('תיאור התנועה')) || r.some(c => String(c ?? '').trim() === 'חודש חיוב'));
    if (hi < 0) continue;
    const head = rows[hi].map(c => String(c ?? '').trim());
    const col = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
    if (head.includes('תאריך עסקה')) {
      out.kinds.add('card');
      const c = { date: col('תאריך עסקה'), name: col('שם בית העסק'), cat: col('קטגוריה'), card: col('4 ספרות'), type: col('סוג עסקה'), amt: col('סכום חיוב'), cdate: col('תאריך חיוב') };
      const seen = {};
      for (const r of rows.slice(hi + 1)) {
        let date = parseDate(r[c.date]); if (!date || typeof r[c.amt] !== 'number') continue;
        if (String(r[c.type] ?? '').includes('תשלומים')) date = parseDate(r[c.cdate]) || date;
        const desc = clean(r[c.name]);
        const card = String(r[c.card] ?? '').trim();
        const amount = -r[c.amt];
        const base = ['card', date, amount, desc, card].join('|');
        const n = seen[base] = (seen[base] || 0) + 1;
        const cat = DONATE.test(desc) ? 'תרומות' : CARD_MAP[String(r[c.cat] ?? '').trim()] || 'אחר';
        out.txns.push({ id: hash(base) + '#' + n, date, desc, amount, src: 'card', card, cat });
      }
    } else if (head.some(h => h.includes('תיאור התנועה'))) {
      out.kinds.add('bank');
      const c = { date: col('תאריך'), desc: col('תיאור התנועה'), amt: col('זכות/חובה'), bal: col('יתרה') };
      const seen = {};
      for (const r of rows.slice(hi + 1)) {
        const date = parseDate(r[c.date]); if (!date || typeof r[c.amt] !== 'number') continue;
        const desc = clean(r[c.desc]); const amount = r[c.amt];
        const bal = typeof r[c.bal] === 'number' ? r[c.bal] : null;
        const base = ['bank', date, amount, desc, bal].join('|');
        const n = seen[base] = (seen[base] || 0) + 1;
        out.txns.push({ id: hash(base) + '#' + n, date, desc, amount, src: 'bank', bal, cat: classifyBank(desc, amount) });
      }
    } else if (head.includes('חודש חיוב')) {
      out.kinds.add('summary');
    }
  }
  return out;
}

async function importFiles(files) {
  const results = [];
  for (const f of files) {
    try {
      const p = parseWorkbook(await f.arrayBuffer());
      const have = new Set(S.txns.map(t => t.id));
      let added = 0, dup = 0;
      for (const t of p.txns) {
        if (have.has(t.id)) { dup++; continue; }
        t.cat = applyRule(t); S.txns.push(t); have.add(t.id); added++;
      }
      let kind = p.kinds.has('bank') ? 'חשבון עו"ש' : p.kinds.has('card') ? 'כרטיס אשראי' : p.kinds.has('summary') ? 'סיכום חיובי אשראי' : null;
      results.push({ name: f.name, kind, added, dup, summary: p.kinds.has('summary') && !p.txns.length });
    } catch (e) { results.push({ name: f.name, kind: null, added: 0, dup: 0, err: true }); }
  }
  S.lastImport = todayISO(); save();
  return results;
}

/* ---------- views ---------- */
let tab = 'home';
let filter = { q: '', kind: 'all' };

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').style.display = (tab === 'home' || tab === 'txns') ? '' : 'none';
  $('#view').innerHTML = ({ home: viewHome, txns: viewTxns, import: viewImport, tools: viewTools })[tab]();
  if (tab === 'tools') bindTools();
  if (tab === 'txns') bindTxns();
}

function emptyState() {
  return `<div class="empty"><div class="icon">📊</div><h2>עוד אין נתונים</h2>
    <p>ייבא קבצי אקסל מהבנק ומהאשראי והאפליקציה תסווג הכל לבד.</p>
    <button class="btn" data-go="import">להתחלה</button></div>`;
}

function reminderBanner() {
  const t = new Date(), day = t.getDate();
  const nineth = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-09`;
  if (day >= 9 && (!S.lastImport || S.lastImport < nineth) && S.txns.length)
    return `<div class="banner">📅 הגיע הזמן לעדכון החודשי – העלה קבצים חדשים מהבנק ומהאשראי. <button class="chip" data-go="import">לייבוא</button></div>`;
  return '';
}

function viewHome() {
  const d = derived(), m = curMonth();
  if (!m) return `<h1>תזרים מזומנים</h1>${emptyState()}`;
  const cur = d.byMonth[m], free = cur.inc - cur.exp;
  const idx = d.months.indexOf(m);
  const others = fullMonths(d).filter(x => x !== m);
  const avgExp = others.length ? others.reduce((s, x) => s + d.byMonth[x].exp, 0) / others.length : null;
  const cats = Object.entries(cur.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;
  const last6 = d.months.slice(-6);
  const tmax = Math.max(1, ...last6.map(x => Math.max(d.byMonth[x].inc, d.byMonth[x].exp)));
  const partial = idx === 0 || idx === d.months.length - 1;
  const lump = cur.cats[CARD_CAT] > 0;
  const H = health(d), rev = review(d, m);
  const other = d.items.filter(t => ym(t.date) === m && t.cat === 'אחר' && t.kind === 'exp');
  const otherSum = other.reduce((a, t) => a - t.amount, 0);
  const dot = c => `<i class="dot ${c}"></i>`;
  const rateC = H && H.rate != null ? (H.rate >= 0.2 ? 'g' : H.rate >= 0.1 ? 'y' : 'r') : '';
  const runC = H && H.runway != null ? (H.runway >= 3 ? 'g' : H.runway >= 1 ? 'y' : 'r') : '';
  const costC = H ? (H.cost < 300 ? 'g' : H.cost < 1000 ? 'y' : 'r') : '';
  const lumpCards = [...new Set(d.items.filter(t => ym(t.date) === m && t.cat === CARD_CAT && t.kind === 'exp').map(t => (t.desc.match(/\b(\d{4})\b/) || [])[1]).filter(Boolean))];

  return `${reminderBanner()}
  <div class="months">
    <button data-m="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="חודש קודם">›</button>
    <div class="title">${mLabel(m)}</div>
    <button data-m="1" ${idx >= d.months.length - 1 ? 'disabled' : ''} aria-label="חודש הבא">‹</button>
  </div>
  <div class="card hero">
    <div class="label">${free >= 0 ? 'נשאר לך החודש' : 'חרגת החודש'}</div>
    <div class="big ${free >= 0 ? 'pos' : 'neg'}">${money(free)}</div>
    ${partial ? '<div class="muted">חודש חלקי – חסרים נתונים בקצה הטווח</div>' : ''}
  </div>
  <div class="grid2">
    <div class="card stat"><div class="muted">הכנסות</div><div class="num pos">${money(cur.inc)}</div></div>
    <div class="card stat"><div class="muted">הוצאות</div><div class="num neg">${money(cur.exp)}</div>
      ${avgExp != null ? `<div class="muted">ממוצע חודשי: ${money(avgExp)}</div>` : ''}</div>
  </div>
  ${lump ? `<div class="note">💡 "אשראי ללא פירוט"${lumpCards.length ? ' (כרטיס ' + lumpCards.join(', ') + ')' : ''} מופיע כסכום אחד כי אין לו קובץ פירוט עסקאות. אפשר להוריד מהאתר קובץ עסקאות מפורט של הכרטיס ולייבא אותו.</div>` : ''}
  ${other.length ? `<div class="note">🏷️ ${other.length} תנועות (${money(otherSum)}) ללא קטגוריה. <button class="chip" data-other="1">לתיקון</button></div>` : ''}
  <h2>לאן הלך הכסף <span class="muted">· לחץ להגדרת תקציב</span></h2>
  <div class="card">${cats.length ? cats.map(([c, v]) => { const b = S.budgets[c], over = b && v > b; return `
    <div class="bar-row" data-bud="${esc(c)}"><div class="emoji">${CATS[c] || '📦'}</div>
      <div><div>${esc(label(c))}${b ? ` <span class="muted">מתוך ${money(b)}</span>` : ''}</div><div class="track"><div class="fill ${over ? 'over' : ''}" style="width:${Math.min(100, Math.max(3, v / (b ? Math.max(b, v) : max) * 100))}%"></div></div></div>
      <div><b class="${over ? 'neg' : ''}">${money(v)}</b></div></div>`; }).join('') : '<div class="muted">אין הוצאות בחודש הזה</div>'}</div>
  ${rev.length ? `<h2>סקירה חודשית</h2><div class="card"><div class="muted">קטגוריות שחרגו מהממוצע שלך:</div>
    ${rev.map(r => `<div class="bar-row" style="grid-template-columns:28px 1fr auto"><div class="emoji">${CATS[r.c] || '📦'}</div><div>${esc(label(r.c))}</div><div><b class="neg">+${money(r.diff)}</b>${r.pct != null && r.pct <= 500 ? ` <span class="muted">(${r.pct}%+)</span>` : ''}</div></div>`).join('')}
    <div class="muted" style="margin-top:6px">שאל את עצמך: האם זה חד-פעמי או הרגל שנוצר?</div></div>` : ''}
  ${H ? `<h2>מצב פיננסי</h2><div class="card health">
    ${H.rate != null ? `<div class="hrow">${dot(rateC)}<div class="grow"><b>שיעור חיסכון: ${Math.round(H.rate * 100)}%</b><div class="muted">${H.rate >= 0.2 ? 'מצוין – 20% ומעלה.' : H.rate >= 0.1 ? 'סביר. היעד המקובל הוא 20%.' : H.rate >= 0 ? 'נמוך. כדאי לחפש דליפות בכלים.' : 'ההוצאות גבוהות מההכנסות בממוצע.'}</div></div></div>` : ''}
    ${H.runway != null ? `<div class="hrow">${dot(runC)}<div class="grow"><b>כרית ביטחון: ${H.runway.toFixed(1)} חודשי הוצאה</b><div class="muted">${money(H.liquid)} בעו"ש הזה. חיסכון וחשבונות אחרים לא נספרים. מקובל 3–6 חודשים.</div></div></div>` : ''}
    <div class="hrow">${dot(costC)}<div class="grow"><b>ריבית ועמלות ב-12 חודשים: ${money(H.cost)}</b><div class="muted">${H.cost < 300 ? 'נמוך, יופי.' : 'אפשר להוריד: הקטן מסגרת אוברדרפט ובדוק פטור מעמלות.'}</div></div></div>
  </div>` : ''}
  <h2>6 חודשים אחרונים</h2>
  <div class="card"><div class="trend">${last6.map(x => `
    <div class="col ${x === m ? 'sel' : ''}" data-pick="${x}"><div class="pair">
      <div class="b i" style="height:${d.byMonth[x].inc / tmax * 100}%"></div>
      <div class="b e" style="height:${d.byMonth[x].exp / tmax * 100}%"></div></div>
      <div class="m">${mShort(x)}</div></div>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--pos)"></i>הכנסות</span><span><i style="background:var(--neg)"></i>הוצאות</span></div></div>`;
}

function txRow(t) {
  const sign = t.amount > 0 ? '+' : '';
  const name = t.src === 'manual' ? '✍️ ' + t.desc : t.desc;
  return `<button class="tx ${t.kind === 'int' ? 'int' : ''}" data-id="${esc(t.id)}">
    <div class="emoji">${CATS[t.cat] || '📦'}</div>
    <div class="grow"><div class="name">${esc(name)}</div><div class="sub">${esc(label(t.cat))}${t.kind === 'int' ? ' · לא נספר' : ''}</div></div>
    <div class="amt ${t.amount > 0 ? 'pos' : ''}">${sign}${money(t.amount)}</div></button>`;
}

function viewTxns() {
  const d = derived(), m = curMonth();
  if (!m) return `<h1>תנועות</h1>${emptyState()}`;
  const idx = d.months.indexOf(m);
  let list = d.items.filter(t => ym(t.date) === m);
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
  return `<div class="months">
    <button data-m="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="חודש קודם">›</button><div class="title">${mLabel(m)}</div>
    <button data-m="1" ${idx >= d.months.length - 1 ? 'disabled' : ''} aria-label="חודש הבא">‹</button></div>
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
    <input type="file" id="file" accept=".xlsx,.xls" multiple hidden>
    <div class="muted" style="margin-top:10px">${last}</div>
  </div>
  <div id="importResult"></div>
  <h2>איך מורידים?</h2>
  <div class="card">
    <ol class="steps">
      <li><b>עו"ש:</b> באתר/אפליקציית דיסקונט ← עובר ושב ← ייצוא לאקסל.</li>
      <li><b>אשראי:</b> כרטיסי אשראי ← פירוט עסקאות ← ייצוא לאקסל.</li>
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
    ${d.months.length ? `<table class="t"><tr><th></th><th class="n">הכנסות</th><th class="n">הוצאות</th><th class="n">נשאר</th></tr>
    ${[...d.months].reverse().map(x => { const b = d.byMonth[x], f = b.inc - b.exp; return `<tr><td>${mShort(x)} ${x.slice(2, 4)}${fullMonths(d).includes(x) ? '' : '*'}</td><td class="n">${money(b.inc)}</td><td class="n">${money(b.exp)}</td><td class="n ${f >= 0 ? 'pos' : 'neg'}"><b>${money(f)}</b></td></tr>`; }).join('')}</table>
    <p class="muted">* חודש חלקי – חסרים נתונים בקצה הטווח.</p>` : '<p class="muted">אין נתונים.</p>'}
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
    <p class="muted">${S.txns.length} תנועות שמורות${storageOk ? '' : ' · ⚠️ השמירה במכשיר נכשלה'}</p>
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
  const r = $('#rate'); if (r) r.addEventListener('change', () => { S.settings.rate = parseFloat(r.value) || 0; save(); const o = document.querySelectorAll('details'); const open = [...o].map(x => x.open); render(); document.querySelectorAll('details').forEach((x, i) => x.open = open[i]); });
  document.querySelectorAll('[data-ck]').forEach(c => c.addEventListener('change', () => {
    S.checks[c.dataset.ck] = c.checked; save(); c.closest('.check').classList.toggle('done', c.checked);
  }));
  $('#bk').onclick = () => {
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cashflow-backup-${todayISO()}.json`; a.click();
    toast('הגיבוי נשמר');
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
    for (const x of S.txns) if (x.id === id || (all && key && norm(x.desc) === key)) x.cat = pick;
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
    selMonth = ym(date); save(); closeSheet(); render(); toast('נוסף');
  };
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-tab],[data-go],[data-m],[data-pick],[data-kind],[data-id],[data-bud],[data-other],#pick,#fab,.sheet-bg');
  if (!el) return;
  if (el.dataset.tab) { tab = el.dataset.tab; render(); scrollTo(0, 0); }
  else if (el.dataset.go) { tab = el.dataset.go; render(); scrollTo(0, 0); }
  else if (el.dataset.m) { const d = derived(), i = d.months.indexOf(curMonth()) + (+el.dataset.m); if (d.months[i]) { selMonth = d.months[i]; render(); } }
  else if (el.dataset.pick) { selMonth = el.dataset.pick; render(); }
  else if (el.dataset.kind) { filter.kind = el.dataset.kind; render(); }
  else if (el.dataset.id) editTx(el.dataset.id);
  else if (el.dataset.bud) setBudget(el.dataset.bud);
  else if (el.dataset.other) { filter.kind = 'other'; tab = 'txns'; render(); scrollTo(0, 0); }
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
        <p><button class="btn block" data-go="home">לצפייה בסיכום</button></p></div>`;
      f.value = '';
    }; f.click(); }
  else if (el.id === 'fab') addTx();
  else if (el.classList.contains('sheet-bg')) closeSheet();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
  navigator.serviceWorker.register('sw.js').catch(() => {});
render();
