// 次のターンの局面：プレイでたどった最後の局面（worker.js の turnEndState）から、局面の入力（画面の形）を作る。
// ゲームのターン終わりの動きに合わせる：手札は捨て札へ。保留・除外・山札・成長・ドリンク・指針・回数・P アイテムと継続効果のカウンタは引き継ぐ。
// 次のターンに引いた札は、利用者が山札から手札へ動かす。ターンをまたいで変わる数（熱意・倍率・行動回数・目標点など）は、前の入力を残して確かめてもらう。
import {D, startGrowthOf, itemInputs, hifSharedLimit, lifeOn, LIFE_TIMES} from './data.js?v=1.17.11';
const settingsOf = () => S.calcSettings;
import {S, uid, newPhase, STANCES} from './store.js?v=1.17.11';

// 札の変種のキー（エンジンの cardVariant と同じ形：番号＋#cカスタマイズ＋#aアビリティ）
export function variantKey(en) {
  const cs = Object.entries(en.c11n || {}).map(([k, v]) => [Number(k), Number(v)]).filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
  const ab = en.hif ? ['HIF'] : [];
  return String(en.id) + (cs.length ? '#c' + cs.map(([k, v]) => k + ':' + v).join(',') : '') + (ab.length ? '#a' + ab.join(',') : '');
}

// プレイの道筋（S.play.steps）→ エンジンでたどる道筋 [{choice, edge}]
export function playPath(tree, steps) {
  const path = []; let id = tree.root, pending = null;
  for (const s of steps) {
    const n = tree.nodes[id];
    if (s.type === 'act') { if (n.edges.length === 1) { path.push({choice: n.choice, ck: n.ck, edge: 0}); id = n.edges[0].next; } else pending = n; }
    else { path.push({choice: pending.choice, ck: pending.ck, edge: s.i}); id = pending.edges[s.i].next; pending = null; }
  }
  return path;
}

// mid：ターンの途中から作る（プレイの途中で「ここから局面を作る」）。手札はそのまま、行動回数はその時点の残り、目標点はそれまでに入った点を引く
export function buildNextPhase(deck, prev, st, {mid = false} = {}) {
  const P = newPhase(deck.id);
  const notes = [], warns = [];
  const entries = [...deck.cards, ...prev.extra];
  const free = new Set(entries.map(e => e.uid));
  const byKey = new Map(); for (const e of entries) { const k = variantKey(e); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); }
  // 最後の局面の札を、デッキの札（uid）に割り当てる。見つからない札（ターンの中で入った眠気など）は「追加」の札にする
  const place = (c, zone) => {
    const en = (byKey.get(c.key) || []).find(e => free.has(e.uid));
    let e = en;
    if (!e) { e = {uid: uid(), id: c.id, c11n: {}, hif: false}; P.extra.push(e); if (D.cardById.get(c.id)) notes.push(`ターンの中で入った札：${D.cardById.get(c.id).name}（追加の札にしました）`); }
    free.delete(e.uid);
    if (zone !== 'deck') P.zones[e.uid] = zone;
    if (zone === 'held') P.held.push(e.uid);
    growthOf(e, c, st, P);
    return e;
  };
  for (const c of st.hand) place(c, mid ? 'hand' : 'discard');   // ターンの終わりなら、手札は捨て札へ
  for (const c of st.discard) place(c, 'discard');
  for (const c of st.removed) place(c, 'removed');
  for (const c of st.held) place(c, 'held');
  for (const c of st.deck) place(c, 'deck');
  for (const u of free) { const e = entries.find(x => x.uid === u); P.zones[u] = 'removed'; warns.push(`最後の局面に見つからない札：${D.cardById.get(e.id)?.name || e.id}（除外に置きました。確かめてください）`); }

  // ドリンク・P アイテム・継続効果
  P.drinksHeld = st.drinks.slice();
  // P アイテム：発動済みの回数＝上限−エンジンの残り回数（欄はエンジンの pItemInputs）。記録がない＝発動し終えた
  for (const id of deck.items) {
    const it = D.items.find(x => x.id === id);
    const slots = itemInputs(id)?.inputs.filter(x => x.key === 'fired') || (it?.limit ? [{max: it.limit}] : []);
    const r = st.effs.find(x => x.path.startsWith('i:' + id + '.'));
    P.itemState[id] = r ? {counter: r.c, fired: slots.map((x, i) => Number.isInteger(r.l[i]) ? Math.max(0, x.max - r.l[i]) : 0)}
      : {counter: prev.itemState[id]?.counter ?? 0, fired: slots.map(x => x.max)};
  }
  // HIF 再動（名前ごとに共有する効果）：合成の P アイテム（番号 −1000000−通常版の番号）の残り回数から、これまでに使った回数＝上限−残り。記録がない＝使い終えた
  for (const en of entries.filter(e => e.hif)) {
    const bid = D.cardById.get(en.id)?.baseId, lim = bid && hifSharedLimit(settingsOf(prev), bid); if (!lim) continue;
    const r = st.effs.find(x => x.path.startsWith('i:' + (-1000000 - bid) + '.'));
    ((P.abilityUses ||= {}).HIF ||= {})[bid] = r && Number.isInteger(r.l?.[0]) ? Math.max(0, lim - r.l[0]) : lim;
  }
  P.registered = st.effs.filter(x => /^c:-?\d+:a/.test(x.path)).map(x => {
    const card = Number(x.path.match(/^c:(-?\d+)/)[1]), lim = D.cardById.get(card)?.registers?.limit;
    return lim ? {card, counter: x.c, used: Number.isInteger(x.l?.[0]) ? Math.max(0, lim - x.l[0]) : 0} : {card, counter: x.c};   // 回数の上限つき：使った回数＝上限−残り
  });

  // 数：指針と回数はエンジンから。ほかは前の入力を残す
  const p = {...prev.params};
  p.stance = st.stance; p.prevStance = st.prevStance || 'none';
  if (Number.isFinite(st.nullifyCostCards)) p.nullifyCostCards = st.nullifyCostCards;
  if (Number.isFinite(st.fullPowerCharge)) p.fullPowerCharge = st.fullPowerCharge;   // 全力値・累計（数える局面だけ、エンジンが出す）
  if (Number.isFinite(st.cumulativeFullPowerCharge)) p.cumulativeFullPowerCharge = st.cumulativeFullPowerCharge;   // コストを0にする残り回数（原点へのチケットを持つ局面だけ、エンジンが出す）
  p.preservationTimes = st.times.preservation; p.strengthTimes = st.times.strength; p.leisureTimes = st.times.leisure; p.directStanceTimes = st.times.direct;
  // 熱意・熱意追加・熱意倍率・スコア上昇は、ターンの終わりの値（エンジンから）。行動回数はゲームの基本の1に戻す
  if (Number.isFinite(st.enthusiasm)) p.enthusiasm = st.enthusiasm;
  if (Number.isFinite(st.extra)) p.enthusiasmBonus = st.extra;
  if (Number.isFinite(st.factor)) p.enthusiasmBuff = st.factor / 100;
  if (Number.isFinite(st.bonus)) p.scoreBuff = st.bonus / 100;
  const sn = v => STANCES.find(x => x[0] === v)?.[1] || v;
  if (mid) {
    // ターンの途中：行動回数はその時点の残り、目標点はそれまでに入った点を引く。残りターンはそのまま
    p.cardUses = Math.max(1, st.uses ?? 1);
    if (p.target > 0) p.target = Math.max(1, p.target - (st.score || 0));
    p.gameDeckCount = null;
    P.params = p;
    notes.unshift(`プレイの途中（${st.steps} 手打った後）から作った局面です。手札・山札・行動回数（残り ${p.cardUses}）・熱意（${st.enthusiasm}）・指針（${sn(st.stance)}）・ドリンクなどは、その時点の値です。`,
      `目標点は、それまでに入った ${(st.score || 0).toLocaleString('ja-JP')} 点を引いて ${(p.target || 0).toLocaleString('ja-JP')} 点にしました。`,
      '実際のゲームと違うところ（引いた札など）があれば直してから「計算する」を押してください。元の局面は「詳しい条件」の「前の局面から始める」に残っています。');
  } else {
    p.cardUses = 1;
    p.turnsRemaining = Math.max(1, (prev.params.turnsRemaining ?? 1) - 1);
    p.gameDeckCount = null;
    P.params = p;
    notes.unshift('手札は空です。次のターンに引いた札を、山札から手札へ動かしてください（山札が足りなければ、ゲームでは捨て札が山札に戻ります）。',
      `指針（${sn(st.stance)}）・指針の回数・ドリンク・成長・P アイテムと継続効果のカウンタは、前のターンの終わりから引き継ぎました。`,
      `熱意（${st.enthusiasm}）・熱意追加・熱意倍率・スコア上昇は、前のターンの終わりの値にしました。行動回数は1にしました。`,
      'ソリティアのターンが始まった時点（ターン開始時の効果が起きた後）の値になるよう、行動回数・熱意・目標点・試験倍率などをゲームの画面と見比べて直してください。');
  }
  P.carry = {at: Date.now(), notes, warns, mid};
  return P;
}

// 札の成長：エンジンの最後の局面の成長（g）を、自己成長の回数とほかの成長に分ける
function growthOf(e, c, st, P) {
  const card = D.cardById.get(e.id);
  const a = {};
  const sg = startGrowthOf(e);   // カスタマイズの分（エンジンが足すので、入力には入れない）
  const raw = c;   // 自己成長の記録を探すときは、エンジンの値のまま
  c = {...c, g: {score: c.g.score - (sg.score || 0), scoreTimes: c.g.scoreTimes - (sg.scoreTimes || 0) - (lifeOn(e) ? LIFE_TIMES : 0)}};   // わたしの人生を込めての回数+2 は札の印（1.17.2）
  if (card?.growth?.limit) {   // 回数の上限がない自己成長（羽ばたけ！など）は、ほかの成長（スコア＋・回数＋）としてそのまま引き継ぐ
    const lim = card.growth.limit;
    const rec = st.cardEffs.find(r => r.src && r.src.key === raw.key && r.src.g.score === raw.g.score && r.src.g.scoreTimes === raw.g.scoreTimes && r.l.length);
    const n = rec ? Math.max(0, Math.min(lim, lim - rec.l[0])) : lim;   // 記録がない＝自己成長を受け終えた（MAX）
    a.grown = n;
    a.score = Math.max(0, c.g.score - n * (card.growth.score || 0));
    a.times = Math.max(0, c.g.scoreTimes - n * (card.growth.times || 0));
  } else { a.score = c.g.score; a.times = c.g.scoreTimes; }
  if (!a.score) delete a.score; if (!a.times) delete a.times;
  if (Object.keys(a).length) P.assume[e.uid] = a;
}
