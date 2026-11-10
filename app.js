(function () {
'use strict';

/* ================= ตั้งค่า ================= */
// ใส่ลิงก์รับรายชื่อ (เช่น Google Apps Script Web App) ที่นี่ ถ้าเว้นว่าง แอปจะไม่ส่งข้อมูลไปไหน
const CONFIG = { LEAD_ENDPOINT: '' };
const CONSENT_VERSION = 'draft-0';
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
  ['food', 'อาหาร', 'need'], ['clothes', 'เสื้อผ้า', 'need'], ['travel', 'เดินทาง', 'need'],
  ['home', 'ที่อยู่อาศัย', 'need'], ['health', 'ค่ายาและการรักษา', 'need'], ['insurance', 'ประกัน', 'need'],
  ['social', 'สังสรรค์', 'want'], ['shop', 'ช้อปปิ้ง', 'want'], ['sub', 'Subscription', 'want'],
  ['care', 'ดูแลตัวเอง', 'want'], ['gift', 'ของขวัญ', 'want'], ['wellness', 'Wellness', 'want'],
  ['exercise', 'ออกกำลังกาย', 'want'], ['books', 'หนังสือและเกม', 'want'], ['trip', 'ท่องเที่ยว', 'want'],
  ['saving', 'เงินออม', 'save'], ['invest', 'ลงทุน', 'save']
];
const incomeDefaults = mode => [
  { id: 'salary', name: mode === 'student' ? 'ค่าขนม' : 'เงินเดือน' },
  { id: 'side', name: 'งานเสริม' },
  { id: 'gift', name: 'ของขวัญ/ครอบครัว' },
  { id: 'invret', name: 'ผลตอบแทนลงทุน' },
  { id: 'other', name: 'อื่นๆ' }
].map(c => ({ id: c.id, name: c.name, hidden: false }));

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
  v: 1, profile: null,
  expCats: DEFAULT_EXP.map(([id, name, group]) => ({ id, name, group, hidden: false })),
  incCats: [], tx: [], budgets: {}, recurring: [], logDays: [], skipKeys: []
});
function load() {
  try {
    const r = localStorage.getItem(KEY);
    if (r) { const o = JSON.parse(r); if (o && o.v === 1) return o; }
  } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  return mem || fresh();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { mem = S; }
}

const now = new Date();
const ui = {
  tab: 'entry',
  calY: now.getFullYear(), calM: now.getMonth(),
  repMode: 'month', repY: now.getFullYear(), repM: now.getMonth(),
  budY: now.getFullYear(), budM: now.getMonth()
};
let form = { type: 'expense', cat: '', amount: '', note: '', date: today() };
let reg = { mode: 'worker', name: '', age: '', phone: '', school: '', consent: false };
let sheet = null;
let edit = null;
let rec = { type: 'expense', cat: '', amount: '', day: '1', note: '' };
let nc = { name: '', group: 'want' };
let auto = { income: '' };
const B = { reg: () => reg, form: () => form, edit: () => edit, rec: () => rec, nc: () => nc, auto: () => auto };

/* ================= คำนวณ ================= */
const catList = type => (type === 'income' ? S.incCats : S.expCats);
const catName = (type, id) => { const c = catList(type).find(x => x.id === id); return c ? c.name : 'ไม่ระบุ'; };
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
  if (isIOS()) return '<div class="install"><b>ก่อนเริ่ม:</b> แตะปุ่มแชร์ใน Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" จากนั้นเปิดแอปจากไอคอน แล้วค่อยลงทะเบียน (ถ้าลงทะเบียนในเบราว์เซอร์ก่อน ข้อมูลอาจไม่ติดไปกับไอคอน)</div>';
  return '<div class="install"><b>ก่อนเริ่ม:</b> เปิดเมนูของเบราว์เซอร์ แล้วเลือก "เพิ่มไปยังหน้าจอหลัก" หรือ "ติดตั้งแอป"</div>';
}

function viewRegister() {
  const st = reg.mode === 'student';
  return `
  <div class="regtop"><img src="assets/logo_teal.png" alt="WDC GROUP"><h1>Wealth Note</h1><p>สมุดรายรับ-รายจ่ายจาก WDC</p></div>
  ${installCard()}
  <div class="why">ขอข้อมูลสั้นๆ ก่อนเริ่มใช้ เพราะทีม WDC อยากติดต่อกลับ เพื่อให้คำแนะนำการเงินที่ตรงกับคุณจริงๆ และอยากช่วยเหลือคุณ รายการรายรับ-รายจ่ายที่คุณจด จะเก็บในเครื่องนี้เท่านั้น</div>
  <div class="seg" role="tablist">
    <button class="${st ? 'on' : ''}" data-act="regmode" data-v="student">นักเรียน</button>
    <button class="${!st ? 'on' : ''}" data-act="regmode" data-v="worker">คนทำงาน</button>
  </div>
  <label class="f" for="r-name">${st ? 'ชื่อเล่น' : 'ชื่อจริง'}</label>
  <input id="r-name" class="in" data-bind="reg.name" value="${esc(reg.name)}" autocomplete="${st ? 'nickname' : 'given-name'}">
  <label class="f" for="r-age">อายุ (ปี)</label>
  <input id="r-age" class="in" data-bind="reg.age" data-num="1" inputmode="numeric" value="${esc(reg.age)}">
  ${st
    ? `<label class="f" for="r-school">โรงเรียน</label><input id="r-school" class="in" data-bind="reg.school" value="${esc(reg.school)}">`
    : `<label class="f" for="r-phone">เบอร์โทร</label><input id="r-phone" class="in" data-bind="reg.phone" inputmode="tel" autocomplete="tel" value="${esc(reg.phone)}">`}
  <div class="consent">
    <input type="checkbox" id="r-ok" data-bind="reg.consent" ${reg.consent ? 'checked' : ''}>
    <label for="r-ok">ฉันยินยอมให้ WDC GROUP เก็บและใช้ข้อมูลนี้เพื่อติดต่อกลับ <button type="button" data-act="policy">อ่านนโยบายสั้นๆ</button></label>
  </div>
  <button id="regbtn" class="btn" data-act="register" ${regValid() ? '' : 'disabled'}>เริ่มใช้งาน</button>`;
}

function sheetPolicy() {
  return `
  <div class="panel-h"><h2>นโยบายข้อมูลส่วนบุคคล</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <div class="warnbox">ร่างสำหรับทดสอบ ยังไม่ผ่านการตรวจทางกฎหมาย ต้องให้ผู้เชี่ยวชาญตรวจก่อนใช้จริง</div>
  <div class="card">
    <p><b>เก็บอะไร:</b> ${'ชื่อหรือชื่อเล่น อายุ และเบอร์โทร (คนทำงาน) หรือโรงเรียน (นักเรียน)'}</p>
    <p style="margin-top:8px"><b>ใช้ทำอะไร:</b> ให้ทีม WDC GROUP ติดต่อกลับ เพื่อให้ความรู้และคำแนะนำด้านการเงิน</p>
    <p style="margin-top:8px"><b>รายการรายรับ-รายจ่าย:</b> เก็บในเครื่องของคุณเท่านั้น ไม่ส่งให้ WDC</p>
    <p style="margin-top:8px"><b>เก็บนานเท่าไร:</b> [WDC ระบุ]</p>
    <p style="margin-top:8px"><b>ขอแก้ไขหรือลบข้อมูล:</b> [WDC ระบุช่องทางติดต่อ]</p>
  </div>`;
}

/* ================= โครงหน้าหลัก ================= */
const TABS = [['entry', 'บันทึก'], ['cal', 'ปฏิทิน'], ['rep', 'รายงาน'], ['bud', 'งบ']];
const TITLES = { entry: 'บันทึก', cal: 'ปฏิทิน', rep: 'รายงาน', bud: 'งบประมาณ' };

function render() {
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
}

/* ---------- หน้า 1: บันทึก ---------- */
function txRow(t) {
  const sign = t.type === 'income' ? '+' : '-';
  return `<button class="row" data-act="edit" data-id="${t.id}">
    <span class="r-main"><b>${esc(catName(t.type, t.cat))}</b>${t.note ? `<small>${esc(t.note)}</small>` : ''}</span>
    <span class="amt ${t.type === 'income' ? 'inc' : 'exp'}">${sign}${money(t.amount)}</span></button>`;
}
function viewEntry() {
  const cats = catList(form.type).filter(c => !c.hidden);
  const list = S.tx.filter(t => t.date === form.date).slice().reverse();
  const sm = summarize(list);
  const n = streak();
  const loggedToday = S.logDays.includes(today());
  const banner = n === 0
    ? 'เริ่มบันทึกวันนี้ได้เลย'
    : (loggedToday ? `บันทึกต่อเนื่อง ${n} วัน` : `ต่อเนื่อง ${n} วัน วันนี้ยังไม่ได้บันทึก`);
  return `
  <div class="banner">${banner}</div>
  <div class="seg inc" role="tablist">
    <button class="${form.type === 'expense' ? 'on' : ''}" data-act="ftype" data-v="expense">รายจ่าย</button>
    <button class="${form.type === 'income' ? 'on' : ''}" data-act="ftype" data-v="income">รายรับ</button>
  </div>
  <label class="f" for="f-amt">จำนวนเงิน (บาท)</label>
  <input id="f-amt" class="in big" data-bind="form.amount" data-num="1" inputmode="decimal" placeholder="0" value="${esc(form.amount)}">
  <label class="f">หมวด</label>
  <div class="tiles">${cats.map(c => `<button class="tile ${form.cat === c.id ? 'sel' : ''} ${form.type}" data-act="pickcat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
  <label class="f" for="f-note">โน้ต (ไม่บังคับ)</label>
  <input id="f-note" class="in" data-bind="form.note" placeholder="เช่น ข้าวมันไก่" value="${esc(form.note)}" maxlength="80">
  <label class="f" for="f-date">วันที่</label>
  <input id="f-date" type="date" class="in" data-bind="form.date" data-rerender="1" value="${form.date}">
  <div class="stickysave"><button class="btn" data-act="submit">บันทึก</button></div>
  <div class="dayhead"><span class="sec" style="margin:0">รายการวันที่ ${fmtDate(form.date)}</span>
    <small>${list.length ? (sm.inc ? `รับ ${money(sm.inc)} ` : '') + (sm.exp ? `จ่าย ${money(sm.exp)}` : '') : ''}</small></div>
  <div class="list">${list.length ? list.map(txRow).join('') : '<div class="empty">ยังไม่มีรายการในวันนี้</div>'}</div>`;
}

/* ---------- หน้า 2: ปฏิทิน ---------- */
function viewCal() {
  const y = ui.calY, m = ui.calM;
  const map = {};
  let inc = 0, exp = 0;
  monthTx(y, m).forEach(t => {
    const o = map[t.date] || (map[t.date] = { i: 0, e: 0 });
    if (t.type === 'income') { o.i += t.amount; inc += t.amount; } else { o.e += t.amount; exp += t.amount; }
  });
  const first = new Date(y, m, 1).getDay();
  const n = daysIn(y, m);
  const td = today();
  let cells = TH_D.map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div class="blank"></div>';
  for (let d = 1; d <= n; d++) {
    const key = y + '-' + pad(m + 1) + '-' + pad(d);
    const o = map[key];
    cells += `<button class="cell ${key === td ? 'today' : ''} ${o ? 'has' : ''}" data-act="day" data-date="${key}">
      <span class="dn">${d}</span>${o && o.i ? `<span class="ci">${compact(o.i)}</span>` : ''}${o && o.e ? `<span class="ce">${compact(o.e)}</span>` : ''}</button>`;
  }
  const bal = inc - exp;
  return `
  <div class="mnav"><button data-act="calprev" aria-label="เดือนก่อน">‹</button><b>${TH_M[m]} ${y + 543}</b><button data-act="calnext" aria-label="เดือนถัดไป">›</button></div>
  <div class="sum3">
    <div><small>รายรับ</small><b class="inc">${money(inc)}</b></div>
    <div><small>รายจ่าย</small><b class="exp">${money(exp)}</b></div>
    <div><small>คงเหลือ</small><b class="${bal < 0 ? 'neg' : 'pos'}">${money(bal)}</b></div>
  </div>
  <div class="cal">${cells}</div>
  <p class="calhint">เขียว = รายรับ, แดง = รายจ่าย (k = พัน) แตะวันที่เพื่อดูรายการ</p>
  <button class="btn ghost sm" style="margin-top:12px" data-act="caltoday">ไปเดือนนี้</button>`;
}
function sheetDay() {
  const list = S.tx.filter(t => t.date === sheet.date).slice().reverse();
  const sm = summarize(list);
  return `
  <div class="panel-h"><h2>${fmtDate(sheet.date)}</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  ${list.length ? `<p class="mute" style="margin-bottom:8px">รับ ${money(sm.inc)} จ่าย ${money(sm.exp)}</p>` : ''}
  <div class="list">${list.length ? list.map(txRow).join('') : '<div class="empty">ยังไม่มีรายการในวันนี้</div>'}</div>
  <button class="btn" data-act="addday">เพิ่มรายการวันนี้</button>`;
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
  const rate = r.inc > 0 ? Math.round(r.grp.save / r.inc * 100) + '%' : '-';

  // สัดส่วนตามหมวด เรียงตามกลุ่ม แล้วตามยอดมาก→น้อย
  const slices = [];
  ['need', 'want', 'save'].forEach(g => {
    Object.keys(r.byCat).filter(id => groupOf(id) === g && r.byCat[id] > 0)
      .sort((a, b) => r.byCat[b] - r.byCat[a])
      .forEach((id, i) => slices.push({ id, name: catName('expense', id), v: r.byCat[id], color: colorFor(g, i), g }));
  });

  const donutBlock = r.exp > 0
    ? `<div class="donutwrap">${donut(slices, r.exp)}</div>
       <div class="legend">${slices.map(s => `<div class="lg"><span class="sw" style="background:${s.color}"></span><span class="nm">${esc(s.name)}</span><span class="pc">${Math.round(s.v / r.exp * 100)}%</span><span class="vl">${money(s.v)}</span></div>`).join('')}</div>`
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
  <div class="card"><div class="kpi"><span>อัตราออม <small>(เงินออม + ลงทุน ÷ รายรับ)</small></span><b>${rate}</b></div></div>
  <h2 class="sec">รายจ่ายตามหมวด</h2><div class="card">${donutBlock}</div>
  <h2 class="sec">เทียบกับ 50/30/20</h2><div class="card">${g532}</div>
  ${mode === 'month'
    ? `<h2 class="sec">เทียบกับค่าเฉลี่ยรายเดือนของปี ${y + 543}</h2><div class="card">${avgCompare(y, m, r.byCat)}</div>`
    : `<h2 class="sec">รายรับ-รายจ่ายทุกเดือน</h2><div class="card">${barsChart(y)}</div>`}`;
}

/* ---------- หน้า 4: งบ ---------- */
function viewBudget() {
  const y = ui.budY, m = ui.budM;
  const r = summarize(monthTx(y, m));
  const cats = S.expCats.filter(c => !c.hidden);
  let totB = 0, totU = 0;
  const rows = cats.map(c => {
    const b = S.budgets[c.id] || 0, used = r.byCat[c.id] || 0;
    if (b > 0) { totB += b; totU += used; }
    const pct = b > 0 ? used / b * 100 : 0;
    const isSave = c.group === 'save';
    const cls = isSave ? '' : pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
    const meta = b > 0
      ? `${isSave ? 'ออมแล้ว' : 'ใช้'} ${money(used)} จาก ${money(b)} (${Math.round(pct)}%)${pct > 100 && !isSave ? ` เกิน ${money(used - b)}` : ''}`
      : `ยังไม่ได้ตั้งงบ${used > 0 ? ` (ใช้ไป ${money(used)})` : ''}`;
    return `<div class="brow"><div class="brow-top"><div><b>${esc(c.name)}</b> <small>${GRP[c.group]}</small></div>
      <label class="binp"><input inputmode="numeric" data-chg="budget" data-id="${c.id}" value="${b ? b : ''}" placeholder="0" aria-label="งบต่อเดือน ${esc(c.name)}"> บาท</label></div>
      <div class="bar"><i class="${cls}" style="width:${Math.min(pct, 100).toFixed(1)}%"></i></div><div class="bmeta">${meta}</div></div>`;
  }).join('');
  return `
  <div class="mnav"><button data-act="budprev" aria-label="เดือนก่อน">‹</button><b>${TH_M[m]} ${y + 543}</b><button data-act="budnext" aria-label="เดือนถัดไป">›</button></div>
  <div class="sum3">
    <div><small>งบรวม</small><b>${money(totB)}</b></div>
    <div><small>ใช้ไป</small><b class="exp">${money(totU)}</b></div>
    <div><small>เหลือ</small><b class="${totB - totU < 0 ? 'neg' : 'pos'}">${money(totB - totU)}</b></div>
  </div>
  <p class="note" style="margin:-4px 0 10px">"ใช้ไป" นับเฉพาะหมวดที่ตั้งงบ งบใช้เท่ากันทุกเดือน แถบเป็นสีทองเมื่อใช้ถึง 80% และสีแดงเมื่อเกิน 100% (หมวดออมไม่เปลี่ยนสี)</p>
  <button class="btn ghost" style="margin:0 0 12px" data-act="autobud">เติมงบอัตโนมัติ 50/30/20</button>
  <div class="card" style="padding-top:2px;padding-bottom:2px">${rows}</div>`;
}
function sheetAuto() {
  return `
  <div class="panel-h"><h2>เติมงบอัตโนมัติ 50/30/20</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <p>แบ่งรายรับต่อเดือนเป็น จำเป็น 50%, อยากได้ 30%, ออม 20% แล้วหารเท่ากันในแต่ละหมวดของกลุ่ม ปัดเป็นหลักสิบบาท เป็นจุดเริ่มต้นให้ปรับเองต่อ</p>
  <label class="f" for="a-inc">รายรับต่อเดือน (บาท)</label>
  <input id="a-inc" class="in big" data-bind="auto.income" data-num="1" inputmode="numeric" value="${esc(auto.income)}" placeholder="0">
  <div class="warnbox" style="margin-top:12px">งบที่ตั้งไว้เดิมทุกหมวดจะถูกแทนที่</div>
  <button class="btn" data-act="autoapply">เติมงบ</button>`;
}

/* ================= ชีตแก้ไขรายการ ================= */
function sheetEdit() {
  const list = catList(edit.type).filter(c => !c.hidden || c.id === edit.cat);
  return `
  <div class="panel-h"><h2>แก้ไข${edit.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</h2><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <label class="f" for="e-amt">จำนวนเงิน (บาท)</label>
  <input id="e-amt" class="in big" data-bind="edit.amount" data-num="1" inputmode="decimal" value="${esc(edit.amount)}">
  <label class="f" for="e-cat">หมวด</label>
  <select id="e-cat" class="in" data-bind="edit.cat">${list.map(c => `<option value="${c.id}" ${c.id === edit.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  <label class="f" for="e-note">โน้ต</label>
  <input id="e-note" class="in" data-bind="edit.note" value="${esc(edit.note)}" maxlength="80">
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
      <input class="in" data-chg="catname" data-id="${c.id}" value="${esc(c.name)}" aria-label="ชื่อหมวด">
      ${isInc ? '' : `<select class="in" data-chg="catgroup" data-id="${c.id}" aria-label="กลุ่ม">${['need', 'want', 'save'].map(g => `<option value="${g}" ${c.group === g ? 'selected' : ''}>${GRP[g]}</option>`).join('')}</select>`}
      <label><input type="checkbox" data-chg="cathide" data-id="${c.id}" ${c.hidden ? 'checked' : ''}>ซ่อน</label></div>`).join('')}</div>
    <p class="note">หมวดที่ซ่อนจะไม่แสดงตอนบันทึก แต่รายการเก่ายังอยู่ในรายงาน</p>
    <label class="f" for="nc-name">เพิ่มหมวดใหม่</label>
    <div class="row2"><input id="nc-name" class="in" data-bind="nc.name" placeholder="ชื่อหมวด" value="${esc(nc.name)}" maxlength="30">
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
    <select id="rc-cat" class="in" data-bind="rec.cat">${cats.map(c => `<option value="${c.id}" ${c.id === rec.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
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
  if (p === 'me') {
    const pr = S.profile;
    return head('ข้อมูลของฉัน', true) + `<div class="card">
      <p><small>โหมด</small><br>${pr.mode === 'student' ? 'นักเรียน' : 'คนทำงาน'}</p>
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
  if (sheet.kind === 'day') html = sheetDay();
  else if (sheet.kind === 'edit') html = sheetEdit();
  else if (sheet.kind === 'settings') html = sheetSettings();
  else if (sheet.kind === 'auto') html = sheetAuto();
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
  if (k === 'budget') {
    const v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    if (v > 0) S.budgets[id] = r2(v); else delete S.budgets[id];
    save(); render(); return;
  }
  if (k === 'catname' || k === 'catgroup' || k === 'cathide') {
    const c = S.expCats.concat(S.incCats).find(x => x.id === id);
    if (!c) return;
    if (k === 'catname') { const n = el.value.trim(); if (n) c.name = n; else el.value = c.name; }
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
        S = o; save(); closeSheet(); render(); toast('กู้คืนข้อมูลแล้ว');
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
      save(); submitLead(); render(); window.scrollTo(0, 0); break;
    }
    /* แท็บ */
    case 'tab': ui.tab = t.dataset.v; render(); window.scrollTo(0, 0); break;
    case 'close': closeSheet(); break;
    case 'settings': openSheet({ kind: 'settings', page: 'home' }); break;
    case 'spage': sheet.page = t.dataset.v; sheet.confirm = false; renderSheet(); break;

    /* บันทึก */
    case 'ftype': form.type = t.dataset.v; form.cat = ''; render(); break;
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
      S.tx.push({ id: uid(), type: form.type, cat: form.cat, amount: r2(amt), note: form.note.trim(), date: form.date, created: today() });
      if (!S.logDays.includes(today())) S.logDays.push(today());
      save();
      form.amount = ''; form.note = ''; form.cat = '';
      toast('บันทึกแล้ว'); render(); break;
    }
    case 'edit': {
      const x = S.tx.find(q => q.id === t.dataset.id);
      if (!x) return;
      const back = sheet && sheet.kind === 'day' ? sheet : null;
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
    case 'calprev': [ui.calY, ui.calM] = shiftMonth(ui.calY, ui.calM, -1); render(); break;
    case 'calnext': [ui.calY, ui.calM] = shiftMonth(ui.calY, ui.calM, 1); render(); break;
    case 'caltoday': { const d = new Date(); ui.calY = d.getFullYear(); ui.calM = d.getMonth(); render(); break; }
    case 'day': openSheet({ kind: 'day', date: t.dataset.date }); break;
    case 'addday': form.date = sheet.date; ui.tab = 'entry'; closeSheet(); render(); window.scrollTo(0, 0); break;

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
    case 'autobud': {
      const inc = summarize(monthTx(ui.budY, ui.budM)).inc;
      auto.income = inc > 0 ? String(Math.round(inc)) : '';
      openSheet({ kind: 'auto' }); break;
    }
    case 'autoapply': {
      const inc = parseFloat(auto.income);
      if (!(inc > 0)) { toast('ใส่รายรับต่อเดือนก่อน'); return; }
      const nb = {};
      ['need', 'want', 'save'].forEach(g => {
        const cs = S.expCats.filter(c => !c.hidden && c.group === g);
        if (!cs.length) return;
        const each = Math.round(inc * TARGET[g] / 100 / cs.length / 10) * 10;
        if (each > 0) cs.forEach(c => { nb[c.id] = each; });
      });
      S.budgets = nb; save(); closeSheet(); render(); toast('เติมงบแล้ว'); break;
    }

    /* ตั้งค่า */
    case 'addcat': {
      const name = nc.name.trim();
      if (!name) { toast('ใส่ชื่อหมวดก่อน'); return; }
      if (sheet.page === 'inc') S.incCats.push({ id: 'c_' + uid(), name, hidden: false });
      else S.expCats.push({ id: 'c_' + uid(), name, group: nc.group, hidden: false });
      nc.name = ''; save(); render(); renderSheet(); toast('เพิ่มหมวดแล้ว'); break;
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
