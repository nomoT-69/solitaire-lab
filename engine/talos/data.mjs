// gakumas-tools の CSV（文字列）から、札・ドリンク・P アイテムの定義を作る。ブラウザでも使えるよう、ファイルは読まない
// （Node では loadDataFromDir を使う）。各行の DSL は dsl.mjs で構文解析する。
import {parseSequence} from './dsl.mjs?v=1.17.11';

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
// 発動の順の、実ゲームで確かめた違いの台帳（gakumas-engine と違えるもの。DESIGN 10.4）。ids の札が登録する at:cardUsed の効果は、札を使ったときの効果の最後
// （cardUsed → activeCardUsed・mentalCardUsed の後）に発動する
export const LATE_CARD_USED_EFFECTS=[{ids:[584,585],name:'夏夜に咲く思い出',reason:'揺れ動く想い（P アイテム、cardUsed[active]）で強気になってから夏夜の点が出て、その後に札の効果（利用者が実ゲームで確認、それ以外は gakumas-engine の順でよいとの判断）',date:'2026-11-05'}];
export function applyOverrides(data,list=OVERRIDES){
  for(const o of list)for(const id of o.ids){const c=data.cards.get(id);if(!c)throw Error('上書きする札がありません: '+id);
    if(o.name&&!c.name.startsWith(o.name))throw Error('上書きする札の名前が違います: '+id+' '+c.name);Object.assign(c,o.set);c.overridden=(c.overridden||[]).concat(o.reason);}
  return data;
}

// シナリオのアビリティ（札1枚ごとに付く。gakumas-tools のデータにはないので、ここで定義する）。
//   アビリティごとに「効果の組」を並べる。組＝{cards:[通常版の番号…], actions:'DSL'}。札によって効果が違うので、
//   同じ効果の札を1つの組にまとめ、違う効果の札は別の組として足す（効果は、札の効果の後に実行する）。
//   HIF（利用者の説明 2026-11-03、2026-11-04 に利用者の表で更新）：札ごとに効果の組が違う（再動＆ドロー・再動・眠気除去・なし）。
export const ABILITIES={
  HIF:[
    // 再動＆ドロー（行動＋1、1枚ドロー）。2026-11-04：利用者の表（GUI のセッションが照合）で19枚に広げた。通常版・＋版とも同じ効果（利用者の確認）。試作・未検証
    {cards:[590/*巻き返し*/,745/*ハッスル*/,390/*精一杯*/,392/*ハッピー♪*/,394/*嬉しい誤算*/,396/*涙の思い出*/,386/*ラッキー♪*/,384/*一歩*/,380/*ジャストアピール*/,700/*ノンストップ*/,
      408/*オープニングアクト*/,749/*アンダンテ*/,418/*カウントダウン*/,422/*忍耐力*/,416/*潜在能力*/,414/*トレーニングの成果*/,404/*はじけるパッション*/,406/*汗と成長*/,412/*理想のテンポ*/,
      905/*ラッシュ*/,907/*ブースト*/],shared:'at:afterCardUsed[{id} & ability(HIF)] { cardUsesRemaining+=1; drawCard; limit:1 }'},   // 905・907 は 2026-11-04 追加
    //   2026-11-08（利用者の決まり、GUI のセッション経由）：同じ名前の札の HIF は重複しない。試験中に最初に使った1枚だけ発動する（名前ごとに1回、setup.abilityUses で前のターンの分を入力）。
    //   前は札ごとの actions（札の効果の後に続けて実行）だった。札の効果の後・捨て札の前（afterCardUsed）に、名前ごとに共有する効果として登録する
    // 眠気除去（手札以外の眠気を1枚除外。山札と捨て札の眠気すべてから等しい確率で選ぶ。利用者の確認 2026-11-04）。試作・未検証
    {cards:[698/*形勢逆転*/,546/*セッティング*/,548/*第一印象*/,410/*始まりの笑顔*/,420/*プライド*/,552/*モチベ*/,518/*タフネス*/,594/*達成感*/,550/*トレンドリーダー*/,554/*盛り上げ上手*/,
      556/*インフルエンサー*/,424/*切磋琢磨*/],shared:'at:afterCardUsed[{id} & ability(HIF)] { removeRandom[23 & (deck | discarded)]; limit:1 }'},   // 2026-11-08：名前ごとに1回（上と同じ）
    // 再動（使ったときに行動＋1。同じ名前の札で合わせて2回まで。利用者の確認 2026-11-04：2枚あっても1枚目・2枚目に使ったときの2回）。試作・未検証
    //   shared：札ごとではなく名前（通常版の番号 {id}）ごとに1つ登録する効果。残り回数は名前ごとに共有（setup.abilityUses で使った回数を入力）
    {cards:[382/*スターライト*/,388/*積み重ね*/,400/*せーのっ！*/,402/*アッチェレランド*/],shared:'at:cardUsed[{id} & ability(HIF)] { cardUsesRemaining+=1; limit:2 }'},
    // HIF アビなし：716・702・718
    // 例：{cards:[番号], actions:'…'}（別の効果の札）
  ],
};
// 札（通常版の番号）に付くアビリティの効果（DSL）。付けられなければ null
// abilities：アビリティの効果の組（利用者の設定。渡さなければ既定の ABILITIES）
export function abilityActions(name,baseId,abilities=ABILITIES){const A=abilities[name];if(!A)throw Error('未登録のアビリティ: '+name);
  const hits=A.filter(g=>g.cards.includes(baseId));if(hits.length>1)throw Error(name+' の効果の組が重複しています: '+baseId);return hits[0]?(hits[0].actions??(hits[0].shared?'':null)):null;}
// 名前ごとに共有する効果（組の shared）を、合成の P アイテム（番号は −1000000−通常版の番号）として data.items に登録して番号を返す。なければ null（2026-11-04、HIF 再動）
export function sharedAbilityItem(data,name,baseId,abilities=data.abilities??ABILITIES){
  const g=(abilities[name]||[]).find(g=>g.cards.includes(baseId)&&g.shared);if(!g)return null;
  const id=-1000000-baseId;if(!data.items.has(id))data.items.set(id,{id,name:name+'：'+(data.cards.get(baseId)?.name??baseId)+'（同じ名前で共有）',plan:'',upgraded:false,sourceType:'ability',pIdolId:null,
    effects:parseSequence(g.shared.replaceAll('{id}',String(baseId)))});
  return id;}
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
            // 全力値+（g.fullPowerCharge）・コスト値-（g.typedCost）：全力値を数える局面で使う（G2 2026-11-05）。数えない局面では今までどおり関係しない
            else if(z.lhs==='g.fullPowerCharge')v.startGrowth.fullPowerCharge+=z.rhs.v;else if(z.lhs==='g.typedCost')v.startGrowth.typedCost+=z.rhs.v;
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
