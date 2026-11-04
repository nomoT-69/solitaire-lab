// 利用者の設定（GUI から札・HIF などを足すための準備）。DESIGN.md 18章。ブラウザでも動く（Node 専用の機能なし）。
// 設定は JSON で表せる形（GUI がブラウザに保存・書き出しできる）：
//   {version:1,
//    abilities:{HIF:[{cards:[通常版の番号…], actions:'DSL', shared:'名前ごとに共有する効果の DSL（{id}＝通常版の番号）'}…], …},          … シナリオのアビリティの効果の組（data.mjs の ABILITIES と同じ形）
//    overrides:[{ids:[番号…], name:'名前の先頭', set:{type,once,rarity,plan,actions,effects,usable}, reason:'理由'}…],   … データの上書き
//    customCards:[{id:負の番号, name, type:'active'|'mental', once:false, actions:'DSL', usable:'DSL（条件）'}…]}           … 自作の札
// 既定の設定（defaultSettings）は、今コードに書いてある一覧（ABILITIES・OVERRIDES、自作の札なし）。設定を渡さないときの動きは今と同じ。
import {parseSequence} from './dsl.mjs';
import {loadData,ABILITIES,OVERRIDES,applyOverrides,addCustomCard,effectNames} from './data.mjs';
import {itemProblems,cardProblems} from './support.mjs';
export const SETTINGS_VERSION=1;
const clone=x=>JSON.parse(JSON.stringify(x));
// 既定の設定（今の固定の一覧）
export function defaultSettings(){return {version:SETTINGS_VERSION,abilities:clone(ABILITIES),overrides:clone(OVERRIDES),customCards:[]};}
const SET_KEYS=new Set(['type','once','rarity','plan','actions','effects','usable']);
const TYPES=new Set(['active','mental','trouble']);

// 設定の中身を確かめる。返り値：{ok, problems:[{level:'エラー'|'注意', where, message}]}（エラーがなければ ok）
export function validateSettings(data,settings){
  const P=[];const err=(where,message)=>P.push({level:'エラー',where,message}),warn=(where,message)=>P.push({level:'注意',where,message});
  if(!settings||typeof settings!=='object'||Array.isArray(settings)){err('設定','設定は {…} の形の JSON にしてください');return {ok:false,problems:P};}
  if(settings.version!==undefined&&settings.version!==SETTINGS_VERSION)warn('設定','version が '+settings.version+' です（この版は '+SETTINGS_VERSION+'）');
  for(const k of Object.keys(settings))if(!['version','abilities','overrides','customCards'].includes(k))warn('設定','知らない項目「'+k+'」は使いません');
  const dsl=(src,where,asCond=false)=>{if(src===undefined||src==='')return [];if(typeof src!=='string'){err(where,'効果は文字列で書いてください');return null;}
    try{const items=parseSequence(src);if(asCond){const bad=items.filter(x=>x.kind!=='cond');if(bad.length)err(where,'使用条件は if:… の形で書いてください');}return items;}
    catch(e){err(where,'効果の文字列の書き方の誤り：'+e.message.replace(/^DSL[^:]*: ?/,''));return null;}};
  const baseCard=(id,where)=>{if(!Number.isInteger(id)){err(where,'札の番号は整数にしてください：'+JSON.stringify(id));return null;}
    const c=data.cards.get(id);if(!c){err(where,'存在しない札の番号：'+id);return null;}return c;};
  // アビリティ
  const ab=settings.abilities??{};
  if(typeof ab!=='object'||Array.isArray(ab))err('アビリティ','abilities は {名前:[組…]} の形にしてください');
  else for(const [name,groups] of Object.entries(ab)){
    const W='アビリティ「'+name+'」';
    if(!Array.isArray(groups)){err(W,'効果の組は […] の形にしてください');continue;}
    const seen=new Map(),sigs=new Set();
    groups.forEach((g,gi)=>{const w=W+'の'+(gi+1)+'番目の組';
      if(!g||!Array.isArray(g.cards)||!g.cards.length){err(w,'cards（通常版の札の番号の並び）がありません');return;}
      const sig=JSON.stringify([g.cards.slice().sort((a,b)=>a-b),g.actions]);if(sigs.has(sig))err(w,'同じ組が重複しています');sigs.add(sig);
      for(const id of g.cards){const c=baseCard(id,w);if(!c)continue;
        if(c.upgraded)err(w,'札 '+id+'（'+c.name+'）は＋版です。通常版の番号（'+c.baseId+'）を書いてください');
        if(seen.has(id))err(w,'札 '+id+'（'+c.name+'）が '+seen.get(id)+'番目の組と重複しています');else seen.set(id,gi+1);}
      // shared（名前ごとに共有する効果。'{id}' に通常版の番号が入る。HIF 再動 2026-11-04）：actions の代わりに書ける。両方あってもよい
      if(g.actions==null&&g.shared==null){err(w,'効果（actions か shared）がありません');return;}
      if(g.actions!=null){const items=dsl(g.actions,w+'の効果');if(items){if(!items.length)err(w,'効果（actions）が空です');for(const m of itemProblems(items,w+'の効果'))err(w,m);}}
      if(g.shared!=null){const items=dsl(String(g.shared).replaceAll('{id}',String(g.cards[0])),w+'の共有する効果');
        if(items){if(!items.length||items.some(x=>x.kind!=='effect'||!x.phase))err(w,'共有する効果（shared）は at:… の形にしてください');for(const m of itemProblems(items,w+'の共有する効果'))err(w,m);}}});
  }
  // データの上書き
  const ov=settings.overrides??[];
  if(!Array.isArray(ov))err('上書き','overrides は […] の形にしてください');
  else ov.forEach((o,oi)=>{const w='上書きの'+(oi+1)+'番目';
    if(!o||!Array.isArray(o.ids)||!o.ids.length){err(w,'ids（札の番号の並び）がありません');return;}
    for(const id of o.ids){const c=baseCard(id,w);if(c&&o.name&&!c.name.startsWith(o.name))err(w,'札 '+id+' の名前が違います（データは「'+c.name+'」、設定は「'+o.name+'」）');}
    if(!o.set||typeof o.set!=='object'){err(w,'set（上書きする中身）がありません');return;}
    for(const [k,v] of Object.entries(o.set)){
      if(!SET_KEYS.has(k)){err(w,'上書きできない項目「'+k+'」（使えるのは '+[...SET_KEYS].join('・')+'）');continue;}
      if(k==='type'&&!TYPES.has(v))err(w,'type は active・mental・trouble のどれか');
      if(k==='once'&&typeof v!=='boolean')err(w,'once は true か false');
      if(k==='actions'||k==='effects'){const items=dsl(v,w+'の'+k);if(items)for(const m of itemProblems(items,w+'の'+k))err(w,m);}
      if(k==='usable'){const items=dsl(v,w+'の使用条件',true);if(items){const probe={name:w,usable:items.map(x=>x.cond),actions:[],effects:[]};for(const m of cardProblems(probe))err(w,m);}}}
    if(!o.reason)warn(w,'reason（上書きの理由）を書いておくと、あとで確かめやすい');});
  // 自作の札
  const cc=settings.customCards??[];const ids=new Set();
  if(!Array.isArray(cc))err('自作の札','customCards は […] の形にしてください');
  else cc.forEach((c,ci)=>{const w='自作の札の'+(ci+1)+'番目'+(c?.name?'「'+c.name+'」':'');
    if(!c||typeof c!=='object'){err(w,'札は {…} の形にしてください');return;}
    if(!Number.isInteger(c.id)||c.id>=0)err(w,'番号（id）は負の整数にしてください（gakumas-tools の番号と重ならないように）');
    else if(ids.has(c.id))err(w,'番号 '+c.id+' が重複しています');else ids.add(c.id);
    if(!c.name)err(w,'名前（name）がありません');
    if(c.type!==undefined&&!TYPES.has(c.type))err(w,'type は active・mental・trouble のどれか');
    if(c.once!==undefined&&typeof c.once!=='boolean')err(w,'once は true か false');
    const items=dsl(c.actions,w+'の効果');const us=dsl(c.usable,w+'の使用条件',true);
    if(items&&!items.length)err(w,'効果（actions）が空です');
    if(items&&us){const probe={name:c.name,id:c.id,usable:us.map(x=>x.cond),actions:items,effects:[]};for(const m of cardProblems(probe))err(w,m);}});
  return {ok:!P.some(x=>x.level==='エラー'),problems:P};
}

// 設定をデータに当てる（中身を確かめて、エラーがあれば一覧つきの例外）。データは読み込んだばかりのもの（loadData の結果）に1回だけ当てる
export function applySettings(data,settings=defaultSettings()){
  if(data.settings)throw Error('このデータには設定を当て済みです。設定を変えるときは、データを読み込み直してください');
  const v=validateSettings(data,settings);
  if(!v.ok){const e=Error('設定にエラーがあります：\n'+v.problems.filter(x=>x.level==='エラー').map(x=>'・'+x.where+'：'+x.message).join('\n'));e.problems=v.problems;throw e;}
  // 上書き：DSL の項目は文字列から読み直す（JSON の形で渡せるように）。既定（OVERRIDES）と同じ形のものは applyOverrides と同じに当てる
  const list=(settings.overrides??[]).map(o=>{const set={...o.set};
    if(typeof set.actions==='string')set.actions=parseSequence(set.actions);if(typeof set.effects==='string')set.effects=parseSequence(set.effects);
    if(typeof set.usable==='string')set.usable=parseSequence(set.usable).filter(x=>x.kind==='cond').map(x=>x.cond);
    return {...o,set};});
  applyOverrides(data,list);
  for(const o of list)if(o.set.actions)for(const id of o.ids)data.cards.get(id).effectNames=effectNames(data.cards.get(id).actions);   // 効果の名前（cardHasEffect で見る）を作り直す
  data.abilities=clone(settings.abilities??{});
  for(const c of settings.customCards??[])addCustomCard(data,{id:c.id,name:c.name,type:c.type??'mental',once:!!c.once,actions:c.actions,usable:c.usable??''});
  data.settings=clone(settings);
  return data;
}
// CSV の文字列から読み込んで設定を当てる（ブラウザ用。Node では loadDataFromDir も使える）
export function loadDataWithSettings(csv,settings=defaultSettings()){return applySettings(loadData(csv),settings);}
