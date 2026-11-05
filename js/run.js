// 計算の流れ：局面 → setup → Web Worker → 結果（途中の暫定の答え・最終の答え・比較表）。実行中の様子は RUN（保存しない）に持つ
import {D, itemInputs, staminaTriggered} from './data.js';
import {S, save, deck} from './store.js';
import {buildSetup} from './setup.js';
import {startSolve, cancelSolve, resumeSolve, canResume} from './solver.js';
export {canResume};

let lastOpts = null;   // 最後に計算した予算（中止したときに残す）
export const RUN = {status: 'idle', stage: '', started: 0, interim: null, error: null, prev: null};
// a が b より良いか。届く最大の基準：達成率が高い → ドリンクが少ない → 操作が少ない。
// 達成率を指定した基準（95% など）：指定に届いているか → 設定の比べる順（既定 ドリンク → 達成率 → 操作）
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
// 計算の知らせで描き直すのは、ソリティアの画面を開いているときだけ（局面の入力中に入力欄の場所が飛ばないように）
export const setRerender = f => { rerender = () => { if (S.ui.tab === 'turn') f(); }; };

const cardsMap = () => new Map(D.cards.map(c => [c.id, c]));
const itemsMap = () => new Map(D.items.map(x => [x.id, x]));
// 局面の setup に使う P アイテムの情報（入力欄と、体力が減ったら発動するか）。デッキの P アイテムだけ
export const itemsFor = dk => { const m = itemsMap(); for (const id of dk?.items || []) { const x = m.get(id); if (x) m.set(id, {...x, inputs: itemInputs(id)?.inputs || null, stamina: staminaTriggered(id)}); } return m; };

// 今の局面の setup と目標点（この局面で取れる点を調べるときなど）
export function currentSetup(P = S.phase) { return buildSetup({deck: deck(), phase: P, cards: cardsMap(), items: itemsFor(deck())}); }

// 局面の setup の印（プレイの途中から作った局面を、作った後に直したかを見る）
export function phaseSig(P) {
  try { const {setup, target} = buildSetup({deck: deck(), phase: P, cards: cardsMap(), items: itemsFor(deck())}); return JSON.stringify([setup, target]); } catch { return null; }
}

// over：この1回だけの予算（{budgetSec, maxStates}）。「予算を2倍にして計算し直す」で使う。設定は変えない
// keep：前の答えを残す（同じ局面で予算を増やすとき）。計算中も前の答えを見せ、新しい答えが前より悪ければ前の答えを使う
export function startRun(over = {}, {keep = false} = {}) {
  const prev = keep ? S.result : null;
  const dk = deck(), P = S.phase;
  const {setup, target} = buildSetup({deck: dk, phase: P, cards: cardsMap(), items: itemsFor(deck())});
  const phase0 = structuredClone(P);   // 計算した局面（次のターンの局面を作るときの元）
  const st = S.settings;
  // 達成の基準：設定「95%の答えも出す」（既定オン）なら達成率最大と95%を並べて出す。外すと達成率最大だけ（速い）。1.8.1、利用者の決定
  const opts = {...(st.both === false ? {criterion: 'max'} : {criterion: '95', both: true}), order: st.order, extras: ['ev', 'floor'].filter(k => st.extras[k]), maxMs: Math.max(1, over.budgetSec ?? st.budgetSec) * 1000, maxStates: over.maxStates ?? st.maxStates};
  lastOpts = opts;
  Object.assign(RUN, {status: 'running', stage: '準備中', started: Date.now(), interim: null, error: null, prev});
  S.result = null; S.play = null; save();
  // プレイの途中から作った局面を、直さずに計算するときは、前の最適の答えから即答を試す（worker.js の follow。同じでなければ計算し直す）
  const fw = P.carry?.follow;
  const follow = fw?.path?.length && fw.sig && fw.sig === JSON.stringify([setup, target]) && JSON.stringify(fw.calcSettings ?? null) === JSON.stringify(S.calcSettings ?? null) ? {path: fw.path} : null;
  startSolve({setup, target, opts, calcSettings: S.calcSettings, follow}, {
    progress: m => { RUN.stage = m.stage; rerender(); },
    update: m => { RUN.interim = m.result; rerender(); },
    result: m => {
      const fresh = {...m.result, target, setup, phase: phase0, budgetSec: opts.maxMs / 1000, maxStates: opts.maxStates, calcSettings: S.calcSettings, deckId: dk.id, table: null, at: Date.now()};
      // 新しい答えが最適でなく、前の答えのほうが良ければ、前の答えを使う（予算は新しいほうを残す）
      S.result = prev && fresh.kind !== 'optimal' && betterThan(prev, fresh) ? {...prev, budgetSec: fresh.budgetSec, maxStates: fresh.maxStates, keptPrev: true, table: prev.table} : fresh;
      if (S.result.keptPrev) { RUN.status = 'done'; RUN.prev = null; save(); rerender(); return; } RUN.status = m.result.kind === 'incomplete' ? 'done' : 'table'; RUN.prev = null; RUN.stage = '比較表を計算中'; save(); rerender(); },
    table: m => { if (S.result?.keptPrev) return; if (S.result) S.result.table = m.rows ? {rows: m.rows} : {note: m.note}; RUN.status = 'done'; save(); rerender(); },
    error: m => { RUN.status = 'error'; RUN.error = m.message; rerender(); },
  });
  rerender();
}

// 続きから計算する：前の計算（同じ局面）を捨てずに、addSec 秒を足して続ける。前の答えは計算中も見せ、悪くなれば残す
export function resumeRun(addSec) {
  const prev = S.result;
  if (!prev || !canResume()) return false;
  Object.assign(RUN, {status: 'running', stage: '続きから計算中', started: Date.now(), interim: null, error: null, prev});
  lastOpts = {maxMs: (prev.budgetSec + addSec) * 1000, maxStates: prev.maxStates};
  const ok = resumeSolve(addSec * 1000, {
    progress: m => { RUN.stage = m.stage; rerender(); },
    update: m => { RUN.interim = m.result; rerender(); },
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

// 中止：最終の答えの前なら、途中の暫定の答えを「暫定（中止）」として残す
export function cancelRun() {
  cancelSolve();
  if (RUN.status === 'running') {
    if (RUN.prev && !betterThan(RUN.interim, RUN.prev)) S.result = RUN.prev;
    else if (RUN.interim) S.result = {...RUN.interim, final: true, canceled: true, table: null, at: Date.now(), deckId: deck()?.id, phase: structuredClone(S.phase), budgetSec: lastOpts.maxMs / 1000, maxStates: lastOpts.maxStates};
    RUN.status = 'canceled'; RUN.prev = null;
  } else if (RUN.status === 'table') { if (S.result) S.result.table = {note: '中止しました'}; RUN.status = 'done'; }
  save(); rerender();
}
