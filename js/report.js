// 報告用の情報：テストする人が「おかしい」と思ったときに、版・設定・局面・答えを1つの文字列にしてコピーする（個人情報は入らない）。
import {D, CONTACT} from './data.js';
import {S, deck} from './store.js';
import {buildSetup} from './setup.js';
import {itemsFor} from './run.js';
import {h} from './ui.js';

export function reportText(note = '') {
  const dk = deck();
  let setup = null, target = null;
  try { if (dk && S.phase) ({setup, target} = buildSetup({deck: dk, phase: S.phase, cards: new Map(D.cards.map(c => [c.id, c])), items: itemsFor(dk)})); } catch {}
  const R = S.result;
  const o = {
    aegis: {gui: D.version.gui, engine: D.version.engine.commit, data: D.version.data.commit, images: !!D.images, browser: navigator.userAgent},
    note, settings: S.settings, calcSettings: S.calcSettings, setup, target,
    mode: {saveDrinks: !!S.phase?.params?.saveDrinks, beyondGoal: !!S.phase?.params?.beyondGoal},   // 局面のチェック（報告から局面を戻すときに使う）
    result: R && {kind: R.kind, optimalityProven: R.optimalityProven, best: R.best && {p: R.best.p, d: R.best.d, a: R.best.a}, next: R.next, solver: R.solver, trials: R.trials, ms: R.ms, budgetSec: R.budgetSec, steps: S.play?.steps?.map(s => s.label)},
  };
  return '【Solitaire Lab 報告用】\n' + JSON.stringify(o);
}
// コピーしたあとに、送り先（X の紹介の投稿へのリプライ）を押して開ける案内を出す（1.17.9、利用者の要望。DM は「必要なら」の扱い）
function sendGuide(copied) {
  const go = url => window.open(url, '_blank', 'noopener');
  const dlg = h('dialog.restore', {},
    h('h3', copied ? '報告用の情報をコピーしました' : '報告用の情報をファイルに保存しました'),
    h('p', copied ? '下の送り先を開いて、貼り付けて（Ctrl＋V）送ってください。' : '保存したファイルを開いて中身をコピーし、下の送り先に貼り付けて送ってください。'),
    h('div.row', {}, h('button.pri', {onclick: () => go(CONTACT.url)}, `X の紹介の投稿にリプライする（${CONTACT.name}）`)),
    h('p.hint', '文字数の上限で入りきらないときは、何回かに分けてリプライしてください。必要なときは DM でもかまいません。'),
    h('div.row', {}, h('button', {onclick: () => { dlg.close(); dlg.remove(); }}, '閉じる')));
  document.body.append(dlg); dlg.showModal();
}
export async function copyReport() {
  const note = prompt('何がおかしかったか、ひとことあれば書いてください（なくてもよい）', '') ?? '';
  const t = reportText(note);
  try { await navigator.clipboard.writeText(t); sendGuide(true); }
  catch { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], {type: 'text/plain'})); a.download = 'aegis-report.txt'; a.click(); sendGuide(false); }
}
