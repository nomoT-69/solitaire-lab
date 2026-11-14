import {cardVariant,sharedAbilityItem,LATE_CARD_USED_EFFECTS} from './data.mjs?v=1.17.12';
const LATE_IDS=new Set(LATE_CARD_USED_EFFECTS.flatMap(x=>x.ids));
const gcd=(a,b)=>{while(b){const t=a%b;a=b;b=t;}return a;};
function q(n,d){if(!Number.isSafeInteger(n)||!Number.isSafeInteger(d)||d<=0)throw Error('TALOS_RATIONAL_OVERFLOW');const g=gcd(n,d);return [n/g,d/g];}
const qmul=(a,b)=>q(a[0]*b[0],a[1]*b[1]);
const qadd=(a,b)=>{const g=gcd(a[1],b[1]);return q(a[0]*(b[1]/g)+b[0]*(a[1]/g),a[1]/g*b[1]);};
const qdiv=(a,b)=>q(a[0]*b[1],a[1]*b[0]);
const ONE=[1,1];
const C=String.fromCharCode,BASE=0x100,TOK=0xE000,STAR='*';
const tok=ty=>C(TOK+ty),tokTy=ch=>ch.charCodeAt(0)-TOK;
const msOf=ids=>ids.slice().sort((a,b)=>a-b).map(i=>C(BASE+i)).join('');
const msIds=z=>{const a=[];for(let i=0;i<z.length;i++)a.push(z.charCodeAt(i)-BASE);return a;};
function msCount(z,ty){const c=BASE+ty;let n=0;for(let i=0;i<z.length;i++){const x=z.charCodeAt(i);if(x===c)n++;else if(x>c)break;}return n;}
function msAdd(z,ty){const c=BASE+ty;let i=0;while(i<z.length&&z.charCodeAt(i)<=c)i++;return z.slice(0,i)+C(c)+z.slice(i);}
function msDel(z,ty){const i=z.indexOf(C(BASE+ty));if(i<0)throw Error('札がありません');return z.slice(0,i)+z.slice(i+1);}
function msRuns(z,fn){for(let i=0;i<z.length;){const c=z.charCodeAt(i);let j=i+1;while(j<z.length&&z.charCodeAt(j)===c)j++;fn(c-BASE,j-i,i);i=j;}}
const ceilS=x=>{const n=Math.round(x);return Math.abs(x-n)<1e-9?n:Math.ceil(x);};

export const STANCES=['preservation','preservation2','leisure','strength','strength2'];
const K1=0,K2=1,NON=2,STR=3,STR2=4,NONE=-1;
const isPres=st=>st===K1||st===K2,isStr=st=>st===STR||st===STR2;
const STANCE_MULT=[0.5,0.25,0,2,2.5];
const stanceOf=name=>{const i=STANCES.indexOf(name);if(i<0)throw Error('未対応の指針: '+name);return i;};
const IN_TURN=new Set(['beforeCardUsed','cardUsed','activeCardUsed','mentalCardUsed','afterCardUsed','afterActiveCardUsed','afterMentalCardUsed','stanceChanged','stanceValueChanged','endOfTurn','staminaDecreased','fullPowerChargeIncreased']);
export const CFP_PROVISIONAL=7;
const condGate=node=>{const b=node.body||[];return b.length&&b.every(x=>x.kind==='effect'&&!x.phase&&x.cond)?b:null;};
const directStaminaCost=card=>(card.cost||[]).some(x=>x.kind==='action'&&x.op==='-='&&x.lhs==='stamina'&&x.rhs?.t==='num'&&x.rhs.v>0);
const positiveCost=card=>(card.cost||[]).some(x=>x.kind==='action'&&(x.lhs==='stamina'||x.lhs==='cost'));
export const CM={hc:1,dc:2,crOf:cm=>(cm>>2)&63,ciOf:cm=>(cm>>8)&63,make:(hc,dc,cr,ci)=>{if(cr<0||cr>63||ci<0||ci>63||!Number.isInteger(cr)||!Number.isInteger(ci))throw Error('体力消費の増減が範囲外（0〜63の整数）');return (hc?1:0)|(dc?2:0)|(cr<<2)|(ci<<8);}};
export const COST_FIELDS=new Set(['halfCostTurns','doubleCostTurns','costReduction','costIncrease']);
export function staminaLoss(card,stanceIdx,cm,tc=0){const red=tc+(card.startGrowth?.typedCost||0);let n=0;for(const x of card.cost||[])if(x.kind==='action'&&x.op==='-='&&x.lhs==='stamina'&&x.rhs?.t==='num'&&x.rhs.v>0)n+=Math.max(0,x.rhs.v-red);
  let v=-n*([0.5,0.25,1,2,2][stanceIdx]);if(cm&CM.hc)v*=0.5;if(cm&CM.dc)v*=2;v=Math.floor(v+1e-9);if(v<=0)v=Math.min(v+CM.crOf(cm)-CM.ciOf(cm),0);return -v;}
export function applyCostField(cm,lhs,op,v){if(op!=='+='&&op!=='-=')throw Error(lhs+' の '+op+' は未対応');const d=op==='+='?v:-v;
  let hc=cm&CM.hc,dc=cm&CM.dc,cr=CM.crOf(cm),ci=CM.ciOf(cm);
  if(lhs==='halfCostTurns'){if(d<0)throw Error('halfCostTurns を減らす効果は未対応');if(d>0)hc=1;}else if(lhs==='doubleCostTurns'){if(d<0)throw Error('doubleCostTurns を減らす効果は未対応');if(d>0)dc=1;}
  else if(lhs==='costReduction')cr+=d;else ci+=d;return CM.make(hc,dc,cr,ci);}
const LATER=new Set(['turn','startOfTurn','beforeStartOfTurn','afterStartOfTurn','everyTurn','startOfStage','afterStartOfStage','prestage','turnSkipped']);
const IGNORED_FIELDS=new Set(['genki','fixedGenki','stamina','fixedStamina','fullPowerCharge','halfCostTurns','doubleCostTurns','costReduction','costIncrease','nullifyCostCards','nullifyCostActiveCards','cost','nullifyGenkiTurns','doubleBuffCostTurns']);
const IGNORED_GROWTH=new Set(['g.cost','g.typedCost','g.genki','g.fullPowerCharge','g.halfCostTurns']);
const IGNORED_CALLS=new Set(['setFullPowerChargeBuff','setFullPowerEffectBuff','decreaseFullPowerCharge']);
const CALLS=new Set(['setStance','drawCard','exchangeHand','addCardToDeck','holdSelected','moveRandomToHand','removeRandom','useRandomCardFree','addRandomUpgradedSSRCardToHand',
  'setScoreBuff','setEnthusiasmBuff','setEnthusiasmBonus','setStrengthEffectBuff',...IGNORED_CALLS]);
const ASSIGN=new Set(['score','cardUsesRemaining','enthusiasm','enthusiasmMultiplier','effectCounter','scoreTimes']);

export function createEngine(data,setup,options={}){
  const cfg={cap:setup.cap??5,trial:setup.trial??1,turnsRemaining:setup.turnsRemaining??1,
    drinkCap:Number.isInteger(setup.drinkCap)?setup.drinkCap:null,drinkBase:(setup.drinks||[]).length};
  const trackNC=(()=>{const has=items=>JSON.stringify(items||[]).includes('"phase":"staminaDecreased"');const seen=new Set();
    const card=id=>{const c=data.cards.get(typeof id==='object'?id.id:id);if(!c||seen.has(c))return false;seen.add(c);if(has(c.actions)||has(c.effects))return true;
      let hit=false;(function f(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'&&x.name==='addCardToDeck'){const t=x.args[0]?.t==='num'?x.args[0].v:Number(x.args[0]?.name);if(card(t))hit=true;}else if(x.kind==='effect')f(x.body);}})(c.actions);return hit;};
    for(const x of setup.pItems||[]){const it=data.items.get(typeof x==='object'?x.id:x);if(it&&has(it.effects))return true;}
    for(const r of setup.registered||[])if(card(r.card))return true;
    for(const k of ['hand','deck','discard','removed','held'])for(const x of setup[k]||[])if(card(x))return true;
    return false;})();

  const sharedLimitIfs=x=>x.kind==='effect'&&x.mods?.limit!=null&&(x.body||[]).filter(b=>b.kind==='effect'&&!b.phase&&b.cond).length>=2;
  const SHARED_LIMIT_MSG='回数の上限（limit）を複数の条件（if:）で共有する書き方には対応していません（gakumas-tools では条件ごとに別の回数になります）';
  function validateItems(items,where){
    for(const x of items){
      if(x.kind==='action'){
        if(x.op==='call'){if(!CALLS.has(x.name))throw Error('未対応の効果 '+x.name+'（'+where+'）');}
        else if(!(ASSIGN.has(x.lhs)||IGNORED_FIELDS.has(x.lhs)||IGNORED_GROWTH.has(x.lhs)||x.lhs==='g.score'||x.lhs==='g.scoreTimes'))throw Error('未対応の代入 '+x.lhs+'（'+where+'）');
      }else if(x.kind==='effect'){if(x.phase&&!IN_TURN.has(x.phase)&&!LATER.has(x.phase))throw Error('未対応の発動のきっかけ '+x.phase+'（'+where+'）');
        if(sharedLimitIfs(x))throw Error(SHARED_LIMIT_MSG+'（'+where+'）');
        if(!(x.phase&&LATER.has(x.phase)))validateItems(x.body||[],where);}
    }
  }

  let poolCache=null;
  function aojiruPool(){if(poolCache)return poolCache;
    poolCache=setup.aojiruPool?setup.aojiruPool.slice():[...data.cards.values()].filter(c=>typeof c.key!=='string'&&c.upgraded&&c.rarity==='SSR'&&c.sourceType==='produce'&&(c.plan==='anomaly'||c.plan==='free')).map(c=>c.id);
    if(!poolCache.length)throw Error('青汁の候補がありません');return poolCache;}

  const types=[],typeIdx=new Map();
  function typeOf(cardId,g={}){const card=data.cards.get(cardId);if(!card)throw Error('未登録の札: '+cardId);
    const tc=directStaminaCost(card)?g.typedCost||0:0;const gg={score:g.score||0,scoreTimes:g.scoreTimes||0,...(tc?{typedCost:tc}:{})};const k=cardId+'|'+gg.score+'|'+gg.scoreTimes+(tc?'|'+tc:'');
    let i=typeIdx.get(k);if(i===undefined){validateItems(card.actions,card.name);validateItems(card.effects,card.name);
      i=types.length;types.push({card,g:gg});typeIdx.set(k,i);}return i;}
  const grownType=(ty,d)=>{const t=types[ty];return typeOf(t.card.key??t.card.id,{score:t.g.score+(d.score||0),scoreTimes:t.g.scoreTimes+(d.scoreTimes||0),typedCost:(t.g.typedCost||0)+(d.typedCost||0)});};

  const natsuNodes=new Set();for(const c of data.cards.values()){if(!LATE_IDS.has(c.variantOf??c.id))continue;(function w(items){for(const x of items||[])if(x.kind==='effect'){if(x.phase==='cardUsed')natsuNodes.add(x);w(x.body);}})(c.actions);}
  const defs=[],defIdx=new Map();
  function defOf(node){let i=defIdx.get(node);if(i!==undefined)return i;i=defs.length;const slots=[];
    (function walk(n){if(n.kind!=='effect')return;if(n.mods?.limit!=null){n._slot=slots.length;slots.push(n.mods.limit);}for(const b of n.body||[])if(b.kind==='effect'&&!b.phase)walk(b);})(node);
    const f=node.filter;const ephase=f&&f.t==='id'&&(f.name==='active'||f.name==='mental')&&(node.phase==='cardUsed'||node.phase==='afterCardUsed')?(node.phase==='cardUsed'?f.name+'CardUsed':'after'+(f.name==='active'?'Active':'Mental')+'CardUsed'):node.phase;defs.push({node,slots,ephase,natsu:natsuNodes.has(node)});defIdx.set(node,i);validateItems([node],'効果');return i;}
  const rec=(d,src=-1)=>({d,l:defs[d].slots.slice(),c:0,src});
  const recKey=r=>r.d+':'+r.l.join('.')+':'+r.c+':'+r.src;
  const sortEffs=t=>{t.cardEffs=t.cardEffs.slice().sort((a,b)=>{const x=recKey(a),y=recKey(b);return x<y?-1:x>y?1:0;});};

  const beliefKey=b=>{
    if(b.length===1)return b[0].bag+'\x02'+b[0].mask;
    const bag=b[0].bag;let same=true;for(let i=1;i<b.length;i++)if(b[i].bag!==bag){same=false;break;}
    let s='';
    if(same){s=bag+'\x05';for(const x of b)s+=x.n+'/'+x.d+'\x02'+x.mask+'\x03';return s;}
    for(const x of b)s+=x.n+'/'+x.d+'\x02'+x.bag+'\x02'+x.mask+'\x03';return s;};
  const ch=v=>Number.isInteger(v)&&v>=-1&&v<60000?C(v+33):'\x06'+v+'\x06';
  function key(t){
    let k=t.hand+'\x01'+beliefKey(t.deck)+'\x01'+t.disc+'\x01'+t.rem+'\x01'+t.held.map(ty=>C(BASE+ty)).join('')+'\x01'+
      ch(t.uses)+ch(t.st)+ch(t.prev)+ch(t.heat)+ch(t.extra)+ch(t.factor)+ch(t.bonus)+ch(t.strB)+ch(t.pT)+ch(t.sT)+ch(t.lT)+ch(t.dirT)+ch(t.cardsUsed)+ch(t.turnUsed)+ch(t.nc)+(t.nco?'\x09'+ch(t.nco):'')+(t.cm?'\x0c'+ch(t.cm):'')+(trackFP?'\x0b'+ch(t.fp)+ch(t.cfp)+ch(t.fpb):'')+
      ch(t.done?1:0)+ch(t.em)+ch(t.sTimes)+ch(t.usedTy)+(t.drinks.length?t.drinks.map(ch).join(''):'');
    if(t.effs.length){k+='\x01';for(const r of t.effs)k+=recKey(r)+';';}
    if(t.cardEffs.length){k+='\x04';for(const r of t.cardEffs)k+=recKey(r)+';';}
    return k;
  }
  const copy=s=>({...s,key:null});
  let trackFP=false,cfpProvisional=false,cfpRead=false;
  const carriedGate=n=>setup.nullifyCostCardsCarriedFirst&&JSON.stringify(n,(k,v)=>k.startsWith('_')?undefined:v).includes('nullifyCostCards')?{...n,carriedGate:true}:n;

  const specOf=x=>typeof x==='number'?{id:x}:x;
  function inTurnEffects(card){return card.effects.filter(e=>e.kind==='effect'&&e.phase&&IN_TURN.has(e.phase));}
  function selfGrowth(e){const d={score:0,scoreTimes:0,typedCost:0};let lim=e.mods?.limit??null;
    (function walk(n){for(const x of n.body||[]){if(x.kind!=='effect'||x.phase)continue;if(x.mods?.limit!=null&&lim===null)lim=x.mods.limit;
      if(x.target?.t==='id'&&x.target.name==='this'){for(const y of x.body)if(y.kind==='action'&&y.op==='+='){if(y.lhs==='g.score')d.score+=y.rhs.v;else if(y.lhs==='g.scoreTimes')d.scoreTimes+=y.rhs.v;else if(y.lhs==='g.typedCost')d.typedCost+=y.rhs.v;}}else walk(x);}})(e);
    return {d,lim};}
  function resolveCard(x){
    x=specOf(x);if(!data.cards.get(x.id))throw Error('未登録の札: '+x.id);
    const ck=cardVariant(data,x.id,{c11n:x.c11n||null,abilities:x.hif?['HIF']:(x.abilities||[])}),card=data.cards.get(ck);
    const g={score:(x.g?.score||0)+(card.startGrowth?.score||0),scoreTimes:(x.g?.scoreTimes||0)+(card.startGrowth?.scoreTimes||0),typedCost:x.g?.typedCost||0};
    if(x.grown==='full'){let any=false;
      for(const e of inTurnEffects(card)){const {d,lim}=selfGrowth(e);if(!d.score&&!d.scoreTimes)continue;
        if(lim===null)throw Error('回数の上限がない自己成長は grown:full にできません: '+card.name);any=true;g.score+=d.score*lim;g.scoreTimes+=d.scoreTimes*lim;g.typedCost+=d.typedCost*lim;}
      if(!any)throw Error('自己成長の効果がない札です（grown:full）: '+card.name);}
    return {ty:typeOf(ck,g),full:x.grown==='full',limits:x.limits||null};
  }
  function applyLimits(R,limits,full,where){
    if(full){R.l=R.l.map(()=>0);return;}
    if(!limits)return;if(limits.length!==R.l.length)throw Error('残り回数の数が違います（'+where+'）：'+R.l.length+'個');
    R.l=limits.slice();
  }
  const selfGrowDef=d=>{const D=defs[d];if(D.selfGrow===undefined){let f=false;(function w(n){for(const x of n.body||[]){if(x.kind!=='effect'||x.phase)continue;if(x.target?.t==='id'&&x.target.name==='this')f=true;else w(x);}})(D.node);D.selfGrow=f;}return D.selfGrow;};
  const deadRec=r=>{const n=defs[r.d].node;return n._slot!==undefined&&r.l[n._slot]<1&&n.phase!=='endOfTurn';};
  function checkSelfGrowth(t){
    const seen=new Map(),cnt=new Map();
    for(const r of t.cardEffs){if(r.src<0||!selfGrowDef(r.d))continue;const k=r.d+'|'+r.src;
      if(deadRec(r)){if(!seen.has(k))seen.set(k,null);continue;}
      const v=r.l.join('.')+':'+r.c,o=seen.get(k);
      if(o!=null&&o!==v)throw Error('SELF_GROWTH_AMBIGUOUS：同じ種類の札「'+types[r.src].card.name+'」の自己成長の記録の状態が札どうしで違います（未対応。DESIGN.md 14章）');
      seen.set(k,v);cnt.set(k,{src:r.src,n:(cnt.get(k)?.n||0)+1});}
    for(const {src,n} of cnt.values()){
      const phys=msCount(t.hand,src)+msCount(t.disc,src)+msCount(t.rem,src)+t.held.filter(x=>x===src).length+(deckCounts(t.deck[0]).get(src)||0)+(t.usedTy===src?1:0);
      if(phys!==n)throw Error('SELF_GROWTH_AMBIGUOUS：同じ種類の札「'+types[src].card.name+'」'+phys+'枚のうち、自己成長がまだ発動しうるのは '+n+'枚分です。どの札が成長するか決まりません（使い切った札・効果を持たない札と混ざっている。未対応。DESIGN.md 14章）');}
  }
  function initial(){
    const piles={};for(const k of ['hand','deck','discard','removed','held'])piles[k]=(setup[k]||[]).map(resolveCard);
    const tys=k=>piles[k].map(x=>x.ty);
    {const RE=/"t":"id","name":"(fullPowerCharge|cumulativeFullPowerCharge)"|"name":"decreaseFullPowerCharge"|"phase":"fullPowerChargeIncreased"/;
      const js=o=>JSON.stringify(o,(k,v)=>k.startsWith('_')?undefined:v);const seen=new Set();let fp=false,cum=false;
      const scan=c=>{if(!c||seen.has(c))return;seen.add(c);const j=js([c.usable,c.actions,c.effects]);if((c.cost||[]).some(x=>x.kind==='action'&&x.lhs==='fullPowerCharge')||RE.test(j))fp=true;
        if(js([c.actions,c.effects]).includes('cumulativeFullPowerCharge'))cum=true;
        (function f(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'&&x.name==='addCardToDeck'){const id=x.args[0]?.t==='num'?x.args[0].v:Number(x.args[0]?.name);scan(data.cards.get(id));}
          else if(x.kind==='action'&&x.op==='call'&&x.name==='addRandomUpgradedSSRCardToHand'){for(const id of aojiruPool())scan(data.cards.get(id));}else if(x.kind==='effect')f(x.body);}})(c.actions);};
      for(const k of Object.keys(piles))for(const x of piles[k])scan(types[x.ty].card);
      for(const d of setup.drinks||[]){const dr=data.drinks.get(d);if(dr){if(RE.test(js(dr.actions)))fp=true;(function f(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'&&x.name==='addCardToDeck'){const id=x.args[0]?.t==='num'?x.args[0].v:Number(x.args[0]?.name);scan(data.cards.get(id));}else if(x.kind==='action'&&x.op==='call'&&x.name==='addRandomUpgradedSSRCardToHand'){for(const id of aojiruPool())scan(data.cards.get(id));}else if(x.kind==='effect')f(x.body);}})(dr.actions);}}
      for(const x0 of setup.pItems||[]){const it=data.items.get(specOf(x0).id);if(it&&RE.test(js(it.effects.filter(e=>e.kind==='effect'&&IN_TURN.has(e.phase)))))fp=true;}
      for(const r of setup.registered||[]){const c=data.cards.get(r.card);if(c&&RE.test(js(c.actions)))fp=true;}
      trackFP=fp||!!options.keepAllFields;cfpRead=fp&&cum;cfpProvisional=cfpRead&&setup.cumulativeFullPowerCharge==null;}
    const t={hand:msOf(tys('hand')),disc:msOf(tys('discard')),rem:msOf(tys('removed')),held:tys('held'),
      deck:[{n:1,d:1,bag:msOf(tys('deck')),bagN:piles.deck.length,mask:STAR.repeat(piles.deck.length)}],
      uses:setup.cardUses??1,st:stanceOf(setup.stance||'preservation'),prev:setup.prevStance&&setup.prevStance!=='none'?stanceOf(setup.prevStance):NONE,
      heat:setup.enthusiasm??0,extra:setup.enthusiasmBonus??0,factor:Math.round((setup.enthusiasmBuff??1)*100),bonus:Math.round((setup.scoreBuff??0)*100),strB:Math.round((setup.strengthEffectBuff??0)*100),
      pT:setup.preservationTimes??0,sT:setup.strengthTimes??0,lT:setup.leisureTimes??0,dirT:setup.stanceChangedByDirectEffectTimes??0,cardsUsed:setup.cardsUsed??0,turnUsed:setup.turnCardsUsed??0,fp:trackFP?setup.fullPowerCharge??0:0,cfp:trackFP?setup.cumulativeFullPowerCharge??CFP_PROVISIONAL:0,fpb:trackFP?Math.round((setup.fullPowerChargeBuff??0)*100):0,nc:setup.nullifyCostCardsCarriedFirst&&trackNC?0:(setup.nullifyCostCards??0),nco:setup.nullifyCostCardsCarriedFirst&&trackNC?(setup.nullifyCostCards??0):0,cm:trackNC?CM.make((setup.halfCostTurns??0)>0,(setup.doubleCostTurns??0)>0,setup.costReduction??0,setup.costIncrease??0):0,
      drinks:(setup.drinks||[]).slice().sort((a,b)=>a-b),done:false,score:0,effs:[],cardEffs:[],em:1,sTimes:0,usedTy:-1,key:null};
    for(const d of t.drinks){const dr=data.drinks.get(d);if(!dr)throw Error('未登録のドリンク: '+d);validateItems(dr.actions,dr.name);}
    for(const x0 of setup.pItems||[]){const x=specOf(x0);const it=data.items.get(x.id);if(!it)throw Error('未登録の P アイテム: '+x.id);
      let li=0;
      for(const e of it.effects){if(e.kind!=='effect'||!e.phase)throw Error('P アイテムの形が未対応: '+it.name);
        if(IN_TURN.has(e.phase)){const R=rec(defOf(e));defs[R.d].early=true;R.c=x.counter??0;const n=R.l.length;applyLimits(R,x.limits?x.limits.slice(li,li+n):null,false,it.name);li+=n;t.effs.push(R);}}
      if(x.limits&&li!==x.limits.length)throw Error('残り回数の数が違います（'+it.name+'）：'+li+'個');}
    {const seen=new Set();for(const k of ['hand','deck','discard','removed','held'])for(const x of piles[k]){const c=types[x.ty].card;for(const a of c.abilities||[]){
      const iid=sharedAbilityItem(data,a,c.baseId);if(iid===null||seen.has(iid))continue;seen.add(iid);const it=data.items.get(iid);const used=setup.abilityUses?.[a]?.[c.baseId]??0;
      for(const e of it.effects){if(!IN_TURN.has(e.phase))continue;const R=rec(defOf(e));defs[R.d].early=true;R.l=R.l.map(v=>Math.max(0,v-used));t.effs.push(R);}}}}
    for(const r of setup.registered||[]){const card=data.cards.get(r.card);if(!card)throw Error('未登録の札: '+r.card);
      const nodes=[];(function f(items){for(const x of items)if(x.kind==='effect'){if(x.phase)nodes.push(x);else f(x.body);}})(card.actions);
      const n0=nodes[r.index??0];if(!n0)throw Error('登録する効果がありません: '+card.name);const n=carriedGate(n0);const R=rec(defOf(n));R.c=r.counter??0;applyLimits(R,r.limits,false,card.name);t.effs.push(R);}
    for(const k of Object.keys(piles))for(const x of piles[k]){const card=types[x.ty].card;
      const es=inTurnEffects(card);let li=0;
      for(const e of es){const R=rec(defOf(e),x.ty);const n=R.l.length;applyLimits(R,x.limits?x.limits.slice(li,li+n):null,x.full,card.name);li+=n;t.cardEffs.push(R);}
      if(x.limits&&li!==x.limits.length)throw Error('残り回数の数が違います（'+card.name+'）：'+li+'個');}
    sortEffs(t);checkSelfGrowth(t);t.key=key(t);return t;
  }

  function evalExpr(e,s,ctx){
    switch(e.t){
      case 'num':return e.v;
      case 'id':return idVal(e.name,s,ctx);
      case 'un':return e.op==='!'?!evalExpr(e.a,s,ctx):-evalExpr(e.a,s,ctx);
      case 'bin':{const a=evalExpr(e.a,s,ctx);
        if(e.op==='&')return a&&evalExpr(e.b,s,ctx);if(e.op==='|')return a||evalExpr(e.b,s,ctx);
        const b=evalExpr(e.b,s,ctx);
        switch(e.op){case '==':return a===b;case '!=':return a!==b;case '>=':return a>=b;case '<=':return a<=b;case '>':return a>b;case '<':return a<b;
          case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;}}
      case 'call':return callVal(e,s,ctx);
    }
    throw Error('式');
  }
  function idVal(n,s,ctx){
    switch(n){
      case 'stance':return STANCES[s.st];case 'prevStance':return s.prev===NONE?'none':STANCES[s.prev];
      case 'isStrength':return isStr(s.st);case 'isPreservation':return isPres(s.st)||s.st===NON;case 'isFullPower':return false;
      case 'preservationTimes':return s.pT;case 'strengthTimes':return s.sT;case 'leisureTimes':return s.lT;case 'fullPowerTimes':return 0;
      case 'stanceChangedTimes':return s.pT+s.sT;case 'stanceChangedByDirectEffectTimes':return s.dirT;
      case 'isDirectEffect':return ctx.parent==='processCard';
      case 'parentPhase':return ctx.parent??'none';case 'processCost':case 'processCard':return n;
      case 'effectCounter':return ctx.rec?ctx.rec.c:0;
      case 'cardsUsed':return s.cardsUsed;case 'turnCardsUsed':return s.turnUsed;case 'turnsRemaining':return cfg.turnsRemaining;
      case 'cardUsesRemaining':return s.uses;case 'enthusiasm':return s.heat;case 'score':return s.score;
      case 'fullPowerCharge':return s.fp??0;case 'cumulativeFullPowerCharge':return s.cfp??0;
      case 'usedCardBaseId':return ctx.used>=0?types[ctx.used].card.baseId:-1;case 'usedCardId':return ctx.used>=0?types[ctx.used].card.id:-1;
      case 'none':case 'strength':case 'strength2':case 'preservation':case 'preservation2':case 'leisure':case 'fullPower':return n;
    }
    throw Error('未対応の変数: '+n);
  }
  function callVal(e,s,ctx){
    if(e.name==='cardHasEffect'){const name=e.args[0].t==='id'?e.args[0].name:String(e.args[0].v);return ctx.used>=0&&types[ctx.used].card.effectNames.has(name);}
    if(e.name==='countCards'){let n=0;forEachCard(s,(ty,loc,cnt)=>{if(matchTarget(e.target,ty,loc,ctx))n+=cnt;});return n;}
    if(e.name==='effectCounter')return ctx.rec?ctx.rec.c:0;
    throw Error('未対応の関数: '+e.name);
  }
  function matchTarget(e,ty,loc,ctx){
    switch(e.t){
      case 'bin':if(e.op==='&')return matchTarget(e.a,ty,loc,ctx)&&matchTarget(e.b,ty,loc,ctx);if(e.op==='|')return matchTarget(e.a,ty,loc,ctx)||matchTarget(e.b,ty,loc,ctx);break;
      case 'un':if(e.op==='!')return !matchTarget(e.a,ty,loc,ctx);break;
      case 'num':return types[ty].card.baseId===e.v;
      case 'id':{const c=types[ty].card;switch(e.name){
        case 'all':return true;case 'hand':case 'deck':case 'held':case 'removed':return loc===e.name;case 'discarded':return loc==='discard';
        case 'active':case 'mental':case 'trouble':return c.type===e.name;case 'pIdol':return c.sourceType==='pIdol';
        case 'T':case 'N':case 'R':case 'SR':case 'SSR':case 'L':return c.rarity===e.name;
        case 'this':return loc==='used';}
        if(/^\d+$/.test(e.name))return c.baseId===Number(e.name);break;}
      case 'call':{const c=types[ty].card,v=e.args[0]?.t==='num'?e.args[0].v:Number(e.args[0]?.name);
        if(e.name==='baseId')return c.baseId===v;if(e.name==='id')return c.id===v;
        if(e.name==='effect')return c.effectNames.has(e.args[0].name);if(e.name==='ability')return (c.abilities||[]).includes(e.args[0]?.name);break;}
    }
    throw Error('未対応の対象: '+JSON.stringify(e));
  }
  function forEachCard(s,fn){
    msRuns(s.hand,(ty,n)=>fn(ty,'hand',n));msRuns(s.disc,(ty,n)=>fn(ty,'discard',n));msRuns(s.rem,(ty,n)=>fn(ty,'removed',n));
    for(const ty of s.held)fn(ty,'held',1);
    const counts=deckCounts(s.deck[0]);
    for(const x of s.deck.slice(1)){const c2=deckCounts(x);if(c2.size!==counts.size)throw Error('山札の中身が候補によって違います');for(const [ty,n] of counts)if((c2.get(ty)||0)!==n)throw Error('山札の中身が候補によって違います');}
    for(const [ty,n] of counts)fn(ty,'deck',n);
  }
  function deckCounts(x){const m=new Map();msRuns(x.bag,(ty,n)=>m.set(ty,n));for(const ch of x.mask)if(ch!==STAR){const ty=tokTy(ch);m.set(ty,(m.get(ty)||0)+1);}return m;}

  const cmpPart=(x,y)=>x.bag<y.bag?-1:x.bag>y.bag?1:x.mask<y.mask?-1:x.mask>y.mask?1:0;
  function normalize(parts){
    if(parts.length===1){const x=parts[0];if(x.w[0]===0)throw Error('PROBABILITY');return [{n:1,d:1,bag:x.bag,bagN:x.bagN,mask:x.mask}];}
    let a;
    if(parts.length<=12){
      a=[];for(const x of parts){if(x.w[0]===0)continue;let o=null;for(const y of a)if(y.bag===x.bag&&y.mask===x.mask){o=y;break;}
        if(o)o.w=qadd(o.w,x.w);else a.push({w:x.w,bag:x.bag,bagN:x.bagN,mask:x.mask});}
      if(a.length>1)a.sort(cmpPart);
    }else{
      const m=new Map();
      for(const x of parts){if(x.w[0]===0)continue;const k=x.bag+'\x02'+x.mask;const o=m.get(k);if(o)o.w=qadd(o.w,x.w);else m.set(k,{w:x.w,bag:x.bag,bagN:x.bagN,mask:x.mask});}
      a=[...m.values()].sort(cmpPart);
    }
    if(a.length===1)return [{n:1,d:1,bag:a[0].bag,bagN:a[0].bagN,mask:a[0].mask}];
    let tot=[0,1];for(const x of a)tot=qadd(tot,x.w);if(tot[0]===0)throw Error('PROBABILITY');
    return a.map(x=>{const w=qdiv(x.w,tot);return {n:w[0],d:w[1],bag:x.bag,bagN:x.bagN,mask:x.mask};});
  }
  const wOf=x=>[x.n,x.d];
  function drawOne(s){
    if(s.hand.length>=cfg.cap)return [{p:ONE,s}];
    let b=s;
    if(!b.deck[0].mask.length){if(!b.disc.length)return [{p:ONE,s}];b=copy(s);b.deck=[{n:1,d:1,bag:b.disc,bagN:b.disc.length,mask:STAR.repeat(b.disc.length)}];b.disc='';}
    const obs=new Map();
    for(const x of b.deck){const m0=x.mask[0],rest=x.mask.slice(1);
      const push=(ty,w,bag,bagN)=>{let o=obs.get(ty);if(!o){o=[];obs.set(ty,o);}o.push({w,bag,bagN,mask:rest});};
      if(m0!==STAR)push(tokTy(m0),wOf(x),x.bag,x.bagN);
      else msRuns(x.bag,(ty,c,at)=>push(ty,qmul(wOf(x),q(c,x.bagN)),x.bag.slice(0,at)+x.bag.slice(at+1),x.bagN-1));}
    const out=[];
    for(const [ty,parts] of obs){const t=copy(b);t.hand=msAdd(t.hand,ty);t.deck=normalize(parts);let p=parts[0].w;for(let i=1;i<parts.length;i++)p=qadd(p,parts[i].w);out.push({p,s:t});}
    return out;
  }
  function insertToDeck(t,ty){
    const parts=[];
    for(const x of t.deck){const n=x.mask.length;
      if(!n)parts.push({w:wOf(x),bag:x.bag,bagN:x.bagN,mask:tok(ty)});
      else for(let i=0;i<n;i++)parts.push({w:qmul(wOf(x),[1,n]),bag:x.bag,bagN:x.bagN,mask:x.mask.slice(0,i)+tok(ty)+x.mask.slice(i)});}
    t.deck=normalize(parts);
  }
  function pickRandom(s,target,piles,ctx,fn){
    const vis=[];
    for(const [z,loc] of [[s.hand,'hand'],[s.disc,'discard'],[s.rem,'removed']])if(piles.includes(loc))msRuns(z,(ty,n)=>{if(matchTarget(target,ty,loc,ctx))vis.push([loc,ty,n]);});
    let visN=0;for(const v of vis)visN+=v[2];
    const groups=new Map(),none=[];
    const add=(k,from,ty,part)=>{let g=groups.get(k);if(!g){g={from,ty,parts:[]};groups.set(k,g);}g.parts.push(part);};
    for(const x of s.deck){
      const hits=[];
      if(piles.includes('deck')){msRuns(x.bag,(ty,n)=>{if(matchTarget(target,ty,'deck',ctx))hits.push(['bag',ty,n]);});
        for(let i=0;i<x.mask.length;i++){const ch=x.mask[i];if(ch!==STAR&&matchTarget(target,tokTy(ch),'deck',ctx))hits.push(['pos',tokTy(ch),1,i]);}}
      let deckN=0;for(const h of hits)deckN+=h[2];
      const tot=visN+deckN;
      if(!tot){none.push({w:wOf(x),bag:x.bag,bagN:x.bagN,mask:x.mask});continue;}
      for(const [from,ty,n] of vis)add(from+':'+ty,from,ty,{w:qmul(wOf(x),q(n,tot)),bag:x.bag,bagN:x.bagN,mask:x.mask});
      let stars=0;for(const ch of x.mask)if(ch===STAR)stars++;
      for(const h of hits){
        if(h[0]==='bag'){const bag=msDel(x.bag,h[1]);for(let i=0;i<x.mask.length;i++)if(x.mask[i]===STAR)add('deck:'+h[1],'deck',h[1],{w:qmul(wOf(x),q(h[2],tot*stars)),bag,bagN:x.bagN-1,mask:x.mask.slice(0,i)+x.mask.slice(i+1)});}
        else add('deck:'+h[1],'deck',h[1],{w:qmul(wOf(x),[1,tot]),bag:x.bag,bagN:x.bagN,mask:x.mask.slice(0,h[3])+x.mask.slice(h[3]+1)});
      }
    }
    const out=[];
    for(const g of groups.values()){let p=[0,1];for(const x of g.parts)p=qadd(p,x.w);if(p[0]===0)continue;
      const t=copy(s);t.deck=normalize(g.parts);
      if(g.from==='hand')t.hand=msDel(t.hand,g.ty);else if(g.from==='discard')t.disc=msDel(t.disc,g.ty);else if(g.from==='removed')t.rem=msDel(t.rem,g.ty);
      for(const b of fn(t,g.ty))out.push({p:qmul(p,b.p),s:b.s});}
    if(none.length){let p=[0,1];for(const x of none)p=qadd(p,x.w);if(p[0]>0){const t=copy(s);t.deck=normalize(none);out.push({p,s:t});}}
    return out;
  }

  function each(list,fn){
    if(list.length===1&&list[0].p[0]===1&&list[0].p[1]===1)return fn(list[0].s);
    const out=[];
    for(const b of list){const r=fn(b.s);for(const c of r)out.push(c.p[0]===1&&c.p[1]===1?{p:b.p,s:c.s}:{p:qmul(b.p,c.p),s:c.s});}
    return out;
  }
  function merge(l){if(l.length<2)return l;const m=new Map();for(const c of l){const k=(c.s.key??(c.s.key=key(c.s)))+'\x00'+c.s.score;const o=m.get(k);if(o)o.p=qadd(o.p,c.p);else m.set(k,{p:c.p,s:c.s});}return [...m.values()];}
  const zonesKey=t=>t.hand+'\x01'+beliefKey(t.deck)+'\x01'+t.disc+'\x01'+t.rem+'\x01'+t.held.join(',');
  const drawStep=list=>{const out=each(list,drawOne);return out.length<2?out:merge(out.map(c=>({p:c.p,s:(c.s.key=null,c.s)})));};
  const mergeOk=l=>mergeAll(l);
  function mergeAll(l){for(const c of l)c.s.key=null;return merge(l);}
  function mergeZones(l){if(l.length<2)return l;const m=new Map();for(const c of l){const k=zonesKey(c.s);const o=m.get(k);if(o)o.p=qadd(o.p,c.p);else m.set(k,{p:c.p,s:c.s});}return [...m.values()];}
  const one=s=>[{p:ONE,s}];

  function addEnthusiasm(t,v){t.heat+=Math.ceil(((v+t.extra)*t.factor)/100-1e-9);}
  function addScore(t,v){
    if(!(v>0))return;
    const a=ceilS(v+t.heat*t.em);
    const mult=STANCE_MULT[t.st]+(isStr(t.st)?t.strB/100:0);
    const b=ceilS(a*mult*(1+t.bonus/100));
    t.score+=ceilS(b*cfg.trial);
  }

  function setStance(list,target,ctx){
    return each(list,s=>{
      const prev=s.st;
      if(prev===NON&&isPres(target))return one(s);
      const t=copy(s);
      const next=isPres(target)&&isPres(prev)?K2:isStr(target)&&isStr(prev)?STR2:target;
      t.prev=prev;t.st=next;
      const pctx={...ctx,parent:ctx.phase};
      const change=next!==prev&&!(prev===K1&&next===K2)&&!(prev===STR&&next===STR2);
      if(!change)return next!==prev?trigger(one(t),'stanceValueChanged',pctx):one(t);
      if((prev===K1||prev===K2||prev===NON)&&next!==NON){t.uses+=1;addEnthusiasm(t,prev===K1?5:prev===K2?8:10);}
      const cnt=list=>each(list,u=>{if(isPres(next))u.pT++;else if(isStr(next))u.sT++;else if(next===NON)u.lT++;if(ctx.phase==='processCard')u.dirT++;return one(u);});
      return trigger(cnt(trigger(one(t),'stanceChanged',pctx)),'stanceValueChanged',pctx);
    });
  }

  function trigger(list,phase,ctx,pre=null){
    const phases=[phase];const ty=ctx.used>=0?types[ctx.used].card.type:null;
    if(phase==='cardUsed'&&ty==='active')phases.push('activeCardUsed');if(phase==='cardUsed'&&ty==='mental')phases.push('mentalCardUsed');
    if(phase==='afterCardUsed'&&ty==='active')phases.push('afterActiveCardUsed');if(phase==='afterCardUsed'&&ty==='mental')phases.push('afterMentalCardUsed');
    return each(list,s=>{
      if(!s.effs.length&&!s.cardEffs.length)return one(s);
      const plan=[];
      for(const field of ['effs','cardEffs'])s[field].forEach((r,i)=>{const D=defs[r.d],n=D.node;if(phases.includes(n.phase)&&filterOk(n,ctx))plan.push([field,i,D.natsu?phases.length*3+2:phases.indexOf(D.ephase)*3+(field==='cardEffs'?1:D.early?0:2)]);});
      plan.sort((a,b)=>a[2]-b[2]);
      let cur=one(s);
      const snap=pre??s;
      const em0=s.em,st0=s.sTimes;const reset=(t,em,st)=>{if(t.em===em&&t.sTimes===st)return t;const u=copy(t);u.em=em;u.sTimes=st;return u;};
      for(const [field,i] of plan)cur=each(cur,t0=>{const t=reset(t0,1,0);return runEffectNode(one(t),defs[t[field][i].d].node,snap,{...ctx,phase,recField:field,recIdx:i,src:t[field][i].src,inCard:false});});
      cur=each(cur,t=>one(reset(t,em0,st0)));
      if(plan.some(([f])=>f==='cardEffs'))cur=each(cur,t=>{const u=copy(t);sortEffs(u);return one(u);});
      return cur;
    });
  }
  function filterOk(node,ctx){if(!node.filter)return true;if(ctx.used<0)return false;return matchTarget(node.filter,ctx.used,'used',ctx);}
  function runEffectNode(list,node,snap,ctx){
    return each(list,s=>{
      const r=ctx.recField?s[ctx.recField][ctx.recIdx]:null;
      if(node._slot!==undefined&&r&&r.l[node._slot]<1)return one(s);
      if(node.carriedGate&&snap.nco>0)return one(s);
      const sz=snap===s||(snap.hand===s.hand&&snap.disc===s.disc&&snap.rem===s.rem&&snap.held===s.held&&snap.deck===s.deck)?snap:{...snap,hand:s.hand,disc:s.disc,rem:s.rem,held:s.held,deck:s.deck};
      if(node.cond&&!evalExpr(node.cond,sz,{...ctx,rec:ctx.recField?snap[ctx.recField][ctx.recIdx]:null}))return one(s);
      if(options.limitOnCond!==false&&node._slot!==undefined&&r){const g=condGate(node);if(g){const c2={...ctx,rec:ctx.recField?snap[ctx.recField][ctx.recIdx]:null};if(!g.some(x=>evalExpr(x.cond,sz,c2)))return one(s);}}
      let t=copy(s);
      if(node._slot!==undefined&&r){const l=r.l.slice();l[node._slot]--;t=setRec(t,ctx,{...r,l});}
      if(node.target)return growTargets(one(t),node.target,node.body,ctx);
      return runItems(one(t),node.body,snap,ctx);
    });
  }
  function setRec(t,ctx,nr){const arr=t[ctx.recField].slice();arr[ctx.recIdx]=nr;t[ctx.recField]=arr;return t;}
  function runItems(list,items,snap,ctx){
    let cur=list;
    for(const x of items){
      if(x.kind==='action')cur=action(cur,x,snap,ctx);
      else if(x.kind==='effect'){
        if(x.phase){if(IN_TURN.has(x.phase))cur=each(cur,s=>{const t=copy(s);t.effs=[...t.effs,rec(defOf(x))];return one(t);});continue;}
        cur=runEffectNode(cur,x,snap,ctx);
      }
    }
    return cur;
  }

  function action(list,a,snap,ctx){
    if(a.op==='call'){
      const arg=i=>a.args[i]===undefined?undefined:a.args[i].t==='id'?a.args[i].name:evalExpr(a.args[i],snap,ctx);
      switch(a.name){
        case 'setStance':return setStance(list,stanceOf(arg(0)),ctx);
        case 'drawCard':{let cur=list;const n=a.args.length?arg(0):1;for(let i=0;i<n;i++)cur=cur.length===1?each(cur,drawOne):drawStep(cur);return cur;}
        case 'exchangeHand':return each(list,s=>{const n=s.hand.length;const t=copy(s);t.disc=msOf([...msIds(t.disc),...msIds(t.hand)]);t.hand='';let cur=one(t);for(let i=0;i<n;i++)cur=cur.length===1?each(cur,drawOne):mergeZones(each(cur,drawOne));return cur;});
        case 'addCardToDeck':return each(list,s=>{const t=copy(s);insertToDeck(t,typeOf(arg(0)));return one(t);});
        case 'holdSelected':return each(list,s=>holdSelected(s,ctx));
        case 'moveRandomToHand':return mergeOk(each(list,s=>s.hand.length>=cfg.cap?one(s):pickRandom(s,a.target,['deck','discard','removed'],ctx,(t,ty)=>{t.hand=msAdd(t.hand,ty);return one(t);})));
        case 'removeRandom':return mergeOk(each(list,s=>pickRandom(s,a.target,['deck','discard','hand'],ctx,(t,ty)=>{t.rem=msAdd(t.rem,ty);return one(t);})));
        case 'useRandomCardFree':return merge(each(list,s=>pickRandom(s,a.target,['deck','discard','removed','hand'],ctx,(t,ty)=>useCard(one(t),ty,{free:true}))));
        case 'addRandomUpgradedSSRCardToHand':return merge(each(list,s=>{if(s.hand.length>=cfg.cap)return one(s);const pool=aojiruPool();const n=pool.length;
          return pool.map(id=>{const t=copy(s);t.hand=msAdd(t.hand,typeOf(id));return {p:[1,n],s:t};});}));
        case 'setScoreBuff':return each(list,s=>{const t=copy(s);t.bonus+=Math.round(arg(0)*100);return one(t);});
        case 'setEnthusiasmBuff':return each(list,s=>{const t=copy(s);t.factor+=Math.round(arg(0)*100);return one(t);});
        case 'setEnthusiasmBonus':return each(list,s=>{const t=copy(s);t.extra+=arg(0);return one(t);});
        case 'setStrengthEffectBuff':return each(list,s=>{const t=copy(s);t.strB+=Math.round(arg(0)*100);return one(t);});
        case 'setFullPowerChargeBuff':if(!trackFP)return list;return each(list,s=>{const t=copy(s);t.fpb+=Math.round(arg(0)*100);return one(t);});
        case 'decreaseFullPowerCharge':if(!trackFP)return list;return each(list,s=>{const t=copy(s);t.fp=Math.max(0,t.fp-arg(0));return one(t);});
      }
      if(IGNORED_CALLS.has(a.name))return list;
      throw Error('未対応の効果: '+a.name);
    }
    const L=a.lhs;
    if(L==='nullifyCostCards'&&trackNC){if(a.op!=='+=')throw Error('nullifyCostCards の '+a.op+' は未対応');return each(list,s=>{const t=copy(s);t.nc+=evalExpr(a.rhs,snap,ctx);return one(t);});}
    if(L==='fullPowerCharge'&&trackFP)return each(list,s=>{const t=copy(s);let x=evalExpr(a.rhs,readsFP(a.rhs)?s:snap,ctx);
      if(a.op==='+='){if(ctx.inCard&&ctx.phase==='processCard'&&t.usedTy>=0)x+=types[t.usedTy].card.startGrowth?.fullPowerCharge??0;
        if(x>0){x=x*(100+t.fpb)/100;t.cfp+=x;t.fp+=x;return ctx.phase==='processCard'||ctx.phase==='processCost'?trigger(one(t),'fullPowerChargeIncreased',{...ctx,parent:ctx.phase}):one(t);}
        t.fp+=x;return one(t);}
      if(a.op==='-='){t.fp-=x;return one(t);}
      throw Error('fullPowerCharge の '+a.op+' は未対応');});
    if(COST_FIELDS.has(L)&&trackNC)return each(list,s=>{const t=copy(s);t.cm=applyCostField(t.cm,L,a.op,evalExpr(a.rhs,snap,ctx));return one(t);});
    if(IGNORED_FIELDS.has(L)||IGNORED_GROWTH.has(L))return list;
    return each(list,s=>{
      const t=copy(s),v=evalExpr(a.rhs,trackFP&&readsFP(a.rhs)?s:snap,ctx);
      switch(L){
        case 'score':{
          if(a.op!=='+=')throw Error('score の '+a.op+' は未対応');
          const g=ctx.inCard&&t.usedTy>=0?types[t.usedTy].g.score:0;
          addScore(t,v+g);
          if(t.sTimes>0){const n=t.sTimes;t.sTimes=0;for(let i=0;i<n;i++)addScore(t,v+g);}
          return one(t);}
        case 'cardUsesRemaining':if(a.op==='+=')t.uses+=v;else if(a.op==='-=')t.uses-=v;else throw Error('cardUsesRemaining '+a.op);return one(t);
        case 'enthusiasm':if(a.op!=='+=')throw Error('enthusiasm '+a.op);addEnthusiasm(t,v);return one(t);
        case 'enthusiasmMultiplier':if(a.op!=='=')throw Error('enthusiasmMultiplier '+a.op);t.em=v;return one(t);
        case 'scoreTimes':if(a.op==='+=')t.sTimes+=v;else if(a.op==='=')t.sTimes=v;else throw Error('scoreTimes '+a.op);return one(t);
        case 'effectCounter':{if(!ctx.recField)throw Error('effectCounter は登録された効果の中だけで使えます');
          const r=t[ctx.recField][ctx.recIdx];return one(setRec(t,ctx,{...r,c:a.op==='+='?r.c+v:v}));}
      }
      throw Error('未対応の代入: '+L);
    });
  }
  function growTargets(list,target,body,ctx){
    const deltas={score:0,scoreTimes:0,typedCost:0};
    for(const x of body){if(x.kind!=='action')throw Error('成長の書き方が未対応');
      if(trackFP&&(x.lhs==='g.fullPowerCharge'||x.lhs==='g.typedCost')&&fpGrowthHits(x.lhs,target,ctx))throw Error('使っている途中の全力値・コストの成長（'+x.lhs+'）は未対応（全力値の札に当たる）');
      if(x.lhs==='g.typedCost'&&x.op==='+='){deltas.typedCost+=evalExpr(x.rhs,null,ctx);continue;}
      if(IGNORED_GROWTH.has(x.lhs))continue;
      if(x.op!=='+=')throw Error('成長の書き方が未対応: '+x.lhs+x.op);
      if(x.lhs==='g.score')deltas.score+=evalExpr(x.rhs,null,ctx);else if(x.lhs==='g.scoreTimes')deltas.scoreTimes+=evalExpr(x.rhs,null,ctx);else throw Error('未対応の成長: '+x.lhs);}
    if(!deltas.score&&!deltas.scoreTimes&&!deltas.typedCost)return list;
    const isThis=target.t==='id'&&target.name==='this';
    return each(list,s=>{
      const t=copy(s);const g=ty=>grownType(ty,deltas);
      if(isThis&&ctx.recField==='cardEffs'){
        const src=t.cardEffs[ctx.recIdx].src,to=g(src);
        if(!growOne(t,src,to))throw Error('成長させる札が見つかりません');
        const arr=t.cardEffs.slice();arr[ctx.recIdx]={...arr[ctx.recIdx],src:to};t.cardEffs=arr;
        return one(t);
      }
      if(isThis){if(t.usedTy<0)throw Error('this の札がありません');t.usedTy=g(t.usedTy);return one(t);}
      const mapZ=(z,loc)=>msOf(msIds(z).map(ty=>matchTarget(target,ty,loc,ctx)?g(ty):ty));
      t.hand=mapZ(t.hand,'hand');t.disc=mapZ(t.disc,'discard');t.rem=mapZ(t.rem,'removed');
      t.held=t.held.map(ty=>matchTarget(target,ty,'held',ctx)?g(ty):ty);
      t.deck=normalize(t.deck.map(x=>({w:wOf(x),bag:mapZ(x.bag,'deck'),bagN:x.bagN,mask:[...x.mask].map(ch=>ch===STAR?ch:matchTarget(target,tokTy(ch),'deck',ctx)?tok(g(tokTy(ch))):ch).join('')})));
      if(t.usedTy>=0&&matchTarget(target,t.usedTy,'used',ctx))t.usedTy=g(t.usedTy);
      const ownerCount=ty=>{let mt=0,all=0;const add=(n,loc)=>{all+=n;if(n&&matchTarget(target,ty,loc,ctx))mt+=n;};
        add(msCount(s.hand,ty),'hand');add(msCount(s.disc,ty),'discard');add(msCount(s.rem,ty),'removed');add(s.held.filter(x=>x===ty).length,'held');
        add(deckCounts(s.deck[0]).get(ty)||0,'deck');add(s.usedTy===ty?1:0,'used');return [mt,all];};
      const dead=r=>{const n=defs[r.d].node;return n._slot!==undefined&&r.l[n._slot]<1&&n.phase!=='endOfTurn';};
      t.cardEffs=t.cardEffs.map(r=>{if(r.src<0)return r;const [mt,all]=ownerCount(r.src);if(!mt)return r;
        if(mt!==all){if(dead(r))return r;throw Error('TALOS_GROWTH_OWNER_AMBIGUOUS：成長した札「'+types[r.src].card.name+'」の効果の持ち主が決まりません（同じ種類の札の一部だけが成長した）');}
        return {...r,src:g(r.src)};});sortEffs(t);
      return one(t);
    });
  }
  function growOne(t,from,to){
    if(msCount(t.hand,from)){t.hand=msAdd(msDel(t.hand,from),to);return true;}
    if(msCount(t.disc,from)){t.disc=msAdd(msDel(t.disc,from),to);return true;}
    if(msCount(t.rem,from)){t.rem=msAdd(msDel(t.rem,from),to);return true;}
    const h=t.held.indexOf(from);if(h>=0){t.held=t.held.slice();t.held[h]=to;return true;}
    if(t.usedTy===from){t.usedTy=to;return true;}
    let ok=true;
    t.deck=normalize(t.deck.map(x=>{let bag=x.bag,mask=x.mask;
      if(msCount(bag,from))bag=msAdd(msDel(bag,from),to);else{const i=mask.indexOf(tok(from));if(i<0)ok=false;else mask=mask.slice(0,i)+tok(to)+mask.slice(i+1);}
      return {w:wOf(x),bag,bagN:x.bagN,mask};}));
    return ok;
  }
  function holdSelected(s,ctx){
    const sel=ctx.select;if(!sel){if(ctx.noSelect)return one(s);throw Error('保留する札が選ばれていません');}
    const t=copy(s);t.held=t.held.slice();
    if(sel.from==='discard')t.disc=msDel(t.disc,sel.ty);
    else if(sel.from==='hand')t.hand=msDel(t.hand,sel.ty);
    else{const parts=[];
      for(const x of t.deck){const nBag=msCount(x.bag,sel.ty);let n=nBag,stars=0;for(const ch of x.mask){if(ch===STAR)stars++;else if(tokTy(ch)===sel.ty)n++;}
        if(!n)throw Error('選んだ札が山札にありません');
        for(let i=0;i<x.mask.length;i++){const ch=x.mask[i];
          if(ch===STAR){if(nBag)parts.push({w:qmul(wOf(x),q(nBag,n*stars)),bag:msDel(x.bag,sel.ty),bagN:x.bagN-1,mask:x.mask.slice(0,i)+x.mask.slice(i+1)});}
          else if(tokTy(ch)===sel.ty)parts.push({w:qmul(wOf(x),[1,n]),bag:x.bag,bagN:x.bagN,mask:x.mask.slice(0,i)+x.mask.slice(i+1)});}}
      t.deck=normalize(parts);}
    t.held.push(sel.ty);
    while(t.held.length>2){const old=t.held.shift();t.disc=msAdd(t.disc,old);}
    return one(t);
  }
  function selectable(s,target,ctx){
    const out=[];
    msRuns(s.disc,ty=>{if(matchTarget(target,ty,'discard',ctx))out.push({ty,from:'discard'});});
    msRuns(s.hand,ty=>{if(matchTarget(target,ty,'hand',ctx))out.push({ty,from:'hand'});});
    const sets=s.deck.filter(x=>x.n>0).map(x=>new Set([...deckCounts(x).keys()].filter(ty=>matchTarget(target,ty,'deck',ctx))));
    if(sets.length)for(const ty of sets[0])if(sets.every(x=>x.has(ty)))out.push({ty,from:'deck'});
    return out.sort((a,b)=>a.ty-b.ty||a.from.localeCompare(b.from));
  }
  function findSelect(items,name){const isSel=x=>x.kind==='action'&&x.op==='call'&&/Selected/.test(x.name);const i=items.findIndex(isSel);
    if(i>=0){if(i>0)throw Error('選択の行動が最初にない札は未対応: '+name);if(items[i].name!=='holdSelected')throw Error('未対応の選択: '+items[i].name);return items[i];}
    for(const x of items){if(x.kind!=='effect'||x.phase||x.target||!x.cond)continue;const j=(x.body||[]).findIndex(isSel);if(j<0)continue;
      if(j>0)throw Error('選択の行動が最初にない札は未対応: '+name);if(x.body[j].name!=='holdSelected')throw Error('未対応の選択: '+x.body[j].name);return {target:x.body[j].target,name:x.body[j].name,cond:x.cond};}
    return null;}

  function useCard(list,ty,{free=false,from=null,select=null,noSelect=false}={}){
    const card=types[ty].card;const ctx={used:ty,phase:null,parent:null,inCard:true,select,noSelect};
    let cur=trigger(list,'beforeCardUsed',ctx);
    cur=each(cur,s0=>{
      let c=each(one(s0),s=>{const t=copy(s);if(from==='hand')t.hand=msDel(t.hand,ty);if(!free)t.uses-=1;t.usedTy=ty;return one(t);});
      if(!free&&trackFP){const n=fpCost(ty);if(n)c=each(c,s=>{const t=copy(s);t.fp-=n;return one(t);});}
      if(!free){const dsc=directStaminaCost(card),pc=positiveCost(card);if(trackNC||dsc)c=each(c,s=>{if(trackNC&&pc&&s.nco>0){const t=copy(s);t.nco--;return one(t);}if(trackNC&&pc&&s.nc>0){const t=copy(s);t.nc--;return one(t);}return dsc&&(!trackNC||staminaLoss(card,s.st,s.cm,types[ty].g.typedCost||0)>0)?trigger(one(s),'staminaDecreased',{...ctx,parent:'processCost'}):one(s);});}
      return trigger(c,'cardUsed',ctx,s0);});
    cur=each(cur,s=>{const t=copy(s);t.em=1;t.sTimes=types[ty].g.scoreTimes;return runItems(one(t),card.actions,t,{...ctx,phase:'processCard'});});
    cur=each(cur,s=>{const t=copy(s);const fin=t.usedTy;t.usedTy=-1;t.em=1;t.sTimes=0;
      t.cardsUsed++;t.turnUsed++;const pre={...t};if(card.once)t.rem=msAdd(t.rem,fin);else t.disc=msAdd(t.disc,fin);return trigger(one(t),'afterCardUsed',ctx,pre);});
    if(!free)cur=each(cur,s=>s.uses<1&&!s.done?endTurn(one(s)):one(s));
    return cur;
  }
  function endTurn(list){
    const cur=each(list,s=>{const t=copy(s);t.done=true;return one(t);});
    return trigger(cur,'endOfTurn',{used:-1,phase:null,parent:null});
  }
  function useDrink(s,a){
    const dr=data.drinks.get(a.id);const ctx={used:-1,phase:'drink',parent:null,select:a.select||null,noSelect:!!a.noSelect,inCard:false};
    let cur=each(one(s),x=>{const t=copy(x);t.drinks=t.drinks.slice();t.drinks.splice(t.drinks.indexOf(a.id),1);return one(t);});
    cur=each(cur,x=>runItems(one(x),dr.actions,x,ctx));
    return each(cur,x=>x.uses<1&&!x.done?endTurn(one(x)):one(x));
  }

  function usableCard(s,ty){const c=types[ty].card;const ctx={used:ty,phase:null,parent:null};return c.usable.every(e=>evalExpr(e,s,ctx))&&(!trackFP||s.fp>=fpCost(ty));}
  function fpCost(ty){const card=types[ty].card;let v=0;
    for(const x of card.cost||[])if(x.kind==='action'&&x.lhs==='fullPowerCharge'){if(x.op!=='-='||x.rhs?.t!=='num')throw Error('全力値のコストの書き方が未対応（'+card.name+'）');v+=Math.max(0,x.rhs.v-(card.startGrowth?.typedCost??0));}
    return v;}
  const fpRel=(lhs,ty)=>{const c=types[ty].card;return lhs==='g.typedCost'?(c.cost||[]).some(x=>x.kind==='action'&&x.lhs==='fullPowerCharge'):/"lhs":"fullPowerCharge"/.test(JSON.stringify(c.actions));};
  function fpGrowthHits(lhs,target,ctx){if(target.t==='id'&&target.name==='this'){const o=ctx.recField==='cardEffs'?ctx.src:ctx.used;return o!=null&&o>=0&&fpRel(lhs,o);}
    for(let ty=0;ty<types.length;ty++)if(fpRel(lhs,ty)&&['hand','deck','discard','removed','held','used'].some(l=>matchTarget(target,ty,l,ctx)))return true;return false;}
  const readsFP=e=>/"t":"id","name":"(fullPowerCharge|cumulativeFullPowerCharge)"/.test(JSON.stringify(e));
  const hasEndOfTurn=s=>s.effs.some(r=>defs[r.d].node.phase==='endOfTurn')||s.cardEffs.some(r=>defs[r.d].node.phase==='endOfTurn');
  function choices(s){
    if(s.done)return [];
    const out=[];
    if(s.uses>0){
      msRuns(s.hand,ty=>{if(!usableCard(s,ty))return;const c=types[ty].card;const sel=findSelect(c.actions,c.name);
        if(sel&&(!sel.cond||evalExpr(sel.cond,s,{used:ty,phase:null,parent:null}))){const opts=selectable({...s,hand:msDel(s.hand,ty)},sel.target,{used:ty});
          if(opts.length)for(const x of opts)out.push({type:'card',ty,id:c.id,name:c.name,select:x});else out.push({type:'card',ty,id:c.id,name:c.name,noSelect:true});}
        else out.push({type:'card',ty,id:c.id,name:c.name});});
      const capped=cfg.drinkCap!==null&&cfg.drinkBase-s.drinks.length>=cfg.drinkCap;
      if(!capped){let prev=null;for(const id of s.drinks){if(id===prev)continue;prev=id;const dr=data.drinks.get(id);const sel=findSelect(dr.actions,dr.name);
        if(sel){const opts=selectable(s,sel.target,{used:-1});if(opts.length)for(const x of opts)out.push({type:'drink',id,name:dr.name,select:x});else out.push({type:'drink',id,name:dr.name,noSelect:true});}
        else out.push({type:'drink',id,name:dr.name});}}
    }
    if(hasEndOfTurn(s))out.push({type:'endTurn',name:'ターン終了'});
    return out;
  }

  function transition(s,a){
    let cur;
    if(a.type==='card')cur=useCard(one(s),a.ty,{from:'hand',select:a.select||null,noSelect:!!a.noSelect});
    else if(a.type==='drink')cur=useDrink(s,a);
    else if(a.type==='endTurn')cur=endTurn(one(s));
    else throw Error('未対応の行動: '+a.type);
    for(const b of cur){b.s.key=null;checkSelfGrowth(b.s);}
    cur=merge(cur);
    for(const b of cur){if(b.s.key==null)b.s.key=key(b.s);if(b.s.hand.length>cfg.cap)throw Error('手札上限を超えました');}
    cur.sort((x,y)=>x.s.key<y.s.key?-1:x.s.key>y.s.key?1:x.s.score-y.s.score);
    return {branches:cur.map(b=>({p:b.p,s:b.s}))};
  }

  const root=initial();
  const name=ty=>types[ty].card.name+(types[ty].g.score||types[ty].g.scoreTimes?'〔成長 '+types[ty].g.score+'/'+types[ty].g.scoreTimes+'〕':'');
  return {root,choices,transition,key:s=>s.key,types,cfg,defs,
    describe:s=>({hand:msIds(s.hand).map(name),discard:msIds(s.disc).map(name),removed:msIds(s.rem).map(name),held:s.held.map(name),
      deck:s.deck.map(x=>({p:x.n+'/'+x.d,bag:msIds(x.bag).map(name),mask:[...x.mask].map(ch=>ch===STAR?'*':name(tokTy(ch)))})),
      uses:s.uses,stance:STANCES[s.st],prevStance:s.prev===NONE?'none':STANCES[s.prev],enthusiasm:s.heat,extra:s.extra,factor:s.factor,bonus:s.bonus,score:s.score,done:s.done,
      times:{preservation:s.pT,strength:s.sT,leisure:s.lT,direct:s.dirT},...(trackNC?{nullifyCostCards:s.nc,...(s.cm?{halfCostTurns:s.cm&CM.hc?1:0,doubleCostTurns:s.cm&CM.dc?1:0,costReduction:CM.crOf(s.cm),costIncrease:CM.ciOf(s.cm)}:{})}:{}),...(trackFP?{fullPowerCharge:s.fp,cumulativeFullPowerCharge:s.cfp,fullPowerChargeBuff:s.fpb/100}:{})}),
    inputs:{fullPowerCharge:trackFP,cumulativeFullPowerCharge:cfpRead},
    notes:cfpProvisional?['累計の全力値は入力がないため暫定 '+CFP_PROVISIONAL+' で計算しています（ブースト・ラッシュなど累計を使う札の点は目安）']:[]};
}

export async function loadDataFromDir(dirUrl,settings=null){
  const {readFile}=await import('node:fs/promises');const {loadData,applyOverrides}=await import('./data.mjs?v=1.17.12');
  const r=f=>readFile(new URL(f,dirUrl),'utf8');
  const csv={skillCards:await r('skill_cards.csv'),pDrinks:await r('p_drinks.csv'),pItems:await r('p_items.csv'),customizations:await r('customizations.csv')};
  if(settings){const {applySettings}=await import('./settings.mjs?v=1.17.12');return applySettings(loadData(csv),settings);}
  return applyOverrides(loadData(csv));
}
