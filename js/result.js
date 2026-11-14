export const STATUS = {
  optimal: ['最善（確定）', 'ok', 'すべての手順を調べ終えた、いちばん良い答えです。'],
  provisional: ['今のところの最善', 'warn', '時間内に見つけた一番よい答えです。値は正確ですが、もっと良い答えがあるかもしれません。'],
  restricted: ['今のところの最善', 'warn', '調べる手や状態を絞った範囲での一番よい答えです。値は正確ですが、もっと良い答えがあるかもしれません。'],
  incomplete: ['答えが出ていません', 'err', '答えが出ていません（時間切れ・中止・エラー）。'],
};
export const ORDER_NAME = {d: 'D（ドリンク）', p: 'P（達成率）', a: 'A（操作）'};
export const orderText = o => o.split('').map(c => ORDER_NAME[c]).join(' → ');
export const critText = c => c === 'max' ? '100%にできれば100%、できなければ届く最大の達成率' : `達成率 ${c}% 以上`;
const EXTRA_NAME = {ev: '期待最終点', floor: '最低最終点'};
const num3 = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 1000).toLocaleString('ja-JP');
const frac = s => s && s.includes('/') ? `（${s}）` : '';

