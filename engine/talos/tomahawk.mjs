import {ZERO,ONE,R,add as addR,mul as mulR,cmp as cmpR,str,toNum} from '../src/rational.mjs?v=1.17.12';
import {createEngine} from './tecnai.mjs?v=1.17.12';
const add=(x,y)=>{if(x.n===0n)return y;if(y.n===0n)return x;if(x.d===y.d&&x.d===1n)return {n:x.n+y.n,d:1n};return addR(x,y);};
const mul=(x,y)=>{if(x.n===0n||y.n===0n)return ZERO;if(x.n===x.d)return y;if(y.n===y.d)return x;if(x.d===1n&&y.d===1n)return {n:x.n*y.n,d:1n};return mulR(x,y);};
const cmp=(x,y)=>{if(x===y)return 0;if(x.d===y.d)return x.n<y.n?-1:x.n>y.n?1:0;return cmpR(x,y);};
const eqR=(x,y)=>x===y||(x.n===y.n&&x.d===y.d);
export const DEFAULT_ORDER=['d','p','a'];
const MAXIMIZE={p:true,ev:true,fl:true,d:false,a:false};

export function tecnaiModel(data,setup,target,options={}){
  const E=createEngine(data,setup,options);const probs=new Map();const co=!!options.canonicalOrder;
  const rat=p=>{const k=p[0]+'/'+p[1];let r=probs.get(k);if(!r){r=R(p[0],p[1]);probs.set(k,r);}return r;};
  const v6key=co?s=>JSON.stringify([E.canon(s),s.score]):s=>JSON.stringify([s.key,s.score]);
  return {engine:E,root:E.root,target,key:v6key,v6key,solKey:s=>s.key,withScore:E.withScore,
    choices:s=>{const cs=E.choices(s).map(a=>({...a,raw:a}));if(co)sortActs(E,cs);return cs;},
    branches(s,a){let bs=E.transition(s,a.raw??a).branches;if(co)bs=sortBranches(E,bs);return bs.map((b,index)=>({p:rat(b.p),pFloat:b.p[0]/b.p[1],s:b.s,index}));}};
}
export {heatCapScore} from './estimate.mjs?v=1.17.12';
export const sortActs=(E,cs)=>{const k=new Map(cs.map(a=>[a,E.canonAct(a.raw??a)]));return cs.sort((x,y)=>k.get(x)<k.get(y)?-1:k.get(x)>k.get(y)?1:0);};
export const sortBranches=(E,bs)=>{const k=bs.map(b=>({b,c:E.canon(b.s)}));k.sort((x,y)=>x.c<y.c?-1:x.c>y.c?1:x.b.s.score-y.b.s.score);return k.map(x=>{x.b.canon=x.c;return x.b;});};

export class BigMap{constructor(limit=16000000){this.ms=[new Map()];this.limit=limit;this.size=0;}
  get(k){const ms=this.ms;if(ms.length===1)return ms[0].get(k);for(let i=0;i<ms.length;i++){const v=ms[i].get(k);if(v!==undefined)return v;}return undefined;}
  set(k,v){let m=this.ms[this.ms.length-1];if(m.size>=this.limit){m=new Map();this.ms.push(m);}m.set(k,v);this.size++;return this;}}

class Grow{constructor(T,n=1<<16){this.T=T;this.a=new T(n);this.n=0;this.u=T===Uint32Array;}
  up(v){if(this.u&&!(Number.isInteger(v)&&v>=0&&v<=0xFFFFFFFF)){const b=new Float64Array(this.a.length);b.set(this.a);this.a=b;this.T=Float64Array;this.u=false;}}
  push(v){if(this.u)this.up(v);if(this.n===this.a.length){const b=new this.T(Math.ceil(this.a.length*1.5));b.set(this.a);this.a=b;}this.a[this.n++]=v;}
  set(i,v){if(this.u)this.up(v);this.a[i]=v;}}

export function prepareTomahawk(model,opts={}){return solveTomahawk({...model,target:Infinity},{...opts,prepare:true,alpha:ONE,cut:false});}

export function solveTargetTable(model,opts={}){
  const started=Date.now();const qs=opts.quantiles??[0.5];const base=model.root.score||0;
  const pr=prepareTomahawk(model,opts);
  if(pr.status!=='prepared')return {status:'incomplete',reason:pr.reason??null,ms:Date.now()-started};
  const g=pr.graph,N=g.maxGain.length,{actStart,brStart,brChild,brGain,brProb,maxGain}=g;const P=g.probsR.map(toNum);
  const sure=new Float64Array(N);
  for(let v=N-1;v>=0;v--){let b=0;for(let ai=actStart[v];ai<actStart[v+1];ai++){let w=Infinity;for(let bi=brStart[ai];bi<brStart[ai+1];bi++){const c=brChild[bi];const x=brGain[bi]+(c>=0?sure[c]:0);if(x<w)w=x;}if(w>b)b=w;}sure[v]=b;}
  const T=new Array(N),V=new Array(N);
  const val=(c,t)=>{if(t<=0)return 1;const ts=T[c];if(t>=ts[ts.length-1])return V[c][ts.length-1];let lo=0,hi=ts.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(ts[m]<=t)lo=m;else hi=m-1;}return V[c][lo];};
  let segs=0;
  for(let v=N-1;v>=0;v--){
    if((v&4095)===0&&opts.maxMs&&Date.now()-started>opts.maxMs*2)return {status:'incomplete',reason:'TIME_LIMIT',ms:Date.now()-started};
    const hi=maxGain[v];const a0=actStart[v],a1=actStart[v+1];
    if(a0===a1||hi<1){T[v]=Float64Array.of(1);V[v]=Float64Array.of(0);segs++;continue;}
    const bp=new Set([1]);
    for(let bi=brStart[a0];bi<brStart[a1];bi++){const gn=brGain[bi],c=brChild[bi];if(gn+1<=hi)bp.add(gn+1);if(c>=0){const ts=T[c];for(let i=0;i<ts.length;i++){const t=gn+ts[i];if(t>hi)break;if(t>1)bp.add(t);}}}
    const ts=[...bp].sort((x,y)=>x-y);const outT=[],outV=[];
    for(const t of ts){let best=0;
      for(let ai=a0;ai<a1;ai++){let p=0;for(let bi=brStart[ai];bi<brStart[ai+1];bi++){const gn=brGain[bi],c=brChild[bi];p+=P[brProb[bi]]*(t<=gn?1:c>=0?val(c,t-gn):0);}if(p>best)best=p;}
      if(best>1)best=1;if(!outV.length||Math.abs(outV[outV.length-1]-best)>1e-15){outT.push(t);outV.push(best);}}
    outT.push(hi+1);outV.push(0);T[v]=Float64Array.from(outT);V[v]=Float64Array.from(outV);segs+=outT.length;
  }
  const curve=[];for(let i=0;i<T[0].length;i++)curve.push({score:base+T[0][i],p:V[0][i]});
  const maxNeedWith=q=>{let r=null;const ts=T[0],vs=V[0];for(let i=0;i<ts.length;i++)if(vs[i]>=q-1e-12)r=(i+1<ts.length?ts[i+1]-1:null);return r;};
  const exact=!(pr.stats.dropped>0)&&!(pr.stats.horizonCut>0);
  return {status:'complete',exact,note:exact?'正確':'層の上限・操作数の上限の範囲での値（実際に打てる方策の値。本当の値はこれ以上）',
    sure:sure[0]>=1?base+sure[0]:null,max:base+maxGain[0],quantiles:qs.map(q=>{const n=maxNeedWith(q);return {p:q,score:n!==null&&n>=1?base+n:null};}),
    curve,ms:Date.now()-started,stats:{nodes:N,segments:segs,forwardMs:g.forwardMs,dropped:pr.stats.dropped,horizonCut:pr.stats.horizonCut}};
}
export function solveTomahawk(model,opts){
  const {maxOps=24,maxStates=2e7,maxMs=600000,maxFrontier=200000,order=DEFAULT_ORDER,checkEvery=97,extras=[],extrasMode='auto',criterion=null,frontier='auto',cut=true}=opts;
  let alpha=opts.alpha??null;
  for(const x of extras)if(!['ev','floor'].includes(x))throw Error('未対応の自然さの指標: '+x);
  if(!['auto','tiebreak','full'].includes(extrasMode))throw Error('未対応の extrasMode: '+extrasMode);
  if(criterion!==null&&criterion!=='max')throw Error('未対応の criterion: '+criterion);
  if(criterion===null&&!alpha)throw Error('alpha か criterion:"max" を指定してください');
  const useEv=extras.includes('ev'),useFl=extras.includes('floor');
  const extraDims=extras.map(x=>x==='floor'?'fl':x);
  const dims=['p','d','a',...extraDims],lex=[...order,...extraDims];
  const useD=order.includes('d'),useA=order.includes('a');const Dv=u=>useD?u.d:ZERO,Av=u=>useA?u.a:ZERO;
  const floorFirstWithEv=useEv&&useFl&&extras.indexOf('floor')<extras.indexOf('ev');
  if(extrasMode==='tiebreak'&&floorFirstWithEv)throw Error('最低最終点→期待最終点の順では tiebreak は使えません');
  const mode=!extras.length?'none':extrasMode==='auto'?(floorFirstWithEv?'full':'tiebreak'):extrasMode;
  const reduceX=opts.reduce!==false;
  const lexMode=criterion==='max'&&mode!=='full';
  const lexFull=criterion==='max'&&mode==='full'&&reduceX;
  const lexKey=['p',...order.filter(k=>k!=='p'),...extraDims];
  const pdOk=order[order.length-1]==='a'&&order.includes('d');
  const fdim=frontier==='auto'?(pdOk&&(mode!=='full'||reduceX)?'pd':'pda'):frontier;
  if(!['pd','pda'].includes(fdim))throw Error('未対応の frontier: '+frontier);
  if(fdim==='pd'&&(!pdOk||(mode==='full'&&!reduceX)))throw Error("frontier:'pd' は比べる順が D を含み、最後が A のときだけ使えます（reduce:false の重い方式では使えない）");
  const mk=(p,d,a,ev,fl)=>{const v={p,d,a};if(useEv)v.ev=ev;if(useFl)v.fl=fl;return Object.freeze(v);};
  const GOAL=[mk(ONE,ZERO,ZERO,ZERO,ZERO)],STOP=mk(ZERO,ZERO,ZERO,ZERO,ZERO),STOP_LIST=[STOP];
  const LEAF=[{from:1,pts:STOP_LIST}];
  const started=Date.now();let segChecks=0;
  let progressed=!opts.resume;const late=()=>progressed&&Date.now()-started>maxMs;
  const better=(u,v,k)=>{const c=cmp(u[k],v[k]);return MAXIMIZE[k]?c:-c;};
  const dominates=(u,v,ds)=>ds.every(k=>better(u,v,k)>=0);
  const extraCmp=(u,v)=>{for(const k of extraDims){const c=cmp(v[k],u[k]);if(c)return c;}return 0;};
  const EPS=opts.frontierEps?{p:opts.frontierEps.p??opts.frontierEps,d:opts.frontierEps.d??opts.frontierEps}:null;
  let epsDropped=0;
  function pruneStair(list){
    if(list.length<=1)return list;
    if(fdim==='pd'){
      const sorted=list.slice().sort((u,v)=>cmp(v.p,u.p)||cmp(u.d,v.d)||cmp(u.a,v.a)||extraCmp(u,v));
      const out=[];let bestD=null;
      for(const u of sorted){if(bestD!==null&&cmp(bestD,u.d)<=0)continue;out.push(u);bestD=u.d;}
      if(EPS&&out.length>1){const th=[out[0]];let lp=toNum(out[0].p),ld=toNum(out[0].d);
        for(let i=1;i<out.length;i++){const u=out[i],p=toNum(u.p),d=toNum(u.d);if(lp-p>=EPS.p||ld-d>=EPS.d){th.push(u);lp=p;ld=d;}}
        epsDropped+=out.length-th.length;return th;}
      return out;
    }
    const sorted=list.slice().sort((u,v)=>cmp(v.p,u.p)||cmp(Dv(u),Dv(v))||cmp(Av(u),Av(v))||extraCmp(u,v));
    const out=[],stair=[];
    for(const u of sorted){
      let lo=0,hi=stair.length-1,j=-1;
      while(lo<=hi){const mid=(lo+hi)>>1;if(cmp(Dv(stair[mid]),Dv(u))<=0){j=mid;lo=mid+1;}else hi=mid-1;}
      if(j>=0&&cmp(Av(stair[j]),Av(u))<=0)continue;
      out.push(u);
      let k=j+1;while(k<stair.length&&cmp(Av(stair[k]),Av(u))>=0)k++;
      stair.splice(j+1,k-(j+1),u);
    }
    return out;
  }
  function extras2D(g){
    if(g.length<=1)return g;
    const [k1,k2]=extraDims;
    if(!k2){let b=g[0];for(const u of g)if(cmp(u[k1],b[k1])>0)b=u;return [b];}
    const s=g.slice().sort((u,v)=>cmp(v[k1],u[k1])||cmp(v[k2],u[k2]));const out=[];let m=null;
    for(const u of s){if(m!==null&&cmp(u[k2],m)<=0)continue;out.push(u);m=u[k2];}
    return out;
  }
  function pruneGroups(list){
    if(list.length<=1)return list;
    const sorted=list.slice().sort((u,v)=>cmp(v.p,u.p)||cmp(Dv(u),Dv(v))||cmp(Av(u),Av(v)));
    const out=[],stair=[];let bestD=null;
    for(let i=0;i<sorted.length;){
      const r=sorted[i];let j=i+1;
      if(fdim==='pd'){while(j<sorted.length&&eqR(sorted[j].p,r.p)&&eqR(sorted[j].d,r.d))j++;}
      else{while(j<sorted.length&&eqR(sorted[j].p,r.p)&&eqR(Dv(sorted[j]),Dv(r))&&eqR(Av(sorted[j]),Av(r)))j++;}
      let grp=sorted.slice(i,j);i=j;
      if(fdim==='pd'){grp=grp.filter(u=>eqR(u.a,r.a));
        if(bestD!==null&&cmp(bestD,r.d)<=0)continue;bestD=r.d;}
      else{let lo=0,hi=stair.length-1,q=-1;
        while(lo<=hi){const mid=(lo+hi)>>1;if(cmp(Dv(stair[mid]),Dv(r))<=0){q=mid;lo=mid+1;}else hi=mid-1;}
        if(q>=0&&cmp(Av(stair[q]),Av(r))<=0)continue;
        let k=q+1;while(k<stair.length&&cmp(Av(stair[k]),Av(r))>=0)k++;stair.splice(q+1,k-(q+1),r);}
      for(const u of extras2D(grp))out.push(u);
    }
    return out;
  }
  function pruneLexFull(list){
    if(list.length<=1)return list;
    let b=list[0];for(const u of list)if(lexCmpPDA(u,b)>0)b=u;
    return extras2D(list.filter(u=>lexCmpPDA(u,b)===0));
  }
  function prune(list){
    if(lexFull)return pruneLexFull(list);
    if(mode!=='full')return pruneStair(list);
    if(reduceX)return pruneGroups(list);
    const out=[];
    for(const u of list){
      if((++segChecks&1023)===0&&late())throw Error('TIME_LIMIT');
      if(out.some(v=>dominates(v,u,dims)))continue;
      for(let i=out.length-1;i>=0;i--)if(dominates(u,out[i],dims))out.splice(i,1);
      out.push(u);
    }
    return out;
  }
  const lexCmp=(u,v)=>{for(const k of lexKey){const c=better(u,v,k);if(c)return c;}return 0;};
  const lexKeyPDA=lexKey.filter(k=>k==='p'||k==='d'||k==='a');
  const lexCmpPDA=(u,v)=>{for(const k of lexKeyPDA){const c=better(u,v,k);if(c)return c;}return 0;};
  const sig=list=>list.map(v=>dims.map(k=>str(v[k])).join(',')).sort().join(';');
  const samePt=(u,v)=>dims.every(k=>u[k]===v[k]||(u[k]!==null&&v[k]!==null&&eqR(u[k],v[k])));
  function sameSet(a,b){if(a===b)return true;if(!a||!b||a.length!==b.length)return false;if(a.length>12)return sig(a)===sig(b);
    for(const u of a){let hit=false;for(const v of b)if(samePt(u,v)){hit=true;break;}if(!hit)return false;}return true;}
  const same=(u,v)=>dims.every(k=>cmp(u[k],v[k])===0);
  const Rg=new Map();const RG=g=>{let r=Rg.get(g);if(!r){r=R(g);Rg.set(g,r);}return r;};
  function combine(u,p,g,c){
    const v={p:add(u.p,mul(p,c.p)),d:add(u.d,mul(p,c.d)),a:add(u.a,mul(p,c.a))};
    if(useEv)v.ev=add(u.ev,mul(p,add(RG(g),c.ev)));
    if(useFl){const f=add(RG(g),c.fl);v.fl=u.fl===null||cmp(f,u.fl)<0?f:u.fl;}
    return v;
  }
  const START=()=>({p:ZERO,d:ZERO,a:ZERO,ev:ZERO,fl:null});
  const withCost=(u,dc,ac)=>mk(u.p,add(u.d,dc),add(u.a,ac),u.ev,u.fl);

  const canCut=cut&&(!extras.length||reduceX);
  const cutOk=id=>{if(!extras.length)return true;for(let ai=actStart.a[id];ai<actStart.a[id+1];ai++)if(actFlag.a[ai]&2)return false;return true;};
  const E=model.engine&&model.engine.transition?model.engine:null;
  const R0=opts.resume||null;
  const probIdx=R0?.probIdx??new Map(),probs=R0?.probs??[];
  const probOfR=r=>{const k=r.n+'/'+r.d;let i=probIdx.get(k);if(i===undefined){i=probs.length;probs.push(r);probIdx.set(k,i);}return i;};
  const probQ=R0?.probQ??new Map();
  if(R0){R0.probIdx=probIdx;R0.probs=probs;R0.probQ=probQ;}
  const probOfQ=p=>{if(p[1]<67108864&&p[0]<67108864){const k=p[0]*67108864+p[1];let i=probQ.get(k);if(i===undefined){i=probOfR(R(p[0],p[1]));probQ.set(k,i);}return i;}
    return probOfR(R(p[0],p[1]));};
  const keyOf=E?s=>s.key:s=>model.solKey(s);
  const W=E?(s,x)=>E.withScore(s,x):(s,x)=>model.withScore(s,x);
  const choicesOf=E?s=>E.choices(s):s=>model.choices(s);
  const branchesOf=E?(s,a)=>{const bs=E.transition(s,a).branches;for(const b of bs)b.pi=probOfQ(b.p);return bs;}:(s,a)=>model.branches(s,a).map(b=>({pi:probOfR(b.p),pq:null,s:b.s}));
  const sameProb=(a,b)=>a.pi===b.pi;
  const prepare=!!opts.prepare;
  const rootNeed=prepare?Infinity:model.target-model.root.score;
  const G0=R0?.g;
  const nodeK=G0?.nodeK??new Grow(Int8Array),minNeed=G0?.minNeed??new Grow(Uint32Array),actStart=G0?.actStart??new Grow(Int32Array);
  const actFlag=G0?.actFlag??new Grow(Uint8Array),brStart=G0?.brStart??new Grow(Int32Array);
  const brChild=G0?.brChild??new Grow(Int32Array),brGain=G0?.brGain??new Grow(Uint32Array),brProb=G0?.brProb??new Grow(Int32Array),pathGain=G0?.pathGain??new Grow(Uint32Array),dropF=G0?.dropF??new Grow(Uint8Array);
  if(R0&&!G0)R0.g={nodeK,minNeed,actStart,actFlag,brStart,brChild,brGain,brProb,pathGain,dropF};
  let curves=null,maxGain=null,LOST=null;
  const layerCap=opts.layerCap||0;let dropped=R0?.dropped??0;epsDropped=R0?.epsDropped??0;
  let segsOwn=R0?.segsOwn??0;
  let transitions=R0?.transitions??0,invarianceChecks=R0?.invarianceChecks??0,horizonCut=R0?.horizonCut??0,peakFrontier=0,segmentsTotal=0,maxLayer=R0?.maxLayer??0,cutNodes=0;
  const heapMiB=()=>globalThis.process?.memoryUsage?.().heapUsed/1048576||0;
  let fwRef=null;const EST={state:opts.estState??700,table:opts.estTable??6000,seg:opts.estSeg??300,base:opts.estBase??300*1048576};
  const GROWS=()=>[nodeK,minNeed,actStart,actFlag,brStart,brChild,brGain,brProb,pathGain,dropF];
  function estParts(){let typed=0;for(const g of GROWS())typed+=g.a.byteLength;if(maxGain)typed+=maxGain.byteLength;
    const live=fwRef?(fwRef.next?fwRef.next.length:0)+Math.max(0,fwRef.layer.length-fwRef.li):0;
    const es=E?.stats?.();const tables=es?es.beliefs+es.effLists:0;
    return {typed,live,tables,segs:segsOwn,est:typed+EST.state*live+EST.table*tables+EST.seg*segsOwn+EST.base};}
  const estMiB=()=>estParts().est/1048576;
  let chk=0;const check=()=>{if(Date.now()-started>maxMs)throw Error('TIME_LIMIT');if(nodeK.n>maxStates)throw Error('STATE_LIMIT');
    if((++chk&63)===0){if(opts.maxHeapMiB&&heapMiB()>opts.maxHeapMiB)throw Error('MEMORY_LIMIT');if(opts.onEst)opts.onEst(estParts());if(opts.maxEstMiB&&estMiB()>opts.maxEstMiB)throw Error('MEMORY_LIMIT');}};
  function checkInvariance(s0,act,br){
    const x=prepare?1000003:Math.max(1,Math.floor(rootNeed/2)),bx=branchesOf(W(s0,x),act);invarianceChecks++;
    if(bx.length!==br.length)throw Error('SCORE_DEPENDENCE');
    for(let i=0;i<br.length;i++){const a=br[i],b=bx[i];if(!sameProb(a,b)||b.s.score-a.s.score!==x||keyOf(a.s)!==keyOf(b.s))throw Error('SCORE_DEPENDENCE');}
  }
  let pUB=undefined,ubNote=null,pDrop=undefined,rootMs=null;let status='complete',reason=null,root=null,forwardMs=0,backwardMs=0,ranForward=false;
  try{
    if(rootNeed<=0)root=GOAL;
    else if(opts.graph){
      const G=opts.graph;const put=(g,a)=>{g.a=a;g.n=a.length;};
      put(nodeK,G.nodeK);put(minNeed,G.minNeed??G.pathGain.map(x=>Math.max(1,rootNeed-x)));put(actStart,G.actStart);put(actFlag,G.actFlag);put(brStart,G.brStart);put(brChild,G.brChild);put(brGain,G.brGain);put(brProb,G.brProb);if(G.pathGain)put(pathGain,G.pathGain);
      if(G.probsR)probs.push(...G.probsR);else for(const [n,d] of G.probs)probs.push(R(n,d));
      ({transitions,invarianceChecks,horizonCut,maxLayer}=G.stats);forwardMs=G.forwardMs;
    }
    if(rootNeed>0&&!opts.graph&&!(R0&&R0.forwardDone)){
      const evictAt=layerCap&&opts.capEvict?Math.ceil(layerCap*opts.capEvict):0;
      const evict=(next,nf)=>{const idx=[];for(let i=0;i<next.length;i++)if(next[i]!==null)idx.push(i);idx.sort((x,y)=>(pathGain.a[nf+y]-pathGain.a[nf+x])||(x-y));
        for(let j=layerCap;j<idx.length;j++){next[idx[j]]=null;dropF.a[nf+idx[j]]=1;dropped++;}fw.live=Math.min(idx.length,layerCap);};
      const stream=!!(layerCap&&opts.capStream);
      const scoreOf=(st,pg)=>opts.capScore?opts.capScore(st,pg):pg;
      const hPush=(h,v,i)=>{h.v.push(v);h.i.push(i);let c=h.v.length-1;while(c>0){const p=(c-1)>>1;if(h.v[p]<=h.v[c])break;[h.v[p],h.v[c]]=[h.v[c],h.v[p]];[h.i[p],h.i[c]]=[h.i[c],h.i[p]];c=p;}};
      const hPop=h=>{const v=h.v[0],i=h.i[0],lv=h.v.pop(),li=h.i.pop();if(h.v.length){h.v[0]=lv;h.i[0]=li;let c=0;for(;;){const l=2*c+1,r=l+1;let m=c;if(l<h.v.length&&h.v[l]<h.v[m])m=l;if(r<h.v.length&&h.v[r]<h.v[m])m=r;if(m===c)break;[h.v[m],h.v[c]]=[h.v[c],h.v[m]];[h.i[m],h.i[c]]=[h.i[c],h.i[m]];c=m;}}return [v,i];};
      const hMin=(h,next,sc)=>{while(h.v.length&&(next[h.i[0]]===null||sc[h.i[0]]!==h.v[0]))hPop(h);return h.v.length?h.v[0]:-Infinity;};
      const reach=opts.capReach?[1]:null;
      const actEnd=id=>id+1<actStart.n?actStart.a[id+1]:actFlag.n,brEnd=ai=>ai+1<brStart.n?brStart.a[ai+1]:brChild.n;
      const addReach=(first,len)=>{for(let id=first;id<first+len;id++){const r=reach[id]||0;if(!r)continue;const best=new Map();
        for(let ai=actStart.a[id];ai<actEnd(id);ai++){const sum=new Map();for(let bi=brStart.a[ai];bi<brEnd(ai);bi++){const c=brChild.a[bi];if(c<0)continue;sum.set(c,(sum.get(c)||0)+toNum(probs[brProb.a[bi]]));}
          for(const [c,v] of sum)if(v>(best.get(c)||0))best.set(c,v);}
        for(const [c,v] of best)reach[c]=(reach[c]||0)+r*v;}};
      ranForward=true;let fw=R0?.fw??null;fwRef=fw;
      if(!fw){const s0=W(model.root,0);nodeK.push(maxOps);minNeed.push(rootNeed);pathGain.push(0);dropF.push(0);fw={k:maxOps,li:0,layer:[s0],layerFirst:0,ids:null,next:null,nextFirst:0};if(R0)R0.fw=fw;fwRef=fw;}
      for(;fw.k>=0&&fw.layer.length;fw.k--){
        const k=fw.k;
        if(!fw.ids){fw.ids=new BigMap(opts.mapLimit);fw.next=[];fw.nextFirst=nodeK.n;fw.li=0;fw.live=0;fw.sink=-1;fw.hp={v:[],i:[]};fw.sc=[];maxLayer=Math.max(maxLayer,fw.layer.length);}
        const {ids,next,layer,layerFirst}=fw;
        for(;fw.li<layer.length;fw.li++){const li=fw.li;
          if((li&255)===0)check();
          const s=layer[li],id=layerFirst+li;layer[li]=null;progressed=true;
          actStart.push(actFlag.n);
          if(s===null)continue;
          if(k===0){if(choicesOf(s).length)horizonCut++;continue;}
          const need=minNeed.a[id];
          for(const act of choicesOf(s)){
            const br=branchesOf(s,act);transitions++;if(transitions%checkEvery===0)checkInvariance(s,act,br);
            actFlag.push((act.type==='drink'?1:0)|(act.type==='skip'?2:0));brStart.push(brChild.n);
            for(const b of br){
              const g=b.s.score;if(!Number.isSafeInteger(g)||g<0)throw Error('NEGATIVE_GAIN');
              brGain.push(g);brProb.push(b.pi);
              if(g>=rootNeed){brChild.push(-1);continue;}
              const childNeed=need-g,ck=keyOf(b.s);let cid=ids.get(ck);
              const pg=pathGain.a[id]+g;
              if(cid===undefined&&stream){const sc=scoreOf(b.s,pg);
                if(fw.live>=layerCap&&sc<=hMin(fw.hp,next,fw.sc)){
                  if(fw.sink<0){fw.sink=nodeK.n;nodeK.push(k-1);minNeed.push(1);pathGain.push(pg);dropF.push(1);next.push(null);fw.sc.push(-Infinity);}
                  dropped++;brChild.push(fw.sink);continue;}
                cid=nodeK.n;ids.set(ck,cid);if(opts.onNode)opts.onNode(cid,b.s);nodeK.push(k-1);minNeed.push(Math.max(1,childNeed));pathGain.push(pg);dropF.push(0);next.push(E?(b.s.score=0,b.s):W(b.s,0));
                const li2=next.length-1;fw.sc.push(sc);hPush(fw.hp,sc,li2);
                if(++fw.live>layerCap){hMin(fw.hp,next,fw.sc);const [,j]=hPop(fw.hp);next[j]=null;dropF.a[fw.nextFirst+j]=1;dropped++;fw.live--;}
                brChild.push(cid);continue;}
              if(cid===undefined){cid=nodeK.n;ids.set(ck,cid);if(opts.onNode)opts.onNode(cid,b.s);nodeK.push(k-1);minNeed.push(Math.max(1,childNeed));pathGain.push(pg);dropF.push(0);next.push(E?(b.s.score=0,b.s):W(b.s,0));
                if(evictAt&&++fw.live>evictAt)evict(next,fw.nextFirst);}
              else{if(childNeed<minNeed.a[cid])minNeed.set(cid,Math.max(1,childNeed));if(pg>pathGain.a[cid]){pathGain.set(cid,pg);
                if(stream){const j=cid-fw.nextFirst;if(j>=0&&next[j]!==null){const sc=scoreOf(next[j],pg);if(sc!==fw.sc[j]){fw.sc[j]=sc;hPush(fw.hp,sc,j);}}}}}
              brChild.push(cid);
            }
          }
        }
        if(reach)addReach(layerFirst,layer.length);
        fw.layer=next;fw.layerFirst=fw.nextFirst;fw.ids=null;fw.next=null;fw.hp=null;fw.sc=null;
        if(opts.growthLimit&&!layerCap&&layer.length){const L=next.length;if(nodeK.n+L*(L/layer.length)>opts.growthLimit)throw Error('GROWTH_LIMIT');}
        const lay=fw.layer,lf=fw.layerFirst;
        if(layerCap&&lay.length>layerCap&&(opts.capScore||reach)){const idx=[],sc=new Float64Array(lay.length);for(let i=0;i<lay.length;i++)if(lay[i]!==null){idx.push(i);sc[i]=reach?(reach[lf+i]||0):opts.capScore(lay[i],pathGain.a[lf+i]);}
          idx.sort((x,y)=>(sc[y]-sc[x])||(pathGain.a[lf+y]-pathGain.a[lf+x])||(x-y));
          let keep=new Uint8Array(lay.length),kept=0;
          if(opts.capMix){const byPg=idx.slice().sort((x,y)=>(pathGain.a[lf+y]-pathGain.a[lf+x])||(x-y));const q=Math.floor(layerCap*opts.capMix);for(let j=0;j<q;j++){keep[byPg[j]]=1;kept++;}}
          for(const i of idx){if(kept>=layerCap)break;if(!keep[i]){keep[i]=1;kept++;}}
          for(const i of idx)if(!keep[i]){lay[i]=null;dropF.a[lf+i]=1;dropped++;}}
        else if(layerCap&&lay.length>layerCap){const idx=[];for(let i=0;i<lay.length;i++)if(lay[i]!==null)idx.push(i);idx.sort((x,y)=>(pathGain.a[lf+y]-pathGain.a[lf+x])||(x-y));
          for(let j=layerCap;j<idx.length;j++){lay[idx[j]]=null;dropF.a[lf+idx[j]]=1;dropped++;}}
      }
      actStart.push(actFlag.n);brStart.push(brChild.n);
      fwRef=null;if(R0){R0.forwardDone=true;R0.fw=null;}
      forwardMs=Date.now()-started;
    }
    if(rootNeed>0){
      const N=nodeK.n;if(N>maxStates)throw Error('STATE_LIMIT');
      if(opts.graph?.maxGain)maxGain=opts.graph.maxGain;else if(R0?.maxGain)maxGain=R0.maxGain;else{maxGain=new Float64Array(N);if(R0)R0.maxGain=maxGain;
      for(let id=N-1;id>=0;id--){let m=0;for(let ai=actStart.a[id];ai<actStart.a[id+1];ai++)for(let bi=brStart.a[ai];bi<brStart.a[ai+1];bi++){const c=brChild.a[bi];const v=brGain.a[bi]+(c>=0?maxGain[c]:0);if(v>m)m=v;}maxGain[id]=m;}}
      if(prepare){const sl=(g,T)=>g.a.slice(0,g.n);
        return {graph:{nodeK:sl(nodeK),pathGain:sl(pathGain),actStart:sl(actStart),actFlag:sl(actFlag),brStart:sl(brStart),brChild:sl(brChild),brGain:sl(brGain),brProb:sl(brProb),
          probsR:probs.slice(),maxGain,forwardMs,stats:{transitions,invarianceChecks,horizonCut,maxLayer,dropped}},status:'prepared',stats:{nodes:N,transitions,forwardMs,dropped,horizonCut}};}
      curves=R0?.curves??new Array(N);let id0=R0?.bid??N-1;if(R0)R0.curves=curves;
      for(let id=id0;id>=0;id--){
        if(R0)R0.bid=id;
        if((id&(R0?63:1023))===0&&Date.now()-started>maxMs)throw Error('TIME_LIMIT');
        if((id&1023)===0){if(opts.maxHeapMiB&&heapMiB()>opts.maxHeapMiB)throw Error('MEMORY_LIMIT');if(opts.onEst&&(id&16383)===0)opts.onEst(estParts());if(opts.maxEstMiB&&estMiB()>opts.maxEstMiB)throw Error('MEMORY_LIMIT');}
        const tR=id===0?Date.now():0;curves[id]=lexMode?rangeLex(id):range(id);progressed=true;if(id===0)rootMs=Date.now()-tR;
      }
      if(R0)R0.bid=-1;
      backwardMs=Date.now()-started-(opts.graph?0:forwardMs);
      root=at(curves[0],rootNeed);
      if(dropped&&opts.upperBound===true){try{pUB=upperP(N);}catch(e){if(e.message!=='TIME_LIMIT')throw e;pUB=null;ubNote='時間切れで上限を計算できなかった';}}
      if(dropped&&opts.upperBound===true&&opts.dropReach){try{pDrop=upperP(N,false);}catch(e){if(e.message!=='TIME_LIMIT')throw e;pDrop=null;}}
    }
  }catch(e){if(!['TIME_LIMIT','STATE_LIMIT','FRONTIER_LIMIT','MEMORY_LIMIT','GROWTH_LIMIT'].includes(e.message))throw e;status='incomplete';reason=e.message;}
  if(R0){R0.segsOwn=segsOwn;R0.transitions=transitions;R0.invarianceChecks=invarianceChecks;R0.horizonCut=horizonCut;R0.maxLayer=maxLayer;R0.dropped=dropped;R0.epsDropped=epsDropped;if(ranForward)R0.forwardMs=(R0.forwardMs||0)+(forwardMs||Date.now()-started);R0.calls=(R0.calls||0)+1;}
  function at(curve,n){
    if(n<=0)return GOAL;if(n<curve[0].from)throw Error('CURVE_RANGE');
    let lo=0,hi=curve.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(curve[mid].from<=n)lo=mid;else hi=mid-1;}return curve[lo].pts;
  }
  function upperP(N,goalOne=true){const GOALV=goalOne?ONE:ZERO;
    const UB=new Array(N),ONE_C=[{from:1,p:ONE}],ZERO_C=[{from:1,p:ZERO}];
    const atP=(c,n)=>{if(n<=0)return GOALV;let lo=0,hi=c.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(c[mid].from<=n)lo=mid;else hi=mid-1;}return c[lo].p;};
    for(let id=N-1;id>=0;id--){
      if((id&1023)===0&&Date.now()-started>maxMs*(opts.upperBoundFrac??1.5))throw Error('TIME_LIMIT');
      const a0=actStart.a[id],a1=actStart.a[id+1];
      if(dropF.a[id]){UB[id]=ONE_C;continue;}if(a0===a1){UB[id]=ZERO_C;continue;}
      const lo=minNeed.a[id],bp=new Set([lo]);
      for(let bi=brStart.a[a0];bi<brStart.a[a1];bi++){const g=brGain.a[bi],c=brChild.a[bi];if(g+1>lo&&g+1<=rootNeed)bp.add(g+1);
        if(c>=0)for(const seg of UB[c]){const t=g+seg.from;if(t>lo&&t<=rootNeed)bp.add(t);}}
      const ts=[...bp].sort((x,y)=>x-y),cur=[];
      for(const t of ts){let best=ZERO;
        for(let ai=a0;ai<a1;ai++){let p=ZERO;for(let bi=brStart.a[ai];bi<brStart.a[ai+1];bi++){const g=brGain.a[bi],c=brChild.a[bi];
            const q=g>=t?GOALV:atP(UB[c],t-g);if(q.n!==0n)p=add(p,mul(probs[brProb.a[bi]],q));}
          if(cmp(p,best)>0)best=p;}
        if(!cur.length||cmp(cur[cur.length-1].p,best)!==0)cur.push({from:t,p:best});}
      UB[id]=cur;
    }
    return atP(UB[0],rootNeed);
  }
  function breaks(ai,lo,hi){const bp=new Set([lo]);
    for(let bi=brStart.a[ai];bi<brStart.a[ai+1];bi++){const g=brGain.a[bi],c=brChild.a[bi];if(g+1>lo&&g+1<=hi)bp.add(g+1);if(c>=0)for(const seg of curves[c]){const t=g+seg.from;if(t>lo&&t<=hi)bp.add(t);}}
    return [...bp].sort((x,y)=>x-y);}
  function finish(curve,lo,hiCut){
    if(hiCut!==null&&hiCut<=rootNeed&&!sameSet(curve[curve.length-1].pts,STOP_LIST))curve.push({from:hiCut,pts:STOP_LIST});
    segmentsTotal+=curve.length;segsOwn+=curve.length;return curve;}
  function range(id){
    const lo=minNeed.a[id],a0=actStart.a[id],a1=actStart.a[id+1];
    let hi=rootNeed,hiCut=null;
    if(canCut&&cutOk(id)){if(lo>maxGain[id]){cutNodes++;segmentsTotal++;return LEAF;}if(maxGain[id]<rootNeed){hi=maxGain[id];hiCut=maxGain[id]+1;}}
    if(a0===a1){segmentsTotal++;return LEAF;}
    const actionCurves=[];
    for(let ai=a0;ai<a1;ai++){
      const b0=brStart.a[ai],b1=brStart.a[ai+1];
      const ts=breaks(ai,lo,hi),dc=actFlag.a[ai]&1?ONE:ZERO,ac=actFlag.a[ai]&2?ZERO:ONE,segs=[];
      for(const t of ts){
        if((++segChecks&255)===0&&late())throw Error('TIME_LIMIT');
        let partial=[START()];
        for(let bi=b0;bi<b1;bi++){
          const g=brGain.a[bi],p=probs[brProb.a[bi]];
          const child=t-g<=0?GOAL:at(curves[brChild.a[bi]],t-g),next=[];
          for(const u of partial)for(const c of child)next.push(combine(u,p,g,c));
          if(next.length>64&&late())throw Error('TIME_LIMIT');
          partial=prune(next);if(partial.length>maxFrontier)throw Error('FRONTIER_LIMIT');
        }
        segs.push({from:t,pts:partial.map(u=>withCost(u,dc,ac))});
      }
      actionCurves.push(segs);
    }
    const all=new Set([lo]);for(const segs of actionCurves)for(const sg of segs)all.add(sg.from);
    const ts=[...all].sort((x,y)=>x-y),curve=[];let last=null;
    for(const t of ts){
      let list=[STOP];for(const segs of actionCurves)list=list.concat(at(segs,t));
      if(list.length>64&&late())throw Error('TIME_LIMIT');
      list=prune(list);peakFrontier=Math.max(peakFrontier,list.length);
      if(!sameSet(list,last)){curve.push({from:t,pts:list});last=list;}
    }
    return finish(curve,lo,hiCut);
  }
  function rangeLex(id){
    const lo=minNeed.a[id],a0=actStart.a[id],a1=actStart.a[id+1];
    let hi=rootNeed,hiCut=null;
    if(canCut&&cutOk(id)){if(lo>maxGain[id]){cutNodes++;segmentsTotal++;return LEAF;}if(maxGain[id]<rootNeed){hi=maxGain[id];hiCut=maxGain[id]+1;}}
    if(a0===a1){segmentsTotal++;return LEAF;}
    const actionCurves=[];
    for(let ai=a0;ai<a1;ai++){
      const b0=brStart.a[ai],b1=brStart.a[ai+1];
      const ts=breaks(ai,lo,hi),dc=actFlag.a[ai]&1?ONE:ZERO,ac=actFlag.a[ai]&2?ZERO:ONE,segs=[];
      for(const t of ts){
        let u=START();
        for(let bi=b0;bi<b1;bi++){const g=brGain.a[bi];u=combine(u,probs[brProb.a[bi]],g,(t-g<=0?GOAL:at(curves[brChild.a[bi]],t-g))[0]);}
        segs.push({from:t,pts:[withCost(u,dc,ac)]});
      }
      actionCurves.push(segs);
    }
    const all=new Set([lo]);for(const segs of actionCurves)for(const sg of segs)all.add(sg.from);
    const ts=[...all].sort((x,y)=>x-y),curve=[];let last=null;
    for(const t of ts){
      let b=STOP;for(const segs of actionCurves){const v=at(segs,t)[0];if(lexCmp(v,b)>0)b=v;}
      if(!last||!samePt(b,last[0])){last=[b];curve.push({from:t,pts:last});}
    }
    return finish(curve,lo,hiCut);
  }
  const mem=globalThis.process?.memoryUsage?.();
  const stats={rootMs,extrasMode:mode,reduce:reduceX,frontierDims:lexMode?'lex':lexFull?'lex-full':fdim,nodes:nodeK.n,branches:brChild.n,actions:actFlag.n,transitions,invarianceChecks,horizonCut,cutNodes,peakFrontier,segmentsTotal,forwardMs,backwardMs,elapsedMs:Date.now()-started,maxLayer,
    probs:probs.length,engine:E?.stats?.()??null,heapUsedMiB:mem?Math.round(mem.heapUsed/1048576):null};
  const scopeOf=()=>horizonCut===0?'上限なしでも最適（操作数の上限 '+maxOps+' で切った状態は0件）':'操作数の上限 '+maxOps+' の範囲での最適（上限で切った状態 '+horizonCut+' 件）';
  if(!root)return {status,reason,stats,kind:'incomplete',kindLabel:'未完了'};
  if(dropped){stats.dropped=dropped;}
  if(opts.exposeGraph&&maxGain)stats.graph={N:nodeK.n,minNeed:minNeed.a,maxGain,actStart:actStart.a,brStart:brStart.a,brChild:brChild.a,brGain:brGain.a,brProb:brProb.a,actFlag:actFlag.a,nodeK:nodeK.a,curves,probs};
  const alpha0=alpha;
  return resultAt(model.root,0,root,[]);
  function resultAt(rootS,rootI,root,path){
    let alpha=alpha0;
    const pmax=root.reduce((m,v)=>cmp(v.p,m)>0?v.p:m,ZERO);
    if(criterion==='max')alpha=pmax;
    const feasible=root.filter(v=>cmp(v.p,alpha)>=0);
    feasible.sort((u,v)=>{for(const k of lex){const c=better(v,u,k);if(c)return c;}return 0;});
    const best=feasible[0]??null,ties=best?feasible.filter(v=>lex.every(k=>cmp(v[k],best[k])===0)).length:0;
    const rootScore=R(rootS.score);
    const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}
      if(useEv){const x=add(rootScore,v.ev);o.ev=str(x);o.evNum=toNum(x);}
      if(useFl){const x=add(rootScore,v.fl);o.floor=str(x);o.floorNum=toNum(x);}return o;};
    const table=alphas=>alphas.map(a=>{const f=root.filter(v=>cmp(v.p,a)>=0).sort((u,v)=>{for(const k of lex){const c=better(v,u,k);if(c)return c;}return 0;});return {alpha:str(a),best:f[0]?summarize(f[0]):null};});
    function lostPlay(){if(LOST)return LOST;const N=nodeK.n,ev=new Float64Array(N),ai=new Int32Array(N).fill(-1),P=probs.map(toNum);
      for(let v=N-1;v>=0;v--){let be=0,ba=-1;const a0=actStart.a[v];
        for(let a=a0;a<actStart.a[v+1];a++){if((actFlag.a[a]&1)&&opts.playOnLostDrinks===false)continue;let e=0;for(let bi=brStart.a[a];bi<brStart.a[a+1];bi++){const c=brChild.a[bi];e+=P[brProb.a[bi]]*(brGain.a[bi]+(c>=0?ev[c]:0));}
          if(e>be+1e-9){be=e;ba=a-a0;}}
        ev[v]=be;ai[v]=ba;}
      return LOST={ev,ai};}
    function extract(target=best){
      if(!target||!curves)return null;const out=[];let altNodes=0,decisionNodes=0,rootTies=null;
      const memo=new Map();const ptKey=v=>dims.map(k=>v[k]===null||v[k]===undefined?'':str(v[k])).join(',');
      const hitOf=(s,id,n,v,act,ai)=>{
        const br=model.branches(s,act),dc=act.type==='drink'?ONE:ZERO,ac=act.type==='skip'?ZERO:ONE;const a0=actStart.a[id];
        const b0=brStart.a[a0+ai];if(brStart.a[a0+ai+1]-b0!==br.length)throw Error('EXTRACT_GRAPH');
        let partial=[{...START(),picks:null}];
        for(let i=0;i<br.length;i++){const b=br[i];
          const g=b.s.score-s.score,child=g>=n?GOAL:at(curves[brChild.a[b0+i]],n-g),next=[];
          for(const u of partial)for(const c of child)next.push({...combine(u,b.p,g,c),picks:{prev:u.picks,c}});
          partial=lexMode?next:prune(next);
        }
        const hit=partial.find(u=>same(withCost(u,dc,ac),v));return hit?{hit,br,b0}:null;};
      function build(s,id,v,isRoot){
        const n=model.target-s.score;
        const mk=n<=0?'G|'+model.v6key(s):id+'|'+n+'|'+ptKey(v);if(!isRoot){const h=memo.get(mk);if(h!==undefined)return h;}
        if(n<=0){out.push({id:out.length,key:model.v6key(s),choice:null,edges:[]});memo.set(mk,out.length-1);return out.length-1;}
        const a0=actStart.a[id];const acts=actStart.a[id+1]===a0?[]:model.choices(s);
        if(actStart.a[id+1]-a0!==acts.length)throw Error('EXTRACT_GRAPH');
        let ties=same(v,STOP)?1:0,chosen=null;
        for(let ai=0;ai<acts.length;ai++){const h=hitOf(s,id,n,v,acts[ai],ai);if(h){ties++;if(!chosen&&!same(v,STOP))chosen={...h,act:acts[ai]};}}
        if(acts.length){decisionNodes++;if(ties>1)altNodes++;}
        if(isRoot)rootTies=ties;
        if(same(v,STOP)){
          const L=opts.playOnLost&&acts.length&&maxGain&&maxGain[id]<n?lostPlay():null;const li=L?L.ai[id]:-1;
          if(li>=0){const act=acts[li],br=model.branches(s,act),b0=brStart.a[a0+li];if(brStart.a[a0+li+1]-b0!==br.length)throw Error('EXTRACT_GRAPH');
            const node={id:out.length,key:model.v6key(s),choice:act.raw??act,edges:null,sameEval:ties,lost:true};out.push(node);memo.set(mk,node.id);
            node.edges=br.map((b,i)=>({index:b.index,p:b.pFloat,key:model.v6key(b.s),drawn:[],next:build(b.s,brChild.a[b0+i],STOP,false)}));return node.id;}
          out.push({id:out.length,key:model.v6key(s),choice:null,edges:[],sameEval:ties});memo.set(mk,out.length-1);return out.length-1;}
        if(!chosen)throw Error('EXTRACT_NO_MATCH');
        const {hit,br,b0,act}=chosen;
        const picks=[];for(let x=hit.picks;x;x=x.prev)picks.push(x.c);picks.reverse();
        const node={id:out.length,key:model.v6key(s),choice:act.raw??act,edges:null,sameEval:ties};out.push(node);memo.set(mk,node.id);
        node.edges=br.map((b,i)=>({index:b.index,p:b.pFloat,key:model.v6key(b.s),drawn:[],next:build(b.s,brChild.a[b0+i],picks[i],false)}));
        return node.id;
      }
      const rootIdx=build(rootS,rootI,target,true);
      return {version:'gas-finite-dag-v1',root:rootIdx,nodes:out,sameEval:{root:rootTies,altNodes,decisionNodes}};
    }
    const approx=dropped||epsDropped;
    const why=[dropped?'層の上限 '+layerCap+' で '+dropped+' 状態を展開しなかった':null,epsDropped?'前線の点を ε で '+epsDropped+' 点間引いた（近似。最適との差は未証明）':null].filter(Boolean).join('、');
    const kindLabel=dropped?'層の上限で展開を絞った範囲での最良（検証済みの方策、最適は未証明）':epsDropped?'前線を ε で間引いた近似の最良（検証済みの方策、最適は未証明）':'最適（証明済み）';
    return {status,reason,stats:{...stats,epsDropped},kind:approx?'restricted':'optimal',kindLabel,scope:approx?why+'範囲での最良（全体での最適は未証明）':scopeOf(),horizonFree:horizonCut===0,optimalityProven:!approx,feasible:!!best,ties,alpha:str(alpha),pMaxWithinHorizon:approx?null:str(pmax),restrictedPMax:approx?str(pmax):undefined,pUpperBound:pUB===undefined?undefined:pUB===null?null:str(pUB),pUpperBoundNum:pUB?toNum(pUB):pUB,...(pDrop!==undefined?{pDropReachNum:pDrop===null?null:toNum(pDrop)}:{}),pUpperBoundNote:pUB===undefined?undefined:pUB===null?ubNote:'層の上限で展開しなかった状態を「必ず届く」とみなした上限（操作数の上限 '+maxOps+' の範囲）。どの方策の達成率もこれを超えない',frontierAtRoot:root.length,
      best:best&&summarize(best),bestRaw:best,frontier:root.map(summarize),frontierRaw:root,lex,extract,summarize,table,follow:p=>follow(p,{s:rootS,id:rootI,path}),retarget,path,maxScore:maxScoreAt(rootS,rootI)};
  }
  function maxScoreAt(s,id){
    if(!maxGain)return null;const need=model.target-s.score;
    if(need<=0||id<0)return {value:s.score,reached:true,exact:false,atLeast:true,note:'目標に届いている'};
    const v=s.score+maxGain[id],reach=maxGain[id]>=need;
    const exact=!reach&&!dropped&&horizonCut===0;
    return {value:v,reached:reach,exact,atLeast:reach,note:reach?'目標以上（目標に届いた先は計算していない）':exact?'正確な最大（最大でもこの点）':dropped?'層の上限で絞った範囲での最大':'操作数の上限 '+maxOps+' の範囲での最大'};
  }
  function retarget(target2,o2={}){
    if(dropped||!(target2<=model.target)||!maxGain||nodeK.n===0)return null;
    const sl=g=>g.a.slice(0,g.n);
    const graph={nodeK:sl(nodeK),pathGain:sl(pathGain),actStart:sl(actStart),actFlag:sl(actFlag),brStart:sl(brStart),brChild:sl(brChild),brGain:sl(brGain),brProb:sl(brProb),
      probsR:probs.slice(),maxGain,forwardMs,stats:{transitions,invarianceChecks,horizonCut,maxLayer}};
    const {alpha:_a,criterion:_c,...base}=opts;
    return solveTomahawk({...model,target:target2},{...base,...o2,maxOps,graph,resume:undefined,layerCap:0});
  }
  function follow(path0,from){
    if(!curves)return null;let s=from?.s??model.root,id=from?.id??0;const full=[...(from?.path??[]),...path0];
    for(const step of path0){
      if(model.target-s.score<=0)throw Error('FOLLOW_REACHED');
      const a0=actStart.a[id];const acts=actStart.a[id+1]===a0?[]:model.choices(s);
      const want=JSON.stringify(step.choice);const ai=acts.findIndex(a=>JSON.stringify(a.raw??a)===want);if(ai<0)throw Error('FOLLOW_ACTION');
      const br=model.branches(s,acts[ai]);const b0=brStart.a[a0+ai];if(brStart.a[a0+ai+1]-b0!==br.length)throw Error('EXTRACT_GRAPH');
      if(!(step.edge>=0&&step.edge<br.length))throw Error('FOLLOW_EDGE');
      s=br[step.edge].s;id=brChild.a[b0+step.edge];
    }
    const n=model.target-s.score;
    if(n>0&&dropF.a[id])return {status:'incomplete',reason:'NOT_EXPANDED',kind:'incomplete',kindLabel:'未完了（層の上限で展開しなかった局面）',path:full,stats};
    return resultAt(s,id,n<=0?GOAL:at(curves[id],n),full);
  }
}

export function solveTomahawkAuto(model,opts={}){
  const steps=opts.horizonSteps??[opts.maxOps??24,48,96];const started=Date.now();const maxMs=opts.maxMs??600000;
  let last=null;const widened=[];
  for(const h of steps){
    const left=maxMs-(Date.now()-started);if(left<=0)break;
    const r=solveTomahawk(model,{...opts,maxOps:h,maxMs:left});
    if(r.status!=='complete'){if(last){last.widened=widened;last.widenNote='上限 '+h+' で解き直す途中で予算を超えたので、上限 '+last.stats.maxOps+' の範囲での最適を返す';return last;}r.widened=widened;return r;}
    r.stats.maxOps=h;last=r;
    if(r.horizonFree){r.widened=widened;return r;}
    widened.push({maxOps:h,horizonCut:r.stats.horizonCut});
  }
  if(last){last.widened=widened;return last;}
  return {status:'incomplete',reason:'TIME_LIMIT',kind:'incomplete',kindLabel:'未完了',widened,stats:{elapsedMs:Date.now()-started}};
}

