// 答えの種類・比べる順・基準の表示（ソリティアの画面 answer.js、設定、クレジットで使う）
export const STATUS = {
  optimal: ['最適（証明済み）', 'ok', 'すべての手順を調べ終えた答えです。'],
  provisional: ['暫定', 'warn', '予算（時間・状態数）の中で見つけた最良の答えです。値は正確ですが、最適とは限りません。'],
  restricted: ['暫定（範囲を絞った最良）', 'warn', '調べる手や状態を絞った範囲での最良です。値は正確ですが、最適とは限りません。'],
  incomplete: ['未完了', 'err', '答えが出ていません（予算切れ・中止・エラー）。'],
};
export const ORDER_NAME = {d: 'D（ドリンク）', p: 'P（達成率）', a: 'A（操作）'};
export const orderText = o => o.split('').map(c => ORDER_NAME[c]).join(' → ');
export const critText = c => c === 'max' ? '100%にできれば100%、できなければ届く最大の達成率' : `達成率 ${c}% 以上`;
const EXTRA_NAME = {ev: '期待最終点', floor: '最低最終点'};
const num3 = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 1000).toLocaleString('ja-JP');
const frac = s => s && s.includes('/') ? `（${s}）` : '';

