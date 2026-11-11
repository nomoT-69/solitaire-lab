// ソリティアの画面（毎ターン使う画面）：左に局面（上部の数値の欄、手札、置き場）、右に答え（計算・次の手・プレイの案内）。
// 札は押して置き場を選ぶ（キー 1:手札 2:保留 3:捨て札 4:除外 0:山札）か、置き場へドラッグする。山札＝デッキ全体−ほかの置き場（自動）。
import {D, search, itemInputs, staminaTriggered, hifSharedLimit, hifSharedKind, hifOldStyle, hifOk, lifeOn, lifeAble} from './data.js?v=1.17.11';
import {firedOf} from './setup.js?v=1.17.11';
import {S, save, uid, deck, newPhase, STANCES} from './store.js?v=1.17.11';
import {h, pic, cardTile, popover, num, sel, toast, qtip} from './ui.js?v=1.17.11';
import {ensurePhase, entries, zoneOf, growthOf, extraGrowth, setAssume, ZONES, ZNAME, MAX_DRINKS, growthBulk, fpNeeds} from './phase.js?v=1.17.11';
import {renderAnswer, isStale} from './answer.js?v=1.17.11';
import {renderSteps} from './steps.js?v=1.17.11';
import {currentSetup} from './run.js?v=1.17.11';

let showMore = false;

export function renderTurn(root, rerender) {
  const dk = deck();
  if (!dk) { root.append(h('section.panel.empty-start', {}, h('h2', 'はじめに'), h('p', 'デッキを作ると、ここでソリティアの局面を入れて計算できます。'),
    h('button.big.pri', {onclick: () => { S.ui.tab = 'deck'; save(); rerender(); }}, 'デッキを作る →'))); return; }
  const P = ensurePhase();
  const p = P.params;
  const all = entries(dk, P);
  const touch = () => { save(); rerender(); };
  const move = (u, z) => {
    if (z === 'held' && zoneOf(P, u) !== 'held') P.held.push(u);
    if (z !== 'held') P.held = P.held.filter(x => x !== u);
    if (z === 'deck') delete P.zones[u]; else P.zones[u] = z;
    touch();
  };

  // ---- 札の印と、押したときのメニュー ----
  const marksFor = en => {
    const m = [];
    const g = growthOf(P, en);
    if (g && g.n < g.lim) m.push(h('button.mark.part', {title: '自己成長（押して変える）', onclick: e => { e.stopPropagation(); setAssume(P, en.uid, 'grown', (g.n + 1) % (g.lim + 1)); touch(); }}, `成長 ${g.n}/${g.lim}`));
    else if (g) m.push(h('button.mark.full', {title: '自己成長 MAX（押して変える）', onclick: e => { e.stopPropagation(); setAssume(P, en.uid, 'grown', 0); touch(); }}, '成長MAX'));
    const x = extraGrowth(P, en);
    if (x.score || x.times) m.push(h('span.mark.grow', [x.score && `+${x.score}`, x.times && `回数+${x.times}`].filter(Boolean).join(' ')));
    if (lifeOn(en)) m.push(h('span.mark.grow', {title: 'わたしの人生を込めて（回数+2）を入れています。札を押して外せます'}, '人生 回数+2'));
    if (P.extra.includes(en)) m.push(h('span.mark.ext', '追加'));
    return m;
  };
  const cardMenu = (e, en) => {
    const c = D.cardById.get(en.id); const z = zoneOf(P, en.uid);
    const items = ZONES.map(([k, n, key]) => ({label: n.replace('（自動）', '') + 'へ', key, disabled: k === z, onclick: () => move(en.uid, k)}));
    // HIF のつけ外し（デッキの画面と同じ。デッキの札そのものを変える。1.14.3、利用者の要望）
    const changed = () => { dk.updated = Date.now(); if (S.result) S.result.deckChanged = true; };
    if (c && (hifOk(S.calcSettings, c.baseId) || en.hif)) items.push({label: en.hif ? 'HIF を外す' : 'HIF を付ける', key: 'h', onclick: () => { en.hif = !en.hif; changed(); touch(); }});
    if (lifeAble(en)) items.push({label: lifeOn(en) ? 'わたしの人生を込めて（回数+2）を外す' : 'わたしの人生を込めて（回数+2）を入れる', onclick: () => { en.life = !lifeOn(en); if (en.life) delete en.life; changed(); touch(); }});
    // 通常／＋、カスタマイズ（デッキの画面と同じ。デッキの札そのものを変える。1.14.3、利用者の要望）
    if (c && (c.plusId || c.upgraded)) items.push({label: c.upgraded ? '通常にする' : '＋にする', key: '+', onclick: () => { en.id = c.upgraded ? c.baseId : c.plusId; en.c11n = {}; changed(); touch(); }});
    for (const cid of c?.custs || []) {
      const cu = D.custs.get(cid); if (!cu) continue;
      const cur = en.c11n?.[cid] || 0;
      items.push(h('div.pop-c', {}, h('span', 'カスタマイズ：' + cu.name),
        h('select', {onchange: ev => { en.c11n = {...en.c11n, [cid]: Number(ev.target.value)}; changed(); save(); }},
          Array.from({length: cu.max + 1}, (_, L) => h('option', {value: L, selected: L === cur}, L ? '段階' + L : 'なし')))));
    }
    const g = growthOf(P, en);
    if (g) items.push(h('div.pop-c', {}, h('span', '自己成長（受けた回数）'),
      h('select', {onchange: ev => { setAssume(P, en.uid, 'grown', Number(ev.target.value)); save(); }},
        Array.from({length: g.lim + 1}, (_, i) => h('option', {value: i, selected: i === g.n}, i === g.lim ? `MAX（${i}/${g.lim}）` : `${i}/${g.lim}（残り ${g.lim - i} 回）`)))));
    if (c?.type !== 'trouble') {
      const x = extraGrowth(P, en);
      const inp = (label, k, v) => h('div.pop-c', {}, h('span', label), h('input', {type: 'number', min: 0, value: v, style: {width: '5em'},
        onchange: ev => { setAssume(P, en.uid, k, Math.max(0, Number(ev.target.value) || 0)); save(); }}));
      items.push(h('div.pop-sub', 'ほかの成長（P アイテム・サポートなどで受けた分。ゲームの札の詳細で増えた分）'), inp('パラメータ上昇 +', 'score', x.score), inp('攻撃回数 +', 'times', x.times));
    }
    if (P.extra.includes(en)) items.push({label: 'この札を消す（追加した札）', key: 'Delete', cls: 'danger', onclick: () => { P.extra = P.extra.filter(x => x !== en); delete P.zones[en.uid]; P.held = P.held.filter(x => x !== en.uid); touch(); }});
    popover(e.currentTarget, c?.name + '　いま：' + ZNAME[z].replace('（自動）', ''), items, {onclose: rerender});
  };

  // ---- 置き場 ----
  const zoneBox = (k, title, {size = 'small', limit = null, hint = ''} = {}) => {
    const list = all.filter(e => zoneOf(P, e.uid) === k);
    if (k === 'held') list.sort((a, b) => P.held.indexOf(a.uid) - P.held.indexOf(b.uid));
    const over = limit !== null && list.length > limit;
    const box = h('div.zone', {class: k + (over ? ' over' : '') + (!list.length && k !== 'hand' && k !== 'held' ? ' empty' : ''), 'data-zone': k},
      h('div.zt', {}, h('b', title), h('span.cnt', {class: over ? 'bad' : ''}, limit !== null ? `${list.length} / ${limit}` : `${list.length}枚`), hint && qtip(hint)),
      h('div.zc', {}, list.length ? list.map(en => cardTile(en, {draggable: true, size, marks: marksFor(en), onclick: e => cardMenu(e, en)}))
        : h('span.drop', k === 'hand' ? '山札の札を押して「手札へ」、またはここへドラッグ' : 'ここへドラッグ')));
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('dragover'); });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('dragover'); const u = e.dataTransfer.getData('text/plain'); if (u) move(u, k); });
    return box;
  };

  // ---- 上部の数値の欄（ゲームの画面の上のほうにあるもの）----
  const setp = k => v => { p[k] = v; touch(); };
  const stepper = (label, k, {min = 0, max = 99, tip = ''} = {}) => h('div.stepper', {}, h('span.sl', label, tip && qtip(tip)),
    h('div.sb', {}, h('button', {disabled: p[k] <= min, onclick: () => { p[k] = Math.max(min, (p[k] || 0) - 1); touch(); }}, '−'),
      h('b', p[k] ?? 0), h('button', {disabled: p[k] >= max, onclick: () => { p[k] = Math.min(max, (p[k] || 0) + 1); touch(); }}, '＋')));
  // pct：画面では％で入れ、保存と計算は倍率のまま（例：試験倍率 4426% ⇔ 44.26）
  // plus：ゲームの表示と同じ「＋何%」（増える分）で入れる（例：熱意倍率 ＋180% ⇔ ×2.8）
  const toView = (v, {pct, plus}) => v === null || v === undefined ? '' : plus ? +((v - 1) * 100).toFixed(4) : pct ? +(v * 100).toFixed(4) : v;
  const fromView = (x, {pct, plus}) => x === '' ? null : plus ? 1 + Number(x) / 100 : pct ? Number(x) / 100 : Number(x);
  const field = (label, k, {step = 1, width = 6, cls = '', pct = false, plus = false, tip = ''} = {}) => h('label.hf', {class: cls}, h('span.sl', label, tip && qtip(tip)),
    h('span.unitwrap', {}, plus && h('span.unit', '＋'), h('input', {type: 'number', step, value: toView(p[k], {pct, plus}), style: {width: width + 'em'},
      onchange: e => setp(k)(fromView(e.target.value, {pct, plus}))}), (pct || plus) && h('span.unit', '%')));
  const drinkCount = id => P.drinksHeld.filter(x => x === id).length;
  const hud = h('section.panel.hud', {},
    h('div.hudrow', {},
      h('div.stances', {}, h('span.sl', '指針', qtip('ゲームの画面の、今の指針。温存・強気の「2段階」は、指針の段階が2のとき')), h('div.seg', {}, STANCES.map(([v, t]) => h('button', {class: 'st ' + v + (p.stance === v ? ' on' : ''), onclick: () => setp('stance')(v)}, t)))),
      stepper('行動回数', 'cardUses', {min: 1, max: 20, tip: 'このターンに、まだ札を使える回数（ゲームの画面のスキルカード使用数）'}),
      h('div.tgtwrap', {}, field('目標点', 'target', {width: 9, cls: 'big', tip: 'このターンで届かせたい点数。プレイの途中から作った局面では、それまでに入った点を引いた値'}),
        // よく使う目標点を押して入れる（1.16.5、利用者の要望）
        h('div.tgtbtns', {}, [1400000, 2400000].map(v => h('button.mini', {class: p.target === v ? 'on' : '', onclick: () => setp('target')(v)}, v / 10000 + '万'))))),
    // 目標点の下のチェック：左に「ドリンクを温存する」（その下に「95%の答えも出す」）、右に「点数を伸ばす」（1.14.7、利用者の要望で 95% を温存の下へ）
    h('div.lastexam', {},
      h('div.opt', {}, h('div.optrow', {}, h('label.f', {}, h('input', {type: 'checkbox', checked: !!p.saveDrinks && !p.beyondGoal, onchange: e => { p.saveDrinks = e.target.checked; if (e.target.checked) p.beyondGoal = false; touch(); }}), 'ドリンクを温存する', h('span.hiftag', 'HIF 1回目の試験におすすめ')), qtip('HIF（試験が2回続くシナリオ）の1回目で、2回目のためにドリンクを残したいときに入れます。入れると、届く確率 → ドリンク → 手数 の順で比べ、ドリンクを少なく使う手を選びます。ほかのシナリオ・HIF の2回目では入れなくてかまいません（ドリンクは比べず、届く確率 → 手数 の順）')),
        p.saveDrinks && !p.beyondGoal && h('label.f.both', {}, h('input', {type: 'checkbox', checked: S.settings.both !== false, onchange: e => { S.settings.both = e.target.checked; touch(); }}), '95%の答えも出す（少し遅くなる）')),
      h('div.opt', {}, h('div.optrow', {}, h('label.f.beyond', {}, h('input', {type: 'checkbox', checked: !!p.beyondGoal, onchange: e => { p.beyondGoal = e.target.checked; if (e.target.checked) p.saveDrinks = false; touch(); }}), '点数を伸ばす', h('span.hiftag.t2', 'HIF 2回目の試験におすすめ')), h('small.hint', '計算が重ければ外す'), qtip('HIF の2回目の試験におすすめです。計算が重い（時間がかかる・答えが出にくい）ときは外してください。入れると、届く確率を一番に、同じなら目標点に届いた先も含めた点の平均（期待最終点）が高い手を選びます。目標点に届いた後も手を続けます。ドリンク・手数は比べません。続きからの計算・途中からの即答・95%の答えはありません')))),
    h('div.hudrow', {},
      field('熱意', 'enthusiasm', {tip: 'ゲームの画面の、今の熱意の値'}), field('熱意追加', 'enthusiasmBonus', {tip: 'ゲームの画面の、熱意追加の値'}),
      field('熱意倍率', 'enthusiasmBuff', {step: 10, plus: true, tip: 'ゲームの表示の「＋何%」をそのまま入れる（P アイテムなどで上がった分も含む）'}),
      field('試験倍率', 'trial', {step: 1, pct: true, tip: '試験全体の倍率（%）。例：4426'}),
      fpNeeds(dk, P).fp && field('全力値', 'fullPowerCharge', {width: 4, tip: 'ゲームの画面の、今の全力値。アンダンテなど全力値がコストの札は、足りるときだけ使える（空欄は 0）'}),
      fpNeeds(dk, P).cfp && field('累計の全力値', 'cumulativeFullPowerCharge', {width: 4, tip: 'このステージで、これまでに増えた全力値の合計（ブースト・ラッシュなどの点に使う）。空欄なら仮に 7 で計算'}),
      h('div.drinks', {}, h('span.sl', `ドリンク ${P.drinksHeld.length}/${MAX_DRINKS}`, qtip(`今持っているドリンク。＋・−で本数を変える（持てるのは${MAX_DRINKS}本まで）`)),
        dk.drinks.length ? h('div.dchips', dk.drinks.map(id => { const d = D.drinks.find(x => x.id === id); const n = drinkCount(id);
          return h('span.dchip', {class: n ? 'on' : '', title: d?.name},
            pic('drinks', id, d?.name || '?', 28), h('span.dn', d?.name),
            h('button', {disabled: !n, onclick: () => { P.drinksHeld.splice(P.drinksHeld.indexOf(id), 1); touch(); }}, '−'), h('b', n),
            h('button', {disabled: P.drinksHeld.length >= MAX_DRINKS, title: P.drinksHeld.length >= MAX_DRINKS ? `持てるのは${MAX_DRINKS}本まで` : '', onclick: () => { P.drinksHeld.push(id); touch(); }}, '＋')); }))
          : h('span.hint', 'デッキにドリンクがありません'))),
    itemBox(),
    regBox(),
    // 成長（P アイテム・サポートなどで受けたスコア＋・回数＋）：点を数倍変えるので、詳しい条件から表に出した（1.16.4、利用者の要望）
    h('div.items.growth', {}, growthBulk(P, all, touch),
      h('p.hint', '成長（タフネス・一心不乱など）は、点が大きい局面では誤差なので空白でもかまいません。'),
      (() => { const n = all.filter(en => { const a = P.assume[en.uid]; return a && (a.score || a.times); }).length; return n ? h('p.hint', `成長を入れてある札：${n}枚（札の左下の印）`) : null; })()),
    h('button.more', {onclick: () => { showMore = !showMore; rerender(); }}, (showMore ? '▾' : '▸') + ' 詳しい条件（回数・前の局面など）'),
    showMore && moreBox());

  // P アイテムの入力欄：デッキの P アイテムのうち、入力の要るもの（発動済みの回数・カウンタ。エンジンの pItemInputs）と、試作・未対応の注記があるものだけ出す
  function itemBox() {
    const rows = dk.items.map(id => {
      const it = D.items.find(x => x.id === id), inf = itemInputs(id);
      const st = (P.itemState[id] ||= {counter: 0, fired: []});
      const slots = inf ? inf.inputs.filter(x => x.key === 'fired') : it?.limit ? [{key: 'fired', max: it.limit}] : [];
      const hasCounter = inf ? inf.inputs.some(x => x.key === 'counter') : !!it?.counter;
      if (!slots.length && !hasCounter && !inf?.note && inf?.supported !== false) return null;
      const setFired = (i, v) => { st.fired = slots.map((y, j) => j === i ? Math.max(0, Math.min(y.max, v ?? 0)) : firedOf(st, j, y.max)); delete st.remaining; touch(); };
      return h('div.itemrow', {}, pic('items', id, it?.name || '?', 32), h('span.inm', it?.name),
        slots.map((x, i) => num(slots.length > 1 ? `発動済みの回数（${i + 1}）` : '発動済みの回数', firedOf(st, i, x.max), v => setFired(i, v), {min: 0, max: x.max, width: 4, hint: '/' + x.max})),
        slots.length ? qtip('ソリティアを始めるまでに、この P アイテムの効果が発動した回数（上限まで発動したら、それ以上は発動しない）') : null,
        hasCounter && num('カウンタ', st.counter, v => { st.counter = v ?? 0; touch(); }, {min: 0, width: 4}),
        inf?.note && !staminaTriggered(id) && h('small.unsup', {title: inf.note}, '試作・未検証'),   // 原点へのチケット（サンフェの P アイテム）は印を外した（1.15.2、利用者の決定）
        slots.some(x => x.enthusiasmBuffPerUse) && firedOf(st, 0, slots[0].max) > 0 && qtip(`発動した分（＋${Math.round(slots.reduce((a, x, i) => a + (x.enthusiasmBuffPerUse || 0) * firedOf(st, i, x.max), 0) * 100)}%）は、ゲームの熱意倍率の表示に入っています。計算では足しません`),
        inf && !inf.supported && h('small.unsup', '計算は未対応：' + (inf.problems[0] || '')));
    }).filter(Boolean);
    // ソリティアの前に使って、効果が残る札（奇跡を起こした一番星）：デッキにあるときだけ。使ったら、効果が働いた回数を入れる
    const pre = [...new Set(all.map(en => en.id))].map(id => D.cardById.get(id)).filter(c => c?.registers?.limit).map(c => {
      const r = P.registered.find(x => x.card === c.id), lim = c.registers.limit;
      return h('div.itemrow', {}, pic('cards', c.id, c.name, 32), h('span.inm', c.name),
        h('label.f', {}, h('input', {type: 'checkbox', checked: !!r, onchange: e => { if (e.target.checked) P.registered.push({card: c.id, counter: 0, used: 0}); else P.registered = P.registered.filter(x => x.card !== c.id); touch(); }}), 'ソリティアの前に使った'),
        r && num('日が差す方へで効果が働いた回数', r.used || 0, v => { r.used = Math.max(0, Math.min(lim, v ?? 0)); touch(); }, {min: 0, max: lim, width: 4, hint: '/' + lim}),
        h('small.unsup', {title: '日が差す方へを使うとき、消費体力を0にする効果（レッスン全体で' + lim + '回）'}, '試作・未検証'));
    });
    rows.push(...pre);
    // HIF の名前ごとに共有する効果（再動：合わせて2回まで。再動＆ドロー・眠気除去：最初の1枚だけ、1.16.7）：デッキに HIF の札があるときだけ、これまでに使った回数
    const hifIds = [...new Set(all.filter(en => en.hif).map(en => D.cardById.get(en.id)?.baseId).filter(Boolean))];
    for (const bid of hifIds) {
      const c = D.cardById.get(bid);
      if (hifOldStyle(S.calcSettings, bid)) { rows.push(h('p.warnline', `${c?.name || '?'}：「設定」の HIF の組が古い形なので、同じ名前の札が2枚あると両方で HIF が発動する計算になります（設定の HIF の組を既定に戻すと、最初の1枚だけになります）`)); continue; }
      const lim = hifSharedLimit(S.calcSettings, bid); if (!lim) continue;
      const kind = hifSharedKind(S.calcSettings, bid); P.abilityUses ||= {}; const m = (P.abilityUses.HIF ||= {});
      // 1回までの効果で、同じ名前の HIF の札がデッキに1枚だけなら出さない（ふつうはソリティアまで使わずに持っていくため。1.16.8、利用者の指示）。前に入れた値は消す
      if (lim === 1 && all.filter(en => en.hif && D.cardById.get(en.id)?.baseId === bid).length < 2) { if (m[bid]) delete m[bid]; continue; }
      const what = {'再動': '使ったときに行動+1', '再動＆ドロー': '使ったときに行動+1・1枚引く', '眠気除去': '使ったときに山札か捨て札の眠気を1枚除外'}[kind];
      rows.push(h('div.itemrow', {}, pic('cards', bid, c?.name || '?', 32), h('span.inm', (c?.name || '?') + `（HIF ${kind}）`),
        lim === 1 ? h('label.f', {}, h('input', {type: 'checkbox', checked: (m[bid] || 0) >= 1, onchange: e => { m[bid] = e.target.checked ? 1 : 0; touch(); }}), 'ソリティアの前に使った')
          : num('これまでに使った回数', m[bid] || 0, v => { m[bid] = Math.max(0, Math.min(lim, v ?? 0)); touch(); }, {min: 0, max: lim, width: 4, hint: '/' + lim}),
        h('small.unsup', {title: what + '。同じ名前の HIF の札で合わせて ' + lim + ' 回まで（通常版と＋版は同じ名前として数える）'}, '試作・未検証')));
    }
    const stamina = dk.items.some(staminaTriggered);
    if (!rows.length && !stamina) return null;
    return h('div.items', {}, h('h4', rows.length > dk.items.length || pre.length ? 'P アイテム・札の効果' : 'P アイテム'), rows,
      stamina && h('div.hudrow', {}, field('コストを0にする残り回数', 'nullifyCostCards', {tip: 'ソリティアを始める前に全身全霊+ などを使ったときの、コスト（体力を含む）が0になる残りの回数。残りがある間は、体力が減ったときの効果が発動しません'})));
  }

  // 継続効果（夏夜に咲く思い出など、使った札が残す効果）：よく使うので、詳しい条件から上に出した（1.15.1、利用者の要望）
  function regBox() {
    return h('div.items.regs', {}, h('h4', '継続効果（夏夜など、使った札が残す効果）'),
      P.registered.map((r, i) => !D.cardById.get(r.card)?.registers?.limit && h('div.itemrow', {}, pic('cards', r.card, D.cardById.get(r.card)?.name || '?', 32), h('span.inm', D.cardById.get(r.card)?.name),
        // ゲームの表示（5→4→…→1、1 のときに札を使うと発動）で入れる。計算の部品のカウンタ（0→1→…→4、4 のとき次の札で発動）＝ 5 − 表示
        num('ゲームの表示', 5 - ((r.counter || 0) % 5), v => { r.counter = 5 - Math.max(1, Math.min(5, v ?? 5)); touch(); }, {min: 1, max: 5, width: 4, hint: '1 なら次の札で発動'}),
        h('button.x', {onclick: () => { P.registered.splice(i, 1); touch(); }}, '×'))),
      h('div.row', {}, D.cards.filter(c => c.registers?.counter && (c.upgraded || !c.plusId)).map(c => h('button.mini', {onclick: () => { P.registered.push({card: c.id, counter: 0}); touch(); }}, '＋ ' + c.name))));
  }

  function moreBox() {
    const hist = S.history.filter(x => x.deckId === dk.id);
    return h('div.more', {},
      h('div.hudrow', {},
        // 直前の指針の欄は 1.16.4 でなくした（答えに影響しない。利用者の決定）。値は前の局面・次のターンから引き継いだものをそのまま渡す
        field('スコア上昇', 'scoreBuff', {step: 5, pct: true}), field('残りターン', 'turnsRemaining'), field('ドリンクの上限', 'drinkCap', {tip: 'このソリティアで使ってよいドリンクの本数（空欄＝上限なし）'}), field('ゲームの山札', 'gameDeckCount', {tip: 'ゲームの画面の山札の枚数。入れると、振り分けた山札の枚数と照らし合わせます'})),
      h('div.hudrow', {}, field('温存の回数', 'preservationTimes'), field('強気の回数', 'strengthTimes'), field('のんびりの回数', 'leisureTimes'), field('札の効果での指針変更', 'directStanceTimes')),
      h('h4', '局面の出し入れ'),
      h('div.row', {},
        hist.length ? sel('', '', [['', '前の局面から始める…'], ...hist.map((x, i) => [i, `${new Date(x.at).toLocaleString('ja-JP', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})}　${x.label}`])],
          v => { if (v === '') return; S.phase = structuredClone(hist[Number(v)].phase); toast('前の局面を読み込みました'); touch(); }) : h('span.hint', '計算した局面は「前の局面」として残ります。'),
        h('button.danger', {onclick: () => { if (confirm('置き場と数値を最初の状態に戻しますか？')) { S.phase = newPhase(dk.id); touch(); } }}, '局面を最初から')));
  }

  // デッキにない札を足す（眠気など）
  let addQ = '';
  const resList = () => search(D.cards.filter(c => !c.hidden), addQ || '眠気', 8).map(c => h('button.mini', {onclick: () => { const en = {uid: uid(), id: c.id, c11n: {}, hif: false}; P.extra.push(en); P.zones[en.uid] = 'hand'; toast(c.name + ' を手札に足しました'); touch(); }}, c.name));
  const resBox = h('div.row', {}, resList());
  const addBox = h('details.addextra', {}, h('summary', '＋ デッキにない札を足す（眠気など）'),
    h('input', {type: 'search', placeholder: '名前・略称', oninput: e => { addQ = e.target.value; resBox.replaceChildren(...resList()); }}), resBox);

  const carry = P.carry && h('div.carry', {},
    h('div.row', {}, h('b', P.carry.mid ? 'プレイの途中から作った局面です' : '前のターンの続きから作った局面です'), h('button.mini', {onclick: () => { delete P.carry; touch(); }}, '閉じる')),
    h('ul', {}, P.carry.warns.map(w => h('li.warn', w)), P.carry.notes.map(n => h('li', n))));

  // 置き場：手札・保留／山札／捨て札・除外 の配置を固定する（空になっても場所は動かない。1.16.4、利用者の要望）。空の置き場はその場で「ここへドラッグ」の受け口になる
  const handHint = '札を押すと置き場を選べます（キー 1:手札 2:保留 3:捨て札 4:除外 0:山札）。ドラッグでも動かせます';
  const left = h('div.turnleft', {}, carry, hud,
    h('section.panel.board', {},
      h('div.handrow', {}, zoneBox('hand', '手札', {size: 'large', limit: 5, hint: handHint}), zoneBox('held', '保留', {size: 'small', limit: 2})),
      zoneBox('deck', '山札', {hint: '山札＝デッキ全体 − ほかの置き場（自動で数えます）。札を押して「手札へ」'}),
      h('div.pilerow', {}, zoneBox('discard', '捨て札'), zoneBox('removed', '除外')),
      addBox));
  const right = h('aside.answer', {});
  renderAnswer(right, rerender);
  root.append(h('div.turn', {}, left, right));
  // 全手順（詳細）：横幅いっぱいに、画面の下へ
  if (S.ui.steps && S.result?.tree && !isStale()) { const box = h('div#steps'); renderSteps(box, rerender); root.append(box); }
}
