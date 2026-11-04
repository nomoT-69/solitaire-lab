// Talos・Tecnai が対応している DSL の一覧と、札・ドリンク・P アイテムの「対応していない効果」を調べる関数（読み込む前に、静的に調べる）。
// エンジン（engine.mjs・tecnai.mjs）の対応の範囲と同じにする（bench/test-settings.mjs で、ここで対応とした札がエンジンで読み込めることを確かめる）。
// ブラウザでも動く（Node 専用の機能なし）。
export const IN_TURN=new Set(['beforeCardUsed','cardUsed','activeCardUsed','mentalCardUsed','afterCardUsed','afterActiveCardUsed','afterMentalCardUsed','stanceChanged','stanceValueChanged','endOfTurn','staminaDecreased']);
export const LATER=new Set(['turn','startOfTurn','beforeStartOfTurn','afterStartOfTurn','everyTurn','startOfStage','afterStartOfStage','prestage','turnSkipped']);
export const IGNORED_FIELDS=new Set(['genki','fixedGenki','stamina','fixedStamina','fullPowerCharge','halfCostTurns','doubleCostTurns','costReduction','costIncrease','nullifyCostCards','nullifyCostActiveCards','cost','nullifyGenkiTurns','doubleBuffCostTurns']);
export const IGNORED_GROWTH=new Set(['g.cost','g.typedCost','g.genki','g.fullPowerCharge','g.halfCostTurns']);
export const IGNORED_CALLS=new Set(['setFullPowerChargeBuff','setFullPowerEffectBuff','decreaseFullPowerCharge']);
export const CALLS=new Set(['setStance','drawCard','exchangeHand','addCardToDeck','holdSelected','moveRandomToHand','removeRandom','useRandomCardFree','addRandomUpgradedSSRCardToHand',
  'setScoreBuff','setEnthusiasmBuff','setEnthusiasmBonus','setStrengthEffectBuff',...IGNORED_CALLS]);
export const ASSIGN=new Set(['score','cardUsesRemaining','enthusiasm','enthusiasmMultiplier','effectCounter','scoreTimes']);
export const VARIABLES=new Set(['stance','prevStance','isStrength','isPreservation','isFullPower','preservationTimes','strengthTimes','leisureTimes','fullPowerTimes','stanceChangedTimes',
  'stanceChangedByDirectEffectTimes','isDirectEffect','effectCounter','cardsUsed','turnCardsUsed','turnsRemaining','cardUsesRemaining','enthusiasm','score','usedCardBaseId','usedCardId',
  'none','strength','strength2','preservation','preservation2','leisure','fullPower','parentPhase','processCost','processCard']);
export const STANCE_NAMES=new Set(['preservation','preservation2','leisure','strength','strength2']);
const FUNCS=new Set(['cardHasEffect','countCards','effectCounter']);
const TARGET_IDS=new Set(['all','hand','deck','held','removed','discarded','active','mental','trouble','pIdol','T','N','R','SR','SSR','L','this']);
const TARGET_CALLS=new Set(['baseId','id','effect']);

// 式の中の、対応していない変数・関数
function exprProblems(e,out,where){
  if(!e)return;
  switch(e.t){case 'num':return;
    case 'id':if(!VARIABLES.has(e.name))out.push(where+'：対応していない変数「'+e.name+'」');return;
    case 'un':exprProblems(e.a,out,where);return;
    case 'bin':exprProblems(e.a,out,where);exprProblems(e.b,out,where);return;
    case 'call':if(!FUNCS.has(e.name)){out.push(where+'：対応していない関数「'+e.name+'」');return;}
      if(e.name==='countCards')targetProblems(e.target,out,where);return;}
}
function targetProblems(e,out,where){
  if(!e)return;
  switch(e.t){case 'num':return;
    case 'id':if(!TARGET_IDS.has(e.name)&&!/^\d+$/.test(e.name))out.push(where+'：対応していない札の対象「'+e.name+'」');return;
    case 'un':if(e.op!=='!')out.push(where+'：対応していない札の対象の式');else targetProblems(e.a,out,where);return;
    case 'bin':if(e.op!=='&'&&e.op!=='|')out.push(where+'：対応していない札の対象の式（'+e.op+'）');else{targetProblems(e.a,out,where);targetProblems(e.b,out,where);}return;
    case 'call':if(!TARGET_CALLS.has(e.name))out.push(where+'：対応していない札の対象「'+e.name+'(…)」');return;}
}
// 項目の並び（DSL の構文解析の結果）の、対応していない効果。where：場所の説明
export function itemProblems(items,where,out=[]){
  for(const x of items||[]){
    if(x.kind==='action'){
      if(x.op==='call'){
        if(!CALLS.has(x.name)){out.push(where+'：対応していない効果「'+x.name+'」');continue;}
        if(x.name==='setStance'){const a=x.args[0];if(!a||a.t!=='id'||!STANCE_NAMES.has(a.name))out.push(where+'：対応していない指針「'+(a?.name??a?.v??'')+'」');}
        else for(const a of x.args)if(a.t!=='id')exprProblems(a,out,where);
        if(x.target)targetProblems(x.target,out,where);
      }else{
        if(IGNORED_FIELDS.has(x.lhs)||IGNORED_GROWTH.has(x.lhs))continue;   // 省く項目（体力など）は、右辺も読まない
        if(!(ASSIGN.has(x.lhs)||x.lhs==='g.score'||x.lhs==='g.scoreTimes')){out.push(where+'：対応していない代入「'+x.lhs+x.op+'」');continue;}
        exprProblems(x.rhs,out,where);}
    }else if(x.kind==='effect'){
      if(x.phase){if(LATER.has(x.phase))continue;if(!IN_TURN.has(x.phase)){out.push(where+'：対応していない発動のきっかけ「'+x.phase+'」');continue;}}
      if(x.filter)targetProblems(x.filter,out,where);
      if(x.cond)exprProblems(x.cond,out,where);
      if(x.target){targetProblems(x.target,out,where);
        for(const y of x.body){if(y.kind!=='action'||y.op==='call'){out.push(where+'：成長の書き方が対応していない');continue;}
          if(IGNORED_GROWTH.has(y.lhs))continue;if(y.op!=='+='||!(y.lhs==='g.score'||y.lhs==='g.scoreTimes'))out.push(where+'：対応していない成長「'+y.lhs+y.op+'」');}
        continue;}
      itemProblems(x.body,where,out);
    }else if(x.kind==='cond')exprProblems(x.cond,out,where);
    else if(x.kind==='level')out.push(where+'：カスタマイズの段階（level）は札の効果には書けない');
  }
  return out;
}
// 選ぶ行動（holdSelected など）は、最初の行動でなければならない
function selectProblems(items,where,out){
  const i=(items||[]).findIndex(x=>x.kind==='action'&&x.op==='call'&&/Selected/.test(x.name));
  if(i>0)out.push(where+'：選ぶ行動（'+items[i].name+'）が最初にない札は対応していない');
  else if(i===0&&items[i].name!=='holdSelected')out.push(where+'：対応していない選ぶ行動「'+items[i].name+'」');
}
// 札1枚の、対応していない効果（使用条件・効果・継続効果）
export function cardProblems(card){
  const out=[],w=(card.name||String(card.id))+'（'+(card.key??card.id)+'）';
  for(const c of card.usable||[])exprProblems(c,out,w+'の使用条件');
  itemProblems(card.actions,w+'の効果',out);selectProblems(card.actions,w+'の効果',out);
  itemProblems(card.effects,w+'の継続効果',out);
  return out;
}
export function drinkProblems(d){const out=[],w=d.name+'（ドリンク '+d.id+'）';itemProblems(d.actions,w,out);selectProblems(d.actions,w,out);return out;}
export function itemDefProblems(it){const out=[],w=it.name+'（P アイテム '+it.id+'）';
  for(const e of it.effects)if(e.kind!=='effect'||!e.phase)out.push(w+'：P アイテムの形が対応していない');
  itemProblems(it.effects,w,out);return out;}

// gakumas-tools の CSV を差し替えたときの点検：対応していない効果を持つ札・ドリンク・P アイテムの一覧（日本語の理由つき）
export function unsupportedList(data){
  const cards=[],drinks=[],items=[];
  for(const c of data.cards.values()){if(typeof c.key==='string')continue;const p=cardProblems(c);if(p.length)cards.push({id:c.id,name:c.name,problems:p});}
  for(const d of data.drinks.values()){const p=drinkProblems(d);if(p.length)drinks.push({id:d.id,name:d.name,problems:p});}
  for(const it of data.items.values()){const p=itemDefProblems(it);if(p.length)items.push({id:it.id,name:it.name,problems:p});}
  return {cards,drinks,items,counts:{cards:data.cards.size,unsupportedCards:cards.length,drinks:data.drinks.size,unsupportedDrinks:drinks.length,items:data.items.size,unsupportedItems:items.length}};
}

// ---- P アイテムの入力欄（2026-11-04、利用者「デッキで選んだら、対象の P アイテムの入力欄が出るように」） ----
// pItemInputs(data, {pIdolId} または {ids})：その P アイドルの固有の P アイテム（または指定した番号）について、計算に使えるか（supported・problems）、
// ソリティアの中で発動しうるか（inSolitaire）、要る入力欄（inputs）を返す。入力欄：
//   {key:'fired', label:'発動済みの回数', min:0, max:回数の上限, slot}：回数の上限（limit）のある効果ごと。エンジンには残り回数（上限−発動済み）を渡す
//   {key:'counter', label:'カウンタ', min:0}：効果のカウンタ（effectCounter）を読む・書く P アイテム
// 1回の発動で熱意倍率を変える効果（setEnthusiasmBuff(数)）は enthusiasmBuffPerUse に出す（発動済みの分は enthusiasmBuff に含めて渡す決まり。DESIGN 22.10）
const limitSlots=e=>{const out=[];(function walk(n){if(n.kind!=='effect')return;if(n.mods?.limit!=null)out.push({limit:n.mods.limit,node:n});for(const b of n.body||[])if(b.kind==='effect'&&!b.phase)walk(b);})(e);return out;};
const buffPerUse=node=>{let v=0;(function walk(items){for(const x of items||[]){if(x.kind==='action'&&x.op==='call'&&x.name==='setEnthusiasmBuff'&&x.args[0]?.t==='num'&&x.args.length===1)v+=x.args[0].v;else if(x.kind==='effect'&&!x.phase)walk(x.body);}})(node.body);return v;};
const usesCounter=items=>JSON.stringify(items).includes('effectCounter');
export function pItemInputs(data,{pIdolId=null,ids=null}={}){
  const list=ids?ids.map(id=>data.items.get(id)).filter(Boolean):[...data.items.values()].filter(it=>pIdolId!=null&&it.pIdolId===pIdolId);
  return list.map(it=>{
    const problems=itemDefProblems(it);const inTurn=(it.effects||[]).filter(e=>e.kind==='effect'&&IN_TURN.has(e.phase));
    const inputs=[];let slot=0;
    for(const e of inTurn)for(const sl of limitSlots(e)){inputs.push({key:'fired',label:'発動済みの回数',min:0,max:sl.limit,slot:slot++,enthusiasmBuffPerUse:buffPerUse(sl.node)||null});}
    if(inTurn.length&&usesCounter(inTurn))inputs.push({key:'counter',label:'カウンタ',min:0});
    return {id:it.id,name:it.name,upgraded:!!it.upgraded,pIdolId:it.pIdolId??null,supported:!problems.length,problems,inSolitaire:inTurn.length>0,inputs,
      note:it.id===307||it.id===308?'試作・未検証：ソリティアの途中は、コストが stamina-= の札でだけ発動（DESIGN 22.10）':null};
  });
}
// 入力の値からエンジンの setup の形を作る：pItemSetup(data, id, {fired:[回数…], counter}) → {pItem:{id, limits, counter}, enthusiasmBuffAdd}
// enthusiasmBuffAdd：発動済みの分の熱意倍率（setup.enthusiasmBuff に足す。例 +版を2回なら 1.2）
export function pItemSetup(data,id,{fired=[],counter}={}){
  const [info]=pItemInputs(data,{ids:[id]});if(!info)throw Error('未登録の P アイテム: '+id);
  const slots=info.inputs.filter(x=>x.key==='fired');let add=0;
  const limits=slots.map((x,i)=>{const n=fired[i]??0;if(!(Number.isInteger(n)&&n>=0&&n<=x.max))throw Error(info.name+'：発動済みの回数は 0〜'+x.max+' です');add+=n*(x.enthusiasmBuffPerUse||0);return x.max-n;});
  const pItem={id};if(limits.length)pItem.limits=limits;if(counter!=null)pItem.counter=counter;
  return {pItem,enthusiasmBuffAdd:Math.round(add*1e9)/1e9};
}
