const MODS=new Set(['limit','ttl','delay','group','line','level']);
const isWord=c=>/[A-Za-z0-9_.$]/.test(c);

export function parseSequence(src){
  const s=String(src??'');let i=0;
  const ws=()=>{while(i<s.length&&/[\s;]/.test(s[i]))i++;};
  const err=m=>{throw Error('DSL: '+m+' @'+i+' in '+JSON.stringify(s));};
  function balanced(open,close){if(s[i]!==open)err('expected '+open);let d=0,j=i;for(;j<s.length;j++){if(s[j]===open)d++;else if(s[j]===close){d--;if(!d)break;}}if(d)err('unbalanced '+open);const inner=s.slice(i+1,j);i=j+1;return inner;}
  function exprText(){let d=0,j=i;for(;j<s.length;j++){const c=s[j];if(c==='('||c==='[')d++;else if(c===')'||c===']')d--;else if(!d&&(c==='{'||c===';'||c==='}'))break;}const t=s.slice(i,j).trim();i=j;return t;}
  function actionText(){let d=0,j=i;for(;j<s.length;j++){const c=s[j];if(c==='('||c==='[')d++;else if(c===')'||c===']')d--;else if(!d&&(c===';'||c==='}'||/\s/.test(c)))break;}const t=s.slice(i,j);i=j;return t;}
  function block(){ws();if(s[i]!=='{')return null;i++;const items=seq(true);if(s[i]!=='}')err('expected }');i++;return items;}
  function seq(inner){
    const out=[];
    for(;;){
      ws();if(i>=s.length){if(inner)err('missing }');return out;}
      if(s[i]==='}'){if(!inner)err('unexpected }');return out;}
      let append=false;if(s[i]==='+'&&/\s/.test(s[i+1]||'')){append=true;i++;ws();}
      let anchor;if(s[i]==='@'){i++;let j=i;while(j<s.length&&isWord(s[j]))j++;anchor=s.slice(i,j);i=j;ws();}
      let j=i;while(j<s.length&&/[A-Za-z]/.test(s[j]))j++;const word=s.slice(i,j);
      if(word==='do'){let k=j;while(k<s.length&&/\s/.test(s[k]))k++;if(s[k]==='{'){i=k;const body=block();out.push({kind:'effect',anchor,mods:{},body,...(append?{append}:{})});continue;}}
      const mark=x=>{if(append)x.append=true;return x;};
      if(s[j]===':'&&['at','if','target','do',...MODS].includes(word)){
        i=j+1;
        if(MODS.has(word)){
          let k=i;while(k<s.length&&/[0-9]/.test(s[k]))k++;const value=Number(s.slice(i,k));i=k;
          if(word==='level'){const save=i;ws();if(s[i]==='{'){const body=block();out.push({kind:'level',anchor,level:value,body});continue;}i=save;}
          out.push({kind:'mod',name:word,value});continue;}
        if(word==='do'){out.push(parseAction(actionText(),anchor));continue;}
        const e={kind:'effect',anchor,mods:{}};
        if(word==='at'){let k=i;while(k<s.length&&/[A-Za-z]/.test(s[k]))k++;e.phase=s.slice(i,k);i=k;if(s[i]==='[')e.filter=parseExpr(balanced('[',']'));}
        else if(word==='if'){e.cond=parseExpr(exprText());}
        else e.target=parseExpr(exprText());
        const body=block();
        if(body===null){if(word==='if'){out.push({kind:'cond',anchor,cond:e.cond});continue;}err('expected { after '+word);}
        e.body=[];for(const x of body){if(x.kind==='mod')e.mods[x.name]=x.value;else e.body.push(x);}
        out.push(mark(e));continue;
      }
      out.push(mark(parseAction(actionText(),anchor)));
    }
  }
  const out=seq(false);
  return out;
}

export function parseAction(t,anchor){
  const m=t.match(/^([A-Za-z_][A-Za-z0-9_.]*(?:\([^()]*\))?)\s*(\+=|-=|\*=|\/=|%=|=)(.*)$/s);
  if(m&&!/[=!<>]$/.test(m[1]))return {kind:'action',anchor,op:m[2],lhs:m[1],rhs:parseExpr(m[3])};
  const c=t.match(/^([A-Za-z_][A-Za-z0-9_]*)(.*)$/s);if(!c)throw Error('DSL action: '+t);
  let rest=c[2],target,args=[];
  if(rest.startsWith('[')){let d=0,j=0;for(;j<rest.length;j++){if(rest[j]==='[')d++;else if(rest[j]===']'){d--;if(!d)break;}}target=parseExpr(rest.slice(1,j));rest=rest.slice(j+1);}
  if(rest.startsWith('(')){if(!rest.endsWith(')'))throw Error('DSL args: '+t);args=splitArgs(rest.slice(1,-1)).map(parseExpr);rest='';}
  if(rest.trim())throw Error('DSL action rest: '+t);
  return {kind:'action',anchor,op:'call',name:c[1],...(target?{target}:{}),args};
}
function splitArgs(s){const out=[];let d=0,cur='';for(const c of s){if(c==='('||c==='[')d++;else if(c===')'||c===']')d--;if(c===','&&!d){out.push(cur);cur='';}else cur+=c;}if(cur.trim())out.push(cur);return out;}

export function parseExpr(src){
  const toks=[];const s=String(src);let i=0;
  while(i<s.length){const c=s[i];
    if(/\s/.test(c)){i++;continue;}
    if(/[0-9.]/.test(c)){let j=i;while(j<s.length&&/[0-9.]/.test(s[j]))j++;toks.push({t:'num',v:Number(s.slice(i,j))});i=j;continue;}
    if(/[A-Za-z_]/.test(c)){let j=i;while(j<s.length&&/[A-Za-z0-9_.]/.test(s[j]))j++;toks.push({t:'id',v:s.slice(i,j)});i=j;continue;}
    const two=s.slice(i,i+2);if(['>=','<=','==','!='].includes(two)){toks.push({t:'op',v:two});i+=2;continue;}
    if('<>+-*/%&|!()[],'.includes(c)){toks.push({t:'op',v:c});i++;continue;}
    throw Error('DSL expr char '+c+' in '+s);}
  let p=0;const peek=()=>toks[p],eat=v=>{if(toks[p]?.v===v){p++;return true;}return false;};
  const PREC=[['|'],['&'],['==','!=','>=','<=','>','<'],['+','-'],['*','/','%']];
  function bin(level){if(level===PREC.length)return unary();let a=bin(level+1);for(;;){const t=peek();if(t?.t==='op'&&PREC[level].includes(t.v)){p++;a={t:'bin',op:t.v,a,b:bin(level+1)};}else return a;}}
  function unary(){if(eat('!'))return {t:'un',op:'!',a:unary()};if(eat('-'))return {t:'un',op:'-',a:unary()};return primary();}
  function primary(){const t=toks[p++];if(!t)throw Error('DSL expr end: '+s);
    if(t.t==='num')return {t:'num',v:t.v};
    if(t.v==='('){const e=bin(0);if(!eat(')'))throw Error('DSL expr ): '+s);return e;}
    if(t.t==='id'){const n={t:'id',name:t.v};
      if(peek()?.v==='['){p++;const target=bin(0);if(!eat(']'))throw Error('DSL expr ]: '+s);n.t='call';n.target=target;n.args=[];}
      if(peek()?.v==='('){p++;const args=[];if(!eat(')')){do args.push(bin(0));while(eat(','));if(!eat(')'))throw Error('DSL expr args: '+s);}n.t='call';n.args=args;}
      return n;}
    throw Error('DSL expr token '+t.v+' in '+s);}
  const e=bin(0);if(p!==toks.length)throw Error('DSL expr trailing in '+s);return e;
}

export function exprToString(e){
  switch(e.t){case 'num':return String(e.v);case 'id':return e.name;
    case 'call':return e.name+(e.target?'['+exprToString(e.target)+']':'')+(e.args.length||!e.target?'('+e.args.map(exprToString).join(',')+')':'');
    case 'un':return e.op+'('+exprToString(e.a)+')';case 'bin':return '('+exprToString(e.a)+e.op+exprToString(e.b)+')';}
  throw Error('expr');
}
export function seqToString(items){
  return items.map(x=>{const a=(x.append?'+ ':'')+(x.anchor?'@'+x.anchor+' ':'');
    if(x.kind==='mod')return x.name+':'+x.value;
    if(x.kind==='cond')return a+'if:'+exprToString(x.cond);
    if(x.kind==='level')return a+'level:'+x.level+' { '+seqToString(x.body)+' }';
    if(x.kind==='action')return a+(x.op==='call'?x.name+(x.target?'['+exprToString(x.target)+']':'')+'('+x.args.map(exprToString).join(',')+')':x.lhs+x.op+exprToString(x.rhs));
    const head=!x.phase&&!x.cond&&!x.target?'do':x.phase?'at:'+x.phase+(x.filter?'['+exprToString(x.filter)+']':''):x.cond?'if:'+exprToString(x.cond):x.target?'target:'+exprToString(x.target):'';
    const mods=Object.entries(x.mods).filter(([k,v])=>v!==null).map(([k,v])=>k+':'+v);
    return a+head+' { '+[seqToString(x.body),...mods].filter(Boolean).join('; ')+' }';}).join('; ');
}
