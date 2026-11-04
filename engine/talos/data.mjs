// gakumas-tools の CSV（文字列）から、札・ドリンク・P アイテムの定義を作る。ブラウザでも使えるよう、ファイルは読まない
// （Node では loadDataFromDir を使う）。各行の DSL は dsl.mjs で構文解析する。
import {parseSequence} from './dsl.mjs';

export function parseCsv(text){
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===','){row.push(f);f='';}else if(c==='\n'){row.push(f.replace(/\r$/,''));rows.push(row);row=[];f='';}else f+=c;}
  if(f||row.length){row.push(f);rows.push(row);}
  const [h,...b]=rows;return b.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));
}

// 札の「効果の名前」（cardHasEffect で見るもの。gakumas-engine の actionEffectName と同じ考え方：
// 代入は左辺の名前、setStance は数字を除いた指針名、その他の呼び出しは名前。減らすだけの代入は数えない）
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

// gakumas-tools のデータを、実ゲームでの確認に合わせて上書きする。上書きの一覧（OVERRIDES）は、理由と日付つきで残す。
// 例：{ids:[827,828], name:'甘く溶ける心', set:{type:'mental'}, reason:'…'}
// （甘く溶ける心は一度メンタルに上書きしたが、利用者が実ゲームで確かめてアクティブだった（2026-11-03）ので取り消した）
export const OVERRIDES=[];
export function applyOverrides(data,list=OVERRIDES){
  for(const o of list)for(const id of o.ids){const c=data.cards.get(id);if(!c)throw Error('上書きする札がありません: '+id);
    if(o.name&&!c.name.startsWith(o.name))throw Error('上書きする札の名前が違います: '+id+' '+c.name);Object.assign(c,o.set);c.overridden=(c.overridden||[]).concat(o.reason);}
  return data;
}

// シナリオのアビリティ（札1枚ごとに付く。gakumas-tools のデータにはないので、ここで定義する）。
//   アビリティごとに「効果の組」を並べる。組＝{cards:[通常版の番号…], actions:'DSL'}。札によって効果が違うので、
//   同じ効果の札を1つの組にまとめ、違う効果の札は別の組として足す（効果は、札の効果の後に実行する）。
//   HIF（利用者の説明 2026-11-03）：下の5種は同じ効果（使ったときに行動＋1、1枚ドロー）。ほかの札は効果が違うことがある。
export const ABILITIES={
  HIF:[
    {cards:[390/*精一杯*/,408/*オープニングアクト*/,749/*アンダンテ*/,418/*カウントダウン*/,422/*忍耐力*/],actions:'cardUsesRemaining+=1; drawCard'},
    // 例：{cards:[番号], actions:'…'}（別の効果の札）
  ],
};
// 札（通常版の番号）に付くアビリティの効果（DSL）。付けられなければ null
// abilities：アビリティの効果の組（利用者の設定。渡さなければ既定の ABILITIES）
export function abilityActions(name,baseId,abilities=ABILITIES){const A=abilities[name];if(!A)throw Error('未登録のアビリティ: '+name);
  const hits=A.filter(g=>g.cards.includes(baseId));if(hits.length>1)throw Error(name+' の効果の組が重複しています: '+baseId);return hits[0]?.actions??null;}
// 札の変種：カスタマイズ（{番号:段階}）とアビリティ（['HIF']）を当てた札。data.cards に文字列のキーで覚える。
// カスタマイズの扱い（gakumas-tools の customizations.csv）：
//   actions … 札の actions の後ろに足す（段階 level:N は指定の段階だけ）。名前付きの置き換え（@名前）は未対応（エラー）
//   effects … at:prestage の target:this の成長は、札の最初の成長に足す。それ以外の効果は札の effects に足す
//   conditions … @usable は使用条件を置き換える。limit が 0 なら「レッスン中1回」の制限をなくす
export function cardVariant(data,id,{c11n=null,abilities=[]}={}){
  const base=data.cards.get(id);if(!base)throw Error('未登録の札: '+id);
  const cs=c11n?Object.entries(c11n).map(([k,v])=>[Number(k),Number(v)]).filter(([,v])=>v>0).sort((a,b)=>a[0]-b[0]):[];
  const ab=[...abilities].sort();
  if(!cs.length&&!ab.length)return id;
  const key=id+(cs.length?'#c'+cs.map(([k,v])=>k+':'+v).join(','):'')+(ab.length?'#a'+ab.join(','):'');
  if(data.cards.has(key))return key;
  const v={...base,key,actions:base.actions.slice(),effects:base.effects.slice(),usable:base.usable.slice(),startGrowth:{score:0,scoreTimes:0},variantOf:id,c11n:cs,abilities:ab};
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
            else if(!['g.cost','g.typedCost','g.genki','g.fullPowerCharge','g.halfCostTurns','g.motivation','g.goodConditionTurns','g.goodImpressionTurns','g.concentration','g.perfectConditionTurns'].includes(z.lhs))throw Error('未対応の成長（カスタマイズ）: '+z.lhs);}}
      }else v.effects.push(x);
    }
    for(const x of c.conditions){if(x.kind==='cond'&&x.anchor==='usable')v.usable=[x.cond];else throw Error('未対応のカスタマイズの条件: '+c.name);}
    if(c.limit==='0')v.once=false;
  }
  v.effectNames=effectNames(v.actions);   // アビリティは札自身の効果ではないので、名前に含めない
  for(const a of ab){const act=abilityActions(a,base.baseId,data.abilities??ABILITIES);   // 利用者の設定（talos/settings.mjs）があれば、その組
    if(act===null)throw Error(a+' を付けられない札です（効果が未登録）: '+base.name);
    v.actions.push(...parseSequence(act));}
  data.cards.set(key,v);return key;
}

// 利用者が DSL で書く「自作の札」（例：指針の変更を試すための仮の札）。番号は負の数にする。
export function addCustomCard(data,{id,name,type='mental',once=false,actions,usable=''}){
  if(!(id<0))throw Error('自作の札の番号は負の数にしてください');
  const a=parseSequence(actions);
  data.cards.set(id,{id,baseId:id,name,type,rarity:'',plan:'free',sourceType:'custom',upgraded:false,once,
    usable:parseSequence(usable).filter(x=>x.kind==='cond').map(x=>x.cond),cost:[],actions:a,effects:[],effectNames:effectNames(a)});
  return id;
}
