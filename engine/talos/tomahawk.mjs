// Tomahawk：ゼロベースで作り直した正解ソルバ（名前は利用者の命名 2026-11-03）。設計は DESIGN.md の 11章。
// 解くもの（Sidewinder＝src/reference4.mjs の v4 と同じ）：1ターンの札の使い方で、目標点に届く確率 P、期待ドリンク数 E[D]、期待行動数 E[A]
// （と自然さの指標 期待最終点・最低最終点）を有理数で正確に求め、比べる順（既定 D→P→A）で最良の方策を選ぶ。
//
// 作り（Sidewinder との違い）
//  1. 受け渡し（11.2）：エンジンは状態のキー（得点を除いた文字列）と、分数の確率 [分子,分母] を返す。ソルバは層ごとのキーの表で状態に番号を振り、
//     展開し終えた層の状態の中身とキーの表は捨てる。グラフ（行動・枝・確率・得点・子）は型付き配列。方策の復元はグラフの子の番号をたどる。
//  2. 届かない局面を切る：前向きの後に、各状態から取りうる最大の得点（グラフの上の正確な最大）を整数で求める。必要点がそれを超える区間は
//     「止める」だけになる（達成率0の方策の中で、止めるが D・A で最良）ので、その区間の前線は計算しない。
//  3. 前線の次元を減らす：比べる順の最後が A なら（既定 D→P→A）、前線を (P, E[D]) の2次元で持ち、同じ (P, E[D]) の点は E[A]（と指標）の
//     良い1点だけを残す（frontier:'pd'）。(P, E[D]) で負ける子の点を使う方策は、勝つ点に替えると E[D] が減るか P が増え、A を比べる前に負ける。
//     v4 と同じ3次元の前線が要るときは frontier:'pda'。
//  4. 「100%にできれば100%、できなければ届く最大の達成率」（criterion:'max'）では、前線ではなく辞書式の最良（P 最大 → 比べる順の残り）の
//     1点だけを持つ。辞書式の目的は動的計画で分解できる（子ごとに最良を選べば全体も最良）。α を決めた比較（95/99/100%の表）は前線で求める。
// 前提（v4 と同じ）：遷移で増える得点は現在点によらない（平行移動不変）。抜き取りで検査する。
import {ZERO,ONE,R,add as addR,mul as mulR,cmp as cmpR,str,toNum} from '../src/rational.mjs';
import {createEngine} from './tecnai.mjs';
// 分数の速い経路（結果は rational.mjs と同じ既約分数）
const add=(x,y)=>{if(x.n===0n)return y;if(y.n===0n)return x;if(x.d===y.d&&x.d===1n)return {n:x.n+y.n,d:1n};return addR(x,y);};
const mul=(x,y)=>{if(x.n===0n||y.n===0n)return ZERO;if(x.n===x.d)return y;if(y.n===y.d)return x;if(x.d===1n&&y.d===1n)return {n:x.n*y.n,d:1n};return mulR(x,y);};
const cmp=(x,y)=>{if(x===y)return 0;if(x.d===y.d)return x.n<y.n?-1:x.n>y.n?1:0;return cmpR(x,y);};
const eqR=(x,y)=>x===y||(x.n===y.n&&x.d===y.d);
export const DEFAULT_ORDER=['d','p','a'];
const MAXIMIZE={p:true,ev:true,fl:true,d:false,a:false};

// Tecnai のモデル（policy-eval.mjs で方策を再評価できる口：root / target / choices / branches / v6key）。engine があれば Tomahawk は速い経路を使う
// options.canonicalOrder：合法手を中身の名前の順、枝を子の中身のキーの順に並べる（並列の前向きで作ったグラフと順をそろえる）
export function tecnaiModel(data,setup,target,options={}){
  const E=createEngine(data,setup,options);const probs=new Map();const co=!!options.canonicalOrder;
  const rat=p=>{const k=p[0]+'/'+p[1];let r=probs.get(k);if(!r){r=R(p[0],p[1]);probs.set(k,r);}return r;};
  const v6key=co?s=>JSON.stringify([E.canon(s),s.score]):s=>JSON.stringify([s.key,s.score]);   // 中身の順のときは、方策のキーも中身で決まるキー
  return {engine:E,root:E.root,target,key:v6key,v6key,solKey:s=>s.key,withScore:E.withScore,
    choices:s=>{const cs=E.choices(s).map(a=>({...a,raw:a}));if(co)sortActs(E,cs);return cs;},
    branches(s,a){let bs=E.transition(s,a.raw??a).branches;if(co)bs=sortBranches(E,bs);return bs.map((b,index)=>({p:rat(b.p),pFloat:b.p[0]/b.p[1],s:b.s,index}));}};
}
// 層の上限で残す状態の順の見込み（heatCapScore）は talos/estimate.mjs へ移した。前の呼び方のため、ここからも出す（2026-11-04）
export {heatCapScore} from './estimate.mjs';
export const sortActs=(E,cs)=>{const k=new Map(cs.map(a=>[a,E.canonAct(a.raw??a)]));return cs.sort((x,y)=>k.get(x)<k.get(y)?-1:k.get(x)>k.get(y)?1:0);};
export const sortBranches=(E,bs)=>{const k=bs.map(b=>({b,c:E.canon(b.s)}));k.sort((x,y)=>x.c<y.c?-1:x.c>y.c?1:0);return k.map(x=>{x.b.canon=x.c;return x.b;});};

// 大きな表：JavaScript の Map は約1,670万件が上限なので、いっぱいになったら次の Map を足す（ふつうは1つのまま。引くときは順に探す）
export class BigMap{constructor(limit=16000000){this.ms=[new Map()];this.limit=limit;this.size=0;}
  get(k){const ms=this.ms;if(ms.length===1)return ms[0].get(k);for(let i=0;i<ms.length;i++){const v=ms[i].get(k);if(v!==undefined)return v;}return undefined;}
  set(k,v){let m=this.ms[this.ms.length-1];if(m.size>=this.limit){m=new Map();this.ms.push(m);}m.set(k,v);this.size++;return this;}}

// 伸びる型付き配列。広げるときは 1.5倍（2倍より使わない分が少ない。2026-11-04）。
// Uint32Array で始めたもの（得点・必要点）は、0〜2^32-1 の整数でない値（Infinity・大きすぎる値）が来たら Float64Array に切り替える（値は変わらない）
class Grow{constructor(T,n=1<<16){this.T=T;this.a=new T(n);this.n=0;this.u=T===Uint32Array;}
  up(v){if(this.u&&!(Number.isInteger(v)&&v>=0&&v<=0xFFFFFFFF)){const b=new Float64Array(this.a.length);b.set(this.a);this.a=b;this.T=Float64Array;this.u=false;}}
  push(v){if(this.u)this.up(v);if(this.n===this.a.length){const b=new this.T(Math.ceil(this.a.length*1.5));b.set(this.a);this.a=b;}this.a[this.n++]=v;}
  set(i,v){if(this.u)this.up(v);this.a[i]=v;}}

// 目標点によらない前向きのグラフを作る（同じ局面で、目標点・α・方式を変えて何度も解くときに、展開を1回にする）。
// 使い方：const g=prepareTomahawk(model,{maxOps}); solveTomahawk({...model,target:T},{alpha,graph:g.graph})。model は同じエンジンのもの
export function prepareTomahawk(model,opts={}){return solveTomahawk({...model,target:Infinity},{...opts,prepare:true,alpha:ONE,cut:false});}

// opts：alpha（有理数）または criterion:'max'、order、extras（'ev','floor'）、extrasMode、frontier（'auto'|'pd'|'pda'）、maxOps、maxStates、maxMs、maxFrontier、checkEvery
// 目標を決めるための表（G2 2026-11-05、利用者の依頼）：今の局面で「確率100%で届く最大の点」「確率 q 以上で届く最大の点」「取れる最大の点（最良の引き）」と、
// 目標ごとの最大の達成率の曲線を、目標によらないグラフ1つ（prepareTomahawk）から一度に出す。opts は prepareTomahawk に渡す（layerCap・capScore・maxMs・maxEstMiB など）。
//  - 100%：sure(v)＝各手で「引きが最悪でも取れる点」の最大（整数で正確）。最大：maxGain（正確）。途中の確率：達成率の曲線（浮動小数、表示用）。
//  - 層の上限で絞った・操作数の上限で切ったときは exact:false（その範囲で実際に打てる方策の値なので、本当の値はこれ以上）。
//  - 点は試合の得点（今の得点＋これから得る点）で返す。
export function solveTargetTable(model,opts={}){
  const started=Date.now();const qs=opts.quantiles??[0.5];const base=model.root.score||0;
  const pr=prepareTomahawk(model,opts);
  if(pr.status!=='prepared')return {status:'incomplete',reason:pr.reason??null,ms:Date.now()-started};
  const g=pr.graph,N=g.maxGain.length,{actStart,brStart,brChild,brGain,brProb,maxGain}=g;const P=g.probsR.map(toNum);
  // 1) 確率100%で届く最大（必要点）：引きが最悪でも取れる点の最大
  const sure=new Float64Array(N);
  for(let v=N-1;v>=0;v--){let b=0;for(let ai=actStart[v];ai<actStart[v+1];ai++){let w=Infinity;for(let bi=brStart[ai];bi<brStart[ai+1];bi++){const c=brChild[bi];const x=brGain[bi]+(c>=0?sure[c]:0);if(x<w)w=x;}if(w>b)b=w;}sure[v]=b;}
  // 2) 達成率の曲線：状態ごとに、必要点 t（1〜maxGain）での最大の達成率。区間の始まり（昇順）と値を持ち、最後は maxGain+1 から 0
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
  const curve=[];for(let i=0;i<T[0].length;i++)curve.push({score:base+T[0][i],p:V[0][i]});   // この点以上を目標にすると、次の点の手前まで最大の達成率は p
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
  // 比べる順に入っていない D・A は、点を捨てる判定に使わない（例：最終戦の P→A では D を比べない。2026-11-03 に直した）
  const useD=order.includes('d'),useA=order.includes('a');const Dv=u=>useD?u.d:ZERO,Av=u=>useA?u.a:ZERO;
  const floorFirstWithEv=useEv&&useFl&&extras.indexOf('floor')<extras.indexOf('ev');
  if(extrasMode==='tiebreak'&&floorFirstWithEv)throw Error('最低最終点→期待最終点の順では tiebreak は使えません');
  const mode=!extras.length?'none':extrasMode==='auto'?(floorFirstWithEv?'full':'tiebreak'):extrasMode;
  // 辞書式（criterion:'max'）は、指標の比べ方が分解できるとき（tiebreak）だけ。それ以外は前線で求めて pMax で選ぶ
  // reduce（既定 true。13.2 の案 A・B・C）：(P, E[D], E[A]) で負ける点は、自然さがどれだけ良くても最良に使われない
  //   （D・P・A を自然さより先に比べるので、その点を勝つ点に替えると、自然さを比べる前に勝つ）。そこで
  //   A：自然さつきでも届かない区間を切る（行動は A が1以上なので、止めるが (P,D,A) で勝つ。skip のある状態では切らない）
  //   B：重い方式（full）でも、(P,D,A) で負ける点を捨て、自然さの比べ合いは (P,D,A) が同点の点どうしだけで行う
  //   C：届く最大（criterion:'max'）の重い方式では、(P,D,A) が辞書式で最良の点だけを持ち、その中で自然さの2次元で負けない点を残す
  //   reduce:false は Sidewinder（v4）と同じ前線（自然さも含めた全次元）を作る（照合用）
  const reduceX=opts.reduce!==false;
  const lexMode=criterion==='max'&&mode!=='full';
  const lexFull=criterion==='max'&&mode==='full'&&reduceX;
  const lexKey=['p',...order.filter(k=>k!=='p'),...extraDims];
  // 前線の次元：比べる順の最後が A で、指標の比べ方が tiebreak か指標なしなら (P, D) の2次元
  // (P,D) の2次元にできるのは、比べる順が D を含み、最後が A のとき（D を比べない順では、(P,D) で負けても A の小さい点が要る。2026-11-03 に直した）
  const pdOk=order[order.length-1]==='a'&&order.includes('d');
  const fdim=frontier==='auto'?(pdOk&&(mode!=='full'||reduceX)?'pd':'pda'):frontier;
  if(!['pd','pda'].includes(fdim))throw Error('未対応の frontier: '+frontier);
  if(fdim==='pd'&&(!pdOk||(mode==='full'&&!reduceX)))throw Error("frontier:'pd' は比べる順が D を含み、最後が A のときだけ使えます（reduce:false の重い方式では使えない）");
  const mk=(p,d,a,ev,fl)=>{const v={p,d,a};if(useEv)v.ev=ev;if(useFl)v.fl=fl;return Object.freeze(v);};
  const GOAL=[mk(ONE,ZERO,ZERO,ZERO,ZERO)],STOP=mk(ZERO,ZERO,ZERO,ZERO,ZERO),STOP_LIST=[STOP];
  // 止めるしかない状態（手がない・届かない）の曲線は、どの必要点（1以上）でも「止める」なので、1つを共有する（層の上限で展開しない状態が多いとき、メモリを減らす）
  const LEAF=[{from:1,pts:STOP_LIST}];
  const started=Date.now();let segChecks=0;
  // 続きから（opts.resume）では、1つの状態の途中で止めると作業が無駄になるので、その呼び出しで1つ以上進むまでは途中で止めない
  let progressed=!opts.resume;const late=()=>progressed&&Date.now()-started>maxMs;
  const better=(u,v,k)=>{const c=cmp(u[k],v[k]);return MAXIMIZE[k]?c:-c;};
  const dominates=(u,v,ds)=>ds.every(k=>better(u,v,k)>=0);
  const extraCmp=(u,v)=>{for(const k of extraDims){const c=cmp(v[k],u[k]);if(c)return c;}return 0;};
  // 階段の方法（P 降順に並べ、前の点に支配されるかを E[D]（3次元なら E[A] も）で調べる）
  const EPS=opts.frontierEps?{p:opts.frontierEps.p??opts.frontierEps,d:opts.frontierEps.d??opts.frontierEps}:null;
  function pruneStair(list){
    if(list.length<=1)return list;
    if(fdim==='pd'){
      const sorted=list.slice().sort((u,v)=>cmp(v.p,u.p)||cmp(u.d,v.d)||cmp(u.a,v.a)||extraCmp(u,v));
      const out=[];let bestD=null;
      for(const u of sorted){if(bestD!==null&&cmp(bestD,u.d)<=0)continue;out.push(u);bestD=u.d;}   // P の大きい点ほど先：前の点より E[D] が小さい点だけ残る
      // opts.frontierEps（試作・測定用、G2 2026-11-05「α の前線が重い件」。既定は無効）：前の残した点との差が P で eps.p 未満かつ E[D] で eps.d 未満の点を捨てる（ε-パレート）。
      // 残る点はどれも実際の方策の正確な値なので、答えは検証済みの方策のまま（最適との差は1段あたり eps 以内。層の上限の暫定の段だけで使う想定）
      if(EPS&&out.length>1){const th=[out[0]];let lp=toNum(out[0].p),ld=toNum(out[0].d);
        for(let i=1;i<out.length;i++){const u=out[i],p=toNum(u.p),d=toNum(u.d);if(lp-p>=EPS.p||ld-d>=EPS.d){th.push(u);lp=p;ld=d;}}
        return th;}
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
  // (P,D,A) が同点の点の中で、自然さ（ev・floor）の2次元で負けない点（重い方式は floor→ev の順なので、1点に絞れない）
  function extras2D(g){
    if(g.length<=1)return g;
    const [k1,k2]=extraDims;
    if(!k2){let b=g[0];for(const u of g)if(cmp(u[k1],b[k1])>0)b=u;return [b];}
    const s=g.slice().sort((u,v)=>cmp(v[k1],u[k1])||cmp(v[k2],u[k2]));const out=[];let m=null;
    for(const u of s){if(m!==null&&cmp(u[k2],m)<=0)continue;out.push(u);m=u[k2];}
    return out;
  }
  // 案 B：重い方式の前線。(P,D[,A]) で群に分け、ほかの群に (P,D,A) で負ける群を捨て、残った群の中は自然さの2次元で負けない点
  function pruneGroups(list){
    if(list.length<=1)return list;
    const sorted=list.slice().sort((u,v)=>cmp(v.p,u.p)||cmp(Dv(u),Dv(v))||cmp(Av(u),Av(v)));
    const out=[],stair=[];let bestD=null;
    for(let i=0;i<sorted.length;){
      const r=sorted[i];let j=i+1;
      if(fdim==='pd'){while(j<sorted.length&&eqR(sorted[j].p,r.p)&&eqR(sorted[j].d,r.d))j++;}
      else{while(j<sorted.length&&eqR(sorted[j].p,r.p)&&eqR(Dv(sorted[j]),Dv(r))&&eqR(Av(sorted[j]),Av(r)))j++;}
      let grp=sorted.slice(i,j);i=j;
      if(fdim==='pd'){grp=grp.filter(u=>eqR(u.a,r.a));   // 同じ (P,D) なら A の小さい点だけ
        if(bestD!==null&&cmp(bestD,r.d)<=0)continue;bestD=r.d;}
      else{let lo=0,hi=stair.length-1,q=-1;
        while(lo<=hi){const mid=(lo+hi)>>1;if(cmp(Dv(stair[mid]),Dv(r))<=0){q=mid;lo=mid+1;}else hi=mid-1;}
        if(q>=0&&cmp(Av(stair[q]),Av(r))<=0)continue;
        let k=q+1;while(k<stair.length&&cmp(Av(stair[k]),Av(r))>=0)k++;stair.splice(q+1,k-(q+1),r);}
      for(const u of extras2D(grp))out.push(u);
    }
    return out;
  }
  // 案 C：届く最大の重い方式。辞書式（P → 比べる順の残り）で最良の (P,D,A) の点だけ、その中は自然さの2次元
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
  // 辞書式の比較（criterion:'max'）：u が v より良ければ正
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

  // 届かない区間：必要点 > 最大の得点 なら、どの方策でも達成率0。指標がなければ、止めるが D・A で最良（行動は A が1増える。skip は止めると同じ値）
  const canCut=cut&&(!extras.length||reduceX);
  // 自然さつきで切るのは、その状態に skip（A が増えない行動）がないときだけ（skip は止めると (P,D,A) が同点になりうる）
  const cutOk=id=>{if(!extras.length)return true;for(let ai=actStart.a[id];ai<actStart.a[id+1];ai++)if(actFlag.a[ai]&2)return false;return true;};
  // ---- 受け渡し：エンジン（速い経路）か、v4 と同じ口のモデル ----
  const E=model.engine&&model.engine.transition?model.engine:null;
  // 続きから（opts.resume）：前の呼び出しの展開の状態を使う（2026-11-03、GUI の「続きから計算」）
  const R0=opts.resume||null;
  const probIdx=R0?.probIdx??new Map(),probs=R0?.probs??[];
  const probOfR=r=>{const k=r.n+'/'+r.d;let i=probIdx.get(k);if(i===undefined){i=probs.length;probs.push(r);probIdx.set(k,i);}return i;};
  const probQ=R0?.probQ??new Map();   // 分子・分母が小さい確率は、数のキーで引く
  if(R0){R0.probIdx=probIdx;R0.probs=probs;R0.probQ=probQ;}
  const probOfQ=p=>{if(p[1]<67108864&&p[0]<67108864){const k=p[0]*67108864+p[1];let i=probQ.get(k);if(i===undefined){i=probOfR(R(p[0],p[1]));probQ.set(k,i);}return i;}
    return probOfR(R(p[0],p[1]));};
  const keyOf=E?s=>s.key:s=>model.solKey(s);
  const W=E?(s,x)=>E.withScore(s,x):(s,x)=>model.withScore(s,x);
  const choicesOf=E?s=>E.choices(s):s=>model.choices(s);
  // 枝：[{pi:確率の番号, p:比べる用, s}]（s.score＝得た得点、s は書き換えてよい）
  const branchesOf=E?(s,a)=>{const bs=E.transition(s,a).branches;for(const b of bs)b.pi=probOfQ(b.p);return bs;}:(s,a)=>model.branches(s,a).map(b=>({pi:probOfR(b.p),pq:null,s:b.s}));
  const sameProb=(a,b)=>a.pi===b.pi;
  // prepare：目標点によらないグラフを作るだけ（prepareTomahawk）。目標で切らず、根からの得点の最大（pathGain）を持つ
  const prepare=!!opts.prepare;
  const rootNeed=prepare?Infinity:model.target-model.root.score;
  const G0=R0?.g;
  const nodeK=G0?.nodeK??new Grow(Int8Array),minNeed=G0?.minNeed??new Grow(Uint32Array),actStart=G0?.actStart??new Grow(Int32Array);
  const actFlag=G0?.actFlag??new Grow(Uint8Array),brStart=G0?.brStart??new Grow(Int32Array);
  const brChild=G0?.brChild??new Grow(Int32Array),brGain=G0?.brGain??new Grow(Uint32Array),brProb=G0?.brProb??new Grow(Int32Array),pathGain=G0?.pathGain??new Grow(Uint32Array),dropF=G0?.dropF??new Grow(Uint8Array);
  if(R0&&!G0)R0.g={nodeK,minNeed,actStart,actFlag,brStart,brChild,brGain,brProb,pathGain,dropF};
  let curves=null,maxGain=null;
  const layerCap=opts.layerCap||0;let dropped=R0?.dropped??0;
  let segsOwn=R0?.segsOwn??0;   // 見積もりのメモリ用：共有の「止める」曲線（LEAF）を除いた、本当にメモリを使う区間の数（続きからでも累計。2026-11-04）
  let transitions=R0?.transitions??0,invarianceChecks=R0?.invarianceChecks??0,horizonCut=R0?.horizonCut??0,peakFrontier=0,segmentsTotal=0,maxLayer=R0?.maxLayer??0,cutNodes=0;
  const heapMiB=()=>globalThis.process?.memoryUsage?.().heapUsed/1048576||0;
  // 見積もりのメモリ（opts.maxEstMiB、G2 2026-11-04、設計案の検証3）：ブラウザでは使用メモリを測れないので、数から見積もる。
  // 見積もり＝型付き配列のバイト数（正確）＋ 展開中の層の状態の数 × EST.state ＋ エンジンの表（信念・効果の並び）× EST.table ＋ 曲線の区間 × EST.seg ＋ EST.base（700・6000・300・300MB）
  let fwRef=null;const EST={state:opts.estState??700,table:opts.estTable??6000,seg:opts.estSeg??300,base:opts.estBase??300*1048576};   // 表・区間は 2026-11-04 に 400・120 から直した（30万の段の後ろ向きで実際が見積もりを1割上回ったため）
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
  let pUB=undefined,ubNote=null;let status='complete',reason=null,root=null,forwardMs=0,backwardMs=0,ranForward=false;
  try{
    if(rootNeed<=0)root=GOAL;
    else if(opts.graph){
      // 並列の前向き（tomahawk-par.mjs）で作ったグラフを使う
      const G=opts.graph;const put=(g,a)=>{g.a=a;g.n=a.length;};
      put(nodeK,G.nodeK);put(minNeed,G.minNeed??G.pathGain.map(x=>Math.max(1,rootNeed-x)));put(actStart,G.actStart);put(actFlag,G.actFlag);put(brStart,G.brStart);put(brChild,G.brChild);put(brGain,G.brGain);put(brProb,G.brProb);if(G.pathGain)put(pathGain,G.pathGain);
      if(G.probsR)probs.push(...G.probsR);else for(const [n,d] of G.probs)probs.push(R(n,d));
      ({transitions,invarianceChecks,horizonCut,maxLayer}=G.stats);forwardMs=G.forwardMs;
    }
    if(rootNeed>0&&!opts.graph&&!(R0&&R0.forwardDone)){
      // 1) 前向き（層ごと。子の層のキーの表だけを持つ）。続きから（opts.resume）なら、止まった層・位置から続ける
      // 層の上限の展開中の追い出し（opts.capEvict、試作）：子の層の状態が layerCap×capEvict を超えたら、その時点の得点が低い状態を先に捨てる（メモリの山を下げる）
      const evictAt=layerCap&&opts.capEvict?Math.ceil(layerCap*opts.capEvict):0;
      const evict=(next,nf)=>{const idx=[];for(let i=0;i<next.length;i++)if(next[i]!==null)idx.push(i);idx.sort((x,y)=>(pathGain.a[nf+y]-pathGain.a[nf+x])||(x-y));
        for(let j=layerCap;j<idx.length;j++){next[idx[j]]=null;dropF.a[nf+idx[j]]=1;dropped++;}fw.live=Math.min(idx.length,layerCap);};
      // 流し込み型（opts.capStream、試作。G2 2026-11-04）：層の上限 N のとき、子の層の展開の途中で「残す順の値」の上位 N を最小ヒープで持つ。
      // N 件そろった後、ヒープの最小以下の新しい子は、状態もキーも持たず、層ごとに1つの「止める」だけの番号（sink）につなぐ（同じ状態が別の番号になりうるが、
      // どれも展開しない止める扱いなので値は厳密）。上位から外れた子は、その場で状態を捨てる。層の終わりの絞り込みと同じく、方策は実際に打てる手順
      const stream=!!(layerCap&&opts.capStream);
      const scoreOf=(st,pg)=>opts.capScore?opts.capScore(st,pg):pg;
      const hPush=(h,v,i)=>{h.v.push(v);h.i.push(i);let c=h.v.length-1;while(c>0){const p=(c-1)>>1;if(h.v[p]<=h.v[c])break;[h.v[p],h.v[c]]=[h.v[c],h.v[p]];[h.i[p],h.i[c]]=[h.i[c],h.i[p]];c=p;}};
      const hPop=h=>{const v=h.v[0],i=h.i[0],lv=h.v.pop(),li=h.i.pop();if(h.v.length){h.v[0]=lv;h.i[0]=li;let c=0;for(;;){const l=2*c+1,r=l+1;let m=c;if(l<h.v.length&&h.v[l]<h.v[m])m=l;if(r<h.v.length&&h.v[r]<h.v[m])m=r;if(m===c)break;[h.v[m],h.v[c]]=[h.v[c],h.v[m]];[h.i[m],h.i[c]]=[h.i[c],h.i[m]];c=m;}}return [v,i];};
      // 古い（値が変わった・捨てた）項目を取り除いた最小
      const hMin=(h,next,sc)=>{while(h.v.length&&(next[h.i[0]]===null||sc[h.i[0]]!==h.v[0]))hPop(h);return h.v.length?h.v[0]:-Infinity;};
      ranForward=true;let fw=R0?.fw??null;fwRef=fw;
      if(!fw){const s0=W(model.root,0);nodeK.push(maxOps);minNeed.push(rootNeed);pathGain.push(0);dropF.push(0);fw={k:maxOps,li:0,layer:[s0],layerFirst:0,ids:null,next:null,nextFirst:0};if(R0)R0.fw=fw;fwRef=fw;}
      for(;fw.k>=0&&fw.layer.length;fw.k--){
        const k=fw.k;
        if(!fw.ids){fw.ids=new BigMap(opts.mapLimit);fw.next=[];fw.nextFirst=nodeK.n;fw.li=0;fw.live=0;fw.sink=-1;fw.hp={v:[],i:[]};fw.sc=[];maxLayer=Math.max(maxLayer,fw.layer.length);}
        const {ids,next,layer,layerFirst}=fw;
        for(;fw.li<layer.length;fw.li++){const li=fw.li;
          if((li&255)===0)check();   // 状態に手を付ける前に確かめる（止まっても、この状態から続けられる）
          const s=layer[li],id=layerFirst+li;layer[li]=null;progressed=true;
          actStart.push(actFlag.n);
          if(s===null)continue;   // 層の上限（layerCap）で展開しなかった状態：そこで止める扱い
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
                if(fw.live>=layerCap&&sc<=hMin(fw.hp,next,fw.sc)){   // 上位 N に入らない：持たずに sink へ
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
        fw.layer=next;fw.layerFirst=fw.nextFirst;fw.ids=null;fw.next=null;fw.hp=null;fw.sc=null;
        // opts.growthLimit（G2 2026-11-05、利用者の決定。案 A）：層を作り終えたとき「ここまでの状態数 ＋ 今の層の状態数 × 伸び（今の層 ÷ 前の層）」が上限を超えたら、
        // 入りきらない見込みとして早めに止める（GROWTH_LIMIT）。層の上限つきの探索では使わない。ランダム42局面で、解き切れる局面を止める誤り 0件（DESIGN 22.23）
        if(opts.growthLimit&&!layerCap&&layer.length){const L=next.length;if(nodeK.n+L*(L/layer.length)>opts.growthLimit)throw Error('GROWTH_LIMIT');}
        // 暫定の答え用（layerCap）：層の状態が上限を超えたら、その時点までの得点（根からの最大）が高い状態だけを展開する。
        // 展開しない状態は「そこで止める」扱いになるので、得られる方策は実際に打てる手順（値は厳密。最適は未証明）
        const lay=fw.layer,lf=fw.layerFirst;
        // opts.capScore（試作・測定用、G2 の手順3。既定なし）：残す状態を「根からの得点＋この先の見込み」で選ぶ。capScore(状態, 根からの得点) → 大きいほど残す
        if(layerCap&&lay.length>layerCap&&opts.capScore){const idx=[],sc=new Float64Array(lay.length);for(let i=0;i<lay.length;i++)if(lay[i]!==null){idx.push(i);sc[i]=opts.capScore(lay[i],pathGain.a[lf+i]);}
          idx.sort((x,y)=>(sc[y]-sc[x])||(pathGain.a[lf+y]-pathGain.a[lf+x])||(x-y));
          // opts.capMix（0〜1）：上限のうちこの割合は根からの得点の順で先に残し、残りを見込みの順で埋める
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
      // 2) 各状態から取りうる最大の得点（子は後ろの番号なので、後ろから）
      if(opts.graph?.maxGain)maxGain=opts.graph.maxGain;else if(R0?.maxGain)maxGain=R0.maxGain;else{maxGain=new Float64Array(N);if(R0)R0.maxGain=maxGain;
      for(let id=N-1;id>=0;id--){let m=0;for(let ai=actStart.a[id];ai<actStart.a[id+1];ai++)for(let bi=brStart.a[ai];bi<brStart.a[ai+1];bi++){const c=brChild.a[bi];const v=brGain.a[bi]+(c>=0?maxGain[c]:0);if(v>m)m=v;}maxGain[id]=m;}}
      if(prepare){const sl=(g,T)=>g.a.slice(0,g.n);
        return {graph:{nodeK:sl(nodeK),pathGain:sl(pathGain),actStart:sl(actStart),actFlag:sl(actFlag),brStart:sl(brStart),brChild:sl(brChild),brGain:sl(brGain),brProb:sl(brProb),
          probsR:probs.slice(),maxGain,forwardMs,stats:{transitions,invarianceChecks,horizonCut,maxLayer,dropped}},status:'prepared',stats:{nodes:N,transitions,forwardMs,dropped,horizonCut}};}
      // 3) 後ろ向き
      // 続きから：後ろ向きも、止まった番号から続ける（R0.curves・R0.bid）
      curves=R0?.curves??new Array(N);let id0=R0?.bid??N-1;if(R0)R0.curves=curves;
      for(let id=id0;id>=0;id--){
        if(R0)R0.bid=id;
        if((id&(R0?63:1023))===0&&Date.now()-started>maxMs)throw Error('TIME_LIMIT');
        if((id&1023)===0){if(opts.maxHeapMiB&&heapMiB()>opts.maxHeapMiB)throw Error('MEMORY_LIMIT');if(opts.onEst&&(id&16383)===0)opts.onEst(estParts());if(opts.maxEstMiB&&estMiB()>opts.maxEstMiB)throw Error('MEMORY_LIMIT');}   // 後ろ向きでもメモリの上限を見る（α の前線が大きい局面。2026-11-04）
        curves[id]=lexMode?rangeLex(id):range(id);progressed=true;
      }
      if(R0)R0.bid=-1;
      backwardMs=Date.now()-started-(opts.graph?0:forwardMs);
      root=at(curves[0],rootNeed);
      // 層の上限で展開しなかった状態があるとき：達成率の上限（opts.upperBound:true のとき。既定は計算しない：重い局面では根に近い層で絞るので、ほぼ 1 になり役に立たない）。展開しなかった状態を「必ず届く（P=1）」とみなして、
      // 同じグラフで P だけの最大を後ろ向きに計算する。本当の値はそれ以下なので、どの方策の達成率もこの値を超えない（2026-11-04）
      if(dropped&&opts.upperBound===true){try{pUB=upperP(N);}catch(e){if(e.message!=='TIME_LIMIT')throw e;pUB=null;ubNote='時間切れで上限を計算できなかった';}}
    }
  }catch(e){if(!['TIME_LIMIT','STATE_LIMIT','FRONTIER_LIMIT','MEMORY_LIMIT','GROWTH_LIMIT'].includes(e.message))throw e;status='incomplete';reason=e.message;}
  if(R0){R0.segsOwn=segsOwn;R0.transitions=transitions;R0.invarianceChecks=invarianceChecks;R0.horizonCut=horizonCut;R0.maxLayer=maxLayer;R0.dropped=dropped;if(ranForward)R0.forwardMs=(R0.forwardMs||0)+(forwardMs||Date.now()-started);R0.calls=(R0.calls||0)+1;}
  function at(curve,n){
    if(n<=0)return GOAL;if(n<curve[0].from)throw Error('CURVE_RANGE');
    let lo=0,hi=curve.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(curve[mid].from<=n)lo=mid;else hi=mid-1;}return curve[lo].pts;
  }
  // 必要点の区切り（その行動の値が変わりうる点）
  // 達成率の上限：曲線は [{from, p}]（必要点 from 以上で p）。展開しなかった状態は P=1、手がない状態は P=0
  function upperP(N){
    const UB=new Array(N),ONE_C=[{from:1,p:ONE}],ZERO_C=[{from:1,p:ZERO}];
    const atP=(c,n)=>{if(n<=0)return ONE;let lo=0,hi=c.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(c[mid].from<=n)lo=mid;else hi=mid-1;}return c[lo].p;};
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
            const q=g>=t?ONE:atP(UB[c],t-g);if(q.n!==0n)p=add(p,mul(probs[brProb.a[bi]],q));}
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
  // 辞書式（criterion:'max'）：各区間に最良の1点だけ
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
  const stats={extrasMode:mode,reduce:reduceX,frontierDims:lexMode?'lex':lexFull?'lex-full':fdim,nodes:nodeK.n,branches:brChild.n,actions:actFlag.n,transitions,invarianceChecks,horizonCut,cutNodes,peakFrontier,segmentsTotal,forwardMs,backwardMs,elapsedMs:Date.now()-started,maxLayer,
    probs:probs.length,engine:E?.stats?.()??null,heapUsedMiB:mem?Math.round(mem.heapUsed/1048576):null};
  // 結果の種類：optimal（最適、証明済み）／incomplete（未完了）。上限で切った状態が0件なら、操作数の上限がなくても最適
  const scopeOf=()=>horizonCut===0?'上限なしでも最適（操作数の上限 '+maxOps+' で切った状態は0件）':'操作数の上限 '+maxOps+' の範囲での最適（上限で切った状態 '+horizonCut+' 件）';
  if(!root)return {status,reason,stats,kind:'incomplete',kindLabel:'未完了'};
  if(dropped){stats.dropped=dropped;}
  if(opts.exposeGraph&&maxGain)stats.graph={N:nodeK.n,minNeed:minNeed.a,maxGain,actStart:actStart.a,brStart:brStart.a,brChild:brChild.a,brGain:brGain.a,brProb:brProb.a,actFlag:actFlag.a,nodeK:nodeK.a,curves,probs};   // 調べる用（測定のみ。curves は G2 の案 A の測定で足した）
  const alpha0=alpha;
  return resultAt(model.root,0,root,[]);
  // 結果を作る（根の局面、または follow でたどった続きの局面 rootS・グラフの番号 rootI・その局面の前線 root）
  function resultAt(rootS,rootI,root,path){
    let alpha=alpha0;
    const pmax=root.reduce((m,v)=>cmp(v.p,m)>0?v.p:m,ZERO);
    if(criterion==='max')alpha=pmax;   // 100%にできれば100%、できなければ届く最大の達成率
    const feasible=root.filter(v=>cmp(v.p,alpha)>=0);
    feasible.sort((u,v)=>{for(const k of lex){const c=better(v,u,k);if(c)return c;}return 0;});
    const best=feasible[0]??null,ties=best?feasible.filter(v=>lex.every(k=>cmp(v[k],best[k])===0)).length:0;
    const rootScore=R(rootS.score);
    const summarize=v=>{const o={};for(const k of ['p','d','a']){o[k]=str(v[k]);o[k+'Num']=toNum(v[k]);}
      if(useEv){const x=add(rootScore,v.ev);o.ev=str(x);o.evNum=toNum(x);}
      if(useFl){const x=add(rootScore,v.fl);o.floor=str(x);o.floorNum=toNum(x);}return o;};
    // 達成率の比較表（前線から。α ごとの最良）
    const table=alphas=>alphas.map(a=>{const f=root.filter(v=>cmp(v.p,a)>=0).sort((u,v)=>{for(const k of lex){const c=better(v,u,k);if(c)return c;}return 0;});return {alpha:str(a),best:f[0]?summarize(f[0]):null};});
    // 方策の復元：グラフの子の番号をたどり、実際の状態と必要点で前線（辞書式なら最良の1点）を計算し直して、値が一致する組合せを選ぶ
    // 方策の復元。あわせて、各分かれ目で「選んだ手と同じ評価（比べる順の値と、自然さの指標をつけた場合は指標まで、すべて同じ）になる別の手」を数える。
    // 返り値の sameEval：root＝ルートで同じ評価になる手の数（選んだ手を含む。1 なら別の手順はない）、altNodes＝同じ評価の別の手がある分かれ目の数、
    // decisionNodes＝分かれ目（手を選ぶ局面）の数。止める（何もしない）が同じ評価になる場合も1つの手として数える。
    function extract(target=best){
      if(!target||!curves)return null;const out=[];let altNodes=0,decisionNodes=0,rootTies=null;
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
        if(n<=0){out.push({id:out.length,key:model.v6key(s),choice:null,edges:[]});return out.length-1;}
        const a0=actStart.a[id];const acts=actStart.a[id+1]===a0?[]:model.choices(s);   // 操作数の上限で切った局面は、グラフに手がない（止めるだけ）
        if(actStart.a[id+1]-a0!==acts.length)throw Error('EXTRACT_GRAPH');
        // 同じ評価の手：止めるも1つの手として数える
        let ties=same(v,STOP)?1:0,chosen=null;
        for(let ai=0;ai<acts.length;ai++){const h=hitOf(s,id,n,v,acts[ai],ai);if(h){ties++;if(!chosen&&!same(v,STOP))chosen={...h,act:acts[ai]};}}
        if(acts.length){decisionNodes++;if(ties>1)altNodes++;}
        if(isRoot)rootTies=ties;
        if(same(v,STOP)){out.push({id:out.length,key:model.v6key(s),choice:null,edges:[],sameEval:ties});return out.length-1;}
        if(!chosen)throw Error('EXTRACT_NO_MATCH');
        const {hit,br,b0,act}=chosen;
        const picks=[];for(let x=hit.picks;x;x=x.prev)picks.push(x.c);picks.reverse();
        const node={id:out.length,key:model.v6key(s),choice:act.raw??act,edges:null,sameEval:ties};out.push(node);
        node.edges=br.map((b,i)=>({index:b.index,p:b.pFloat,key:model.v6key(b.s),drawn:[],next:build(b.s,brChild.a[b0+i],picks[i],false)}));
        return node.id;
      }
      const rootIdx=build(rootS,rootI,target,true);
      // 方策の DAG は、葉より先に親を出す順（policy-eval は番号で引くので、どの順でもよい）
      return {version:'gas-finite-dag-v1',root:rootIdx,nodes:out,sameEval:{root:rootTies,altNodes,decisionNodes}};
    }
    return {status,reason,stats,kind:dropped?'restricted':'optimal',kindLabel:dropped?'層の上限で展開を絞った範囲での最良（検証済みの方策、最適は未証明）':'最適（証明済み）',scope:dropped?'層の上限 '+layerCap+' で '+dropped+' 状態を展開しなかった範囲での最良（全体での最適は未証明）':scopeOf(),horizonFree:horizonCut===0,optimalityProven:!dropped,feasible:!!best,ties,alpha:str(alpha),pMaxWithinHorizon:dropped?null:str(pmax),restrictedPMax:dropped?str(pmax):undefined,pUpperBound:pUB===undefined?undefined:pUB===null?null:str(pUB),pUpperBoundNum:pUB?toNum(pUB):pUB,pUpperBoundNote:pUB===undefined?undefined:pUB===null?ubNote:'層の上限で展開しなかった状態を「必ず届く」とみなした上限（操作数の上限 '+maxOps+' の範囲）。どの方策の達成率もこれを超えない',frontierAtRoot:root.length,
      best:best&&summarize(best),bestRaw:best,frontier:root.map(summarize),frontierRaw:root,lex,extract,summarize,table,follow:p=>follow(p,{s:rootS,id:rootI,path}),retarget,path,maxScore:maxScoreAt(rootS,rootI)};
  }
  // この局面から取りうる最大の最終点（G2、2026-11-04）：グラフの上の正確な最大（maxGain）から。
  // 目標に届かないとき（最大 < 目標）は正確な値（exact:true）。目標に届くときは、届いた枝の先を展開していないので「目標以上」（exact:false, atLeast:true）。
  // 層の上限で絞ったグラフ・操作数の上限で切った状態があるときは、正確とは言えない（exact:false。値はその範囲での最大）
  function maxScoreAt(s,id){
    if(!maxGain)return null;const need=model.target-s.score;
    if(need<=0||id<0)return {value:s.score,reached:true,exact:false,atLeast:true,note:'目標に届いている'};
    const v=s.score+maxGain[id],reach=maxGain[id]>=need;
    const exact=!reach&&!dropped&&horizonCut===0;
    return {value:v,reached:reach,exact,atLeast:reach,note:reach?'目標以上（目標に届いた先は計算していない）':exact?'正確な最大（最大でもこの点）':dropped?'層の上限で絞った範囲での最大':'操作数の上限 '+maxOps+' の範囲での最大'};
  }
  // 目標・基準を変えて解き直す（G2 の案 B、2026-11-04）：このグラフ（前向き）をそのまま使い、後ろ向きだけを計算し直す。
  // 使えるのは、層の上限で絞っていない（dropped が0）、新しい目標 ≦ この目標のとき（目標に届いた枝の先は展開していないので、上げるときは使えない）。
  // o2：solveTomahawk の opts（alpha／criterion・order・extras など）。使えないときは null
  function retarget(target2,o2={}){
    if(dropped||!(target2<=model.target)||!maxGain||nodeK.n===0)return null;
    const sl=g=>g.a.slice(0,g.n);
    const graph={nodeK:sl(nodeK),pathGain:sl(pathGain),actStart:sl(actStart),actFlag:sl(actFlag),brStart:sl(brStart),brChild:sl(brChild),brGain:sl(brGain),brProb:sl(brProb),
      probsR:probs.slice(),maxGain,forwardMs,stats:{transitions,invarianceChecks,horizonCut,maxLayer}};
    const {alpha:_a,criterion:_c,...base}=opts;
    return solveTomahawk({...model,target:target2},{...base,...o2,maxOps,graph,resume:undefined,layerCap:0});
  }
  // 続きの局面を即答する（G2 の案 A、2026-11-04）：path＝[{choice, edge}]（choice は extract の node.choice と同じ形の手、edge は model.branches の枝の番号）。
  // 1手（以上）打った後の局面は、このグラフの中にあり、必要点ごとの前線（曲線）も計算済みなので、計算し直さずにその局面を根とした結果を返す。
  // 値はその局面から解き直した結果と同じ（bench/tomahawk-follow.mjs）。層の上限で展開しなかった局面は incomplete（NOT_EXPANDED）
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

// 操作数の上限（maxOps）は、計算を必ず終わらせるための安全の上限で、答えを狭めるためのものではない。
// 上限で切った状態が0件なら「上限なしでも最適」。0件でない稀な場合だけ、上限を広げて解き直す（24 → 48 → 96）。
// 予算（時間・状態数）を超えたら、その前の上限の範囲での最適を返し、範囲を結果に書く。広げ直しは結果の widened に残す。
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

