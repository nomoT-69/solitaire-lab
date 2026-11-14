import {ZERO,ONE,R,add as addR,mul as mulR,cmp as cmpR,str,toNum} from '../src/rational.mjs?v=1.17.12';
import {heatCapScore} from './estimate.mjs?v=1.17.12';
const add=(x,y)=>{if(x.n===0n)return y;if(y.n===0n)return x;if(x.d===y.d&&x.d===1n)return {n:x.n+y.n,d:1n};return addR(x,y);};
const mul=(x,y)=>{if(x.n===0n||y.n===0n)return ZERO;if(x.n===x.d)return y;if(y.n===y.d)return x;if(x.d===1n&&y.d===1n)return {n:x.n*y.n,d:1n};return mulR(x,y);};
const cmp=(x,y)=>{if(x===y)return 0;if(x.d===y.d)return x.n<y.n?-1:x.n>y.n?1:0;return cmpR(x,y);};
const MAXIMIZE={p:true,ev:true,fl:true,d:false,a:false};
export const DEFAULT_ORDER=['d','p','a'];

export function javelinSupports(opts={}){
  if(opts.criterion!=='max')return {ok:false,reason:'Javelin は届く最大の基準（criterion:\'max\'）だけに対応'};
  const ex=opts.extras||[];if(ex.some(x=>!['ev','floor'].includes(x)))return {ok:false,reason:'未対応の自然さの指標'};
  if(ex.includes('ev')&&ex.includes('floor')&&ex.indexOf('floor')<ex.indexOf('ev'))return {ok:false,reason:'Javelin は floor→ev（重い方式）に対応していない'};
  return {ok:true,reason:null};
}
export function solveJavelin(model,opts={}){
  const {maxOps=24,maxMs=600000,maxMemo=1e6,maxHeapMiB=3000,order=DEFAULT_ORDER,extras=[],prune=true,beam=0,lean=true,dominance=false}=opts;
  for(const x of extras)if(!['ev','floor'].includes(x))throw Error('未対応の自然さの指標: '+x);
  if(extras.includes('ev')&&extras.includes('floor')&&extras.indexOf('floor')<extras.indexOf('ev'))throw Error('Javelin は floor→ev（重い方式）に対応していません。Tomahawk を使ってください');
  const useEv=extras.includes('ev'),useFl=extras.includes('floor');const xd=extras.map(x=>x==='floor'?'fl':x);
  const lexKey=['p',...order.filter(k=>k!=='p'),...xd],pdaKey=lexKey.filter(k=>k==='p'||k==='d'||k==='a');
  const better=(u,v,k)=>{const c=cmp(u[k],v[k]);return MAXIMIZE[k]?c:-c;};
  const lexCmp=(u,v)=>{for(const k of lexKey){const c=better(u,v,k);if(c)return c;}return 0;};
  const pdaCmp=(u,v)=>{for(const k of pdaKey){const c=better(u,v,k);if(c)return c;}return 0;};
  const mk=(p,d,a,ev,fl)=>{const v={p,d,a};if(useEv)v.ev=ev;if(useFl)v.fl=fl;return v;};
  const GOAL=mk(ONE,ZERO,ZERO,ZERO,ZERO),STOP=mk(ZERO,ZERO,ZERO,ZERO,ZERO);
  const RG=new Map();const rg=g=>{let r=RG.get(g);if(!r){r=R(g);RG.set(g,r);}return r;};
  const E=model.engine&&model.engine.transition?model.engine:null;
  const probs=new Map();const rat=p=>{const k=p[0]+'/'+p[1];let r=probs.get(k);if(!r){r=R(p[0],p[1]);probs.set(k,r);}return r;};
  const W=E?(s,x)=>E.withScore(s,x):(s,x)=>model.withScore(s,x);
  const keyOf=E?s=>s.key:s=>model.solKey(s);
  const choicesOf=E?s=>E.choices(s):s=>model.choices(s);
  const branchesOf=E?(s,a)=>E.transition(s,a).branches.map(b=>({p:rat(b.p),pf:b.p[0]/b.p[1],g:b.s.score-s.score,s:b.s})):(s,a)=>model.branches(s,a).map(b=>({p:b.p,pf:b.pFloat??toNum(b.p),g:b.s.score-s.score,s:b.s}));
  const aMin=E?ONE:ZERO;
  const useDom=dominance&&E&&E.heatMonotone&&E.heatMonotone()&&!useEv&&!useFl;
  const domIdx=useDom?new Map():null;let domHits=0;
  const rootNeed=model.target-model.root.score;
  const started=Date.now();let memoSize=opts.memo?opts.memo.size:0,expanded=0,transitions=0,pruned=0,memoHits=0,horizonCut=0,visits=0;
  const memo=opts.memo??new Map();
  const PF=opts.profile?{trMs:0,optMs:0,optCalls:0}:null;const now=()=>performance.now();
  const HS=opts.orderHeat?heatCapScore(model,opts.orderHeat,1,opts.heatOpts||{}):null;
  function expand(e){
    if(e.acts)return e.acts;expanded++;
    const cs=choicesOf(e.s);
    e.acts=cs.map((a,i)=>{const t0=PF?now():0;const br=branchesOf(e.s,a);transitions++;if(PF)PF.trMs+=now()-t0;
      for(const b of br){b.cs=b.s;b.cs=W(b.s,0);b.ck=keyOf(b.cs);if(useDom){b.dk=E.domKey(b.cs);b.h=E.domVal(b.cs);}b.s=null;}
      let h=0;for(const b of br)h+=b.pf*(HS?HS(b.cs,b.g):b.g);
      const ord=br.map((_,j)=>j).sort((x,y)=>br[y].pf-br[x].pf);
      return {i,type:a.type,drink:a.type==='drink',skip:a.type==='skip',h,br,ord};});
    e.order=e.acts.map((_,i)=>i).sort((x,y)=>(e.acts[y].h-e.acts[x].h)||((e.acts[x].drink?1:0)-(e.acts[y].drink?1:0))||(x-y));
    if(beam>0)e.order=e.order.slice(0,beam);
    return e.acts;
  }
  const heap=()=>globalThis.process?.memoryUsage?.().heapUsed/1048576||0;
  function check(){if((++visits&1023)===0){if(Date.now()-started>maxMs)throw Error('TIME_LIMIT');if((visits&65535)===0&&heap()>maxHeapMiB)throw Error('MEMO_LIMIT');}}
  function domBound(b,k,n){const L=domIdx.get(b.dk+'|'+k);if(!L)return null;let best=null;
    for(const {h,e} of L){if(h<b.h)continue;for(const x of e.iv)if(x.lo<=n&&n<=x.hi){if(!best||pdaCmp(x.v,best)<0)best=x.v;break;}}
    if(best)domHits++;return best;}
  function value(key,s,k,n){
    if(n<=0)return {v:GOAL,lo:-Infinity,hi:0};
    const mk2=key+'|'+k;let e=memo.get(mk2);
    if(e){for(const x of e.iv)if(x.lo<=n&&n<=x.hi){memoHits++;return x;}}
    else{if(memoSize>=maxMemo)throw Error('MEMO_LIMIT');e={s,acts:null,iv:[]};memo.set(mk2,e);memoSize++;
      if(useDom){const dk=E.domKey(s)+'|'+k;let L=domIdx.get(dk);if(!L){L=[];domIdx.set(dk,L);}L.push({h:E.domVal(s),e});}}
    check();
    if(k===0){if(choicesOf(e.s).length)horizonCut++;if(lean)e.s=null;const x={lo:1,hi:Infinity,v:STOP,act:-1};e.iv.push(x);return x;}
    const acts=expand(e);
    if(lean)e.s=null;
    let best=STOP,bestAct=-1,lo=1,hi=Infinity;
    for(const ai of e.order){const A=acts[ai];
      const dc=A.drink?ONE:ZERO,ac=A.skip?ZERO:ONE;
      for(const b of A.br){if(b.g>=n)hi=Math.min(hi,b.g);else lo=Math.max(lo,b.g+1);}
      const vals=new Array(A.br.length).fill(null);
      const opt=()=>{let p=ZERO,d=dc,a=ac;
        for(let j=0;j<A.br.length;j++){const b=A.br[j],c=b.g>=n?GOAL:vals[j];
          const u=c||(useDom?domBound(b,k-1,n-b.g):null);
          if(u){p=add(p,mul(b.p,u.p));d=add(d,mul(b.p,u.d));a=add(a,mul(b.p,u.a));}else{p=add(p,b.p);a=add(a,mul(b.p,aMin));}}
        return {p,d,a};};
      if(PF){const t0=now();const o=opt();PF.optMs+=now()-t0;PF.optCalls++;
        if(prune&&bestAct>=0&&pdaCmp(mk(ONE,dc,ac,ZERO,ZERO),best)<0)A.pre0=true;
        if(prune&&bestAct>=0&&pdaCmp(o,best)<0){pruned++;continue;}}
      else if(prune&&bestAct>=0&&pdaCmp(opt(),best)<0){pruned++;continue;}
      A.used=true;
      let cut=false;
      for(const j of A.ord){const b=A.br[j];if(b.g>=n)continue;
        const r=value(b.ck,b.cs,k-1,n-b.g);if(lean)b.cs=null;vals[j]=r.v;lo=Math.max(lo,r.lo+b.g);hi=Math.min(hi,r.hi+b.g);
        if(PF){const t0=now();const o=opt();PF.optMs+=now()-t0;PF.optCalls++;if(prune&&bestAct>=0&&pdaCmp(o,best)<0){cut=true;break;}}
        else if(prune&&bestAct>=0&&pdaCmp(opt(),best)<0){cut=true;break;}}
      if(cut){pruned++;continue;}
      let v=mk(ZERO,dc,ac,ZERO,null);
      for(let j=0;j<A.br.length;j++){const b=A.br[j],c=b.g>=n?GOAL:vals[j];
        const nv=mk(add(v.p,mul(b.p,c.p)),add(v.d,mul(b.p,c.d)),add(v.a,mul(b.p,c.a)),useEv?add(v.ev,mul(b.p,add(rg(b.g),c.ev))):null,null);
        if(useFl){const f=add(rg(b.g),c.fl);nv.fl=v.fl===null||cmp(f,v.fl)<0?f:v.fl;}v=nv;}
      if(lexCmp(v,best)>0){best=v;bestAct=ai;}
    }
    if(lo>n||hi<n)throw Error('JAVELIN_INTERVAL');
    const x={lo,hi,v:best,act:bestAct};e.iv.push(x);return x;
  }
  let status='complete',reason=null,root=null;
  const s0=W(model.root,0);const rootKey=keyOf(s0);
  try{root=rootNeed<=0?{v:GOAL,lo:-Infinity,hi:0,act:-1}:value(rootKey,s0,maxOps,rootNeed);}
  catch(e){if(!['TIME_LIMIT','MEMO_LIMIT'].includes(e.message))throw e;status='incomplete';reason=e.message;}
  if(PF){let acts=0,unused=0,brAll=0,brUnused=0,unusedPre=0,brUnusedPre=0;const byType={};for(const e of memo.values())if(e.acts)for(const A of e.acts){acts++;brAll+=A.br.length;if(!A.used){unused++;brUnused+=A.br.length;byType[A.type]=(byType[A.type]||0)+1;if(A.pre0){unusedPre++;brUnusedPre+=A.br.length;}}}
    PF.unusedByType=byType;PF.unusedPre0=unusedPre;PF.unusedBranchesPre0=brUnusedPre;
    Object.assign(PF,{acts,unusedActs:unused,branches:brAll,unusedBranches:brUnused,trMs:Math.round(PF.trMs),optMs:Math.round(PF.optMs)});}
  const mem=globalThis.process?.memoryUsage?.();
  const stats={profile:PF,dominance:useDom,domHits,memo:memoSize,expanded,transitions,pruned,memoHits,horizonCut,elapsedMs:Date.now()-started,beam,prune,heapUsedMiB:mem?Math.round(mem.heapUsed/1048576):null};
  const scope=beam>0?'試す手を各局面の上位 '+beam+' 個に絞った範囲での最良（全体での最適は未証明'+(horizonCut?'。操作数の上限 '+maxOps+' で切った状態 '+horizonCut+' 件':'')+'）'
    :horizonCut===0?'上限なしでも最適（操作数の上限 '+maxOps+' で切った状態は0件）':'操作数の上限 '+maxOps+' の範囲での最適（上限で切った状態 '+horizonCut+' 件）';
  if(!root)return {status,reason,stats,kind:'incomplete',kindLabel:'未完了'};
  const rootScore=R(model.root.score);
  const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}
    if(useEv){const x=add(rootScore,v.ev);o.ev=str(x);o.evNum=toNum(x);}if(useFl){const x=add(rootScore,v.fl);o.floor=str(x);o.floorNum=toNum(x);}return o;};
  function extract(){
    const out=[];
    function build(s,k,n){
      const node={id:out.length,key:model.v6key(s),choice:null,edges:[]};out.push(node);
      if(n<=0)return node.id;
      const e=memo.get(keyOf(W(s,0))+'|'+k);const x=e?.iv.find(x=>x.lo<=n&&n<=x.hi);if(!x)throw Error('EXTRACT_MEMO');
      if(x.act<0)return node.id;
      const acts=model.choices(s);const act=acts[e.acts[x.act].i];
      const br=model.branches(s,act);node.choice=act.raw??act;
      node.edges=br.map(b=>{const g=b.s.score-s.score;return {index:b.index,p:b.pFloat,key:model.v6key(b.s),drawn:[],next:build(b.s,k-1,n-g)};});
      return node.id;}
    return {version:'gas-finite-dag-v1',root:build(model.root,maxOps,rootNeed),nodes:out};
  }
  const best=root.v;
  return {status,reason,stats,kind:beam>0?'restricted':'optimal',kindLabel:beam>0?'手を絞った範囲での最良（検証済みの方策）':'最適（証明済み）',scope,horizonFree:horizonCut===0,optimalityProven:beam===0,
    pMaxWithinHorizon:beam>0?null:str(best.p),best:summarize(best),bestRaw:best,extract,summarize,follow:beam>0||status!=='complete'?null:follow};
  function follow(path,o2={}){
    let s=model.root,k=maxOps;
    for(const step of path){if(model.target-s.score<=0)throw Error('FOLLOW_REACHED');
      const want=JSON.stringify(step.choice);const act=model.choices(s).find(a=>JSON.stringify(a.raw??a)===want);if(!act)throw Error('FOLLOW_ACTION');
      const br=model.branches(s,act);if(!(step.edge>=0&&step.edge<br.length))throw Error('FOLLOW_EDGE');s=br[step.edge].s;k--;}
    if(k<0)throw Error('FOLLOW_HORIZON');
    const r=solveJavelin({...model,root:s},{...opts,maxOps:k,memo,maxMs:o2.maxMs??2000});r.path=path;return r;
  }
}

export function solveJavelinAuto(model,opts={}){
  const {maxMs=600000,beams=[1,2,3]}=opts;const started=Date.now();const trials=[];let prov=null;
  const lexOf=r=>r.bestRaw;
  for(const b of beams){const left=maxMs-(Date.now()-started);if(left<=0)break;
    const r=solveJavelin(model,{...opts,beam:b,maxMs:Math.min(left,Math.max(1000,maxMs/10))});trials.push({beam:b,status:r.status,ms:r.stats.elapsedMs,best:r.best&&[r.best.p,r.best.d,r.best.a]});
    if(r.status==='complete'&&(!prov||better(r,prov,opts)))prov=r;}
  const left=maxMs-(Date.now()-started);
  const ex=left>0?solveJavelin(model,{...opts,beam:0,maxMs:left}):null;
  if(ex&&ex.status==='complete'){ex.trials=trials;return ex;}
  if(!prov)return {status:'incomplete',reason:ex?.reason??'TIME_LIMIT',kind:'incomplete',kindLabel:'未完了',trials,stats:{elapsedMs:Date.now()-started}};
  prov.status='provisional';prov.kind='provisional';prov.optimalityProven=false;prov.kindLabel='暫定（検証済みの方策、最適は未証明）';prov.trials=trials;prov.exact={status:ex?.status??'skipped',reason:ex?.reason??null};
  prov.proven=prov.bestRaw.p.n===prov.bestRaw.p.d?'達成率 100% は最大（証明済み）。E[D]・E[A] の最適は未証明':'証明できた範囲なし（暫定の達成率が最大かは未証明）';
  return prov;
}
function better(r,s,opts){return betterBest(r.bestRaw,s.bestRaw,{...opts,criterion:'max'});}
export function betterBest(u,v,opts={}){
  if(!u)return false;if(!v)return true;
  const order=opts.order??DEFAULT_ORDER,crit=opts.criterion==='max'||!opts.alpha;
  if(!crit){const fa=cmp(u.p,opts.alpha)>=0,fb=cmp(v.p,opts.alpha)>=0;if(fa!==fb)return fa;
    if(!fa){const c=cmp(u.p,v.p);if(c)return c>0;}}
  const keys=[...(crit?['p',...order.filter(k=>k!=='p')]:order),...(opts.extras||[]).map(x=>x==='floor'?'fl':x)];
  for(const k of keys){if(u[k]==null||v[k]==null)continue;const c=cmp(u[k],v[k]);if(c)return (k==='p'||k==='ev'||k==='fl')?c>0:c<0;}
  return false;
}
