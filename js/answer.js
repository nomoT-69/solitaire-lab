// ソリティアの画面の右側：答えの欄。計算の前は「確かめ」と「計算する」、計算中は進み具合、計算の後は次の手とプレイの案内。
// プレイの案内は同じ欄の中で進む（「使った」→「何を引いた？」→ 次の手）。比較表・自然さ・答えの確かさは「詳しく」にたたむ。
import {D} from './data.js';
import {S, save, deck, STANCES} from './store.js';
import {h, pic, fmt, toast} from './ui.js';
import {RUN, startRun, cancelRun, betterThan, resumeRun, canResume, phaseSig} from './run.js';
import {validate, entries, zoneOf} from './phase.js';
import {STATUS, orderText, critText} from './result.js';
import {turnEnd} from './solver.js';
import {buildNextPhase, playPath} from './nextturn.js';
import {copyReport} from './report.js';

const EXTRA_NAME = {ev: '期待最終点', floor: '最低最終点'};
const num3 = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 1000).toLocaleString('ja-JP');
const pct = x => (Math.round(x * 10000) / 100) + '%';
const drawnText = d => d.length ? '来た札：' + d.map(x => x.name).join('・') : '（新しく来た札なし）';
let detailsOpen = false, making = false, makeErr = null, timer = null;
// 計算する（over：この1回だけの予算）。計算した局面は「前の局面」に残す
function recompute(over = {}, opt = {}) {
  const dk = deck(), P = S.phase, p = P.params;
  const label = `${STANCES.find(s => s[0] === p.stance)[1]}・手札${entries(dk, P).filter(e => zoneOf(P, e.uid) === 'hand').length}枚・目標${fmt(p.target)}`;
  S.history.unshift({at: Date.now(), deckId: dk.id, label, phase: structuredClone(P)}); S.history = S.history.slice(0, 30);
  detailsOpen = false; save(); startRun(over, opt);
}

// 局面が、答えを出したときの局面と同じか（違えば、答えは古い）
const SAME_KEYS = ['zones', 'held', 'extra', 'assume', 'drinksHeld', 'itemState', 'registered', 'params'];
const sig = P => JSON.stringify(SAME_KEYS.map(k => P?.[k] ?? null));
export const isStale = () => !!(S.result?.phase && S.phase && sig(S.result.phase) !== sig(S.phase));

// 方策の木をたどる（S.play.steps）
function walk(tree, steps) {
  let id = tree.root, waiting = false;
  for (const s of steps) { const n = tree.nodes[id]; if (s.type === 'act') { if (n.edges.length === 1) id = n.edges[0].next; else waiting = true; } else { id = n.edges[s.i].next; waiting = false; } }
  return {node: tree.nodes[id], waiting};
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
  const computeBtn = h('button.big.pri.wide', {disabled: errs.length > 0 || running, onclick: compute},
    running ? '計算中…' : errs.length ? `直すところが ${errs.length} 件あります` : S.result ? '計算し直す' : '計算する');

  // 計算中
  if (running) {
    timer = setInterval(() => { const el = document.getElementById('elapsed'); if (el) el.textContent = ((Date.now() - RUN.started) / 1000).toFixed(1) + '秒'; else clearInterval(timer); }, 200);
    // 途中の答え：今の計算の途中の答えと、前の計算の答え（予算を増やして計算し直すとき）の良いほう
    const fromPrev = RUN.prev && !betterThan(RUN.interim, RUN.prev);
    const I = RUN.status === 'running' ? (fromPrev ? RUN.prev : RUN.interim) : null;
    const notMet = I && I.meetsAlpha === false && I.criterion !== 'max';
    root.append(h('section.panel.ans', {},
      h('div.runline', {}, h('span.spin'), h('b', RUN.status === 'table' ? '比較表を計算中' : '計算中'), h('span#elapsed', ((Date.now() - RUN.started) / 1000).toFixed(1) + '秒'), h('button.danger', {onclick: cancelRun}, '中止')),
      h('div.hint', RUN.stage),
      I && h('div.interim', {}, h('div.lbl', fromPrev ? '前の計算の答え（いま、もっと良い答えを探しています）' : '途中の答え（暫定。計算は続いています）'), notMet && h('p.warnline', `まだ指定の達成率 ${I.criterion}% に届いていません`), nextView(I, true)),
      RUN.status === 'table' && S.result && resultView(S.result, rerender)));
    return;
  }
  if (RUN.status === 'error') root.append(h('section.panel.ans.errbar', {}, h('b', '計算できませんでした'), h('pre', RUN.error), h('p.hint', '局面の入力や「札の設定」を確かめてください。')));
  if (RUN.status === 'canceled' && !S.result) root.append(h('section.panel.ans.warnbar', {}, '中止しました。'));

  // 答えがない、または局面を変えた
  if (!S.result || stale) {
    root.append(h('section.panel.ans', {},
      stale && h('div.stale', '局面を変えました。下の答えは前の局面のものです。'),
      h('h2', '入力の確かめ'), checkList || h('p.ok', '✔ 問題は見つかりません'), computeBtn));
    if (S.result && stale) root.append(h('section.panel.ans.old', {}, h('div.lbl', '前の局面の答え'), nextView(S.result, false)));
    return;
  }
  root.append(resultView(S.result, rerender, {checkList, computeBtn}));
}

// 次の手の見せ方（大きく）
function nextView(R, interim) {
  const b = R.best;
  return h('div.nextv', {},
    h('div.nmain', {}, R.nextIcon ? pic(R.nextIcon.kind, R.nextIcon.id, R.next, 64) : null, h('div.ntext', R.next || '—')),
    b && h('div.kpis', {}, kpi('達成率', b.pText), kpi('ドリンク', num3(b.dNum), '本'), kpi('操作', num3(b.aNum), '回')));
}
const kpi = (label, v, unit = '') => h('div.kpi', {}, h('div.kl', label), h('div.kv', v, h('small', unit)));

function resultView(R, rerender, {checkList, computeBtn} = {}) {
  // エンジンが「全体で最適とは証明できていない」と言うときは、最適と出さない（optimalityProven、AEGIS_SPEC.md 8章）
  let kind = R.canceled ? (R.kind === 'optimal' ? 'optimal' : 'provisional') : R.kind;
  if (kind === 'optimal' && R.optimalityProven === false) kind = 'provisional';
  const [stName, stCls, stDesc] = STATUS[kind] || STATUS.incomplete;
  const b = R.best;
  const box = h('section.panel.ans', {});
  const add = (...xs) => box.append(...xs.filter(x => x));   // false・null は出さない
  add(h('div.ansHead', {}, h('span.status', {class: stCls, title: stDesc}, stName + (R.canceled ? '（中止）' : '')),
    h('span.hint', `${critText(R.criterion).replace('100%にできれば100%、できなければ届く最大の達成率', '届く最大の達成率')}・${(R.ms / 1000).toFixed(1)}秒`)));
  if (R.followed) add(h('p.hint', '前の局面の最適の答えから読み出しました（計算し直していません。答えは計算し直したときと同じです）。'));
  if (R.keptPrev) add(h('p.hint', '予算を増やして計算し直しましたが、前の答えより良い答えは見つからなかったので、前の答えを残しました。'));
  // 達成率を指定した計算（95% など）で、その達成率に届かない暫定の答え
  if (R.meetsAlpha === false && R.criterion !== 'max') add(h('p.warnline', `この答えは、指定した達成率 ${R.criterion}% に届いていません。時間内に見つかった中で一番よい手順です。「続きから計算する」で届く手順が見つかることがあります。`));
  const ms = R.maxScore;
  if (b && b.pNum === 0 && kind === 'optimal') add(h('p.warnline', '目標点に届く手順がありません（届く最大 0%）。' + (ms?.exact && !ms.reached ? `どう引いても、最大で ${fmt(ms.value)} 点です。` : '')));
  else if (ms?.exact && !ms.reached) add(h('p.hint', `どう打っても、取れる点は最大で ${fmt(ms.value)} 点です（目標点に届かない）。`));
  if (R.retargeted) add(h('p.hint', '同じ局面の前の計算を使って、目標・基準を変えた答えを出しました（答えは計算し直したときと同じです）。'));
  // 暫定（予算切れ・中止）：予算を2倍にして計算し直す道を出す。達成率0%の暫定は、届かないと決まったわけではないことを書く
  if (kind !== 'optimal') {
    const sec = Math.round((R.budgetSec ?? S.settings.budgetSec) * 2), states = Math.round((R.maxStates ?? S.settings.maxStates) * 2);
    const addSec = Math.max(10, Math.round(S.settings.budgetSec));   // 続きから足す時間（設定の予算と同じ）
    const resumeOk = R.resumable && canResume();
    add(h('div.budget', {},
      b && b.pNum === 0 ? h('p.warnline', 'この予算の中では、目標点に届く手順がまだ見つかっていません（届かないと決まったわけではありません）。下のボタンで見つかることがあります。')
        : h('p.hint', '予算（時間・状態数）の中で見つけた答えです。最適とは限りません。'),
      resumeOk
        ? h('button.wide.pri', {disabled: !!checkList?.querySelector?.('.err'), onclick: () => resumeRun(addSec)}, `続きから計算する（＋${addSec}秒。ここまでの計算を使う）`)
        : h('button.wide', {disabled: !!checkList?.querySelector?.('.err'), onclick: () => recompute({budgetSec: sec, maxStates: states}, {keep: true})}, `予算を2倍にして計算し直す（${sec}秒・状態 ${fmt(states)}）`),
      !resumeOk && R.resumeReason && h('p.hint', '続きからはできません：' + R.resumeReason),
      R.resumedSec ? h('p.hint', `ここまでの計算：${R.budgetSec}秒（うち続きから ${R.resumedSec}秒）`) : null,
      h('p.hint', 'いつもの予算は「設定」で変えられます。')));
  }

  // プレイの案内（同じ欄の中で進む）
  if (R.tree) {
    S.play ||= {steps: []};
    const steps = S.play.steps;
    const {node, waiting} = walk(R.tree, steps);
    const push = s => { steps.push(s); save(); rerender(); };
    if (!steps.length) add(h('div.lbl', '次の手'), nextView(R, false));
    if (node.end) {
      add(h('div.lbl', 'ここで終わり'), h('div.ntext.mid', node.reached ? '目標点に届きました' : 'これ以上は打ちません'),
        R.setup && deck()?.id === R.deckId && h('button.big.pri.wide', {disabled: making, onclick: () => makePhase(R, steps, rerender, false)}, making ? '作っています…' : '次のターンの局面を作る →'),
        makeErr && h('p.warnline', '作れませんでした：' + makeErr));
    } else if (waiting) {
      add(h('div.lbl', '何を引きましたか？'),
        h('p.hint', '使った後の手札（全部）です。色の枠が、新しく来た札です。'),
        h('div.draws', node.edges.map((e, i) => h('button.drawbtn', {onclick: () => push({type: 'draw', i, label: drawnText(e.drawn)})},
          h('div.dpics', (e.hand || e.drawn).slice(0, 6).map(x => h('span.hcard', {class: x.isNew !== false ? 'new' : 'old'}, pic('cards', x.id, x.name, 34)))),
          h('b', drawnText(e.drawn)),
          e.hand && h('span.handtxt', '手札：' + e.hand.map(x => x.name).join('・')),
          h('small', pct(e.p))))));
    } else {
      if (steps.length) add(h('div.lbl', '次の手'), h('div.nmain', {}, node.icon ? pic(node.icon.kind, node.icon.id, node.act, 64) : null, h('div.ntext', node.act)),
        h('div.kpis', {}, kpi('この先の達成率', pct(node.p))));
      if (node.sameEval > 1) add(h('p.hint', `この局面では、同じ評価の手が ${node.sameEval} 通りあります。`));
      add(h('button.big.pri.wide', {onclick: () => push({type: 'act', label: node.act})}, node.kind === 'endTurn' ? 'ターンを終えた →' : node.kind === 'drink' ? '飲んだ →' : '使った →'));
      // プレイの途中：ここまでの局面を、計算の入力にする（引いた札が決まったあとで計算し直すと速い）
      if (steps.length && R.setup && deck()?.id === R.deckId) add(h('button.wide.midbtn', {disabled: making, title: '今の手札・行動回数・熱意などのまま、局面の入力にします。目標点はここまでに入った点を引きます',
        onclick: () => makePhase(R, steps, rerender, true)}, making ? '作っています…' : 'ここから局面を作る（今の手札・行動回数のまま）'),
        makeErr && h('p.warnline', '作れませんでした：' + makeErr));
    }
    if (steps.length) add(h('div.histline', {}, h('ol', steps.map(s => h('li', {class: s.type}, s.type === 'act' ? s.label.replace(/ を(使う|飲む)$/, '') : s.label))),
      h('div.row', {}, h('button.mini', {onclick: () => { steps.pop(); save(); rerender(); }}, '1つ戻す'), h('button.mini', {onclick: () => { S.play = {steps: []}; save(); rerender(); }}, '最初から'))));
  } else add(h('div.lbl', '次の手'), nextView(R, false));

  // 同じ評価の手順（短く）
  const se = R.sameEval;
  if (se && (se.root > 1 || se.altNodes > 0)) add(h('div.same', {},
    se.root > 1 && h('div', `今の局面で、同じ評価の手が ${se.root} 通りあります。`),
    se.altNodes > 0 && h('div', `同じ評価の別の手順があります（${se.altNodes} か所）。` + (R.extras?.length ? '' : '自然さで選ぶ場合は、設定で自然さにチェックを入れてください。'))));

  // 詳しく
  if (R.tree) add(h('button.wide.stepsbtn', {onclick: () => { S.ui.steps = !S.ui.steps; save(); rerender(); if (S.ui.steps) setTimeout(() => document.getElementById('steps')?.scrollIntoView({behavior: 'smooth'}), 50); }},
    S.ui.steps ? '全手順（詳細）を閉じる' : '全手順（詳細）を見る ↓'));
  add(h('button.more', {onclick: () => { detailsOpen = !detailsOpen; rerender(); }}, (detailsOpen ? '▾' : '▸') + ' 詳しく（比較表・自然さ・答えの確かさ）'));
  if (detailsOpen) add(details(R, kind, stName, stCls));
  if (computeBtn) add(h('div.recalc', {}, checkList, computeBtn));
  add(h('button.more', {title: '版・設定・局面・答えをコピーします（個人情報は入りません）', onclick: copyReport}, '答えがおかしい？ 報告用の情報をコピー'));
  return box;
}

// 局面を作る：mid＝プレイの途中から（手札・行動回数のまま）、そうでなければ次のターン
function makePhase(R, steps, rerender, mid) {
  making = true; makeErr = null; rerender();
  const path = playPath(R.tree, steps);
  turnEnd({setup: R.setup, target: R.target, calcSettings: R.calcSettings ?? null, path}, {
    done: st => {
      making = false; const old = R.phase || S.phase;
      S.history.unshift({at: Date.now(), deckId: old.deckId, label: mid ? 'プレイの途中から作る前の局面' : '次のターンを作る前の局面', phase: structuredClone(S.phase)}); S.history = S.history.slice(0, 30);
      S.phase = buildNextPhase(deck(), old, {...st, steps: steps.filter(x => x.type === 'act').length}, {mid});
      // 最適の答えの途中から作った局面は、直さずに計算すれば、前の答えから即答できる（run.js・worker.js の follow）
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
  return h('div.details', {},
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
