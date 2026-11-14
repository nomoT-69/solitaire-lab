import {D, checkCalcSettings, unsupported, itemInputs} from './data.js?v=1.17.12';
import {firedOf} from './setup.js?v=1.17.12';
import {S, save, deck, newPhase, defaultParams} from './store.js?v=1.17.12';
import {h, num, sel} from './ui.js?v=1.17.12';

export const MAX_DRINKS = 4;
export const ZONES = [['hand', '手札', '1'], ['held', '保留', '2'], ['discard', '捨て札', '3'], ['removed', '除外', '4'], ['deck', '山札（自動）', '0']];
export const ZNAME = Object.fromEntries(ZONES.map(([k, n]) => [k, n]));

export function ensurePhase() {
  const dk = deck();
  if (!dk) return null;
  if (!S.phase || S.phase.deckId !== dk.id) { S.phase = newPhase(dk.id); save(); }
  const P = S.phase;
  P.params = {...defaultParams(), ...P.params};
  for (const id of dk.items) P.itemState[id] ||= {counter: 0, fired: []};
  return P;
}

export const entries = (dk, P) => [...dk.cards, ...P.extra];
export const zoneOf = (P, u) => P.zones[u] || 'deck';

export const growthOf = (P, en) => { const c = D.cardById.get(en.id); if (!c?.growth?.limit) return null; const lim = c.growth.limit; const n = P.assume[en.uid]?.grown ?? lim; return {n, lim}; };
export const extraGrowth = (P, en) => ({score: P.assume[en.uid]?.score || 0, times: P.assume[en.uid]?.times || 0});
export const setAssume = (P, u, k, v) => { P.assume[u] = {...P.assume[u], [k]: v}; };

export function fpNeeds(dk, P) {
  const all = entries(dk, P);
  const custFp = en => Object.entries(en.c11n || {}).some(([k, v]) => v > 0 && /全力値/.test(D.custs.get(k)?.name || ''));
  const txt = [...P.drinksHeld.map(id => D.drinks.find(x => x.id === id)?.text || ''), ...dk.items.map(id => D.items.find(x => x.id === id)?.text || '')].join(' ');
  const cards = all.map(en => D.cardById.get(en.id)).filter(Boolean);
  return {fp: cards.some(c => c.fp) || all.some(custFp) || /fullPowerCharge/.test(txt), cfp: cards.some(c => c.cfp) || /cumulativeFullPowerCharge/.test(txt)};
}

export function validate(dk, P) {
  const out = []; const err = m => out.push(['err', m]), warn = m => out.push(['warn', m]), info = m => out.push(['info', m]);
  const all = entries(dk, P); const cnt = z => all.filter(e => zoneOf(P, e.uid) === z).length;
  const p = P.params;
  if (S.calcSettings && !checkCalcSettings(S.calcSettings).ok) err('札の設定にエラーがあります（「札の設定」の画面で直してください）');
  const un = unsupported(S.calcSettings);
  for (const e of all) { const c = D.cardById.get(e.id); if (!c) err(`知らない札があります（番号 ${e.id}。消した自作の札など）。デッキから外してください`);
    else if (un.cardIds.has(e.id)) err(`${c.name}：計算が対応していない効果があります（${un.cardIds.get(e.id)[0]}）`); }
  for (const id of new Set(P.drinksHeld)) { const x = un.drinks.find(d => d.id === id); if (x) err(`${x.name}：計算が対応していない効果があります（${x.problems[0]}）`); }
  for (const id of dk.items) { const x = un.items.find(d => d.id === id); if (x) err(`${x.name}：計算が対応していない効果があります（${x.problems[0]}）`); }
  if (cnt('hand') > 5) err(`手札が ${cnt('hand')} 枚です（上限は5枚）`);
  if (cnt('hand') === 0) warn('手札が0枚です');
  if (cnt('held') > 2) err(`保留が ${cnt('held')} 枚です（上限は2枚）`);
  if (p.gameDeckCount !== null && p.gameDeckCount !== cnt('deck')) warn(`山札の枚数が合いません（振り分けから ${cnt('deck')} 枚／ゲームの画面 ${p.gameDeckCount} 枚）`);
  if (!(p.cardUses >= 1)) err('行動回数は1以上にしてください');
  if (!(p.target > 0)) err('目標点を入れてください');
  if (p.drinkCap !== null && p.drinkCap > P.drinksHeld.length) info(`ドリンクの上限（${p.drinkCap}本）が、持っている本数（${P.drinksHeld.length}本）より多いので、上限なしと同じです`);
  if (P.drinksHeld.length > MAX_DRINKS) err(`ドリンクが ${P.drinksHeld.length} 本です（持てるのは${MAX_DRINKS}本まで）`);
  if (!(p.enthusiasmBuff > 0)) err('熱意倍率は −100% より大きくしてください（ゲームの表示の「＋何%」を入れます）');
  if (!(p.trial > 0)) err('試験倍率は0%より大きくしてください');
  if (cnt('deck') === 0 && cnt('discard') === 0) info('山札も捨て札も0枚なので、札を引けません');
  for (const id of dk.items) if (/strengthTimes>=4/.test(D.items.find(x => x.id === id)?.text || '') && p.strengthTimes < 4) info(`${D.items.find(x => x.id === id).name}：強気の回数が ${p.strengthTimes} 回なので、まだ発動しません（4回以上で発動）`);
  const fpn = fpNeeds(dk, P);
  if (fpn.fp && (p.fullPowerCharge === null || p.fullPowerCharge === undefined)) warn('全力値が空欄です（0 として計算。全力値がコストの札は使えません）');
  if (fpn.cfp && (p.cumulativeFullPowerCharge === null || p.cumulativeFullPowerCharge === undefined)) info('累計の全力値が空欄です（仮に 7 として計算）');
  for (const id of dk.items) {
    const inf = itemInputs(id); if (!inf) continue;
    const st = P.itemState?.[id] || {};
    const add = inf.inputs.filter(x => x.key === 'fired').reduce((a, x, i) => a + (x.enthusiasmBuffPerUse || 0) * firedOf(st, i, x.max), 0);
    if (add > 0 && (p.enthusiasmBuff ?? 1) + 1e-9 < 1 + add) warn(`熱意倍率（＋${Math.round(((p.enthusiasmBuff ?? 1) - 1) * 100)}%）が、${inf.name}の発動分（＋${Math.round(add * 100)}%）より小さいです`);
  }
  return out;
}

let bulk = {who: 'active'};
export function growthBulk(P, all, touch) {
  const targets = () => all.filter(en => { const c = D.cardById.get(en.id); return c && c.type !== 'trouble' && (bulk.who === 'all' || c.type === bulk.who); });
  const common = k => { const vs = [...new Set(targets().map(en => P.assume[en.uid]?.[k] || 0))]; return vs.length === 1 ? vs[0] : null; };
  const setAll = (k, v) => { for (const en of targets()) { const b = {...(P.assume[en.uid] || {})}; if (v) b[k] = v; else delete b[k]; P.assume[en.uid] = b; } touch(); };
  const mixed = k => common(k) === null;
  return h('div.bulk', {}, h('h4', '成長（パラメータ上昇・攻撃回数をまとめて入れる）'),
    h('div.row', {}, sel('', bulk.who, [['active', 'アクティブ札'], ['mental', 'メンタル札'], ['all', 'すべての札']], v => { bulk.who = v; touch(); }),
      num('パラメータ上昇 +', common('score') ?? '', v => setAll('score', Math.max(0, v || 0)), {min: 0, width: 5}),
      num('攻撃回数 +', common('times') ?? '', v => setAll('times', Math.max(0, v || 0)), {min: 0, width: 4}),
      h('button', {onclick: () => { for (const en of targets()) { const a = P.assume[en.uid]; if (a) { delete a.score; delete a.times; } } touch(); }}, '0に戻す')),
    (mixed('score') || mixed('times')) && h('p.hint', '札ごとに違う値が入っています（空欄）。ここに入れると、選んだ種類の札すべてがその値になります。'));
}
