// 1. デッキ登録：札・ドリンク・P アイテム・P アイドルを名前（正式名・略称）で探して足す。保存して何度も使う
import {D, search, hifOk, unsupported, PLAN_NAME} from './data.js';
import {S, save, uid, deck, newDeck} from './store.js';
import {h, pic, cardTile, popover, toast} from './ui.js';
import {variantKey} from './nextturn.js';

let tab = 'cards', query = '', plusPref = true, withFree = true, resScroll = 0;
// 札の絞り込み（複数選べる）。同じ種類の中は「どれか」、種類どうしは「両方」。何も選ばない種類は絞らない
const RARITIES = ['SSR', 'SR', 'R', 'N'];
// 入手のしかた（gakumas-tools の sourceType）：support＝サポートカードの札、pIdol＝アイドル固有の札、produce＝プランの札（プロデュース中に手に入る）、default＝基本の札（最初からデッキにある）
const SOURCES = [['support', 'サポートカードの札'], ['pIdol', 'アイドル固有の札'], ['produce', 'プランの札'], ['default', '基本の札']];
const filt = {rarity: new Set(), source: new Set()};
const srcOf = c => c.sourceType === 'default' ? 'default' : c.sourceType === 'support' || c.sourceType === 'pIdol' ? c.sourceType : 'produce';
const cardOk = c => c.custom || ((!filt.rarity.size || filt.rarity.has(c.rarity)) && (!filt.source.size || filt.source.has(srcOf(c))));

export function renderDeck(root, rerender) {
  const dk = deck();
  const left = h('section.panel.decks', {},
    h('h2', 'デッキ'),
    h('div.decklist', S.decks.map(d => h('button.deckbtn', {class: d.id === S.deckId ? 'on' : '', onclick: () => { S.deckId = d.id; save(); rerender(); }},
      h('b', d.name), h('small', `札${d.cards.length}・ドリンク${d.drinks.length}・Pアイテム${d.items.length}`)))),
    h('div.row', {},
      h('button', {onclick: () => { const n = prompt('新しいデッキの名前', 'デッキ' + (S.decks.length + 1)); if (!n) return; const d = newDeck(n); S.decks.push(d); S.deckId = d.id; save(); rerender(); }}, '＋ 新しいデッキ'),
      dk && h('button', {onclick: () => { const d = structuredClone(dk); d.id = uid(); d.name += ' のコピー'; S.decks.push(d); S.deckId = d.id; save(); rerender(); }}, '複製')),
    dk && h('div.row', {},
      h('button', {onclick: () => { const n = prompt('デッキの名前', dk.name); if (n) { dk.name = n; touch(); rerender(); } }}, '名前を変える'),
      h('button.danger', {onclick: () => { if (!confirm(`「${dk.name}」を消しますか？`)) return; S.decks = S.decks.filter(d => d !== dk); S.deckId = S.decks[0]?.id || null; save(); rerender(); }}, '消す')),
    h('p.note', 'デッキはこの PC のブラウザに自動で保存されます。ファイルへの書き出しは「設定」から。'));

  if (!dk) { root.append(h('div.cols', {}, left, h('section.panel', {}, h('p.empty', '左の「＋ 新しいデッキ」でデッキを作ってください。')))); return; }

  const touch = () => { dk.updated = Date.now(); save(); };
  const cardEdit = (e, entry) => {
    const c = D.cardById.get(entry.id);
    const items = [];
    if (c.plusId || c.upgraded) items.push({label: c.upgraded ? '通常にする' : '＋にする', key: '+', onclick: () => { entry.id = c.upgraded ? c.baseId : c.plusId; entry.c11n = {}; touch(); rerender(); }});
    if (hifOk(S.calcSettings, c.baseId) || entry.hif) items.push({label: entry.hif ? 'HIF を外す' : 'HIF を付ける', key: 'h', onclick: () => { entry.hif = !entry.hif; touch(); rerender(); }});
    for (const cid of c.custs) {
      const cu = D.custs.get(cid); if (!cu) continue;
      const cur = entry.c11n?.[cid] || 0;
      items.push(h('div.pop-c', {}, h('span', 'カスタマイズ：' + cu.name),
        h('select', {onchange: ev => { entry.c11n = {...entry.c11n, [cid]: Number(ev.target.value)}; touch(); rerender(); }},
          Array.from({length: cu.max + 1}, (_, L) => h('option', {value: L, selected: L === cur}, L ? '段階' + L : 'なし')))));
    }
    items.push({label: '1枚ふやす', key: 'c', onclick: () => { dk.cards.push({...structuredClone(entry), uid: uid()}); touch(); rerender(); }});
    items.push({label: 'デッキから外す', key: 'Delete', cls: 'danger', onclick: () => { dk.cards = dk.cards.filter(x => x !== entry); touch(); rerender(); }});
    popover(e.currentTarget, c.name, items);
  };

  // 札は種類ごとにまとめて並べる（同じ札・同じカスタマイズ・同じHIF）
  const center = h('section.panel.deckbody', {},
    h('h2', {}, dk.name, h('small.sub', `　札 ${dk.cards.length} 枚`)),
    h('h3', 'スキルカード'),
    // 同じ札（同じカスタマイズ・HIF）は1枚にまとめて ×n で出す。押したときの変更は、その中の1枚に当たる
    dk.cards.length ? h('div.grid', groups(dk.cards).map(g => cardTile(g[0], {count: g.length, onclick: e => cardEdit(e, g[0])}))) : h('p.empty', '右で探して足してください。'),
    h('h3', 'P ドリンク（ソリティアで持っていることがあるもの）'),
    h('div.chips', dk.drinks.map(id => chip('drinks', id, D.drinks.find(x => x.id === id)?.name, () => { dk.drinks = dk.drinks.filter(x => x !== id); touch(); rerender(); }))),
    h('h3', 'P アイテム'),
    h('div.chips', dk.items.map(id => chip('items', id, D.items.find(x => x.id === id)?.name, () => { dk.items = dk.items.filter(x => x !== id); touch(); rerender(); }))),
    h('h3', 'P アイドル'),
    h('div.chips', dk.pidol ? chip('pidols', dk.pidol, D.pidols.find(x => x.id === dk.pidol)?.name, () => { dk.pidol = null; touch(); rerender(); }) : h('span.empty', 'なし')));

  // 検索
  const TABS = [['cards', '札'], ['drinks', 'ドリンク'], ['items', 'P アイテム'], ['pidols', 'P アイドル']];
  // プランで分ける（デッキごとに覚える。既定はアノマリー）。フリーはどのプランでも使えるので、既定で一緒に出す
  dk.plan ||= 'anomaly';
  const planOk = x => x.custom || x.plan === dk.plan || (tab !== 'pidols' && withFree && x.plan === 'free');
  // 並べる順：選んだプラン → フリー、その中はレア度の高い順（SSR・SR・R・N）、同じなら番号の順
  const RANK = {SSR: 0, SR: 1, R: 2, N: 3, T: 4};
  const list = (tab === 'cards' ? D.cards.filter(c => !c.upgraded && !c.hidden && cardOk(c)) : D[tab]).filter(planOk)
    .map((x, i) => [x, i]).sort(([a, i], [b, j]) => (a.plan === 'free') - (b.plan === 'free') || (RANK[a.rarity] ?? 5) - (RANK[b.rarity] ?? 5) || i - j).map(([x]) => x);
  let res = search(list, query, Infinity);   // 全部出す（前は最初の60件だけだった）
  const add = (kind, x, plus) => {
    if (kind === 'cards') { const id = plus && x.plusId ? x.plusId : x.id; dk.cards.push({uid: uid(), id, c11n: {}, hif: false}); toast(D.cardById.get(id).name + ' を足しました'); }
    else if (kind === 'pidols') dk.pidol = x.id;
    else if (!dk[kind].includes(x.id)) dk[kind].push(x.id);
    resScroll = resBox.scrollTop;   // 足したあとも一覧の位置を保つ
    touch(); rerender();
  };
  const countLine = h('div.hint.count-line');
  const resBox = h('div.results');
  const right = h('section.panel.searchp', {},
    h('div.row.planrow', {}, h('span.fl', 'プラン'),
      h('div.seg', {}, ['anomaly', 'sense', 'logic'].map(pl => h('button.plan', {class: (dk.plan === pl ? 'on ' : '') + 'pl-' + pl, onclick: () => { dk.plan = pl; touch(); rerender(); }}, PLAN_NAME[pl]))),
      tab !== 'pidols' && h('label.f', {}, h('input', {type: 'checkbox', checked: withFree, onchange: e => { withFree = e.target.checked; rerender(); }}), 'フリーも出す')),
    dk.plan !== 'anomaly' && h('p.note', '計算（ソリティア）が対応しているのはアノマリーの札が中心です。センス・ロジックの札の多くは計算に使えません。'),
    h('div.tabs.small', TABS.map(([k, t]) => h('button', {class: k === tab ? 'on' : '', onclick: () => { tab = k; resScroll = 0; rerender(); }}, t))),
    // 日本語入力（変換中）を途切れさせないよう、打つたびに画面全体は描き直さず、候補の一覧だけを入れ替える
    h('input.search', {type: 'search', placeholder: '名前・略称で探す（例：エンテイ、ドル宣、緑茶）', value: query,
      oninput: e => { if (e.isComposing) return; query = e.target.value; fill(); },
      oncompositionend: e => { query = e.target.value; fill(); },
      onkeydown: e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && res[0]) add(tab, res[0], plusPref); }}),
    tab === 'cards' && h('div.filters', {},
      h('div.frow', {}, h('span.fl', 'レア度'), RARITIES.map(r => fchip(filt.rarity, r, r))),
      h('div.frow', {}, h('span.fl', '入手'), SOURCES.map(([k, t]) => fchip(filt.source, k, t))),
      (filt.rarity.size || filt.source.size) ? h('button.mini', {onclick: () => { filt.rarity.clear(); filt.source.clear(); resScroll = 0; rerender(); }}, '絞り込みを外す') : null),
    tab === 'cards' && h('label.f', {}, h('input', {type: 'checkbox', checked: plusPref, onchange: e => { plusPref = e.target.checked; rerender(); }}), '行を押したとき・Enter で＋版を足す'),
    countLine, resBox);
  // 行のどこを押しても足す（札は「＋版を足す」にチェックがあれば＋版）。ボタンは通常／＋を選んで足す
  function row(x) {
    return h('div.res.clickable', {title: 'ここを押すとデッキに足します', onclick: () => tab === 'cards' ? add('cards', x, plusPref) : add(tab, x)},
      pic(tab, tab === 'cards' && plusPref && x.plusId ? x.plusId : x.id, x.name, 40),
      h('div.rn', {}, h('b', x.name), x.alias?.length ? h('small.alias', ' （' + x.alias.join('・') + '）') : null,
        h('small.meta', [x.custom ? '自作の札' : PLAN_NAME[x.plan] || '', x.rarity, x.idol].filter(Boolean).join('・')),
        unsup(tab, x) && h('small.unsup', {title: '計算は未対応：' + unsup(tab, x)}, '⚠ 計算は未対応（印に触れると理由）')),
      tab === 'cards'
        ? h('div.addb', h('button', {onclick: e => { e.stopPropagation(); add('cards', x, false); }}, '通常'), x.plusId && h('button.sec', {onclick: e => { e.stopPropagation(); add('cards', x, true); }}, '＋'))
        : h('div.addb', h('button.sec', {onclick: e => { e.stopPropagation(); add(tab, x); }}, tab === 'pidols' ? '選ぶ' : '足す')));
  }
  function fchip(set, key, label) {
    return h('button.fchip', {class: set.has(key) ? 'on' : '', onclick: () => { set.has(key) ? set.delete(key) : set.add(key); resScroll = 0; rerender(); }}, label);
  }
  function fill() {
    res = search(list, query, Infinity);
    const cond = tab === 'cards' ? [...filt.rarity, ...SOURCES.filter(([k]) => filt.source.has(k)).map(([, t]) => t)] : [];
    countLine.textContent = `${res.length} 件（${PLAN_NAME[dk.plan]}${tab !== 'pidols' && withFree ? '＋フリー' : ''}${cond.length ? '・' + cond.join('・') : ''}${query ? '・「' + query + '」' : ''}）`;
    resBox.replaceChildren(...res.map(row));
  }
  fill();
  requestAnimationFrame(() => { resBox.scrollTop = resScroll; });
  resBox.addEventListener('scroll', () => { resScroll = resBox.scrollTop; });

  root.append(h('div.cols.deckcols', {}, left, center, right));
}

// 計算が対応していない効果（あれば理由の最初の1つ）
function unsup(kind, x) {
  const u = unsupported(S.calcSettings);
  const p = kind === 'cards' ? (u.cardIds.get(x.plusId ?? x.id) || u.cardIds.get(x.id)) : kind === 'drinks' ? u.drinks.find(d => d.id === x.id)?.problems : kind === 'items' ? u.items.find(d => d.id === x.id)?.problems : null;
  return p?.[0] || null;
}
const groups = cards => { const m = new Map(); for (const en of cards) { const k = variantKey(en); if (!m.has(k)) m.set(k, []); m.get(k).push(en); } return [...m.values()]; };
const chip = (kind, id, name = '?', onremove) => h('span.chip', {}, pic(kind, id, name, 28), name, h('button.x', {title: '外す', onclick: onremove}, '×'));
