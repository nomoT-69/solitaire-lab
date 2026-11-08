// 報告用の情報：テストする人が「おかしい」と思ったときに、版・設定・局面・答えを1つの文字列にしてコピーする（個人情報は入らない）。
import {D, CONTACT} from './data.js';
import {S, deck} from './store.js';
import {buildSetup} from './setup.js';
import {itemsFor} from './run.js';
import {toast} from './ui.js';

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
export async function copyReport() {
  const note = prompt('何がおかしかったか、ひとことあれば書いてください（なくてもよい）', '') ?? '';
  const t = reportText(note);
  try { await navigator.clipboard.writeText(t); toast(`報告用の情報をコピーしました。X（${CONTACT.name}）の DM か、紹介の投稿へのリプライに貼り付けて送ってください（ヘルプ ▾ → 不具合・ご意見を送る）`); }
  catch { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], {type: 'text/plain'})); a.download = 'aegis-report.txt'; a.click(); toast('報告用の情報をファイルに保存しました'); }
}
