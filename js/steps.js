// 全手順（詳細）：方策の木（引いた札ごとの全部の分かれ）を表にする。見方は2つ：
//   手順ごと（既定）：引いた札の出方ごとに、最初から終わりまでの1本の手順に分け、起きやすい順に「手順1・2・3…」と切り替えて見る
//   全部の表：昔のスプレッドシートのように、全部の分かれを1つの表に（分かれはたためる）
// 列は、見たいものにチェックを入れたものだけ出す（S.ui.stepCols。手順・手はいつも出す）。
// 列：手順、手、ドロー札、このドローの確率、ここまでの確率、スコア（増えた分 → 累計）、熱意・熱意追加・熱意倍率・スコア上昇（増えた分 → 後の値）、
//     指針、残り行動、残りのドリンク、この先の達成率。オプションで、継続効果（夏夜など）のカウンタと、その1手で出したスコア（火力）。分かれ（引いた札で手順が分かれるところ）は押すとたためる。CSV に書き出せる。
import {S, STANCES, save} from './store.js';
import {D} from './data.js';
import {h, fmt} from './ui.js';

const ST = Object.fromEntries(STANCES);
const MAX_ROWS = 3000;
let collapsed = new Set(), collapsedFor = null;

// 木 → 行（深さ優先）。分かれのない手は、手と結果を1行に
function flatten(tree) {
  const out = [];
  (function visit(id, depth, step, pathP, anc) {
    const n = tree.nodes[id];
    if (n.end) { out.push({type: 'end', depth, step, pathP, anc, n}); return; }
    n.edges.forEach((e, i) => {
      const c = tree.nodes[e.next];
      const key = id + '-' + i, branching = n.edges.length > 1;
      out.push({type: 'move', key, depth, step, pathP: pathP * e.p, anc, n, e, i, c, branching, first: i === 0});
      visit(e.next, depth + (branching ? 1 : 0), step + 1, pathP * e.p, branching ? [...anc, key] : anc);
    });
  })(tree.root, 0, 1, 1, []);
  return out;
}

const sign = x => (x > 0 ? '+' : x < 0 ? '−' : '±') + fmt(Math.abs(x));
const pct = x => (Math.round(x * 10000) / 100) + '%';
const delta = (a, b, f = v => fmt(v)) => b === a ? f(b) : `${sign(b - a)} → ${f(b)}`;
const factorText = v => '+' + (v - 100) + '%';
const cells = r => {
  if (r.type === 'end') return {step: '', act: r.n.cut ? '（この先は省略）' : r.n.reached ? `終わり：目標に届いた` : '終わり：目標に届かない', drawn: '', p: '', path: pct(r.pathP),
    score: fmt(r.n.st?.score ?? r.n.score), heat: '', extra: '', factor: '', bonus: '', stance: '', uses: '', drinks: '', future: r.n.cut ? pct(r.n.p) : r.n.reached ? '100%' : '0%'};
  const a = r.n.st, b = r.c.st;
  return {step: String(r.step), act: r.n.act, drawn: r.e.drawn.length ? r.e.drawn.map(x => x.name).join('・') : (r.branching ? '（ドロー札なし）' : ''),
    p: r.branching ? `${r.e.pText}（${pct(r.e.p)}）` : '', path: pct(r.pathP),
    score: delta(a.score, b.score), heat: delta(a.heat, b.heat), extra: delta(a.extra, b.extra),
    factor: a.factor === b.factor ? factorText(b.factor) : `${sign(b.factor - a.factor)}% → ${factorText(b.factor)}`,
    bonus: a.bonus === b.bonus ? b.bonus + '%' : `${sign(b.bonus - a.bonus)}% → ${b.bonus}%`,
    stance: a.stance === b.stance ? (ST[b.stance] || b.stance) : `${ST[a.stance] || a.stance} → ${ST[b.stance] || b.stance}`,
    uses: delta(a.uses, b.uses), drinks: delta(a.drinks, b.drinks), future: pct(r.c.p),
    // 夏夜などのカウンタは、ゲームの表示（5→1、1 のとき次の札で発動）に直して出す（表示＝5 − カウンタ%5）
    regs: (r.e.regs || []).map(g => `${shortName(g.id)} ${5 - g.from % 5}→${g.to == null ? '—' : 5 - g.to % 5}${g.gain ? `（+${fmt(g.gain)}）` : ''}`).join('　')};
};
const shortName = id => (D.cardById.get(id)?.name || '継続効果').replace(/に咲く思い出\+?$/, '');
const REG_COL = ['regs', '継続効果（火力）'];
const BASE_COLS = [['step', '手順'], ['act', '手'], ['drawn', 'ドロー札'], ['p', 'このドローの確率'], ['path', 'ここまでの確率'], ['score', 'スコア'], ['heat', '熱意'], ['extra', '熱意追加'],
  ['factor', '熱意倍率'], ['bonus', 'スコア上昇'], ['stance', '指針'], ['uses', '残り行動'], ['drinks', 'ドリンク'], ['future', 'この先の達成率']];

// 列の既定（チェックの初期値）。手順・手はいつも出す
const ALWAYS = ['step', 'act'];
const DEFAULT_COLS = ['drawn', 'score', 'heat', 'future'];   // ドローの確率の列（このドローの確率・ここまでの確率）は、列の選択で出す
const NUM_COLS = ['score', 'heat', 'extra', 'factor', 'bonus', 'uses', 'drinks', 'p', 'path', 'future'];

// 木 → 手順（最初から終わりまでの1本）の一覧。起きやすい順
function paths(tree) {
  const out = [];
  (function visit(id, acc, p, step) {
    const n = tree.nodes[id];
    if (n.end) { out.push({rows: [...acc, {type: 'end', depth: 0, step, pathP: p, anc: [], n}], p, reached: n.reached, cut: !!n.cut, score: n.st?.score ?? n.score}); return; }
    n.edges.forEach((e, i) => {
      const c = tree.nodes[e.next], branching = n.edges.length > 1;
      visit(e.next, [...acc, {type: 'move', key: id + '-' + i, depth: 0, step, pathP: p * e.p, anc: [], n, e, i, c, branching, first: true}], p * e.p, step + 1);
    });
  })(tree.root, [], 1, 1);
  return out.map((x, i) => ({...x, order: i})).sort((a, b) => b.p - a.p || a.order - b.order);
}

export function renderSteps(root, rerender) {
  const R = S.result;
  if (!R?.tree) return;
  const hasRegs = Object.values(R.tree.nodes).some(n => n.edges?.some(e => e.regs?.length));
  const allCols = hasRegs ? [...BASE_COLS.slice(0, 6), REG_COL, ...BASE_COLS.slice(6)] : BASE_COLS;
  const want = new Set(S.ui.stepCols || (S.ui.showRegs ? [...DEFAULT_COLS, 'regs'] : DEFAULT_COLS));
  const COLS = allCols.filter(([k]) => ALWAYS.includes(k) || want.has(k));
  const mode = S.ui.stepMode === 'all' ? 'all' : 'path';
  if (collapsedFor !== R.at) { collapsed = new Set(); collapsedFor = R.at; S.ui.stepPath = 0; }
  const rows = flatten(R.tree);
  const ends = rows.filter(r => r.type === 'end');
  const csv = () => {
    const esc = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const lines = [allCols.map(([, t]) => t).join(','), ...rows.map(r => { const c = cells(r); return allCols.map(([k]) => esc((k === 'act' ? '　'.repeat(r.depth) : '') + (c[k] ?? ''))).join(','); })];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv'}));
    a.download = `aegis-steps-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const setCol = (k, on) => { const s2 = new Set(want); on ? s2.add(k) : s2.delete(k); S.ui.stepCols = allCols.map(([x]) => x).filter(x => s2.has(x)); save(); rerender(); };
  const colPick = h('div.colpick', {}, h('span.sl', '表示する列'),
    allCols.filter(([k]) => !ALWAYS.includes(k)).map(([k, t]) => h('label.f', {}, h('input', {type: 'checkbox', checked: want.has(k), onchange: e => setCol(k, e.target.checked)}), t)),
    h('button.mini', {onclick: () => { S.ui.stepCols = null; save(); rerender(); }}, '最初の列に戻す'));
  const seg = h('div.seg', {}, [['path', '手順ごと'], ['all', '全部の表']].map(([v, t]) =>
    h('button', {class: mode === v ? 'on' : '', onclick: () => { S.ui.stepMode = v; save(); rerender(); }}, t)));
  const tr = (r, opts = {}) => {
    const c = cells(r);
    const fold = opts.fold && r.type === 'move' && r.branching;
    return h('tr', {class: [r.type, fold && 'fold', fold && collapsed.has(r.key) && 'closed', opts.fold && r.type === 'move' && !r.first && 'sib', r.type === 'end' && (r.n.cut ? 'cut' : r.n.reached ? 'ok' : 'ng')].filter(Boolean).join(' '),
      onclick: fold ? () => { collapsed.has(r.key) ? collapsed.delete(r.key) : collapsed.add(r.key); rerender(); } : null},
      COLS.map(([k]) => k === 'act'
        ? h('td.act', {style: {paddingLeft: (8 + r.depth * 16) + 'px'}}, fold ? (collapsed.has(r.key) ? '▸ ' : '▾ ') : '', c.act)
        : h('td', {class: NUM_COLS.includes(k) ? 'n' : k === 'drawn' ? 'drawn' : ''}, c[k])));
  };
  const table = list => h('div.stepwrap', {}, h('table.tbl.steptbl', {}, h('thead', h('tr', COLS.map(([, t]) => h('th', t)))), h('tbody', list)));

  let view;
  if (mode === 'path') {
    const ps = paths(R.tree);
    const i = Math.max(0, Math.min(ps.length - 1, S.ui.stepPath || 0)), P = ps[i];
    const go = j => { S.ui.stepPath = Math.max(0, Math.min(ps.length - 1, j)); save(); rerender(); };
    const label = (x, j) => `手順${j + 1}（確率 ${pct(x.p)}・${x.cut ? '途中まで' : x.reached ? '届く' : '届かない'}）`;
    view = h('div', {},
      h('div.pathnav', {},
        h('button', {disabled: i === 0, onclick: () => go(i - 1)}, '◀ 前'),
        h('select', {onchange: e => go(Number(e.target.value))}, ps.slice(0, 1000).map((x, j) => h('option', {value: j, selected: j === i}, label(x, j)))),
        h('button', {disabled: i >= ps.length - 1, onclick: () => go(i + 1)}, '次 ▶'),
        h('span.hint', `全 ${ps.length} 通り（起きやすい順）`)),
      h('div.pathchips', {}, ps.slice(0, 12).map((x, j) => h('button.mini', {class: [j === i && 'on', x.reached ? 'ok' : 'ng'].filter(Boolean).join(' '), onclick: () => go(j)}, `${j + 1}`)),
        ps.length > 12 && h('span.hint', '…ほかは上の一覧から')),
      h('p.pathsum', {class: P.reached ? 'ok' : 'ng'}, `手順${i + 1}：この手順になる確率 ${pct(P.p)}・${P.rows.length - 1} 手・${P.cut ? `ここまでのスコア ${fmt(P.score)}・この先は省略` : `終わりのスコア ${fmt(P.score)}・${P.reached ? '目標に届く' : '目標に届かない'}`}`),
      table(P.rows.map(r => tr(r))));
  } else {
    const visible = rows.filter(r => !r.anc.some(k => collapsed.has(k)));
    view = h('div', {},
      h('div.row', {}, h('button.mini', {onclick: () => { for (const r of rows) if (r.type === 'move' && r.branching) collapsed.add(r.key); rerender(); }}, '分かれを全部たたむ'),
        h('button.mini', {onclick: () => { collapsed.clear(); rerender(); }}, '全部ひらく'),
        h('span.hint', '分かれの行（ドロー札のある行）を押すと、その先をたためます。')),
      table(visible.slice(0, MAX_ROWS).map(r => tr(r, {fold: true}))),
      visible.length > MAX_ROWS && h('p.warnline', `行が多いので、先頭の ${MAX_ROWS} 行だけ出しています（全部で ${visible.length} 行）。分かれをたたむか、CSV に書き出して見てください。`));
  }
  root.append(h('section.panel.steps', {},
    h('div.row', {}, h('h2', '全手順（詳細）'), seg,
      h('span.hint', `${rows.filter(r => r.type === 'move').length} 手・終わり方 ${ends.length} 通り（目標に届く ${ends.filter(r => r.n.reached).length} 通り）`),
      h('button.mini', {onclick: csv}, 'CSV に書き出す（全部の列）'),
      h('button.mini', {onclick: () => { S.ui.steps = false; rerender(); }}, '閉じる')),
    colPick,
    h('p.hint', 'スコアはこのターンに入った点（累計）。「+増えた分 → 後の値」。'
      + (want.has('regs') && hasRegs ? '継続効果の列：カウンタの動きと、（ ）はその1手で継続効果が出したスコア（その効果がなかった場合との差、正確な値）。' : '')),
    view));
}
