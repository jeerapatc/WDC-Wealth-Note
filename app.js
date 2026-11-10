(function () {
'use strict';

/* ================= ตั้งค่า ================= */
// ใส่ลิงก์รับรายชื่อ (เช่น Google Apps Script Web App) ที่นี่ ถ้าเว้นว่าง แอปจะไม่ส่งข้อมูลไปไหน
const CONFIG = { LEAD_ENDPOINT: '' };
const CONSENT_VERSION = 'v1-2026-11';
const KEY = 'wealthnote.v1';

const TH_M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_D = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const GRP = { need: 'จำเป็น', want: 'อยากได้', save: 'ออม' };
const TARGET = { need: 50, want: 30, save: 20 };
const GCOL = {
  need: ['#336667', '#4F8587', '#6FA3A4', '#2A5455', '#95BFBF', '#B9D6D6'],
  want: ['#AD9466', '#8C7545', '#C4AE86', '#7A6538', '#D6C6A5', '#9C8452', '#BBA474', '#CFBE98', '#E6DCC4'],
  save: ['#2F7D5B', '#7FB69B', '#1F5E43']
};

// หมวดรายจ่าย: id, ชื่อ, กลุ่ม 50/30/20 (ผู้ใช้แก้กลุ่มและซ่อนหมวดได้ในตั้งค่า)
const DEFAULT_EXP = [
  ['food', 'อาหาร', 'need', '🍚'], ['clothes', 'เสื้อผ้า', 'need', '👕'], ['travel', 'เดินทาง', 'need', '🚌'],
  ['home', 'ที่อยู่อาศัย', 'need', '🏠'], ['health', 'ค่ายาและการรักษา', 'need', '💊'], ['insurance', 'ประกัน', 'need', '🛡️'],
  ['saving', 'เงินออม', 'save', '💰'], ['invest', 'ลงทุน', 'save', '📈'],
  ['social', 'สังสรรค์', 'want', '🍻'], ['shop', 'ช้อปปิ้ง', 'want', '🛍️'], ['sub', 'Subscription', 'want', '📱'],
  ['care', 'ดูแลตัวเอง', 'want', '💆'], ['gift', 'ของขวัญ/ให้ผู้อื่น', 'want', '🎁'],
  ['exercise', 'ออกกำลังกาย', 'want', '🏃'], ['trip', 'ท่องเที่ยว', 'want', '✈️']
];
const INC_ICONS = { salary: '💼', side: '💻', gift: '🎁', invret: '📈', other: '✨' };
const incomeDefaults = mode => [
  { id: 'salary', name: mode === 'student' ? 'ค่าขนม' : 'เงินเดือน' },
  { id: 'side', name: 'งานเสริม' },
  { id: 'gift', name: 'ของขวัญ/ครอบครัว' },
  { id: 'invret', name: 'ผลตอบแทนลงทุน' },
  { id: 'other', name: 'อื่นๆ' }
].map(c => ({ id: c.id, name: c.name, icon: c.id === 'salary' && mode === 'student' ? '👛' : INC_ICONS[c.id], hidden: false }));

/* ================= อัตราส่วนการเงิน ================= */
// เงินสด/เงินฝากตอนนี้ = ยอดที่ผู้ใช้กรอก + รายรับ - รายจ่าย ที่บันทึกหลังจากนั้น (หมวด saving ยังอยู่ในเงินฝาก, หมวดอื่นถือว่าออกจากเงินสด)
// รายจ่ายเฉลี่ยต่อเดือนจากรายการที่บันทึก (ไม่รวมออม/ลงทุน): เฉลี่ยสูงสุด 3 เดือนที่ผ่านมา ถ้ายังไม่มีใช้เดือนนี้
function autoAvgInfo() {
  const now = new Date();
  const living = (y, m) => monthTx(y, m).filter(t => t.type === 'expense' && groupOf(t.cat) !== 'save').reduce((x, t) => x + t.amount, 0);
  let vals = [1, 2, 3].map(i => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return living(d.getFullYear(), d.getMonth()); }).filter(v => v > 0);
  let basis = vals.length > 1 ? 'เฉลี่ย ' + vals.length + ' เดือนที่ผ่านมา' : 'เดือนที่ผ่านมา';
  if (!vals.length) { const c = living(now.getFullYear(), now.getMonth()); if (c > 0) { vals = [c]; basis = 'เดือนนี้'; } }
  if (!vals.length) return null;
  return { avg: vals.reduce((x, v) => x + v, 0) / vals.length, basis };
}
function emergencyInfo() {
  if (!S.cash) return null;
  const a = S.cash, td = today();
  let cash = a.amt;
  S.tx.forEach(t => {
    if (t.date > td) return;
    const after = t.ts ? t.ts > a.ts : t.date > a.date;
    if (!after) return;
    if (t.type === 'income') cash += t.amount; else if (t.cat !== 'saving') cash -= t.amount;
  });
  const au = autoAvgInfo(), manual = S.avgExp > 0 ? S.avgExp : 0;
  let avg = null, basis = '';
  if (au && !(S.avgMode === 'manual' && manual)) { avg = au.avg; basis = au.basis; }
  else if (manual) { avg = manual; basis = 'กำหนดเอง'; }
  if (!avg) return { cash, avg: null };
  return { cash, avg, months: Math.max(0, cash) / avg, basis };
}
// เกณฑ์เงินสำรองฉุกเฉินตามที่ WDC กำหนด: ต่ำกว่า 3 เดือน = แย่, 3 ถึงต่ำกว่า 6 = พอใช้, 6-12 = ดี, เกิน 12 = แย่
function emStatus(m) {
  if (m < 3) return ['bad', 'ควรเสริม'];
  if (m < 6) return ['ok', 'พอใช้'];
  if (m <= 12) return ['good', 'ดี'];
  return ['bad', 'เกิน 12 เดือน'];
}
// รายจ่าย (จำเป็น+อยากได้) ต่อรายรับ ตามกรอบ 50/30/20: ไม่เกิน 80% = ดี, 80-100% = ระวัง, เกิน 100% = ใช้เกินรายได้
function exStatus(p) {
  if (p <= 80) return ['good', 'ดี'];
  if (p <= 100) return ['ok', 'ระวัง'];
  return ['bad', 'เกินรายได้'];
}
function ratioCard(r) {
  const row = (label, sub, val, st, crit) => `<div class="rt"><div class="rt-l"><b>${label}</b><small>${sub}</small></div><div class="rt-r"><span class="rt-v st-${st[0]}">${val}</span>${st[1] ? `<span class="rt-s st-${st[0]}">${st[1]}</span>` : ''}</div>${crit ? `<div class="rt-c">${crit}</div>` : ''}</div>`;
  let html = '';
  if (r.inc > 0) {
    const sv = Math.round(r.grp.save / r.inc * 100);
    html += row('อัตราออม', 'เงินออม + ลงทุน ÷ รายรับ', sv + '%', ['none', ''], '(เป้า 20% ตามกรอบ 50/30/20)');
    const p = Math.round((r.grp.need + r.grp.want) / r.inc * 100);
    html += row('รายจ่ายต่อรายรับ', 'ไม่รวมออมและลงทุน', p + '%', exStatus(p), '(ดี ไม่เกิน 80% ระวัง 80 ถึง 100%)');
  } else html += '<div class="empty">ใส่รายรับก่อน ถึงจะคำนวณอัตราออมและรายจ่ายต่อรายรับได้</div>';
  const e = emergencyInfo();
  if (!e) html += `<div class="rt"><div class="rt-l"><b>เงินสำรองฉุกเฉิน</b><small>ใส่เงินสด/เงินฝากของคุณ เพื่อดูว่าเพียงพอกี่เดือน</small></div><button class="btn ghost sm" data-act="cashset">ใส่ยอดเงิน</button></div>`;
  else if (!e.avg) html += `<div class="rt"><div class="rt-l"><b>เงินสำรองฉุกเฉิน</b><small>มีเงิน ${money(e.cash)} ใส่รายจ่ายเฉลี่ยต่อเดือนเอง ไปก่อนได้</small></div><button class="btn ghost sm" data-act="cashset">ใส่ยอด</button></div>`;
  else {
    const m = Math.round(e.months * 10) / 10;
    html += row('เงินสำรองฉุกเฉิน', `${money(e.cash)} ÷ ${money(e.avg)} ต่อเดือน (${e.basis})`, m + ' เดือน', emStatus(e.months), '(ดี 6-12 เดือน พอใช้ 3-5 เดือน ต่ำกว่า 3 หรือเกิน 12 ควรปรับ)');
    html += `<button class="chip" data-act="cashset" style="margin-top:6px">แก้ไขยอดเงินสด/เงินฝาก</button>`;
  }
  return html;
}

/* ================= ข้อความแนะนำสไตล์ WDC ================= */
const TIPS = [
  ['🧱', 'เริ่มจากรากฐาน เงินสำรองฉุกเฉินช่วยให้แผนอื่นๆ มั่นคงขึ้น'],
  ['🧺', 'กระจายความเสี่ยง ไข่หลายใบในหลายตะกร้า ช่วยให้อุ่นใจกว่า'],
  ['🔍', 'จดรายรับ-รายจ่ายไปเรื่อยๆ แล้วคุณจะรู้นิสัยการใช้เงินของตัวเอง'],
  ['🛡️', 'ประกันมีไว้รับมือความเสี่ยงร้ายแรงที่เงินเก็บรับไม่ไหว'],
  ['🌙', 'ดูแลสุขภาพและพักผ่อนให้เพียงพอ สุขภาพคือสินทรัพย์ที่ซื้อคืนไม่ได้'],
  ['✋', 'ก่อนกดจ่าย ลองหยุดคิดสักนิด เงินจะไปอยู่กับสิ่งที่สำคัญจริงๆ'],
  ['🌱', 'สร้างรายได้หลายทาง ไม่ต้องพึ่งทางเดียว'],
  ['⏳', 'แบ่งเงินตามเวลาที่ต้องใช้ เงินระยะสั้นเหมาะกับที่ที่ไม่ผันผวนมาก'],
  ['😴', 'เงินที่นอนเฉยๆ คือ "เงินขี้เกียจ" ลองให้เงินได้ทำงานตามเป้าหมายของมัน'],
  ['💰', 'ลองแบ่งเงินออมไว้ตั้งแต่ต้นเดือน แล้วที่เหลือใช้ได้อย่างสบายใจ'],
  ['🎯', 'ให้เงินแต่ละก้อนมีหน้าที่ มีเป้าหมายที่ชัดเจนว่าเก็บไปเพื่ออะไร'],
  ['🐢', 'สม่ำเสมอสำคัญกว่าจำนวนมาก เริ่มน้อยแต่ไม่หยุด'],
  ['🕐', 'ของที่อยากได้ ลองรอ 24 ชั่วโมง ถ้ายังอยากได้อยู่ก็ซื้ออย่างสบายใจ'],
  ['📈', 'ยิ่งเริ่มเร็ว ดอกเบี้ยทบต้นยิ่งช่วยคุณได้นาน'],
  ['⚖️', 'ก่อนลงทุน ลองรู้ก่อนว่ารับความเสี่ยงได้แค่ไหน และเงินก้อนนี้จะใช้เมื่อไร'],
  ['🔗', 'หนี้ดอกเบี้ยแพง ถ้าปิดได้ก่อน จะมีเงินเหลือไปสร้างอนาคตมากขึ้น'],
  ['🚀', 'เมื่อรายได้เพิ่ม ลองเพิ่มเงินออมตามไปด้วย อนาคตจะเติบโตไปพร้อมกัน'],
  ['🧭', 'การเงินที่ดีเริ่มจากรู้ว่าเงินไปไหน แล้วค่อยออกแบบว่าอยากให้ไปไหน']
];
const MILESTONES = { 3: '🎉 ครบ 3 วัน นิสัยดีๆ เริ่มก่อตัวแล้ว', 7: '🏅 ครบ 7 วัน ต่อเนื่องได้ทั้งสัปดาห์ เก่งมาก', 14: '🏆 ครบ 14 วัน สองสัปดาห์เต็ม', 30: '👑 ครบ 30 วัน คุณสร้างนิสัยทางการเงินได้แล้ว' };
let tipIdx = -1;
function nextTip(avoid) {
  let i;
  do { i = Math.floor(Math.random() * TIPS.length); } while (TIPS.length > 1 && i === avoid);
  return i;
}
const addDays = (str, n) => { const [y, m, d] = str.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const TH_DAYF = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/* ================= ตัวช่วย ================= */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate(); // m เริ่มที่ 0
const r2 = n => Math.round(n * 100) / 100;
const money = n => r2(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function compact(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}
function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return d + ' ' + TH_MS[m - 1] + ' ' + (y + 543);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 1800);
}

/* ================= ข้อมูล ================= */
let mem = null;
const fresh = () => ({
  v: 1, mig: 6, profile: null, cash: null, planInc: null, avgExp: null, avgMode: 'auto', budOn: {},
  expCats: DEFAULT_EXP.map(([id, name, group, icon]) => ({ id, name, group, icon, hidden: false })),
  incCats: [], tx: [], budgets: {}, recurring: [], logDays: [], skipKeys: []
});
function load() {
  try {
    const r = localStorage.getItem(KEY);
    if (r) { const o = JSON.parse(r); if (o && o.v === 1) return migrate(o); }
  } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  return mem || fresh();
}
function migrate(o) {
  if (o.mig >= 6) return o;
  if (!(o.mig >= 5)) migrate5(o);
  if (!o.budOn) o.budOn = {};
  o.mig = 6;
  return o;
}
function migrate5(o) {
  if (!(o.mig >= 4)) migrate4(o);
  if (o.planInc === undefined) o.planInc = null;
  if (o.avgExp === undefined) o.avgExp = null;
  if (!o.avgMode) o.avgMode = 'auto';
  o.mig = 5;
  return o;
}
function migrate4(o) {
  if (!(o.mig >= 3)) migrate3(o);
  if (o.cash === undefined) o.cash = null;
  o.mig = 4;
  return o;
}
function migrate3(o) {
  if (o.mig >= 3) return o;
  if (!(o.mig >= 2)) migrate2(o);
  const wi = o.expCats.findIndex(c => c.id === 'wellness');
  if (wi >= 0) {
    if ((o.tx || []).some(t => t.cat === 'wellness')) o.expCats[wi].hidden = true;
    else { o.expCats.splice(wi, 1); if (o.budgets) delete o.budgets.wellness; }
  }
  o.mig = 3;
  return o;
}
function migrate2(o) {
  const ic = {};
  DEFAULT_EXP.forEach(c => { ic[c[0]] = c[3]; });
  (o.expCats || []).forEach(c => { if (!c.icon) c.icon = ic[c.id] || '🏷️'; });
  (o.incCats || []).forEach(c => { if (!c.icon) c.icon = INC_ICONS[c.id] || '🏷️'; });
  const bi = o.expCats.findIndex(c => c.id === 'books');
  if (bi >= 0) {
    if ((o.tx || []).some(t => t.cat === 'books')) o.expCats[bi].hidden = true;
    else { o.expCats.splice(bi, 1); if (o.budgets) delete o.budgets.books; }
  }
  const g = o.expCats.find(c => c.id === 'gift');
  if (g && g.name === 'ของขวัญ') g.name = 'ของขวัญ/ให้ผู้อื่น';
  const moved = ['saving', 'invest'].map(id => o.expCats.find(c => c.id === id)).filter(Boolean);
  if (moved.length) {
    o.expCats = o.expCats.filter(c => c.id !== 'saving' && c.id !== 'invest');
    const ii = o.expCats.findIndex(c => c.id === 'insurance');
    o.expCats.splice(ii >= 0 ? ii + 1 : o.expCats.length, 0, ...moved);
  }
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { mem = S; }
}

const now = new Date();
const ui = {
  tab: 'entry',
  calY: now.getFullYear(), calM: now.getMonth(), calSel: ymd(now),
  repMode: 'month', repY: now.getFullYear(), repM: now.getMonth(),
  budY: now.getFullYear(), budM: now.getMonth(), kp: false, native: false
};
let form = { type: 'expense', cat: '', amount: '', note: '', date: today() };
let reg = { mode: 'worker', name: '', age: '', phone: '', school: '', cash: '', consent: false };
let cashf = { amt: '', avg: '' };
let sheet = null;
let edit = null;
let rec = { type: 'expense', cat: '', amount: '', day: '1', note: '' };
let nc = { name: '', group: 'want', icon: '' };
const B = { reg: () => reg, form: () => form, edit: () => edit, rec: () => rec, nc: () => nc, cashf: () => cashf };

/* ================= คำนวณ ================= */
const catList = type => (type === 'income' ? S.incCats : S.expCats);
const catName = (type, id) => { const c = catList(type).find(x => x.id === id); return c ? c.name : 'ไม่ระบุ'; };
const catIcon = (type, id) => { const c = catList(type).find(x => x.id === id); return (c && c.icon) || '🏷️'; };
const groupOf = id => { const c = S.expCats.find(x => x.id === id); return c ? c.group : 'want'; };

function summarize(txs) {
  const r = { inc: 0, exp: 0, byCat: {}, grp: { need: 0, want: 0, save: 0 } };
  txs.forEach(t => {
    if (t.type === 'income') r.inc += t.amount;
    else {
      r.exp += t.amount;
      r.byCat[t.cat] = (r.byCat[t.cat] || 0) + t.amount;
      r.grp[groupOf(t.cat)] += t.amount;
    }
  });
  return r;
}
const monthTx = (y, m) => S.tx.filter(t => t.date.startsWith(y + '-' + pad(m + 1) + '-'));

function streak() {
  const set = new Set(S.logDays);
  const d = new Date();
  if (!set.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function applyRecurring() {
  const t = today();
  const [cy, cm] = t.slice(0, 7).split('-').map(Number);
  let changed = false;
  S.recurring.forEach(r => {
    let [y, m] = r.start.split('-').map(Number);
    while (y < cy || (y === cy && m <= cm)) {
      const ym = y + '-' + pad(m);
      const key = r.id + ':' + ym;
      const date = ym + '-' + pad(Math.min(r.day, daysIn(y, m - 1)));
      if (date <= t && !S.skipKeys.includes(key) && !S.tx.some(x => x.recurKey === key)) {
        S.tx.push({ id: uid(), type: r.type, cat: r.cat, amount: r.amount, note: r.note || 'รายการประจำ', date, created: date, recurKey: key });
        changed = true;
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  });
  if (changed) save();
}

function submitLead() {
  if (!CONFIG.LEAD_ENDPOINT || !S.profile || S.profile.sent) return;
  const p = S.profile;
  const body = new URLSearchParams({
    timestamp: new Date().toISOString(), mode: p.mode, name: p.name, age: p.age,
    phone: p.phone || '', school: p.school || '', consent: 'yes', consent_version: p.consentVersion
  });
  fetch(CONFIG.LEAD_ENDPOINT, { method: 'POST', mode: 'no-cors', body })
    .then(() => { S.profile.sent = true; save(); })
    .catch(() => { /* ลองใหม่ตอนเปิดแอปครั้งหน้า */ });
}

/* ================= ไอคอน ================= */
const IC = {
  entry: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  rep: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  bud: '<path d="M4 8h16v11H4z"/><path d="M4 8l2-4h12l2 4M15 13.5h2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
};
const svg = k => '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC[k] + '</svg>';

/* ================= หน้าลงทะเบียน ================= */
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (!S.profile) render(); });

function regValid() {
  const age = Number(reg.age);
  if (!(age >= 5 && age <= 100)) return false;
  if (!reg.consent) return false;
  if (reg.mode === 'student') return reg.name.trim().length >= 1 && reg.school.trim().length >= 1;
  return reg.name.trim().length >= 2 && /^0\d{8,9}$/.test(reg.phone.replace(/[\s-]/g, ''));
}
function updateRegBtn() { const b = $('#regbtn'); if (b) b.disabled = !regValid(); }

function installCard() {
  if (isStandalone()) return '';
  if (deferredPrompt) return '<div class="install">ติดตั้งแอปลงเครื่อง เพื่อเปิดจากไอคอนได้เลย<br><button class="btn ghost sm" data-act="install" style="margin-top:8px">ติดตั้งแอป</button></div>';
  if (isIOS()) return '<div class="install"><b>ก่อนเริ่ม:</b> เพิ่มไอคอนลงหน้าจอโฮมก่อน (แตะปุ่มแชร์ใน Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม")<br>ไอคอนคือแอปเดียวกัน แค่เปิดง่ายขึ้น ไม่ต้องเข้า Safari แต่ข้อมูลที่กรอกใน Safari จะไม่ตามมาที่ไอคอน จึงควรเพิ่มไอคอนก่อน แล้วค่อยลงทะเบียน</div>';
  return '<div class="install"><b>ก่อนเริ่ม:</b> เปิดเมนูของเบราว์เซอร์ แล้วเลือก "เพิ่มไปยังหน้าจอหลัก" หรือ "ติดตั้งแอป"</div>';
}

function viewRegister() {
  const st = reg.mode === 'student';
  return `
  <div class="regtop"><img src="assets/logo_teal.png" alt="WDC GROUP"><h1>Wealth Note</h1><p>สมุดรายรับ-รายจ่ายจาก WDC</p></div>
  ${installCard()}
  <div class="seg" role="tablist">
    <button class="${st ? 'on' : ''}" data-act="regmode" data-v="student">นักเรียน</button>
    <button class="${!st ? 'on' : ''}" data-act="regmode" data-v="worker">วัยทำงาน</button>
  </div>
  <label class="f" for="r-name">${st ? 'ชื่อเล่น' : 'ชื่อจริง'}</label>
  <input id="r-name" class="in" data-bind="reg.name" value="${esc(reg.name)}" autocomplete="${st ? 'nickname' : 'given-name'}">
  <label class="f" for="r-age">อายุ (ปี)</label>
  <input id="r-age" class="in" data-bind="reg.age" data-num="1" inputmode="numeric" value="${esc(reg.age)}">
  ${st
    ? `<label class="f" for="r-school">โรงเรียน</label><input id="r-school" class="in" data-bind="reg.school" value="${esc(reg.school)}">`
    : `<label class="f" for="r-phone">เบอร์โทร</label><input id="r-phone" class="in" data-bind="reg.phone" inputmode="tel" autocomplete="tel" value="${esc(reg.phone)}">`}
  <label class="f" for="r-cash">เงินสด/เงินฝากที่มีตอนนี้ (ไม่บังคับ)</label>
  <input id="r-cash" class="in" data-bind="reg.cash" data-num="1" inputmode="decimal" placeholder="ไว้คำนวณเงินสำรองฉุกเฉิน" value="${esc(reg.cash)}">
  <p class="note">ยอดนี้อยู่ในเครื่องคุณเท่านั้น กรอกทีหลังได้</p>
  <div class="why">
    <p><b>เราเก็บ:</b> ${st ? 'ชื่อเล่น อายุ โรงเรียน' : 'ชื่อ อายุ เบอร์โทร'} ไว้ติดต่อกลับเรื่องเกมและแอป และส่งความรู้การเงิน<br><b>เราไม่เก็บ:</b> รายรับ-รายจ่าย งบ หมวด และยอดเงินสดที่คุณจด ทั้งหมดอยู่ในเครื่องคุณเท่านั้น เราไม่เข้าถึง</p>
  </div>
  <div class="consent">
    <input type="checkbox" id="r-ok" data-bind="reg.consent" ${reg.consent ? 'checked' : ''}>
    <label for="r-ok">ฉันยินยอมให้ WDC Group เก็บและใช้ข้อมูลข้างต้นเพื่อติดต่อกลับและส่งความรู้การเงิน และได้อ่าน <button type="button" data-act="policy">นโยบายความเป็นส่วนตัว</button> แล้ว</label>
  </div>
  <button id="regbtn" class="btn" data-act="register" ${regValid() ? '' : 'disabled'}>เริ่มใช้งาน</button>`;
}

function sheetPolicy() {
  const sec = (n, t, body) => `<div class="pol"><h3>${n}. ${t}</h3>${body}</div>`;
  return `
  <div class="panel-h"><h2>นโยบายความเป็นส่วนตัว</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <div class="card">
    ${sec(1, 'ผู้ควบคุมข้อมูลส่วนบุคคล', '<p>WDC Group Co., Ltd. ("WDC Group")</p>')}
    ${sec(2, 'ข้อมูลที่เก็บ', '<ul><li>นักเรียน: ชื่อเล่น อายุ โรงเรียน</li><li>วัยทำงาน: ชื่อ อายุ เบอร์โทร</li><li>วันและเวลาที่คุณให้ความยินยอม</li></ul><p>ไม่เก็บเลขบัตรประชาชนหรือเลขบัญชี</p>')}
    ${sec(3, 'ข้อมูลที่ไม่เก็บ', '<p>รายรับ-รายจ่าย งบประมาณ หมวด และยอดเงินสดที่คุณบันทึกในแอป ข้อมูลเหล่านี้อยู่ในเครื่องของคุณเท่านั้น ไม่ถูกส่งให้ WDC Group</p>')}
    ${sec(4, 'วัตถุประสงค์', '<p>(ก) ติดต่อกลับเรื่องเกมและแอป (ข) ส่งข่าวสารและความรู้ด้านการเงิน เราจะไม่ใช้ข้อมูลเพื่อวัตถุประสงค์อื่น โดยไม่ขอความยินยอมจากคุณก่อน</p>')}
    ${sec(5, 'ฐานทางกฎหมาย', '<p>ความยินยอมของคุณ</p>')}
    ${sec(6, 'การส่งและจัดเก็บข้อมูล', '<p>ข้อมูลลงทะเบียนจะถูกส่งและเก็บรักษาโดย WDC Group ผู้ให้บริการระบบจัดเก็บข้อมูลอาจเก็บข้อมูลบนเซิร์ฟเวอร์ในต่างประเทศ เราจำกัดการเข้าถึงเฉพาะทีมงานที่ได้รับมอบหมาย</p>')}
    ${sec(7, 'ระยะเวลาเก็บรักษา', '<p>ไม่เกิน 2 ปีนับจากวันที่คุณให้ข้อมูล หรือจนกว่าคุณจะขอลบหรือถอนความยินยอม</p>')}
    ${sec(8, 'การเปิดเผยข้อมูล', '<p>เราไม่ขายข้อมูลของคุณ และไม่เปิดเผยให้บุคคลภายนอก ยกเว้นผู้ให้บริการที่ช่วยประมวลผลหรือจัดเก็บข้อมูลตามคำสั่งของเรา หรือกรณีที่กฎหมายกำหนด</p>')}
    ${sec(9, 'สิทธิของคุณ', '<p>คุณมีสิทธิขอเข้าถึงและขอสำเนา แก้ไข ลบหรือทำลาย ระงับการใช้ คัดค้านการประมวลผล ขอให้โอนย้ายข้อมูล และถอนความยินยอมได้ทุกเมื่อ โดยไม่กระทบการประมวลผลที่ทำไปแล้ว หากไม่ให้ข้อมูลหรือถอนความยินยอม คุณอาจไม่ได้รับการติดต่อกลับหรือข่าวสารจากเรา แต่ยังใช้แอปจดรายรับ-รายจ่ายได้ตามปกติ คุณมีสิทธิร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล</p>')}
    ${sec(10, 'ผู้เยาว์', '<p>ผู้ที่อายุต่ำกว่า 20 ปี บางกรณีต้องได้รับความยินยอมจากผู้ปกครองด้วย และผู้ที่อายุต่ำกว่า 10 ปี ต้องให้ผู้ปกครองให้ความยินยอมแทน</p>')}
    ${sec(11, 'ช่องทางติดต่อ', '<p>ติดต่อ WDC Group เพื่อใช้สิทธิผ่านผู้นำเกมของคุณ หรือช่องทางที่บริษัทแจ้งไว้ นโยบายเวอร์ชัน ' + CONSENT_VERSION + ' หากมีการแก้ไข เราจะแจ้งในแอปและขอความยินยอมใหม่เมื่อจำเป็น</p>')}
  </div>`;
}

/* ================= โครงหน้าหลัก ================= */
const TABS = [['entry', 'บันทึก'], ['cal', 'ปฏิทิน'], ['rep', 'รายงาน'], ['bud', 'งบ']];
const TITLES = { entry: 'บันทึก', cal: 'ปฏิทิน', rep: 'รายงาน', bud: 'งบประมาณ' };

/* ---------- แป้นตัวเลขของแอป (หน้าบันทึก) ---------- */
const KP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
function showKp() {
  const r = $('#kp-root'); if (!r) return;
  ui.kp = true;
  r.innerHTML = `<div class="kp" role="group" aria-label="แป้นตัวเลข"><div class="kp-in"><div class="kp-g">${KP_KEYS.map(k => `<button class="kpk" data-act="kp" data-k="${k}" aria-label="${k === '⌫' ? 'ลบ' : k === '.' ? 'จุดทศนิยม' : k}">${k}</button>`).join('')}</div>
    <div class="kp-b"><button class="kpb" data-act="kpnative">พิมพ์เอง</button><button class="kpb" data-act="kpclose">เสร็จ</button><button class="kpb pri" data-act="submit">บันทึก</button></div></div></div>`;
  document.body.classList.add('kpopen');
  const f = $('#f-amt-d'); if (f) { f.classList.add('act'); f.scrollIntoView({ block: 'center' }); }
}
function hideKp() {
  ui.kp = false;
  const r = $('#kp-root'); if (r) r.innerHTML = '';
  document.body.classList.remove('kpopen');
  const f = $('#f-amt-d'); if (f) f.classList.remove('act');
}
function kpPress(k) {
  let v = String(form.amount || '');
  if (k === '⌫') v = v.slice(0, -1);
  else if (k === '.') { if (v.includes('.')) return; v = (v || '0') + '.'; }
  else {
    if (v.includes('.') ? v.split('.')[1].length >= 2 : v.length >= 10) return;
    v = v === '0' ? k : v + k;
  }
  form.amount = v;
  const f = $('#f-amt-d'); if (f) f.innerHTML = v ? esc(v) : '<span class="ph">0</span>';
}
document.addEventListener('click', e => {
  // แตะนอกช่องจำนวนเงินและแป้น: ปิดแป้น
  if (!ui.kp) return;
  if (e.target.closest('.kp') || e.target.closest('#f-amt-d') || e.target.closest('.tile') || e.target.closest('[data-act]')) return;
  hideKp();
});

function render() {
  if (ui.kp && ui.tab !== 'entry') hideKp();
  const app = $('#app');
  if (!S.profile) {
    app.className = 'reg';
    app.innerHTML = viewRegister();
    return;
  }
  app.className = '';
  let body = '';
  if (ui.tab === 'entry') body = viewEntry();
  else if (ui.tab === 'cal') body = viewCal();
  else if (ui.tab === 'rep') body = viewReport();
  else body = viewBudget();
  app.innerHTML = `
  <header class="top"><h1>${TITLES[ui.tab]}</h1>
    <div class="hr"><img class="logo" src="assets/logo_teal.png" alt="WDC GROUP"><button class="gear" data-act="settings" aria-label="ตั้งค่า">${svg('gear')}</button></div>
  </header>
  ${body}
  <nav class="nav"><div class="nav-in">${TABS.map(([k, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${svg(k)}<span>${n}</span></button>`).join('')}</div></nav>`;
  const th = $('.top'); if (th) document.documentElement.style.setProperty('--topH', th.offsetHeight + 'px');
}

/* ---------- หน้า 1: บันทึก ---------- */
function txRow(t) {
  const sign = t.type === 'income' ? '+' : '-';
  return `<button class="row" data-act="edit" data-id="${t.id}">
    <span class="ico">${catIcon(t.type, t.cat)}</span><span class="r-main"><b>${esc(catName(t.type, t.cat))}</b>${t.note ? `<small>${esc(t.note)}</small>` : ''}</span>
    <span class="amt ${t.type === 'income' ? 'inc' : 'exp'}">${sign}${money(t.amount)}</span></button>`;
}
function bannerHTML(mm) {
  const n = streak();
  const loggedToday = S.logDays.includes(today());
  if (tipIdx < 0) {
    // เลือกข้อความที่เข้ากับสถานการณ์ก่อน ถ้าไม่เข้าเงื่อนไขใดให้สุ่ม
    if (mm.inc > 0 && mm.grp.save / mm.inc < 0.1) tipIdx = 9;
    else tipIdx = nextTip(-1);
  }
  const line1 = n === 0 ? '✍️ เริ่มบันทึกวันนี้ได้เลย'
    : (loggedToday ? `🔥 บันทึกต่อเนื่อง ${n} วัน` : `🔥 ต่อเนื่อง ${n} วัน วันนี้ยังไม่ได้บันทึก`);
  const ms = loggedToday && MILESTONES[n] ? `<div class="b2">${MILESTONES[n]}</div>` : '';
  const t = TIPS[tipIdx];
  return `<div class="banner" data-act="tip" role="button" tabindex="0" aria-label="แตะเพื่อดูข้อความอื่น"><div class="b1">${line1}</div>${ms}<div class="b2">${t[0]} ${t[1]}</div></div>`;
}

function viewEntry() {
  const cats = catList(form.type).filter(c => !c.hidden);
  const list = S.tx.filter(t => t.date === form.date).slice().reverse();
  const sm = summarize(list);
  const cur = new Date();
  const mm = summarize(monthTx(cur.getFullYear(), cur.getMonth()));
  const left = mm.inc - mm.exp;
  const td = today();
  const dnote = form.date === td ? '' : `<div class="dnote">${form.date < td ? 'กำลังบันทึกย้อนหลัง' : 'กำลังบันทึกล่วงหน้า'} <button class="chip" data-act="dtoday">กลับมาวันนี้</button></div>`;
  return `
  <div class="hero">
    <small>คงเหลือเดือนนี้ (${TH_M[cur.getMonth()]} ${cur.getFullYear() + 543})</small>
    <b>${money(left)}</b>
    <div class="hero-r"><span>รายรับ <b>${money(mm.inc)}</b></span><span>รายจ่าย <b>${money(mm.exp)}</b></span></div>
  </div>
  ${bannerHTML(mm)}
  <div class="seg inc" role="tablist">
    <button class="${form.type === 'expense' ? 'on' : ''}" data-act="ftype" data-v="expense">รายจ่าย</button>
    <button class="${form.type === 'income' ? 'on' : ''}" data-act="ftype" data-v="income">รายรับ</button>
  </div>
  <label class="f" for="f-date">วันที่</label>
  <div class="dstep"><button data-act="dprev" aria-label="วันก่อนหน้า">‹</button><input id="f-date" type="date" class="in" data-bind="form.date" data-rerender="1" value="${form.date}"><button data-act="dnext" aria-label="วันถัดไป">›</button></div>
  ${dnote}
  <label class="f" for="f-note">โน้ต (ไม่บังคับ)</label>
  <input id="f-note" class="in" data-bind="form.note" placeholder="เช่น ข้าวมันไก่" value="${esc(form.note)}" maxlength="80">
  <label class="f" for="f-amt">จำนวนเงิน (บาท)</label>
  ${ui.native
    ? `<input id="f-amt" class="in" data-bind="form.amount" data-num="1" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(form.amount)}"><button class="chip" data-act="kpapp" style="margin-top:6px">ใช้แป้นตัวเลขของแอป</button>`
    : `<div id="f-amt-d" class="in amtd ${ui.kp ? 'act' : ''}" data-act="kpopen" role="button" tabindex="0" aria-label="จำนวนเงิน แตะเพื่อกรอก">${form.amount ? esc(form.amount) : '<span class="ph">0</span>'}</div>`}
  <label class="f">หมวด</label>
  <div class="tiles">${cats.map(c => `<button class="tile ${form.cat === c.id ? 'sel' : ''} ${form.type}" data-act="pickcat" data-id="${c.id}"><span class="ti">${c.icon || '🏷️'}</span><span>${esc(c.name)}</span></button>`).join('')}<button class="tile add" data-act="newcat"><span class="ti">➕</span><span>เพิ่มหมวดเอง</span></button></div>
  <div class="stickysave"><button class="btn" data-act="submit">บันทึก</button></div>
  <div class="dayhead"><span class="sec" style="margin:0">รายการวันที่ ${fmtDate(form.date)}</span>
    <small>${list.length ? (sm.inc ? `รับ ${money(sm.inc)} ` : '') + (sm.exp ? `จ่าย ${money(sm.exp)}` : '') : ''}</small></div>
  <div class="list">${list.length ? list.map(txRow).join('') : '<div class="empty">ยังไม่มีรายการในวันนี้</div>'}</div>`;
}

/* ---------- หน้า 2: ปฏิทิน ---------- */
function setCalMonth(y, m) {
  ui.calY = y; ui.calM = m;
  const d = new Date();
  ui.calSel = (y === d.getFullYear() && m === d.getMonth()) ? ymd(d) : y + '-' + pad(m + 1) + '-01';
}
function fullNum(n) {
  n = Math.round(n);
  return n >= 1e6 ? compact(n) : n.toLocaleString('en-US');
}
function viewCal() {
  const y = ui.calY, m = ui.calM;
  const map = {};
  S.tx.forEach(t => {
    const o = map[t.date] || (map[t.date] = { i: 0, e: 0 });
    if (t.type === 'income') o.i += t.amount; else o.e += t.amount;
  });
  const first = (new Date(y, m, 1).getDay() + 6) % 7; // จันทร์ = 0
  const n = daysIn(y, m);
  const total = Math.ceil((first + n) / 7) * 7;
  const td = today();
  const head = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map((d, i) => `<div class="dow ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${d}</div>`).join('');
  let cells = '';
  for (let i = 0; i < total; i++) {
    const dt = new Date(y, m, 1 - first + i);
    const key = ymd(dt);
    const o = map[key];
    const out = dt.getMonth() !== m;
    cells += `<button class="cell ${out ? 'out' : ''} ${key === td ? 'today' : ''} ${key === ui.calSel ? 'sel' : ''}" data-act="selday" data-date="${key}">
      <span class="dn">${dt.getDate()}</span>${o && o.i ? `<span class="ci">${fullNum(o.i)}</span>` : ''}${o && o.e ? `<span class="ce">${fullNum(o.e)}</span>` : ''}</button>`;
  }
  const mp = y + '-' + pad(m + 1) + '-';
  let inc = 0, exp = 0, prev = 0;
  S.tx.forEach(t => {
    const v = t.type === 'income' ? t.amount : -t.amount;
    if (t.date.startsWith(mp)) { if (t.type === 'income') inc += t.amount; else exp += t.amount; }
    else if (t.date < mp + '01') prev += v;
  });
  const bal = inc - exp;
  const sel = ui.calSel;
  const isCur = y === new Date().getFullYear() && m === new Date().getMonth();
  // รายการ: วันที่เลือกก่อน (แม้ไม่มีรายการ) แล้วตามด้วยวันก่อนหน้าในเดือนเดียวกันที่มีรายการ เรียงใหม่→เก่า
  const dayKeys = [sel];
  Object.keys(map).filter(k => k.startsWith(mp) && k < sel).sort().reverse().forEach(k => dayKeys.push(k));
  const sections = dayKeys.map(key => {
    const [sy, sm2, sd] = key.split('-').map(Number);
    const list = S.tx.filter(t => t.date === key).slice().reverse();
    const ds = summarize(list), net = ds.inc - ds.exp;
    return `<div class="dayhead calday ${key === sel ? 'cur' : ''}"><span><b>${sd} ${TH_MS[sm2 - 1]} ${sy + 543}</b> <small>(${TH_DAYF[new Date(sy, sm2 - 1, sd).getDay()]})</small></span>
      <span class="dh-r"><b class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${net ? (net > 0 ? '+' : '') + money(net) : ''}</b>${key === sel ? '<button class="chip" data-act="addday">+ เพิ่ม</button>' : ''}</span></div>
      <div class="list">${list.length ? list.map(txRow).join('') : '<div class="empty">ยังไม่มีรายการในวันนี้</div>'}</div>`;
  }).join('');
  return `
  <div class="calfix">
  <div class="mnav"><button data-act="calprev" aria-label="เดือนก่อน">‹</button>
    <div class="mtitle"><b>${TH_M[m]} ${y + 543}</b><small>(1 - ${n} ${TH_MS[m]})${isCur ? '' : ' <button class="chip" data-act="caltoday">ไปเดือนนี้</button>'}</small></div>
    <button data-act="calnext" aria-label="เดือนถัดไป">›</button></div>
  <div class="cal">${head}${cells}</div>
  <div class="sum3" style="margin-top:8px">
    <div><small>รายรับ</small><b class="inc">${money(inc)}</b></div>
    <div><small>รายจ่าย</small><b class="exp">${money(exp)}</b></div>
    <div><small>รวม</small><b class="${bal < 0 ? 'neg' : 'pos'}">${bal > 0 ? '+' : ''}${money(bal)}</b></div>
  </div>
  <div class="sum2">
    <div><small>ยอดยกมา</small><b class="${prev < 0 ? 'neg' : ''}">${money(prev)}</b></div>
    <div><small>คงเหลือสะสม</small><b class="${prev + bal < 0 ? 'neg' : 'pos'}">${money(prev + bal)}</b></div>
  </div>
  </div>
  ${sections}`;
}

/* ---------- หน้า 3: รายงาน ---------- */
function colorFor(group, idx) { const a = GCOL[group]; return a[idx % a.length]; }

function donut(slices, total) {
  const R = 70, C = 2 * Math.PI * R;
  let off = 0, s = '';
  slices.forEach(sl => {
    const len = sl.v / total * C;
    const gap = slices.length > 1 ? Math.min(2, len * 0.2) : 0;
    s += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${sl.color}" stroke-width="28" stroke-dasharray="${Math.max(len - gap, 0.1).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 100 100)"><title>${esc(sl.name)} ${money(sl.v)}</title></circle>`;
    off += len;
  });
  return `<svg viewBox="0 0 200 200" width="220" height="220" role="img" aria-label="สัดส่วนรายจ่ายตามหมวด">${s}
    <text x="100" y="94" text-anchor="middle" font-size="12" fill="#5F6F6F">รายจ่ายรวม</text>
    <text x="100" y="116" text-anchor="middle" font-size="19" font-weight="600" fill="#1F2D2D">${money(total)}</text></svg>`;
}

function barsChart(y) {
  const inc = Array(12).fill(0), exp = Array(12).fill(0);
  S.tx.forEach(t => {
    if (!t.date.startsWith(y + '-')) return;
    const m = Number(t.date.slice(5, 7)) - 1;
    if (t.type === 'income') inc[m] += t.amount; else exp[m] += t.amount;
  });
  const max = Math.max(1, ...inc, ...exp);
  const W = 360, H = 170, top = 18, base = 148, ch = base - top, gw = (W - 8) / 12, bw = 10;
  let s = `<text x="4" y="11" font-size="10" fill="#5F6F6F">สูงสุด ${compact(max)} บาท</text><line x1="4" y1="${base}" x2="${W - 4}" y2="${base}" stroke="#E4DFD3"/>`;
  for (let i = 0; i < 12; i++) {
    const x = 4 + i * gw + (gw - bw * 2 - 2) / 2;
    const hi = inc[i] / max * ch, he = exp[i] / max * ch;
    s += `<rect x="${x.toFixed(1)}" y="${(base - hi).toFixed(1)}" width="${bw}" height="${hi.toFixed(1)}" rx="2" fill="#2F7D5B"><title>${TH_MS[i]} รายรับ ${money(inc[i])}</title></rect>`;
    s += `<rect x="${(x + bw + 2).toFixed(1)}" y="${(base - he).toFixed(1)}" width="${bw}" height="${he.toFixed(1)}" rx="2" fill="#B5443F"><title>${TH_MS[i]} รายจ่าย ${money(exp[i])}</title></rect>`;
    s += `<text x="${(4 + i * gw + gw / 2).toFixed(1)}" y="${base + 14}" text-anchor="middle" font-size="8.5" fill="#5F6F6F">${TH_MS[i]}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="รายรับและรายจ่ายรายเดือนในปี ${y + 543}">${s}</svg>
  <div class="key"><span class="k-i">รายรับ</span><span class="k-e">รายจ่าย</span></div>`;
}

function avgCompare(y, m, byCatNow) {
  const yTx = S.tx.filter(t => t.type === 'expense' && t.date.startsWith(y + '-'));
  const months = new Set(yTx.map(t => t.date.slice(5, 7)));
  if (months.size < 2) return '<div class="empty">ต้องมีรายจ่ายอย่างน้อย 2 เดือนในปีนี้ ถึงจะเทียบกับค่าเฉลี่ยได้</div>';
  const tot = {};
  yTx.forEach(t => { tot[t.cat] = (tot[t.cat] || 0) + t.amount; });
  const rows = Object.keys(tot).map(id => {
    const avg = tot[id] / months.size, cur = byCatNow[id] || 0;
    return { id, avg, cur, diff: cur - avg };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return `<div class="cmp"><span class="h">หมวด</span><span class="h n">เดือนนี้ / เฉลี่ย</span><span class="h n">ต่าง</span>
  ${rows.map(r => `<span>${esc(catName('expense', r.id))}</span><span class="n">${money(Math.round(r.cur))} / ${money(Math.round(r.avg))}</span><span class="n ${r.diff > 0 ? 'neg' : 'pos'}">${r.diff > 0 ? '+' : ''}${money(Math.round(r.diff))}</span>`).join('')}</div>
  <p class="note">ค่าเฉลี่ย = รายจ่ายหมวดนั้นทั้งปี หารด้วยจำนวนเดือนที่มีรายจ่าย (${months.size} เดือน) บวก = ใช้มากกว่าเฉลี่ย</p>`;
}

function viewReport() {
  const mode = ui.repMode, y = ui.repY, m = ui.repM;
  const pre = mode === 'month' ? y + '-' + pad(m + 1) + '-' : y + '-';
  const txs = S.tx.filter(t => t.date.startsWith(pre));
  const r = summarize(txs);
  const title = mode === 'month' ? `${TH_M[m]} ${y + 543}` : `ปี ${y + 543}`;

  // สัดส่วนตามหมวด เรียงตามกลุ่ม แล้วตามยอดมาก→น้อย
  const slices = [];
  ['need', 'want', 'save'].forEach(g => {
    Object.keys(r.byCat).filter(id => groupOf(id) === g && r.byCat[id] > 0)
      .sort((a, b) => r.byCat[b] - r.byCat[a])
      .forEach((id, i) => slices.push({ id, name: catName('expense', id), v: r.byCat[id], color: colorFor(g, i), g }));
  });

  const donutBlock = r.exp > 0
    ? `<div class="donutwrap">${donut(slices, r.exp)}</div>
       <div class="legend">${slices.map(s => `<div class="lg"><span class="sw" style="background:${s.color}"></span><span class="nm">${catIcon('expense', s.id)} ${esc(s.name)}</span><span class="pc">${Math.round(s.v / r.exp * 100)}%</span><span class="vl">${money(s.v)}</span></div>`).join('')}</div>`
    : '<div class="empty">ยังไม่มีรายจ่ายในช่วงนี้</div>';

  const g532 = r.inc > 0
    ? ['need', 'want', 'save'].map(g => {
        const pct = r.grp[g] / r.inc * 100;
        return `<div class="g-row"><div class="g-top"><span>${GRP[g]}</span><span><b>${Math.round(pct)}%</b> <small>(เป้า ${TARGET[g]}%)</small></span></div>
          <div class="gbar"><i style="width:${Math.min(pct, 100).toFixed(1)}%"></i><u style="left:calc(${TARGET[g]}% - 1px)"></u></div></div>`;
      }).join('') + '<p class="note">คิดเป็นสัดส่วนของรายรับในช่วงนี้ เส้นทอง = เป้า 50/30/20</p>'
    : '<div class="empty">ใส่รายรับก่อน ถึงจะเทียบกับ 50/30/20 ได้</div>';

  return `
  <div class="seg"><button class="${mode === 'month' ? 'on' : ''}" data-act="repmode" data-v="month">รายเดือน</button><button class="${mode === 'year' ? 'on' : ''}" data-act="repmode" data-v="year">รายปี</button></div>
  <div class="mnav"><button data-act="repprev" aria-label="ก่อนหน้า">‹</button><b>${title}</b><button data-act="repnext" aria-label="ถัดไป">›</button></div>
  <div class="sum3">
    <div><small>รายรับ</small><b class="inc">${money(r.inc)}</b></div>
    <div><small>รายจ่ายรวม</small><b class="exp">${money(r.exp)}</b></div>
    <div><small>คงเหลือ</small><b class="${r.inc - r.exp < 0 ? 'neg' : 'pos'}">${money(r.inc - r.exp)}</b></div>
  </div>
  <h2 class="sec">อัตราส่วนการเงิน</h2><div class="card ratiocard">${ratioCard(r)}</div>
  <h2 class="sec">รายจ่ายตามหมวด</h2><div class="card">${donutBlock}</div>
  <h2 class="sec">เทียบกับ 50/30/20</h2><div class="card">${g532}</div>
  ${mode === 'month'
    ? `<h2 class="sec">เทียบกับค่าเฉลี่ยรายเดือนของปี ${y + 543}</h2><div class="card">${avgCompare(y, m, r.byCat)}</div>`
    : `<h2 class="sec">รายรับ-รายจ่ายทุกเดือน</h2><div class="card">${barsChart(y)}</div>`}`;
}

/* ---------- หน้า 4: งบ ---------- */
// หมวดที่ผู้ใช้ติ๊กว่าจะตั้งงบ (ถ้ายังไม่เคยติ๊ก ใช้ว่ามีงบอยู่แล้วหรือไม่)
const budOn = id => (S.budOn && id in S.budOn) ? !!S.budOn[id] : (S.budgets[id] > 0);
function budgetIncome(y, m) {
  // รายรับที่ผู้ใช้กำหนด > รายรับของเดือนที่ดู > รายรับของเดือนล่าสุดก่อนหน้าที่มีรายรับ (ระบุให้ผู้ใช้เห็น)
  if (S.planInc > 0) return { v: S.planInc, note: 'รายรับที่กำหนด' };
  const cur = summarize(monthTx(y, m)).inc;
  if (cur > 0) return { v: cur, note: 'รายรับเดือนนี้' };
  for (let i = 1; i <= 12; i++) {
    const d = new Date(y, m - i, 1), v = summarize(monthTx(d.getFullYear(), d.getMonth())).inc;
    if (v > 0) return { v, note: 'รายรับ' + TH_MS[d.getMonth()] };
  }
  return { v: 0, note: '' };
}
function viewBudget() {
  const y = ui.budY, m = ui.budM;
  const r = summarize(monthTx(y, m));
  const base = budgetIncome(y, m);
  let totB = 0, totU = 0;
  const catRow = c => {
    if (!budOn(c.id)) return `<div class="brow off"><label class="bchk"><input type="checkbox" data-chg="budtick" data-id="${c.id}" aria-label="ตั้งงบ ${esc(c.name)}"> ${c.icon || '🏷️'} <b>${esc(c.name)}</b></label></div>`;
    const b = S.budgets[c.id] || 0, used = r.byCat[c.id] || 0;
    if (b > 0) { totB += b; totU += used; }
    const pct = b > 0 ? used / b * 100 : 0;
    const isSave = c.group === 'save';
    const cls = isSave ? '' : pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
    const meta = b > 0
      ? `${isSave ? 'ออมแล้ว' : 'ใช้'} ${money(used)} จาก ${money(b)} (${Math.round(pct)}%)${pct > 100 && !isSave ? ` เกิน ${money(used - b)}` : ''}`
      : `ยังไม่ได้ตั้งงบ${used > 0 ? ` (ใช้ไป ${money(used)})` : ''}`;
    return `<div class="brow"><div class="brow-top"><label class="bchk"><input type="checkbox" data-chg="budtick" data-id="${c.id}" checked aria-label="ตั้งงบ ${esc(c.name)}"> ${c.icon || '🏷️'} <b>${esc(c.name)}</b></label>
      <label class="binp"><input inputmode="numeric" data-chg="budget" data-id="${c.id}" value="${b ? b : ''}" placeholder="ตั้งงบ" aria-label="งบต่อเดือน ${esc(c.name)}"> บาท</label></div>
      <div class="bar"><i class="${cls}" style="width:${Math.min(pct, 100).toFixed(1)}%"></i></div><div class="bmeta">${meta}</div></div>`;
  };
  const groups = ['need', 'want', 'save'].map(g => {
    const cs = S.expCats.filter(c => !c.hidden && c.group === g);
    if (!cs.length) return '';
    const gb = cs.reduce((x, c) => x + (budOn(c.id) ? (S.budgets[c.id] || 0) : 0), 0);
    const pct = base.v > 0 ? gb / base.v * 100 : 0;
    const over = g !== 'save' && pct > TARGET[g];
    const head = `<div class="bg-h"><b>${GRP[g]}</b><span>งบ ${money(gb)}</span></div>
      ${base.v > 0 ? `<div class="bg-p"><span class="${over ? 'neg' : ''}"><b>${Math.round(pct)}%</b> ของรายรับ</span><small>เป้า ${TARGET[g]}%</small></div>
      <div class="gbar"><i style="width:${Math.min(pct, 100).toFixed(1)}%"></i><u style="left:calc(${TARGET[g]}% - 1px)"></u></div>` : ''}`;
    return `<div class="bgrp">${head}<div class="card" style="padding-top:2px;padding-bottom:2px;margin-top:8px">${cs.map(catRow).join('')}</div></div>`;
  }).join('');
  return `
  <div class="mnav"><button data-act="budprev" aria-label="เดือนก่อน">‹</button><b>${TH_M[m]} ${y + 543}</b><button data-act="budnext" aria-label="เดือนถัดไป">›</button></div>
  <div class="planrow"><label for="plan-inc">รายรับต่อเดือนที่คาดว่าจะได้</label>
    <span class="binp"><input id="plan-inc" inputmode="numeric" data-chg="planinc" value="${S.planInc > 0 ? S.planInc : ''}" placeholder="ตั้งรายรับ" aria-label="รายรับต่อเดือนที่คาดว่าจะได้"> บาท</span></div>
  <div class="sum3">
    <div><small>งบรวม</small><b>${money(totB)}</b></div>
    <div><small>ใช้ไป</small><b class="exp">${money(totU)}</b></div>
    <div><small>เหลือ</small><b class="${totB - totU < 0 ? 'neg' : 'pos'}">${money(totB - totU)}</b></div>
  </div>
  <p class="note" style="margin:-4px 0 10px">${base.v > 0 ? `% จาก${base.note} ${money(base.v)} เส้นทองคือเป้า` : 'ใส่รายรับที่คาดว่าจะได้ จะเห็น % เทียบเป้า'}</p>
  ${groups}`;
}
const EMOJIS = ['🍚', '🍜', '🍕', '🍔', '🍰', '☕', '🍺', '🛒', '🧴', '👕', '👟', '👜', '🚌', '🚗', '⛽', '🏠', '💡', '📱', '💻', '🎮', '📚', '🎓', '🎬', '🎵', '⚽', '🏋️', '🧘', '💊', '🏥', '🐶', '🐱', '👶', '🎁', '💍', '✈️', '🏖️', '🛠️', '💼', '💰', '📈', '🏦', '🛡️', '🧾', '❤️', '🌿', '⭐', '🎨', '🙂'];
function sheetNewCat() {
  const inc = form.type === 'income';
  return `
  <div class="panel-h"><h2>เพิ่มหมวด${inc ? 'รายรับ' : 'รายจ่าย'}ใหม่</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <label class="f" for="nc-name2">ชื่อหมวด</label>
  <input id="nc-name2" class="in" data-bind="nc.name" placeholder="เช่น ค่าอาหารสัตว์เลี้ยง" value="${esc(nc.name)}" maxlength="30">
  <label class="f">เลือกอิโมจิ</label>
  <div class="emogrid">${EMOJIS.map(e => `<button class="emo ${nc.icon === e ? 'sel' : ''}" data-act="pickemoji" data-e="${e}">${e}</button>`).join('')}</div>
  <label class="f" for="nc-icon">หรือพิมพ์อิโมจิเอง</label>
  <input id="nc-icon" class="in ei" style="width:80px" data-bind="nc.icon" value="${esc(nc.icon)}" maxlength="4" aria-label="อิโมจิ">
  ${inc ? '' : `<label class="f">นับเป็นกลุ่มไหน (ใช้คำนวณ 50/30/20)</label>
  <div class="seg">${['need', 'want', 'save'].map(g => `<button class="${nc.group === g ? 'on' : ''}" data-act="ngroup" data-v="${g}">${GRP[g]}</button>`).join('')}</div>`}
  <button class="btn" data-act="savenewcat">เพิ่มหมวดและเลือกเลย</button>`;
}

/* ================= ชีตแก้ไขรายการ ================= */
function sheetEdit() {
  const list = catList(edit.type).filter(c => !c.hidden || c.id === edit.cat);
  return `
  <div class="panel-h"><h2>แก้ไข${edit.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <label class="f" for="e-note">โน้ต</label>
  <input id="e-note" class="in" data-bind="edit.note" value="${esc(edit.note)}" maxlength="80">
  <label class="f" for="e-amt">จำนวนเงิน (บาท)</label>
  <input id="e-amt" class="in" data-bind="edit.amount" data-num="1" inputmode="decimal" value="${esc(edit.amount)}">
  <label class="f" for="e-cat">หมวด</label>
  <select id="e-cat" class="in" data-bind="edit.cat">${list.map(c => `<option value="${c.id}" ${c.id === edit.cat ? 'selected' : ''}>${c.icon || '🏷️'} ${esc(c.name)}</option>`).join('')}</select>
  <label class="f" for="e-date">วันที่</label>
  <input id="e-date" type="date" class="in" data-bind="edit.date" value="${edit.date}">
  <button class="btn" data-act="editsave">บันทึกการแก้ไข</button>
  <button class="btn ${edit.confirm ? 'danger' : 'ghost'}" data-act="editdel">${edit.confirm ? 'แตะอีกครั้งเพื่อลบ' : 'ลบรายการ'}</button>`;
}

/* ================= ตั้งค่า ================= */
function sheetSettings() {
  const p = sheet.page || 'home';
  const head = (t, back) => `<div class="panel-h"><h2>${t}</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>${back ? '<button class="back" data-act="spage" data-v="home">‹ กลับ</button>' : ''}`;

  if (p === 'home') {
    return head('ตั้งค่า') + `<div class="list">
      <button class="mi" data-act="spage" data-v="exp"><span>หมวดรายจ่าย</span><span>›</span></button>
      <button class="mi" data-act="spage" data-v="inc"><span>หมวดรายรับ</span><span>›</span></button>
      <button class="mi" data-act="spage" data-v="cash"><span>เงินสำรองฉุกเฉิน</span><span>›</span></button>
      <button class="mi" data-act="spage" data-v="rec"><span>รายการประจำ</span><span>›</span></button>
      <button class="mi" data-act="spage" data-v="backup"><span>สำรองและกู้คืนข้อมูล</span><span>›</span></button>
      <button class="mi" data-act="spage" data-v="me"><span>ข้อมูลของฉัน</span><span>›</span></button>
      <button class="mi" data-act="spage" data-v="reset"><span>ล้างข้อมูลทั้งหมด</span><span>›</span></button></div>`;
  }
  if (p === 'exp' || p === 'inc') {
    const isInc = p === 'inc';
    const list = isInc ? S.incCats : S.expCats;
    return head(isInc ? 'หมวดรายรับ' : 'หมวดรายจ่าย', true) + `
    <div class="card" style="padding-top:2px;padding-bottom:2px">${list.map(c => `<div class="crow">
      <input class="in ei" data-chg="caticon" data-id="${c.id}" value="${esc(c.icon || '')}" maxlength="4" aria-label="อิโมจิ">
      <input class="in" data-chg="catname" data-id="${c.id}" value="${esc(c.name)}" aria-label="ชื่อหมวด">
      ${isInc ? '' : `<select class="in" data-chg="catgroup" data-id="${c.id}" aria-label="กลุ่ม">${['need', 'want', 'save'].map(g => `<option value="${g}" ${c.group === g ? 'selected' : ''}>${GRP[g]}</option>`).join('')}</select>`}
      <label><input type="checkbox" data-chg="cathide" data-id="${c.id}" ${c.hidden ? 'checked' : ''}>ซ่อน</label></div>`).join('')}</div>
    <p class="note">หมวดที่ซ่อนจะไม่แสดงตอนบันทึก แต่รายการเก่ายังอยู่ในรายงาน</p>
    <label class="f" for="nc-name">เพิ่มหมวดใหม่</label>
    <div class="row2"><input class="in ei" data-bind="nc.icon" placeholder="🙂" value="${esc(nc.icon)}" maxlength="4" aria-label="อิโมจิ" style="flex:none;width:60px"><input id="nc-name" class="in" data-bind="nc.name" placeholder="ชื่อหมวด" value="${esc(nc.name)}" maxlength="30">
    ${isInc ? '' : `<select class="in" data-bind="nc.group" style="max-width:110px">${['need', 'want', 'save'].map(g => `<option value="${g}" ${nc.group === g ? 'selected' : ''}>${GRP[g]}</option>`).join('')}</select>`}</div>
    <button class="btn" data-act="addcat">เพิ่มหมวด</button>`;
  }
  if (p === 'rec') {
    const cats = catList(rec.type).filter(c => !c.hidden);
    if (!cats.some(c => c.id === rec.cat)) rec.cat = cats[0] ? cats[0].id : '';
    return head('รายการประจำ', true) + `
    <p class="mute" style="margin-bottom:8px">รายการที่เกิดซ้ำทุกเดือน เช่น Subscription แอปจะบันทึกให้เองเมื่อถึงวัน</p>
    <div class="list">${S.recurring.length ? S.recurring.map(r => `<div class="row"><span class="r-main"><b>${esc(catName(r.type, r.cat))}</b><small>ทุกวันที่ ${r.day}${r.note ? ' (' + esc(r.note) + ')' : ''}</small></span>
      <span style="display:flex;align-items:center;gap:8px"><span class="amt ${r.type === 'income' ? 'inc' : 'exp'}">${money(r.amount)}</span><button class="btn ghost sm" data-act="delrec" data-id="${r.id}">ลบ</button></span></div>`).join('') : '<div class="empty">ยังไม่มีรายการประจำ</div>'}</div>
    <h3 class="sec">เพิ่มรายการประจำ</h3>
    <div class="seg"><button class="${rec.type === 'expense' ? 'on' : ''}" data-act="rtype" data-v="expense">รายจ่าย</button><button class="${rec.type === 'income' ? 'on' : ''}" data-act="rtype" data-v="income">รายรับ</button></div>
    <label class="f" for="rc-cat">หมวด</label>
    <select id="rc-cat" class="in" data-bind="rec.cat">${cats.map(c => `<option value="${c.id}" ${c.id === rec.cat ? 'selected' : ''}>${c.icon || '🏷️'} ${esc(c.name)}</option>`).join('')}</select>
    <div class="row2"><div><label class="f" for="rc-amt">จำนวนเงิน (บาท)</label><input id="rc-amt" class="in" data-bind="rec.amount" data-num="1" inputmode="decimal" value="${esc(rec.amount)}"></div>
    <div><label class="f" for="rc-day">ทุกวันที่</label><input id="rc-day" class="in" data-bind="rec.day" data-num="1" inputmode="numeric" value="${esc(rec.day)}"></div></div>
    <label class="f" for="rc-note">โน้ต</label><input id="rc-note" class="in" data-bind="rec.note" value="${esc(rec.note)}" maxlength="80" placeholder="เช่น Netflix">
    <button class="btn" data-act="addrec">เพิ่มรายการประจำ</button>`;
  }
  if (p === 'backup') {
    return head('สำรองและกู้คืนข้อมูล', true) + `
    <p class="mute">ข้อมูลอยู่ในเครื่องนี้ ถ้าเปลี่ยนเครื่องหรือล้างข้อมูลเบราว์เซอร์ ข้อมูลจะหาย ควรกดสำรองเก็บไว้เป็นระยะ</p>
    <button class="btn" data-act="export">สำรองข้อมูล (บันทึกเป็นไฟล์)</button>
    <label class="btn ghost" style="display:block;text-align:center;cursor:pointer;margin-top:10px">กู้คืนจากไฟล์<input type="file" accept="application/json,.json" data-chg="import" hidden></label>
    <p class="note">การกู้คืนจะแทนที่ข้อมูลปัจจุบันทั้งหมด</p>`;
  }
  if (p === 'cash') {
    const e = emergencyInfo(), au = autoAvgInfo();
    return head('เงินสำรองฉุกเฉิน', true) + `
    <p class="mute one">เงินสดและเงินฝากรวม (ไม่รวมลงทุน)</p>
    ${e ? `<div class="card"><small>ยอดปัจจุบันที่แอปคำนวณ</small><br><b style="font-size:20px">${money(e.cash)}</b></div>` : ''}
    <label class="f" for="cash-amt">${e ? 'ยอดจริงตอนนี้ (บาท)' : 'ยอดตอนนี้ (บาท)'}</label>
    <input id="cash-amt" class="in" data-bind="cashf.amt" data-num="1" inputmode="decimal" placeholder="0" value="${esc(cashf.amt)}">
    <label class="f" for="cash-avg">รายจ่ายเฉลี่ยต่อเดือน กำหนดเอง (บาท)</label>
    <input id="cash-avg" class="in" data-bind="cashf.avg" data-num="1" inputmode="decimal" placeholder="0" value="${esc(cashf.avg)}">
    ${au ? `<label class="f">ใช้ค่าไหนคำนวณ</label>
    <div class="seg"><button class="${S.avgMode !== 'manual' || !(S.avgExp > 0) ? 'on' : ''}" data-act="avgmode" data-v="auto">จากที่บันทึก ${money(au.avg)}</button><button class="${S.avgMode === 'manual' && S.avgExp > 0 ? 'on' : ''}" data-act="avgmode" data-v="manual">กำหนดเอง</button></div>` : ''}
    <p class="note two">${au ? 'มีข้อมูลที่บันทึกแล้ว เลือกใช้ค่าเฉลี่ยหรือค่าที่กำหนดเองได้' : 'ยังไม่มีข้อมูล แอปใช้ค่าที่กำหนดเองไปก่อน'}<br>แก้ได้ทุกเมื่อ เก็บในเครื่องเท่านั้น ไม่ส่งให้ WDC</p>
    <button class="btn" data-act="cashsave">บันทึก</button>`;
  }
  if (p === 'me') {
    const pr = S.profile;
    return head('ข้อมูลของฉัน', true) + `<div class="card">
      <p><small>โหมด</small><br>${pr.mode === 'student' ? 'นักเรียน' : 'วัยทำงาน'}</p>
      <p style="margin-top:8px"><small>${pr.mode === 'student' ? 'ชื่อเล่น' : 'ชื่อ'}</small><br>${esc(pr.name)}</p>
      <p style="margin-top:8px"><small>อายุ</small><br>${esc(pr.age)}</p>
      <p style="margin-top:8px"><small>${pr.mode === 'student' ? 'โรงเรียน' : 'เบอร์โทร'}</small><br>${esc(pr.mode === 'student' ? pr.school : pr.phone)}</p>
      <p style="margin-top:8px"><small>สถานะการส่งให้ WDC</small><br>${pr.sent ? 'ส่งแล้ว' : 'ยังไม่ได้ส่ง'}</p></div>`;
  }
  // reset
  return head('ล้างข้อมูลทั้งหมด', true) + `
    <p class="mute">ลบรายการ งบ หมวด และข้อมูลลงทะเบียนในเครื่องนี้ทั้งหมด กู้คืนไม่ได้ ยกเว้นมีไฟล์สำรอง</p>
    <button class="btn ${sheet.confirm ? 'danger' : 'ghost'}" data-act="reset">${sheet.confirm ? 'แตะอีกครั้งเพื่อล้างข้อมูล' : 'ล้างข้อมูลทั้งหมด'}</button>`;
}

/* ================= ชีต (หน้าต่างล่าง) ================= */
function renderSheet() {
  const root = $('#sheet-root');
  if (!sheet) { root.innerHTML = ''; return; }
  const old = $('.panel', root);
  const st = old ? old.scrollTop : 0;
  let html = '';
  if (sheet.kind === 'newcat') html = sheetNewCat();
  else if (sheet.kind === 'edit') html = sheetEdit();
  else if (sheet.kind === 'settings') html = sheetSettings();
  else if (sheet.kind === 'policy') html = sheetPolicy();
  root.innerHTML = `<div class="ov" data-act="ovclose"><div class="panel" role="dialog" aria-modal="true">${html}</div></div>`;
  const p = $('.panel', root);
  if (old && p) p.scrollTop = st;
}
function closeSheet() { sheet = null; renderSheet(); }
function openSheet(s) { sheet = s; renderSheet(); }

/* ================= เหตุการณ์ ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'ovclose') { if (e.target === t) closeSheet(); return; }
  act(t.dataset.act, t, e);
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.bind) onBind(el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.bind) { onBind(el); if (el.dataset.rerender) render(); }
  if (el.dataset && el.dataset.chg) onChg(el);
});

function onBind(el) {
  const [o, k] = el.dataset.bind.split('.');
  const target = B[o] && B[o]();
  if (!target) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.num) {
    const c = String(v).replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    if (c !== v) el.value = c;
    v = c;
  }
  target[k] = v;
  if (o === 'reg') updateRegBtn();
}

function onChg(el) {
  const k = el.dataset.chg, id = el.dataset.id;
  if (k === 'planinc') {
    const v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    S.planInc = v > 0 ? r2(v) : null; save(); render(); return;
  }
  if (k === 'budtick') { if (!S.budOn) S.budOn = {}; S.budOn[id] = el.checked; save(); render(); return; }
  if (k === 'budget') {
    const v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    if (v > 0) S.budgets[id] = r2(v); else delete S.budgets[id];
    save(); render(); return;
  }
  if (k === 'catname' || k === 'caticon' || k === 'catgroup' || k === 'cathide') {
    const c = S.expCats.concat(S.incCats).find(x => x.id === id);
    if (!c) return;
    if (k === 'catname') { const n = el.value.trim(); if (n) c.name = n; else el.value = c.name; }
    if (k === 'caticon') c.icon = el.value.trim() || '🏷️';
    if (k === 'catgroup') c.group = el.value;
    if (k === 'cathide') c.hidden = el.checked;
    save(); render(); renderSheet(); return;
  }
  if (k === 'import') {
    const f = el.files && el.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const o = JSON.parse(rd.result);
        if (!o || o.v !== 1 || !Array.isArray(o.tx) || !Array.isArray(o.expCats) || !Array.isArray(o.incCats)) throw new Error('bad');
        S = migrate(o); save(); closeSheet(); render(); toast('กู้คืนข้อมูลแล้ว');
      } catch (err) { toast('ไฟล์นี้กู้คืนไม่ได้'); }
    };
    rd.readAsText(f);
  }
}

function shiftMonth(y, m, d) { m += d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return [y, m]; }

function act(a, t) {
  switch (a) {
    /* ลงทะเบียน */
    case 'regmode': reg.mode = t.dataset.v; render(); break;
    case 'policy': openSheet({ kind: 'policy' }); break;
    case 'install': if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } break;
    case 'register': {
      if (!regValid()) return;
      S.profile = {
        mode: reg.mode, name: reg.name.trim(), age: Number(reg.age),
        phone: reg.mode === 'worker' ? reg.phone.replace(/[\s-]/g, '') : '',
        school: reg.mode === 'student' ? reg.school.trim() : '',
        consentAt: new Date().toISOString(), consentVersion: CONSENT_VERSION, sent: false
      };
      S.incCats = incomeDefaults(reg.mode);
      const c0 = parseFloat(reg.cash);
      if (reg.cash !== '' && c0 >= 0) S.cash = { amt: r2(c0), ts: Date.now(), date: today() };
      save(); submitLead(); render(); window.scrollTo(0, 0); break;
    }
    /* แท็บ */
    case 'tab': ui.tab = t.dataset.v; render(); window.scrollTo(0, 0); break;
    case 'close': closeSheet(); break;
    case 'settings': openSheet({ kind: 'settings', page: 'home' }); break;
    case 'spage': if (t.dataset.v === 'cash') cashf = { amt: '', avg: S.avgExp > 0 ? String(S.avgExp) : '' }; sheet.page = t.dataset.v; sheet.confirm = false; renderSheet(); break;

    /* บันทึก */
    case 'ftype': form.type = t.dataset.v; form.cat = ''; render(); break;
    case 'cashset': cashf = { amt: '', avg: S.avgExp > 0 ? String(S.avgExp) : '' }; openSheet({ kind: 'settings', page: 'cash' }); break;
    case 'cashsave': {
      const v = parseFloat(cashf.amt), av = parseFloat(cashf.avg);
      const hasAmt = cashf.amt !== '' && v >= 0, hasAvg = cashf.avg !== '' && av > 0;
      if (!hasAmt && !hasAvg) { toast('ใส่ยอดเงินหรือรายจ่ายเฉลี่ยก่อน'); return; }
      if (hasAmt) S.cash = { amt: r2(v), ts: Date.now(), date: today() };
      if (hasAvg) S.avgExp = r2(av);
      save(); closeSheet(); render(); toast('บันทึกแล้ว'); break;
    }
    case 'avgmode': S.avgMode = t.dataset.v; save(); render(); renderSheet(); break;
    case 'kp': kpPress(t.dataset.k); break;
    case 'kpclose': hideKp(); break;
    case 'kpopen': if (!ui.kp) showKp(); break;
    case 'kpnative': {
      ui.native = true; hideKp(); render();
      const f = $('#f-amt'); if (f) f.focus();
      break;
    }
    case 'kpapp': ui.native = false; render(); showKp(); break;
    case 'tip': tipIdx = nextTip(tipIdx); render(); break;
    case 'dprev': form.date = addDays(form.date || today(), -1); render(); break;
    case 'dnext': form.date = addDays(form.date || today(), 1); render(); break;
    case 'dtoday': form.date = today(); render(); break;
    case 'newcat': nc = { name: '', group: 'want', icon: '' }; openSheet({ kind: 'newcat' }); break;
    case 'pickemoji':
      nc.icon = t.dataset.e;
      document.querySelectorAll('.emo').forEach(b => b.classList.toggle('sel', b.dataset.e === nc.icon));
      { const f = $('#nc-icon'); if (f) f.value = nc.icon; }
      break;
    case 'ngroup': nc.group = t.dataset.v; renderSheet(); break;
    case 'savenewcat': {
      const name = nc.name.trim();
      if (!name) { toast('ใส่ชื่อหมวดก่อน'); return; }
      const id = 'c_' + uid(), icon = nc.icon.trim() || '🏷️';
      if (form.type === 'income') S.incCats.push({ id, name, icon, hidden: false });
      else S.expCats.push({ id, name, icon, group: nc.group, hidden: false });
      form.cat = id; nc = { name: '', group: 'want', icon: '' };
      save(); closeSheet(); render(); toast('เพิ่มหมวดแล้ว'); break;
    }
    case 'pickcat':
      form.cat = t.dataset.id;
      document.querySelectorAll('.tile').forEach(b => b.classList.toggle('sel', b.dataset.id === form.cat));
      break;
    case 'submit': {
      const amt = parseFloat(form.amount);
      if (!(amt > 0)) { toast('ใส่จำนวนเงินก่อน'); return; }
      if (amt > 1e9) { toast('จำนวนเงินมากเกินไป'); return; }
      if (!form.cat) { toast('เลือกหมวดก่อน'); return; }
      if (!form.date) { toast('เลือกวันที่ก่อน'); return; }
      S.tx.push({ id: uid(), type: form.type, cat: form.cat, amount: r2(amt), note: form.note.trim(), date: form.date, created: today(), ts: Date.now() });
      if (!S.logDays.includes(today())) S.logDays.push(today());
      save();
      form.amount = ''; form.note = ''; form.cat = '';
      hideKp(); ui.native = false;
      toast('บันทึกแล้ว'); render(); break;
    }
    case 'edit': {
      const x = S.tx.find(q => q.id === t.dataset.id);
      if (!x) return;
      const back = null;
      edit = { id: x.id, type: x.type, cat: x.cat, amount: String(x.amount), note: x.note || '', date: x.date, confirm: false };
      openSheet({ kind: 'edit', back }); break;
    }
    case 'editsave': {
      const amt = parseFloat(edit.amount);
      if (!(amt > 0)) { toast('ใส่จำนวนเงินก่อน'); return; }
      if (!edit.date) { toast('เลือกวันที่ก่อน'); return; }
      const x = S.tx.find(q => q.id === edit.id);
      if (x) { x.amount = r2(amt); x.cat = edit.cat; x.note = edit.note.trim(); x.date = edit.date; }
      save(); finishEdit('แก้ไขแล้ว'); break;
    }
    case 'editdel': {
      if (!edit.confirm) { edit.confirm = true; renderSheet(); return; }
      const x = S.tx.find(q => q.id === edit.id);
      if (x && x.recurKey) S.skipKeys.push(x.recurKey);
      S.tx = S.tx.filter(q => q.id !== edit.id);
      save(); finishEdit('ลบแล้ว'); break;
    }

    /* ปฏิทิน */
    case 'calprev': { const [y, m] = shiftMonth(ui.calY, ui.calM, -1); setCalMonth(y, m); render(); break; }
    case 'calnext': { const [y, m] = shiftMonth(ui.calY, ui.calM, 1); setCalMonth(y, m); render(); break; }
    case 'caltoday': { const d = new Date(); setCalMonth(d.getFullYear(), d.getMonth()); render(); break; }
    case 'selday': {
      const [y, m] = t.dataset.date.split('-').map(Number);
      ui.calSel = t.dataset.date; ui.calY = y; ui.calM = m - 1; render(); window.scrollTo(0, 0); break;
    }
    case 'addday': form.date = ui.calSel; ui.tab = 'entry'; render(); window.scrollTo(0, 0); break;

    /* รายงาน */
    case 'repmode': ui.repMode = t.dataset.v; render(); break;
    case 'repprev':
      if (ui.repMode === 'month') [ui.repY, ui.repM] = shiftMonth(ui.repY, ui.repM, -1); else ui.repY--;
      render(); break;
    case 'repnext':
      if (ui.repMode === 'month') [ui.repY, ui.repM] = shiftMonth(ui.repY, ui.repM, 1); else ui.repY++;
      render(); break;

    /* งบ */
    case 'budprev': [ui.budY, ui.budM] = shiftMonth(ui.budY, ui.budM, -1); render(); break;
    case 'budnext': [ui.budY, ui.budM] = shiftMonth(ui.budY, ui.budM, 1); render(); break;
    /* ตั้งค่า */
    case 'addcat': {
      const name = nc.name.trim();
      if (!name) { toast('ใส่ชื่อหมวดก่อน'); return; }
      const icon = nc.icon.trim() || '🏷️';
      if (sheet.page === 'inc') S.incCats.push({ id: 'c_' + uid(), name, icon, hidden: false });
      else S.expCats.push({ id: 'c_' + uid(), name, icon, group: nc.group, hidden: false });
      nc.name = ''; nc.icon = ''; save(); render(); renderSheet(); toast('เพิ่มหมวดแล้ว'); break;
    }
    case 'rtype': rec.type = t.dataset.v; rec.cat = ''; renderSheet(); break;
    case 'addrec': {
      const amt = parseFloat(rec.amount), day = parseInt(rec.day, 10);
      if (!(amt > 0)) { toast('ใส่จำนวนเงินก่อน'); return; }
      if (!(day >= 1 && day <= 31)) { toast('วันที่ต้องอยู่ระหว่าง 1 ถึง 31'); return; }
      if (!rec.cat) { toast('เลือกหมวดก่อน'); return; }
      S.recurring.push({ id: uid(), type: rec.type, cat: rec.cat, amount: r2(amt), note: rec.note.trim(), day, start: today().slice(0, 7) });
      applyRecurring(); save();
      rec.amount = ''; rec.note = '';
      render(); renderSheet(); toast('เพิ่มรายการประจำแล้ว'); break;
    }
    case 'delrec': S.recurring = S.recurring.filter(r => r.id !== t.dataset.id); save(); renderSheet(); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wealth-note-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      break;
    }
    case 'reset': {
      if (!sheet.confirm) { sheet.confirm = true; renderSheet(); return; }
      try { localStorage.removeItem(KEY); } catch (e) { /* ข้าม */ }
      mem = null; S = fresh();
      reg = { mode: 'worker', name: '', age: '', phone: '', school: '', consent: false };
      form = { type: 'expense', cat: '', amount: '', note: '', date: today() };
      ui.tab = 'entry'; closeSheet(); render(); break;
    }
  }
}

function finishEdit(msg) {
  const back = sheet && sheet.back;
  sheet = back || null;
  render(); renderSheet(); toast(msg);
}

/* ================= เริ่มทำงาน ================= */
applyRecurring();
submitLead();
render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* ไม่เป็นไร ใช้งานต่อได้ */ }); });
}
})();
