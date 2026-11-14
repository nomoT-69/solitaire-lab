import {D, itemInputs, staminaTriggered} from './data.js?v=1.17.12';
import {S, save, deck} from './store.js?v=1.17.12';
import {buildSetup} from './setup.js?v=1.17.12';
import {startSolve, cancelSolve, resumeSolve, canResume} from './solver.js?v=1.17.12';
export {canResume};

let lastOpts = null;
export const RUN = {status: 'idle', stage: '', started: 0, interim: null, error: null, prev: null};
export function betterThan(a, b) {
  if (!a?.best) return false; if (!b?.best) return true;
  const x = a.best, y = b.best;
  const crit = a.criterion ?? b.criterion;
  if (crit && crit !== 'max') {
    const ma = a.meetsAlpha !== false && x.pNum >= Number(crit) / 100 - 1e-12, mb = b.meetsAlpha !== false && y.pNum >= Number(crit) / 100 - 1e-12;
    if (ma !== mb) return ma;
    if (!ma) return x.pNum > y.pNum;
    for (const k of (a.order || b.order || 'dpa').split('')) {
      const u = x[k + 'Num'], v = y[k + 'Num'];
      if (u !== v) return k === 'p' ? u > v : u < v;
    }
    return false;
  }
  return x.pNum !== y.pNum ? x.pNum > y.pNum : x.dNum !== y.dNum ? x.dNum < y.dNum : x.aNum < y.aNum;
}
let rerender = () => {};
export const setRerender = f => { rerender = () => { if (S.ui.tab === 'turn') f(); }; };

const cardsMap = () => new Map(D.cards.map(c => [c.id, c]));
const itemsMap = () => new Map(D.items.map(x => [x.id, x]));
export const itemsFor = dk => { const m = itemsMap(); for (const id of dk?.items || []) { const x = m.get(id); if (x) m.set(id, {...x, inputs: itemInputs(id)?.inputs || null, stamina: staminaTriggered(id)}); } return m; };

export function currentSetup(P = S.phase) { return buildSetup({deck: deck(), phase: P, cards: cardsMap(), items: itemsFor(deck())}); }

export function phaseSig(P) {
  try { const {setup, target} = buildSetup({deck: deck(), phase: P, cards: cardsMap(), items: itemsFor(deck())}); return JSON.stringify([setup, target]); } catch { return null; }
}

export function startRun(over = {}, {keep = false} = {}) {
  const prev = keep ? S.result : null;
  const dk = deck(), P = S.phase;
  const {setup, target} = buildSetup({deck: dk, phase: P, cards: cardsMap(), items: itemsFor(deck())});
  const phase0 = structuredClone(P);
  const st = S.settings;
  const beyond = !!P.params?.beyondGoal;
  const saveD = !beyond && !!P.params?.saveDrinks;
  const opts = {...(!saveD || st.both === false ? {criterion: 'max'} : {criterion: '95', both: true}), order: saveD ? st.order : 'pa', ...(beyond ? {beyondGoal: true} : {}), ...(st.testTree ? {treeLimit: st.testTree.limit, topPaths: st.testTree.top} : {}), extras: ['ev', 'floor'].filter(k => st.extras[k]), maxMs: Math.max(1, over.budgetSec ?? st.budgetSec) * 1000, maxStates: over.maxStates ?? st.maxStates};
  lastOpts = opts;
  Object.assign(RUN, {status: 'running', stage: '準備中', started: Date.now(), interim: null, interimTree: null, error: null, prev});
  S.result = null; S.play = null; save();
  const fw = P.carry?.follow;
  const follow = fw?.path?.length && fw.sig && fw.sig === JSON.stringify([setup, target]) && JSON.stringify(fw.calcSettings ?? null) === JSON.stringify(S.calcSettings ?? null) ? {path: fw.path} : null;
  startSolve({setup, target, opts, calcSettings: S.calcSettings, follow}, {
    progress: m => { RUN.stage = m.stage; rerender(); },
    update: m => { RUN.interim = m.result; if (m.result?.tree) RUN.interimTree = m.result; rerender(); },
    result: m => {
      const fresh = {...m.result, target, setup, phase: phase0, budgetSec: opts.maxMs / 1000, maxStates: opts.maxStates, calcSettings: S.calcSettings, deckId: dk.id, table: null, at: Date.now()};
      S.result = prev && fresh.kind !== 'optimal' && betterThan(prev, fresh) ? {...prev, budgetSec: fresh.budgetSec, maxStates: fresh.maxStates, keptPrev: true, table: prev.table} : fresh;
      if (S.result.keptPrev) { RUN.status = 'done'; RUN.prev = null; save(); rerender(); return; } RUN.status = m.result.kind === 'incomplete' ? 'done' : 'table'; RUN.prev = null; RUN.stage = '比較表を計算中'; save(); rerender(); },
    table: m => { if (S.result?.keptPrev) return; if (S.result) S.result.table = m.rows ? {rows: m.rows} : {note: m.note}; RUN.status = 'done'; save(); rerender(); },
    error: m => { RUN.status = 'error'; RUN.error = m.message; rerender(); },
  });
  rerender();
}

export function resumeRun(addSec) {
  const prev = S.result;
  if (!prev || !canResume()) return false;
  Object.assign(RUN, {status: 'running', stage: '続きから計算中', started: Date.now(), interim: null, interimTree: null, error: null, prev});
  lastOpts = {maxMs: (prev.budgetSec + addSec) * 1000, maxStates: prev.maxStates};
  const ok = resumeSolve(addSec * 1000, {
    progress: m => { RUN.stage = m.stage; rerender(); },
    update: m => { RUN.interim = m.result; if (m.result?.tree) RUN.interimTree = m.result; rerender(); },
    result: m => {
      const fresh = {...m.result, target: prev.target, setup: prev.setup, phase: prev.phase, budgetSec: prev.budgetSec + addSec, maxStates: prev.maxStates,
        calcSettings: prev.calcSettings, deckId: prev.deckId, table: null, at: Date.now(), resumedSec: (prev.resumedSec || 0) + addSec};
      S.result = fresh.kind !== 'optimal' && betterThan(prev, fresh) ? {...prev, budgetSec: fresh.budgetSec, resumable: fresh.resumable, keptPrev: true} : fresh;
      S.play = null; RUN.status = m.result.kind === 'incomplete' ? 'done' : 'table'; RUN.prev = null; save(); rerender(); },
    table: m => { if (!S.result?.keptPrev && S.result) S.result.table = m.rows ? {rows: m.rows} : {note: m.note}; RUN.status = 'done'; save(); rerender(); },
    error: m => { RUN.status = 'error'; RUN.error = m.message; rerender(); },
  });
  rerender();
  return ok;
}

export const lastBudget = () => (lastOpts?.maxMs ?? S.settings.budgetSec * 1000) / 1000;
export function cancelRun() {
  cancelSolve();
  if (RUN.status === 'running') {
    if (RUN.prev && !betterThan(RUN.interim, RUN.prev)) S.result = RUN.prev;
    else if (RUN.interim) S.result = {...(RUN.interim.tree ? RUN.interim : RUN.interimTree || RUN.interim), final: true, canceled: true, table: null, at: Date.now(), deckId: deck()?.id, phase: structuredClone(S.phase), budgetSec: lastOpts.maxMs / 1000, maxStates: lastOpts.maxStates};
    RUN.status = 'canceled'; RUN.prev = null;
  } else if (RUN.status === 'table') { if (S.result) S.result.table = {note: '比較表は途中でやめました'}; RUN.status = 'done'; }
  save(); rerender();
}
