import {eotOf} from './steps.js?v=1.17.12';
import {D} from './data.js?v=1.17.12';
import {S, save, deck, STANCES} from './store.js?v=1.17.12';
import {h, pic, fmt, toast, qtip} from './ui.js?v=1.17.12';
import {RUN, startRun, cancelRun, lastBudget, betterThan, resumeRun, canResume, phaseSig} from './run.js?v=1.17.12';
import {validate, entries, zoneOf} from './phase.js?v=1.17.12';
import {STATUS, orderText, critText} from './result.js?v=1.17.12';
import {turnEnd, canExpand, expandSolve} from './solver.js?v=1.17.12';
import {buildNextPhase, playPath} from './nextturn.js?v=1.17.12';
import {copyReport} from './report.js?v=1.17.12';

const EXTRA_NAME = {ev: '期待最終点', floor: '最低最終点'};
const num1 = x => x === null || x === undefined ? '—' : (Math.round(x * 10) / 10).toLocaleString('ja-JP');
const num3 = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 1000).toLocaleString('ja-JP');
const secText = ms => ms < 1000 ? '1秒未満' : ms < 10000 ? (ms / 1000).toFixed(1) + '秒' : Math.round(ms / 1000) + '秒';
const headOrder = R => R.objective === 'beyondGoal' ? '点数を伸ばす（届く確率 → 期待最終点）・' : !R.order ? '' : !R.order.includes('d') ? ordWords(R.order) + '・'
  : 'ドリンクを温存（' + (R.criterion === 'max' ? '届く確率 → ' : `達成率 ${R.criterion}% 以上で `) + ordWords(R.order.replace('p', '')) + '）・';
const ordWords = o => o.split('').map(c => ({d: 'ドリンク', p: '届く確率', a: '手数'})[c]).join(' → ');
const pct = x => { const v = x * 100; if (v > 0 && v < 0.01) return Number(v.toPrecision(2)) + '%'; return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '%'; };
const drawnText = d => d.length ? 'ドロー札：' + d.map(x => x.name).join('・') : '（ドロー札なし）';
let detailsOpen = false, making = false, makeErr = null, timer = null;
function recompute(over = {}, opt = {}) {
  const dk = deck(), P = S.phase, p = P.params;
  const label = `${STANCES.find(s => s[0] === p.stance)[1]}・手札${entries(dk, P).filter(e => zoneOf(P, e.uid) === 'hand').length}枚・目標${fmt(p.target)}`;
  S.history.unshift({at: Date.now(), deckId: dk.id, label, phase: structuredClone(P)}); S.history = S.history.slice(0, 30);
  detailsOpen = false; save(); startRun(over, opt);
}

const SAME_KEYS = ['zones', 'held', 'extra', 'assume', 'drinksHeld', 'itemState', 'registered', 'params'];
const sig = P => JSON.stringify(SAME_KEYS.map(k => P?.[k] ?? null));
export const isStale = () => !!(S.result?.phase && S.phase && (sig(S.result.phase) !== sig(S.phase) || S.result.deckChanged));

function walk(tree, steps) {
  let id = tree.root, waiting = false;
  for (const s of steps) { const n = tree.nodes[id]; if (s.type === 'act') { if (n.edges.length === 1) id = n.edges[0].next; else waiting = true; } else { id = n.edges[s.i].next; waiting = false; } }
  return {node: tree.nodes[id], id, waiting};
}
function mergeSub(tree, at, sub) {
  const off = tree.nodes.length;
  for (const n of sub.nodes) { if (n.edges) n.edges = n.edges.map(e => ({...e, next: e.next + off})); tree.nodes.push(n); }
  tree.nodes[at] = tree.nodes[off + sub.root];
}
let expanding = null;
function nextPreview(tree, node, moveNo) {
  if (!node.edges?.length) return null;
  if (node.edges.length === 1) {
    const c = tree.nodes[node.edges[0].next];
    if (!c) return null;
    if (c.end) return h('p.preview', {}, h('b', 'そのあと：'), c.cut ? '（この先は省略）' : c.reached ? 'ここで終わり（目標点に届く）' : 'ここで終わり');
    return h('p.preview', {}, h('b', `${moveNo + 1}手目の予定：`), c.icon ? pic(c.icon.kind, c.icon.id, c.act, 28) : null, c.act);
  }
  const seen = new Map();
  for (const e of node.edges) for (const x of e.drawn) if (!seen.has(x.id)) seen.set(x.id, x.name);
  if (!seen.size) return h('p.preview', {}, h('b', 'そのあと：'), '引きによって次の手が変わります');
  return h('div.preview', {}, h('b', '使ったあとに引く可能性がある札：'),
    h('div.prevcards', {}, [...seen].map(([id, name]) => h('span.pc', {}, pic('cards', id, name, 28), name))),
    h('p.hint', `押したあとに、実際に引いた札を選んでもらいます。${moveNo + 1}手目は、引いた札によって変わります。`));
}
function gainOf(tree, node) {
  const a = node.st; if (!a || !node.edges?.length) return null;
  const kids = node.edges.map(e => tree.nodes[e.next]?.st).filter(Boolean); if (!kids.length) return null;
  const ds = kids.map(b => b.score - a.score), lo = Math.min(...ds), hi = Math.max(...ds);
  const sc = lo === hi ? `+${fmt(lo)}` : `+${fmt(lo)}〜+${fmt(hi)}`;
  const tot = kids.map(b => b.score), tlo = Math.min(...tot), thi = Math.max(...tot);
  const parts = [];
  const same = f => kids.every(b => f(b) === f(kids[0]));
  if (same(b => b.heat) && kids[0].heat !== a.heat) parts.push(`熱意 ${fmt(a.heat)} → ${fmt(kids[0].heat)}`);
  if (same(b => b.extra) && kids[0].extra !== a.extra) parts.push(`熱意追加 ${fmt(a.extra)} → ${fmt(kids[0].extra)}`);
  const me = node.act.replace(/（.*$/, '');
  const hitText = x => (x.times > 1 ? `${fmt(x.v)} × ${x.times}回` : fmt(x.v)) + (x.src && x.src !== me ? `（${x.src}${x.phase === 'card' && x.via ? '・再演' : ''}）` : '');
  const eots = node.edges.map(e => eotOf(e));
  const eot = eots[0] && eots.every(x => x && x.total === eots[0].total && x.label === eots[0].label) ? eots[0] : null;
  if (eot) parts.push(`${eot.label} +${fmt(eot.total)}`);
  const hs = node.edges.map(e => e.hits ? e.hits.filter(x => !(eot && x.via === 'endOfTurn')).map(hitText).join(' ＋ ') : null);
  const own = lo - (eot?.total || 0);
  const plain = node.edges[0].hits?.length === 1 && node.edges[0].hits[0].times === 1;
  if (!plain && hs[0] && hs.every(x => x === hs[0]) && lo === hi && lo > 0) return {text: `使うとスコア ${hs[0]} ＝ +${fmt(own)}`, sub: `（このターンの合計 ${fmt(tlo)}${parts.length ? '・' + parts.join('・') : ''}）`, short: `${hs[0]} ＝ +${fmt(lo)}点`};
  return {text: `使うとスコア ${sc}`, sub: `（このターンの合計 ${tlo === thi ? fmt(tlo) : fmt(tlo) + '〜' + fmt(thi)}${parts.length ? '・' + parts.join('・') : ''}）`, short: `${sc}点`};
}

export function renderAnswer(root, rerender) {
  clearInterval(timer);
  const dk = deck(), P = S.phase;
  const running = RUN.status === 'running' || RUN.status === 'table';
  const v = validate(dk, P);
  const errs = v.filter(x => x[0] === 'err');
  const stale = isStale();
  const compute = () => recompute();
  const checkList = v.length ? h('ul.vlist.compact', v.map(([k, m]) => h('li', {class: k}, {err: '✖ ', warn: '⚠ ', info: 'ℹ '}[k], m))) : null;
  const fresh = S.result && !stale;
  const computeBtn = h('button.big.wide', {class: fresh ? 'sec' : 'pri', disabled: errs.length > 0 || running, onclick: compute},
    running ? '計算中…' : errs.length ? `直すところが ${errs.length} 件あります` : S.result ? '計算し直す' : '計算する');
  const computeBox = h('section.panel.ans.computebox', {}, stale && h('div.stale', '局面を変えました。下の答えは前の局面のものです。'),
    v.some(x => x[0] !== 'info') || !fresh ? (checkList || h('p.ok.compact', '✔ 入力に問題は見つかりません')) : null, computeBtn);

  if (running) {
    timer = setInterval(() => { const el = document.getElementById('elapsed'); if (el) el.textContent = ((Date.now() - RUN.started) / 1000).toFixed(1) + '秒'; else clearInterval(timer); }, 200);
    const fromPrev = RUN.prev && !betterThan(RUN.interim, RUN.prev);
    const I = RUN.status === 'running' ? (fromPrev ? RUN.prev : RUN.interim) : null;
    const notMet = I && I.meetsAlpha === false && I.criterion !== 'max';
    root.append(h('section.panel.ans', {},
      h('div.runline', {}, h('span.spin'), h('b', RUN.status === 'table' ? '比較表を計算中' : '計算中'), h('span#elapsed', ((Date.now() - RUN.started) / 1000).toFixed(1) + '秒'), !(RUN.status === 'running' && (RUN.interim?.tree || RUN.interimTree || RUN.prev)) && h('button.danger', {onclick: cancelRun}, RUN.status === 'table' ? '比較表をやめる' : '計算をやめる')),
      h('div.hint', RUN.stage),
      I && h('div.interim', {}, h('div.lbl', fromPrev ? '前の計算の答え（いま、もっと良い答えを探しています）' : '途中の答え（暫定。計算は続いています）'), notMet && h('p.warnline', `まだ指定の達成率 ${I.criterion}% に届いていません`), nextView(I, true)),
      RUN.status === 'running' && (RUN.interim?.tree || RUN.interimTree || RUN.prev) && h('div.decide', {},
        h('p.hint', `表示されている答えでよければ「この答えで決める」を押してください。そのまま待つと、もっと良い答えが見つかることがあります（最大 ${Math.round(lastBudget())}秒）。`),
        h('button.wide', {onclick: cancelRun}, !fromPrev && !RUN.interim?.tree && RUN.interimTree ? `この答えで決める（${Math.round((RUN.interimTree.ms || 0) / 1000)}秒の時点の答え）` : 'この答えで決める')),
      RUN.status === 'table' && S.result && resultView(S.result, rerender)));
    return;
  }
  if (RUN.status === 'error') root.append(h('section.panel.ans.errbar', {}, h('b', '計算できませんでした'), h('pre', RUN.error), h('p.hint', '局面の入力や「札の設定」を確かめてください。')));
  if (RUN.status === 'canceled' && !S.result) root.append(h('section.panel.ans.warnbar', {}, '計算をやめました。'));

  root.append(computeBox);
  if (!S.result || stale) {
    if (S.result && stale) root.append(h('section.panel.ans.old', {}, h('div.lbl', '前の局面の答え'), nextView(S.result, false)));
    return;
  }
  root.append(resultView(S.result, rerender, {checkList}));
}

function nextView(R, interim) {
  const b = R.best;
  return h('div.nextv', {},
    h('div.nmain', {}, R.nextIcon ? pic(R.nextIcon.kind, R.nextIcon.id, R.next, 64) : null, h('div.ntext', R.next || '—')),
    b && R.objective === 'beyondGoal' && h('div.kpis', {}, kpi('達成率', b.pText, '', '目標点に届く確率'), kpi('届いたときの平均点', b.evIfReachedNum == null ? (b.pNum === 0 ? '届かない' : '—') : fmt(Math.round(b.evIfReachedNum)), b.evIfReachedNum == null ? '' : '点', '目標点に届いた場合の、最終点の平均（届かない場合は含めない）。手は、届かない場合も含めた平均で選んでいます'), kpi('最低最終点', b.floorNum == null || b.pNum === 0 ? '—' : fmt(Math.round(b.floorNum)), b.floorNum == null || b.pNum === 0 ? '' : '点', '一番悪い引きのときの最終点')),
    b && R.objective === 'beyondGoal' && h('p.hint', (b.evIfReachedNum == null && b.pNum === 0 && b.evNum != null ? `届かない場合の平均 ${fmt(Math.round(b.evNum))}点（参考）・` : '') + `ドリンク ${num1(b.dNum)}本・手数 ${num1(b.aNum)}回（比べていません）`),
    b && R.objective !== 'beyondGoal' && h('div.kpis', {}, kpi('達成率', b.pText, '', '目標点に届く確率'), kpi('ドリンク', num1(b.dNum), '本', 'このあと使うドリンクの本数の見込み（引く札によって変わる数の平均）'), kpi('手数', num1(b.aNum), '回', 'このあと札やドリンクを使う回数の見込み（平均）')));
}
const kpi = (label, v, unit = '', tip = '') => h('div.kpi', {}, h('div.kl', label, tip && qtip(tip)), h('div.kv', v, h('small', unit)));

function resultView(R, rerender, {checkList} = {}) {
  let kind = R.canceled ? (R.kind === 'optimal' ? 'optimal' : 'provisional') : R.kind;
  if (kind === 'optimal' && R.optimalityProven === false) kind = 'provisional';
  const [stName, stCls, stDesc] = STATUS[kind] || STATUS.incomplete;
  const b = R.best;
  const box = h('section.panel.ans', {});
  const add = (...xs) => box.append(...xs.filter(x => x));
  add(h('div.ansHead', {}, h('span.status', {class: stCls, title: stDesc}, stName + (R.canceled ? '（途中で決定）' : '')),
    h('span.hint', {title: R.criterion === 'max' ? '達成率最大の答え' : `${R.criterion}%で良ければの答え`}, headOrder(R) + secText(R.ms) + 'で計算')));
  for (const n of R.notes || []) {
    add(h('p.warnline', n));
    if (/^本領発揮/.test(n)) add(h('p.warnline', '保留から出てくる順番は、実はゲーム内ではわかりません。山札の札を2枚保留に送ると、山札の中で順番が早い方が先に保留に送られますが、ゲーム内では山札の中の順番はわからないためです。つまり、GUI で出てくる保留と、実際のゲーム内の保留の挙動が違うときがあります。そのときは、その局面から計算し直してください。'));
  }
  const tags = [R.followed && ['前の答えから即答', '前の局面の答えから読み出しました（計算し直していません。答えは計算し直したときと同じです）'],
    R.retargeted && ['前の計算を使用', '同じ局面の前の計算を使って、目標・基準を変えた答えを出しました（答えは計算し直したときと同じです）'],
    R.imported && ['PC で計算した答え', 'PC の道具（solve-report.mjs）で計算した答えを読み込みました。手順の木の「ほかの引き」の先は、ここから局面を作って計算し直してください'],
    R.keptPrev && ['前の答えを残した', '予算を増やして計算し直しましたが、前の答えより良い答えは見つからなかったので、前の答えを残しました']].filter(Boolean);
  if (tags.length) add(h('div.tags', {}, tags.map(([t, d]) => h('span.tag', {title: d}, t))));
  if (R.meetsAlpha === false && R.criterion !== 'max') add(h('p.warnline', `この答えは、指定した達成率 ${R.criterion}% に届いていません。時間内に見つかった中で一番よい手順です。「続きから計算する」で届く手順が見つかることがあります。`));
  const ms = R.maxScore;
  if (b && b.pNum === 0 && kind === 'optimal') add(h('p.warnline', '目標点に届く手順がありません（届く最大 0%）。' + (ms?.exact && !ms.reached ? `どう引いても、最大で ${fmt(ms.value)} 点です。` : '')));
  else if (ms?.exact && !ms.reached) add(h('p.hint', `どう打っても、取れる点は最大で ${fmt(ms.value)} 点です（目標点に届かない）。`));
  if (R.tree) {
    S.play ||= {steps: []};
    const steps = S.play.steps;
    const {node, id: nodeId, waiting} = walk(R.tree, steps);
    const push = s => { steps.push(s); save(); rerender(); };
    const moveNo = steps.filter(x => x.type === 'act').length + (waiting ? 0 : 1);
    if (!steps.length) add(h('div.lbl', '1手目'), nextView(R, false));
    if (node.end && node.cut && !node.expandErr && canExpand()) {
      if (expanding !== node) { expanding = node; const tree = R.tree;
        expandSolve(node.key, node.path, d => { expanding = null; if (d.tree) mergeSub(tree, nodeId, d.tree); else node.expandErr = d.error || '取り寄せられませんでした'; save(); rerender(); }); }
      add(h('div.lbl', '次の手'), h('p.hint', '続きの手順を取り寄せています…'));
    } else if (node.end && node.cut) {
      add(h('div.lbl', 'この先の案内は省略しました'), h('p.hint', `答えが大きいので、この先の手順は画面に入れていません（この先の達成率 ${pct(node.p)}）。「ここから局面を作る」で計算し直すと、続きの手順が出ます。`),
        R.setup && deck()?.id === R.deckId && h('button.big.pri.wide', {disabled: making, onclick: () => makePhase(R, steps, rerender, true)}, making ? '作っています…' : 'ここから局面を作る →'),
        makeErr && h('p.warnline', '作れませんでした：' + makeErr));
    } else if (node.end) {
      add(h('div.lbl', 'ここで終わり'), h('div.ntext.mid', node.reached ? '目標点に届きました' : 'これ以上は打ちません'),
        R.setup && deck()?.id === R.deckId && h('button.big.pri.wide', {disabled: making, onclick: () => makePhase(R, steps, rerender, false)}, making ? '作っています…' : '次のターンの局面を作る →'),
        makeErr && h('p.warnline', '作れませんでした：' + makeErr));
    } else if (waiting) {
      add(...drawPicker(node, push, steps.length, rerender));
    } else {
      if (steps.length) add(h('div.lbl', `${moveNo}手目`), h('div.nmain', {}, node.icon ? pic(node.icon.kind, node.icon.id, node.act, 64) : null, h('div.ntext', node.act)),
        h('div.kpis', {}, kpi('この先の達成率', pct(node.p))));
      if (node.lost) add(h('p.lostline', {}, h('b', '目標点には届きません。'), '点を伸ばす手（札だけで、点の平均が一番高い手）を案内しています。', h('small.unsup', '試作・未検証')));
      if (node.sameEval > 1) add(h('p.hint', `この局面では、同じ評価の手が ${node.sameEval} 通りあります。`));
      const g = gainOf(R.tree, node);
      if (g) add(h('p.gainline', {}, h('b', g.text), g.sub && h('span', g.sub)));
      const verb = node.kind === 'endTurn' ? 'ターンを終える' : node.kind === 'drink' ? `${node.act} を飲む` : `${node.act} を使う`;
      add(h('ol.howto', {}, h('li', `ゲームで ${verb}`), h('li', '終わったら、下のボタンを押す（次の手を案内します）')));
      add(h('button.big.pri.wide', {onclick: () => push({type: 'act', label: node.act, gain: g?.short || null})}, node.kind === 'endTurn' ? 'ターンを終えたら押す →' : node.kind === 'drink' ? 'ゲームで飲んだら押す →' : 'ゲームで使ったら押す →'));
      add(nextPreview(R.tree, node, moveNo));
      if (steps.length && R.setup && deck()?.id === R.deckId) add(h('button.wide.midbtn', {disabled: making, title: '今の手札・行動回数・熱意などのまま、局面の入力にします。目標点はここまでに入った点を引きます',
        onclick: () => makePhase(R, steps, rerender, true)}, making ? '作っています…' : 'ここから局面を作る（今の手札・行動回数のまま）'),
        makeErr && h('p.warnline', '作れませんでした：' + makeErr));
    }
    if (steps.length) add(h('div.histline', {}, h('ol', steps.map(s => h('li', {class: s.type}, s.type === 'act' ? s.label.replace(/ を(使う|飲む)$/, '') + (s.gain ? `（${s.gain}）` : '') : s.label))),
      h('div.row', {}, h('button.mini', {onclick: () => { steps.pop(); save(); rerender(); }}, '1つ戻す'), h('button.mini', {onclick: () => { S.play = {steps: []}; save(); rerender(); }}, '最初から'))));
  } else add(h('div.lbl', '次の手'), nextView(R, false), R.treeDropped && h('p.hint', '答えが大きいので、プレイの案内（使った → 引いた札）は保存していません。続けて案内を使うときは、計算し直してください。'));

  if (R.alt && !(S.play?.steps?.length)) add(altView(R, rerender));
  if (kind !== 'optimal') {
    const sec = Math.round((R.budgetSec ?? S.settings.budgetSec) * 2), states = Math.round((R.maxStates ?? S.settings.maxStates) * 2);
    const addSec = Math.max(10, Math.round(S.settings.budgetSec));
    const resumeOk = R.resumable && canResume();
    const memStop = !R.resumable && /MEMORY_LIMIT|GROWTH_LIMIT/.test(R.resumeReason || '');
    if (memStop) { add(h('div.budget', {},
      h('p.hint', 'このブラウザでは、これ以上良くできません（メモリの上限）', qtip('今の答えは、ここまでに見つかった一番よい手順です。引いた札が決まったら「ここから局面を作る」で計算し直すと、最善の手が分かることがあります。「詳しい条件」でドリンクの上限を入れると、計算が軽くなります。（' + (R.resumeReason || '') + '）')))); }
    else add(h('div.budget', {},
      b && b.pNum === 0 ? h('p.warnline', 'まだ目標点に届く手順が見つかっていません', qtip('届かないと決まったわけではありません。「続きから計算する」で見つかることがあります'))
        : null,
      resumeOk
        ? h('button.wide', {disabled: !!checkList?.querySelector?.('.err'), onclick: () => resumeRun(addSec)}, `続きから計算する（＋${addSec}秒。ここまでの計算を使う）`)
        : h('button.wide', {disabled: !!checkList?.querySelector?.('.err'), onclick: () => recompute({budgetSec: sec, maxStates: states}, {keep: true})}, `予算を2倍にして計算し直す（${sec}秒・状態 ${fmt(states)}）`),
      !resumeOk && R.resumeReason && h('p.hint', '続きからはできません', qtip(R.resumeReason))));
  }


  if (R.tree) add(h('button.wide.stepsbtn', {onclick: () => { S.ui.steps = !S.ui.steps; save(); rerender(); if (S.ui.steps) setTimeout(() => document.getElementById('steps')?.scrollIntoView({behavior: 'smooth'}), 50); }},
    S.ui.steps ? '全手順の表を閉じる' : '全手順の表（くわしく見たい人向け） ↓'));
  add(h('button.more', {onclick: () => { detailsOpen = !detailsOpen; rerender(); }}, (detailsOpen ? '▾' : '▸') + ' 詳しく（比較表・自然さ・答えの確かさ）'));
  if (detailsOpen) add(details(R, kind, stName, stCls));
  add(h('button.more', {title: '版・設定・局面・答えをコピーします（個人情報は入りません）', onclick: copyReport}, '答えがおかしい？ 報告用の情報をコピー'));
  return box;
}

let pick = {key: null, ids: []};
function drawPicker(node, push, key, rerender) {
  if (pick.key !== key) pick = {key, ids: []};
  const rest = e => { const r = e.drawn.map(x => x.id); for (const id of pick.ids) { const i = r.indexOf(id); if (i < 0) return null; r.splice(i, 1); } return r; };
  const cand = node.edges.map((e, i) => ({e, i, rest: rest(e)})).filter(c => c.rest);
  const go = c => push({type: 'draw', i: c.i, label: drawnText(c.e.drawn)});
  const names = new Map(node.edges.flatMap(e => e.drawn.map(x => [x.id, x.name])));
  const ids = [...new Set(cand.flatMap(c => c.rest))];
  const choose = id => { pick.ids.push(id); const left = node.edges.filter(e => rest(e)); if (left.length === 1) go({e: left[0], i: node.edges.indexOf(left[0])}); else rerender(); };
  const exact = cand.filter(c => !c.rest.length);
  return [h('div.lbl', '何を引きましたか？'),
    h('p.hint', pick.ids.length ? `${pick.ids.length + 1}枚目は？（順は関係ありません）` : 'ゲームで引いた札を、1枚ずつ押してください（順は関係ありません）'),
    pick.ids.length ? h('div.row.picked', {}, h('span', '選んだ札：' + pick.ids.map(id => names.get(id)).join('・')), h('button.mini', {onclick: () => { pick.ids.pop(); rerender(); }}, '1つ戻す')) : null,
    h('div.draws.chips', ids.map(id => h('button.drawbtn', {onclick: () => choose(id)}, pic('cards', id, names.get(id), 40), h('b', names.get(id))))),
    ...exact.map(c => h('button.wide', {onclick: () => go(c)}, (c.e.drawn.length ? `これで全部（${drawnText(c.e.drawn)}）` : 'ドロー札なし') + (exact.length > 1 && c.e.hand ? `　手札：${c.e.hand.map(x => x.name).join('・')}` : '')))];
}

const ALT_LABEL = R => R.criterion === 'max' ? '達成率最大なら' : `${R.criterion}%で良ければ`;
function altView(R, rerender) {
  const A = R.alt, b = A.best;
  const swap = () => {
    const {alt, ...main} = R;
    const own = ['kind', 'kindLabel', 'status', 'solver', 'scope', 'proven', 'reason', 'best', 'pMax', 'optimalityProven', 'meetsAlpha', 'natural', 'sameEval', 'tree', 'next', 'nextIcon', 'criterion', 'trials', 'stats', 'maxScore', 'notes'];
    const mainOwn = Object.fromEntries(own.map(k => [k, main[k]]));
    S.result = {...main, ...Object.fromEntries(own.map(k => [k, A[k]])), alt: mainOwn};
    S.play = {steps: []}; save(); rerender();
  };
  return h('div.altans', {},
    h('div.altline', {}, h('b', ALT_LABEL(A) + '：'), b ? `達成率 ${b.pText}・ドリンク ${num1(b.dNum)}本・手数 ${num1(b.aNum)}回` : '—', A.next && h('span.altnext', '・次の手 ' + A.next)),
    A.meetsAlpha === false && A.criterion !== 'max' && h('p.hint', `まだ ${A.criterion}% に届いていません（時間内に見つかった中で一番よい手順）。`),
    h('button', {onclick: swap}, 'こちらでプレイする'));
}

function makePhase(R, steps, rerender, mid) {
  making = true; makeErr = null; rerender();
  const path = playPath(R.tree, steps);
  turnEnd({setup: R.setup, target: R.target, calcSettings: R.calcSettings ?? null, path}, {
    done: st => {
      making = false; const old = R.phase || S.phase;
      S.history.unshift({at: Date.now(), deckId: old.deckId, label: mid ? 'プレイの途中から作る前の局面' : '次のターンを作る前の局面', phase: structuredClone(S.phase)}); S.history = S.history.slice(0, 30);
      S.phase = buildNextPhase(deck(), old, {...st, steps: steps.filter(x => x.type === 'act').length}, {mid});
      if (mid && R.canFollow && path.length) S.phase.carry.follow = {path, sig: phaseSig(S.phase), calcSettings: R.calcSettings ?? null};
      S.result = null; S.play = null; save();
      toast(mid ? 'ここからの局面を作りました' : '次のターンの局面を作りました'); rerender();
    },
    error: m => { making = false; makeErr = m; rerender(); }});
}

function details(R, kind, stName, stCls) {
  const b = R.best, T = R.table, n = R.natural;
  const rows = [...(T?.rows || []).map(r => ({...r, cur: R.criterion !== 'max' && r.alpha === R.criterion + '%'})),
    ...(R.criterion === 'max' && b ? [{alpha: '届く最大', best: b, next: R.next, cur: true}] : [])];
  const se = R.sameEval;
  return h('div.details', {},
    se && (se.root > 1 || se.altNodes > 0) && h('div.same', {},
      se.root > 1 && h('div', `今の局面で、同じ評価の手が ${se.root} 通りあります。`),
      se.altNodes > 0 && h('div', `同じ評価の別の手順があります（${se.altNodes} か所）。` + (R.extras?.length ? '' : '自然さで選ぶ場合は、設定で自然さにチェックを入れてください。'))),
    h('h3', '達成率ごとの比較'),
    h('table.tbl', {}, h('thead', h('tr', ['基準', '達成率', 'ドリンク', '操作', '次の手'].map(t => h('th', t)))),
      h('tbody', rows.map(r => h('tr', {class: r.cur ? 'cur' : ''}, h('td', r.alpha),
        ...(r.best ? [h('td.n', r.best.pText), h('td.n', num3(r.best.dNum)), h('td.n', num3(r.best.aNum)), h('td', r.next || '—')] : [h('td', {colSpan: 4}, '届きません')]))))),
    !T && h('p.hint', '比較表はありません（予算切れ・中止）。'),
    h('p.hint', `比べる順：${orderText(R.order)}。基準：${critText(R.criterion)}。`),
    b && h('p.hint', `正確な値：達成率 ${b.p}、ドリンク ${b.d}、操作 ${b.a}`),
    h('h3', '自然さ'),
    n && !n.error ? h('div', {},
      h('p.hint', R.extras?.length ? `自然さで選びました（${R.extras.map(k => EXTRA_NAME[k]).join('・')}）。` : '参考：選んだ手順の値です。自然さで選んだのではないので、自然さが最良とは限りません。'),
      h('table.tbl.narrow', {}, h('tbody', h('tr', h('th', '期待最終点'), h('td.n', fmt(Math.round(n.evNum)))), h('tr', h('th', '最低最終点'), h('td.n', fmt(n.floorNum))))))
      : h('p.hint', n?.error ? '自然さの値を計算できませんでした：' + n.error : '—'),
    h('h3', '答えの確かさ'),
    h('table.tbl.narrow', {}, h('tbody',
      h('tr', h('th', '種類'), h('td', h('span.status', {class: stCls}, stName))),
      R.scope && kind === 'optimal' && h('tr', h('th', '範囲'), h('td', R.scope)),
      R.proven && kind !== 'optimal' && h('tr', h('th', '証明できた範囲'), h('td', R.proven)),
      h('tr', h('th', '解いた部品'), h('td', R.solver)),
      R.trials?.length ? h('tr', h('th', '試した順'), h('td', R.trials.join(' → '))) : null,
      h('tr', h('th', '調べた状態'), h('td.n', R.stats?.nodes ? fmt(R.stats.nodes) : '—')),
      h('tr', h('th', '目標点'), h('td.n', fmt(R.target))),
      h('tr', h('th', '版'), h('td', `計算 ${D.version.engine.commit || ''}・データ ${D.version.data.commit || ''}`)))));
}
