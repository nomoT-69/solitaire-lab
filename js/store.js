const KEY = 'aegis.v1';
const OLD_KEYS = ['gakumasu-solitaire-gui.v1'];
export const uid = () => Math.random().toString(36).slice(2, 9);

export const STANCES = [['preservation', '温存'], ['preservation2', '温存2段階'], ['leisure', 'のんびり'], ['strength', '強気'], ['strength2', '強気2段階']];

export const defaultSettings = () => ({
  order: 'dpa',
  criterion: 'max',
  both: true,
  extras: {ev: false, floor: false},
  budgetSec: 60, maxStates: 20000000,
  images: true,
});

export const defaultParams = () => ({
  stance: 'preservation', prevStance: 'none', cardUses: 1, enthusiasm: 0, enthusiasmBonus: 0, enthusiasmBuff: 1, scoreBuff: 0,
  target: null, trial: 1, drinkCap: null, turnsRemaining: 1,
  preservationTimes: 0, strengthTimes: 0, leisureTimes: 0, directStanceTimes: 0,
  gameDeckCount: null,
  nullifyCostCards: 0,
  fullPowerCharge: null,
  saveDrinks: false,
  cumulativeFullPowerCharge: null,
});

export const newDeck = name => ({id: uid(), name, cards: [], drinks: [], items: [], pidol: null, updated: Date.now()});
export const newPhase = deckId => ({deckId, zones: {}, held: [], extra: [], assume: {}, drinksHeld: [], itemState: {}, registered: [], params: defaultParams()});

function load() {
  for (const k of [KEY, ...OLD_KEYS]) { try { const s = JSON.parse(localStorage.getItem(k)); if (s && s.decks) return s; } catch {} }
  return null;
}
export const S = load() || {decks: [], deckId: null, phase: null, history: [], settings: defaultSettings(), calcSettings: null, ui: {tab: 'deck'}};
S.calcSettings ??= null;
S.settings = {...defaultSettings(), ...S.settings, extras: {...defaultSettings().extras, ...(S.settings?.extras || {})}};
S.ui ||= {tab: 'deck'};
S.history ||= [];
migrateSave(S);

function migrateSave(s) {
  const fix = P => { const q = P?.params; if (!q || 'saveDrinks' in q) return; q.saveDrinks = !q.lastExam; delete q.lastExam; };
  fix(s.phase); for (const h of s.history || []) fix(h.phase); fix(s.result?.phase);
}

const IDB = 'aegis.trees';
function idb() { return new Promise((ok, ng) => { try { const q = indexedDB.open(IDB, 1); q.onupgradeneeded = () => q.result.createObjectStore('t'); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); } catch (e) { ng(e); } }); }
async function idbPut(v) { try { const db = await idb(); await new Promise((ok, ng) => { const x = db.transaction('t', 'readwrite'); x.objectStore('t').put(v, 'result'); x.oncomplete = ok; x.onerror = () => ng(x.error); }); db.close(); return true; } catch { return false; } }
async function idbGet() { try { const db = await idb(); const v = await new Promise((ok, ng) => { const q = db.transaction('t').objectStore('t').get('result'); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); }); db.close(); return v; } catch { return null; } }
export async function restoreTrees() {
  const R = S.result; if (!R?.treeDropped && !R?.alt?.treeDropped) return false;
  const v = await idbGet(); if (!v || v.at !== R.at) return false;
  if (v.tree) { R.tree = v.tree; R.treeDropped = false; }
  if (v.alt && R.alt) { R.alt.tree = v.alt; R.alt.treeDropped = false; }
  return true;
}
let lastIdbAt = null;
let t = null;
export function save() { clearTimeout(t); t = setTimeout(() => {
  const slim = r => r && {...r, tree: null, treeDropped: !!(r.tree || r.treeDropped), alt: r.alt && {...r.alt, tree: null, treeDropped: !!(r.alt.tree || r.alt.treeDropped)}};
  let s = JSON.stringify(S);
  const LIM = globalThis.SL_SAVE_LIMIT ?? 3e6;
  const big = s.length > LIM && !!S.result;
  if (big) s = JSON.stringify({...S, result: slim(S.result)});
  if (!big) lastIdbAt = null; else if (lastIdbAt !== S.result.at && (S.result.tree || S.result.alt?.tree)) { lastIdbAt = S.result.at; idbPut({at: S.result.at, tree: S.result.tree || null, alt: S.result.alt?.tree || null}); }
  try { localStorage.setItem(KEY, s); } catch {
    if (S.result && lastIdbAt !== S.result.at && (S.result.tree || S.result.alt?.tree)) { lastIdbAt = S.result.at; idbPut({at: S.result.at, tree: S.result.tree || null, alt: S.result.alt?.tree || null}); }
    try { localStorage.setItem(KEY, JSON.stringify({...S, result: slim(S.result), history: S.history.slice(0, 5)})); } catch {}
  }
}, 150); }
export const deck = () => S.decks.find(d => d.id === S.deckId) || null;
export function replaceAll(obj) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, obj); S.settings = {...defaultSettings(), ...S.settings}; S.ui ||= {tab: 'deck'}; S.history ||= []; S.calcSettings ??= null; migrateSave(S); save(); }
export const exportData = () => ({format: 'aegis-user-data', version: 1, exported: new Date().toISOString().slice(0, 10), ...S});
