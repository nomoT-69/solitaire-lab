// 見込み（名前なし。Tomahawk・Aegis・Javelin の中の機能。利用者の決定 2026-11-04：見込みは名前を付けない。上限は Tomahawk の結果の maxScore。Sentinel の名前は 2026-11-05 に廃止）。
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
  // o.hold（試作・測定用、既定 0。2026-11-06、利用者の報告の局面の調べ・案 (a)）：保留した札（眠気以外）の数が根より増えた分 × o.hold だけ、「行動1回分の見込み」を引く。
  // 有効な札を保留するとこのターンで使えなくなる損を見込みに入れる（眠気を保留するのは損なし）
  const SLEEPY=23,wH=o.hold||0;const nHeld=s=>{let n=0;const h=s.held||'';for(let i=0;i<h.length;i++)if(E.types[h.charCodeAt(i)-BASE]?.card?.id!==SLEEPY)n++;return n;};const h0=wH?nHeld(E.root):0;
  const perAct=s=>(s.heat+pend(s)+mu*s.extra*s.factor/100+gamma*gAvg(s))*(s.em??1)*(1+s.bonus/100)*stance(s);
  // o.material（試作・測定用、既定 0。案 (b)）：手札・山札・捨て札にある眠気以外の札の数（＝まだ使える材料）が根から変わった分 × material だけ、「行動1回分の見込み」を足す（減れば引く）。
  // 保留・除外・使い切りで材料が減る。山札の中身は信念の content（どの候補でも同じ）から数え、信念ごとに覚える
  const wM=o.material||0;const useful=z=>{let n=0;for(let i=0;i<z.length;i++)if(E.types[z.charCodeAt(i)-BASE]?.card?.id!==SLEEPY)n++;return n;};
  const deckMemo=new Map();const deckUseful=d=>{let v=deckMemo.get(d);if(v===undefined){v=useful(E.beliefs[d].content);deckMemo.set(d,v);}return v;};
  const nMat=s=>useful(s.hand)+useful(s.disc)+deckUseful(s.deck);const m0=wM?nMat(E.root):0;
  return (s,pg)=>pg+lambda*(s.uses+1)*(s.heat+pend(s)+mu*(s.uses+1)*s.extra*s.factor/100+gamma*gAvg(s))*(s.em??1)*(1+s.bonus/100)*stance(s)*t
    -(wH?wH*lambda*Math.max(0,nHeld(s)-h0)*perAct(s)*t:0)+(wM?wM*lambda*(nMat(s)-m0)*perAct(s)*t:0);}
