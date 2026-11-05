// 保存（使う人それぞれのブラウザの localStorage だけ。どこにも送らない）。デッキ・局面・設定・計算の設定（HIF など）。
// ファイルへの書き出し・読み込みは設定の画面から。作り上がり（公開の版）には、保存データは入らない（ブラウザの中にしかないため）。
const KEY = 'aegis.v1';
const OLD_KEYS = ['gakumasu-solitaire-gui.v1'];   // 前の名前のときの保存（あれば引き継ぐ）
export const uid = () => Math.random().toString(36).slice(2, 9);

export const STANCES = [['preservation', '温存'], ['preservation2', '温存2段階'], ['leisure', 'のんびり'], ['strength', '強気'], ['strength2', '強気2段階']];

export const defaultSettings = () => ({
  order: 'dpa',              // 比べる順（既定 D→P→A。Tomahawk の DEFAULT_ORDER と同じ）
  criterion: 'max',          // 'max'＝100%にできれば100%、できなければ届く最大の達成率（既定）。'95'・'99'・'100'＝その達成率以上で比べる
  extras: {ev: false, floor: false}, // 自然さの指標（チェックしたときだけ）
  budgetSec: 60, maxStates: 20000000,
  images: true,
});

export const defaultParams = () => ({
  stance: 'preservation', prevStance: 'none', cardUses: 1, enthusiasm: 0, enthusiasmBonus: 0, enthusiasmBuff: 1, scoreBuff: 0,
  target: null, trial: 1, drinkCap: null, turnsRemaining: 1,
  preservationTimes: 0, strengthTimes: 0, leisureTimes: 0, directStanceTimes: 0,
  gameDeckCount: null,       // ゲーム画面の山札の枚数（入れると照合する）
  nullifyCostCards: 0,
  fullPowerCharge: null,     // 全力値（全力値を使う札があるときだけ欄を出す。空欄は 0）
  cumulativeFullPowerCharge: null,   // 累計の全力値（空欄なら計算の部品が仮に 7）       // コストを0にする残り回数（全身全霊+ など。体力が減ったら発動する P アイテムを持つときだけ使う）
});

export const newDeck = name => ({id: uid(), name, cards: [], drinks: [], items: [], pidol: null, updated: Date.now()});
// 局面：zones は {札のuid: 'hand'|'discard'|'removed'|'held'}（ないものは山札）。extra はデッキ外から足した札（眠気など）
export const newPhase = deckId => ({deckId, zones: {}, held: [], extra: [], assume: {}, drinksHeld: [], itemState: {}, registered: [], params: defaultParams()});

function load() {
  for (const k of [KEY, ...OLD_KEYS]) { try { const s = JSON.parse(localStorage.getItem(k)); if (s && s.decks) return s; } catch {} }
  return null;
}
// calcSettings：計算の設定（エンジンの settings.mjs の形。HIF の効果・データの上書き・自作の札）。null は既定のまま
export const S = load() || {decks: [], deckId: null, phase: null, history: [], settings: defaultSettings(), calcSettings: null, ui: {tab: 'deck'}};
S.calcSettings ??= null;
S.settings = {...defaultSettings(), ...S.settings, extras: {...defaultSettings().extras, ...(S.settings?.extras || {})}};
S.ui ||= {tab: 'deck'};
S.history ||= [];

let t = null;
// 保存。方策の木が大きすぎて入らないときは、木を除いて保存する（結果の数値は残る。プレイの案内は計算し直しが要る）
export function save() { clearTimeout(t); t = setTimeout(() => {
  let s = JSON.stringify(S);
  if (s.length > 3e6 && S.result?.tree) s = JSON.stringify({...S, result: {...S.result, tree: null, treeDropped: true}});
  try { localStorage.setItem(KEY, s); } catch {}
}, 150); }
export const deck = () => S.decks.find(d => d.id === S.deckId) || null;
export function replaceAll(obj) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, obj); S.settings = {...defaultSettings(), ...S.settings}; S.ui ||= {tab: 'deck'}; S.history ||= []; S.calcSettings ??= null; save(); }
// 書き出す中身（保存の形の版つき）
export const exportData = () => ({format: 'aegis-user-data', version: 1, exported: new Date().toISOString().slice(0, 10), ...S});
