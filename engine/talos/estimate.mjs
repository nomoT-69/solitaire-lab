// 見込み（名前なし。Tomahawk・Aegis・Javelin の中の機能。利用者の決定 2026-11-04：見込みは名前を付けず、Sentinel は上限だけを受け持つ）。
// 状態がこの先どれだけ伸びそうかの目安。正しい上限ではない。探索の順番・層の上限で残す順だけに使うので、答えの値は厳密なまま。
//  heatCapScore：Tomahawk の層の上限の選び方（Aegis の capHeat）、Javelin の暫定の手の順（beamHeat）が使う
// 設計と測定は DESIGN.md の 22.3〜22.4・22.14〜22.15・22.19。

// 指針の倍率（tecnai.mjs の STANCE_MULT と同じ順：温存・温存2・のんびり・強気・強気2）
const STANCE_MULT=[0.5,0.25,0,2,2.5];
const isPresOrNone=st=>st===0||st===1||st===2;

// 見込み：根からの得点＋λ×（残りの行動＋1）×（この先の熱意の目安＋γ×手札の札の得点の成長の平均）×em×（1＋スコア上昇）×（指針の倍率の目安÷2）×試験倍率
//  この先の熱意の目安＝熱意＋温存（指針なし）から変わると入る熱意（温存5・温存2は8・指針なし10、熱意追加と熱意倍率つき）＋μ×（残りの行動＋1）×熱意追加×熱意倍率/100
//  o.stance（試作、既定 false）：指針の倍率の目安＝max(強気の倍率 2, 今が強気ならその倍率)＋強気強化。÷2 で、強気強化のないふつうの強気を 1 とする
//  o.growth（試作、既定 0）：γ。手札の札の得点の成長（g.score）の平均を、1回ごとの土台に足す
// Tecnai の状態の形でなければ undefined（今の順＝根からの得点だけ）
export function heatCapScore(model,lambda=8,mu=1,o={}){const E=model.engine;if(!E||!E.cfg||!E.root||typeof E.root.heat!=='number')return undefined;const t=E.cfg.trial??1;
  const pend=s=>isPresOrNone(s.st)?((s.st===1?8:s.st===0?5:10)+s.extra)*s.factor/100:0;
  const stance=o.stance?s=>(Math.max(2,STANCE_MULT[s.st]??0)+(s.strB||0)/100)/2:()=>1;
  const gamma=o.growth||0;const BASE=0x100;
  const gAvg=gamma?s=>{const h=s.hand;if(!h||!h.length)return 0;let g=0;for(let i=0;i<h.length;i++)g+=E.types[h.charCodeAt(i)-BASE]?.g?.score||0;return g/h.length;}:()=>0;
  return (s,pg)=>pg+lambda*(s.uses+1)*(s.heat+pend(s)+mu*(s.uses+1)*s.extra*s.factor/100+gamma*gAvg(s))*(s.em??1)*(1+s.bonus/100)*stance(s)*t;}
