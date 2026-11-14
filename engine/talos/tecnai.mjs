import {cardVariant,sharedAbilityItem,LATE_CARD_USED_EFFECTS} from './data.mjs?v=1.17.12';
const LATE_IDS=new Set(LATE_CARD_USED_EFFECTS.flatMap(x=>x.ids));
import {CM,COST_FIELDS,staminaLoss,applyCostField} from './engine.mjs?v=1.17.12';
const gcd=(a,b)=>{while(b){const t=a%b;a=b;b=t;}return a;};
function q(n,d){if(!Number.isSafeInteger(n)||!Number.isSafeInteger(d)||d<=0)throw Error('TALOS_RATIONAL_OVERFLOW');const g=gcd(n,d);return g===1?[n,d]:[n/g,d/g];}
const qmul=(a,b)=>a[0]===1&&a[1]===1?b:b[0]===1&&b[1]===1?a:q(a[0]*b[0],a[1]*b[1]);
const qadd=(a,b)=>{const g=gcd(a[1],b[1]);return q(a[0]*(b[1]/g)+b[0]*(a[1]/g),a[1]/g*b[1]);};
const qdiv=(a,b)=>q(a[0]*b[1],a[1]*b[0]);
const ONE=[1,1];const isOne=p=>p[0]===1&&p[1]===1;
const C=String.fromCharCode,BASE=0x100;
const msOf=ids=>ids.slice().sort((a,b)=>a-b).map(i=>C(BASE+i)).join('');
const msIds=z=>{const a=[];for(let i=0;i<z.length;i++)a.push(z.charCodeAt(i)-BASE);return a;};
function msCount(z,ty){const c=BASE+ty;let n=0;for(let i=0;i<z.length;i++){const x=z.charCodeAt(i);if(x===c)n++;else if(x>c)break;}return n;}
function msAdd(z,ty){const c=BASE+ty;let i=0;while(i<z.length&&z.charCodeAt(i)<=c)i++;return z.slice(0,i)+C(c)+z.slice(i);}
function msDel(z,ty){const i=z.indexOf(C(BASE+ty));if(i<0)throw Error('札がありません');return z.slice(0,i)+z.slice(i+1);}
function msRuns(z,fn){for(let i=0;i<z.length;){const c=z.charCodeAt(i);let j=i+1;while(j<z.length&&z.charCodeAt(j)===c)j++;fn(c-BASE,j-i,i);i=j;}}
const msMerge=(a,b)=>!a?b:!b?a:msOf([...msIds(a),...msIds(b)]);
const ceilS=x=>{const n=Math.round(x);return Math.abs(x-n)<1e-9?n:Math.ceil(x);};

export const STANCES=['preservation','preservation2','leisure','strength','strength2'];
const K1=0,K2=1,NON=2,STR=3,STR2=4,NONE=-1;
const isPres=st=>st===K1||st===K2,isStr=st=>st===STR||st===STR2;
const STANCE_MULT=[0.5,0.25,0,2,2.5];
const stanceOf=name=>{const i=STANCES.indexOf(name);if(i<0)throw Error('未対応の指針: '+name);return i;};
const IN_TURN=new Set(['beforeCardUsed','cardUsed','activeCardUsed','mentalCardUsed','afterCardUsed','afterActiveCardUsed','afterMentalCardUsed','stanceChanged','stanceValueChanged','endOfTurn','staminaDecreased','fullPowerChargeIncreased']);
const condGate=node=>{const b=node.body||[];return b.length&&b.every(x=>x.kind==='effect'&&!x.phase&&x.cond)?b:null;};
const directStaminaCost=card=>(card.cost||[]).some(x=>x.kind==='action'&&x.op==='-='&&x.lhs==='stamina'&&x.rhs?.t==='num'&&x.rhs.v>0);
const positiveCost=card=>(card.cost||[]).some(x=>x.kind==='action'&&(x.lhs==='stamina'||x.lhs==='cost'));
const LATER=new Set(['turn','startOfTurn','beforeStartOfTurn','afterStartOfTurn','everyTurn','startOfStage','afterStartOfStage','prestage','turnSkipped']);
const IGNORED_FIELDS=new Set(['enthusiasmExtensionTurns',
  'genki','fixedGenki','stamina','fixedStamina','fullPowerCharge','halfCostTurns','doubleCostTurns','costReduction','costIncrease','nullifyCostCards','nullifyCostActiveCards','cost','nullifyGenkiTurns','doubleBuffCostTurns']);
const IGNORED_GROWTH=new Set(['g.cost','g.typedCost','g.genki','g.fullPowerCharge','g.halfCostTurns']);
export const CFP_PROVISIONAL=7;
const IGNORED_CALLS=new Set(['setFullPowerChargeBuff','setFullPowerEffectBuff','decreaseFullPowerCharge']);
const CALLS=new Set(['setStance','drawCard','exchangeHand','addCardToDeck','holdSelected','holdSelectedUpto','holdThisCard','moveRandomToHand','removeRandom','useRandomCardFree','addRandomUpgradedSSRCardToHand',
  'setScoreBuff','setEnthusiasmBuff','setEnthusiasmBonus','setStrengthEffectBuff',...IGNORED_CALLS]);
const ASSIGN=new Set(['score','cardUsesRemaining','enthusiasm','enthusiasmMultiplier','effectCounter','scoreTimes']);
const READ_FIELD={prevStance:'prev',preservationTimes:'pT',strengthTimes:'sT',leisureTimes:'lT',stanceChangedTimes:'pTsT',stanceChangedByDirectEffectTimes:'dirT',cardsUsed:'cardsUsed',turnCardsUsed:'turnUsed'};
const LOC={hand:0,deck:1,discard:2,removed:3,held:4,used:5,all:6};

class St{
  constructor(o){this.hand=o.hand;this.disc=o.disc;this.rem=o.rem;this.held=o.held;this.drinks=o.drinks;this.deck=o.deck;this.effs=o.effs;this.ce=o.ce;
    this.uses=o.uses;this.st=o.st;this.prev=o.prev;this.heat=o.heat;this.extra=o.extra;this.factor=o.factor;this.bonus=o.bonus;this.strB=o.strB;
    this.pT=o.pT;this.sT=o.sT;this.lT=o.lT;this.dirT=o.dirT;this.nc=o.nc??0;this.nco=o.nco??0;this.cm=o.cm??0;this.fp=o.fp??0;this.cfp=o.cfp??0;this.fpb=o.fpb??0;this.cardsUsed=o.cardsUsed;this.turnUsed=o.turnUsed;this.done=o.done;this.em=o.em;this.sTimes=o.sTimes;this.usedTy=o.usedTy;
    this.score=o.score;this.key=null;this.hits=o.hits;this.hThis=o.hThis??0;}
}
const clone=s=>new St(s);

export function checkSetupNumbers(setup){
  const bad=(where,v)=>{throw Error('入力の値が数ではありません（'+where+'）：'+(typeof v==='number'?String(v):JSON.stringify(v)));};
  const num=(where,v)=>{if(v===undefined||v===null)return;
if(typeof v!=='number'||!Number.isFinite(v))bad(where,v);};
  const nonneg=(where,v)=>{num(where,v);if(v!==undefined&&v<0)bad(where,v);};
  const lims=(where,a)=>{if(!Array.isArray(a))bad(where+'.limits',a);a.forEach((v,i)=>{if(typeof v!=='number'||!Number.isInteger(v)||v<0)bad(where+'.limits['+i+']',v);});};
  for(const k of ['cap','trial','turnsRemaining','cardUses','enthusiasm','enthusiasmBonus','enthusiasmBuff','scoreBuff','strengthEffectBuff','preservationTimes','strengthTimes','leisureTimes',
    'stanceChangedByDirectEffectTimes','cardsUsed','turnCardsUsed','fullPowerCharge','cumulativeFullPowerCharge','fullPowerChargeBuff','nullifyCostCards','halfCostTurns','doubleCostTurns','costReduction','costIncrease','drinkCap'])num(k,setup[k]);
  const card=(where,x)=>{if(typeof x==='number')return num(where,x);if(!x||typeof x!=='object')return bad(where,x);num(where+'.id',x.id);
    if(x.grown!==undefined&&x.grown!=='full'&&x.grown!==false&&x.grown!==true)bad(where+'.grown',x.grown);
    if(x.limits!=null)lims(where,x.limits);num(where+'.counter',x.counter);
    for(const f of ['g','c11n'])if(x[f]!==undefined){if(!x[f]||typeof x[f]!=='object')bad(where+'.'+f,x[f]);for(const [k,v] of Object.entries(x[f]))num(where+'.'+f+'.'+k,v);}};
  for(const z of ['hand','deck','discard','removed','held'])if(Array.isArray(setup[z]))setup[z].forEach((x,i)=>card(z+'['+i+']',x));
  if(Array.isArray(setup.drinks))setup.drinks.forEach((x,i)=>num('drinks['+i+']',x));
  if(Array.isArray(setup.pItems))setup.pItems.forEach((x,i)=>{if(typeof x==='number')return;if(!x||typeof x!=='object')bad('pItems['+i+']',x);num('pItems['+i+'].id',x.id);num('pItems['+i+'].counter',x.counter);if(x.limits!=null)lims('pItems['+i+']',x.limits);});
  if(Array.isArray(setup.registered))setup.registered.forEach((x,i)=>{if(!x||typeof x!=='object')bad('registered['+i+']',x);num('registered['+i+'].card',x.card);num('registered['+i+'].counter',x.counter);if(x.limits!=null)lims('registered['+i+']',x.limits);});
}
export function createEngine(data,setup,options={}){
  checkSetupNumbers(setup);
  const cfg={cap:setup.cap??5,trial:setup.trial??1,turnsRemaining:setup.turnsRemaining??1,
    drinkCap:Number.isInteger(setup.drinkCap)?setup.drinkCap:null,drinkBase:(setup.drinks||[]).length};

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

  const reads=new Set();
  function scanReads(items){for(const x of items||[]){
    if(x.kind==='action'){if(x.rhs)scanExpr(x.rhs);for(const a of x.args||[])scanExpr(a);if(x.target)scanExpr(x.target);}
    else if(x.kind==='effect'){if(x.phase&&LATER.has(x.phase))continue;if(x.phase==='staminaDecreased')reads.add('nc');if(x.cond)scanExpr(x.cond);if(x.filter)scanExpr(x.filter);if(x.target)scanExpr(x.target);scanReads(x.body);}
    else if(x.kind==='cond')scanExpr(x.cond);}}
  function scanExpr(e){if(!e)return;if(e.t==='id'){if(READ_FIELD[e.name])reads.add(READ_FIELD[e.name]);}
    else if(e.t==='call'){for(const a of e.args)scanExpr(a);if(e.target)scanExpr(e.target);}else if(e.t==='un')scanExpr(e.a);else if(e.t==='bin'){scanExpr(e.a);scanExpr(e.b);}}
  const scannedCards=new Set();
  function scanCard(card){if(scannedCards.has(card))return;scannedCards.add(card);
    for(const e of card.usable)scanExpr(e);scanReads(card.actions);scanReads(card.effects);
    (function f(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'&&x.name==='addCardToDeck'){const id=x.args[0]?.t==='num'?x.args[0].v:Number(x.args[0]?.name);const c=data.cards.get(id);if(c)scanCard(c);}
      else if(x.kind==='effect')f(x.body);}})(card.actions);
    (function f(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'&&x.name==='addRandomUpgradedSSRCardToHand')for(const id of aojiruPool())scanCard(data.cards.get(id));else if(x.kind==='effect')f(x.body);}})(card.actions);}
  let readsFrozen=false,heatMono=false,cfpProvisional=false,cfpRead=false;
  const keep=f=>f==='pT'||f==='sT'?reads.has(f)||reads.has('pTsT'):reads.has(f);

  const types=[],typeIdx=new Map();
  function typeOf(cardId,g={}){const card=data.cards.get(cardId);if(!card)throw Error('未登録の札: '+cardId);
    const gs=g.score||0,gt=g.scoreTimes||0,tc=directStaminaCost(card)?g.typedCost||0:0;const k=cardId+'|'+gs+'|'+gt+(tc?'|'+tc:'');
    let i=typeIdx.get(k);if(i===undefined){validateItems(card.actions,card.name);validateItems(card.effects,card.name);
      if(readsFrozen&&!scannedCards.has(card)){const before=reads.size;scanCard(card);if(reads.size!==before)throw Error('局面の読み込み時に調べていない札が現れました: '+card.name);}
      i=types.length;types.push({card,g:{score:gs,scoreTimes:gt,...(tc?{typedCost:tc}:{})},grown:new Map(),sel:undefined,usable:card.usable.map(compileExpr)});typeIdx.set(k,i);}return i;}
  const grownType=(ty,d)=>{const t=types[ty];const k=d.score+'|'+d.scoreTimes+'|'+(d.typedCost||0);let r=t.grown.get(k);if(r===undefined){r=typeOf(t.card.key??t.card.id,{score:t.g.score+(d.score||0),scoreTimes:t.g.scoreTimes+(d.scoreTimes||0),typedCost:(t.g.typedCost||0)+(d.typedCost||0)});t.grown.set(k,r);}return r;};

  const natsuNodes=new Set();for(const c of data.cards.values()){if(!LATE_IDS.has(c.variantOf??c.id))continue;(function w(items){for(const x of items||[])if(x.kind==='effect'){if(x.phase==='cardUsed')natsuNodes.add(x);w(x.body);}})(c.actions);}
  const defs=[],defIdx=new Map();
  function defOf(node){let i=defIdx.get(node);if(i!==undefined)return i;i=defs.length;const slots=[];
    (function walk(n){if(n.kind!=='effect')return;if(n.mods?.limit!=null){n._slot=slots.length;slots.push(n.mods.limit);}for(const b of n.body||[])if(b.kind==='effect'&&!b.phase)walk(b);})(node);
    const f=node.filter;const ephase=f&&f.t==='id'&&(f.name==='active'||f.name==='mental')&&(node.phase==='cardUsed'||node.phase==='afterCardUsed')?(node.phase==='cardUsed'?f.name+'CardUsed':'after'+(f.name==='active'?'Active':'Mental')+'CardUsed'):node.phase;defs.push({node,slots,phase:node.phase,ephase,natsu:natsuNodes.has(node)});defIdx.set(node,i);validateItems([node],'効果');prepNode(node);return i;}
  const rec=(d,src=-1)=>({d,l:defs[d].slots.slice(),c:0,src});
  const carriedGate=n=>setup.nullifyCostCardsCarriedFirst&&JSON.stringify(n,(k,v)=>k.startsWith('_')?undefined:v).includes('nullifyCostCards')?{...n,carriedGate:true}:n;
  const recKey=r=>r.d+':'+r.l.join('.')+':'+r.c+':'+r.src;
  let T0=Infinity;const srcTok=ty=>ty<T0?String(ty):'~'+typeDesc(ty);
  const sortKey=r=>r.d+':'+r.l.join('.')+':'+r.c+':'+srcTok(r.src);
  const cmpRec=(a,b)=>{const x=sortKey(a),y=sortKey(b);return x<y?-1:x>y?1:0;};
  const typeDesc=ty=>{const t=types[ty];return (t.card.key??t.card.id)+'|'+t.g.score+'|'+t.g.scoreTimes+(t.g.typedCost?'|'+t.g.typedCost:'');};
  const effTab=[],effIdx=new Map();
  function effId(list){let k='';for(const r of list)k+=recKey(r)+';';let id=effIdx.get(k);if(id===undefined){id=effTab.length;effTab.push(Object.freeze(list));effIdx.set(k,id);}return id;}
  const EMPTY=effId([]);
  const effEnd=new Map();
  const hasEnd=id=>{let v=effEnd.get(id);if(v===undefined){v=effTab[id].some(r=>defs[r.d].phase==='endOfTurn');effEnd.set(id,v);}return v;};

  const beliefs=[],beliefIdx=new Map();
  const segKey=g=>C(33+g[0])+g[1];
  const candKey=c=>{let k=c.bag+'\x02';for(let i=0;i<c.segs.length;i++)k+=(i?'\x03':'')+segKey(c.segs[i]);return k;};
  function canonCand(w,bag,segs){
    if(bag.length&&bag.charCodeAt(0)===bag.charCodeAt(bag.length-1)){const ty=bag.charCodeAt(0)-BASE;
      segs=segs.map(([s,f])=>{if(!s)return [0,f];let z=f;for(let i=0;i<s;i++)z=msAdd(z,ty);return [0,z];});bag='';}
    const out=[];
    for(const g of segs){if(!g[0]&&!g[1].length)continue;
      const last=out[out.length-1];
      if(last){
        if(!last[1].length&&!g[1].length){out[out.length-1]=[last[0]+g[0],''];continue;}
        if(!last[0]&&!g[0]&&last[1].charCodeAt(0)===last[1].charCodeAt(last[1].length-1)&&g[1].charCodeAt(0)===g[1].charCodeAt(g[1].length-1)&&last[1].charCodeAt(0)===g[1].charCodeAt(0)){out[out.length-1]=[0,last[1]+g[1]];continue;}
      }
      out.push(g);}
    return {w,bag,segs:out};
  }
  function beliefOf(parts){
    const m=new Map();
    for(const x of parts){if(x.w[0]===0)continue;const c=canonCand(x.w,x.bag,x.segs);const k=candKey(c);const o=m.get(k);if(o)o.w=qadd(o.w,c.w);else m.set(k,c);}
    if(!m.size)throw Error('PROBABILITY');
    let cands=[...m.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    let key;
    if(cands.length===1){key=cands[0][0];cands=[{...cands[0][1],w:ONE}];}
    else{let tot=[0,1];for(const [,c] of cands)tot=qadd(tot,c.w);
      cands=cands.map(([k,c])=>({w:qdiv(c.w,tot),bag:c.bag,segs:c.segs,k}));key='';for(const c of cands)key+=c.w[0]+'/'+c.w[1]+'\x04'+c.k+'\x05';}
    let id=beliefIdx.get(key);if(id!==undefined)return id;
    id=beliefs.length;
    let size=0;const c0=cands[0];size=c0.bag.length;for(const g of c0.segs)size+=g[1].length;
    let content=c0.bag;for(const g of c0.segs)content=msMerge(content,g[1]);
    for(const c of cands){let z=c.bag;for(const g of c.segs)z=msMerge(z,g[1]);if(z!==content)throw Error('山札の中身が候補によって違います');
      let stars=0;for(const g of c.segs)stars+=g[0];if(stars!==c.bag.length)throw Error('山札の★と袋の数が違います');}
    beliefs.push({cands,size,key,content,draw:null,ins:new Map()});beliefIdx.set(key,id);return id;
  }
  const EMPTY_DECK=beliefOf([{w:ONE,bag:'',segs:[]}]);
  const starIdx=new Map();
  const allStars=z=>{let id=starIdx.get(z);if(id===undefined){id=beliefOf([{w:ONE,bag:z,segs:[[z.length,'']]}]);starIdx.set(z,id);}return id;};
  const repSeg=(segs,j,...rep)=>{const a=segs.slice(0,j);a.push(...rep);for(let i=j+1;i<segs.length;i++)a.push(segs[i]);return a;};
  function drawOutcomes(bid){
    const B=beliefs[bid];if(B.draw)return B.draw;
    const obs=new Map();const push=(ty,part)=>{let o=obs.get(ty);if(!o){o=[];obs.set(ty,o);}o.push(part);};
    for(const c of B.cands){const [s0,f0]=c.segs[0],m=s0+f0.length;
      msRuns(f0,(ty,cnt,at)=>push(ty,{w:qmul(c.w,q(cnt,m)),bag:c.bag,segs:repSeg(c.segs,0,[s0,f0.slice(0,at)+f0.slice(at+1)])}));
      if(s0>0){const bn=c.bag.length;msRuns(c.bag,(ty,cnt,at)=>push(ty,{w:qmul(c.w,q(s0*cnt,m*bn)),bag:c.bag.slice(0,at)+c.bag.slice(at+1),segs:repSeg(c.segs,0,[s0-1,f0])}));}}
    const out=[];
    for(const [ty,parts] of obs){let p=parts[0].w;for(let i=1;i<parts.length;i++)p=qadd(p,parts[i].w);out.push({ty,p,deck:beliefOf(parts)});}
    B.draw=out;return out;
  }
  function drawMany(bid,n){
    const B=beliefs[bid];if(!B.many)B.many=new Map();let r=B.many.get(n);if(r)return r;
    let cur=[{drawn:'',p:ONE,deck:bid}];
    for(let i=0;i<n;i++){const m=new Map();
      for(const x of cur)for(const o of drawOutcomes(x.deck)){const drawn=msAdd(x.drawn,o.ty),k=drawn+'|'+o.deck,p=qmul(x.p,o.p);const e=m.get(k);if(e)e.p=qadd(e.p,p);else m.set(k,{drawn,p,deck:o.deck});}
      cur=[...m.values()];}
    B.many.set(n,cur);return cur;
  }
  function insertB(bid,ty){
    const B=beliefs[bid];let r=B.ins.get(ty);if(r!==undefined)return r;
    const X=C(BASE+ty),n=B.size,parts=[];
    for(const c of B.cands){
      if(!n){parts.push({w:c.w,bag:c.bag,segs:[[0,X]]});continue;}
      c.segs.forEach(([s,f],j)=>{
        if(s>0)parts.push({w:qmul(c.w,q(s,n)),bag:c.bag,segs:repSeg(c.segs,j,[s-1,msAdd(f,ty)],[1,''])});
        msRuns(f,(t2,cnt,at)=>parts.push({w:qmul(c.w,q(cnt,n)),bag:c.bag,segs:repSeg(c.segs,j,[s,msAdd(f.slice(0,at)+f.slice(at+1),ty)],[0,C(BASE+t2)])}));});
    }
    r=beliefOf(parts);B.ins.set(ty,r);return r;
  }
  function mapBelief(bid,fn){const B=beliefs[bid];
    return beliefOf(B.cands.map(c=>({w:c.w,bag:msOf(msIds(c.bag).map(fn)),segs:c.segs.map(([s,f])=>[s,msOf(msIds(f).map(fn))])})));}

  function compileExpr(e){
    switch(e.t){
      case 'num':{const v=e.v;return ()=>v;}
      case 'id':return compileId(e.name);
      case 'un':{const a=compileExpr(e.a);return e.op==='!'?(s,c)=>!a(s,c):(s,c)=>-a(s,c);}
      case 'bin':{const a=compileExpr(e.a),b=compileExpr(e.b);
        switch(e.op){case '&':return (s,c)=>a(s,c)&&b(s,c);case '|':return (s,c)=>a(s,c)||b(s,c);
          case '==':return (s,c)=>a(s,c)===b(s,c);case '!=':return (s,c)=>a(s,c)!==b(s,c);case '>=':return (s,c)=>a(s,c)>=b(s,c);case '<=':return (s,c)=>a(s,c)<=b(s,c);
          case '>':return (s,c)=>a(s,c)>b(s,c);case '<':return (s,c)=>a(s,c)<b(s,c);case '+':return (s,c)=>a(s,c)+b(s,c);case '-':return (s,c)=>a(s,c)-b(s,c);
          case '*':return (s,c)=>a(s,c)*b(s,c);case '/':return (s,c)=>a(s,c)/b(s,c);case '%':return (s,c)=>a(s,c)%b(s,c);}
        break;}
      case 'call':{
        if(e.name==='cardHasEffect'){const name=e.args[0].t==='id'?e.args[0].name:String(e.args[0].v);return (s,c)=>c.used>=0&&types[c.used].card.effectNames.has(name);}
        if(e.name==='countCards'){const m=targetFn(e.target);return (s,c)=>{let n=0;forEachCard(s,(ty,loc,cnt)=>{if(m(ty,loc))n+=cnt;});return n;};}
        if(e.name==='effectCounter')return (s,c)=>c.rec?c.rec.c:0;
        throw Error('未対応の関数: '+e.name);}
    }
    throw Error('式');
  }
  function compileId(n){
    switch(n){
      case 'stance':return s=>STANCES[s.st];case 'prevStance':return s=>s.prev===NONE?'none':STANCES[s.prev];
      case 'isStrength':return s=>isStr(s.st);case 'isPreservation':return s=>isPres(s.st)||s.st===NON;case 'isFullPower':return ()=>false;
      case 'preservationTimes':return s=>s.pT;case 'strengthTimes':return s=>s.sT;case 'leisureTimes':return s=>s.lT;case 'fullPowerTimes':return ()=>0;
      case 'stanceChangedTimes':return s=>s.pT+s.sT;case 'stanceChangedByDirectEffectTimes':return s=>s.dirT;
      case 'isDirectEffect':return (s,c)=>c.parent==='processCard';
      case 'parentPhase':return (s,c)=>c.parent??'none';case 'processCost':case 'processCard':return ()=>n;
      case 'effectCounter':return (s,c)=>c.rec?c.rec.c:0;
      case 'cardsUsed':return s=>s.cardsUsed;case 'turnCardsUsed':return s=>s.turnUsed;case 'turnsRemaining':return ()=>cfg.turnsRemaining;
      case 'cardUsesRemaining':return s=>s.uses;case 'enthusiasm':return s=>s.heat;case 'score':return s=>s.score;
      case 'fullPowerCharge':return s=>s.fp;case 'cumulativeFullPowerCharge':return s=>s.cfp;
      case 'usedCardBaseId':return (s,c)=>c.used>=0?types[c.used].card.baseId:-1;case 'usedCardId':return (s,c)=>c.used>=0?types[c.used].card.id:-1;
      case 'none':case 'strength':case 'strength2':case 'preservation':case 'preservation2':case 'leisure':case 'fullPower':return ()=>n;
    }
    throw Error('未対応の変数: '+n);
  }
  const FN=new WeakMap(),TF=new WeakMap();
  const exprFn=e=>{let f=FN.get(e);if(!f){f=compileExpr(e);FN.set(e,f);}return f;};
  function targetFn(e){
    const hit=TF.get(e);if(hit)return hit;
    const cache=[[],[],[],[],[],[],[]];
    const f=(ty,loc)=>{const L=LOC[loc];const a=cache[L];let v=a[ty];if(v===undefined){v=matchTarget(e,ty,loc);a[ty]=v;}return v;};
    TF.set(e,f);return f;
  }
  function matchTarget(e,ty,loc){
    switch(e.t){
      case 'bin':if(e.op==='&')return matchTarget(e.a,ty,loc)&&matchTarget(e.b,ty,loc);if(e.op==='|')return matchTarget(e.a,ty,loc)||matchTarget(e.b,ty,loc);break;
      case 'un':if(e.op==='!')return !matchTarget(e.a,ty,loc);break;
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
    for(let i=0;i<s.held.length;i++)fn(s.held.charCodeAt(i)-BASE,'held',1);
    msRuns(beliefs[s.deck].content,(ty,n)=>fn(ty,'deck',n));
  }
  function needsSnap(items){
    if(items._ns!==undefined)return items._ns;let v=false;
    for(const x of items){
      if(x.kind==='action'){if(x.op==='call'){if(x.args.some(a=>a.t!=='num'&&a.t!=='id'))v=true;}else if(x.rhs.t!=='num'&&!(IGNORED_FIELDS.has(x.lhs)||IGNORED_GROWTH.has(x.lhs)))v=true;}
      else if(x.kind==='effect'&&!x.phase){if(x.cond)v=true;else if(!x.target&&needsSnap(x.body))v=true;}
      if(v)break;}
    items._ns=v;return v;
  }
  function prepNode(n){if(n.cond)exprFn(n.cond);if(n.filter)targetFn(n.filter);}

  const ch=v=>Number.isInteger(v)&&v>=-1&&v<60000?C(v+33):'\x06'+v+'\x06';
  const sm=v=>v>=-1&&v<60000&&(v|0)===v;
  const K={prev:false,pT:false,sT:false,lT:false,dirT:false,cardsUsed:false,turnUsed:false,nc:false,fp:false};
  function key(t){
    let k=t.hand+'\x01'+t.disc+'\x01'+t.rem+'\x01'+t.held+'\x01'+t.drinks+'\x01';
    const a=t.deck,b=t.effs,c=t.ce,u=t.uses,h=t.heat,ex=t.extra,fa=t.factor,bo=t.bonus,sb=t.strB,em=t.em;
    if(a<60000&&b<60000&&c<60000&&sm(u)&&sm(h)&&sm(ex)&&sm(fa)&&sm(bo)&&sm(sb)&&sm(t.sTimes)&&em===1)
      k+=C(a+33,b+33,c+33,u+33,t.st+33,h+33,ex+33,fa+33,bo+33,sb+33,t.done+33,t.sTimes+33,t.usedTy+33);
    else k+=ch(a)+ch(b)+ch(c)+ch(u)+ch(t.st)+ch(h)+ch(ex)+ch(fa)+ch(bo)+ch(sb)+ch(t.done)+ch(t.sTimes)+ch(t.usedTy)+'\x07'+ch(em);
    if(K.prev)k+=ch(t.prev);if(K.pT)k+=ch(t.pT);if(K.sT)k+=ch(t.sT);if(K.lT)k+=ch(t.lT);if(K.dirT)k+=ch(t.dirT);if(K.cardsUsed)k+=ch(t.cardsUsed);if(K.turnUsed)k+=ch(t.turnUsed);if(K.nc)k+='\x08'+ch(t.nc)+(t.nco?'\x09'+ch(t.nco):'')+(t.cm?'\x0c'+ch(t.cm):'');if(K.fp)k+='\x0b'+ch(t.fp)+ch(t.cfp)+ch(t.fpb);
    return k;
  }

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
  const ceInfo=new Map();
  function selfGrowthGroups(id){
    let g=ceInfo.get(id);if(g)return g;g=[];const list=effTab[id];const seen=new Map(),cnt=new Map();
    for(const r of list){if(r.src<0||!selfGrowDef(r.d))continue;const k=r.d+'|'+r.src,v=r.l.join('.')+':'+r.c;const o=seen.get(k);
      if(o!==undefined&&o!==v)throw Error('SELF_GROWTH_AMBIGUOUS：同じ種類の札「'+types[r.src].card.name+'」の自己成長の記録の状態が札どうしで違います（未対応。DESIGN.md 14章）');
      seen.set(k,v);if(!deadRec(r))cnt.set(k,{src:r.src,n:(cnt.get(k)?.n||0)+1});}
    g=[...cnt.values()];ceInfo.set(id,g);return g;
  }
  function checkSelfGrowth(t){
    const gs=selfGrowthGroups(t.ce);if(!gs.length)return;
    for(const {src,n} of gs){let h=0;for(let i=0;i<t.held.length;i++)if(t.held.charCodeAt(i)-BASE===src)h++;
      const phys=msCount(t.hand,src)+msCount(t.disc,src)+msCount(t.rem,src)+h+msCount(beliefs[t.deck].content,src)+(t.usedTy===src?1:0);
      if(phys!==n)throw Error('SELF_GROWTH_AMBIGUOUS：同じ種類の札「'+types[src].card.name+'」'+phys+'枚のうち、自己成長がまだ発動しうるのは '+n+'枚分です。どの札が成長するか決まりません（使い切った札・効果を持たない札と混ざっている。未対応。DESIGN.md 14章）');}
  }
  const deadRec=r=>{const n=defs[r.d].node;return n._slot!==undefined&&r.l[n._slot]<1&&n.phase!=='endOfTurn';};
  function initial(){
    const piles={};for(const k of ['hand','deck','discard','removed','held'])piles[k]=(setup[k]||[]).map(resolveCard);
    const tys=k=>piles[k].map(x=>x.ty);
    const drinks=(setup.drinks||[]).slice().sort((a,b)=>a-b);
    for(const d of drinks){const dr=data.drinks.get(d);if(!dr)throw Error('未登録のドリンク: '+d);validateItems(dr.actions,dr.name);}
    const effs=[],cardEffs=[];
    for(const x0 of setup.pItems||[]){const x=specOf(x0);const it=data.items.get(x.id);if(!it)throw Error('未登録の P アイテム: '+x.id);
      let li=0;
      for(const e of it.effects){if(e.kind!=='effect'||!e.phase)throw Error('P アイテムの形が未対応: '+it.name);
        if(IN_TURN.has(e.phase)){const R=rec(defOf(e));defs[R.d].early=true;defs[R.d].label??=it.name;R.c=x.counter??0;const n=R.l.length;applyLimits(R,x.limits?x.limits.slice(li,li+n):null,false,it.name);li+=n;effs.push(R);}}
      if(x.limits&&li!==x.limits.length)throw Error('残り回数の数が違います（'+it.name+'）：'+li+'個');}
    {const seen=new Set();for(const k of ['hand','deck','discard','removed','held'])for(const x of piles[k]){const c=types[x.ty].card;for(const a of c.abilities||[]){
      const iid=sharedAbilityItem(data,a,c.baseId);if(iid===null||seen.has(iid))continue;seen.add(iid);const it=data.items.get(iid);const used=setup.abilityUses?.[a]?.[c.baseId]??0;
      for(const e of it.effects){if(!IN_TURN.has(e.phase))continue;const R=rec(defOf(e));defs[R.d].early=true;defs[R.d].label??=it.name;R.l=R.l.map(v=>Math.max(0,v-used));effs.push(R);}}}}
    for(const r of setup.registered||[]){const card=data.cards.get(r.card);if(!card)throw Error('未登録の札: '+r.card);
      const nodes=[];(function f(items){for(const x of items)if(x.kind==='effect'){if(x.phase)nodes.push(x);else f(x.body);}})(card.actions);
      const n0=nodes[r.index??0];if(!n0)throw Error('登録する効果がありません: '+card.name);const n=carriedGate(n0);const R=rec(defOf(n));defs[R.d].label??=card.name;R.c=r.counter??0;applyLimits(R,r.limits,false,card.name);effs.push(R);}
    for(const k of Object.keys(piles))for(const x of piles[k]){const card=types[x.ty].card;
      const es=inTurnEffects(card);let li=0;
      for(const e of es){const R=rec(defOf(e),x.ty);const n=R.l.length;applyLimits(R,x.limits?x.limits.slice(li,li+n):null,x.full,card.name);li+=n;if(!deadRec(R))cardEffs.push(R);}
      if(x.limits&&li!==x.limits.length)throw Error('残り回数の数が違います（'+card.name+'）：'+li+'個');}
    T0=types.length;cardEffs.sort(cmpRec);
    for(const ty of types.keys())scanCard(types[ty].card);
    for(const d of drinks){const dr=data.drinks.get(d);scanReads(dr.actions);(function f(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'){
      if(x.name==='addCardToDeck'){const id=x.args[0]?.t==='num'?x.args[0].v:Number(x.args[0]?.name);const c=data.cards.get(id);if(c)scanCard(c);}
      if(x.name==='addRandomUpgradedSSRCardToHand')for(const id of aojiruPool())scanCard(data.cards.get(id));}else if(x.kind==='effect')f(x.body);}})(dr.actions);}
    for(const r of [...effs,...cardEffs])scanReads([defs[r.d].node]);
    if(options.keepAllFields)for(const f of Object.values(READ_FIELD))reads.add(f);
    {const RE=/"t":"id","name":"(fullPowerCharge|cumulativeFullPowerCharge)"|"name":"decreaseFullPowerCharge"|"phase":"fullPowerChargeIncreased"/;
      const js=o=>JSON.stringify(o,(k,v)=>k.startsWith('_')?undefined:v);
      const costFP=c=>(c.cost||[]).some(x=>x.kind==='action'&&x.lhs==='fullPowerCharge');
      let fp=false;for(const c of scannedCards)if(costFP(c)||RE.test(js([c.usable,c.actions,c.effects]))){fp=true;break;}
      if(!fp)for(const d of drinks)if(RE.test(js(data.drinks.get(d).actions))){fp=true;break;}
      if(!fp)for(const r of [...effs,...cardEffs])if(RE.test(js(defs[r.d].node))){fp=true;break;}
      if(fp||options.keepAllFields)reads.add('fp');
      cfpRead=fp&&[...scannedCards].some(c=>js([c.actions,c.effects]).includes('cumulativeFullPowerCharge'));cfpProvisional=cfpRead&&setup.cumulativeFullPowerCharge==null;}
    readsFrozen=true;for(const f of Object.keys(K))K[f]=keep(f);
    heatMono=(()=>{let ok=true;const bad=e=>{if(!e||typeof e!=='object')return;if(Array.isArray(e)){for(const x of e)bad(x);return;}
        if(e.t==='id'&&(e.name==='enthusiasm'||e.name==='enthusiasmMultiplier'))ok=false;for(const v of Object.values(e))if(v&&typeof v==='object')bad(v);};
      const items=list=>{for(const x of list||[]){if(x.kind==='action'){if(x.rhs)bad(x.rhs);for(const a of x.args||[])bad(a);if(x.target)bad(x.target);
          if(x.op==='call'&&(x.name==='setScoreBuff'||x.name==='setStrengthEffectBuff')&&!(x.args[0]?.t==='num'&&x.args[0].v>=0))ok=false;
          if(x.lhs==='enthusiasmMultiplier'&&!(x.rhs?.t==='num'&&x.rhs.v>=0))ok=false;}
        else if(x.kind==='effect'){if(x.cond)bad(x.cond);if(x.filter)bad(x.filter);if(x.target)bad(x.target);items(x.body);}else if(x.kind==='cond')bad(x.cond);}};
      for(const c of scannedCards){items(c.actions);items(c.effects);for(const u of c.usable||[])bad(u);}
      for(const d of drinks)items(data.drinks.get(d).actions);for(const r of [...effs,...cardEffs])items([defs[r.d].node]);
      if((setup.scoreBuff??0)<0||(setup.strengthEffectBuff??0)<0)ok=false;return ok;})();
    const t=new St({hand:msOf(tys('hand')),disc:msOf(tys('discard')),rem:msOf(tys('removed')),held:tys('held').map(ty=>C(BASE+ty)).join(''),
      drinks:drinks.map(d=>C(BASE+d)).join(''),deck:allStars(msOf(tys('deck'))),effs:effId(effs),ce:effId(cardEffs),
      uses:setup.cardUses??1,st:stanceOf(setup.stance||'preservation'),prev:setup.prevStance&&setup.prevStance!=='none'?stanceOf(setup.prevStance):NONE,
      heat:setup.enthusiasm??0,extra:setup.enthusiasmBonus??0,factor:Math.round((setup.enthusiasmBuff??1)*100),bonus:Math.round((setup.scoreBuff??0)*100),strB:Math.round((setup.strengthEffectBuff??0)*100),
      pT:setup.preservationTimes??0,sT:setup.strengthTimes??0,lT:setup.leisureTimes??0,dirT:setup.stanceChangedByDirectEffectTimes??0,cardsUsed:setup.cardsUsed??0,turnUsed:setup.turnCardsUsed??0,fp:K.fp?setup.fullPowerCharge??0:0,cfp:K.fp?setup.cumulativeFullPowerCharge??CFP_PROVISIONAL:0,fpb:K.fp?Math.round((setup.fullPowerChargeBuff??0)*100):0,nc:setup.nullifyCostCardsCarriedFirst&&K.nc?0:(setup.nullifyCostCards??0),nco:setup.nullifyCostCardsCarriedFirst&&K.nc?(setup.nullifyCostCards??0):0,cm:K.nc?CM.make((setup.halfCostTurns??0)>0,(setup.doubleCostTurns??0)>0,setup.costReduction??0,setup.costIncrease??0):0,
      done:0,em:1,sTimes:0,usedTy:-1,score:0});
    checkSelfGrowth(t);t.key=key(t);return t;
  }

  function drawOne(s){
    if(s.hand.length>=cfg.cap)return [{p:ONE,s}];
    if(!beliefs[s.deck].size){if(!s.disc.length)return [{p:ONE,s}];s.deck=allStars(s.disc);s.disc='';}
    const outs=drawOutcomes(s.deck);
    if(outs.length===1){const o=outs[0];s.hand=msAdd(s.hand,o.ty);s.deck=o.deck;return [{p:o.p,s}];}
    const out=new Array(outs.length);
    for(let i=0;i<outs.length;i++){const o=outs[i];const t=i===outs.length-1?s:clone(s);t.hand=msAdd(t.hand,o.ty);t.deck=o.deck;out[i]={p:o.p,s:t};}
    return out;
  }
  function pickRandom(s,target,piles,fn){
    const m=targetFn(target);
    const vis=[];
    if(piles.includes('hand'))msRuns(s.hand,(ty,n)=>{if(m(ty,'hand'))vis.push(['hand',ty,n]);});
    if(piles.includes('discard'))msRuns(s.disc,(ty,n)=>{if(m(ty,'discard'))vis.push(['discard',ty,n]);});
    if(piles.includes('removed'))msRuns(s.rem,(ty,n)=>{if(m(ty,'removed'))vis.push(['removed',ty,n]);});
    let visN=0;for(const v of vis)visN+=v[2];
    const groups=new Map(),none=[];
    const add=(k,from,ty,part)=>{let g=groups.get(k);if(!g){g={from,ty,parts:[]};groups.set(k,g);}g.parts.push(part);};
    const inDeck=piles.includes('deck');
    for(const c of beliefs[s.deck].cands){
      const bagHits=[],segHits=[];
      if(inDeck){msRuns(c.bag,(ty,n,at)=>{if(m(ty,'deck'))bagHits.push([ty,n,at]);});
        c.segs.forEach(([,f],j)=>msRuns(f,(ty,n,at)=>{if(m(ty,'deck'))segHits.push([ty,n,j,at]);}));}
      let deckN=0;for(const h of bagHits)deckN+=h[1];for(const h of segHits)deckN+=h[1];
      const tot=visN+deckN;
      if(!tot){none.push({w:c.w,bag:c.bag,segs:c.segs});continue;}
      for(const [from,ty,n] of vis)add(from+':'+ty,from,ty,{w:qmul(c.w,q(n,tot)),bag:c.bag,segs:c.segs});
      let stars=0;for(const g of c.segs)stars+=g[0];
      for(const [ty,n,at] of bagHits){const bag=c.bag.slice(0,at)+c.bag.slice(at+1);
        c.segs.forEach(([sj,fj],j)=>{if(sj>0)add('deck:'+ty,'deck',ty,{w:qmul(c.w,q(n*sj,tot*stars)),bag,segs:repSeg(c.segs,j,[sj-1,fj])});});}
      for(const [ty,n,j,at] of segHits){const [sj,fj]=c.segs[j];add('deck:'+ty,'deck',ty,{w:qmul(c.w,q(n,tot)),bag:c.bag,segs:repSeg(c.segs,j,[sj,fj.slice(0,at)+fj.slice(at+1)])});}
    }
    const out=[];
    for(const g of groups.values()){let p=[0,1];for(const x of g.parts)p=qadd(p,x.w);if(p[0]===0)continue;
      const t=clone(s);t.deck=beliefOf(g.parts);
      if(g.from==='hand')t.hand=msDel(t.hand,g.ty);else if(g.from==='discard')t.disc=msDel(t.disc,g.ty);else if(g.from==='removed')t.rem=msDel(t.rem,g.ty);
      for(const b of fn(t,g.ty))out.push({p:qmul(p,b.p),s:b.s});}
    if(none.length){let p=[0,1];for(const x of none)p=qadd(p,x.w);if(p[0]>0){const t=clone(s);t.deck=beliefOf(none);out.push({p,s:t});}}
    return out;
  }

  function each(list,fn){
    if(list.length===1&&isOne(list[0].p))return fn(list[0].s);
    const out=[];
    for(const b of list){const r=fn(b.s);for(const c of r)out.push(isOne(c.p)?{p:b.p,s:c.s}:{p:qmul(b.p,c.p),s:c.s});}
    return out;
  }
  const sameRest=(a,b)=>a.score===b.score&&a.deck===b.deck&&
    a.effs===b.effs&&a.ce===b.ce&&a.uses===b.uses&&a.st===b.st&&a.heat===b.heat&&a.extra===b.extra&&a.factor===b.factor&&
    a.bonus===b.bonus&&a.strB===b.strB&&a.done===b.done&&a.sTimes===b.sTimes&&a.usedTy===b.usedTy&&a.em===b.em&&a.drinks===b.drinks&&
    (!K.prev||a.prev===b.prev)&&(!K.pT||a.pT===b.pT)&&(!K.sT||a.sT===b.sT)&&(!K.lT||a.lT===b.lT)&&(!K.dirT||a.dirT===b.dirT)&&(!K.cardsUsed||a.cardsUsed===b.cardsUsed)&&(!K.nc||(a.nc===b.nc&&a.nco===b.nco&&a.cm===b.cm))&&(!K.fp||(a.fp===b.fp&&a.cfp===b.cfp&&a.fpb===b.fpb))&&(!K.turnUsed||a.turnUsed===b.turnUsed);
  function merge(l){if(l.length<2)return l;const m=new Map(),out=[];
    for(const c of l){const zk=c.s.hand+'\x01'+c.s.disc+'\x01'+c.s.rem+'\x01'+c.s.held;let g=m.get(zk);
      if(!g){g=[];m.set(zk,g);}let o=null;for(const x of g)if(sameRest(x.s,c.s)){o=x;break;}
      if(o)o.p=qadd(o.p,c.p);else{const e={p:c.p,s:c.s};g.push(e);out.push(e);}}
    return out;}
  const zonesKey=t=>t.hand+'\x01'+t.deck+'\x01'+t.disc+'\x01'+t.rem+'\x01'+t.held;
  function mergeZones(l){if(l.length<2)return l;const m=new Map();for(const c of l){const k=zonesKey(c.s);const o=m.get(k);if(o)o.p=qadd(o.p,c.p);else m.set(k,{p:c.p,s:c.s});}return [...m.values()];}
  const one=s=>[{p:ONE,s}];

  let TRACE=false;const TRACE_VIA=[];
  const traceInfo=(t,ctx)=>{const o=traceInfo0(t,ctx);if(TRACE_VIA.length)o.via=TRACE_VIA[0];return o;};
  const traceInfo0=(t,ctx)=>{if(!ctx)return {};if(ctx.recField){const r=effTab[t[ctx.recField]]?.[ctx.recIdx];
      const src=ctx.recField==='ce'?(ctx.src>=0?types[ctx.src].card.name:null):(r?defs[r.d]?.label??'登録した効果':null);return {src,phase:ctx.phase};}
    if(ctx.phase==='drink')return {src:ctx.drinkName??'ドリンク',phase:'drink'};
    return {src:ctx.used>=0?types[ctx.used].card.name:null,phase:ctx.phase&&ctx.phase!=='processCard'?ctx.phase:'card'};};
  function addEnthusiasm(t,v,ctx){const d=Math.ceil(((v+t.extra)*t.factor)/100-1e-9);t.heat+=d;if(TRACE)t.hits=[...(t.hits||[]),{heat:d,...traceInfo(t,ctx)}];}
  function addScore(t,v,ctx){
    if(!(v>0))return;
    const a=ceilS(v+t.heat*t.em);
    const mult=STANCE_MULT[t.st]+(isStr(t.st)?t.strB/100:0);
    const b=ceilS(a*mult*(1+t.bonus/100));
    const g=ceilS(b*cfg.trial);t.score+=g;if(TRACE)t.hits=[...(t.hits||[]),{score:g,...traceInfo(t,ctx)}];
  }

  function setStance(list,target,ctx){
    return each(list,t=>{
      const prev=t.st;
      if(prev===NON&&isPres(target))return one(t);
      const next=isPres(target)&&isPres(prev)?K2:isStr(target)&&isStr(prev)?STR2:target;
      t.prev=prev;t.st=next;
      const pctx={used:ctx.used,phase:ctx.phase,parent:ctx.phase,inCard:ctx.inCard,select:ctx.select};
      const change=next!==prev&&!(prev===K1&&next===K2)&&!(prev===STR&&next===STR2);
      if(!change)return next!==prev?trigger(one(t),'stanceValueChanged',pctx):one(t);
      if((prev===K1||prev===K2||prev===NON)&&next!==NON){t.uses+=1;addEnthusiasm(t,prev===K1?5:prev===K2?8:10,ctx?{...ctx,phase:'stanceChange'}:null);}
      const cnt=list=>each(list,u=>{if(isPres(next))u.pT++;else if(isStr(next))u.sT++;else if(next===NON)u.lT++;if(ctx.phase==='processCard')u.dirT++;return one(u);});
      return trigger(cnt(trigger(one(t),'stanceChanged',pctx)),'stanceValueChanged',pctx);
    });
  }

  const PH_CACHE=new Map();
  function phaseIdx(listId,phases,pk){const k=listId+'|'+pk;let v=PH_CACHE.get(k);if(v===undefined){v=[];effTab[listId].forEach((r,i)=>{if(phases.includes(defs[r.d].phase))v.push(i);});PH_CACHE.set(k,v);}return v;}
  function trigger(list,phase,ctx,pre=null){
    if(TRACE){TRACE_VIA.push(phase);try{return trigger0(list,phase,ctx,pre);}finally{TRACE_VIA.pop();}}
    return trigger0(list,phase,ctx,pre);}
  function trigger0(list,phase,ctx,pre=null){
    if(list.length===1&&list[0].s.effs===EMPTY&&list[0].s.ce===EMPTY)return list;
    const phases=[phase];const ty=ctx.used>=0?types[ctx.used].card.type:null;
    if(phase==='cardUsed'&&ty==='active')phases.push('activeCardUsed');if(phase==='cardUsed'&&ty==='mental')phases.push('mentalCardUsed');
    if(phase==='afterCardUsed'&&ty==='active')phases.push('afterActiveCardUsed');if(phase==='afterCardUsed'&&ty==='mental')phases.push('afterMentalCardUsed');
    const pk=phases.join(',');
    return each(list,s=>{
      if(s.effs===EMPTY&&s.ce===EMPTY)return one(s);
      let plan=[];const ord=[];
      for(const i of phaseIdx(s.effs,phases,pk)){const D=defs[effTab[s.effs][i].d];if(filterOk(D.node,ctx))ord.push([0,i,D.natsu?phases.length*3+2:phases.indexOf(D.ephase)*3+(D.early?0:2)]);}
      for(const i of phaseIdx(s.ce,phases,pk)){const D=defs[effTab[s.ce][i].d];if(filterOk(D.node,ctx))ord.push([1,i,D.natsu?phases.length*3+2:phases.indexOf(D.ephase)*3+1]);}
      if(ord.length>1)ord.sort((a,b)=>a[2]-b[2]);for(const [f,i] of ord)plan.push(f,i);
      if(!plan.length)return one(s);
      const snap=pre??(plan.length>2?clone(s):null);
      let cur=one(s);const em0=s.em,st0=s.sTimes;
      for(let j=0;j<plan.length;j+=2){const field=plan[j]?'ce':'effs',i=plan[j+1];
        cur=each(cur,t=>{const r=effTab[t[field]][i];const node=defs[r.d].node;t.em=1;t.sTimes=0;
          return runEffectNode(one(t),node,snap??t,{used:ctx.used,phase,parent:ctx.parent,inCard:false,select:ctx.select,recField:field,recIdx:i,src:r.src});});}
      if(em0!==1||st0!==0)cur=each(cur,t=>{t.em=em0;t.sTimes=st0;return one(t);});else cur=each(cur,t=>{t.em=1;t.sTimes=0;return one(t);});
      if(plan.includes(1))cur=each(cur,t=>{const a=effTab[t.ce];for(let k=1;k<a.length;k++)if(cmpRec(a[k-1],a[k])>0){t.ce=effId(a.slice().sort(cmpRec));break;}return one(t);});
      return cur;
    });
  }
  function filterOk(node,ctx){if(!node.filter)return true;if(ctx.used<0)return false;return targetFn(node.filter)(ctx.used,'used');}
  function runEffectNode(list,node,snap,ctx){
    return each(list,s=>{
      const r=ctx.recField?effTab[s[ctx.recField]][ctx.recIdx]:null;
      if(node._slot!==undefined&&r&&r.l[node._slot]<1)return one(s);
      if(node.carriedGate&&snap.nco>0)return one(s);
      let sz=snap;if(snap!==s&&(node.cond||node._slot!==undefined)&&!(snap.hand===s.hand&&snap.disc===s.disc&&snap.rem===s.rem&&snap.held===s.held&&snap.deck===s.deck)){sz=clone(snap);sz.hand=s.hand;sz.disc=s.disc;sz.rem=s.rem;sz.held=s.held;sz.deck=s.deck;}
      if(node.cond){const sr=ctx.recField?effTab[snap[ctx.recField]][ctx.recIdx]:null;
        if(!exprFn(node.cond)(sz,{used:ctx.used,phase:ctx.phase,parent:ctx.parent,rec:sr}))return one(s);}
      if(options.limitOnCond!==false&&node._slot!==undefined&&r){const g=condGate(node);if(g){const sr=ctx.recField?effTab[snap[ctx.recField]][ctx.recIdx]:null;const c2={used:ctx.used,phase:ctx.phase,parent:ctx.parent,rec:sr};
        if(!g.some(x=>exprFn(x.cond)(sz,c2)))return one(s);}}
      const sn=s===snap&&!node.target&&needsSnap(node.body)?clone(snap):snap;
      if(node._slot!==undefined&&r){const l=r.l.slice();l[node._slot]--;setRec(s,ctx,{d:r.d,l,c:r.c,src:r.src});}
      if(node.target)return growTargets(one(s),node.target,node.body,ctx);
      return runItems(one(s),node.body,sn,ctx);
    });
  }
  function setRec(t,ctx,nr){const arr=effTab[t[ctx.recField]].slice();arr[ctx.recIdx]=nr;t[ctx.recField]=effId(arr);return t;}
  function runItems(list,items,snap,ctx){
    let cur=list;
    for(const x of items){
      if(x.kind==='action')cur=action(cur,x,snap,ctx);
      else if(x.kind==='effect'){
        if(x.phase){if(IN_TURN.has(x.phase)){const d=defOf(x);cur=each(cur,t=>{t.effs=effId([...effTab[t.effs],rec(d)]);return one(t);});}continue;}
        cur=runEffectNode(cur,x,snap,ctx);
      }
    }
    return cur;
  }

  function action(list,a,snap,ctx){
    if(a.op==='call'){
      const arg=i=>a.args[i]===undefined?undefined:a.args[i].t==='id'?a.args[i].name:exprFn(a.args[i])(snap,ctx);
      switch(a.name){
        case 'setStance':return setStance(list,stanceOf(arg(0)),ctx);
        case 'drawCard':{let cur=list;const n=a.args.length?arg(0):1;
          if(n>1&&cur.length===1){const s0=cur[0].s;if(s0.hand.length+n<=cfg.cap&&beliefs[s0.deck].size>=n){const outs=drawMany(s0.deck,n),p0=cur[0].p;
            return outs.map((o,i)=>{const t=i===outs.length-1?s0:clone(s0);t.hand=msMerge(t.hand,o.drawn);t.deck=o.deck;return {p:qmul(p0,o.p),s:t};});}}
          for(let i=0;i<n;i++){if(cur.length===1)cur=each(cur,drawOne);else cur=merge(each(cur,drawOne));}return cur;}
        case 'exchangeHand':return each(list,t=>{const n=t.hand.length;t.disc=msMerge(t.disc,t.hand);t.hand='';let cur=one(t);for(let i=0;i<n;i++)cur=cur.length===1?each(cur,drawOne):mergeZones(each(cur,drawOne));return cur;});
        case 'addCardToDeck':{const ty=typeOf(arg(0));return each(list,t=>{t.deck=insertB(t.deck,ty);return one(t);});}
        case 'holdSelected':case 'holdSelectedUpto':return each(list,s=>holdSelected(s,ctx));
        case 'holdThisCard':return each(list,t=>{if(ctx.inCard&&t.usedTy>=0)t.hThis=1;return one(t);});
        case 'moveRandomToHand':return merge(each(list,s=>s.hand.length>=cfg.cap?one(s):pickRandom(s,a.target,['deck','discard','removed'],(t,ty)=>{t.hand=msAdd(t.hand,ty);return one(t);})));
        case 'removeRandom':return merge(each(list,s=>pickRandom(s,a.target,['deck','discard','hand'],(t,ty)=>{t.rem=msAdd(t.rem,ty);return one(t);})));
        case 'useRandomCardFree':return merge(each(list,s=>pickRandom(s,a.target,['deck','discard','removed','hand'],(t,ty)=>useCard(one(t),ty,{free:true}))));
        case 'addRandomUpgradedSSRCardToHand':return merge(each(list,s=>{if(s.hand.length>=cfg.cap)return one(s);const pool=aojiruPool();const n=pool.length;
          return pool.map((id,i)=>{const t=i===n-1?s:clone(s);t.hand=msAdd(t.hand,typeOf(id));return {p:[1,n],s:t};});}));
        case 'setScoreBuff':{const v=arg(0);return each(list,t=>{t.bonus+=Math.round(v*100);return one(t);});}
        case 'setEnthusiasmBuff':{const v=arg(0);return each(list,t=>{t.factor+=Math.round(v*100);return one(t);});}
        case 'setEnthusiasmBonus':{const v=arg(0);return each(list,t=>{t.extra+=v;return one(t);});}
        case 'setStrengthEffectBuff':{const v=arg(0);return each(list,t=>{t.strB+=Math.round(v*100);return one(t);});}
        case 'setFullPowerChargeBuff':{if(!K.fp)return list;const v=arg(0);return each(list,t=>{t.fpb+=Math.round(v*100);return one(t);});}
        case 'decreaseFullPowerCharge':{if(!K.fp)return list;const v=arg(0);return each(list,t=>{t.fp=Math.max(0,t.fp-v);return one(t);});}
      }
      if(IGNORED_CALLS.has(a.name))return list;
      throw Error('未対応の効果: '+a.name);
    }
    const L=a.lhs;
    if(COST_FIELDS.has(L)&&K.nc){const v=exprFn(a.rhs)(snap,ctx);return each(list,t=>{t.cm=applyCostField(t.cm,L,a.op,v);return one(t);});}
    if(L==='nullifyCostCards'&&K.nc){if(a.op!=='+=')throw Error('nullifyCostCards の '+a.op+' は未対応');const v=exprFn(a.rhs)(snap,ctx);return each(list,t=>{t.nc+=v;return one(t);});}
    if(L==='fullPowerCharge'&&K.fp){const v=exprFn(a.rhs)(snap,ctx);
      return each(list,t=>{let x=v;
        if(a.op==='+='){if(ctx.inCard&&ctx.phase==='processCard'&&t.usedTy>=0)x+=types[t.usedTy].card.startGrowth?.fullPowerCharge??0;
          if(x>0){x=x*(100+t.fpb)/100;t.cfp+=x;t.fp+=x;return ctx.phase==='processCard'||ctx.phase==='processCost'?trigger(one(t),'fullPowerChargeIncreased',{...ctx,parent:ctx.phase}):one(t);}
          t.fp+=x;return one(t);}
        if(a.op==='-='){t.fp-=x;return one(t);}
        throw Error('fullPowerCharge の '+a.op+' は未対応');});}
    if(IGNORED_FIELDS.has(L)||IGNORED_GROWTH.has(L))return list;
    const cur=K.fp&&readsFP(a.rhs);const v=cur?0:exprFn(a.rhs)(snap,ctx);
    return each(list,t=>{const v2=cur?exprFn(a.rhs)(t,ctx):v;return assign(t,v2);});
    function assign(t,v){
      switch(L){
        case 'score':{
          if(a.op!=='+=')throw Error('score の '+a.op+' は未対応');
          const g=ctx.inCard&&t.usedTy>=0?types[t.usedTy].g.score:0;
          addScore(t,v+g,ctx);
          if(t.sTimes>0){const n=t.sTimes;t.sTimes=0;for(let i=0;i<n;i++)addScore(t,v+g,ctx);}
          return one(t);}
        case 'cardUsesRemaining':if(a.op==='+=')t.uses+=v;else if(a.op==='-=')t.uses-=v;else throw Error('cardUsesRemaining '+a.op);return one(t);
        case 'enthusiasm':if(a.op!=='+=')throw Error('enthusiasm '+a.op);addEnthusiasm(t,v,ctx);return one(t);
        case 'enthusiasmMultiplier':if(a.op!=='=')throw Error('enthusiasmMultiplier '+a.op);t.em=v;return one(t);
        case 'scoreTimes':if(a.op==='+=')t.sTimes+=v;else if(a.op==='=')t.sTimes=v;else throw Error('scoreTimes '+a.op);return one(t);
        case 'effectCounter':{if(!ctx.recField)throw Error('effectCounter は登録された効果の中だけで使えます');
          const r=effTab[t[ctx.recField]][ctx.recIdx];setRec(t,ctx,{d:r.d,l:r.l,c:a.op==='+='?r.c+v:v,src:r.src});return one(t);}
      }
      throw Error('未対応の代入: '+L);
    }
  }
  function growTargets(list,target,body,ctx){
    if(target?.t==='id'&&target.name==='held')return list;
    const deltas={score:0,scoreTimes:0,typedCost:0};
    for(const x of body){if(x.kind!=='action')throw Error('成長の書き方が未対応');
      if(K.fp&&(x.lhs==='g.fullPowerCharge'||x.lhs==='g.typedCost')&&fpGrowthHits(x.lhs,target,ctx))throw Error('使っている途中の全力値・コストの成長（'+x.lhs+'）は未対応（全力値の札に当たる）');
      if(x.lhs==='g.typedCost'&&x.op==='+='){deltas.typedCost+=exprFn(x.rhs)(null,ctx);continue;}
      if(IGNORED_GROWTH.has(x.lhs))continue;
      if(x.op!=='+=')throw Error('成長の書き方が未対応: '+x.lhs+x.op);
      if(x.lhs==='g.score')deltas.score+=exprFn(x.rhs)(null,ctx);else if(x.lhs==='g.scoreTimes')deltas.scoreTimes+=exprFn(x.rhs)(null,ctx);else throw Error('未対応の成長: '+x.lhs);}
    if(!deltas.score&&!deltas.scoreTimes&&!deltas.typedCost)return list;
    const isThis=target.t==='id'&&target.name==='this';const m=targetFn(target);
    return each(list,t=>{
      const g=ty=>grownType(ty,deltas);
      if(isThis&&ctx.recField==='ce'){
        const src=effTab[t.ce][ctx.recIdx].src,to=g(src);
        if(!growOne(t,src,to))throw Error('成長させる札が見つかりません');
        const arr=effTab[t.ce].slice();const r=arr[ctx.recIdx];arr[ctx.recIdx]={d:r.d,l:r.l,c:r.c,src:to};t.ce=effId(arr);
        return one(t);
      }
      if(isThis){if(t.usedTy<0)throw Error('this の札がありません');t.usedTy=g(t.usedTy);return one(t);}
      const pre={hand:t.hand,disc:t.disc,rem:t.rem,held:t.held,deck:t.deck,usedTy:t.usedTy};
      const mapZ=(z,loc)=>{let hit=false;for(let i=0;i<z.length;i++)if(m(z.charCodeAt(i)-BASE,loc)){hit=true;break;}return hit?msOf(msIds(z).map(ty=>m(ty,loc)?g(ty):ty)):z;};
      t.hand=mapZ(t.hand,'hand');t.disc=mapZ(t.disc,'discard');t.rem=mapZ(t.rem,'removed');
      if(t.held.length)t.held=[...t.held].map(c=>{const ty=c.charCodeAt(0)-BASE;return m(ty,'held')?C(BASE+g(ty)):c;}).join('');
      t.deck=mapBelief(t.deck,ty=>m(ty,'deck')?g(ty):ty);
      if(t.usedTy>=0&&m(t.usedTy,'used'))t.usedTy=g(t.usedTy);
      const ce=effTab[t.ce];if(ce.length){const own=new Map();
        const cnt=ty=>{let v=own.get(ty);if(v)return v;let mt=0,all=0;const add=(n,loc)=>{all+=n;if(n&&m(ty,loc))mt+=n;};
          add(msCount(pre.hand,ty),'hand');add(msCount(pre.disc,ty),'discard');add(msCount(pre.rem,ty),'removed');let h=0;for(let i=0;i<pre.held.length;i++)if(pre.held.charCodeAt(i)-BASE===ty)h++;add(h,'held');
          add(msCount(beliefs[pre.deck].content,ty),'deck');add(pre.usedTy===ty?1:0,'used');v=[mt,all];own.set(ty,v);return v;};
        const dead=r=>{const n=defs[r.d].node;return n._slot!==undefined&&r.l[n._slot]<1&&n.phase!=='endOfTurn';};
        const arr=ce.map(r=>{if(r.src<0)return r;const [mt,all]=cnt(r.src);if(!mt)return r;
          if(mt!==all){if(dead(r))return r;}else return {d:r.d,l:r.l,c:r.c,src:g(r.src)};
          throw Error('TALOS_GROWTH_OWNER_AMBIGUOUS：成長した札「'+types[r.src].card.name+'」の効果の持ち主が決まりません（同じ種類の札の一部だけが成長した）');});arr.sort(cmpRec);t.ce=effId(arr);}
      return one(t);
    });
  }
  function growOne(t,from,to){
    if(msCount(t.hand,from)){t.hand=msAdd(msDel(t.hand,from),to);return true;}
    if(msCount(t.disc,from)){t.disc=msAdd(msDel(t.disc,from),to);return true;}
    if(msCount(t.rem,from)){t.rem=msAdd(msDel(t.rem,from),to);return true;}
    const h=t.held.indexOf(C(BASE+from));if(h>=0){t.held=t.held.slice(0,h)+C(BASE+to)+t.held.slice(h+1);return true;}
    if(t.usedTy===from){t.usedTy=to;return true;}
    let ok=true;
    t.deck=beliefOf(beliefs[t.deck].cands.map(c=>{let bag=c.bag,segs=c.segs;
      if(msCount(bag,from))bag=msAdd(msDel(bag,from),to);
      else{const j=segs.findIndex(g=>msCount(g[1],from)>0);if(j<0)ok=false;else segs=repSeg(segs,j,[segs[j][0],msAdd(msDel(segs[j][1],from),to)]);}
      return {w:c.w,bag,segs};}));
    return ok;
  }
  function holdSelected(s,ctx){
    const sel=ctx.select;if(!sel){if(ctx.noSelect)return one(s);throw Error('保留する札が選ばれていません');}
    if(sel.multi){let t=s;for(const x of sel.multi)t=holdSelected(t,{...ctx,select:x})[0].s;return one(t);}
    const t=s;
    if(sel.from==='discard')t.disc=msDel(t.disc,sel.ty);
    else if(sel.from==='hand')t.hand=msDel(t.hand,sel.ty);
    else{const B=beliefs[t.deck];if(!B.hold)B.hold=new Map();const hit=B.hold.get(sel.ty);
      if(hit!==undefined)t.deck=hit;
      else{const parts=[];
      for(const c of B.cands){const nBag=msCount(c.bag,sel.ty);let n=nBag,stars=0;for(const [sj,fj] of c.segs){stars+=sj;n+=msCount(fj,sel.ty);}
        if(!n)throw Error('選んだ札が山札にありません');
        if(nBag){const bag=msDel(c.bag,sel.ty);c.segs.forEach(([sj,fj],j)=>{if(sj>0)parts.push({w:qmul(c.w,q(nBag*sj,n*stars)),bag,segs:repSeg(c.segs,j,[sj-1,fj])});});}
        c.segs.forEach(([sj,fj],j)=>{const k=msCount(fj,sel.ty);if(k)parts.push({w:qmul(c.w,q(k,n)),bag:c.bag,segs:repSeg(c.segs,j,[sj,msDel(fj,sel.ty)])});});}
      t.deck=beliefOf(parts);B.hold.set(sel.ty,t.deck);}}
    t.held+=C(BASE+sel.ty);
    while(t.held.length>2){const old=t.held.charCodeAt(0)-BASE;t.held=t.held.slice(1);t.disc=msAdd(t.disc,old);}
    return one(t);
  }
  function selectable(s,target){
    const m=targetFn(target);const out=[];
    msRuns(s.disc,ty=>{if(m(ty,'discard'))out.push({ty,from:'discard'});});
    msRuns(s.hand,ty=>{if(m(ty,'hand'))out.push({ty,from:'hand'});});
    msRuns(beliefs[s.deck].content,ty=>{if(m(ty,'deck'))out.push({ty,from:'deck'});});
    return out.sort((a,b)=>a.ty-b.ty||a.from.localeCompare(b.from));
  }
  function findSelect(items,name){const isSel=x=>x.kind==='action'&&x.op==='call'&&/Selected/.test(x.name);const i=items.findIndex(isSel);
    if(i>=0){if(i>0)throw Error('選択の行動が最初にない札は未対応: '+name);if(items[i].name!=='holdSelected'&&items[i].name!=='holdSelectedUpto')throw Error('未対応の選択: '+items[i].name);return items[i];}
    for(const x of items){if(x.kind!=='effect'||x.phase||x.target||!x.cond)continue;const j=(x.body||[]).findIndex(isSel);if(j<0)continue;
      if(j>0)throw Error('選択の行動が最初にない札は未対応: '+name);if(x.body[j].name!=='holdSelected')throw Error('未対応の選択: '+x.body[j].name);return {target:x.body[j].target,name:x.body[j].name,cond:x.cond};}
    return null;}

  function useCard(list,ty,{free=false,from=null,select=null,noSelect=false}={}){
    const card=types[ty].card;const ctx={used:ty,phase:null,parent:null,inCard:true,select,noSelect};
    let cur=trigger(list,'beforeCardUsed',ctx);
    cur=each(cur,t0=>{const pre=t0.effs===EMPTY&&t0.ce===EMPTY?null:clone(t0);
      let c=each(one(t0),t=>{if(from==='hand')t.hand=msDel(t.hand,ty);if(!free)t.uses-=1;t.usedTy=ty;return one(t);});
      if(!free&&K.fp){const n=fpCost(ty);if(n)c=each(c,t=>{t.fp-=n;return one(t);});}
      if(!free){const dsc=directStaminaCost(card),pc=positiveCost(card);if(K.nc||dsc)c=each(c,t=>{if(K.nc&&pc&&t.nco>0){t.nco--;return one(t);}if(K.nc&&pc&&t.nc>0){t.nc--;return one(t);}return dsc&&(!K.nc||staminaLoss(card,t.st,t.cm,types[ty].g.typedCost||0)>0)?trigger(one(t),'staminaDecreased',{...ctx,parent:'processCost'}):one(t);});}
      return trigger(c,'cardUsed',ctx,pre);});
    const pctx={used:ty,phase:'processCard',parent:null,inCard:true,select,noSelect};const ns=needsSnap(card.actions);
    cur=each(cur,t=>{t.em=1;t.sTimes=types[ty].g.scoreTimes;return runItems(one(t),card.actions,ns?clone(t):t,pctx);});
    cur=each(cur,t=>{const fin=t.usedTy;t.usedTy=-1;t.em=1;t.sTimes=0;
      t.cardsUsed++;t.turnUsed++;const pre=t.effs===EMPTY&&t.ce===EMPTY?null:clone(t);if(t.hThis){t.hThis=0;t.held+=C(BASE+fin);while(t.held.length>2){const old=t.held.charCodeAt(0)-BASE;t.held=t.held.slice(1);t.disc=msAdd(t.disc,old);}}else if(card.once)t.rem=msAdd(t.rem,fin);else t.disc=msAdd(t.disc,fin);return trigger(one(t),'afterCardUsed',ctx,pre);});
    if(!free)cur=each(cur,t=>t.uses<1&&!t.done?endTurn(one(t)):one(t));
    return cur;
  }
  function endTurn(list){
    const cur=each(list,t=>{t.done=1;return one(t);});
    return trigger(cur,'endOfTurn',{used:-1,phase:null,parent:null});
  }
  function useDrink(s,a){
    const dr=data.drinks.get(a.id);const ctx={used:-1,phase:'drink',parent:null,select:a.select||null,noSelect:!!a.noSelect,inCard:false,drinkName:dr.name};
    const i=s.drinks.indexOf(C(BASE+a.id));s.drinks=s.drinks.slice(0,i)+s.drinks.slice(i+1);
    const cur=runItems(one(s),dr.actions,needsSnap(dr.actions)?clone(s):s,ctx);
    return each(cur,x=>x.uses<1&&!x.done?endTurn(one(x)):one(x));
  }

  const RFP=new WeakMap();const readsFP=e=>{let v=RFP.get(e);if(v===undefined){v=/"t":"id","name":"(fullPowerCharge|cumulativeFullPowerCharge)"/.test(JSON.stringify(e));RFP.set(e,v);}return v;};
  const fpRel=(lhs,ty)=>{const c=types[ty].card;return lhs==='g.typedCost'?(c.cost||[]).some(x=>x.kind==='action'&&x.lhs==='fullPowerCharge'):/"lhs":"fullPowerCharge"/.test(JSON.stringify(c.actions));};
  function fpGrowthHits(lhs,target,ctx){if(target.t==='id'&&target.name==='this'){const o=ctx.recField==='ce'?ctx.src:ctx.used;return o!=null&&o>=0&&fpRel(lhs,o);}
    const m=targetFn(target);for(let ty=0;ty<types.length;ty++)if(fpRel(lhs,ty)&&['hand','deck','discard','removed','held','used'].some(l=>m(ty,l)))return true;return false;}
  const fpCostMemo=new Map();
  function fpCost(ty){let v=fpCostMemo.get(ty);if(v!==undefined)return v;const card=types[ty].card;v=0;
    for(const x of card.cost||[])if(x.kind==='action'&&x.lhs==='fullPowerCharge'){if(x.op!=='-='||x.rhs?.t!=='num')throw Error('全力値のコストの書き方が未対応（'+card.name+'）');v+=Math.max(0,x.rhs.v-(card.startGrowth?.typedCost??0));}
    fpCostMemo.set(ty,v);return v;}
  function usableCard(s,ty){const u=types[ty].usable;if(!u.length)return true;const ctx={used:ty,phase:null,parent:null};for(const f of u)if(!f(s,ctx))return false;return true;}
  function selOf(ty){const t=types[ty];if(t.sel===undefined)t.sel=findSelect(t.card.actions,t.card.name);return t.sel;}
  const drinkSel=new Map();
  function choices(s){
    if(s.done)return [];
    const out=[];
    if(s.uses>0){
      msRuns(s.hand,ty=>{if(!usableCard(s,ty))return;if(K.fp&&s.fp<fpCost(ty))return;const c=types[ty].card;const sel=selOf(ty);
        if(sel&&(!sel.cond||exprFn(sel.cond)(s,{used:ty,phase:null,parent:null}))){const opts=selectable({disc:s.disc,hand:msDel(s.hand,ty),deck:s.deck},sel.target);
          if(sel.name==='holdSelectedUpto'){const nMax=sel.args?.[0]?.v??1;if(nMax>2)throw Error('3枚以上を選ぶ保留は未対応: '+c.name);
            const cnt=x=>x.from==='deck'?msCount(beliefs[s.deck].content,x.ty):x.from==='discard'?msCount(s.disc,x.ty):msCount(msDel(s.hand,ty),x.ty);
            out.push({type:'card',ty,id:c.id,name:c.name,noSelect:true});
            for(let i=0;i<opts.length;i++){out.push({type:'card',ty,id:c.id,name:c.name,select:{multi:[opts[i]]}});
              if(nMax>=2)for(let j=i;j<opts.length;j++){if(j===i&&cnt(opts[i])<2)continue;out.push({type:'card',ty,id:c.id,name:c.name,select:{multi:[opts[i],opts[j]]}});}}
            return;}
          if(opts.length)for(const x of opts)out.push({type:'card',ty,id:c.id,name:c.name,select:x});else out.push({type:'card',ty,id:c.id,name:c.name,noSelect:true});}
        else out.push({type:'card',ty,id:c.id,name:c.name});});
      const capped=cfg.drinkCap!==null&&cfg.drinkBase-s.drinks.length>=cfg.drinkCap;
      if(!capped){let prev=-1;for(let i=0;i<s.drinks.length;i++){const id=s.drinks.charCodeAt(i)-BASE;if(id===prev)continue;prev=id;const dr=data.drinks.get(id);
        let sel=drinkSel.get(id);if(sel===undefined){sel=findSelect(dr.actions,dr.name);drinkSel.set(id,sel);}
        if(sel){const opts=selectable(s,sel.target);if(opts.length)for(const x of opts)out.push({type:'drink',id,name:dr.name,select:x});else out.push({type:'drink',id,name:dr.name,noSelect:true});}
        else out.push({type:'drink',id,name:dr.name});}}
    }
    if(hasEnd(s.effs)||hasEnd(s.ce))out.push({type:'endTurn',name:'ターン終了'});
    return out;
  }

  function transition(s0,a){
    const s=clone(s0);let cur;
    if(a.type==='card')cur=useCard(one(s),a.ty,{from:'hand',select:a.select||null,noSelect:!!a.noSelect});
    else if(a.type==='drink')cur=useDrink(s,a);
    else if(a.type==='endTurn')cur=endTurn(one(s));
    else throw Error('未対応の行動: '+a.type);
    for(const c of cur)checkSelfGrowth(c.s);
    if(cur.length===1){const b=cur[0];b.s.key=key(b.s);if(b.s.hand.length>cfg.cap)throw Error('手札上限を超えました');return {branches:[b]};}
    const m=new Map();
    for(const c of cur){const k=key(c.s);const o=m.get(k);if(o)o.p=qadd(o.p,c.p);else{c.s.key=k;m.set(k,{p:c.p,s:c.s});}}
    const out=[...m.values()];
    for(const b of out)if(b.s.hand.length>cfg.cap)throw Error('手札上限を超えました');
    out.sort((x,y)=>x.s.key<y.s.key?-1:x.s.key>y.s.key?1:x.s.score-y.s.score);
    return {branches:out};
  }
  const withScore=(s,x)=>{const t=clone(s);t.score=x;t.key=s.key;return t;};
  function explain(s0,a){const s=clone(s0);s.hits=undefined;TRACE=true;let r;try{r=transition(s,a);}finally{TRACE=false;}
    const runs=xs=>{const out=[];for(const x of xs){const o=out[out.length-1];if(o&&o.v===x.v&&o.src===x.src&&o.phase===x.phase&&o.via===(x.via??null))o.times++;else out.push({v:x.v,times:1,src:x.src??null,phase:x.phase??null,via:x.via??null});}return out;};
    return {branches:r.branches.map(b=>{const h=b.s.hits||[];b.s.hits=undefined;const sc=h.filter(x=>x.score!==undefined).map(x=>({v:x.score,src:x.src,phase:x.phase,via:x.via})),ht=h.filter(x=>x.heat!==undefined).map(x=>({v:x.heat,src:x.src,phase:x.phase,via:x.via}));
      return {p:b.p,s:b.s,scoreGain:b.s.score-s0.score,hits:runs(sc),heatGain:ht.reduce((x,y)=>x+y.v,0),heatHits:runs(ht)};})};}

  const root=initial();
  const name=ty=>types[ty].card.name+(types[ty].g.score||types[ty].g.scoreTimes?'〔成長 '+types[ty].g.score+'/'+types[ty].g.scoreTimes+'〕':'');
  const ms=z=>msIds(z).map(name);
  function deckOrders(s,limit=20000){return beliefOrders(beliefs[s.deck],limit);}
  function beliefOrders(B,limit){
    const out=new Map();let count=0;
    for(const c of B.cands){
      const segPerms=c.segs.map(([s,f])=>distinctPerms([...'*'.repeat(s)].map(()=>-1).concat(msIds(f))));
      const bagPerms=distinctPerms(msIds(c.bag));
      let combos=bagPerms.length;for(const p of segPerms)combos*=p.length;if(combos>limit)return null;
      const w=c.w[0]/c.w[1];
      const rec=(j,acc,pw)=>{if(j===segPerms.length){for(const bp of bagPerms){let k=0;const seq=acc.map(x=>x<0?bp[k++]:x);const key=seq.join(',');out.set(key,(out.get(key)||0)+pw/bagPerms.length);count++;}return;}
        for(const p of segPerms[j])rec(j+1,acc.concat(p),pw/segPerms[j].length);};
      rec(0,[],w);
    }
    return out;
  }
  let pathOf=null,nodeOfPath=null;
  function buildPaths(){pathOf=new Map();nodeOfPath=new Map();
    const walk=(items,pre)=>items.forEach((x,i)=>{if(x.kind==='effect'||x.kind==='level'){const p=pre+'.'+i;if(x.kind==='effect'&&!pathOf.has(x)){pathOf.set(x,p);nodeOfPath.set(p,x);}walk(x.body||[],p);}});
    for(const c of data.cards.values()){const k=String(c.key??c.id);walk(c.actions,'c:'+k+':a');walk(c.effects,'c:'+k+':e');}
    for(const d of data.drinks.values())walk(d.actions,'d:'+d.id);
    for(const it of data.items.values())walk(it.effects,'i:'+it.id);}
  const defPath=d=>{if(!pathOf)buildPaths();const p=pathOf.get(defs[d].node);if(p===undefined)throw Error('効果の場所が分かりません');return p;};
  const msDesc=z=>msIds(z).map(typeDesc).sort();
  const descTy=x=>{const [k,gs,gt,tc]=x.split('|');return typeOf(/^-?\d+$/.test(k)?Number(k):k,{score:Number(gs),scoreTimes:Number(gt),typedCost:Number(tc||0)});};
  const recCanon=r=>[defPath(r.d),r.l,r.c,r.src<0?null:typeDesc(r.src)];
  const scal=t=>[t.uses,t.st,t.heat,t.extra,t.factor,t.bonus,t.strB,t.done,t.em,t.sTimes,t.usedTy,K.prev?t.prev:0,K.pT?t.pT:0,K.sT?t.sT:0,K.lT?t.lT:0,K.dirT?t.dirT:0,K.cardsUsed?t.cardsUsed:0,K.turnUsed?t.turnUsed:0,...(K.nc?[t.nc,t.nco]:[0,0]),...(K.fp?[t.fp,t.cfp,t.fpb]:[]),...(t.cm?['c'+t.cm]:[])];
  const beliefCanonCache=new Map();
  function beliefCanon(bid){let v=beliefCanonCache.get(bid);if(v!==undefined)return v;
    v=beliefs[bid].cands.map(c=>[JSON.stringify([msDesc(c.bag),c.segs.map(([n,f])=>[n,msDesc(f)])]),c.w]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([k,w])=>[w[0],w[1],k]);
    beliefCanonCache.set(bid,v);return v;}
  const zc=new Map(),zcRev=new Map(),dc=new Map(),dcRev=new Map(),ec=new Map(),ecRev=new Map();
  const zoneC=z=>{let v=zc.get(z);if(v===undefined){v=JSON.stringify(msDesc(z));zc.set(z,v);}return v;};
  const heldC=z=>{const k='h'+z;let v=zc.get(k);if(v===undefined){v=JSON.stringify([...z].map(c=>typeDesc(c.charCodeAt(0)-BASE)));zc.set(k,v);}return v;};
  const deckC=bid=>{let v=dc.get(bid);if(v===undefined){v=JSON.stringify(beliefCanon(bid));dc.set(bid,v);}return v;};
  const effC=id=>{let v=ec.get(id);if(v===undefined){v=JSON.stringify(effTab[id].map(recCanon));ec.set(id,v);}return v;};
  const canon=t=>zoneC(t.hand)+'\x01'+zoneC(t.disc)+'\x01'+zoneC(t.rem)+'\x01'+heldC(t.held)+'\x01'+t.drinks+'\x01'+deckC(t.deck)+'\x01'+effC(t.effs)+'\x01'+effC(t.ce)+'\x01'+scal(t).join(',');
  function fromCanon(str,score=0){
    const [hand,disc,rem,held,drinks,deck,effs,ce,sc]=str.split('\x01');
    const ms=x=>{let v=zcRev.get(x);if(v===undefined){v=msOf(JSON.parse(x).map(descTy));zcRev.set(x,v);}return v;};
    const hs=x=>{const k='h'+x;let v=zcRev.get(k);if(v===undefined){v=JSON.parse(x).map(d=>C(BASE+descTy(d))).join('');zcRev.set(k,v);}return v;};
    let bid=dcRev.get(deck);
    if(bid===undefined){const parts=JSON.parse(deck).map(([n,d,k])=>{const [bag,segs]=JSON.parse(k);return {w:[n,d],bag:msOf(bag.map(descTy)),segs:segs.map(([m,f])=>[m,msOf(f.map(descTy))])};});bid=beliefOf(parts);dcRev.set(deck,bid);}
    if(!pathOf)buildPaths();
    const recOf=([p,l,c,src])=>{const node=nodeOfPath.get(p);if(!node)throw Error('効果の場所が分かりません: '+p);return {d:defOf(node),l,c,src:src===null?-1:descTy(src)};};
    const eid=(x,sort)=>{const k=(sort?'s':'u')+x;let v=ecRev.get(k);if(v===undefined){const list=JSON.parse(x).map(recOf);if(sort)list.sort(cmpRec);v=effId(list);ecRev.set(k,v);}return v;};
    const parts=sc.split(',');const cm=parts.length&&parts[parts.length-1][0]==='c'?+parts.pop().slice(1):0;
    const [uses,st,heat,extra,factor,bonus,strB,done,em,sTimes,usedTy,prev,pT,sT,lT,dirT,cardsUsed,turnUsed,nc=0,nco=0,fp=0,cfp=0,fpb=0]=parts.map(Number);
    const t=new St({hand:ms(hand),disc:ms(disc),rem:ms(rem),held:hs(held),drinks,
      deck:bid,effs:eid(effs,false),ce:eid(ce,true),uses,st,prev,heat,extra,factor,bonus,strB,pT,sT,lT,dirT,cardsUsed,turnUsed,nc,nco,cm,fp,cfp,fpb,done,em,sTimes,usedTy,score});
    checkSelfGrowth(t);t.key=key(t);return t;}
  const canonAct=a=>a.type+':'+(a.type==='card'?typeDesc(a.ty):a.type==='drink'?a.id:'')+(a.select?':'+typeDesc(a.select.ty)+':'+a.select.from:'');
  function trimCaches(){for(const B of beliefs){B.draw=null;B.many=null;B.hold=null;B.ins=new Map();}PH_CACHE.clear();beliefCanonCache.clear();}
  const domKey=s=>{const h=s.heat;s.heat=0;const k=key(s);s.heat=h;return k;};
  return {root,choices,transition,explain,drinkDef:id=>data.drinks.get(id),key:s=>s.key,types,cfg,defs,withScore,deckOrders,beliefs,canon,fromCanon,canonAct,trimCaches,
    heatMonotone:()=>heatMono,domKey,domVal:s=>s.heat,
    effsOf:s=>effTab[s.effs],ceOf:s=>effTab[s.ce],extraOf:s=>[s.strB,s.cardsUsed,s.turnUsed],isDead:deadRec,stats:()=>({beliefs:beliefs.length,effLists:effTab.length,types:types.length,keyFields:Object.keys(K).filter(f=>K[f])}),
    describe:s=>({hand:ms(s.hand),discard:ms(s.disc),removed:ms(s.rem),held:[...s.held].map(c=>name(c.charCodeAt(0)-BASE)),
      deck:beliefs[s.deck].cands.map(c=>({p:c.w[0]+'/'+c.w[1],bag:ms(c.bag),segs:c.segs.map(([n,f])=>({stars:n,fixed:ms(f)}))})),
      uses:s.uses,stance:STANCES[s.st],prevStance:s.prev===NONE?'none':STANCES[s.prev],enthusiasm:s.heat,extra:s.extra,factor:s.factor,bonus:s.bonus,score:s.score,done:!!s.done,
      drinks:msIds(s.drinks),times:{preservation:s.pT,strength:s.sT,leisure:s.lT,direct:s.dirT},...(K.nc?{...(s.nco?{nullifyCostCards:s.nco+s.nc,nullifyCostCardsCarriedFirst:true}:{nullifyCostCards:s.nc}),...(s.cm?{halfCostTurns:s.cm&CM.hc?1:0,doubleCostTurns:s.cm&CM.dc?1:0,costReduction:CM.crOf(s.cm),costIncrease:CM.ciOf(s.cm)}:{})}:{}),...(K.fp?{fullPowerCharge:s.fp,cumulativeFullPowerCharge:s.cfp,fullPowerChargeBuff:s.fpb/100}:{})}),
    inputs:{fullPowerCharge:K.fp,cumulativeFullPowerCharge:cfpRead},
    notes:[...(cfpProvisional?['累計の全力値は入力がないため暫定 '+CFP_PROVISIONAL+' で計算しています（ブースト・ラッシュなど累計を使う札の点は目安）']:[]),
      ...(types.some(t=>/"name":"holdSelectedUpto"/.test(JSON.stringify(t.card.actions)))?['本領発揮：保留する札の選び方（0〜2枚）をすべて試すため、計算が2〜5倍重くなることがあります。保留した札はこのターン中は使えないものとし、その札の成長（回数+1・コスト値−）は数えていません（試作・未検証）']:[])]};
}
function distinctPerms(a){const out=[];const cnt=new Map();for(const x of a)cnt.set(x,(cnt.get(x)||0)+1);const keys=[...cnt.keys()].sort((x,y)=>x-y);const cur=[];
  (function f(){if(cur.length===a.length){out.push(cur.slice());return;}for(const k of keys){const n=cnt.get(k);if(!n)continue;cnt.set(k,n-1);cur.push(k);f();cur.pop();cnt.set(k,n);}})();return out;}

export {loadDataFromDir} from './engine.mjs?v=1.17.12';
