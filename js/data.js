import {parseCsv, loadData, cardVariant} from '../engine/talos/data.mjs?v=1.17.12';
import {defaultSettings as defaultCalcSettings, validateSettings, applySettings} from '../engine/talos/settings.mjs?v=1.17.12';
import {unsupportedList, pItemInputs} from '../engine/talos/support.mjs?v=1.17.12';

const CSV_KEY = 'aegis.csv.v1';
export const HIDDEN_CARDS = new Set([]);
export const CSV_FILES = {skillCards: 'skill_cards.csv', pDrinks: 'p_drinks.csv', pItems: 'p_items.csv', customizations: 'customizations.csv', pIdols: 'p_idols.csv'};
export function loadUserCsv() { try { return JSON.parse(localStorage.getItem(CSV_KEY)); } catch { return null; } }
export function saveUserCsv(o) { if (o) localStorage.setItem(CSV_KEY, JSON.stringify(o)); else localStorage.removeItem(CSV_KEY); }

const GT = 'data/gakumas-tools/';
const CSV = GT + 'csv/';
export const PLAN_NAME = {anomaly: 'アノマリー', sense: 'センス', logic: 'ロジック', free: 'フリー'};
const txt = async u => { const r = await fetch(u); if (!r.ok) throw Error('読み込めません: ' + u); return r.text(); };

export function norm(s) {
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・♪！!？?、。,.\-ー〜~「」『』()（）]/g, '');
}

export const D = {cards: [], cardById: new Map(), drinks: [], items: [], pidols: [], custs: new Map(), idols: new Map(),
  aliases: {cards: {}, drinks: {}, items: {}}, images: null, version: null, csv: null, license: ''};

export async function loadAll() {
  const ver = await txt('version.json').catch(() => null);
  const verObj = ver ? JSON.parse(ver) : null;
  let [sc, dr, it, pi, cu, idols, al, man, lic] = await Promise.all([
    txt(CSV + 'skill_cards.csv'), txt(CSV + 'p_drinks.csv'), txt(CSV + 'p_items.csv'), txt(CSV + 'p_idols.csv'), txt(CSV + 'customizations.csv'),
    txt('data/idols.csv'), txt('data/aliases.json'), verObj && !verObj.images ? null : txt('assets/third-party/manifest.json').catch(() => null),
    txt(GT + 'LICENSE').catch(() => '')]);
  const user = loadUserCsv();
  const pick = (k, v) => user?.files?.[k] || v;
  D.csvSource = user?.files ? {kind: 'user', loaded: user.loaded, names: Object.keys(user.files).map(k => CSV_FILES[k])} : {kind: 'bundled'};
  [sc, dr, it, pi, cu] = [pick('skillCards', sc), pick('pDrinks', dr), pick('pItems', it), pick('pIdols', pi), pick('customizations', cu)];
  D.csv = {skillCards: sc, pDrinks: dr, pItems: it, customizations: cu};
  D.license = lic;
  D.version = verObj || {app: 'Solitaire Lab', gui: '不明', engine: {}, data: {}, images: null};
  for (const r of parseCsv(idols)) D.idols.set(r.id, r.name.replace(' ', ''));
  D.aliases = JSON.parse(al);
  D.images = man ? JSON.parse(man) : null;
  for (const r of parseCsv(cu)) D.custs.set(r.id, {id: r.id, name: r.name, max: Number(r.max) || 1});

  const rows = parseCsv(sc);
  const pidolRows = parseCsv(pi);
  const idolOfPidol = new Map(pidolRows.map(r => [r.id, r.idolId]));
    const byName = new Map(rows.map(r => [r.name, r]));
  for (const r of rows) {
    const up = r.upgraded === 'TRUE';
    const baseName = r.name.replace(/\+$/, '');
    const base = up ? byName.get(baseName) : r;
    const plus = up ? r : byName.get(r.name + '+');
    const grow = /target:this\s*\{[^}]*g\.(score|scoreTimes)\+=/.test(r.effects);
    const lim = grow ? Number((r.effects.match(/limit:(\d+)/) || [])[1] || 0) : 0;
    const c = {id: Number(r.id), name: r.name, baseName, upgraded: up, baseId: Number(base?.id ?? r.id), plusId: plus ? Number(plus.id) : null,
      rarity: r.rarity, type: r.type, plan: r.plan, unique: r.unique === 'TRUE', sourceType: r.sourceType,
      idol: r.pIdolId ? D.idols.get(idolOfPidol.get(r.pIdolId)) : null,
      once: r.limit === '1', custs: r.availableCustomizations ? r.availableCustomizations.split(',').map(s => s.trim()) : [],
      stance: (r.actions.match(/setStance\((strength|preservation|leisure)/) || [])[1] || null,
      growth: grow ? {limit: lim, score: Number((r.effects.match(/target:this\s*\{[^}]*g\.score\+=(\d+)/) || [])[1] || 0), times: Number((r.effects.match(/target:this\s*\{[^}]*g\.scoreTimes\+=(\d+)/) || [])[1] || 0)} : null,
      registers: /at:cardUsed\s*\{\s*effectCounter/.test(r.actions) ? {counter: true}
        : /at:beforeCardUsed\s*\{.*limit:\d+/.test(r.actions) ? {limit: Number(r.actions.match(/at:beforeCardUsed\s*\{.*?limit:(\d+)/)[1])} : null,
      text: [r.actions, r.effects].filter(Boolean).join(' / ')};
    c.hidden = HIDDEN_CARDS.has(c.baseId);
    const all3 = [r.cost, r.actions, r.effects].join(' ');
    c.fp = /fullPowerCharge/.test(all3); c.cfp = /cumulativeFullPowerCharge/.test(all3);
    D.cards.push(c); D.cardById.set(c.id, c);
  }
  for (const r of parseCsv(dr)) D.drinks.push({id: Number(r.id), name: r.name, plan: r.plan, text: r.actions});
  for (const r of parseCsv(it)) if (r.effects)
    D.items.push({id: Number(r.id), name: r.name, plan: r.plan, upgraded: r.upgraded === 'TRUE', idol: r.pIdolId ? D.idols.get(idolOfPidol.get(r.pIdolId)) : null,
      counter: /effectCounter/.test(r.effects), limit: Number((r.effects.match(/limit:(\d+)/) || [])[1] || 0), text: r.effects});
  for (const r of pidolRows)
    D.pidols.push({id: Number(r.id), name: (D.idols.get(r.idolId) || '') + '【' + r.title + '】', rarity: r.rarity, title: r.title, plan: r.plan});
  for (const kind of ['cards', 'drinks', 'items']) {
    const list = kind === 'cards' ? D.cards : D[kind];
    for (const x of list) x.alias = Object.entries(D.aliases[kind] || {}).filter(([, full]) => x.name.replace(/\+$/, '') === full).map(([a]) => a);
    for (const x of list) x.key = norm(x.name) + ' ' + x.alias.map(norm).join(' ') + ' ' + (x.idol ? norm(x.idol) : '');
  }
  for (const x of D.pidols) x.key = norm(x.name);
}

export function search(list, q, limit = 40) {
  const n = norm(q);
  if (!n) return list.slice(0, limit);
  const hit = list.filter(x => x.key.includes(n));
  const score = x => (x.alias?.some(a => norm(a) === n) || norm(x.name) === n ? 0 : x.key.startsWith(n) || x.alias?.some(a => norm(a).startsWith(n)) ? 1 : 2);
  return hit.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

export const has = (kind, id) => !!D.images?.[kind]?.includes(Number(id));
export const imgUrl = (kind, id) => `assets/third-party/${kind}/${id}.webp`;

export const calcDefaults = () => defaultCalcSettings();
let baseData = null;
const base = () => (baseData ||= loadData(D.csv));
const checkCache = new Map();
const inputsCache = new Map();
export function itemInputs(id) {
  const b = base();
  if (inputsCache.get('base') !== b) { inputsCache.clear(); inputsCache.set('base', b); }
  if (!inputsCache.has(id)) { let v = null; try { v = pItemInputs(b, {ids: [id]})[0] || null; } catch {} inputsCache.set(id, v); }
  return inputsCache.get(id);
}
export const staminaTriggered = id => /at:staminaDecreased/.test(D.items.find(x => x.id === id)?.text || '');
export function checkCalcSettings(settings) {
  const k = JSON.stringify(settings);
  if (!checkCache.has(k)) { if (checkCache.size > 50) checkCache.clear(); checkCache.set(k, validateSettings(base(), settings)); }
  return checkCache.get(k);
}
export function hifSharedLimit(settings, baseId) {
  const g = (settings || calcDefaults()).abilities?.HIF?.find(g => g.cards.includes(baseId) && g.shared != null);
  return g ? Number((String(g.shared).match(/limit:(\d+)/) || [])[1] || 0) || null : null;
}
export function hifSharedKind(settings, baseId) {
  const g = (settings || calcDefaults()).abilities?.HIF?.find(g => g.cards.includes(baseId) && g.shared != null);
  const t = String(g?.shared || '');
  return /drawCard/.test(t) ? '再動＆ドロー' : /removeRandom/.test(t) ? '眠気除去' : '再動';
}
export const hifOldStyle = (settings, baseId) => !!settings?.abilities?.HIF && !hifSharedLimit(settings, baseId) && !!hifSharedLimit(null, baseId) && hifOk(settings, baseId);
export const LIFE_TIMES = 2;
export const CONTACT = {profile: 'https://x.com/satosi_kubo', mshm: 'https://marshmallow-qa.com/a4q2vyysr5enxfg', url: 'https://x.com/satosi_kubo/status/2119049241457004711', name: '@satosi_kubo'};
export const lifeOn = en => D.cardById.get(en?.id)?.baseId === 849 && en.life !== false;
export const lifeAble = en => D.cardById.get(en?.id)?.baseId === 849;
export const hifOk = (settings, baseId) => !!(settings || calcDefaults()).abilities?.HIF?.some(g => g.cards.includes(baseId));

let unsupCache = {k: null, v: null};
export function unsupported(settings) {
  const k = JSON.stringify(settings);
  if (unsupCache.k !== k) {
    let data;
    try { data = applySettings(loadData(D.csv), settings || calcDefaults()); } catch { data = loadData(D.csv); }
    const v = unsupportedList(data);
    v.cardIds = new Map(v.cards.map(c => [c.id, c.problems]));
    unsupCache = {k, v};
  }
  return unsupCache.v;
}

export function syncCustomCards(settings) {
  for (let i = D.cards.length - 1; i >= 0; i--) if (D.cards[i].id < 0) { D.cardById.delete(D.cards[i].id); D.cards.splice(i, 1); }
  for (const c of settings?.customCards || []) {
    if (!Number.isInteger(c.id) || c.id >= 0) continue;
    const x = {id: c.id, name: c.name || '（名前なし）', baseName: c.name || '', upgraded: false, baseId: c.id, plusId: null, rarity: '', type: c.type || 'mental', plan: 'free',
      custom: true, unique: false, sourceType: 'custom', idol: null, once: !!c.once, custs: [], growth: null, registers: null,
      stance: ((c.actions || '').match(/setStance\((strength|preservation|leisure)/) || [])[1] || null, text: c.actions || '', alias: ['自作']};
    x.key = norm(x.name) + ' じさく';
    D.cards.push(x); D.cardById.set(x.id, x);
  }
}

export function startGrowthOf(en) {
  try { const k = cardVariant(base(), en.id, {c11n: en.c11n || null, abilities: en.hif ? ['HIF'] : []}); return base().cards.get(k)?.startGrowth || {score: 0, scoreTimes: 0}; }
  catch { return {score: 0, scoreTimes: 0}; }
}
