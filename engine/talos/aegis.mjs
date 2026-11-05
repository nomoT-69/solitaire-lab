// Aegis（イージス。利用者の命名 2026-11-03）＝計算エンジン＋ソルバの全体システム（Talos・Tecnai・Sidewinder・Tomahawk・Javelin）。
// このファイルはその計算の入口（solveAegis）：エンジン Tecnai とソルバ Javelin・Tomahawk を使い分け、予算内に必ず答えを返す（Talos・Sidewinder は照合の相手）。
// 設計は DESIGN.md の 17章。
//  1) 届く最大の基準なら、Javelin を短く試す（簡単な目標は一瞬で最適を証明できる）
//  2) Javelin の上位1〜3手の探索（と、まだ達成率100%でなければ Tomahawk の層の上限5千）で、最初の暫定の答えを厳密な計算の前に出す（onUpdate で知らせる）
//  3) Tomahawk を状態数の予算つきで解く（操作数の上限の広げ直しを含む）。暫定を良くする時間を予算の25%残す。終われば「最適（証明済み）」
//  4) 予算を超えたら、Tomahawk の層の上限（layerCap）を 2万 → 10万 → 30万 と広げて、暫定の答えを時間の許すかぎり良くする。
//     どれも実際に打てる方策で、値は厳密（検証済み）。最適は未証明。暫定が良くなるたびに onUpdate(結果) を呼ぶ（GUI が途中の答えを出せる）。
//  証明できた範囲：暫定の達成率が 1 なら、達成率は最大（100%）と証明済み。
import {DEFAULT_ORDER,solveTomahawk,solveTomahawkAuto,tecnaiModel} from './tomahawk.mjs';
import {heatCapScore} from './estimate.mjs';
import {solveJavelin,javelinSupports,betterBest} from './javelin.mjs';
export {tecnaiModel};
const summarizeV=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}if(v.ev!==undefined){o.ev=str(v.ev);o.evNum=toNum(v.ev);}if(v.fl!==undefined){o.floor=str(v.fl);o.floorNum=toNum(v.fl);}return o;};
// 暫定の答えを軽くする（opts.compact、既定 true。2026-11-04）：方策の DAG を取り出して持ち、ソルバのグラフ・曲線を手放す。
// table（α の比較表）は使えなくなる（null）。summarize は同じ形（ev・floor は最終点）。続けて層の上限を広げる間のメモリを下げる。
function compactProv(model,opts,r){
  if(opts.compact===false||!r.extract||r.compacted)return r;
  const dag=r.extract();const ex=opts.extras||[];const s0=R(model.root.score);
  const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}
    if(ex.includes('ev')&&v.ev!==undefined){const x=add(s0,v.ev);o.ev=str(x);o.evNum=toNum(x);}
    if(ex.includes('floor')&&v.fl!==undefined){const x=add(s0,v.fl);o.floor=str(x);o.floorNum=toNum(x);}return o;};
  return {...r,extract:()=>dag,summarize,table:null,follow:null,compacted:true};   // follow も手放す（グラフを持ち続けないように）
}
// 暫定の答えを作る Javelin の設定：届く最大の基準ならそのまま。α を決めた比較なら、届く最大の基準に替えて達成率を最大にする方策を作る
const beamOpts=opts=>{const o=opts.criterion==='max'?opts:{...opts,criterion:'max'};return javelinSupports(o).ok?o:null;};
const meets=(opts,r)=>opts.criterion==='max'||!opts.alpha||!r.bestRaw?undefined:cmp(r.bestRaw.p,opts.alpha)>=0;
const trim=model=>{if(model.engine?.trimCaches)model.engine.trimCaches();};
// 達成率最大の答えも並べて返す（opts.alsoMax、α を決めた比較のとき。G2 2026-11-05、利用者の決定「両方並べる・同時に出す（案 B）」。DESIGN 22.34）：
// 各段の結果の根の前線から「最大」（P 最大 → E[D] 最小 → E[A] 最小）の点を取り出し、方策（DAG）を復元して持つ。段をまたいで良い方を残す。
// 返り値・途中の答え（onUpdate）に maxResult：{best, bestRaw, solver, extract()} を付ける（なければ null）。Javelin の段は達成率最大の基準で解くので、その答えも候補
function maxTracker(model,opts){
  const on=!!opts.alsoMax&&opts.criterion!=='max';let mx=null;
  const mopts={...opts,criterion:'max'};
  const pick=r=>{const fr=r.frontierRaw;if(fr&&fr.length&&r.extract&&!r.compacted){let b=null;for(const v of fr)if(betterBest(v,b,mopts))b=v;return b;}return r.bestRaw??null;};
  return {on,
    offer(r,label){if(!on||r.status!=='complete')return;const v=pick(r);if(!v||!betterBest(v,mx?.bestRaw,mopts))return;
      let dag=null;try{dag=r.compacted?r.extract():r.extract(v);}catch(e){return;}if(!dag)return;
      const sm=r.summarize?r.summarize(v):summarizeV(v);mx={best:sm,bestRaw:v,solver:label,extract:()=>dag};},
    attach(r){return on?{...r,maxResult:mx}:r;}};
}
// 層の上限の段（G2 の手順3、案 C。2026-11-04、利用者の決定で既定）：opts.capHeat が false でなければ、各上限で「得点＋熱意の見込み」の順（heatCapScore）を先に、
// 今の順（根からの得点）を後に試す。暫定は良い方が残るので、今より悪くならない。段は {cap, heat}。
// α を決めた比較では、見込みの段は「達成率最大」（辞書式、速い）で解く（α の前線を見込みの順で作ると重く、GUI の局面でメモリ不足になった。DESIGN 22.4）
// 段の順（G2 2026-11-05、利用者の決定。案 B）：熱意の見込みの段をすべての上限で先に試し、今の順（根からの得点）の段は後にまとめる（opts.capOrder:'interleave' で前の順：上限ごとに見込み→今の順）。
// GUI の局面で、E[D] 41/108 に届くのが 337秒 → 110秒（厳密の早めの見切りと合わせて。DESIGN 22.23）
const capStages=(opts,list)=>{const cs=list.map(c=>typeof c==='number'?c:c.cap);
  if(opts.capHeat===false)return list.map(c=>({cap:typeof c==='number'?c:c.cap,heat:!!c.heat}));
  if(opts.capOrder==='interleave')return cs.flatMap(cap=>[{cap,heat:true},{cap,heat:false}]);
  return [...cs.map(cap=>({cap,heat:true})),...cs.map(cap=>({cap,heat:false}))];};
// 厳密の試みを早めに見切る上限（G2 2026-11-05、利用者の決定。案 A）：状態数の上限と、メモリの上限（maxEstMiB か maxHeapMiB）を1状態 opts.growthBytes（既定 600）バイトで割った数の小さい方。
// opts.growthStop:false で使わない。Tomahawk の opts.growthLimit に渡す
const growthLimitOf=(opts,maxStates)=>{if(opts.growthStop===false)return undefined;const mem=opts.maxEstMiB??opts.maxHeapMiB;
  const byMem=mem?Math.floor(mem*1048576/(opts.growthBytes??600)):Infinity;const g=Math.min(maxStates??2e7,byMem);return Number.isFinite(g)?g:undefined;};
// α の前線の間引き（G2 2026-11-05、利用者の決定。DESIGN 22.26）：α を決めた比較の層の上限の段（暫定）は、前線を ε（既定 1e-3、opts.capFrontierEps。0 で間引かない）で間引く。
// 残る点は実際の方策の正確な値。各局面で達成率が最大の点は必ず残るので、α=100% の答えは変わらない。届く最大の基準（辞書式）には関係しない。厳密に解く段では使わない
const capOpts=(model,opts,st)=>({layerCap:st.cap,capScore:st.heat?heatCapScore(model,opts.capHeatLambda??8):undefined,
  ...(opts.criterion!=='max'&&(opts.capFrontierEps??1e-3)?{frontierEps:opts.capFrontierEps??1e-3}:{})});
// α のときの見込みの段：前は「達成率最大」で解いた（α の前線が重かったため。22.4）。間引きで軽くなったので α の前線で解く。opts.alphaHeatMax:true で前の動き
const heatAsMax=(opts,st,crit)=>st.heat&&!crit&&opts.alphaHeatMax===true;
// opts.beamHeat（G2 2026-11-04、設計案の検証2。利用者の決定で既定 8、0 で前の順）：暫定の答えを作る Javelin の上位1〜3手の探索で、手の順に熱意の見込み（λ）を使う。厳密な Javelin は今の順のまま
// opts.beamMaxMemo（既定 10万）：上位1〜3手の探索で覚える局面の数の上限。1局面 4〜22KB なので、ブラウザ（メモリを測れない）でも約0.4〜2GB で止まる（上位1手は1〜3万局面で終わる）
const capLabel=st=>st.cap+(st.heat?'・熱意の見込み':'');
export function solveAegis(model,opts={}){
  // 部分改善の値（最終点の ev・floor）を、ソルバの内部の形（これから得る得点）に直す
  const toRaw=v=>{const r={p:v.p,d:v.d,a:v.a};const s0=R(model.root.score);if(v.ev!==undefined)r.ev=sub(v.ev,s0);if(v.fl!==undefined)r.fl=sub(v.fl,s0);return r;};
  const started=Date.now();const {maxMs=600000,maxStates=2e7,quickMs=2000,caps=[20000,100000,300000],onUpdate=null}=opts;
  const order=opts.order??DEFAULT_ORDER;const crit=opts.criterion==='max';const trials=[];
  const left=()=>maxMs-(Date.now()-started);
  const canJavelin=javelinSupports(opts).ok;   // Javelin を使うかは1か所で決め、厳密な試しと暫定の答えの両方で使う（レビュー R2）
  if(canJavelin){
    const j=solveJavelin(model,{...opts,maxMs:Math.min(quickMs,left())});trials.push({solver:'Javelin',status:j.status,ms:j.stats.elapsedMs});
    if(j.status==='complete'){j.solver='Javelin';j.trials=trials;
      // 最大の答えも並べる：素早い Javelin で解けた局面は、達成率最大の基準でも Javelin で解く（解けなければ maxResult は null）
      if(opts.alsoMax&&!crit){const M=maxTracker(model,opts);const jm=solveJavelin(model,{...opts,criterion:'max',maxMs:Math.max(1,Math.min(quickMs,left()))});M.offer(jm,'Javelin（達成率最大）');return M.attach(j);}
      return j;}}
  // 暫定の答え：比べる順で良い方（α のときは α を満たすもの、なければ P の大きいもの）
  const key=r=>r.bestRaw;let prov=null;const MX=maxTracker(model,opts);
  const better=(a,b)=>!b||betterBest(key(a),key(b),opts);   // 自然さまで比べる（レビュー JA1）
  const offer=(r,label)=>{trials.push({solver:label,status:r.status,ms:r.stats?.elapsedMs,best:r.best&&[r.best.p,r.best.d,r.best.a]});MX.offer(r,label);
    if(r.status==='complete'&&r.best&&better(r,prov)){prov=compactProv(model,opts,r);prov.solver=label;if(onUpdate)onUpdate(finish(prov,false));}
    else if(MX.on&&prov&&onUpdate&&r.status==='complete')onUpdate(finish(prov,false));};   // 最大の答えだけが良くなったときも知らせる
  const finish=(r,done)=>MX.attach({...r,status:'provisional',kind:'provisional',optimalityProven:false,meetsAlpha:meets(opts,r),kindLabel:'暫定（検証済みの方策、最適は未証明）',trials:trials.slice(),final:done,
    proven:r.bestRaw&&r.bestRaw.p.n===r.bestRaw.p.d?'達成率 100% は最大（証明済み）。E[D]・E[A] の最適は未証明':'証明できた範囲なし（暫定の達成率が最大かは未証明）'});
  // 2) 安い暫定の答えを、厳密な計算の前に作る（2026-11-03。GUI からの報告：予算60秒で、厳密な Tomahawk に時間を使い切り、暫定が達成率0%のまま
  //    だった局面がある。上位3手の探索で1.6秒、層の上限2万で6.7秒なら達成率100%の暫定が作れた）
  const stepMs=()=>Math.min(left(),Math.max(5000,maxMs*(opts.earlyFrac??0.05)));   // 最低5秒（引き方の多い局面で、上位1手の探索に4秒ほどかかる）
  const p1=()=>prov&&prov.bestRaw.p.n===prov.bestRaw.p.d;
  // α を決めた比較でも、最初の暫定は「達成率を最大にする」Javelin の上位1〜3手で作る（実際に打てる方策。α の比較でもそのまま候補になる。2026-11-04）
  const bm=beamOpts(opts);
  if(bm)for(const b of opts.beams??[1,2,3]){if(p1())break;if(left()<=0)break;
    const r=solveJavelin(model,{...bm,beam:b,maxMs:stepMs(),orderHeat:opts.beamHeat??8,maxMemo:opts.beamMaxMemo??1e5});offer(r,'Javelin（上位'+b+'手'+((opts.beamHeat??8)?'・熱意の見込みの順':'')+(crit?'':'・達成率最大')+'）');if(r.status!=='complete')break;}
  const capsLeft=capStages(opts,caps);let memStop=Infinity;   // メモリの上限に当たった層の上限（それ以上の上限の段は試さない）
  // asMax：α を決めた比較でも、届く最大の基準（速い辞書式）で解いて暫定の候補にする。その答えは α の最適ではないので、最終にはしない
  const tryCap=(st,ms,asMax=false)=>{const cap=capLabel(st);const r=solveTomahawk(model,{...(asMax?{...opts,criterion:'max'}:opts),...capOpts(model,opts,st),maxStates:Infinity,maxMs:ms});if(opts.compact!==false)trim(model);
    // 層の上限に一度も当たらずに終わったら、絞っていないので厳密に解けている：最適（証明済み）として返す（レビュー JA2 の確認で見つけた）
    if(r.status==='complete'&&r.optimalityProven&&!asMax){trials.push({solver:'Tomahawk（層の上限 '+cap+'、上限に当たらず完了）',status:r.status,ms:r.stats?.elapsedMs});r.solver='Tomahawk';r.trials=trials;MX.offer(r,'Tomahawk');return MX.attach(r);}
    if(r.reason==='MEMORY_LIMIT'){memStop=Math.min(memStop,st.cap);trials.push({solver:'Tomahawk（層の上限 '+cap+'）',status:r.status,reason:r.reason,ms:r.stats?.elapsedMs});return null;}   // メモリの上限：これより大きい層の上限も無理
    offer(r,'Tomahawk（層の上限 '+cap+(asMax?'・達成率最大':'')+'）');return null;};
  // 早めの層の上限は小さく（既定5千：重い局面で約1秒）。後の改善は caps（既定 2万 → 10万 → 30万）
  for(const st of capStages(opts,[opts.earlyCap??5000])){if(p1()||left()<=0)break;const done=tryCap(st,Math.min(left(),maxMs*(opts.capFrac??0.15)),!crit&&opts.alphaEarlyMax!==false);if(done)return done;}
  // 3) Tomahawk で厳密に解く。暫定の答えを良くする時間を、予算の reserveFrac（既定 25%）だけ残す
  const reserve=maxMs*(opts.reserveFrac??0.25);
  const t=solveTomahawkAuto(model,{...opts,maxStates,growthLimit:growthLimitOf(opts,maxStates),maxMs:Math.max(1,left()-reserve)});if(t.status!=='complete'&&opts.compact!==false)trim(model);trials.push({solver:'Tomahawk',status:t.status,reason:t.reason,ms:t.stats?.elapsedMs});
  if(t.status==='complete'){t.solver='Tomahawk';t.trials=trials;MX.offer(t,'Tomahawk');return MX.attach(t);}
  // 4) 残りの時間で、暫定の答えを良くする。既定：層の上限を広げる。improve:true（試作。届く最大の基準だけ）：層の上限2万の後、
  //    暫定の方策の分かれ目を到達確率の高い順に Javelin で解き直す（improvePolicy）
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

// ---- 続きから計算できる Aegis（createAegisJob。2026-11-03、GUI からの依頼） ----
// const job=createAegisJob(model,opts); let r=job.run({maxMs:60000,maxStates,onUpdate}); r=job.run({maxMs:60000}); job.dispose();
// 1回の run の中の流れは solveAegis と同じ（素早い Javelin → 安い暫定 → 厳密な Tomahawk → 層の上限を広げて暫定を良くする）。
// 違い：厳密な Tomahawk と層の上限つきの Tomahawk は、止めた位置（前向きの層・状態、後ろ向きの番号）を覚えていて、次の run で続きから計算する
// （solveTomahawk の opts.resume）。Javelin（素早い試しと上位1〜3手）は短いので、最初の run だけで行う（続きからはしない）。
// 状態数（maxStates、累計）やメモリ（opts.maxHeapMiB）の上限を超えたら、厳密な計算の続きは捨てる（メモリを返す）。
// 続けても良くならないときは resumable:false と、その理由（resumeReason）を返す。
export function createAegisJob(model,opts={}){
  const crit=opts.criterion==='max';const canJavelin=javelinSupports(opts).ok;
  const caps=capStages(opts,opts.caps??[20000,100000,300000]),steps=opts.horizonSteps??[opts.maxOps??24,48,96];
  const bm=beamOpts(opts);const J={trials:[],prov:null,final:null,calls:0,totalMs:0,quickDone:!canJavelin,beamIdx:bm?0:Infinity,
    early:{stages:capStages(opts,[opts.earlyCap??5000]),idx:0,res:{},done:false},exact:{hi:0,res:{},last:null,widened:[],abandoned:null},cap:{idx:0,res:{}},disposed:false};
  const key=r=>r.bestRaw;const better=(a,b)=>!b||betterBest(key(a),key(b),opts);const MX=maxTracker(model,opts);   // 最大の答えも並べる（opts.alsoMax）
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
      if(r.status==='complete'&&r.best&&better(r,J.prov)){J.prov=compactProv(model,opts,r);J.prov.solver=label;if(onUpdate)onUpdate(out(finish(J.prov)));}
      else if(MX.on&&J.prov&&onUpdate&&r.status==='complete')onUpdate(out(finish(J.prov)));};
    // 1) 素早い Javelin（最初の run だけ）
    if(!J.quickDone){J.quickDone=true;const j=solveJavelin(model,{...opts,maxMs:Math.min(opts.quickMs??2000,left())});J.trials.push({solver:'Javelin',status:j.status,ms:j.stats.elapsedMs});
      if(j.status==='complete'){j.solver='Javelin';j.trials=J.trials.slice();J.final=j;
        if(MX.on){const jm=solveJavelin(model,{...opts,criterion:'max',maxMs:Math.max(1,Math.min(opts.quickMs??2000,left()))});MX.offer(jm,'Javelin（達成率最大）');}
        return done();}}
    // 2) 安い暫定：Javelin の上位1〜3手（最初の run だけ）と、Tomahawk の層の上限5千（続きから）
    const stepMs=()=>Math.min(left(),Math.max(5000,maxMs*(opts.earlyFrac??0.05)));const beams=opts.beams??[1,2,3];
    while(J.beamIdx<beams.length){if(p1()||left()<=0){J.beamIdx=Infinity;break;}const b=beams[J.beamIdx++];
      const r=solveJavelin(model,{...bm,beam:b,maxMs:stepMs(),orderHeat:opts.beamHeat??8,maxMemo:opts.beamMaxMemo??1e5});offer(r,'Javelin（上位'+b+'手'+((opts.beamHeat??8)?'・熱意の見込みの順':'')+(crit?'':'・達成率最大')+'）');if(r.status!=='complete'){J.beamIdx=Infinity;break;}}
    const tryCap=(st,res,ms,asMax=false)=>{const cap=capLabel(st);const r=solveTomahawk(model,{...(asMax?{...opts,criterion:'max'}:opts),...capOpts(model,opts,st),maxStates:Infinity,maxMs:ms,resume:res});if(r.status==='complete'&&opts.compact!==false)trim(model);
      if(r.status==='complete'&&r.optimalityProven&&!asMax){J.trials.push({solver:'Tomahawk（層の上限 '+cap+'、上限に当たらず完了）',status:r.status,ms:r.stats?.elapsedMs});r.solver='Tomahawk';r.trials=J.trials.slice();MX.offer(r,'Tomahawk');J.final=r;return 'final';}
      if(r.status==='complete'){offer(r,'Tomahawk（層の上限 '+cap+(asMax?'・達成率最大':'')+'）');return 'done';}
      if(r.reason!=='TIME_LIMIT'){J.trials.push({solver:'Tomahawk（層の上限 '+cap+'）',status:r.status,reason:r.reason,ms:r.stats?.elapsedMs});return 'stop';}   // メモリの上限など：これより大きい上限も無理
      return 'more';};
    if(!J.early.done&&p1()){J.early.done=true;J.early.res=null;}
    while(!J.early.done&&left()>0){const Q=J.early;const x=tryCap(Q.stages[Q.idx],Q.res,Math.min(left(),maxMs*(opts.capFrac??0.15)),!crit&&opts.alphaEarlyMax!==false);if(x==='final')return done();if(x==='more')break;
      Q.idx++;Q.res={};if(x==='stop'||Q.idx>=Q.stages.length||p1()){Q.done=true;Q.res=null;}}
    // 3) 厳密な Tomahawk（続きから）。操作数の上限で切った状態があれば、上限を広げて解き直す（solveTomahawkAuto と同じ）
    const reserve=maxMs*(opts.reserveFrac??0.25);const E=J.exact;
    while(!E.abandoned&&E.hi<steps.length&&left()>reserve){const h=steps[E.hi];
      const r=solveTomahawk(model,{...opts,maxOps:h,maxStates,growthLimit:growthLimitOf(opts,maxStates),maxMs:Math.max(1,left()-reserve),resume:E.res});
      if(r.status!=='complete'){J.trials.push({solver:'Tomahawk（続きから）',status:r.status,reason:r.reason,ms:r.stats?.elapsedMs});
        if(r.reason==='TIME_LIMIT')break;
        // 状態数・メモリの上限：厳密な計算の続きは捨てる。その前の操作数の上限で解けていれば、その範囲での最適を返す
        E.abandoned=r.reason;E.res=null;
        if(E.last){E.last.widened=E.widened;E.last.widenNote='上限 '+h+' で解き直す途中で '+r.reason+' になったので、上限 '+E.last.stats.maxOps+' の範囲での最適を返す';J.final=E.last;return done();}
        break;}
      r.stats.maxOps=h;r.solver='Tomahawk';MX.offer(r,'Tomahawk');
      if(r.horizonFree||E.hi===steps.length-1){r.widened=E.widened;r.trials=J.trials.slice();J.final=r;return done();}
      E.widened.push({maxOps:h,horizonCut:r.stats.horizonCut});E.last=r;E.hi++;E.res={};
    }
    // 4) 残りの時間で、層の上限を広げて暫定を良くする（続きから）
    const C=J.cap;C.stop??=Infinity;
    while(C.idx<caps.length&&left()>0){if(caps[C.idx].cap>=C.stop){C.idx++;C.res={};continue;}   // メモリの上限に当たった上限以上の段は試さない
      const x=tryCap(caps[C.idx],C.res,left(),heatAsMax(opts,caps[C.idx],crit));if(x==='final')return done();if(x==='more')break;if(x==='stop'){C.stop=Math.min(C.stop,caps[C.idx].cap);}C.idx++;C.res={};}
    J.totalMs+=Date.now()-started;
    if(!J.prov)return out({status:'incomplete',reason:'TIME_LIMIT',kind:'incomplete',kindLabel:'未完了',trials:J.trials.slice(),stats:{elapsedMs:Date.now()-started}});
    return out(finish(J.prov));
  }
  // dispose：途中の計算（グラフ・展開中の層）を手放す。返した結果の extract は、その結果が持つグラフを使うので、結果を捨てるまでは使える
  // follow（G2 の案 A、2026-11-04）：最適（証明済み）の答えが Tomahawk のとき、1手（以上）打った後の局面の答えを、計算し直さずに返す。
  // path＝[{choice, edge}]（choice は方策の DAG の node.choice、edge は model.branches の枝の番号。GUI の nextTurn の path と同じ）。
  // 返り値は solveTomahawk の結果と同じ形（その局面を根とした最良・前線・table・extract・follow）。使えないとき（暫定・Javelin の答え・dispose の後）は null
  function follow(path){
    if(J.disposed)return null;const f=J.final;if(!f||typeof f.follow!=='function'||f.kind!=='optimal')return null;
    const r=f.follow(path);if(r&&r.kind!=='optimal')return null;   // Javelin の答えの follow が時間内に終わらなければ null（解き直す）
    return r&&{...r,solver:f.solver,followed:true,resumable:false,resumeReason:'続きの局面の答え（最初の計算のグラフ・覚えから）'};
  }
  // retarget（G2 の案 B、2026-11-04）：最適（証明済み）の Tomahawk の答えのとき、同じ局面で目標（≦今の目標）・基準（alpha／criterion）・比べる順などを変えた答えを、
  // 前向きのグラフを使い回して返す（後ろ向きだけ計算し直す）。o2 は solveTomahawk の opts。返り値は solveTomahawk の結果の形（最適）。使えないときは null
  function retarget(target2,o2={}){
    if(J.disposed)return null;const f=J.final;if(!f||typeof f.retarget!=='function'||f.kind!=='optimal')return null;
    const r=f.retarget(target2,o2);return r&&{...r,solver:f.solver,retargeted:true,resumable:false,resumeReason:'目標・基準を変えた答え（最初の計算のグラフから）'};
  }
  function dispose(){J.disposed=true;J.early.res=null;J.exact.res=null;J.exact.last=null;J.cap.res=null;J.prov=null;J.final=null;}
  return {run,follow,retarget,dispose,get state(){return {calls:J.calls,elapsedMs:J.totalMs,exactAbandoned:J.exact.abandoned,capIndex:J.cap.idx,final:!!J.final,canFollow:!J.disposed&&!!J.final&&typeof J.final.follow==='function'&&J.final.kind==='optimal'};}};
}

// ---- 部分改善（試作。2026-11-03、Codex の提案1・4 を受けて） ----
// 暫定の方策を、実際の状態つきの木として持ち、分かれ目を到達確率の高い順に Javelin で「その局面からの最適」として解き直す。
// 解けて、今の部分方策より辞書式（P → 比べる順の残り → 自然さ）で良ければ差し替える。届く最大の基準では、ある局面の値が良くなれば、
// 根の値も必ず良くなる（P は確率で重みを付けた和、P が同じなら D・A も同じ）。差し替えた後の値は、木の上で有理数で計算し直す（推定は使わない）。
// α を決めた比較（95/99/100%）は局面ごとに分けて比べられないので、使わない（届く最大の基準だけ）。
import {ZERO,ONE,R,add,sub,mul,cmp,str,toNum} from '../src/rational.mjs';
const sameAct=(a,b)=>JSON.stringify(a.raw??a)===JSON.stringify(b);
// 方策の DAG（extract の形）を、状態つきの木にする
function policyTree(model,dag){
  const build=(s,id)=>{const n=dag.nodes[id];
    if(n.choice===null)return {s,act:null,kids:[]};
    const act=model.choices(s).find(a=>sameAct(a,n.choice));if(!act)throw Error('IMPROVE_ACTION');
    const br=model.branches(s,act);if(br.length!==n.edges.length)throw Error('IMPROVE_EDGES');
    return {s,act,kids:br.map((b,i)=>({p:b.p,pf:b.pFloat,index:b.index,node:build(b.s,n.edges[i].next)}))};};
  return build(model.root,dag.root);
}
// 木の値（最終点の ev・floor。evalPolicyExact と同じ決まり）
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
// model：届く最大の基準のモデル、dag：暫定の方策、opts：{maxMs, sliceMs（最初の1局面の予算、既定2秒）, order, extras, onUpdate}
export function improvePolicy(model,dag,opts={}){
  const started=Date.now();const {maxMs=60000,sliceMs=2000,onUpdate=null}=opts;const extras=opts.extras||[];
  const useEv=extras.includes('ev'),useFl=extras.includes('floor');
  const cmpOpts={criterion:'max',order:opts.order,extras};
  const root=policyTree(model,dag);let rootV=treeValue(model,root,useEv,useFl);
  const log=[];let replaced=0,tried=0,solved=0;
  // 分かれ目を到達確率の順に（到達確率は浮動小数で順番だけに使う）
  const decisionNodes=()=>{const out=[];const walk=(n,pr,depth)=>{if(!n.act||n.exact)return;out.push({n,pr,depth});for(const k of n.kids)walk(k.node,pr*k.pf,depth+1);};walk(root,1,0);
    return out.sort((x,y)=>y.pr-x.pr||x.depth-y.depth);};
  const failed=new Map();   // 解けなかった局面 → その時の予算（次の周は2倍）
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
        break;}   // 木が変わったので、並べ直す
      n.exact=true;   // 今の部分方策がその局面で最適と分かった：これ以上解き直さない
    }
    if(!progress){if(slice>=maxMs)break;slice*=2;}   // 1周で何も差し替えられなかったら、予算を2倍にしてもう1周
  }
  const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}if(useEv){o.ev=str(v.ev);o.evNum=toNum(v.ev);}if(useFl){o.floor=str(v.fl);o.floorNum=toNum(v.fl);}return o;};
  const out=treeToDag(model,root);
  return {dag:out,value:rootV,best:summarize(rootV),stats:{tried,solved,replaced,elapsedMs:Date.now()-started,log}};
}
