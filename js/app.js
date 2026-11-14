import {openRestore, importAnswer} from './restore.js?v=1.17.12';
import {loadAll, D, syncCustomCards, CONTACT} from './data.js?v=1.17.12';
import {S, save, deck, restoreTrees} from './store.js?v=1.17.12';
import {h, closePop, popover} from './ui.js?v=1.17.12';
import {copyReport} from './report.js?v=1.17.12';
import {renderDeck} from './deck.js?v=1.17.12';
import {renderTurn} from './turn.js?v=1.17.12';
import {renderSettings} from './settings.js?v=1.17.12';
import {renderCredits} from './credits.js?v=1.17.12';
import {renderCardSettings} from './cardsettings.js?v=1.17.12';
import {setRerender} from './run.js?v=1.17.12';

const MAIN = [['turn', 'ソリティア', renderTurn], ['deck', 'デッキ', renderDeck]];
const SUB = [['cards', '札の設定', renderCardSettings], ['settings', '設定', renderSettings], ['credits', 'クレジット', renderCredits]];
const TABS = [...MAIN, ...SUB];
const OLD = {phase: 'turn', result: 'turn', play: 'turn'};
const app = document.getElementById('app');

function render() {
  closePop();
  const y = window.scrollY;
  if (OLD[S.ui.tab]) S.ui.tab = OLD[S.ui.tab];
  const tab = TABS.find(t => t[0] === S.ui.tab) || (deck() ? TABS[0] : TABS[1]);
  const dk = deck();
  const main = h('main', {class: 'page-' + tab[0]});
  const go = k => { S.ui.tab = k; save(); render(); window.scrollTo(0, 0); };
  app.replaceChildren(
    h('header', {}, h('div.brand', {title: '計算のしくみ：Aegis（Tecnai＋Javelin＋Tomahawk）'}, 'Solitaire Lab'),
      globalThis.PC_MODE && h('span.pcbadge', {title: `計算はこの PC の Node で行います（メモリ ${globalThis.PC_MODE.mem}MiB・層の上限 ${globalThis.PC_MODE.caps.join(',')}）`}, 'PC で計算'),
      h('nav.tabs', {}, MAIN.map(([k, t]) => h('button', {class: k === tab[0] ? 'on' : '', onclick: () => go(k)}, t))),
      S.decks.length ? h('select.deckpick', {title: 'デッキを切り替える', onchange: e => { S.deckId = e.target.value; save(); render(); }},
        S.decks.map(d => h('option', {value: d.id, selected: d.id === S.deckId}, 'デッキ：' + d.name))) : h('span.cur', 'デッキ未選択'),
      h('nav.subtabs', {},
        h('button.menu', {onclick: e => popover(e.currentTarget, '', [
          {label: '概要（はじめての方へ）', onclick: () => window.open('manual/summary.html', '_blank', 'noopener')},
          {label: '使い方（詳細マニュアル）', onclick: () => window.open('manual/index.html', '_blank', 'noopener')},
          {label: '答えがおかしい？ 報告用の情報をコピー', onclick: copyReport},
          {label: `不具合・ご意見を送る（X ${CONTACT.name} の投稿へリプライ）`, onclick: () => window.open(CONTACT.url, '_blank', 'noopener')},
          {label: '匿名でご意見を送る（マシュマロ）', onclick: () => window.open(CONTACT.mshm, '_blank', 'noopener')},
          {label: '報告から局面を戻す（貼り付け）', onclick: () => openRestore(go)},
          {label: 'PC で計算した答えのファイルを読み込む', onclick: () => importAnswer(go)}])}, 'ヘルプ ▾'),
        h('button.menu', {class: SUB.some(([k]) => k === tab[0]) ? 'on' : '', onclick: e => popover(e.currentTarget, '', SUB.map(([k, t]) => ({label: t, disabled: k === tab[0], onclick: () => go(k)})))},
          (SUB.find(([k]) => k === tab[0])?.[1] || '設定') + ' ▾'))),
    main,
    h('footer', {}, `Solitaire Lab ${D.version.gui}・計算 ${D.version.engine.commit || ''}・データ gakumas-tools ${D.version.data.fetched} 取得・非公式のファンツール（営利目的ではありません）`));
  tab[2](main, render);
  window.scrollTo(0, y);
}

setRerender(render);
if (['localhost', '127.0.0.1'].includes(location.hostname)) { try { const r = await fetch('/__pc/ping'); if (r.ok) globalThis.PC_MODE = await r.json(); } catch {} }
try { await loadAll(); syncCustomCards(S.calcSettings); await restoreTrees(); render(); }
catch (e) { app.replaceChildren(h('div.panel', {}, h('h2', '読み込めませんでした'), h('pre', String(e.stack || e)),
  h('p', 'ファイルを直接開くと読み込めません。Web サーバー経由で開いてください（開発中はリポジトリの直下で node gui/serve.mjs）。'))); }
