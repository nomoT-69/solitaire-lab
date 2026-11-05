// 局面の部品（画面は turn.js）：局面の用意、札の置き場、成長の前提、入力の確かめ、成長をまとめて入れる。山札＝デッキ全体−ほかの置き場（自動）
import {D, checkCalcSettings, unsupported, itemInputs} from './data.js';
import {firedOf} from './setup.js';
import {S, save, deck, newPhase, defaultParams} from './store.js';
import {h, num, sel} from './ui.js';

export const MAX_DRINKS = 4;   // 持てるドリンクの本数の上限（利用者の決定 2026-11-03）
export const ZONES = [['hand', '手札', '1'], ['held', '保留', '2'], ['discard', '捨て札', '3'], ['removed', '除外', '4'], ['deck', '山札（自動）', '0']];
export const ZNAME = Object.fromEntries(ZONES.map(([k, n]) => [k, n]));

export function ensurePhase() {
  const dk = deck();
  if (!dk) return null;
  if (!S.phase || S.phase.deckId !== dk.id) { S.phase = newPhase(dk.id); save(); }
  const P = S.phase;
  P.params = {...defaultParams(), ...P.params};
  // P アイテムの初期値
  for (const id of dk.items) P.itemState[id] ||= {counter: 0, fired: []};
  return P;
}

export const entries = (dk, P) => [...dk.cards, ...P.extra];
export const zoneOf = (P, u) => P.zones[u] || 'deck';

// 前提（成長）の既定：成長しきり
// 前提（成長）：assume[uid] = {grown：自己成長を受けた回数（既定は MAX）, score：スコアの成長（+n）, times：スコアの回数（+n）}
export const growthOf = (P, en) => { const c = D.cardById.get(en.id); if (!c?.growth) return null; const lim = c.growth.limit || 1; const n = P.assume[en.uid]?.grown ?? lim; return {n, lim}; };
export const extraGrowth = (P, en) => ({score: P.assume[en.uid]?.score || 0, times: P.assume[en.uid]?.times || 0});
export const setAssume = (P, u, k, v) => { P.assume[u] = {...P.assume[u], [k]: v}; };

// 全力値の欄を出すか：デッキ（足した札を含む）の札・持っているドリンク・P アイテムが全力値を使う／増やすか、カスタマイズに「全力値」があるか。
// 累計の全力値の欄は、累計を読むものがあるときだけ（エンジンの engine.inputs と同じ考え。GUI では札などの文面で判定する）
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
  // 全力値：全力値を使う札があるのに空欄なら、0 として計算する（全力値がコストの札は使えない）
  const fpn = fpNeeds(dk, P);
  if (fpn.fp && (p.fullPowerCharge === null || p.fullPowerCharge === undefined)) warn('全力値が空欄です。0 として計算します（アンダンテなど、全力値がコストの札は使えません）。ゲームの画面の全力値を入れてください');
  if (fpn.cfp && (p.cumulativeFullPowerCharge === null || p.cumulativeFullPowerCharge === undefined)) info('累計の全力値が空欄です。仮に 7 として計算します（ブースト・ラッシュなど、累計を使う札の点は目安になります）');
  // 入力の食い違い：熱意倍率を上げる P アイテム（原点へのチケットなど）が発動済みなのに、熱意倍率がその分より小さい
  for (const id of dk.items) {
    const inf = itemInputs(id); if (!inf) continue;
    const st = P.itemState?.[id] || {};
    const add = inf.inputs.filter(x => x.key === 'fired').reduce((a, x, i) => a + (x.enthusiasmBuffPerUse || 0) * firedOf(st, i, x.max), 0);
    if (add > 0 && (p.enthusiasmBuff ?? 1) + 1e-9 < 1 + add) warn(`${inf.name}：発動済みの分だけで熱意倍率が＋${Math.round(add * 100)}% になるはずですが、熱意倍率が＋${Math.round(((p.enthusiasmBuff ?? 1) - 1) * 100)}% です（ゲームの表示の値を入れてください）`);
  }
  return out;
}

// 成長をまとめて入れる（例：アクティブ札すべてにスコアの成長 +37）
let bulk = {score: 0, times: 0, who: 'active'};
export function growthBulk(P, all, touch) {
  const targets = () => all.filter(en => { const c = D.cardById.get(en.id); return c && c.type !== 'trouble' && (bulk.who === 'all' || c.type === bulk.who); });
  const apply = mode => { for (const en of targets()) { const a = P.assume[en.uid] || {};
    // 入れた（0でない）項目だけを変える。札ごとに入れた別の項目は残す
    const b = {...a}; for (const k of ['score', 'times']) if (bulk[k]) b[k] = mode === 'set' ? bulk[k] : (a[k] || 0) + bulk[k];
    P.assume[en.uid] = b; } touch(); };
  return h('div.bulk', {}, h('h4', '成長をまとめて入れる'),
    h('div.row', {}, sel('', bulk.who, [['active', 'アクティブ札'], ['mental', 'メンタル札'], ['all', 'すべての札']], v => { bulk.who = v; }),
      num('スコア +', bulk.score, v => { bulk.score = v || 0; }, {min: 0, width: 5}),
      num('回数 +', bulk.times, v => { bulk.times = v || 0; }, {min: 0, width: 4})),
    h('div.row', {}, h('button', {onclick: () => apply('set')}, 'この値にする'), h('button', {onclick: () => apply('add')}, '今の値に足す'),
      h('button', {onclick: () => { for (const en of targets()) { const a = P.assume[en.uid]; if (a) { delete a.score; delete a.times; } } touch(); }}, '0に戻す')));
}
