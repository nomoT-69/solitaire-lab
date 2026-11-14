import {createEngine as createTalos} from './engine.mjs?v=1.17.12';
import {createEngine as createTecnai} from './tecnai.mjs?v=1.17.12';
const frac=s=>{const [n,d='1']=String(s).split('/');return Number(n)/Number(d);};
function perms(a){const out=[];const cnt=new Map();for(const v of a)cnt.set(v,(cnt.get(v)||0)+1);const ks=[...cnt.keys()].sort();const cur=[];
  (function f(){if(cur.length===a.length){out.push(cur.slice());return;}for(const k of ks){const n=cnt.get(k);if(!n)continue;cnt.set(k,n-1);cur.push(k);f();cur.pop();cnt.set(k,n);}})();return out;}
const r12=v=>Number(v).toPrecision(12);
const ordStr=m=>[...m].filter(([,p])=>p>1e-15).map(([k,p])=>k+'='+r12(p)).sort().join(';');
const put=(m,k,p)=>m.set(k,(m.get(k)||0)+p);
function deckSig(v,kind){
  const content=[];const c0=v.deck[0];content.push(...c0.bag);if(kind==='talos')content.push(...c0.mask.filter(m=>m!=='*'));else for(const g of c0.segs)content.push(...g.fixed);
  if(content.length<=8){const out=new Map();
    for(const c of v.deck){const w=frac(c.p),bp=perms(c.bag);
      const masks=kind==='talos'?[c.mask]:c.segs.map(g=>perms([...Array(g.stars).fill('*'),...g.fixed])).reduce((acc,ps)=>acc.flatMap(a=>ps.map(p=>a.concat(p))),[[]]);
      for(const mk of masks)for(const b of bp){let i=0;put(out,mk.map(x=>x==='*'?b[i++]:x).join(','),w/masks.length/bp.length);}}
    return ordStr(out);}
  const top=new Map(),bot=new Map(),K=3;
  for(const c of v.deck){const w=frac(c.p);
    if(kind==='talos'){
      (function f(i,bag,acc,p){if(i===Math.min(K,c.mask.length)){put(top,acc.join(','),p);return;}const m=c.mask[i];
        if(m!=='*')return f(i+1,bag,acc.concat(m),p);const cnt=new Map();for(const b of bag)cnt.set(b,(cnt.get(b)||0)+1);
        for(const [t,n] of cnt){const j=bag.indexOf(t);f(i+1,bag.slice(0,j).concat(bag.slice(j+1)),acc.concat(t),p*n/bag.length);}})(0,c.bag,[],w);
      const last=c.mask[c.mask.length-1];if(last!=='*')put(bot,last,w);else for(const b of c.bag)put(bot,b,w/c.bag.length);
    }else{
      (function f(segs,bag,acc,p){if(acc.length===K||!segs.length){put(top,acc.join(','),p);return;}const g=segs[0],m=g.stars+g.fixed.length;
        if(!m)return f(segs.slice(1),bag,acc,p);const cnt=new Map();for(const x of g.fixed)cnt.set(x,(cnt.get(x)||0)+1);
        for(const [t,n] of cnt){const j=g.fixed.indexOf(t);f([{stars:g.stars,fixed:g.fixed.slice(0,j).concat(g.fixed.slice(j+1))},...segs.slice(1)],bag,acc.concat(t),p*n/m);}
        if(g.stars){const bc=new Map();for(const b of bag)bc.set(b,(bc.get(b)||0)+1);
          for(const [t,n] of bc){const j=bag.indexOf(t);f([{stars:g.stars-1,fixed:g.fixed},...segs.slice(1)],bag.slice(0,j).concat(bag.slice(j+1)),acc.concat(t),p*g.stars/m*n/bag.length);}}})(c.segs,c.bag,[],w);
      const g=c.segs[c.segs.length-1],m=g.stars+g.fixed.length;for(const x of g.fixed)put(bot,x,w/m);if(g.stars)for(const b of c.bag)put(bot,b,w*g.stars/m/c.bag.length);}}
  return '~'+content.sort().join(',')+'|'+ordStr(top)+'|'+ordStr(bot);
}
export function compareSetup(data,setup,{maxStates=2000,engines={talos:createTalos,tecnai:createTecnai},deadline=Infinity}={}){
  const res={states:0,transitions:0,mismatches:0,examples:[],unsupported:0};
  let A,B;try{A=engines.talos(data,setup);}catch(e){res.loadError=e.message;return res;}
  try{B=engines.tecnai(data,setup);}catch(e){res.mismatches++;res.examples.push({kind:'読み込み',talos:'読み込めた',tecnai:e.message});return res;}
  const tn=(E,ty)=>ty<0?'-':E.types[ty].card.name+'#'+(E.types[ty].card.key??E.types[ty].card.id)+'|'+E.types[ty].g.score+'/'+E.types[ty].g.scoreTimes;
  const zone=(E,z)=>[...z].map(c=>tn(E,c.charCodeAt(0)-0x100)).sort();
  const deadA=r=>{const n=A.defs[r.d].node;return n._slot!==undefined&&r.l[n._slot]<1&&n.phase!=='endOfTurn';};
  const canon=(E,s,kind)=>{const v=E.describe(s);
    const effs=(kind==='talos'?s.effs:E.effsOf(s)).map(r=>r.d+':'+r.l.join('.')+':'+r.c);
    const ce=(kind==='talos'?s.cardEffs.filter(r=>!deadA(r)):E.ceOf(s).filter(r=>!E.isDead(r))).map(r=>r.d+':'+r.l.join('.')+':'+r.c+':'+tn(E,r.src)).sort();
    const held=kind==='talos'?s.held.map(ty=>tn(E,ty)):[...s.held].map(c=>tn(E,c.charCodeAt(0)-0x100));
    return JSON.stringify([zone(E,s.hand),zone(E,s.disc),zone(E,s.rem),held,(kind==='talos'?s.drinks:v.drinks).slice().sort((a,b)=>a-b),deckSig(v,kind),
      v.uses,v.stance,v.prevStance,v.enthusiasm,v.extra,v.factor,v.bonus,v.score,v.done,v.times,kind==='talos'?[s.strB,s.cardsUsed,s.turnUsed]:E.extraOf(s),effs,ce]);};
  const act=(E,a)=>a.type==='card'?'card:'+tn(E,a.ty)+(a.select?':'+tn(E,a.select.ty)+':'+a.select.from:''):a.type==='drink'?'drink:'+a.id+(a.select?':'+tn(E,a.select.ty)+':'+a.select.from:''):a.type;
  const bad=x=>{res.mismatches++;if(res.examples.length<5)res.examples.push(x);};
  const k0=canon(A,A.root,'talos');if(k0!==canon(B,B.root,'tecnai')){bad({kind:'初期の状態',talos:k0,tecnai:canon(B,B.root,'tecnai')});return res;}
  const seen=new Set([k0]);let q=[[A.root,B.root]];
  while(q.length&&res.states<maxStates&&!res.mismatches){const nq=[];
    for(const [sa,sb] of q){if(res.states>=maxStates||Date.now()>deadline)break;res.states++;
      let ca,cb,ea='',eb='';try{ca=A.choices(sa);}catch(e){ea=e.message;}try{cb=B.choices(sb);}catch(e){eb=e.message;}
      if(ea||eb){if(ea!==eb)bad({kind:'合法手の例外',talos:ea,tecnai:eb});else res.unsupported++;continue;}
      const ka=ca.map(a=>act(A,a)).sort(),kb=cb.map(a=>act(B,a)).sort();
      if(ka.join('\n')!==kb.join('\n')){bad({kind:'合法手',talos:ka,tecnai:kb,state:A.describe(sa)});break;}
      const byB=new Map(cb.map(a=>[act(B,a),a]));
      for(const a of ca){res.transitions++;
        let ta,tb;try{ta=A.transition(sa,a).branches;}catch(e){ta=e.message;}try{tb=B.transition(sb,byB.get(act(A,a))).branches;}catch(e){tb=e.message;}
        if(typeof ta==='string'||typeof tb==='string'){if(ta!==tb)bad({kind:'例外',action:act(A,a),talos:String(ta).slice(0,300),tecnai:String(tb).slice(0,300)});continue;}
        const ma=new Map(),mb=new Map(),sbOf=new Map();
        for(const b of ta){const k=canon(A,b.s,'talos');const o=ma.get(k);ma.set(k,{p:(o?.p||0)+b.p[0]/b.p[1],s:o?.s||b.s});}
        for(const b of tb){const k=canon(B,b.s,'tecnai');mb.set(k,(mb.get(k)||0)+b.p[0]/b.p[1]);sbOf.set(k,b.s);}
        let ok=ma.size===mb.size;if(ok)for(const [k,o] of ma)if(!mb.has(k)||Math.abs(mb.get(k)-o.p)>1e-12){ok=false;break;}
        if(!ok){bad({kind:'遷移',action:act(A,a),state:A.describe(sa),talos:[...ma].map(([k,o])=>[k,o.p]).slice(0,3),tecnai:[...mb].slice(0,3)});break;}
        for(const [k,o] of ma)if(!seen.has(k)){seen.add(k);nq.push([o.s,sbOf.get(k)]);}}}
    q=nq;}
  return res;
}
export const FILLER_CARDS=[390,391,408,409,749,750,590,591,716,717,438,439,98,99,160,161,418,419,422,423,436,437,518,519,702,703,556,557,745,746,392,393,23];
export const FILLER_DRINKS=[7,8,12,13,14,17,18,26];
export function cardSpecName(data,spec){
  const x=typeof spec==='number'?{id:spec}:spec;const c=data.cards.get(x.id);if(!c)return null;
  const ab=x.hif?['HIF']:(x.abilities||[]);const cs=x.c11n?Object.entries(x.c11n).filter(([,v])=>Number(v)>0).map(([k,v])=>k+':'+v):[];
  return c.name+ab.map(a=>'＋'+a).join('')+(cs.length?'［カスタマイズ '+cs.join(',')+'］':'')+(x.grown==='full'?'（成長しきり）':'')+
    (x.g&&(x.g.score||x.g.scoreTimes)?'〔成長 '+(x.g.score||0)+'/'+(x.g.scoreTimes||0)+'〕':'')+(x.limits?'（残り回数 '+x.limits.join(',')+'）':'');
}
export function inspectCards(data,ids,{cases=40,maxStates=2000,maxMs=60000,seed=1,engines}={}){
  const t0=Date.now(),deadline=t0+maxMs;let x=seed>>>0;
  const rnd=()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const pick=a=>a[Math.floor(rnd()*a.length)],int=(a,b)=>a+Math.floor(rnd()*(b-a+1));
  const idOf=x=>typeof x==='number'?x:x?.id;
  const missing=ids.filter(x=>!data.cards.has(idOf(x)));if(missing.length)return {error:'存在しない札の番号：'+missing.map(idOf).join(', '),cases:0};
  const tal=engines?.talos??createTalos;
  for(const x of ids){if(typeof x==='number')continue;try{tal(data,{hand:[x],deck:[23]});}catch(e){return {error:'札の指定を読み込めません（'+cardSpecName(data,x)+'）：'+e.message,cases:0};}}
  const total={cards:ids.map(x=>({id:idOf(x),spec:x,name:cardSpecName(data,x)})),cases:0,states:0,transitions:0,mismatches:0,examples:[],loadErrors:[],unsupported:0,ms:0,stopped:null};
  for(let ci=0;ci<cases;ci++){
    if(Date.now()>deadline){total.stopped='時間の上限（'+maxMs+'ミリ秒）';break;}
    const zone=n=>Array.from({length:n},()=>pick(FILLER_CARDS));
    const setup={hand:zone(int(0,3)),deck:zone(int(1,5)),discard:zone(int(0,2)),held:[],drinks:Array.from({length:int(0,2)},()=>pick(FILLER_DRINKS)),
      cardUses:int(1,3),stance:pick(['preservation','preservation2','leisure','strength','strength2']),enthusiasm:int(0,10),enthusiasmBonus:int(0,3),
      preservationTimes:int(0,3),strengthTimes:int(0,5),stanceChangedByDirectEffectTimes:int(0,4)};
    for(const id of ids){const where=pick(['hand','hand','deck','discard']);setup[where].push(id);}
    const r=compareSetup(data,setup,{maxStates,engines,deadline});
    if(r.loadError){if(total.loadErrors.length<5)total.loadErrors.push(r.loadError);continue;}
    total.cases++;total.states+=r.states;total.transitions+=r.transitions;total.mismatches+=r.mismatches;total.unsupported+=r.unsupported;
    for(const e of r.examples)if(total.examples.length<5)total.examples.push({case:ci,setup,...e});}
  total.ms=Date.now()-t0;total.ok=total.mismatches===0&&total.cases>0;
  return total;
}
