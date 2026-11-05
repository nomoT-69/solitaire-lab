// 5. 設定：比べる順、基準、自然さ、計算の予算、表示、計算の設定（HIF など）、データの版、保存データの書き出し・読み込み
import {D} from './data.js';
import {S, save, replaceAll, defaultSettings, exportData} from './store.js';
import {h, sel, num, toast} from './ui.js';
import {orderText, critText} from './result.js';
import {copyReport} from './report.js';

const ORDERS = ['dpa', 'dap', 'pda', 'pad', 'adp', 'apd'];

export function renderSettings(root, rerender) {
  const st = S.settings;
  const touch = () => { save(); rerender(); };
  const dl = () => { const b = new Blob([JSON.stringify(exportData(), null, 1)], {type: 'application/json'}); const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `aegis-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); };
  const ul = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const o = JSON.parse(t); if (!o.decks) throw 0;
    delete o.format; delete o.version; delete o.exported; replaceAll(o); toast('読み込みました'); rerender(); } catch { alert('このファイルは読み込めません'); } }); };

  const calcBox = h('section.panel', {},
    h('h2', '札の設定'),
    h('p', 'HIF などのアビリティの効果、自作の札、データの上書き、データの更新（新しい CSV）、足した札の点検は「札の設定」の画面で行います。'),
    h('button', {onclick: () => { S.ui.tab = 'cards'; save(); rerender(); }}, '札の設定を開く'));

  const v = D.version;
  root.append(h('div.cols.setcols', {},
    h('section.panel', {},
      h('h2', '答えの選び方'),
      h('p.note', '答えは「達成率最大」と「95%で良ければ（達成率 95% 以上でドリンクを少なく）」の2つを1回の計算で出し、並べて表示します。プレイの案内は、答えの欄の「こちらでプレイする」で切り替えます。'),
      sel('比べる順', st.order, ORDERS.map(o => [o, orderText(o) + (o === 'dpa' ? '（既定）' : '')]), v => { st.order = v; touch(); }),
      h('p.note', 'D＝期待ドリンク（少ないほど良い）、P＝達成率（高いほど良い）、A＝期待操作（少ないほど良い）。基準を満たす答えの中で、この順に比べます。'),
      h('h3', '自然さ（チェックしたときだけ使う）'),
      h('label.f', {}, h('input', {type: 'checkbox', checked: st.extras.ev, onchange: e => { st.extras.ev = e.target.checked; touch(); }}), '期待最終点（高いほど良い）'),
      h('label.f', {}, h('input', {type: 'checkbox', checked: st.extras.floor, onchange: e => { st.extras.floor = e.target.checked; touch(); }}), '最低最終点（高いほど良い）'),
      h('p.note', '比べる順の最後に加えます。差がないときの決め手になります。'),
      h('button', {onclick: () => { if (confirm('答えの選び方と予算を既定に戻しますか？')) { const im = st.images; S.settings = {...defaultSettings(), images: im}; touch(); } }}, '既定に戻す'),
      h('h2.mt', '計算の予算'),
      num('時間（秒）', st.budgetSec, v => { st.budgetSec = v ?? 60; touch(); }, {min: 1, hint: '超えたら止めて、それまでの最良を「暫定」で出す'}),
      num('状態数の上限', st.maxStates, v => { st.maxStates = v ?? 2e7; touch(); }, {min: 1000, step: 1000000, width: 10}),
      h('h2.mt', '表示'),
      D.images
        ? h('label.f', {}, h('input', {type: 'checkbox', checked: st.images, onchange: e => { st.images = e.target.checked; touch(); }}), '札などの画像を出す（オフにすると名前だけ）')
        : h('p.note', 'この版には画像が入っていません。札は名前・種別・指針の色で見分けます。')),
    calcBox,
    h('section.panel', {},
      h('h2', '版'),
      h('table.tbl.narrow', {}, h('tbody',
        h('tr', h('th', 'Solitaire Lab（画面）'), h('td', v.gui)),
        h('tr', h('th', '計算'), h('td', `${v.engine.name || ''} ${v.engine.commit || ''}（${v.engine.date || ''}）`)),
        h('tr', h('th', 'データ'), h('td', `gakumas-tools ${v.data.commit}（${v.data.fetched} 取得）`)),
        h('tr', h('th', '画像'), h('td', D.images ? `gakumas-tools ${D.images.commit.slice(0, 7)}（${D.images.fetched} 取得）` : 'なし')),
        h('tr', h('th', '件数'), h('td', `札 ${D.cards.length}・ドリンク ${D.drinks.length}・P アイテム ${D.items.length}・P アイドル ${D.pidols.length}`)))),
      h('h2.mt', '不具合の報告'),
      h('p.note', 'おかしいと思ったら、このボタンで版・設定・局面・答えをコピーして、メッセージに貼り付けて送ってください（個人情報は入りません）。'),
      h('button', {onclick: copyReport}, '報告用の情報をコピー'),
      h('h2.mt', '保存データ'),
      h('p.note', 'デッキ・局面・設定は、このブラウザの中だけに保存されます（どこにも送りません）。別の PC へ移すときや控えには、ファイルに書き出してください。'),
      h('div.row', {}, h('button', {onclick: dl}, 'ファイルに書き出す'),
        h('label.button', {}, 'ファイルから読み込む', h('input', {type: 'file', accept: '.json', hidden: true, onchange: ul}))),
      h('button.danger', {onclick: () => { if (confirm('このブラウザの Solitaire Lab の保存データ（デッキ・局面・設定）をすべて消しますか？')) { replaceAll({decks: [], deckId: null, phase: null, history: [], settings: defaultSettings(), calcSettings: null, ui: {tab: 'settings'}}); rerender(); } }}, '保存データをすべて消す'))));
}

