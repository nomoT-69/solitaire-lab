import {D, has, imgUrl} from './data.js?v=1.17.12';
import {S} from './store.js?v=1.17.12';

export function h(tag, attrs = {}, ...kids) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [t0, ...cls] = tag.split('.');
  const [t, id] = t0.split('#');
  const el = document.createElement(t || 'div');
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

export function pic(kind, id, label, size = 56) {
  if (S.settings.images && has(kind, id)) return h('img.pic', {src: imgUrl(kind, id), alt: label, width: size, height: size, loading: 'lazy', draggable: false});
  return h('div.pic.noimg', {style: {width: size + 'px', height: size + 'px'}}, label.slice(0, size < 40 ? 2 : 6));
}

const TYPE_JA = {active: 'アクティブ', mental: 'メンタル', trouble: 'トラブル'};
const STANCE_JA = {strength: '強気', preservation: '温存', leisure: 'のんびり'};
const SIZES = {large: 80, medium: 60, small: 46};
export function cardTile(entry, {marks = [], draggable = false, onclick, size = 'medium', selected = false, count = 0} = {}) {
  const c = D.cardById.get(entry.id);
  const name = c ? c.name : '不明な札 ' + entry.id;
  const cust = entry.c11n && Object.values(entry.c11n).some(v => v > 0);
  const tip = [name, c && TYPE_JA[c.type], c?.stance && '指針：' + STANCE_JA[c.stance], entry.hif && 'HIF', cust && 'カスタマイズあり', c?.text].filter(Boolean).join('\n');
  const el = h('div.card', {class: ['sz-' + size, selected && 'sel', c?.type === 'trouble' && 'trouble', c?.stance ? 'st-' + c.stance : 'st-none'].filter(Boolean).join(' '), title: tip,
    draggable, onclick, tabIndex: onclick ? 0 : null, 'data-uid': entry.uid},
    h('div.stbar', c?.stance ? STANCE_JA[c.stance] : ''),
    h('div.picwrap', pic('cards', entry.id, name, SIZES[size] || 60),
      (entry.hif || cust) && h('div.badges', entry.hif && h('span.b.hif', 'HIF'), cust && h('span.b.cust', 'カ')),
      count > 1 && h('span.count', '×' + count)),
    h('div.nm', name),
    marks.length ? h('div.marks', marks) : null);
  if (draggable) el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', entry.uid); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  if (draggable) el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

let pop = null, popOnClose = null;
export function closePop(user = false) { const cb = user ? popOnClose : null; popOnClose = null; pop?.remove(); pop = null; document.removeEventListener('keydown', popKey, true); cb?.(); }
function popKey(e) {
  if (!pop) return;
  if (e.key === 'Escape') { closePop(true); e.preventDefault(); return; }
  if (e.target.closest?.('input, select')) return;
  const b = pop.querySelector(`[data-key="${CSS.escape(e.key)}"]`);
  if (b && !b.disabled) { b.click(); e.preventDefault(); }
}
export function popover(anchor, title, items, {onclose = null} = {}) {
  closePop();
  popOnClose = onclose;
  const r = anchor.getBoundingClientRect();
  pop = h('div.pop', {}, title && h('div.pop-t', title),
    items.map(it => it instanceof Node ? it : h('button.pop-i', {class: it.cls, disabled: it.disabled, 'data-key': it.key, onclick: () => { closePop(); it.onclick(); }},
      it.key && h('kbd', it.key), it.label)));
  document.body.append(pop);
  const w = pop.offsetWidth, ht = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  pop.style.top = (r.bottom + ht + 8 < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - ht - 4)) + window.scrollY + 'px';
  document.addEventListener('keydown', popKey, true);
}
document.addEventListener('mousedown', e => { if (pop && !pop.contains(e.target)) closePop(true); });

export function toast(msg) {
  const t = h('div.toast', {}, msg); document.body.append(t);
  setTimeout(() => t.classList.add('out'), 1800); setTimeout(() => t.remove(), 2300);
}

export const num = (label, value, onchange, {step = 1, min = null, max = null, hint = '', width = 7} = {}) =>
  h('label.f', {}, h('span.fl', label), h('input', {type: 'number', value: value ?? '', step, min, max, style: {width: width + 'em'},
    onchange: e => onchange(e.target.value === '' ? null : Number(e.target.value))}), hint && h('span.hint', hint));

export const sel = (label, value, options, onchange) =>
  h('label.f', {}, label && h('span.fl', label), h('select', {onchange: e => onchange(e.target.value)},
    options.map(([v, t]) => h('option', {value: v, selected: String(v) === String(value)}, t))));

export const fmt = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('ja-JP');

export const qtip = text => h('span.qtip', {'data-tip': text, tabIndex: 0, 'aria-label': text, role: 'note'}, '?');
let tipEl = null, tipFor = null;
function showTip(el) {
  if (tipFor === el) return; hideTip();
  tipEl = document.createElement('div'); tipEl.className = 'tipbox'; tipEl.textContent = el.dataset.tip; document.body.append(tipEl); tipFor = el;
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, hgt = tipEl.offsetHeight;
  let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8), y = r.bottom + 6;
  if (y + hgt > innerHeight - 8) y = r.top - hgt - 6;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
function hideTip() { tipEl?.remove(); tipEl = null; tipFor = null; }
const tipOf = e => e.target?.closest?.('.qtip[data-tip]');
document.addEventListener('mouseover', e => { const el = tipOf(e); if (el) showTip(el); });
document.addEventListener('mouseout', e => { const el = tipOf(e); if (el && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('focusin', e => { const el = tipOf(e); if (el) showTip(el); });
document.addEventListener('focusout', e => { if (tipOf(e)) hideTip(); });
document.addEventListener('click', e => { const el = tipOf(e); if (el) { e.stopPropagation(); showTip(el); } else hideTip(); }, true);
document.addEventListener('scroll', hideTip, true);
