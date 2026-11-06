// 報告から局面を戻す：「報告用の情報をコピー」の文（【Solitaire Lab 報告用】{…}）を貼ると、その局面を新しいデッキと局面として作る。
// 報告の setup（計算の部品の形、setup.js の buildSetup の出力）を、画面の形（デッキ・局面）に戻す。戻したあと buildSetup で作り直し、
// 報告の setup と同じになるかを確かめる（違えばその旨を出す）。設定（予算など）は変えない（1.13.0、利用者の指示）
import {D} from './data.js';
import {S, save, uid, newDeck, newPhase} from './store.js';
import {buildSetup} from './setup.js';
import {itemsFor} from './run.js';
import {h, toast} from './ui.js';

export function parseReport(text) {
  const i = text.indexOf('{');
  if (i < 0) throw Error('報告の文が見つかりません（「【Solitaire Lab 報告用】」から最後まで貼ってください）');
  let o;
  try { o = JSON.parse(text.slice(i).trim()); } catch { throw Error('報告の文が途中で切れているか、形が違います'); }
  if (!o.setup) throw Error('報告に局面が入っていません（デッキか局面がないときにコピーした報告です）');
  return o;
}

// 報告 → {deck, phase}
export function phaseFromReport(o) {
  const st = o.setup, cards = new Map(D.cards.map(c => [c.id, c]));
  const missing = [];
  const dk = newDeck('報告から ' + new Date().toLocaleString('ja-JP', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}));
  const P = newPhase(dk.id);
  const add = (spec, zone) => {
    const x = typeof spec === 'number' ? {id: spec} : spec;
    if (!cards.has(x.id)) missing.push(x.id);
    const en = {uid: uid(), id: x.id, c11n: {...(x.c11n || {})}, hif: !!x.hif};
    dk.cards.push(en);
    if (zone !== 'deck') P.zones[en.uid] = zone;
    // 自己成長：grown 'full' は既定（MAX）。limits があれば、上限 − 残り回数 が育った回数。g は育った分を引いた残りを、これまでに上がった分として入れる
    const c = cards.get(x.id), a = {};
    let gs = x.g?.score || 0, gt = x.g?.scoreTimes || 0;
    if (c?.growth && x.grown !== 'full' && Array.isArray(x.limits)) {
      const lim = c.growth.limit || 1, n = Math.max(0, lim - x.limits[0]);
      a.grown = n; gs -= n * (c.growth.score || 0); gt -= n * (c.growth.times || 0);
    }
    if (gs) a.score = gs; if (gt) a.times = gt;
    if (Object.keys(a).length) P.assume[en.uid] = a;
    return en;
  };
  for (const z of ['hand', 'deck', 'discard', 'removed']) for (const sp of st[z] || []) add(sp, z);
  for (const sp of st.held || []) { const en = add(sp, 'held'); P.held.push(en.uid); }
  dk.drinks = [...new Set(st.drinks || [])];
  P.drinksHeld = (st.drinks || []).slice();
  dk.items = (st.pItems || []).map(x => x.id);
  const items = itemsFor(dk);
  for (const x of st.pItems || []) {
    const slots = items.get(x.id)?.inputs?.filter(s => s.key === 'fired');
    const s = {counter: x.counter || 0, fired: []};
    if (slots && Array.isArray(x.limits)) s.fired = slots.map((sl, i) => Math.max(0, sl.max - (x.limits[i] ?? sl.max)));
    else if (Array.isArray(x.limits)) s.remaining = x.limits[0];
    P.itemState[x.id] = s;
  }
  P.registered = (st.registered || []).map(r => { const lim = cards.get(r.card)?.registers?.limit; const o = {card: r.card, counter: r.counter || 0, used: 0}; if (lim && Array.isArray(r.limits)) o.used = lim - r.limits[0]; return o; });
  const p = P.params;
  Object.assign(p, {cardUses: st.cardUses ?? 1, stance: st.stance || 'preservation', prevStance: st.prevStance || 'none', enthusiasm: st.enthusiasm || 0, enthusiasmBonus: st.enthusiasmBonus || 0,
    enthusiasmBuff: st.enthusiasmBuff ?? 1, scoreBuff: st.scoreBuff || 0, trial: st.trial ?? 1, turnsRemaining: st.turnsRemaining ?? 1,
    preservationTimes: st.preservationTimes || 0, strengthTimes: st.strengthTimes || 0, leisureTimes: st.leisureTimes || 0, directStanceTimes: st.stanceChangedByDirectEffectTimes || 0,
    drinkCap: st.drinkCap ?? null, nullifyCostCards: st.nullifyCostCards || 0, fullPowerCharge: st.fullPowerCharge ?? null, cumulativeFullPowerCharge: st.cumulativeFullPowerCharge ?? null,
    target: o.target ?? null, saveDrinks: !!o.mode?.saveDrinks, beyondGoal: !!o.mode?.beyondGoal});
  if (st.abilityUses) P.abilityUses = structuredClone(st.abilityUses);
  return {dk, P, missing};
}

// 戻した局面から setup を作り直して、報告と同じか
export function sameAsReport(o, dk, P) {
  try { const {setup, target} = buildSetup({deck: dk, phase: P, cards: new Map(D.cards.map(c => [c.id, c])), items: itemsFor(dk)}); return JSON.stringify(norm(setup)) === JSON.stringify(norm(o.setup)) && target === o.target; }
  catch { return false; }
}
const norm = s => JSON.parse(JSON.stringify(s), (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);

// 貼り付けの画面
export function openRestore(go) {
  const ta = h('textarea.restoreta', {rows: 8, placeholder: '【Solitaire Lab 報告用】{…} を貼り付けてください'});
  const msg = h('p.hint', '「答えがおかしい？ 報告用の情報をコピー」で送られた文を貼ると、その局面を新しいデッキと局面として作ります。今のデッキ・局面は残ります（局面は「前の局面」に入ります）。設定は変えません。');
  const err = h('p.warnline', {style: 'display:none'});
  const dlg = h('dialog.restore', {},
    h('h3', '報告から局面を戻す'), msg, ta, err,
    h('div.row', {}, h('button.pri', {onclick: () => {
      try {
        const o = parseReport(ta.value);
        const {dk, P, missing} = phaseFromReport(o);
        if (missing.length) throw Error('このデータにない札があります（番号 ' + missing.join('・') + '）。データの版が違うかもしれません');
        const ok = sameAsReport(o, dk, P);
        if (S.phase) { S.history.unshift({at: Date.now(), deckId: S.phase.deckId, label: '報告から戻す前の局面', phase: structuredClone(S.phase)}); S.history = S.history.slice(0, 30); }
        S.decks.push(dk); S.deckId = dk.id; S.phase = P; S.result = null; S.play = null; save();
        dlg.close(); dlg.remove();
        const s = o.settings || {};
        toast((ok ? '局面を戻しました' : '局面を戻しました（報告と少し違うところがあります。報告の版が古いのかもしれません）') + (s.budgetSec ? `。報告の予算は ${s.budgetSec}秒でした` : ''));
        go('turn');
      } catch (e) { err.textContent = e.message; err.style.display = ''; }
    }}, '戻す'), h('button', {onclick: () => { dlg.close(); dlg.remove(); }}, 'やめる')));
  document.body.append(dlg); dlg.showModal(); ta.focus();
}

// PC の道具（tools/solve-report.mjs）が保存した答えのファイル（報告.txt.answer.json）を読み込む。
// 局面を報告から戻し（新しいデッキと局面）、答えをそのまま入れる。プレイの案内・全手順は、ふつうに計算したときと同じに使える。
// 答えの木の「ほかの引き」の印（cut）の先は取り寄せられない（PC で計算したので）→「ここから局面を作る」で計算し直す
export function importAnswer(go) {
  const inp = h('input', {type: 'file', accept: '.json,application/json'});
  inp.onchange = async () => {
    try {
      const f = inp.files[0]; if (!f) return;
      const a = JSON.parse(await f.text());
      if (a.format !== 'solitaire-lab-answer' || !a.result || !a.report?.setup) throw Error('答えのファイルではありません（solve-report.mjs が作る ○○.answer.json を選んでください）');
      const {dk, P, missing} = phaseFromReport({setup: a.report.setup, target: a.report.target, mode: a.report.mode});
      if (missing.length) throw Error('このデータにない札があります（番号 ' + missing.join('・') + '）');
      if (S.phase) { S.history.unshift({at: Date.now(), deckId: S.phase.deckId, label: '答えのファイルを読み込む前の局面', phase: structuredClone(S.phase)}); S.history = S.history.slice(0, 30); }
      dk.name = 'PC の答え ' + dk.name.replace(/^報告から /, '');
      S.decks.push(dk); S.deckId = dk.id; S.phase = P;
      S.result = {...a.result, target: a.report.target, setup: a.report.setup, phase: structuredClone(P), budgetSec: a.sec, calcSettings: a.report.calcSettings ?? null, deckId: dk.id, at: Date.now(),
        imported: true, resumable: false, canFollow: false};
      S.play = null; save();
      toast(`PC で計算した答えを読み込みました（予算 ${a.sec}秒）`);
      go('turn');
    } catch (e) { alert('読み込めませんでした：' + e.message); }
  };
  inp.click();
}
