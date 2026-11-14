import {parseSequence} from './dsl.mjs?v=1.17.12';

export function parseCsv(text){
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===','){row.push(f);f='';}else if(c==='\n'){row.push(f.replace(/\r$/,''));rows.push(row);row=[];f='';}else f+=c;}
  if(f||row.length){row.push(f);rows.push(row);}
  const [h,...b]=rows;return b.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));
}

export function effectNames(items,out=new Set()){
  for(const x of items){
    if(x.kind==='action'){
      if(x.op==='call'){if(x.name==='setStance'&&x.args[0]?.t==='id')out.add(x.args[0].name.replace(/\d/g,''));else out.add(x.name);}
      else if(!(x.op==='-='||x.op==='/='||(x.op==='='&&x.rhs.t==='num'&&x.rhs.v===0)))out.add(x.lhs);
    }else if(x.kind==='effect')effectNames(x.body,out);
  }
  return out;
}

export function loadData({skillCards,pDrinks,pItems,customizations}){
  const cards=new Map(),drinks=new Map(),items=new Map(),custs=new Map();
  const rows=parseCsv(skillCards);
  const byName=new Map(rows.filter(r=>r.upgraded!=='TRUE').map(r=>[r.name,Number(r.id)]));
  for(const r of rows){
    const id=Number(r.id),actions=parseSequence(r.actions);
    const baseId=r.upgraded==='TRUE'?(byName.get(r.name.replace(/\+$/,''))??id):id;
    cards.set(id,{id,baseId,name:r.name,type:r.type,rarity:r.rarity,plan:r.plan,sourceType:r.sourceType,upgraded:r.upgraded==='TRUE',
      once:r.limit==='1',usable:parseSequence(r.conditions).filter(x=>x.kind==='cond').map(x=>x.cond),
      cost:parseSequence(r.cost),actions,effects:parseSequence(r.effects),effectNames:effectNames(actions)});
  }
  for(const r of parseCsv(pDrinks))drinks.set(Number(r.id),{id:Number(r.id),name:r.name,plan:r.plan,actions:parseSequence(r.actions)});
  for(const r of parseCsv(pItems))items.set(Number(r.id),{id:Number(r.id),name:r.name,plan:r.plan,upgraded:r.upgraded==='TRUE',sourceType:r.sourceType||null,pIdolId:r.pIdolId?Number(r.pIdolId):null,effects:parseSequence(r.effects)});
  if(customizations)for(const r of parseCsv(customizations))custs.set(Number(r.id),{id:Number(r.id),name:r.name,max:Number(r.max||1),
    conditions:parseSequence(r.conditions),actions:parseSequence(r.actions),effects:parseSequence(r.effects),limit:r.limit});
  return {cards,drinks,items,customizations:custs};
}

export const OVERRIDES=[];
export const LATE_CARD_USED_EFFECTS=[{ids:[584,585],name:'夏夜に咲く思い出',reason:'揺れ動く想い（P アイテム、cardUsed[active]）で強気になってから夏夜の点が出て、その後に札の効果（利用者が実ゲームで確認、それ以外は gakumas-engine の順でよいとの判断）',date:'2026-11-05'}];
export function applyOverrides(data,list=OVERRIDES){
  for(const o of list)for(const id of o.ids){const c=data.cards.get(id);if(!c)throw Error('上書きする札がありません: '+id);
    if(o.name&&!c.name.startsWith(o.name))throw Error('上書きする札の名前が違います: '+id+' '+c.name);Object.assign(c,o.set);c.overridden=(c.overridden||[]).concat(o.reason);}
  return data;
}

export const ABILITIES={
  HIF:[
    {cards:[590 ,745 ,390 ,392 ,394 ,396 ,386 ,384 ,380 ,700 ,
      408 ,749 ,418 ,422 ,416 ,414 ,404 ,406 ,412 ,
      905 ,907 ],shared:'at:afterCardUsed[{id} & ability(HIF)] { cardUsesRemaining+=1; drawCard; limit:1 }'},
    {cards:[698 ,546 ,548 ,410 ,420 ,552 ,518 ,594 ,550 ,554 ,
      556 ,424 ],shared:'at:afterCardUsed[{id} & ability(HIF)] { removeRandom[23 & (deck | discarded)]; limit:1 }'},
    {cards:[382 ,388 ,400 ,402 ],shared:'at:cardUsed[{id} & ability(HIF)] { cardUsesRemaining+=1; limit:2 }'},
  ],
};
export function abilityActions(name,baseId,abilities=ABILITIES){const A=abilities[name];if(!A)throw Error('未登録のアビリティ: '+name);
  const hits=A.filter(g=>g.cards.includes(baseId));if(hits.length>1)throw Error(name+' の効果の組が重複しています: '+baseId);return hits[0]?(hits[0].actions??(hits[0].shared?'':null)):null;}
export function sharedAbilityItem(data,name,baseId,abilities=data.abilities??ABILITIES){
  const g=(abilities[name]||[]).find(g=>g.cards.includes(baseId)&&g.shared);if(!g)return null;
  const id=-1000000-baseId;if(!data.items.has(id))data.items.set(id,{id,name:name+'：'+(data.cards.get(baseId)?.name??baseId)+'（同じ名前で共有）',plan:'',upgraded:false,sourceType:'ability',pIdolId:null,
    effects:parseSequence(g.shared.replaceAll('{id}',String(baseId)))});
  return id;}
export function cardVariant(data,id,{c11n=null,abilities=[]}={}){
  const base=data.cards.get(id);if(!base)throw Error('未登録の札: '+id);
  const cs=c11n?Object.entries(c11n).map(([k,v])=>[Number(k),Number(v)]).filter(([,v])=>v>0).sort((a,b)=>a[0]-b[0]):[];
  const ab=[...abilities].sort();
  if(!cs.length&&!ab.length)return id;
  const key=id+(cs.length?'#c'+cs.map(([k,v])=>k+':'+v).join(','):'')+(ab.length?'#a'+ab.join(','):'');
  if(data.cards.has(key))return key;
  const v={...base,key,actions:base.actions.slice(),effects:base.effects.slice(),usable:base.usable.slice(),startGrowth:{score:0,scoreTimes:0,fullPowerCharge:0,typedCost:0},variantOf:id,c11n:cs,abilities:ab};
  const pickLevel=(items,L)=>items.flatMap(x=>x.kind==='level'?(x.level===L?x.body:[]):[x]);
  for(const [cid,L] of cs){
    const c=data.customizations?.get(cid);if(!c)throw Error('未登録のカスタマイズ: '+cid);
    if(L>c.max)throw Error('カスタマイズの段階が上限を超えています: '+c.name+' '+L);
    for(const x of pickLevel(c.actions,L)){if(x.anchor)throw Error('置き換えのカスタマイズは未対応: '+c.name);v.actions.push(x);}
    for(const x of pickLevel(c.effects,L)){
      if(x.anchor)throw Error('置き換えのカスタマイズは未対応: '+c.name);
      if(x.kind==='effect'&&x.phase==='prestage'){
        for(const y of x.body){if(y.kind!=='effect'||y.target?.t!=='id'||y.target.name!=='this')throw Error('未対応のカスタマイズ: '+c.name);
          for(const z of y.body){if(z.kind!=='action'||z.op!=='+=')throw Error('未対応のカスタマイズ: '+c.name);
            if(z.lhs==='g.score')v.startGrowth.score+=z.rhs.v;else if(z.lhs==='g.scoreTimes')v.startGrowth.scoreTimes+=z.rhs.v;
            else if(z.lhs==='g.fullPowerCharge')v.startGrowth.fullPowerCharge+=z.rhs.v;else if(z.lhs==='g.typedCost')v.startGrowth.typedCost+=z.rhs.v;
            else if(!['g.cost','g.typedCost','g.genki','g.fullPowerCharge','g.halfCostTurns','g.motivation','g.goodConditionTurns','g.goodImpressionTurns','g.concentration','g.perfectConditionTurns'].includes(z.lhs))throw Error('未対応の成長（カスタマイズ）: '+z.lhs);}}
      }else v.effects.push(x);
    }
    for(const x of c.conditions){if(x.kind==='cond'&&x.anchor==='usable')v.usable=[x.cond];else throw Error('未対応のカスタマイズの条件: '+c.name);}
    if(c.limit==='0')v.once=false;
  }
  v.effectNames=effectNames(v.actions);
  for(const a of ab){const act=abilityActions(a,base.baseId,data.abilities??ABILITIES);
    if(act===null)throw Error(a+' を付けられない札です（効果が未登録）: '+base.name);
    v.actions.push(...parseSequence(act));}
  data.cards.set(key,v);return key;
}

export function addCustomCard(data,{id,name,type='mental',once=false,actions,usable=''}){
  if(!(id<0))throw Error('自作の札の番号は負の数にしてください');
  const a=parseSequence(actions);
  data.cards.set(id,{id,baseId:id,name,type,rarity:'',plan:'free',sourceType:'custom',upgraded:false,once,
    usable:parseSequence(usable).filter(x=>x.kind==='cond').map(x=>x.cond),cost:[],actions:a,effects:[],effectNames:effectNames(a)});
  return id;
}
