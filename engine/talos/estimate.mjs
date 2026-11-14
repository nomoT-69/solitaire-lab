
const STANCE_MULT=[0.5,0.25,0,2,2.5];
const isPresOrNone=st=>st===0||st===1||st===2;

export function heatCapScore(model,lambda=8,mu=1,o={}){const E=model.engine;if(!E||!E.cfg||!E.root||typeof E.root.heat!=='number')return undefined;const t=E.cfg.trial??1;
  const pend=s=>isPresOrNone(s.st)?((s.st===1?8:s.st===0?5:10)+s.extra)*s.factor/100:0;
  const stance=o.stance?s=>(Math.max(2,STANCE_MULT[s.st]??0)+(s.strB||0)/100)/2:()=>1;
  const gamma=o.growth||0;const BASE=0x100;
  const gAvg=gamma?s=>{const h=s.hand;if(!h||!h.length)return 0;let g=0;for(let i=0;i<h.length;i++)g+=E.types[h.charCodeAt(i)-BASE]?.g?.score||0;return g/h.length;}:()=>0;
  const SLEEPY=23,wH=o.hold||0;const nHeld=s=>{let n=0;const h=s.held||'';for(let i=0;i<h.length;i++)if(E.types[h.charCodeAt(i)-BASE]?.card?.id!==SLEEPY)n++;return n;};const h0=wH?nHeld(E.root):0;
  const perAct=s=>(s.heat+pend(s)+mu*s.extra*s.factor/100+gamma*gAvg(s))*(s.em??1)*(1+s.bonus/100)*stance(s);
  const wD=o.drink||0;const d0=wD?(E.root.drinks||'').length:0;
  const wU=o.drinkUses||0;const upMemo=new Map();
  const isUp=id=>{let v=upMemo.get(id);if(v===undefined){const dr=E.drinkDef?.(id);v=!!dr&&/"lhs":"cardUsesRemaining"/.test(JSON.stringify(dr.actions))&&/"op":"\+="/.test(JSON.stringify(dr.actions));upMemo.set(id,v);}return v;};
  const nUp=s=>{let n=0;const z=s.drinks||'';for(let i=0;i<z.length;i++)if(isUp(z.charCodeAt(i)-BASE))n++;return n;};const u0=wU?nUp(E.root):0;
  return (s,pg)=>pg+lambda*(s.uses+1)*(s.heat+pend(s)+mu*(s.uses+1)*s.extra*s.factor/100+gamma*gAvg(s))*(s.em??1)*(1+s.bonus/100)*stance(s)*t
    -(wH?wH*lambda*Math.max(0,nHeld(s)-h0)*perAct(s)*t:0)-(wD?wD*lambda*Math.max(0,d0-(s.drinks||'').length)*perAct(s)*t:0)-(wU?wU*lambda*Math.max(0,u0-nUp(s))*perAct(s)*t:0);}
