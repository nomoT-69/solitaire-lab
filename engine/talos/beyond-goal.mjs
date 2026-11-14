import {prepareTomahawk} from './tomahawk.mjs?v=1.17.12';
import {heatCapScore} from './estimate.mjs?v=1.17.12';
import {ZERO,ONE,R,add,mul,cmp,str,toNum} from '../src/rational.mjs?v=1.17.12';
import {evalPolicyExact} from '../src/policy-eval.mjs?v=1.17.12';

const LIMITS=['TIME_LIMIT','STATE_LIMIT','MEMORY_LIMIT','GROWTH_LIMIT'];
export function solveBeyondGoalOnGraph(model,pr,opts={}){
  const started=Date.now(),maxMs=opts.maxMs??600000;
  const g=pr.graph,{actStart,brStart,brChild,brGain,brProb,maxGain}=g,N=maxGain.length,P=g.probsR;
  const rootNeed=model.target-model.root.score;
  const RG=new Map(),rg=x=>{let r=RG.get(x);if(!r){r=R(x);RG.set(x,r);}return r;};
  const late=v=>(v&1023)===0&&Date.now()-started>maxMs;
  const nodeK=g.nodeK;const evB=new Array(N),flB=new Float64Array(N),aiB=new Int32Array(N);
  let FT=new Float64Array(1<<20),FA=new Int32Array(1<<20),fn=0;const off=new Int32Array(N),len=new Int32Array(N);
  const putSeg=(v,ts,as)=>{const n=ts.length;if(fn+n>FT.length){const m=Math.max(fn+n,Math.ceil(FT.length*1.5));const a=new Float64Array(m);a.set(FT.subarray(0,fn));FT=a;const b=new Int32Array(m);b.set(FA.subarray(0,fn));FA=b;}
    off[v]=fn;len[v]=n;for(let i=0;i<n;i++){FT[fn+i]=ts[i];FA[fn+i]=as[i];}fn+=n;};
  const SP=new Array(N),SE=new Array(N),SF=new Array(N);let segs=0;
  const layers=[];const free=L=>{for(let i=L.lo;i<=L.hi;i++){SP[i]=SE[i]=SF[i]=evB[i]=undefined;}};
  const seg=(c,t)=>{const o=off[c];let lo=0,hi=len[c]-1;if(t>=FT[o+hi])return hi;while(lo<hi){const m=(lo+hi+1)>>1;if(FT[o+m]<=t)lo=m;else hi=m-1;}return lo;};
  const val=(c,t)=>{if(t<=0)return [ONE,evB[c],flB[c]];const i=seg(c,t);return [SP[c][i],SE[c][i],SF[c][i]];};
  for(let v=N-1;v>=0;v--){if(late(v))throw Error('TIME_LIMIT');
    if(!layers.length||nodeK[v]!==nodeK[layers[layers.length-1].lo]){if(layers.length>=2)free(layers[layers.length-2]);layers.push({lo:v,hi:v});}else layers[layers.length-1].lo=v;
    {let be=ZERO,bf=0,ba=-1;const a0=actStart[v];
      for(let ai=a0;ai<actStart[v+1];ai++){let e=ZERO,f=Infinity;
        for(let bi=brStart[ai];bi<brStart[ai+1];bi++){const c=brChild[bi],gn=brGain[bi];e=add(e,mul(P[brProb[bi]],c>=0?add(rg(gn),evB[c]):rg(gn)));const w=gn+(c>=0?flB[c]:0);if(w<f)f=w;}
        if(cmp(e,be)>0){be=e;bf=f;ba=ai-a0;}}
      evB[v]=be;flB[v]=bf;aiB[v]=ba;}
    const a0=actStart[v],a1=actStart[v+1],hi=Math.min(maxGain[v],rootNeed);
    if(a0===a1||hi<1){putSeg(v,[1],[aiB[v]]);SP[v]=[ZERO];SE[v]=[evB[v]];SF[v]=[flB[v]];segs++;continue;}
    const bp=new Set([1]);
    for(let bi=brStart[a0];bi<brStart[a1];bi++){const gn=brGain[bi],c=brChild[bi];if(gn+1<=hi)bp.add(gn+1);
      if(c>=0){const o=off[c],n=len[c];for(let i=0;i<n;i++){const t=gn+FT[o+i];if(t>hi)break;if(t>1)bp.add(t);}}}
    const ts=[...bp].sort((x,y)=>x-y),oT=[],oP=[],oE=[],oF=[],oA=[];
    for(const t of ts){let bP=ZERO,bE=ZERO,bF=0,bA=-1;
      for(let ai=a0;ai<a1;ai++){let p=ZERO,e=ZERO,f=Infinity;
        for(let bi=brStart[ai];bi<brStart[ai+1];bi++){const gn=brGain[bi],c=brChild[bi],q=P[brProb[bi]];
          const [cp,ce,cf]=c>=0?val(c,t-gn):[t-gn<=0?ONE:ZERO,ZERO,0];
          if(cp.n!==0n)p=add(p,mul(q,cp));e=add(e,mul(q,add(rg(gn),ce)));const w=gn+cf;if(w<f)f=w;}
        const cP=cmp(p,bP);if(cP>0||(cP===0&&cmp(e,bE)>0)){bP=p;bE=e;bF=f;bA=ai-a0;}}
      const k=oT.length-1;
      if(k>=0&&oA[k]===bA&&cmp(oP[k],bP)===0&&cmp(oE[k],bE)===0&&oF[k]===bF)continue;
      oT.push(t);oP.push(bP);oE.push(bE);oF.push(bF);oA.push(bA);}
    oT.push(hi+1);oP.push(ZERO);oE.push(evB[v]);oF.push(flB[v]);oA.push(aiB[v]);
    putSeg(v,oT,oA);SP[v]=oP;SE[v]=oE;SF[v]=oF;segs+=oT.length;}
  const backwardMs=Date.now()-started;
  const rootV=rootNeed<=0?[ONE,evB[0],flB[0]]:val(0,rootNeed);
  const choose=(id,n)=>n<=0?aiB[id]:FA[off[id]+seg(id,n)];
  function extract(){
    const out=[],memo=new Map();
    function build(s,id){
      const k=model.v6key(s)+'#'+id;const hit=memo.get(k);if(hit!==undefined)return hit;
      const n=model.target-s.score,a0=actStart[id];const acts=actStart[id+1]===a0?[]:model.choices(s);
      if(actStart[id+1]-a0!==acts.length)throw Error('EXTRACT_GRAPH');
      const ai=acts.length?choose(id,n):-1;
      const node={id:out.length,key:model.v6key(s),choice:null,edges:[]};out.push(node);memo.set(k,node.id);
      if(ai<0)return node.id;
      const act=acts[ai],br=model.branches(s,act),b0=brStart[a0+ai];if(brStart[a0+ai+1]-b0!==br.length)throw Error('EXTRACT_GRAPH');
      node.choice=act.raw??act;
      node.edges=br.map((b,i)=>({index:b.index,p:b.pFloat,key:model.v6key(b.s),drawn:[],next:null}));
      br.forEach((b,i)=>{node.edges[i].next=build(b.s,brChild[b0+i]);});
      return node.id;}
    const root=build(model.root,0);
    return {version:'gas-finite-dag-v1',root,nodes:out};}
  const dag=extract();const ev=evalPolicyExact(model,dag);
  const reachEv=(()=>{const memo=new Map();
    const walk=(s,id)=>{const h=memo.get(id);if(h)return h;const nd=dag.nodes[id];let v;
      if(nd.choice===null)v=s.score>=model.target?R(s.score):ZERO;
      else{const act=model.choices(s).find(a=>JSON.stringify(a.raw??a)===JSON.stringify(nd.choice));v=ZERO;model.branches(s,act).forEach((b,i)=>{v=add(v,mul(b.p,walk(b.s,nd.edges[i].next)));});}
      memo.set(id,v);return v;};
    return walk(model.root,dag.root);})();
  const evIfReached=ev.pRat.n===0n?null:R(reachEv.n*ev.pRat.d,reachEv.d*ev.pRat.n);
  const base=R(model.root.score),evAbs=add(base,rootV[1]);
  const consistent=cmp(ev.pRat,rootV[0])===0&&ev.ev===str(evAbs)&&ev.floor===String(model.root.score+rootV[2]);
  if(!consistent)throw Error('BEYOND_MISMATCH '+JSON.stringify({p:[ev.p,str(rootV[0])],ev:[ev.ev,str(evAbs)],floor:[ev.floor,model.root.score+rootV[2]]}));
  const dropped=pr.stats.dropped||0,horizonCut=pr.stats.horizonCut||0;
  const best={p:ev.p,pNum:ev.pNum,d:ev.d,dNum:ev.dNum,a:ev.a,aNum:ev.aNum,ev:ev.ev,evNum:toNum(evAbs),floor:ev.floor,floorNum:Number(ev.floor),
    evIfReached:evIfReached&&str(evIfReached),evIfReachedNum:evIfReached&&toNum(evIfReached)};
  return {status:'complete',kind:dropped?'restricted':'optimal',optimalityProven:!dropped,
    kindLabel:dropped?'層の上限で展開を絞った範囲での最良（検証済みの方策、最適は未証明）':'最適（証明済み）',
    scope:dropped?'層の上限 '+opts.layerCap+' で '+dropped+' 状態を展開しなかった範囲での最良':horizonCut===0?'上限なしでも最適（操作数の上限で切った状態は0件）':'操作数の上限の範囲での最適（上限で切った状態 '+horizonCut+' 件）',
    objective:'beyondGoal',best,bestRaw:{p:ev.pRat,ev:evAbs,floor:model.root.score+rootV[2]},extract:()=>dag,
    stats:{nodes:N,segments:segs,dropped,horizonCut,forwardMs:pr.stats.forwardMs,backwardMs,elapsedMs:Date.now()-started+(pr.stats.forwardMs||0),policyNodes:dag.nodes.length}};
}
export function solveBeyondGoal1(model,opts={}){
  const started=Date.now();let pr;
  try{pr=prepareTomahawk(model,{...opts,maxStates:opts.maxStates??Infinity});}catch(e){if(LIMITS.includes(e.message))return {status:'incomplete',reason:e.message};throw e;}
  if(pr.status!=='prepared')return {status:'incomplete',reason:pr.reason??null,stats:{elapsedMs:Date.now()-started}};
  try{return solveBeyondGoalOnGraph(model,pr,{...opts,maxMs:Math.max(1,(opts.maxMs??600000)-(Date.now()-started))});}
  catch(e){if(LIMITS.includes(e.message))return {status:'incomplete',reason:e.message,stats:{elapsedMs:Date.now()-started}};throw e;}
}
const better=(a,b)=>{if(!b)return true;const c=cmp(a.bestRaw.p,b.bestRaw.p);return c>0||(c===0&&cmp(a.bestRaw.ev,b.bestRaw.ev)>0);};
export function solveBeyondGoal(model,opts={}){
  const started=Date.now(),maxMs=opts.maxMs??150000,left=()=>maxMs-(Date.now()-started);const trials=[];let best=null;
  const trim=()=>{if(opts.compact!==false&&model.engine?.trimCaches)model.engine.trimCaches();};
  const offer=(r,label)=>{trials.push({solver:label,status:r.status,reason:r.reason??null,ms:r.stats?.elapsedMs,best:r.best&&[r.best.p,r.best.ev,r.best.floor]});
    if(r.status==='complete'&&better(r,best)){best={...r,solver:label};if(opts.onUpdate&&!(r.kind==='optimal'))opts.onUpdate({...best,status:'provisional',trials:trials.slice()});}};
  const mem=opts.maxEstMiB??opts.maxHeapMiB;const growth=opts.growthStop===false?undefined:Math.min(opts.maxStates??2e7,mem?Math.floor(mem*1048576/(opts.growthBytes??600)):Infinity);
  const ex=solveBeyondGoal1(model,{maxOps:opts.maxOps,maxEstMiB:opts.maxEstMiB,maxHeapMiB:opts.maxHeapMiB,maxStates:opts.maxStates??2e7,growthLimit:Number.isFinite(growth)?growth:undefined,maxMs:Math.max(1,left()*0.75)});
  offer(ex,'Tomahawk（届いた先まで、厳密）');
  if(ex.status==='complete')return {...best,trials};
  trim();
  for(const cap of opts.caps??[20000,100000,300000]){if(left()<=0)break;
    const r=solveBeyondGoal1(model,{maxOps:opts.maxOps,layerCap:cap,capScore:heatCapScore(model,opts.capHeatLambda??8,1,opts.heatOpts||{}),maxEstMiB:opts.maxEstMiB,maxHeapMiB:opts.maxHeapMiB,maxMs:Math.max(1,left())});
    offer(r,'Tomahawk（届いた先まで、層の上限 '+cap+'・熱意の見込み）');trim();
    if(r.status!=='complete')break;}
  if(!best)return {status:'incomplete',reason:'TIME_LIMIT',kind:'incomplete',kindLabel:'未完了',trials,stats:{elapsedMs:Date.now()-started}};
  return {...best,trials,stats:{...best.stats,elapsedMs:Date.now()-started}};
}
