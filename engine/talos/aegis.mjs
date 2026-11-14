import {DEFAULT_ORDER,solveTomahawk,solveTomahawkAuto,tecnaiModel} from './tomahawk.mjs?v=1.17.12';
import {heatCapScore} from './estimate.mjs?v=1.17.12';
import {solveJavelin,javelinSupports,betterBest} from './javelin.mjs?v=1.17.12';
import {solveBeyondGoal} from './beyond-goal.mjs?v=1.17.12';
export {tecnaiModel};
const summarizeV=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}if(v.ev!==undefined){o.ev=str(v.ev);o.evNum=toNum(v.ev);}if(v.fl!==undefined){o.floor=str(v.fl);o.floorNum=toNum(v.fl);}return o;};
function compactProv(model,opts,r){
  if(opts.compact===false||!r.extract||r.compacted)return r;
  const dag=r.extract();const ex=opts.extras||[];const s0=R(model.root.score);
  const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}
    if(ex.includes('ev')&&v.ev!==undefined){const x=add(s0,v.ev);o.ev=str(x);o.evNum=toNum(x);}
    if(ex.includes('floor')&&v.fl!==undefined){const x=add(s0,v.fl);o.floor=str(x);o.floorNum=toNum(x);}return o;};
  return {...r,extract:()=>dag,summarize,table:null,follow:null,compacted:true};
}
const beamOpts=opts=>{const o=opts.criterion==='max'?opts:{...opts,criterion:'max'};return javelinSupports(o).ok?o:null;};
const meets=(opts,r)=>opts.criterion==='max'||!opts.alpha||!r.bestRaw?undefined:cmp(r.bestRaw.p,opts.alpha)>=0;
const trim=model=>{if(model.engine?.trimCaches)model.engine.trimCaches();};
function maxTracker(model,opts){
  const on=!!opts.alsoMax&&opts.criterion!=='max';let mx=null;
  const mopts={...opts,criterion:'max'};
  const pick=r=>{const fr=r.frontierRaw;if(fr&&fr.length&&r.extract&&!r.compacted){let b=null;for(const v of fr)if(betterBest(v,b,mopts))b=v;return b;}return r.bestRaw??null;};
  return {on,
    offer(r,label){if(!on||r.status!=='complete')return;const v=pick(r);if(!v||!(betterBest(v,mx?.bestRaw,mopts)||lostSwap(mopts,label,{bestRaw:v},mx)))return;
      let dag=null;try{dag=r.compacted?r.extract():r.extract(v);}catch(e){return;}if(!dag)return;
      const sm=r.summarize?r.summarize(v):summarizeV(v);mx={best:sm,bestRaw:v,solver:label,extract:()=>dag};},
    attach(r){return on?{...r,maxResult:mx}:r;}};
}
const withDrinkStages=(opts,stages)=>opts.drinkStages?stages.flatMap(st=>st.heat&&!st.drink?[st,{...st,drink:true}]:[st]):stages;
const capStages=(opts,list)=>withDrinkStages(opts,capStages0(opts,list));
const capStages0=(opts,list)=>{const cs=list.map(c=>typeof c==='number'?c:c.cap);
  if(opts.capHeat===false)return list.map(c=>({cap:typeof c==='number'?c:c.cap,heat:!!c.heat}));
  if(opts.capOrder==='interleave')return cs.flatMap(cap=>[{cap,heat:true},{cap,heat:false}]);
  return [...cs.map(cap=>({cap,heat:true})),...cs.map(cap=>({cap,heat:false}))];};
const growthLimitOf=(opts,maxStates)=>{if(opts.growthStop===false)return undefined;const mem=opts.maxEstMiB??opts.maxHeapMiB;
  const byMem=mem?Math.floor(mem*1048576/(opts.growthBytes??600)):Infinity;const g=Math.min(maxStates??2e7,byMem);return Number.isFinite(g)?g:undefined;};
const capOpts=(model,opts,st)=>({layerCap:st.cap,capScore:st.heat?heatCapScore(model,opts.capHeatLambda??8,1,{...(opts.heatOpts||{}),...(st.drink?{drink:opts.drinkStageWeight??1}:{})}):undefined,
  ...(opts.criterion!=='max'&&(opts.capFrontierEps??1e-3)?{frontierEps:opts.capFrontierEps??1e-3}:{})});
const heatAsMax=(opts,st,crit)=>st.heat&&!crit&&opts.alphaHeatMax===true;
const capLabel=st=>st.cap+(st.heat?'・熱意の見込み':'')+(st.drink?'・ドリンク後回し':'');
export const AEGIS_HEAT_DEFAULT=Object.freeze({hold:1});
const lostSwap=(opts,label,r,prev)=>!!opts.playOnLost&&!!prev&&String(prev.solver??'').startsWith('Javelin')&&!String(label).startsWith('Javelin')&&!betterBest(prev.bestRaw,r.bestRaw,opts);
const lostKeep=(opts,j)=>!opts.playOnLost||!j.bestRaw||(j.bestRaw.p.n===j.bestRaw.p.d);
const withHeatDefault=opts=>opts.heatOpts===undefined?{...opts,heatOpts:AEGIS_HEAT_DEFAULT}:opts;
const withDrinkCheck=(model,opts)=>({...opts,drinkStages:(opts.drinkStages??true)&&!!(model.engine?.root?.drinks?.length)});
export function solveAegis(model,opts={}){
  opts=withHeatDefault(opts);opts=withDrinkCheck(model,opts);
  if(opts.beyondGoal)return solveBeyondGoal(model,opts);
  const toRaw=v=>{const r={p:v.p,d:v.d,a:v.a};const s0=R(model.root.score);if(v.ev!==undefined)r.ev=sub(v.ev,s0);if(v.fl!==undefined)r.fl=sub(v.fl,s0);return r;};
  const started=Date.now();const {maxMs=600000,maxStates=2e7,quickMs=2000,caps=[20000,100000,300000],onUpdate=null}=opts;
  const order=opts.order??DEFAULT_ORDER;const crit=opts.criterion==='max';const trials=[];
  const left=()=>maxMs-(Date.now()-started);
  const canJavelin=!opts.noJavelin&&javelinSupports(opts).ok;
  if(canJavelin){
    const j=solveJavelin(model,{...opts,maxMs:Math.min(quickMs,left())});trials.push({solver:'Javelin',status:j.status,ms:j.stats.elapsedMs});
    if(j.status==='complete'&&lostKeep(opts,j)){j.solver='Javelin';j.trials=trials;
      if(opts.alsoMax&&!crit){const M=maxTracker(model,opts);const jm=solveJavelin(model,{...opts,criterion:'max',maxMs:Math.max(1,Math.min(quickMs,left()))});M.offer(jm,'Javelin（達成率最大）');return M.attach(j);}
      return j;}}
  const key=r=>r.bestRaw;let prov=null;const MX=maxTracker(model,opts);
  const better=(a,b)=>!b||betterBest(key(a),key(b),opts);
  const offer=(r,label)=>{trials.push({solver:label,status:r.status,ms:r.stats?.elapsedMs,best:r.best&&[r.best.p,r.best.d,r.best.a]});MX.offer(r,label);
    if(r.status==='complete'&&r.best&&(better(r,prov)||lostSwap(opts,label,r,prov))){prov=compactProv(model,opts,r);prov.solver=label;if(onUpdate)onUpdate(finish(prov,false));}
    else if(MX.on&&prov&&onUpdate&&r.status==='complete')onUpdate(finish(prov,false));};
  const finish=(r,done)=>MX.attach({...r,status:'provisional',kind:'provisional',optimalityProven:false,meetsAlpha:meets(opts,r),kindLabel:'暫定（検証済みの方策、最適は未証明）',trials:trials.slice(),final:done,
    proven:r.bestRaw&&r.bestRaw.p.n===r.bestRaw.p.d?'達成率 100% は最大（証明済み）。E[D]・E[A] の最適は未証明':'証明できた範囲なし（暫定の達成率が最大かは未証明）'});
  const stepMs=()=>Math.min(left(),Math.max(5000,maxMs*(opts.earlyFrac??0.05)));
  const p1=()=>prov&&prov.bestRaw.p.n===prov.bestRaw.p.d;
  const bm=opts.noJavelin?null:beamOpts(opts);
  if(bm)for(const b of opts.beams??[1,2,3]){if(p1())break;if(left()<=0)break;
    const r=solveJavelin(model,{...bm,beam:b,maxMs:stepMs(),orderHeat:opts.beamHeat??8,maxMemo:opts.beamMaxMemo??1e5});offer(r,'Javelin（上位'+b+'手'+((opts.beamHeat??8)?'・熱意の見込みの順':'')+(crit?'':'・達成率最大')+'）');if(r.status!=='complete')break;
    if(r.bestRaw&&r.bestRaw.p.n===0n)break;}
  const capsLeft=capStages(opts,caps);let memStop=Infinity;
  const tryCap=(st,ms,asMax=false)=>{const cap=capLabel(st);const r=solveTomahawk(model,{...(asMax?{...opts,criterion:'max'}:opts),...capOpts(model,opts,st),maxStates:Infinity,maxMs:ms});if(opts.compact!==false)trim(model);
    if(r.status==='complete'&&r.optimalityProven&&!asMax){trials.push({solver:'Tomahawk（層の上限 '+cap+'、上限に当たらず完了）',status:r.status,ms:r.stats?.elapsedMs});r.solver='Tomahawk';r.trials=trials;MX.offer(r,'Tomahawk');return MX.attach(r);}
    if(r.reason==='MEMORY_LIMIT'){memStop=Math.min(memStop,st.cap);trials.push({solver:'Tomahawk（層の上限 '+cap+'）',status:r.status,reason:r.reason,ms:r.stats?.elapsedMs});return null;}
    offer(r,'Tomahawk（層の上限 '+cap+(asMax?'・達成率最大':'')+'）');return null;};
  for(const st of capStages0(opts,[opts.earlyCap??5000])){if(p1()||left()<=0)break;const done=tryCap(st,Math.min(left(),maxMs*(opts.capFrac??0.15)),!crit&&opts.alphaEarlyMax!==false);if(done)return done;}
  const reserve=maxMs*(opts.reserveFrac??0.35);
  const t=solveTomahawkAuto(model,{...opts,maxStates,growthLimit:growthLimitOf(opts,maxStates),maxMs:Math.max(1,Math.min(left()-reserve,opts.exactFrac?maxMs*opts.exactFrac:Infinity))});if(t.status!=='complete'&&opts.compact!==false)trim(model);trials.push({solver:'Tomahawk',status:t.status,reason:t.reason,ms:t.stats?.elapsedMs});
  if(t.status==='complete'){t.solver='Tomahawk';t.trials=trials;MX.offer(t,'Tomahawk');return MX.attach(t);}
  if(opts.improve&&crit&&canJavelin){
    if(left()>0&&capsLeft.length){const done=tryCap(capsLeft.shift(),Math.min(left(),maxMs*0.15));if(done)return done;}
    if(prov&&left()>0){const t0=Date.now();
      const im=improvePolicy(model,prov.extract(),{...opts,maxMs:left(),onUpdate:onUpdate?u=>onUpdate({...finish(prov,false),best:summarizeV(u.value),improvedDag:u.dag}):null});
      trials.push({solver:'部分改善（Javelin）',status:'complete',ms:Date.now()-t0,best:[im.best.p,im.best.d,im.best.a],replaced:im.stats.replaced,tried:im.stats.tried});
      if(im.stats.replaced){const dag=im.dag;prov={...prov,best:im.best,bestRaw:toRaw(im.value),extract:()=>dag,solver:'部分改善（Javelin）'};}}
  }else for(const st of capsLeft){if(left()<=0)break;if(st.cap>=memStop)continue;const done=tryCap(st,left(),heatAsMax(opts,st,crit));if(done)return done;}
  if(!prov)return MX.attach({status:'incomplete',reason:'TIME_LIMIT',kind:'incomplete',kindLabel:'未完了',trials,stats:{elapsedMs:Date.now()-started}});
  return finish(prov,true);
}

export function createAegisJob(model,opts={}){
  opts=withHeatDefault(opts);opts=withDrinkCheck(model,opts);
  if(opts.beyondGoal)return {run:(o={})=>solveBeyondGoal(model,{...opts,...o}),follow:()=>null,retarget:()=>null,dispose(){},get state(){return {calls:0,final:false,canFollow:false};}};
  const crit=opts.criterion==='max';const canJavelin=!opts.noJavelin&&javelinSupports(opts).ok;
  const caps=capStages(opts,opts.caps??[20000,100000,300000]),steps=opts.horizonSteps??[opts.maxOps??24,48,96];
  const bm=opts.noJavelin?null:beamOpts(opts);const J={trials:[],prov:null,final:null,calls:0,totalMs:0,quickDone:!canJavelin,beamIdx:bm?0:Infinity,
    early:{stages:capStages0(opts,[opts.earlyCap??5000]),idx:0,res:{},done:false},exact:{hi:0,res:{},last:null,widened:[],abandoned:null},cap:{idx:0,res:{}},disposed:false};
  const key=r=>r.bestRaw;const better=(a,b)=>!b||betterBest(key(a),key(b),opts);const MX=maxTracker(model,opts);
  const p1=()=>J.prov&&J.prov.bestRaw.p.n===J.prov.bestRaw.p.d;
  const stats=()=>({calls:J.calls,elapsedMs:J.totalMs});
  const finish=r=>({...r,status:'provisional',kind:'provisional',optimalityProven:false,meetsAlpha:meets(opts,r),kindLabel:'暫定（検証済みの方策、最適は未証明）',trials:J.trials.slice(),
    proven:r.bestRaw&&r.bestRaw.p.n===r.bestRaw.p.d?'達成率 100% は最大（証明済み）。E[D]・E[A] の最適は未証明':'証明できた範囲なし（暫定の達成率が最大かは未証明）'});
  const resumeInfo=()=>{
    if(J.final)return {resumable:false,resumeReason:'計算は終わっています（'+(J.final.kindLabel||J.final.kind)+'）'};
    if(J.exact.abandoned&&J.cap.idx>=caps.length)return {resumable:false,resumeReason:'厳密な計算は '+J.exact.abandoned+' で続けられず、層の上限もすべて試し終えました'};
    return {resumable:true,resumeReason:J.exact.abandoned?'厳密な計算は '+J.exact.abandoned+' で止めました。続きでは層の上限を広げて暫定を良くします':null};
  };
  const out=r=>MX.attach({...r,job:stats(),...resumeInfo()});
  function run(ro={}){
    if(J.disposed)throw Error('AEGIS_JOB_DISPOSED');
    const started=Date.now();const maxMs=ro.maxMs??60000,maxStates=ro.maxStates??opts.maxStates??2e7,onUpdate=ro.onUpdate??opts.onUpdate??null;
    const left=()=>maxMs-(Date.now()-started);J.calls++;
    const done=()=>{J.totalMs+=Date.now()-started;return out(J.final);};
    if(J.final){J.totalMs+=Date.now()-started;return out(J.final);}
    const offer=(r,label)=>{J.trials.push({solver:label,status:r.status,ms:r.stats?.elapsedMs,best:r.best&&[r.best.p,r.best.d,r.best.a]});MX.offer(r,label);
      if(r.status==='complete'&&r.best&&(better(r,J.prov)||lostSwap(opts,label,r,J.prov))){J.prov=compactProv(model,opts,r);J.prov.solver=label;if(onUpdate)onUpdate(out(finish(J.prov)));}
      else if(MX.on&&J.prov&&onUpdate&&r.status==='complete')onUpdate(out(finish(J.prov)));};
    if(!J.quickDone){J.quickDone=true;const j=solveJavelin(model,{...opts,maxMs:Math.min(opts.quickMs??2000,left())});J.trials.push({solver:'Javelin',status:j.status,ms:j.stats.elapsedMs});
      if(j.status==='complete'&&lostKeep(opts,j)){j.solver='Javelin';j.trials=J.trials.slice();J.final=j;
        if(MX.on){const jm=solveJavelin(model,{...opts,criterion:'max',maxMs:Math.max(1,Math.min(opts.quickMs??2000,left()))});MX.offer(jm,'Javelin（達成率最大）');}
        return done();}}
    const stepMs=()=>Math.min(left(),Math.max(5000,maxMs*(opts.earlyFrac??0.05)));const beams=opts.beams??[1,2,3];
    while(J.beamIdx<beams.length){if(p1()||left()<=0){J.beamIdx=Infinity;break;}const b=beams[J.beamIdx++];
      const r=solveJavelin(model,{...bm,beam:b,maxMs:stepMs(),orderHeat:opts.beamHeat??8,maxMemo:opts.beamMaxMemo??1e5});offer(r,'Javelin（上位'+b+'手'+((opts.beamHeat??8)?'・熱意の見込みの順':'')+(crit?'':'・達成率最大')+'）');if(r.status!=='complete'){J.beamIdx=Infinity;break;}
      if(r.bestRaw&&r.bestRaw.p.n===0n){J.beamIdx=Infinity;break;}}
    const tryCap=(st,res,ms,asMax=false)=>{const cap=capLabel(st);const r=solveTomahawk(model,{...(asMax?{...opts,criterion:'max'}:opts),...capOpts(model,opts,st),maxStates:Infinity,maxMs:ms,resume:res});if(r.status==='complete'&&opts.compact!==false)trim(model);
      if(r.status==='complete'&&r.optimalityProven&&!asMax){J.trials.push({solver:'Tomahawk（層の上限 '+cap+'、上限に当たらず完了）',status:r.status,ms:r.stats?.elapsedMs});r.solver='Tomahawk';r.trials=J.trials.slice();MX.offer(r,'Tomahawk');J.final=r;return 'final';}
      if(r.status==='complete'){offer(r,'Tomahawk（層の上限 '+cap+(asMax?'・達成率最大':'')+'）');return 'done';}
      if(r.reason!=='TIME_LIMIT'){J.trials.push({solver:'Tomahawk（層の上限 '+cap+'）',status:r.status,reason:r.reason,ms:r.stats?.elapsedMs});return 'stop';}
      return 'more';};
    if(!J.early.done&&p1()){J.early.done=true;J.early.res=null;}
    while(!J.early.done&&left()>0){const Q=J.early;const x=tryCap(Q.stages[Q.idx],Q.res,Math.min(left(),maxMs*(opts.capFrac??0.15)),!crit&&opts.alphaEarlyMax!==false);if(x==='final')return done();if(x==='more')break;
      Q.idx++;Q.res={};if(x==='stop'||Q.idx>=Q.stages.length||p1()){Q.done=true;Q.res=null;}}
    const reserve=maxMs*(opts.reserveFrac??0.35);const E=J.exact;
    while(!E.abandoned&&E.hi<steps.length&&left()>reserve){const h=steps[E.hi];
      const exLeft=opts.exactFrac?maxMs*opts.exactFrac-(E.spent??0):Infinity;if(exLeft<=0)break;const tE=Date.now();
      const r=solveTomahawk(model,{...opts,maxOps:h,maxStates,growthLimit:growthLimitOf(opts,maxStates),maxMs:Math.max(1,Math.min(left()-reserve,exLeft)),resume:E.res});E.spent=(E.spent??0)+Date.now()-tE;
      if(r.status!=='complete'){J.trials.push({solver:'Tomahawk（続きから）',status:r.status,reason:r.reason,ms:r.stats?.elapsedMs});
        if(r.reason==='TIME_LIMIT')break;
        E.abandoned=r.reason;E.res=null;
        if(E.last){E.last.widened=E.widened;E.last.widenNote='上限 '+h+' で解き直す途中で '+r.reason+' になったので、上限 '+E.last.stats.maxOps+' の範囲での最適を返す';J.final=E.last;return done();}
        break;}
      r.stats.maxOps=h;r.solver='Tomahawk';MX.offer(r,'Tomahawk');
      if(r.horizonFree||E.hi===steps.length-1){r.widened=E.widened;r.trials=J.trials.slice();J.final=r;return done();}
      E.widened.push({maxOps:h,horizonCut:r.stats.horizonCut});E.last=r;E.hi++;E.res={};
    }
    const C=J.cap;C.stop??=Infinity;
    while(C.idx<caps.length&&left()>0){if(caps[C.idx].cap>=C.stop){C.idx++;C.res={};continue;}
      const x=tryCap(caps[C.idx],C.res,left(),heatAsMax(opts,caps[C.idx],crit));if(x==='final')return done();if(x==='more')break;if(x==='stop'){C.stop=Math.min(C.stop,caps[C.idx].cap);}C.idx++;C.res={};}
    J.totalMs+=Date.now()-started;
    if(!J.prov)return out({status:'incomplete',reason:'TIME_LIMIT',kind:'incomplete',kindLabel:'未完了',trials:J.trials.slice(),stats:{elapsedMs:Date.now()-started}});
    return out(finish(J.prov));
  }
  function follow(path){
    if(J.disposed)return null;const f=J.final;if(!f||typeof f.follow!=='function'||f.kind!=='optimal')return null;
    const r=f.follow(path);if(r&&r.kind!=='optimal')return null;
    return r&&{...r,solver:f.solver,followed:true,resumable:false,resumeReason:'続きの局面の答え（最初の計算のグラフ・覚えから）'};
  }
  function retarget(target2,o2={}){
    if(J.disposed)return null;const f=J.final;if(!f||typeof f.retarget!=='function'||f.kind!=='optimal')return null;
    const r=f.retarget(target2,o2);return r&&{...r,solver:f.solver,retargeted:true,resumable:false,resumeReason:'目標・基準を変えた答え（最初の計算のグラフから）'};
  }
  function dispose(){J.disposed=true;J.early.res=null;J.exact.res=null;J.exact.last=null;J.cap.res=null;J.prov=null;J.final=null;}
  return {run,follow,retarget,dispose,get state(){return {calls:J.calls,elapsedMs:J.totalMs,exactAbandoned:J.exact.abandoned,capIndex:J.cap.idx,final:!!J.final,canFollow:!J.disposed&&!!J.final&&typeof J.final.follow==='function'&&J.final.kind==='optimal'};}};
}

import {ZERO,ONE,R,add,sub,mul,cmp,str,toNum} from '../src/rational.mjs?v=1.17.12';
const sameAct=(a,b)=>JSON.stringify(a.raw??a)===JSON.stringify(b);
function policyTree(model,dag){
  const build=(s,id)=>{const n=dag.nodes[id];
    if(n.choice===null)return {s,act:null,kids:[]};
    const act=model.choices(s).find(a=>sameAct(a,n.choice));if(!act)throw Error('IMPROVE_ACTION');
    const br=model.branches(s,act);if(br.length!==n.edges.length)throw Error('IMPROVE_EDGES');
    return {s,act,kids:br.map((b,i)=>({p:b.p,pf:b.pFloat,index:b.index,node:build(b.s,n.edges[i].next)}))};};
  return build(model.root,dag.root);
}
function treeValue(model,node,useEv,useFl){
  if(!node.act){const v={p:node.s.score>=model.target?ONE:ZERO,d:ZERO,a:ZERO};const sc=R(node.s.score);if(useEv)v.ev=sc;if(useFl)v.fl=sc;node.v=v;return v;}
  let p=ZERO,d=node.act.type==='drink'?ONE:ZERO,a=node.act.type==='skip'?ZERO:ONE,ev=ZERO,fl=null;
  for(const k of node.kids){const c=treeValue(model,k.node,useEv,useFl);p=add(p,mul(k.p,c.p));d=add(d,mul(k.p,c.d));a=add(a,mul(k.p,c.a));
    if(useEv)ev=add(ev,mul(k.p,c.ev));if(useFl)fl=fl===null||cmp(c.fl,fl)<0?c.fl:fl;}
  const v={p,d,a};if(useEv)v.ev=ev;if(useFl)v.fl=fl;node.v=v;return v;
}
function treeToDag(model,root){
  const nodes=[];const emit=n=>{const id=nodes.length;const x={id,key:model.v6key(n.s),choice:n.act?(n.act.raw??n.act):null,edges:[]};nodes.push(x);
    x.edges=n.kids.map(k=>({index:k.index,p:k.pf,key:model.v6key(k.node.s),drawn:[],next:emit(k.node)}));return id;};
  return {version:'gas-finite-dag-v1',root:emit(root),nodes};
}
export function improvePolicy(model,dag,opts={}){
  const started=Date.now();const {maxMs=60000,sliceMs=2000,onUpdate=null}=opts;const extras=opts.extras||[];
  const useEv=extras.includes('ev'),useFl=extras.includes('floor');
  const cmpOpts={criterion:'max',order:opts.order,extras};
  const root=policyTree(model,dag);let rootV=treeValue(model,root,useEv,useFl);
  const log=[];let replaced=0,tried=0,solved=0;
  const decisionNodes=()=>{const out=[];const walk=(n,pr,depth)=>{if(!n.act||n.exact)return;out.push({n,pr,depth});for(const k of n.kids)walk(k.node,pr*k.pf,depth+1);};walk(root,1,0);
    return out.sort((x,y)=>y.pr-x.pr||x.depth-y.depth);};
  const failed=new Map();
  let slice=sliceMs;
  while(Date.now()-started<maxMs){
    let progress=false;
    for(const {n,pr} of decisionNodes()){
      const left=maxMs-(Date.now()-started);if(left<=0)break;
      const prev=failed.get(n);if(prev!==undefined&&prev>=slice)continue;
      const sub={...model,root:n.s};const budget=Math.min(left,slice);tried++;
      const r=solveJavelin(sub,{...opts,maxMs:budget,beam:0});
      if(r.status!=='complete'){failed.set(n,budget);continue;}
      solved++;failed.delete(n);
      const t=policyTree(sub,r.extract());const tv=treeValue(model,t,useEv,useFl);
      if(betterBest(tv,n.v,cmpOpts)){Object.assign(n,t);n.exact=true;replaced++;progress=true;
        const nv=treeValue(model,root,useEv,useFl);if(!betterBest(nv,rootV,cmpOpts))throw Error('IMPROVE_NOT_MONOTONE');
        rootV=nv;log.push({ms:Date.now()-started,reach:pr,p:str(rootV.p),d:str(rootV.d),a:str(rootV.a)});
        if(onUpdate)onUpdate({dag:treeToDag(model,root),value:rootV});
        break;}
      n.exact=true;
    }
    if(!progress){if(slice>=maxMs)break;slice*=2;}
  }
  const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}if(useEv){o.ev=str(v.ev);o.evNum=toNum(v.ev);}if(useFl){o.floor=str(v.fl);o.floorNum=toNum(v.fl);}return o;};
  const out=treeToDag(model,root);
  return {dag:out,value:rootV,best:summarize(rootV),stats:{tried,solved,replaced,elapsedMs:Date.now()-started,log}};
}
