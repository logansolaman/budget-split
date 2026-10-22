'use strict';

/* Paycheck Split — Hong Kong salaries-tax aware budget splitter.
   Vanilla JS, no build step, no backend. State lives in localStorage; CSV is the portability layer. */

const BUCKETS = [
  { key: 'essentials', label: 'Essentials', pct: 55, color: 'var(--b-essentials)' },
  { key: 'fun',        label: 'Fun',        pct: 5,  color: 'var(--b-fun)' },
  { key: 'debt',       label: 'Debt',       pct: 10, color: 'var(--b-debt)' },
  { key: 'save',       label: 'Save',       pct: 15, color: 'var(--b-save)' },
  { key: 'invest',     label: 'Invest',     pct: 15, color: 'var(--b-invest)' },
];

/* Progressive salaries tax bands above the basic allowance (unchanged 2024/25 → 2026/27). */
const BANDS = [
  { width: 50000, rate: 0.02 },
  { width: 50000, rate: 0.06 },
  { width: 50000, rate: 0.10 },
  { width: 50000, rate: 0.14 },
  { width: Infinity, rate: 0.17 },
];
const STD_RATE = { threshold: 5000000, first: 0.15, rest: 0.16 };

const STORAGE_KEY = 'paycheck-split.hk.v1';
const QUICK_ESSENTIALS = ['Rent', 'Groceries', 'Transport', 'Utilities', 'Phone', 'Insurance', 'Loan payment'];

const $ = (sel) => document.querySelector(sel);

/* ---------------- state ---------------- */

function defaults() {
  return {
    income: 30000,
    mpfOn: true,
    mpfRate: 5,
    mpfCap: 1500,
    taxOn: true,
    allowance: 145000,
    pcts: Object.fromEntries(BUCKETS.map((b) => [b.key, b.pct])),
    items: Object.fromEntries(BUCKETS.map((b) => [b.key, []])),
    open: { essentials: true },
  };
}

function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    const merged = { ...base, ...saved, pcts: { ...base.pcts, ...(saved.pcts || {}) }, items: {}, open: { ...base.open, ...(saved.open || {}) } };
    BUCKETS.forEach((b) => {
      const list = (saved.items && saved.items[b.key]) || [];
      merged.items[b.key] = Array.isArray(list)
        ? list.map((it) => ({ name: String(it.name ?? ''), amount: numOr(it.amount, 0) }))
        : [];
    });
    return merged;
  } catch (err) {
    return base;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    stamp();
  } catch (err) {
    /* storage disabled — the app still works, just won't remember */
    setSaved('Not saved (storage blocked)');
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 200);
}

let state = load();

/* ---------------- helpers ---------------- */

function numOr(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function fmt(n) {
  const v = Number.isFinite(n) ? n : 0;
  return 'HK$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function setText(el, txt) {
  if (el && el.textContent !== txt) el.textContent = txt;
}

function setVal(el, v) {
  if (el && document.activeElement !== el && String(el.value) !== String(v)) el.value = v;
}

function stamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  setSaved(`Saved locally · ${hh}:${mm}`);
}

function setSaved(txt, isError) {
  const el = $('#saved');
  if (!el) return;
  el.textContent = txt;
  el.style.color = isError ? 'var(--b-debt)' : '';
}

/* ---------------- tax engine ---------------- */

function progressiveTax(netChargeable) {
  let remaining = netChargeable;
  let tax = 0;
  for (const band of BANDS) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, band.width);
    tax += slice * band.rate;
    remaining -= slice;
  }
  return tax;
}

function standardRateTax(netIncome) {
  const first = Math.min(netIncome, STD_RATE.threshold);
  const rest = Math.max(0, netIncome - STD_RATE.threshold);
  return first * STD_RATE.first + rest * STD_RATE.rest;
}

/** Annual salaries tax given annual gross income, annual MPF deduction and the basic allowance. */
function annualSalariesTax(grossAnnual, mpfAnnual, allowance) {
  const netIncome = Math.max(0, grossAnnual - mpfAnnual);
  const netChargeable = Math.max(0, netIncome - allowance);
  return Math.min(progressiveTax(netChargeable), standardRateTax(netIncome));
}

/* ---------------- compute ---------------- */

function compute() {
  const gross = Math.max(0, numOr(state.income, 0));
  const mpf = state.mpfOn ? Math.min(gross * (numOr(state.mpfRate, 5) / 100), Math.max(0, numOr(state.mpfCap, 0))) : 0;
  const annualTax = state.taxOn
    ? annualSalariesTax(gross * 12, mpf * 12, Math.max(0, numOr(state.allowance, 0)))
    : 0;
  const tax = annualTax / 12;
  const allocatable = Math.max(0, gross - mpf - tax);

  const pctSum = BUCKETS.reduce((s, b) => s + Math.max(0, numOr(state.pcts[b.key], 0)), 0);
  const amounts = {};
  const raw = BUCKETS.map((b) => ({ key: b.key, pct: Math.max(0, numOr(state.pcts[b.key], 0)) }));

  if (pctSum > 0 && allocatable > 0) {
    const target = Math.round(allocatable);
    let sum = 0;
    raw.forEach((r) => {
      const v = Math.round((allocatable * r.pct) / pctSum);
      amounts[r.key] = v;
      sum += v;
    });
    // Park any rounding residue on the largest bucket so the total ties exactly.
    const residue = target - sum;
    if (residue !== 0) {
      const largest = raw.slice().sort((a, b) => b.pct - a.pct)[0];
      if (largest) amounts[largest.key] += residue;
    }
  } else {
    BUCKETS.forEach((b) => { amounts[b.key] = 0; });
  }

  return { gross, mpf, tax, annualTax, allocatable, pctSum, amounts };
}

/* ---------------- render ---------------- */

function buildBar() {
  const bar = $('#bar');
  bar.innerHTML = '';
  const seg = (color, title) => {
    const s = document.createElement('span');
    s.style.background = color;
    s.title = title;
    bar.appendChild(s);
    return s;
  };
  state._seg = {
    mpf: seg('var(--mpf)', 'MPF'),
    tax: seg('var(--tax)', 'Salaries tax'),
    ...Object.fromEntries(BUCKETS.map((b) => [b.key, seg(b.color, b.label)])),
  };
}

function mountBuckets() {
  const wrap = $('#buckets');
  wrap.innerHTML = '';
  BUCKETS.forEach((b) => {
    const card = document.createElement('article');
    card.className = 'bucket' + (state.open[b.key] ? ' open' : '');
    card.dataset.key = b.key;
    card.innerHTML = `
      <div class="b-head">
        <div>
          <h3 class="b-name"><i class="dot" style="background:${b.color}"></i>${b.label}</h3>
          <p class="b-amount" data-amount>—</p>
        </div>
        <label class="pct-input" title="Share of the money you can allocate">
          <input type="number" min="0" max="100" step="1" inputmode="decimal" data-pct aria-label="${b.label} percentage">
          <span>%</span>
        </label>
      </div>
      <button class="b-toggle" data-toggle aria-expanded="${state.open[b.key] ? 'true' : 'false'}">
        <span class="caret">▶</span> <span data-toggler-label>Line items</span>
      </button>
      <div class="b-detail">
        <ul class="items" data-items></ul>
        <div class="b-foot">
          <span>
            <button class="add-line" data-add>+ Add line</button>
            ${b.key === 'essentials' ? '<button class="add-line" data-quick>+ Common essentials</button>' : ''}
          </span>
          <span class="variance" data-variance></span>
        </div>
      </div>`;

    card.querySelector('[data-pct]').addEventListener('input', (e) => {
      state.pcts[b.key] = clamp(numOr(e.target.value, 0), 0, 100);
      save();
      update();
    });
    card.querySelector('[data-toggle]').addEventListener('click', () => {
      const open = !card.classList.contains('open');
      card.classList.toggle('open', open);
      state.open[b.key] = open;
      card.querySelector('[data-toggle]').setAttribute('aria-expanded', String(open));
      save();
    });
    card.querySelector('[data-add]').addEventListener('click', () => {
      addItem(b.key, '', 0);
    });
    const quick = card.querySelector('[data-quick]');
    if (quick) {
      quick.addEventListener('click', () => {
        const taken = new Set(state.items.essentials.map((i) => i.name.trim().toLowerCase()));
        QUICK_ESSENTIALS.forEach((name) => {
          if (!taken.has(name.toLowerCase())) state.items.essentials.push({ name, amount: 0 });
        });
        renderItems('essentials');
        persist();
        update();
      });
    }

    const list = card.querySelector('[data-items]');
    list.addEventListener('input', (e) => {
      const row = e.target.closest('.item');
      if (!row) return;
      const idx = Number(row.dataset.idx);
      const item = state.items[b.key][idx];
      if (!item) return;
      if (e.target.classList.contains('amt')) item.amount = Math.max(0, numOr(e.target.value, 0));
      else item.name = e.target.value;
      save();
      update();
    });
    list.addEventListener('click', (e) => {
      const del = e.target.closest('.item-del');
      if (!del) return;
      const idx = Number(del.closest('.item').dataset.idx);
      state.items[b.key].splice(idx, 1);
      renderItems(b.key);
      persist();
      update();
    });

    wrap.appendChild(card);
    renderItems(b.key);
  });
}

function renderItems(key) {
  const card = document.querySelector(`.bucket[data-key="${key}"]`);
  if (!card) return;
  const list = card.querySelector('[data-items]');
  const items = state.items[key] || [];
  list.innerHTML = '';
  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.idx = String(idx);
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'name';
    name.placeholder = 'Label';
    name.value = item.name;
    name.setAttribute('aria-label', 'Line item label');
    const amt = document.createElement('input');
    amt.type = 'number';
    amt.className = 'amt';
    amt.min = '0';
    amt.step = '10';
    amt.placeholder = '0';
    amt.value = item.amount ? item.amount : '';
    amt.setAttribute('aria-label', 'Line item amount');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'item-del';
    del.innerHTML = '×';
    del.setAttribute('aria-label', 'Remove line item');
    li.append(name, amt, del);
    list.appendChild(li);
  });
  card.querySelector('[data-toggler-label]').textContent = items.length ? `Line items (${items.length})` : 'Line items';
}

function update() {
  const c = compute();

  setVal($('#income'), String(state.income).replace(/\.0+$/, ''));
  $('#mpfOn').checked = !!state.mpfOn;
  $('#taxOn').checked = !!state.taxOn;
  setVal($('#allowance'), String(state.allowance));
  setVal($('#mpfCap'), String(state.mpfCap));

  setText($('#wfGross'), fmt(c.gross));
  setText($('#wfMpf'), '− ' + fmt(c.mpf));
  setText($('#wfTax'), '− ' + fmt(c.tax));
  setText($('#wfAlloc'), fmt(c.allocatable));

  const eff = c.gross > 0 ? ((c.mpf + c.tax) / c.gross) * 100 : 0;
  setText($('#effRate'), c.gross > 0
    ? `${eff.toFixed(1)}% of gross goes to MPF + tax`
    : '');

  if (state._seg) {
    const w = (v) => (c.gross > 0 ? (v / c.gross) * 100 : 0);
    state._seg.mpf.style.width = w(c.mpf) + '%';
    state._seg.tax.style.width = w(c.tax) + '%';
    BUCKETS.forEach((b) => {
      state._seg[b.key].style.width = w(c.amounts[b.key]) + '%';
    });
  }

  const note = $('#pctNote');
  if (Math.abs(c.pctSum - 100) > 0.001) {
    note.textContent = `Percentages total ${c.pctSum}% — adjust to 100%`;
    note.style.color = 'var(--b-debt)';
  } else {
    note.textContent = 'Tap a bucket to itemise it';
    note.style.color = '';
  }

  BUCKETS.forEach((b) => {
    const card = document.querySelector(`.bucket[data-key="${b.key}"]`);
    if (!card) return;
    setText(card.querySelector('[data-amount]'), fmt(c.amounts[b.key]));
    setVal(card.querySelector('[data-pct]'), String(state.pcts[b.key]));

    const items = state.items[b.key] || [];
    const assigned = items.reduce((s, i) => s + numOr(i.amount, 0), 0);
    const variance = c.amounts[b.key] - assigned;
    const el = card.querySelector('[data-variance]');
    el.classList.remove('over', 'done');
    if (!items.length) {
      el.textContent = 'Nothing itemised yet';
    } else if (Math.abs(variance) < 0.5) {
      el.textContent = 'Fully assigned';
      el.classList.add('done');
    } else if (variance > 0) {
      el.textContent = fmt(variance) + ' unassigned';
    } else {
      el.textContent = fmt(Math.abs(variance)) + ' over';
      el.classList.add('over');
    }
    card.querySelector('[data-toggler-label]').textContent = items.length ? `Line items (${items.length})` : 'Line items';
  });
}

/* ---------------- items ---------------- */

function addItem(key, name, amount) {
  state.items[key].push({ name, amount });
  renderItems(key);
  persist();
  update();
  const card = document.querySelector(`.bucket[data-key="${key}"]`);
  if (card) {
    card.classList.add('open');
    state.open[key] = true;
    const rows = card.querySelectorAll('.item input.name');
    const last = rows[rows.length - 1];
    if (last) last.focus();
  }
}

/* ---------------- CSV ---------------- */

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV() {
  const rows = [['type', 'category', 'name', 'amount']];
  rows.push(['setting', 'income', '', state.income]);
  rows.push(['setting', 'mpf_on', '', state.mpfOn ? 1 : 0]);
  rows.push(['setting', 'mpf_rate', '', state.mpfRate]);
  rows.push(['setting', 'mpf_cap', '', state.mpfCap]);
  rows.push(['setting', 'tax_on', '', state.taxOn ? 1 : 0]);
  rows.push(['setting', 'allowance', '', state.allowance]);
  BUCKETS.forEach((b) => rows.push(['setting', 'pct_' + b.key, '', state.pcts[b.key]]));
  BUCKETS.forEach((b) => state.items[b.key].forEach((it) => rows.push(['item', b.key, it.name, it.amount])));
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('empty file');

  let start = 0;
  if (rows[0][0] && rows[0][0].trim().toLowerCase() === 'type') start = 1;

  const next = defaults();
  next.items = Object.fromEntries(BUCKETS.map((b) => [b.key, []]));
  next.open = { essentials: true };
  let itemCount = 0;
  let sawSetting = false;

  for (let i = start; i < rows.length; i++) {
    const [type, category, name, amount] = rows[i];
    const kind = (type || '').trim().toLowerCase();
    const cat = (category || '').trim().toLowerCase();

    if (kind === 'setting') {
      sawSetting = true;
      switch (cat) {
        case 'income': next.income = Math.max(0, numOr(amount, next.income)); break;
        case 'mpf_on': next.mpfOn = String(amount).trim() === '1' || /true|yes/i.test(String(amount)); break;
        case 'mpf_rate': next.mpfRate = Math.max(0, numOr(amount, next.mpfRate)); break;
        case 'mpf_cap': next.mpfCap = Math.max(0, numOr(amount, next.mpfCap)); break;
        case 'tax_on': next.taxOn = String(amount).trim() === '1' || /true|yes/i.test(String(amount)); break;
        case 'allowance': next.allowance = Math.max(0, numOr(amount, next.allowance)); break;
        default:
          if (cat.startsWith('pct_')) {
            const key = cat.slice(4);
            if (key in next.pcts) next.pcts[key] = clamp(numOr(amount, next.pcts[key]), 0, 100);
          }
      }
    } else if (kind === 'item') {
      const key = cat;
      if (!(key in next.items)) continue;
      const label = (name || '').trim();
      const value = Math.max(0, numOr(amount, 0));
      if (!label && !value) continue;
      next.items[key].push({ name: label, amount: value });
      itemCount++;
    }
  }

  if (!sawSetting && itemCount === 0) throw new Error('no recognised rows');

  const keepOpen = state.open;
  state = { ...next, open: { ...keepOpen, essentials: true } };
  persist();
  mountBuckets();
  buildBar();
  update();
  return itemCount;
}

function downloadCSV() {
  const csv = toCSV();
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `paycheck-split-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setSaved('Exported ' + name);
}

/* ---------------- wiring ---------------- */

function init() {
  mountBuckets();
  buildBar();
  update();

  $('#income').addEventListener('input', (e) => {
    state.income = Math.max(0, numOr(e.target.value, 0));
    save();
    update();
  });

  $('#mpfOn').addEventListener('change', (e) => { state.mpfOn = e.target.checked; save(); update(); });
  $('#taxOn').addEventListener('change', (e) => { state.taxOn = e.target.checked; save(); update(); });

  $('#allowance').addEventListener('input', (e) => {
    state.allowance = Math.max(0, numOr(e.target.value, 0));
    save();
    update();
  });
  $('#mpfCap').addEventListener('input', (e) => {
    state.mpfCap = Math.max(0, numOr(e.target.value, 0));
    save();
    update();
  });

  $('#exportBtn').addEventListener('click', downloadCSV);

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const count = importCSV(String(reader.result));
        setSaved(`Imported ${count} line item${count === 1 ? '' : 's'}`);
      } catch (err) {
        setSaved('Could not read that CSV', true);
      }
      e.target.value = '';
    };
    reader.onerror = () => {
      setSaved('Could not read that file', true);
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Reset everything back to the default split?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    state = defaults();
    mountBuckets();
    buildBar();
    update();
    setSaved('Reset to defaults');
  });

  setSaved('Saved locally');
}

document.addEventListener('DOMContentLoaded', init);
