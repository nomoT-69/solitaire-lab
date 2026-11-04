// Exact rational replay of ANY policy DAG (V6 or reference) against a model.
import {ZERO,ONE,R,add,mul,str,toNum,cmp} from './rational.mjs';
export function evalPolicyExact(model,policy){
  const memo=new Map();
  function walk(s,id){
    const n=policy.nodes[id];if(!n||n.key!==model.v6key(s))throw Error('EXACT_STATE');
    if(memo.has(id))return memo.get(id);let v;
    if(n.choice===null)v={p:s.score>=model.target?ONE:ZERO,d:ZERO,a:ZERO,maxD:0,maxA:0,ev:R(s.score),fl:R(s.score)};
    else{
      const act=model.choices(s).find(a=>JSON.stringify(a.raw??a)===JSON.stringify(n.choice)||JSON.stringify({...a,raw:undefined})===JSON.stringify(n.choice));
      if(!act)throw Error('EXACT_ACTION');
      const br=model.branches(s,act);if(br.length!==n.edges.length)throw Error('EXACT_COVERAGE');
      v={p:ZERO,d:act.type==='drink'?ONE:ZERO,a:act.type==='skip'?ZERO:ONE,maxD:0,maxA:0,ev:ZERO,fl:null};
      br.forEach((b,i)=>{const e=n.edges[i];if(e.index!==b.index||e.key!==model.v6key(b.s))throw Error('EXACT_EDGE');
        const c=walk(b.s,e.next);v.ev=add(v.ev,mul(b.p,c.ev));v.fl=v.fl===null||cmp(c.fl,v.fl)<0?c.fl:v.fl;v.p=add(v.p,mul(b.p,c.p));v.d=add(v.d,mul(b.p,c.d));v.a=add(v.a,mul(b.p,c.a));v.maxD=Math.max(v.maxD,c.maxD);v.maxA=Math.max(v.maxA,c.maxA);});
      v.maxD+=act.type==='drink'?1:0;v.maxA+=act.type==='skip'?0:1;
    }
    memo.set(id,v);return v;}
  const v=walk(model.root,policy.root);
  return {ev:str(v.ev),floor:str(v.fl),p:str(v.p),d:str(v.d),a:str(v.a),pNum:toNum(v.p),dNum:toNum(v.d),aNum:toNum(v.a),maxD:v.maxD,maxA:v.maxA,pRat:v.p,dRat:v.d,aRat:v.a};
}
