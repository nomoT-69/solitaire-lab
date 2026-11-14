import * as T from '../engine/talos/tomahawk.mjs?v=1.17.12';
import * as A from '../engine/talos/aegis.mjs?v=1.17.12';
import * as S from '../engine/talos/settings.mjs?v=1.17.12';
import * as Q from '../engine/src/rational.mjs?v=1.17.12';
import * as V from '../engine/src/policy-eval.mjs?v=1.17.12';
import * as I from '../engine/talos/inspect.mjs?v=1.17.12';

const NEED = [[T, 'tecnaiModel'], [T, 'solveTomahawk'], [A, 'solveAegis'], [S, 'loadDataWithSettings'], [S, 'defaultSettings'], [Q, 'R'], [Q, 'parse'], [Q, 'toNum'], [Q, 'str'], [V, 'evalPolicyExact'], [I, 'inspectCards']];
const shapeErrors = NEED.filter(([m, k]) => typeof m[k] !== 'function').map(([, k]) => k);

let cache = {key: null, data: null};
function dataFor(csv, settings) {
  const key = JSON.stringify(settings || null) + csv.skillCards.length;
  if (cache.key !== key) cache = {key, data: S.loadDataWithSettings(csv, settings || S.defaultSettings())};
  return cache.data;
}

let J = null;
let F = null;
const dropJob = () => { try { J?.job?.dispose?.(); } catch {} try { if (F && F.job !== J?.job) F.job?.dispose?.(); } catch {} J = null; F = null; };
const MAX_HEAP_MIB = 3000;
const CAPS = [20000, 100000];
const MAX_EST_MIB = 2400;
const dataKey = m => JSON.stringify([m.calcSettings || null, m.csv.skillCards.length]);
const followKey = (m, o) => JSON.stringify([m.calcSettings || null, m.csv.skillCards.length, o.criterion, o.order, o.extras]);
const critOf = o => ({...(o.criterion === 'max' ? {criterion: 'max'} : {alpha: ALPHA[o.criterion], ...(o.both ? {alsoMax: true} : {})}), playOnLost: o.playOnLost !== false, playOnLostDrinks: !String(o.order || '').startsWith('d')});
function tryRetarget(m, model, o) {
  if (!F || F.origPath.length || F.dataKey !== dataKey(m) || typeof F.job.retarget !== 'function') return null;
  const O = F.origModel;
  if (O.engine.canon(O.root) !== model.engine.canon(model.root) || O.root.score !== model.root.score || !(model.target <= O.target)) return null;
  const r = F.job.retarget(model.target, {...critOf(o), order: o.order.split(''), extras: o.extras});
  if (!r || r.kind !== 'optimal' || !r.best) return null;
  return {r, model: {...O, target: model.target}};
}
const typeDesc = (E, ty) => { const t = E.types[ty]; return t ? (t.card.key ?? t.card.id) + '|' + t.g.score + '|' + t.g.scoreTimes : '?' + ty; };
const choiceKey = (E, c) => JSON.stringify(c, (k, v) => k === 'ty' && typeof v === 'number' ? typeDesc(E, v) : v);
const findAct = (model, s, c, Ec) => { const k = choiceKey(Ec, c); return model.choices(s).find(a => choiceKey(model.engine, a.raw ?? a) === k) || null; };
function translatePol(pol, E0, model) {
  const nodes = [];
  const walk = (id, st) => {
    const n = pol.nodes[id];
    const key = typeof model.v6key === 'function' ? model.v6key(st) : n.key;
    if (n.choice === null) { nodes.push({...n, id: nodes.length, key, edges: []}); return nodes.length - 1; }
    const act = findAct(model, st, n.choice, E0); if (!act) throw Error('FOLLOW_TRANSLATE');
    const br = model.branches(st, act); if (br.length !== n.edges.length) throw Error('FOLLOW_TRANSLATE');
    const idx = nodes.length, me = {...n, id: idx, key, choice: act.raw ?? act, edges: []}; nodes.push(me);
    me.edges = n.edges.map((e, i) => ({...e, key: typeof model.v6key === 'function' ? model.v6key(br[i].s) : e.key, next: walk(e.next, br[i].s)}));
    return idx;
  };
  return {...pol, nodes, root: walk(pol.root, model.root)};
}
function tryFollow(m, model, o) {
  if (!F || !Array.isArray(m.follow?.path) || !m.follow.path.length || F.key !== followKey(m, o)) return null;
  const O = F.origModel, E0 = O.engine;
  let s0 = O.root;
  for (const step of F.origPath) { const act = O.choices(s0).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(step.choice)); if (!act) return null; s0 = O.branches(s0, act)[step.edge].s; }
  let s = F.model.root; const tr = [];
  for (const step of m.follow.path) {
    const act = F.model.choices(s).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(step.choice));
    const act0 = act && findAct(O, s0, step.choice, F.model.engine);
    if (!act || !act0) return null;
    const br = F.model.branches(s, act), br0 = O.branches(s0, act0);
    if (!br[step.edge] || br.length !== br0.length) return null;
    s = br[step.edge].s; s0 = br0[step.edge].s;
    tr.push({choice: act0.raw ?? act0, edge: step.edge});
  }
  const c1 = model.engine.canon(model.root);
  if (E0.canon(s0) !== c1 || F.model.engine.canon(s) !== c1 || O.target - s0.score !== model.target - model.root.score) return null;
  const path = [...F.origPath, ...tr];
  const r = F.job.follow(path);
  if (!r || r.kind !== 'optimal' || !r.best) return null;
  const off = Q.R(s0.score - model.root.score);
  const shift = x => Q.sub(Q.parse(x), off);
  const fix = v => v && ({...v, ...(v.ev != null ? {ev: Q.str(shift(v.ev)), evNum: Q.toNum(shift(v.ev))} : {}),
    ...(v.floor != null ? {floor: Q.str(shift(v.floor)), floorNum: Q.toNum(shift(v.floor))} : {})});
  const extract = raw => { const pol = r.extract(raw); return pol && translatePol(pol, E0, model); };
  const ms = r.maxScore && typeof r.maxScore.value === 'number' ? {...r.maxScore, value: r.maxScore.value - (s0.score - model.root.score)} : r.maxScore;
  return {...r, best: fix(r.best), summarize: v => fix(r.summarize(v)), extract, maxScore: ms, followed: true, origPath: path};
}
function tableAfter(model, r, base, left, post, t0) {
  if ((r.followed || r.retargeted) && typeof r.table === 'function') {
    const rows = r.table([ALPHA['95'], ALPHA['99'], ALPHA['100']]).map((row, i) => {
      const b = row.best; if (!b) return {alpha: ['95%', '99%', '100%'][i], best: null};
      const raw = r.frontierRaw.find(v => { const x = r.summarize(v); return x.p === b.p && x.d === b.d && x.a === b.a; });
      const pol = raw ? r.extract(raw) : null;
      return {alpha: ['95%', '99%', '100%'][i], best: fmtBest(r.summarize(raw ?? r.bestRaw)), next: pol ? actLabel(model, pol.nodes[pol.root].choice) : null};
    });
    post('table', {rows, kind: r.kind}); return;
  }
  if (!model || !(left > 500) || r.kind === 'incomplete' || r.resumable) { post('table', {rows: null, note: r.kind === 'incomplete' ? '' : '予算（時間）が残っていないので、比較表は作っていません'}); return; }
  post('progress', {stage: '比較表を計算中', ms: Date.now() - t0});
  const t = T.solveTomahawk(model, {...base, alpha: ALPHA['95'], maxMs: left});
  if (t.status === 'complete' && typeof t.table === 'function') {
    const rows = t.table([ALPHA['95'], ALPHA['99'], ALPHA['100']]).map((row, i) => {
      const b = row.best; if (!b) return {alpha: ['95%', '99%', '100%'][i], best: null};
      const raw = t.frontierRaw.find(v => t.summarize(v).p === b.p && t.summarize(v).d === b.d && t.summarize(v).a === b.a);
      const pol = raw ? t.extract(raw) : null;
      return {alpha: ['95%', '99%', '100%'][i], best: fmtBest(b), next: pol ? actLabel(model, pol.nodes[pol.root].choice) : null};
    });
    post('table', {rows, kind: t.kind});
  } else post('table', {rows: null, note: '時間内に比較表を作れませんでした'});
}
const ALPHA = {'95': Q.R(19, 20), '99': Q.R(99, 100), '100': Q.R(1)};
const pct = x => { const v = x * 100; if (v > 0 && v < 0.01) return Number(v.toPrecision(2)) + '%'; return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '%'; };

self.onmessage = e => {
  const m = e.data;
  const post = (type, o) => self.postMessage({type, id: m.id, ...o});
  if (m.type === 'inspect') {
    try {
      if (shapeErrors.length) throw Error('エンジンの形が合いません（見つからない関数：' + shapeErrors.join('、') + '）');
      const data = S.loadDataWithSettings(m.csv, m.calcSettings || S.defaultSettings());
      post('inspected', {result: I.inspectCards(data, m.ids, m.opts || {})});
    } catch (err) { post('error', {message: String(err?.message || err)}); }
    return;
  }
  if (m.type === 'nextTurn') {
    try {
      if (shapeErrors.length) throw Error('エンジンの形が合いません（見つからない関数：' + shapeErrors.join('、') + '）');
      const model = T.tecnaiModel(dataFor(m.csv, m.calcSettings), m.setup, m.target);
      let s = model.root;
      for (const step of m.path) {
        const act = model.choices(s).find(a => step.ck ? choiceKey(model.engine, a.raw ?? a) === step.ck : JSON.stringify(a.raw ?? a) === JSON.stringify(step.choice));
        if (!act) throw Error('プレイの手が、局面の合法手に見つかりません');
        const br = model.branches(s, act); if (!br[step.edge]) throw Error('プレイの枝が見つかりません');
        s = br[step.edge].s;
      }
      post('turnEnd', {state: turnEndState(model.engine, s)});
    } catch (err) { post('error', {message: String(err?.message || err)}); }
    return;
  }
  if (m.type === 'expand') {
    try { post('expanded', {at: m.at, tree: expandTree(m.key, m.path)}); } catch (err) { post('expanded', {at: m.at, error: String(err?.message || err)}); }
    return;
  }
  if (m.type === 'resume') {
    try {
      if (!J) throw Error('続きから計算できません（前の計算が残っていません）');
      var J0 = J;
      const t0 = Date.now();
      post('progress', {stage: '続きから計算中', ms: 0});
      const r = J.job.run({maxMs: m.maxMs, onUpdate: interimPoster(post, t0, (u, ms, full) => summarize(J.model, u, J.o, ms, full))});
      const out = summarize(J.model, r, J.o, Date.now() - t0, true);
      if (!r.resumable) { const job = J.job; J = null; keepForFollow(job, r, J0.key, J0.model, J0.dataKey); }
      out.canFollow = !!F;
      post('result', {result: out});
      tableAfter(J ? J.model : null, r, J0.base, m.maxMs - (Date.now() - t0), post, t0);
    } catch (err) { post('error', {message: String(err?.message || err)}); }
    return;
  }
  if (m.type !== 'solve') return;
  TREES = []; TREE_LIMIT = m.opts?.treeLimit ?? 20000; TOP_PATHS = m.opts?.topPaths ?? 100;
  try {
    if (shapeErrors.length) throw Error('エンジンの形が合いません（見つからない関数：' + shapeErrors.join('、') + '）。GUI の worker.js を直してください');
    const t0 = Date.now();
    post('progress', {stage: 'データを読み込み中', ms: 0});
    const data = dataFor(m.csv, m.calcSettings);
    post('progress', {stage: '局面を作成中', ms: Date.now() - t0});
    const model = T.tecnaiModel(data, m.setup, m.target);
    const o = m.opts;
    const base = {order: o.order.split(''), extras: o.extras, maxMs: o.maxMs, maxStates: o.maxStates, maxHeapMiB: o.maxHeapMiB ?? MAX_HEAP_MIB, maxEstMiB: 'maxEstMiB' in o ? o.maxEstMiB : MAX_EST_MIB, caps: o.caps || CAPS};
    if (o.beyondGoal) {
      dropJob(); F = null;
      post('progress', {stage: '計算中（点数を伸ばす）', ms: Date.now() - t0});
      const onUpdate = interimPoster(post, t0, (u, ms, full) => summarize1(model, u, o, ms, full));
      const r = A.solveAegis(model, {beyondGoal: true, maxMs: o.maxMs, maxEstMiB: base.maxEstMiB, maxHeapMiB: base.maxHeapMiB, onUpdate});
      const out = summarize1(model, r, o, Date.now() - t0, true);
      out.canFollow = false; out.resumable = false;
      post('result', {result: out});
      post('table', {rows: null, note: '点数を伸ばす計算では、比較表は作りません'});
      return;
    }
    let fr = null;
    try { fr = tryFollow(m, model, o); } catch { fr = null; }
    if (fr) {
      post('progress', {stage: '前の答えから読み出し中', ms: Date.now() - t0});
      let out = null;
      try { out = summarize(model, fr, o, Date.now() - t0, true); } catch { out = null; }
      if (out) {
        out.followed = true; out.canFollow = true;
        F = {...F, model, origPath: fr.origPath};
        post('result', {result: out});
        tableAfter(model, fr, base, typeof fr.table === 'function' ? 0 : o.maxMs - (Date.now() - t0), post, t0);
        return;
      }
    }
    let rt = null;
    if (!m.follow) { try { rt = tryRetarget(m, model, o); } catch { rt = null; } }
    if (rt) {
      post('progress', {stage: '前の計算を使って計算中', ms: Date.now() - t0});
      let out = null;
      try { out = summarize(rt.model, rt.r, o, Date.now() - t0, true); } catch { out = null; }
      if (out) {
        out.retargeted = true; out.canFollow = false;
        post('result', {result: out});
        tableAfter(rt.model, rt.r, base, 0, post, t0);
        return;
      }
    }
    dropJob();
    const crit = critOf(o);
    post('progress', {stage: '計算中（Javelin → Tomahawk）', ms: Date.now() - t0});
    const onUpdate = interimPoster(post, t0, (u, ms, full) => summarize(model, u, o, ms, full));
    let r;
    if (typeof A.createAegisJob === 'function') {
      const job = A.createAegisJob(model, {...base, ...crit});
      r = job.run({maxMs: o.maxMs, maxStates: o.maxStates, onUpdate});
      if (r.resumable) J = {job, model, o, base, key: followKey(m, o), dataKey: dataKey(m)}; else keepForFollow(job, r, followKey(m, o), model, dataKey(m));
    } else r = A.solveAegis(model, {...base, ...crit, onUpdate});
    const out = summarize(model, r, o, Date.now() - t0, true);
    out.canFollow = !!F;
    post('result', {result: out});
    tableAfter(model, r, base, o.maxMs - (Date.now() - t0), post, t0);
  } catch (err) {
    post('error', {message: String(err?.message || err)});
  }
};

function interimPoster(post, t0, sum) {
  let last = 0, cost = 0;
  return u => {
    try {
      const now = Date.now(), full = now - last >= 5000 && cost <= (now - t0) / 4;
      const r = sum(u, now - t0, full);
      if (full) { cost += Date.now() - now; last = Date.now(); r.final = false; r.interimTree = true; }
      post('update', {result: r});
    } catch {}
  };
}

function keepForFollow(job, r, key, model, dk) {
  if (job.state?.canFollow && typeof job.follow === 'function' && r.kind === 'optimal') {
    F = {job, origModel: model, origPath: [], model, key, dataKey: dk};
  } else job.dispose?.();
}

const REASON = {MEMORY_LIMIT: 'メモリの上限', GROWTH_LIMIT: 'メモリに入りきらない見込み', TIME_LIMIT: '時間切れ', STATE_LIMIT: '状態数の上限'};

const fmtBest = b => b && ({p: b.p, d: b.d, a: b.a, pNum: b.pNum, dNum: b.dNum, aNum: b.aNum, pText: pct(b.pNum), ev: b.ev ?? null, floor: b.floor ?? null, evNum: b.evNum ?? null, floorNum: b.floorNum ?? null, evIfReachedNum: b.evIfReachedNum ?? null});

function actLabel(model, a) {
  if (!a) return '止める（何もしない）';
  const E = model.engine;
  const zn = f => ({hand: '手札', deck: '山札', discard: '捨て札'}[f] || '');
  if (a.type === 'card' && a.select?.multi) return `${a.name}（${a.select.multi.map(x => `${E.types[x.ty]?.card.name ?? '札'}〔${zn(x.from)}〕`).join('・')}を保留）`;
  if (a.type === 'card' && a.noSelect && /holdSelectedUpto/.test(JSON.stringify(E.types[a.ty]?.card.actions || ''))) return `${a.name}（保留しない）`;
  const sel = a.select ? `（${E.types[a.select.ty]?.card.name ?? '札'} を${zn(a.select.from)}から選ぶ）` : '';
  if (a.type === 'card') return `${a.name}${sel}`;
  if (a.type === 'drink') return `${a.name}${sel}${a.noSelect ? '（保留する札なし）' : ''}`;
  if (a.type === 'endTurn') return 'ターン終了';
  return a.name || a.type;
}
const actIcon = a => a && (a.type === 'card' ? {kind: 'cards', id: a.id} : a.type === 'drink' ? {kind: 'drinks', id: a.id} : null);

const BASE = 0x100;
const tys = str => { const a = []; for (let i = 0; i < (str || '').length; i++) a.push(str.charCodeAt(i) - BASE); return a; };
const hasCall = (items, name) => (items || []).some(x => (x.kind === 'action' && x.op === 'call' && x.name === name) || ((x.kind === 'effect' || x.kind === 'level') && hasCall(x.body, name)));
function drawnOf(E, data, parent, act, child) {
  const name = t => E.types[t]?.card.name ?? '札', idOf = t => E.types[t]?.card.id;
  const after = tys(child.hand);
  let before = tys(parent.hand);
  if (act.type === 'card') { const i = before.indexOf(act.ty); if (i >= 0) before.splice(i, 1); }
  const actions = act.type === 'card' ? E.types[act.ty]?.card.actions : act.type === 'drink' ? data.drinks.get(act.id)?.actions : null;
  if (hasCall(actions, 'exchangeHand')) before = [];
  const keep = new Map(); for (const t of before) keep.set(t, (keep.get(t) || 0) + 1);
  const hand = after.map(t => { const n = keep.get(t) || 0; if (n) keep.set(t, n - 1); return {ty: t, id: idOf(t), name: name(t), isNew: !n}; });
  return {hand, drawn: hand.filter(x => x.isNew), exchanged: before.length === 0 && hasCall(actions, 'exchangeHand')};
}

function regsOf(E, s) {
  const effs = JSON.parse(E.canon(s).split('\x01')[6] || '[]');
  return effs.map(([path, l, c], i) => ({path, i, c, id: Number((path.match(/^c:(-?\d+)/) || [])[1])})).filter(r => /^c:-?\d+:a/.test(r.path));
}
function regGain(model, s, act, child, reg) {
  const E = model.engine;
  try {
    const parts = E.canon(s).split('\x01');
    const effs = JSON.parse(parts[6]); effs.splice(reg.i, 1); parts[6] = JSON.stringify(effs);
    const s2 = E.fromCanon(parts.join('\x01'), s.score);
    const a2 = model.choices(s2).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(act));
    if (!a2) return null;
    const same = x => E.canon(x).split('\x01').slice(0, 6).join('\x01');
    const want = same(child);
    const b2 = model.branches(s2, a2).find(b => same(b.s) === want);
    return b2 ? child.score - b2.s.score : null;
  } catch { return null; }
}

function stOf(E, s) {
  const d = E.describe(s);
  return {score: s.score, heat: d.enthusiasm, extra: d.extra, factor: d.factor, bonus: d.bonus, stance: d.stance, uses: d.uses, drinks: (d.drinks || []).length};
}

let TREE_LIMIT = 20000, TOP_PATHS = 100;
let TREES = [];
function playTree(model, pol, s0 = model.root, id0 = pol.root, base = []) {
  const E = model.engine;
  const key = TREES.length; TREES.push({model, pol});
  const nodes = [];
  const actOf = (s, n) => { const a = model.choices(s).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(n.choice)); if (!a) throw Error('方策の木の手が、局面の合法手に見つかりません'); return a; };
  let keep = null;
  const sizeMemo = new Map();
  const treeSize = id => { if (sizeMemo.has(id)) return sizeMemo.get(id); let n = 1; for (const e of pol.nodes[id].edges || []) { n += treeSize(e.next); if (n > TREE_LIMIT) break; } n = Math.min(n, TREE_LIMIT + 1); sizeMemo.set(id, n); return n; };
  if (!(base.length === 0 && treeSize(pol.root) <= TREE_LIMIT)) {
    keep = new Set(['']);
    const heap = [{p: 1, s: s0, id: id0, path: []}], up = i => { while (i) { const j = (i - 1) >> 1; if (heap[j].p >= heap[i].p) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].p > heap[m].p) m = l; if (r < heap.length && heap[r].p > heap[m].p) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    let found = 0, pops = 0;
    while (heap.length && found < TOP_PATHS && pops++ < 300000) {
      const x = pop(), n = pol.nodes[x.id];
      if (n.choice === null) { found++; for (let k = 1; k <= x.path.length; k++) keep.add(x.path.slice(0, k).join(',')); continue; }
      model.branches(x.s, actOf(x.s, n)).forEach((b, i) => { heap.push({p: x.p * b.pFloat, s: b.s, id: n.edges[i].next, path: [...x.path, i]}); up(heap.length - 1); });
    }
  }
  const valMemo = new Map();
  function valueOf(s, id) {
    if (valMemo.has(id)) return valMemo.get(id);
    const v = valueOf0(s, id); valMemo.set(id, v); return v;
  }
  function valueOf0(s, id) {
    const n = pol.nodes[id];
    if (n.choice === null) return [s.score >= model.target ? 1 : 0, 0, 0];
    let p = 0, d = n.choice.type === 'drink' ? 1 : 0, a = n.choice.type === 'skip' ? 0 : 1;
    model.branches(s, actOf(s, n)).forEach((b, i) => { const [cp, cd, ca] = valueOf(b.s, n.edges[i].next); p += b.pFloat * cp; d += b.pFloat * cd; a += b.pFloat * ca; });
    return [p, d, a];
  }
  function walk(s, id, path) {
    const n = pol.nodes[id];
    if (keep && !keep.has(path.join(','))) { const [p, d, a] = valueOf(s, id); nodes.push({end: true, cut: true, key, path: [...base, ...path], reached: false, score: s.score, p, d, a, st: stOf(E, s)}); return nodes.length - 1; }
    if (n.choice === null) { nodes.push({end: true, reached: s.score >= model.target, score: s.score, p: s.score >= model.target ? 1 : 0, d: 0, a: 0, st: stOf(E, s)}); return nodes.length - 1; }
    const act = actOf(s, n);
    const br = model.branches(s, act);
    if (br.length !== n.edges.length) throw Error('方策の木の分かれ方が合いません');
    const me = {act: actLabel(model, n.choice), icon: actIcon(n.choice), kind: n.choice.type, choice: n.choice, ck: choiceKey(E, n.choice), sameEval: n.sameEval ?? null, ...(n.lost ? {lost: true} : {}), edges: [], st: stOf(E, s)};
    let ex = null;
    if (typeof E.explain === 'function') { try { ex = new Map(E.explain(s, act.raw ?? act).branches.map(x => [E.canon(x.s) + '|' + x.s.score, x])); } catch { ex = null; } }
    const idx = nodes.length; nodes.push(me);
    let p = 0, d = n.choice.type === 'drink' ? 1 : 0, a = n.choice.type === 'skip' ? 0 : 1;
    br.forEach((b, i) => {
      const {hand, drawn, exchanged} = drawnOf(E, model.data ?? cache.data, s, n.choice, b.s);
      const next = walk(b.s, n.edges[i].next, [...path, i]);
      const c = nodes[next];
      p += b.pFloat * c.p; d += b.pFloat * c.d; a += b.pFloat * c.a;
      const before = regsOf(E, s), after = regsOf(E, b.s);
      const regs = before.map(r => { const a2 = after.find(x => x.path === r.path); return {id: r.id, from: r.c, to: a2 ? a2.c : null, gain: regGain(model, s, n.choice, b.s, r)}; });
      const xb = ex?.get(E.canon(b.s) + '|' + b.s.score);
      me.edges.push({p: b.pFloat, pText: Q.str(b.p), drawn, hand, exchanged, regs, next, hits: xb?.hits || null, heatHits: xb?.heatHits || null});
    });
    Object.assign(me, {p, d, a});
    return idx;
  }
  const root = walk(s0, id0, []);
  return {root, nodes, cut: !!keep, key};
}
function expandTree(key, path) {
  const T = TREES[key];
  if (!T) throw Error('答えの全体がもうありません（計算し直してください）');
  const {model, pol} = T;
  let s = model.root, id = pol.root;
  for (const i of path) { const n = pol.nodes[id]; const act = model.choices(s).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(n.choice)); s = model.branches(s, act)[i].s; id = n.edges[i].next; }
  return playTree(model, pol, s, id, path);
}

function summarize(model, r, o, ms, final) {
  if (o.criterion === 'max' || !o.both) return summarize1(model, r, o, ms, final);
  const mr = r.maxResult !== undefined ? r.maxResult : maxFromFrontier(r);
  if (!mr || !mr.best) return summarize1(model, r, o, ms, final);
  const mainR = {...r, best: mr.best, bestRaw: mr.bestRaw, extract: mr.extract, solver: mr.solver || r.solver, meetsAlpha: undefined};
  const out = summarize1(model, mainR, {...o, criterion: 'max'}, ms, final);
  const b = r.best;
  if (b && !(b.p === mr.best.p && b.d === mr.best.d && b.a === mr.best.a)) out.alt = summarize1(model, r, o, ms, final);
  return out;
}
function maxFromFrontier(r) {
  const fr = r.frontierRaw;
  if (!Array.isArray(fr) || !fr.length || typeof r.summarize !== 'function' || typeof r.extract !== 'function') return null;
  let bv = null, bs = null;
  for (const v of fr) { const s = r.summarize(v); if (!bs || s.pNum > bs.pNum || (s.pNum === bs.pNum && (s.dNum < bs.dNum || (s.dNum === bs.dNum && s.aNum < bs.aNum)))) { bv = v; bs = s; } }
  return {best: bs, bestRaw: bv, extract: () => r.extract(bv), solver: r.solver};
}

function summarize1(model, r, o, ms, final) {
  const out = {kind: r.kind || (r.status === 'complete' ? 'optimal' : 'incomplete'), kindLabel: r.kindLabel || '', status: r.status, final,
    solver: r.solver || 'Tomahawk', scope: r.scope || '', proven: r.proven || '', reason: r.reason || '',
    best: fmtBest(r.best), pMax: r.pMaxWithinHorizon ?? null, ms, optimalityProven: r.optimalityProven ?? null,
    resumable: !!r.resumable && !!J, resumeReason: r.resumeReason || '', jobInfo: r.job || null,
    meetsAlpha: typeof r.meetsAlpha === 'boolean' ? r.meetsAlpha : null,
    notes: (model.engine?.notes || []).slice(),
    maxScore: r.maxScore && typeof r.maxScore.value === 'number' ? {value: r.maxScore.value, reached: !!r.maxScore.reached, exact: !!r.maxScore.exact, atLeast: !!r.maxScore.atLeast, note: r.maxScore.note || ''} : null,
    stats: {nodes: r.stats?.nodes ?? null, heapMiB: r.stats?.heapUsedMiB ?? null}, criterion: o.criterion, order: o.order, extras: o.extras, objective: r.objective || (o.beyondGoal ? 'beyondGoal' : null),
    trials: (r.trials || []).map(t => `${t.solver}：${({complete: '終了', incomplete: '打ち切り', provisional: '暫定'})[t.status] || t.status}${t.status === 'incomplete' && t.reason ? '・' + (REASON[t.reason] || t.reason) : ''}${t.ms !== undefined ? '（' + (t.ms / 1000).toFixed(1) + '秒）' : ''}`)};
  if (!r.best || typeof r.extract !== 'function') return out;
  const pol = r.extract();
  if (!pol) return out;
  out.sameEval = pol.sameEval || null;
  if (!final) { const c = pol.nodes[pol.root].choice; out.next = actLabel(model, c); out.nextIcon = actIcon(c); return out; }
  out.tree = playTree(model, pol);
  const rootNode = out.tree.nodes[out.tree.root];
  out.next = rootNode.end ? '止める（何もしない）' : rootNode.act;
  out.nextIcon = rootNode.icon || null;
  try { const ex = V.evalPolicyExact(model, pol); out.natural = {ev: ex.ev, floor: ex.floor, evNum: Q.toNum(Q.parse(ex.ev)), floorNum: Q.toNum(Q.parse(ex.floor)), chosenBy: o.extras.length ? o.extras : null}; }
  catch (e) { out.natural = {error: String(e.message || e)}; }
  return out;
}

function turnEndState(E, s) {
  if (typeof E.canon !== 'function' || typeof E.describe !== 'function') throw Error('エンジンの形が合いません（canon・describe）');
  const [hand, disc, rem, held, , deck, effs, ce] = E.canon(s).split('\x01');
  const card = d => { const [key, gs, gt] = d.split('|'); return {key, id: Number(key.match(/^-?\d+/)[0]), g: {score: Number(gs), scoreTimes: Number(gt)}}; };
  const zone = x => JSON.parse(x).map(card);
  const cands = JSON.parse(deck);
  let deckCards = [];
  if (cands.length) { const [bag, segs] = JSON.parse(cands[0][2]); deckCards = [...bag, ...segs.flatMap(([, f]) => f)].map(card); }
  const recs = x => JSON.parse(x).map(([path, l, c, src]) => ({path, l, c, src: src === null ? null : card(src)}));
  const d = E.describe(s);
  return {hand: zone(hand), discard: zone(disc), removed: zone(rem), held: JSON.parse(held).map(card), deck: deckCards,
    drinks: d.drinks, stance: d.stance, prevStance: d.prevStance, nullifyCostCards: d.nullifyCostCards ?? null, fullPowerCharge: d.fullPowerCharge ?? null, cumulativeFullPowerCharge: d.cumulativeFullPowerCharge ?? null, enthusiasm: d.enthusiasm, extra: d.extra, factor: d.factor, bonus: d.bonus, uses: d.uses, times: d.times, score: s.score,
    effs: recs(effs), cardEffs: recs(ce)};
}
