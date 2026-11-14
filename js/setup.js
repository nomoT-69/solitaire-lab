import {lifeOn, LIFE_TIMES} from './data.js?v=1.17.12';
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
    if (c.growth && c.growth.limit) {
      const lim = c.growth.limit || 1, n = Number.isFinite(a.grown) ? a.grown : lim;
      if (n >= lim) x.grown = 'full';
      else { g.score += n * (c.growth.score || 0); g.scoreTimes += n * (c.growth.times || 0); x.limits = [lim - n]; }
    }
    if (lifeOn(en)) g.scoreTimes += LIFE_TIMES;
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
  if (Number.isFinite(p.fullPowerCharge) && p.fullPowerCharge > 0) setup.fullPowerCharge = p.fullPowerCharge;
  if (Number.isFinite(p.cumulativeFullPowerCharge)) setup.cumulativeFullPowerCharge = p.cumulativeFullPowerCharge;
  const au = {}; for (const [a, m] of Object.entries(P.abilityUses || {})) for (const [id, n] of Object.entries(m || {})) if (n > 0) (au[a] ||= {})[id] = n;
  if (Object.keys(au).length) setup.abilityUses = au;
  return {setup, target: p.target};
}

export function firedOf(st, i, max) {
  const v = st.fired?.[i];
  if (Number.isInteger(v)) return Math.max(0, Math.min(max, v));
  if (i === 0 && Number.isInteger(st.remaining)) return Math.max(0, Math.min(max, max - st.remaining));
  return 0;
}
function itemSpec(id, st, info) {
  const o = {id, counter: st.counter || 0};
  const slots = info?.inputs ? info.inputs.filter(x => x.key === 'fired') : null;
  if (slots) { if (slots.length) o.limits = slots.map((x, i) => x.max - firedOf(st, i, x.max)); }
  else if (info?.limit && Number.isInteger(st.remaining)) o.limits = [st.remaining];
  return o;
}
