import {D} from './data.js?v=1.17.12';

class PcWorker {
  constructor() {
    this.chain = fetch(PC_BASE() + '__pc/new', {method: 'POST'}).then(r => r.json()).then(({id}) => {
      this.id = id;
      this.es = new EventSource(PC_BASE() + '__pc/events?id=' + id);
      this.es.onmessage = e => this.onmessage?.({data: JSON.parse(e.data)});
      this.es.onerror = () => { if (!this.dead && this.es.readyState === 2) this.onerror?.({message: 'PC の計算とのつながりが切れました（サーバーを閉じましたか？）'}); };
    }).catch(e => this.onerror?.({message: 'PC の計算につなげません：' + e.message}));
  }
  postMessage(m) { this.chain = this.chain.then(() => this.dead ? null : fetch(PC_BASE() + '__pc/send?id=' + this.id, {method: 'POST', body: JSON.stringify(m)})); }
  terminate() { if (this.dead) return; this.dead = true; this.chain.then(() => { this.es?.close(); if (this.id) fetch(PC_BASE() + '__pc/kill?id=' + this.id, {method: 'POST'}); }); }
}
const PC_BASE = () => '/';
const mkWorker = () => globalThis.PC_MODE ? new PcWorker() : new Worker(new URL('./worker.js?v=1.17.12', import.meta.url), {type: 'module'});

let worker = null, seq = 0, H = null, resumable = false, followable = false, partial = false, expandCb = new Map(), expandSeq = 0;
export function startSolve({setup, target, opts, calcSettings, follow = null}, handlers) {
  const reuse = !!worker && followable;
  if (!reuse) cancelSolve();
  const id = ++seq; H = handlers; resumable = false; followable = false; partial = false;
  if (!reuse) worker = mkWorker();
  worker.onmessage = e => {
    if (e.data.id !== seq) return;
    if (e.data.type === 'expanded') { const cb = expandCb.get(e.data.at); expandCb.delete(e.data.at); cb?.(e.data); return; }
    if (e.data.type === 'result') { resumable = !!e.data.result?.resumable; followable = !!e.data.result?.canFollow; partial = !!(e.data.result?.tree?.cut || e.data.result?.alt?.tree?.cut); }
    H[e.data.type]?.(e.data);
    if (e.data.type === 'error' || (e.data.type === 'table' && !resumable && !followable && !partial)) cancelSolve();
  };
  worker.onerror = e => { H.error?.({message: '計算のスレッドで問題が起きました：' + (e.message || '読み込みの失敗')}); cancelSolve(); };
  worker.postMessage({type: 'solve', id, csv: D.csv, calcSettings, setup, target, opts, follow: reuse ? follow : null, reuse});
  return id;
}
export function canResume() { return !!worker && resumable; }
export function resumeSolve(maxMs, handlers) {
  if (!canResume()) return false;
  H = handlers; resumable = false;
  worker.postMessage({type: 'resume', id: seq, maxMs});
  return true;
}
export function cancelSolve() { worker?.terminate(); worker = null; resumable = false; followable = false; partial = false; for (const cb of expandCb.values()) cb({error: '中止しました'}); expandCb.clear(); }
export const canExpand = () => !!worker && (partial || resumable || followable);
export function expandSolve(key, path, cb) {
  if (!canExpand()) return false;
  const at = ++expandSeq; expandCb.set(at, cb);
  worker.postMessage({type: 'expand', id: seq, at, key, path});
  return true;
}
export const isRunning = () => !!worker;

let inspector = null;
export function startInspect({ids, calcSettings, opts}, {done, error}) {
  inspector?.terminate();
  inspector = mkWorker();
  const end = () => { inspector?.terminate(); inspector = null; };
  inspector.onmessage = e => { if (e.data.type === 'inspected') { done(e.data.result); end(); } else if (e.data.type === 'error') { error(e.data.message); end(); } };
  inspector.onerror = e => { error('点検のスレッドで問題が起きました：' + (e.message || '読み込みの失敗')); end(); };
  inspector.postMessage({type: 'inspect', id: 1, csv: D.csv, calcSettings, ids, opts});
}
export function cancelInspect() { inspector?.terminate(); inspector = null; }

export function turnEnd({setup, target, calcSettings, path}, {done, error}) {
  const w = mkWorker();
  w.onmessage = e => { if (e.data.type === 'turnEnd') done(e.data.state); else if (e.data.type === 'error') error(e.data.message); w.terminate(); };
  w.onerror = e => { error('計算のスレッドで問題が起きました：' + (e.message || '読み込みの失敗')); w.terminate(); };
  w.postMessage({type: 'nextTurn', id: 1, csv: D.csv, setup, target, calcSettings, path});
}

