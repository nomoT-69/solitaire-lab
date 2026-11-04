// Solitaire Lab（内部の名前 Pallas）の入口：データを読み、タブで画面を切り替える
import {loadAll, D, syncCustomCards} from './data.js';
import {S, save, deck} from './store.js';
import {h, closePop, popover} from './ui.js';
import {copyReport} from './report.js';
import {renderDeck} from './deck.js';
import {renderTurn} from './turn.js';
import {renderSettings} from './settings.js';
import {renderCredits} from './credits.js';
import {renderCardSettings} from './cardsettings.js';
import {setRerender} from './run.js';

// 主な画面（毎ターン使うソリティア、ときどき使うデッキ）と、たまに使う画面（右に小さく）
const MAIN = [['turn', 'ソリティア', renderTurn], ['deck', 'デッキ', renderDeck]];
const SUB = [['cards', '札の設定', renderCardSettings], ['settings', '設定', renderSettings], ['credits', 'クレジット', renderCredits]];
const TABS = [...MAIN, ...SUB];
const OLD = {phase: 'turn', result: 'turn', play: 'turn'};   // 前の画面の名前
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
      h('nav.tabs', {}, MAIN.map(([k, t]) => h('button', {class: k === tab[0] ? 'on' : '', onclick: () => go(k)}, t))),
      // デッキの切り替え（どの画面からでも）
      S.decks.length ? h('select.deckpick', {title: 'デッキを切り替える', onchange: e => { S.deckId = e.target.value; save(); render(); }},
        S.decks.map(d => h('option', {value: d.id, selected: d.id === S.deckId}, 'デッキ：' + d.name))) : h('span.cur', 'デッキ未選択'),
      // たまに使うものは、右の2つのメニューにまとめる（ヘルプ：概要・使い方・報告、設定：札の設定・設定・クレジット）
      h('nav.subtabs', {},
        h('button.menu', {onclick: e => popover(e.currentTarget, '', [
          {label: '概要（はじめての方へ・6ページ）', onclick: () => window.open('manual/summary.html', '_blank', 'noopener')},
          {label: '使い方（詳細マニュアル・20ページ）', onclick: () => window.open('manual/index.html', '_blank', 'noopener')},
          {label: '答えがおかしい？ 報告用の情報をコピー', onclick: copyReport}])}, 'ヘルプ ▾'),
        h('button.menu', {class: SUB.some(([k]) => k === tab[0]) ? 'on' : '', onclick: e => popover(e.currentTarget, '', SUB.map(([k, t]) => ({label: t, disabled: k === tab[0], onclick: () => go(k)})))},
          (SUB.find(([k]) => k === tab[0])?.[1] || '設定') + ' ▾'))),
    main,
    h('footer', {}, `Solitaire Lab ${D.version.gui}・計算 ${D.version.engine.commit || ''}・データ gakumas-tools ${D.version.data.fetched} 取得・非公式のファンツール（営利目的ではありません）`));
  tab[2](main, render);
  window.scrollTo(0, y);
}

setRerender(render);
try { await loadAll(); syncCustomCards(S.calcSettings); render(); }
catch (e) { app.replaceChildren(h('div.panel', {}, h('h2', '読み込めませんでした'), h('pre', String(e.stack || e)),
  h('p', 'ファイルを直接開くと読み込めません。Web サーバー経由で開いてください（開発中はリポジトリの直下で node gui/serve.mjs）。'))); }
