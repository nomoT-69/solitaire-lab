// 計算の裏のスレッド（Web Worker、ES モジュール）。Aegis の計算（Tecnai＋Javelin・Tomahawk）を動かし、画面を固めない。
// エンジンとの受け渡しは、このファイルだけにまとめる（エンジンの形が変わったら、ここを直す）。エンジンの形が合わないときは、計算せずにエラーで知らせる。
//
// 受け取る：{type:'solve', id, csv, calcSettings, setup, target, opts:{criterion:'max'|'95'|'99'|'100', order:'dpa', extras:['ev','floor'], maxMs, maxStates}}
// 返す：{type:'progress', id, stage, ms} … 進み具合（段階と経過時間）
//       {type:'update', id, result}     … 暫定の答えが良くなった（計算は続く）
//       {type:'result', id, result}     … 最終の答え（result.kind：optimal／provisional／restricted／incomplete）
//       {type:'table', id, rows}        … 95/99/100% の比較表（最終の答えの後に、残りの予算で）
//       {type:'error', id, message}
// 次のターンの局面：{type:'nextTurn', id, csv, calcSettings, setup, target, path:[{choice, edge}]} → {type:'turnEnd', id, state}
//   path はプレイでたどった手（方策の木の choice）と枝の番号。最後の局面の中身（札の置き場と成長、山札の中身、ドリンク、指針、回数、
//   P アイテム・継続効果のカウンタ）を、エンジンの canon（中身で決まるキー）と describe から読み出して返す
// 続きの局面（プレイの途中で「ここから局面を作る」）：solve に follow:{path} を付けると、前の最適の答え（このスレッドが持っている）から、
//   計算し直さずに答える（エンジンの job.follow、AEGIS_SPEC.md 9.1）。新しい局面が、前の局面で path をたどった局面と同じ（canon と残りの必要点が同じ、
//   データ・比べ方も同じ）ときだけ使う。違えば（局面を直した など）、今までどおり計算する。result に followed:true が付く
// 足した札の点検：{type:'inspect', id, csv, calcSettings, ids, opts:{cases, maxStates, maxMs}} → {type:'inspected', id, result}（エンジンの inspectCards の結果）
import * as T from '../engine/talos/tomahawk.mjs';
import * as A from '../engine/talos/aegis.mjs';
import * as S from '../engine/talos/settings.mjs';
import * as Q from '../engine/src/rational.mjs';
import * as V from '../engine/src/policy-eval.mjs';
import * as I from '../engine/talos/inspect.mjs';

// エンジンの形の確かめ（足りない関数があれば、計算せずに知らせる）
const NEED = [[T, 'tecnaiModel'], [T, 'solveTomahawk'], [A, 'solveAegis'], [S, 'loadDataWithSettings'], [S, 'defaultSettings'], [Q, 'R'], [Q, 'parse'], [Q, 'toNum'], [Q, 'str'], [V, 'evalPolicyExact'], [I, 'inspectCards']];
const shapeErrors = NEED.filter(([m, k]) => typeof m[k] !== 'function').map(([, k]) => k);

let cache = {key: null, data: null};
function dataFor(csv, settings) {
  const key = JSON.stringify(settings || null) + csv.skillCards.length;
  if (cache.key !== key) cache = {key, data: S.loadDataWithSettings(csv, settings || S.defaultSettings())};
  return cache.data;
}

let J = null;   // 続きから計算するための前の計算 {job, model, o, base}
let F = null;   // 続きの局面を即答するための前の最適の答え {job, origModel（最初に解いた model）, origPath（そこから今の根までの道筋）, model（今の根の局面の model）, key（データと比べ方）}
const dropJob = () => { try { J?.job?.dispose?.(); } catch {} try { if (F && F.job !== J?.job) F.job?.dispose?.(); } catch {} J = null; F = null; };
const MAX_HEAP_MIB = 3000;   // 使ってよいメモリ（エンジンの maxHeapMiB）。エンジンが Node.js の memoryUsage で測るので、ブラウザでは効かない（測れない）
// 層の上限の段（エンジンの既定は 2万・10万・30万）。ブラウザではメモリを測れないので、30万の段を外す（最大 RSS 約4.3GB → 約1.7GB。計算の部品のセッションの測定・勧め）
const CAPS = [20000, 100000];
// 見積もったメモリの上限（エンジンの maxEstMiB。ブラウザでも効く）。ブラウザの上限 4GB の6割ほど（計算の部品のセッションの勧め）。今の層の上限の段ではほとんど届かない、念のための上限
const MAX_EST_MIB = 2400;
const dataKey = m => JSON.stringify([m.calcSettings || null, m.csv.skillCards.length]);
const followKey = (m, o) => JSON.stringify([m.calcSettings || null, m.csv.skillCards.length, o.criterion, o.order, o.extras]);
// both：達成率最大と α の答えを1回の計算で並べて出す（エンジンの alsoMax。1.8.0、利用者の決定）
const critOf = o => o.criterion === 'max' ? {criterion: 'max'} : {alpha: ALPHA[o.criterion], ...(o.both ? {alsoMax: true} : {})};
// 同じ局面で、目標を下げた・基準（比べる順・達成率・自然さ）を変えたときは、前の最適の答えのグラフを使い回す（エンジンの job.retarget、AEGIS_SPEC.md 9.1）。
// 前の答えの根の局面と同じ（canon が同じ、目標が前以下）で、データが同じときだけ。返り値は {r, model}（model は前の model の目標を変えたもの）
function tryRetarget(m, model, o) {
  if (!F || F.origPath.length || F.dataKey !== dataKey(m) || typeof F.job.retarget !== 'function') return null;
  const O = F.origModel;
  if (O.engine.canon(O.root) !== model.engine.canon(model.root) || O.root.score !== model.root.score || !(model.target <= O.target)) return null;
  const r = F.job.retarget(model.target, {...critOf(o), order: o.order.split(''), extras: o.extras});
  if (!r || r.kind !== 'optimal' || !r.best) return null;
  return {r, model: {...O, target: model.target}};
}
// 手の中の札の種類の番号（ty）は model ごとに違うので、札の中身（変種のキーと成長）に直して比べる
const typeDesc = (E, ty) => { const t = E.types[ty]; return t ? (t.card.key ?? t.card.id) + '|' + t.g.score + '|' + t.g.scoreTimes : '?' + ty; };
const choiceKey = (E, c) => JSON.stringify(c, (k, v) => k === 'ty' && typeof v === 'number' ? typeDesc(E, v) : v);
// model で、局面 s から、別の model の手 c（エンジン Ec の番号）と同じ手を探す
const findAct = (model, s, c, Ec) => { const k = choiceKey(Ec, c); return model.choices(s).find(a => choiceKey(model.engine, a.raw ?? a) === k) || null; };
// 方策の木（元の model の手）を、新しい model の手に直す。分かれ方が合わなければ null
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
// 前の最適の答え（F）から、path をたどった局面の答えを返す（使えないときは null）。
// F.origModel・F.origPath：最初に解いた model と、その根から今の F の根までの道筋（最初の model の手）。F.model：今の F の根の局面の model
function tryFollow(m, model, o) {
  if (!F || !Array.isArray(m.follow?.path) || !m.follow.path.length || F.key !== followKey(m, o)) return null;
  const O = F.origModel, E0 = O.engine;
  let s0 = O.root;   // 最初の model で、これまでの道筋をたどる
  for (const step of F.origPath) { const act = O.choices(s0).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(step.choice)); if (!act) return null; s0 = O.branches(s0, act)[step.edge].s; }
  let s = F.model.root; const tr = [];   // 今の model で path をたどり、最初の model の手に直す
  for (const step of m.follow.path) {
    const act = F.model.choices(s).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(step.choice));
    const act0 = act && findAct(O, s0, step.choice, F.model.engine);
    if (!act || !act0) return null;
    const br = F.model.branches(s, act), br0 = O.branches(s0, act0);
    if (!br[step.edge] || br.length !== br0.length) return null;
    s = br[step.edge].s; s0 = br0[step.edge].s;
    tr.push({choice: act0.raw ?? act0, edge: step.edge});
  }
  // 新しい局面が、たどった局面と同じか（中身と、残りの必要点）
  const c1 = model.engine.canon(model.root);
  if (E0.canon(s0) !== c1 || F.model.engine.canon(s) !== c1 || O.target - s0.score !== model.target - model.root.score) return null;
  const path = [...F.origPath, ...tr];
  const r = F.job.follow(path);
  if (!r || r.kind !== 'optimal' || !r.best) return null;
  // 期待値・最低保証は、エンジンが最初の局面からの点を足して出すので、新しい局面の点に直す
  const off = Q.R(s0.score - model.root.score);
  const shift = x => Q.sub(Q.parse(x), off);
  const fix = v => v && ({...v, ...(v.ev != null ? {ev: Q.str(shift(v.ev)), evNum: Q.toNum(shift(v.ev))} : {}),
    ...(v.floor != null ? {floor: Q.str(shift(v.floor)), floorNum: Q.toNum(shift(v.floor))} : {})});
  const extract = raw => { const pol = r.extract(raw); return pol && translatePol(pol, E0, model); };
  const ms = r.maxScore && typeof r.maxScore.value === 'number' ? {...r.maxScore, value: r.maxScore.value - (s0.score - model.root.score)} : r.maxScore;
  return {...r, best: fix(r.best), summarize: v => fix(r.summarize(v)), extract, maxScore: ms, followed: true, origPath: path};
}
// 比較表（95/99/100%）：残りの予算で Tomahawk を α=95% で解き、前線から α ごとに選ぶ。作らないときも必ず知らせる（画面が待ち続けないように）
function tableAfter(model, r, base, left, post, t0) {
  if ((r.followed || r.retargeted) && typeof r.table === 'function') {   // 続きの局面・目標を変えた答えは、前の計算の前線をそのまま使う（計算し直さない）
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
const pct = x => { const v = x * 100; return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '%'; };

self.onmessage = e => {
  const m = e.data;
  const post = (type, o) => self.postMessage({type, id: m.id, ...o});
  if (m.type === 'inspect') {
    try {
      if (shapeErrors.length) throw Error('エンジンの形が合いません（見つからない関数：' + shapeErrors.join('、') + '）');
      const data = S.loadDataWithSettings(m.csv, m.calcSettings || S.defaultSettings());   // 点検は毎回まっさらなデータで
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
        // 札の種類の番号（ty）は model ごとに違うことがあるので、手の中身（ck）で探す（古い答えは ck がないので、そのまま比べる）
        const act = model.choices(s).find(a => step.ck ? choiceKey(model.engine, a.raw ?? a) === step.ck : JSON.stringify(a.raw ?? a) === JSON.stringify(step.choice));
        if (!act) throw Error('プレイの手が、局面の合法手に見つかりません');
        const br = model.branches(s, act); if (!br[step.edge]) throw Error('プレイの枝が見つかりません');
        s = br[step.edge].s;
      }
      post('turnEnd', {state: turnEndState(model.engine, s)});
    } catch (err) { post('error', {message: String(err?.message || err)}); }
    return;
  }
  // 続きから計算：前の計算（job）を捨てずに、予算を足して続ける（エンジンの createAegisJob、AEGIS_SPEC.md 9.1）
  if (m.type === 'resume') {
    try {
      if (!J) throw Error('続きから計算できません（前の計算が残っていません）');
      var J0 = J;
      const t0 = Date.now();
      post('progress', {stage: '続きから計算中', ms: 0});
      const r = J.job.run({maxMs: m.maxMs, onUpdate: u => { try { post('update', {result: summarize(J.model, u, J.o, Date.now() - t0, false)}); } catch {} }});
      const out = summarize(J.model, r, J.o, Date.now() - t0, true);
      if (!r.resumable) { const job = J.job; J = null; keepForFollow(job, r, J0.key, J0.model, J0.dataKey); }
      out.canFollow = !!F;
      post('result', {result: out});
      tableAfter(J ? J.model : null, r, J0.base, m.maxMs - (Date.now() - t0), post, t0);
    } catch (err) { post('error', {message: String(err?.message || err)}); }
    return;
  }
  if (m.type !== 'solve') return;
  try {
    if (shapeErrors.length) throw Error('エンジンの形が合いません（見つからない関数：' + shapeErrors.join('、') + '）。GUI の worker.js を直してください');
    const t0 = Date.now();
    post('progress', {stage: 'データを読み込み中', ms: 0});
    const data = dataFor(m.csv, m.calcSettings);
    post('progress', {stage: '局面を作成中', ms: Date.now() - t0});
    const model = T.tecnaiModel(data, m.setup, m.target);
    const o = m.opts;
    const base = {order: o.order.split(''), extras: o.extras, maxMs: o.maxMs, maxStates: o.maxStates, maxHeapMiB: MAX_HEAP_MIB, maxEstMiB: 'maxEstMiB' in o ? o.maxEstMiB : MAX_EST_MIB, caps: o.caps || CAPS};   // caps・maxEstMiB は試験用に opts で上書きできる（画面からは渡さない）
    // 点数を伸ばす（試作・未検証、1.12.0）：届く確率 → 届いた先も含めた期待最終点。続きから・即答・95% はない（計算の部品 1eafcc5）
    if (o.beyondGoal) {
      dropJob(); F = null;
      post('progress', {stage: '計算中（点数を伸ばす）', ms: Date.now() - t0});
      const onUpdate = u => { try { post('update', {result: summarize1(model, u, o, Date.now() - t0, false)}); } catch {} };
      const r = A.solveAegis(model, {beyondGoal: true, maxMs: o.maxMs, maxEstMiB: base.maxEstMiB, maxHeapMiB: MAX_HEAP_MIB, onUpdate});
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
      try { out = summarize(model, fr, o, Date.now() - t0, true); } catch { out = null; }   // 手が合わないなど → 計算し直す
      if (out) {
        out.followed = true; out.canFollow = true;
        F = {...F, model, origPath: fr.origPath};   // さらに先の局面も、最初の答えから即答できる
        post('result', {result: out});
        // 比較表：Tomahawk の答えなら前線から（即座に）。Javelin の答え（届く最大）は前線を持たないので、今までどおり残りの予算で作る
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
        out.retargeted = true; out.canFollow = false;   // 続きの局面の即答（follow）は、最初の目標・基準の答えにしか使えない
        post('result', {result: out});
        tableAfter(rt.model, rt.r, base, 0, post, t0);
        return;
      }
    }
    dropJob();
    const crit = critOf(o);
    post('progress', {stage: '計算中（Javelin → Tomahawk）', ms: Date.now() - t0});
    const onUpdate = u => { try { post('update', {result: summarize(model, u, o, Date.now() - t0, false)}); } catch {} };
    let r;
    if (typeof A.createAegisJob === 'function') {   // 続きから計算できる形（予算で止まっても、状態を持ったまま）
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

// 最適の答えなら job を持っておく（続きの局面の即答のため。重い局面で約0.15GB）。使えなければ手放す
function keepForFollow(job, r, key, model, dk) {
  if (job.state?.canFollow && typeof job.follow === 'function' && r.kind === 'optimal') {
    F = {job, origModel: model, origPath: [], model, key, dataKey: dk};
  } else job.dispose?.();
}

// 打ち切りの理由（エンジンの trials の reason）
const REASON = {MEMORY_LIMIT: 'メモリの上限', GROWTH_LIMIT: 'メモリに入りきらない見込み', TIME_LIMIT: '時間切れ', STATE_LIMIT: '状態数の上限'};

const fmtBest = b => b && ({p: b.p, d: b.d, a: b.a, pNum: b.pNum, dNum: b.dNum, aNum: b.aNum, pText: pct(b.pNum), ev: b.ev ?? null, floor: b.floor ?? null, evNum: b.evNum ?? null, floorNum: b.floorNum ?? null, evIfReachedNum: b.evIfReachedNum ?? null});

// 手の名前
function actLabel(model, a) {
  if (!a) return '止める（何もしない）';
  const E = model.engine;
  const sel = a.select ? `（${E.types[a.select.ty]?.card.name ?? '札'} を${{hand: '手札', deck: '山札', discard: '捨て札'}[a.select.from] || ''}から選ぶ）` : '';
  if (a.type === 'card') return `${a.name}${sel}`;   // 札・ドリンクは名前だけ（利用者の決定。「を使う」「を飲む」は付けない）
  if (a.type === 'drink') return `${a.name}${sel}${a.noSelect ? '（保留する札なし）' : ''}`;   // 選べる札がないときも飲める（計算の部品の項目21、2ca0324）
  if (a.type === 'endTurn') return 'ターン終了';
  return a.name || a.type;
}
const actIcon = a => a && (a.type === 'card' ? {kind: 'cards', id: a.id} : a.type === 'drink' ? {kind: 'drinks', id: a.id} : null);

// 手札の違い（引いた札）：子の手札 −（親の手札 − 使った札）
const BASE = 0x100;
const tys = str => { const a = []; for (let i = 0; i < (str || '').length; i++) a.push(str.charCodeAt(i) - BASE); return a; };
// 効果の中に、手札を入れ替える効果（exchangeHand）があるか（入れ子の効果も見る）
const hasCall = (items, name) => (items || []).some(x => (x.kind === 'action' && x.op === 'call' && x.name === name) || ((x.kind === 'effect' || x.kind === 'level') && hasCall(x.body, name)));
// 使った後の手札（全部）と、そのうち新しく来た札。新しく来た札＝使った後の手札 −（使う前の手札 − 使った札）。
// 手札を入れ替える札・ドリンク（仕切り直しなど）は、残る手札がないので、使った後の手札は全部「新しく来た札」として数える
// （前は、入れ替えで捨てた札と同じ種類を引き直すと、その分が引かれて少なく出ていた。エンジン側のセッションの調べ 2026-11-03）
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

// 方策の木を、画面で使う形（手の名前、引いた札、確率、この先の値）に直す
// 継続効果（使った札が残す効果。夏夜に咲く思い出など）の記録：エンジンの canon の効果の部分（7番目）から、札の効果（c:番号:a…）を読む
function regsOf(E, s) {
  const effs = JSON.parse(E.canon(s).split('\x01')[6] || '[]');
  return effs.map(([path, l, c], i) => ({path, i, c, id: Number((path.match(/^c:(-?\d+)/) || [])[1])})).filter(r => /^c:-?\d+:a/.test(r.path));
}
// その1手で継続効果が出したスコア：同じ局面から「その継続効果がなかったら」を計算し直し、同じ結果の枝とスコアの差をとる（正確な値）
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

// 局面の見える値（全手順の表で使う）：このターンのスコア、熱意、熱意追加、熱意倍率（％）、スコア上昇（％）、指針、残り行動、残りのドリンクの本数
function stOf(E, s) {
  const d = E.describe(s);
  return {score: s.score, heat: d.enthusiasm, extra: d.extra, factor: d.factor, bonus: d.bonus, stance: d.stance, uses: d.uses, drinks: (d.drinks || []).length};
}

function playTree(model, pol) {
  const E = model.engine;
  const nodes = [];
  function walk(s, id) {
    const n = pol.nodes[id];
    if (n.choice === null) { nodes.push({end: true, reached: s.score >= model.target, score: s.score, p: s.score >= model.target ? 1 : 0, d: 0, a: 0, st: stOf(E, s)}); return nodes.length - 1; }
    const act = model.choices(s).find(a => JSON.stringify(a.raw ?? a) === JSON.stringify(n.choice));
    if (!act) throw Error('方策の木の手が、局面の合法手に見つかりません');
    const br = model.branches(s, act);
    if (br.length !== n.edges.length) throw Error('方策の木の分かれ方が合いません');
    const me = {act: actLabel(model, n.choice), icon: actIcon(n.choice), kind: n.choice.type, choice: n.choice, ck: choiceKey(E, n.choice), sameEval: n.sameEval ?? null, edges: [], st: stOf(E, s)};
    const idx = nodes.length; nodes.push(me);
    let p = 0, d = n.choice.type === 'drink' ? 1 : 0, a = n.choice.type === 'skip' ? 0 : 1;
    br.forEach((b, i) => {
      const {hand, drawn, exchanged} = drawnOf(E, model.data ?? cache.data, s, n.choice, b.s);
      const next = walk(b.s, n.edges[i].next);
      const c = nodes[next];
      p += b.pFloat * c.p; d += b.pFloat * c.d; a += b.pFloat * c.a;
      // 継続効果（夏夜など）：カウンタの動きと、その1手で出したスコア
      const before = regsOf(E, s), after = regsOf(E, b.s);
      const regs = before.map(r => { const a2 = after.find(x => x.path === r.path); return {id: r.id, from: r.c, to: a2 ? a2.c : null, gain: regGain(model, s, n.choice, b.s, r)}; });
      me.edges.push({p: b.pFloat, pText: Q.str(b.p), drawn, hand, exchanged, regs, next});
    });
    Object.assign(me, {p, d, a});
    return idx;
  }
  const root = walk(model.root, pol.root);
  return {root, nodes};
}

// 答えを画面の形にする。α の計算で達成率最大の答え（maxResult）もあれば、達成率最大を主に、α の答えを alt に入れて返す（同じ答えなら alt なし）
// maxResult がない結果（即答 follow・retarget の Tomahawk の結果）は、前線から達成率最大（P 最大 → D 最小 → A 最小）の点を取り出す
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
    notes: (model.engine?.notes || []).slice(),   // 計算の部品の注意書き（累計の全力値を仮に 7 で計算した、など）
    maxScore: r.maxScore && typeof r.maxScore.value === 'number' ? {value: r.maxScore.value, reached: !!r.maxScore.reached, exact: !!r.maxScore.exact, atLeast: !!r.maxScore.atLeast, note: r.maxScore.note || ''} : null,   // この局面から取りうる最大の最終点   // 達成率を指定したとき（95% など）、その達成率を満たすか
    stats: {nodes: r.stats?.nodes ?? null, heapMiB: r.stats?.heapUsedMiB ?? null}, criterion: o.criterion, order: o.order, extras: o.extras, objective: r.objective || (o.beyondGoal ? 'beyondGoal' : null),
    trials: (r.trials || []).map(t => `${t.solver}：${({complete: '終了', incomplete: '打ち切り', provisional: '暫定'})[t.status] || t.status}${t.status === 'incomplete' && t.reason ? '・' + (REASON[t.reason] || t.reason) : ''}${t.ms !== undefined ? '（' + (t.ms / 1000).toFixed(1) + '秒）' : ''}`)};
  if (!r.best || typeof r.extract !== 'function') return out;
  const pol = r.extract();
  if (!pol) return out;
  out.sameEval = pol.sameEval || null;
  if (!final) { const c = pol.nodes[pol.root].choice; out.next = actLabel(model, c); out.nextIcon = actIcon(c); return out; }   // 途中の答えは次の手だけ
  out.tree = playTree(model, pol);
  const rootNode = out.tree.nodes[out.tree.root];
  out.next = rootNode.end ? '止める（何もしない）' : rootNode.act;
  out.nextIcon = rootNode.icon || null;
  // 自然さ：チェックしたときは選んだ基準の値、チェックなしでも選んだ手順の値を参考に出す
  try { const ex = V.evalPolicyExact(model, pol); out.natural = {ev: ex.ev, floor: ex.floor, evNum: Q.toNum(Q.parse(ex.ev)), floorNum: Q.toNum(Q.parse(ex.floor)), chosenBy: o.extras.length ? o.extras : null}; }
  catch (e) { out.natural = {error: String(e.message || e)}; }
  return out;
}

// 最後の局面の中身。札は {key（札の変種のキー）, id（番号）, g:{score, scoreTimes}}。エンジンの canon の形（tecnai.mjs の canon）を読む
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
