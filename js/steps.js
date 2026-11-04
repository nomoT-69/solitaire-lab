// 全手順（詳細）：方策の木（引いた札ごとの全部の分かれ）を、昔のスプレッドシートのように1行ずつの表にする。
// 列：手順、手、来た札、その分かれの確率、そこに至る確率、スコア（増えた分 → 累計）、熱意・熱意追加・熱意倍率・スコア上昇（増えた分 → 後の値）、
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
  if (r.type === 'end') return {step: '', act: r.n.reached ? `終わり：目標に届いた` : '終わり：目標に届かない', drawn: '', p: '', path: pct(r.pathP),
    score: fmt(r.n.st?.score ?? r.n.score), heat: '', extra: '', factor: '', bonus: '', stance: '', uses: '', drinks: '', future: r.n.reached ? '100%' : '0%'};
  const a = r.n.st, b = r.c.st;
  return {step: String(r.step), act: r.n.act, drawn: r.e.drawn.length ? r.e.drawn.map(x => x.name).join('・') : (r.branching ? '（来た札なし）' : ''),
    p: r.branching ? `${r.e.pText}（${pct(r.e.p)}）` : '', path: pct(r.pathP),
    score: delta(a.score, b.score), heat: delta(a.heat, b.heat), extra: delta(a.extra, b.extra),
    factor: a.factor === b.factor ? factorText(b.factor) : `${sign(b.factor - a.factor)}% → ${factorText(b.factor)}`,
    bonus: a.bonus === b.bonus ? b.bonus + '%' : `${sign(b.bonus - a.bonus)}% → ${b.bonus}%`,
    stance: a.stance === b.stance ? (ST[b.stance] || b.stance) : `${ST[a.stance] || a.stance} → ${ST[b.stance] || b.stance}`,
    uses: delta(a.uses, b.uses), drinks: delta(a.drinks, b.drinks), future: pct(r.c.p),
    regs: (r.e.regs || []).map(g => `${shortName(g.id)} ${g.from}→${g.to ?? '—'}${g.gain ? `（+${fmt(g.gain)}）` : ''}`).join('　')};
};
const shortName = id => (D.cardById.get(id)?.name || '継続効果').replace(/に咲く思い出\+?$/, '');
const REG_COL = ['regs', '継続効果（カウンタ・火力）'];
const BASE_COLS = [['step', '手順'], ['act', '手'], ['drawn', '来た札'], ['p', '分かれの確率'], ['path', 'そこに至る確率'], ['score', 'スコア'], ['heat', '熱意'], ['extra', '熱意追加'],
  ['factor', '熱意倍率'], ['bonus', 'スコア上昇'], ['stance', '指針'], ['uses', '残り行動'], ['drinks', 'ドリンク'], ['future', 'この先の達成率']];

export function renderSteps(root, rerender) {
  const R = S.result;
  if (!R?.tree) return;
  const hasRegs = Object.values(R.tree.nodes).some(n => n.edges?.some(e => e.regs?.length));
  const COLS = S.ui.showRegs && hasRegs ? [...BASE_COLS.slice(0, 6), REG_COL, ...BASE_COLS.slice(6)] : BASE_COLS;
  if (collapsedFor !== R.at) { collapsed = new Set(); collapsedFor = R.at; }
  const rows = flatten(R.tree);
  const visible = rows.filter(r => !r.anc.some(k => collapsed.has(k)));
  const shown = visible.slice(0, MAX_ROWS);
  const ends = rows.filter(r => r.type === 'end');
  const csv = () => {
    const esc = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const lines = [COLS.map(([, t]) => t).join(','), ...rows.map(r => { const c = cells(r); return COLS.map(([k]) => esc((k === 'act' ? '　'.repeat(r.depth) : '') + (c[k] ?? ''))).join(','); })];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], {type: 'text/csv'}));
    a.download = `aegis-steps-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  root.append(h('section.panel.steps', {},
    h('div.row', {}, h('h2', '全手順（詳細）'),
      h('span.hint', `${rows.filter(r => r.type === 'move').length} 手・終わり方 ${ends.length} 通り（目標に届く ${ends.filter(r => r.n.reached).length} 通り）`),
      h('button.mini', {onclick: () => { for (const r of rows) if (r.type === 'move' && r.branching) collapsed.add(r.key); rerender(); }}, '分かれを全部たたむ'),
      h('button.mini', {onclick: () => { collapsed.clear(); rerender(); }}, '全部ひらく'),
      hasRegs && h('label.f', {}, h('input', {type: 'checkbox', checked: !!S.ui.showRegs, onchange: e => { S.ui.showRegs = e.target.checked; save(); rerender(); }}), '継続効果（夏夜など）の火力を見る'),
      h('button.mini', {onclick: csv}, 'CSV に書き出す'),
      h('button.mini', {onclick: () => { S.ui.steps = false; rerender(); }}, '閉じる')),
    h('p.hint', 'スコアはこのターンに入った点（累計）。「+増えた分 → 後の値」。分かれの行（来た札のある行）を押すと、その先をたためます。'
      + (S.ui.showRegs && hasRegs ? '継続効果の列：カウンタの動きと、（ ）はその1手で継続効果が出したスコア（その効果がなかった場合との差、正確な値）。' : '')),
    h('div.stepwrap', {}, h('table.tbl.steptbl', {},
      h('thead', h('tr', COLS.map(([, t]) => h('th', t)))),
      h('tbody', shown.map(r => {
        const c = cells(r);
        const fold = r.type === 'move' && r.branching;
        return h('tr', {class: [r.type, fold && 'fold', fold && collapsed.has(r.key) && 'closed', r.type === 'move' && !r.first && 'sib'].filter(Boolean).join(' '),
          onclick: fold ? () => { collapsed.has(r.key) ? collapsed.delete(r.key) : collapsed.add(r.key); rerender(); } : null},
          COLS.map(([k]) => k === 'act'
            ? h('td.act', {style: {paddingLeft: (8 + r.depth * 16) + 'px'}}, fold ? (collapsed.has(r.key) ? '▸ ' : '▾ ') : '', c.act)
            : h('td', {class: ['score', 'heat', 'extra', 'factor', 'bonus', 'uses', 'drinks', 'p', 'path', 'future'].includes(k) ? 'n' : ''}, c[k])));
      })))),
    visible.length > MAX_ROWS && h('p.warnline', `行が多いので、先頭の ${MAX_ROWS} 行だけ出しています（全部で ${visible.length} 行）。分かれをたたむか、CSV に書き出して見てください。`)));
}
