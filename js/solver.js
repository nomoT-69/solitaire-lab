// 画面の側から計算を動かす（Web Worker の起動・中止・知らせの受け取り）。計算中も画面は固まらない。
import {D} from './data.js';

let worker = null, seq = 0, H = null, resumable = false, followable = false;
// handlers：{progress, update, result, table, error}。それぞれ worker からの知らせ（worker.js の先頭の説明）を受け取る
// 答えが「続きから計算できる」（resumable）ときは、スレッドを止めずに残す（resumeSolve で続ける）
// 答えが最適で、続きの局面を即答できる（canFollow）ときも、スレッドを残す。次の計算はそのスレッドで行い、follow:{path} があれば続きの局面の即答を、
// なければ同じ局面で目標・基準を変えた答えの使い回し（retarget）を試す。どちらも使えなければ、前の計算を捨てて計算し直す（worker.js）
export function startSolve({setup, target, opts, calcSettings, follow = null}, handlers) {
  const reuse = !!worker && followable;
  if (!reuse) cancelSolve();
  const id = ++seq; H = handlers; resumable = false; followable = false;
  if (!reuse) worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  worker.onmessage = e => {
    if (e.data.id !== seq) return;
    if (e.data.type === 'result') { resumable = !!e.data.result?.resumable; followable = !!e.data.result?.canFollow; }
    H[e.data.type]?.(e.data);
    if (e.data.type === 'error' || (e.data.type === 'table' && !resumable && !followable)) cancelSolve();
  };
  worker.onerror = e => { H.error?.({message: '計算のスレッドで問題が起きました：' + (e.message || '読み込みの失敗')}); cancelSolve(); };
  worker.postMessage({type: 'solve', id, csv: D.csv, calcSettings, setup, target, opts, follow: reuse ? follow : null, reuse});
  return id;
}
// 続きから計算する（前の計算を持ったスレッドがあるときだけ）。maxMs：足す時間
export function canResume() { return !!worker && resumable; }
export function resumeSolve(maxMs, handlers) {
  if (!canResume()) return false;
  H = handlers; resumable = false;
  worker.postMessage({type: 'resume', id: seq, maxMs});
  return true;
}
// 中止：スレッドごと止める（計算の途中でも、すぐ止まる）。続きからの計算もできなくなる
export function cancelSolve() { worker?.terminate(); worker = null; resumable = false; followable = false; }
export const isRunning = () => !!worker;

// 足した札の点検（Talos と Tecnai の照合）。計算とは別のスレッドで動かす
let inspector = null;
export function startInspect({ids, calcSettings, opts}, {done, error}) {
  inspector?.terminate();
  inspector = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  const end = () => { inspector?.terminate(); inspector = null; };
  inspector.onmessage = e => { if (e.data.type === 'inspected') { done(e.data.result); end(); } else if (e.data.type === 'error') { error(e.data.message); end(); } };
  inspector.onerror = e => { error('点検のスレッドで問題が起きました：' + (e.message || '読み込みの失敗')); end(); };
  inspector.postMessage({type: 'inspect', id: 1, csv: D.csv, calcSettings, ids, opts});
}
export function cancelInspect() { inspector?.terminate(); inspector = null; }

// 次のターンの局面：プレイでたどった道筋の最後の局面の中身をもらう
export function turnEnd({setup, target, calcSettings, path}, {done, error}) {
  const w = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  w.onmessage = e => { if (e.data.type === 'turnEnd') done(e.data.state); else if (e.data.type === 'error') error(e.data.message); w.terminate(); };
  w.onerror = e => { error('計算のスレッドで問題が起きました：' + (e.message || '読み込みの失敗')); w.terminate(); };
  w.postMessage({type: 'nextTurn', id: 1, csv: D.csv, setup, target, calcSettings, path});
}
