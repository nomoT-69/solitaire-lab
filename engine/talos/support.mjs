export const IN_TURN=new Set(['beforeCardUsed','cardUsed','activeCardUsed','mentalCardUsed','afterCardUsed','afterActiveCardUsed','afterMentalCardUsed','stanceChanged','stanceValueChanged','endOfTurn','staminaDecreased','fullPowerChargeIncreased']);
export const LATER=new Set(['turn','startOfTurn','beforeStartOfTurn','afterStartOfTurn','everyTurn','startOfStage','afterStartOfStage','prestage','turnSkipped']);
export const IGNORED_FIELDS=new Set(['enthusiasmExtensionTurns',
  'genki','fixedGenki','stamina','fixedStamina','fullPowerCharge','halfCostTurns','doubleCostTurns','costReduction','costIncrease','nullifyCostCards','nullifyCostActiveCards','cost','nullifyGenkiTurns','doubleBuffCostTurns']);
export const IGNORED_GROWTH=new Set(['g.cost','g.typedCost','g.genki','g.fullPowerCharge','g.halfCostTurns']);
export const IGNORED_CALLS=new Set(['setFullPowerChargeBuff','setFullPowerEffectBuff','decreaseFullPowerCharge']);
export const CALLS=new Set(['setStance','drawCard','exchangeHand','addCardToDeck','holdSelected','holdSelectedUpto','holdThisCard',
  'moveRandomToHand','removeRandom','useRandomCardFree','addRandomUpgradedSSRCardToHand',
  'setScoreBuff','setEnthusiasmBuff','setEnthusiasmBonus','setStrengthEffectBuff',...IGNORED_CALLS]);
export const ASSIGN=new Set(['score','cardUsesRemaining','enthusiasm','enthusiasmMultiplier','effectCounter','scoreTimes']);
export const VARIABLES=new Set(['fullPowerCharge','cumulativeFullPowerCharge','stance','prevStance','isStrength','isPreservation','isFullPower','preservationTimes','strengthTimes','leisureTimes','fullPowerTimes','stanceChangedTimes',
  'stanceChangedByDirectEffectTimes','isDirectEffect','effectCounter','cardsUsed','turnCardsUsed','turnsRemaining','cardUsesRemaining','enthusiasm','score','usedCardBaseId','usedCardId',
  'none','strength','strength2','preservation','preservation2','leisure','fullPower','parentPhase','processCost','processCard']);
export const STANCE_NAMES=new Set(['preservation','preservation2','leisure','strength','strength2']);
const FUNCS=new Set(['cardHasEffect','countCards','effectCounter']);
const TARGET_IDS=new Set(['all','hand','deck','held','removed','discarded','active','mental','trouble','pIdol','T','N','R','SR','SSR','L','this']);
const TARGET_CALLS=new Set(['baseId','id','effect','ability']);

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
export const sharedLimitIfs=x=>x.kind==='effect'&&x.mods?.limit!=null&&(x.body||[]).filter(b=>b.kind==='effect'&&!b.phase&&b.cond).length>=2;
export const SHARED_LIMIT_MSG='回数の上限（limit）を複数の条件（if:）で共有する書き方には対応していません（gakumas-tools では条件ごとに別の回数になります）';
export function itemProblems(items,where,out=[]){
  for(const x of items||[]){
    if(x.kind==='action'){
      if(x.op==='call'){
        if(!CALLS.has(x.name)){out.push(where+'：対応していない効果「'+x.name+'」');continue;}
        if(x.name==='setStance'){const a=x.args[0];if(!a||a.t!=='id'||!STANCE_NAMES.has(a.name))out.push(where+'：対応していない指針「'+(a?.name??a?.v??'')+'」');}
        else for(const a of x.args)if(a.t!=='id')exprProblems(a,out,where);
        if(x.target)targetProblems(x.target,out,where);
      }else{
        if(IGNORED_FIELDS.has(x.lhs)||IGNORED_GROWTH.has(x.lhs))continue;
        if(!(ASSIGN.has(x.lhs)||x.lhs==='g.score'||x.lhs==='g.scoreTimes')){out.push(where+'：対応していない代入「'+x.lhs+x.op+'」');continue;}
        exprProblems(x.rhs,out,where);}
    }else if(x.kind==='effect'){if(sharedLimitIfs(x))out.push(where+'：'+SHARED_LIMIT_MSG);
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
function selectProblems(items,where,out){
  const i=(items||[]).findIndex(x=>x.kind==='action'&&x.op==='call'&&/Selected/.test(x.name));
  if(i>0)out.push(where+'：選ぶ行動（'+items[i].name+'）が最初にない札は対応していない');
  else if(i===0&&items[i].name!=='holdSelected'&&items[i].name!=='holdSelectedUpto')out.push(where+'：対応していない選ぶ行動「'+items[i].name+'」');
}
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

export function unsupportedList(data){
  const cards=[],drinks=[],items=[];
  for(const c of data.cards.values()){if(typeof c.key==='string')continue;const p=cardProblems(c);if(p.length)cards.push({id:c.id,name:c.name,problems:p});}
  for(const d of data.drinks.values()){const p=drinkProblems(d);if(p.length)drinks.push({id:d.id,name:d.name,problems:p});}
  for(const it of data.items.values()){const p=itemDefProblems(it);if(p.length)items.push({id:it.id,name:it.name,problems:p});}
  return {cards,drinks,items,counts:{cards:data.cards.size,unsupportedCards:cards.length,drinks:data.drinks.size,unsupportedDrinks:drinks.length,items:data.items.size,unsupportedItems:items.length}};
}

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
export function pItemSetup(data,id,{fired=[],counter}={}){
  const [info]=pItemInputs(data,{ids:[id]});if(!info)throw Error('未登録の P アイテム: '+id);
  const slots=info.inputs.filter(x=>x.key==='fired');let add=0;
  const limits=slots.map((x,i)=>{const n=fired[i]??0;if(!(Number.isInteger(n)&&n>=0&&n<=x.max))throw Error(info.name+'：発動済みの回数は 0〜'+x.max+' です');add+=n*(x.enthusiasmBuffPerUse||0);return x.max-n;});
  const pItem={id};if(limits.length)pItem.limits=limits;if(counter!=null)pItem.counter=counter;
  return {pItem,enthusiasmBuffAdd:Math.round(add*1e9)/1e9};
}
