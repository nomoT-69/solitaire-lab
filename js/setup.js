// 局面の入力（画面の形）から、計算エンジン Tecnai の局面（setup）と目標点を作る。画面にもエンジンにも依らない、純粋な変換。
// setup の形はエンジンの tecnai.mjs（createEngine）と AEGIS_SPEC.md 3章：
//   {hand, deck, discard, removed, held（古い順）, drinks, drinkCap, pItems, registered, cardUses, stance, prevStance, enthusiasm,
//    enthusiasmBonus, enthusiasmBuff, scoreBuff, trial, turnsRemaining, preservationTimes, strengthTimes, leisureTimes, stanceChangedByDirectEffectTimes}
//   札：{id, c11n, hif, grown:'full', g:{score, scoreTimes}, limits:[残り回数]}
// cards：札の番号 → {growth:{limit, score, times}}（自己成長の上限と1回の量）。items：P アイテムの番号 → {limit, inputs（エンジンの pItemInputs の入力欄）, stamina（体力が減ったら発動）}
// P アイテムの入力（P.itemState[番号]）：{counter, fired:[発動済みの回数…]}。前の形 {remaining}（残り回数）も読む
export function buildSetup({deck, phase, cards, items}) {
  const P = phase, p = P.params;
  const all = [...deck.cards, ...P.extra];
  const zone = u => P.zones[u] || 'deck';
  const spec = en => {
    const c = cards.get(en.id) || {};
    const x = {id: en.id};
    if (en.c11n && Object.values(en.c11n).some(v => v > 0)) x.c11n = Object.fromEntries(Object.entries(en.c11n).filter(([, v]) => v > 0));
    if (en.hif) x.hif = true;
    const a = P.assume[en.uid] || {};
    const g = {score: a.score || 0, scoreTimes: a.times || 0};
    if (c.growth) {
      const lim = c.growth.limit || 1, n = a.grown ?? lim;   // 既定は自己成長 MAX
      if (n >= lim) x.grown = 'full';
      else { g.score += n * (c.growth.score || 0); g.scoreTimes += n * (c.growth.times || 0); x.limits = [lim - n]; }
    }
    if (g.score || g.scoreTimes) x.g = g;
    return Object.keys(x).length === 1 ? en.id : x;
  };
  const pile = z => all.filter(en => zone(en.uid) === z);
  const held = P.held.map(u => all.find(en => en.uid === u)).filter(Boolean);
  const setup = {
    hand: pile('hand').map(spec), deck: pile('deck').map(spec), discard: pile('discard').map(spec), removed: pile('removed').map(spec), held: held.map(spec),
    drinks: P.drinksHeld.slice(),
    pItems: deck.items.map(id => itemSpec(id, P.itemState[id] || {}, items.get(id))),
    registered: P.registered.map(r => { const lim = cards.get(r.card)?.registers?.limit; const o = {card: r.card, counter: r.counter || 0}; if (lim) o.limits = [lim - Math.max(0, Math.min(lim, r.used || 0))]; return o; }),
    cardUses: p.cardUses, stance: p.stance, enthusiasm: p.enthusiasm || 0, enthusiasmBonus: p.enthusiasmBonus || 0, enthusiasmBuff: p.enthusiasmBuff ?? 1,
    scoreBuff: p.scoreBuff || 0, trial: p.trial ?? 1, turnsRemaining: p.turnsRemaining ?? 1,
    preservationTimes: p.preservationTimes || 0, strengthTimes: p.strengthTimes || 0, leisureTimes: p.leisureTimes || 0,
    stanceChangedByDirectEffectTimes: p.directStanceTimes || 0,
  };
  if (p.prevStance && p.prevStance !== 'none') setup.prevStance = p.prevStance;
  if (p.drinkCap !== null && p.drinkCap !== undefined) setup.drinkCap = p.drinkCap;
  if (p.nullifyCostCards > 0 && deck.items.some(id => items.get(id)?.stamina)) setup.nullifyCostCards = p.nullifyCostCards;
  // HIF 再動など、名前ごとに共有する効果のこれまでに使った回数：{HIF:{通常版の番号:回数}}（0 は渡さない）
  const au = {}; for (const [a, m] of Object.entries(P.abilityUses || {})) for (const [id, n] of Object.entries(m || {})) if (n > 0) (au[a] ||= {})[id] = n;
  if (Object.keys(au).length) setup.abilityUses = au;
  return {setup, target: p.target};
}

// 発動済みの回数（入力）。前の形（残り回数 remaining）は、1つ目の欄の「上限−残り」として読む
export function firedOf(st, i, max) {
  const v = st.fired?.[i];
  if (Number.isInteger(v)) return Math.max(0, Math.min(max, v));
  if (i === 0 && Number.isInteger(st.remaining)) return Math.max(0, Math.min(max, max - st.remaining));
  return 0;
}
// P アイテム1つの setup の形：{id, counter, limits:[残り回数＝上限−発動済み…]}（エンジンの pItemSetup と同じ）。
// 発動済みの分の熱意倍率は足さない（熱意倍率の欄には、ゲームの表示＝発動した分を含む値を入れてもらう）
function itemSpec(id, st, info) {
  const o = {id, counter: st.counter || 0};
  const slots = info?.inputs ? info.inputs.filter(x => x.key === 'fired') : null;
  if (slots) { if (slots.length) o.limits = slots.map((x, i) => x.max - firedOf(st, i, x.max)); }
  else if (info?.limit && Number.isInteger(st.remaining)) o.limits = [st.remaining];
  return o;
}
