// 札の設定：HIF などのアビリティの効果、自作の札、データの上書き、データの更新（新しい CSV）、足した札の点検。
// 中身はエンジンの settings.mjs の形（{version, abilities, overrides, customCards}）。入力のたびにエンジンの validateSettings で確かめる。
// 保存はこのブラウザの中だけ（S.calcSettings）。ファイルへの書き出し・読み込みもできる。
import {D, search, calcDefaults, checkCalcSettings, unsupported, syncCustomCards, CSV_FILES, loadUserCsv, saveUserCsv} from './data.js';
import {S, save} from './store.js';
import {h, toast} from './ui.js';
import {loadData} from '../engine/talos/data.mjs';
import {startInspect, cancelInspect} from './solver.js';

// よく使う効果の形（押すと効果の文字列に足す。{N} は数を聞く）
const SNIPPETS = [['行動＋1', 'cardUsesRemaining+=1'], ['1枚ドロー', 'drawCard'], ['スコア＋N', 'score+={N}'], ['熱意＋N', 'enthusiasm+={N}'],
  ['強気にする', 'setStance(strength)'], ['温存にする', 'setStance(preservation)'], ['のんびりにする', 'setStance(leisure)']];
const TYPES = [['active', 'アクティブ'], ['mental', 'メンタル']];
const OV_FIELDS = {type: '種別', once: 'レッスン中1回', actions: '効果（actions）', effects: '継続の効果（effects）', usable: '使用条件（usable）', rarity: 'レア度', plan: 'プラン'};
const normA = s => String(s || '').replace(/\s+/g, ' ').replace(/\s*;\s*/g, '; ').trim();

let CS = null, inspect = {running: false, result: null, error: null};

export function renderCardSettings(root, rerender) {
  CS = S.calcSettings ? S.calcSettings : structuredClone(calcDefaults());
  CS.abilities ||= {}; CS.overrides ||= []; CS.customCards ||= [];
  const commit = structural => { S.calcSettings = CS; syncCustomCards(CS); save(); if (structural) rerender(); else showProblems(); };

  // 確かめた結果（入力のたびに更新）
  const probBox = h('div#cs-problems');
  function showProblems() {
    let r; try { r = checkCalcSettings(CS); } catch (e) { r = {ok: false, problems: [{level: 'エラー', where: '設定', message: String(e.message || e)}]}; }
    probBox.replaceChildren(r.problems.length
      ? h('ul.vlist', r.problems.map(p => h('li', {class: p.level === 'エラー' ? 'err' : 'warn'}, (p.level === 'エラー' ? '✖ ' : '⚠ ') + p.where + '：' + p.message)))
      : h('p.ok', '✔ 問題は見つかりません（この設定で計算します）'),
      r.ok ? '' : h('p.note', 'エラーがあるあいだは計算できません。'));
  }
  showProblems();

  // 効果の文字列の入力（よく使う形のボタンつき）
  const effectInput = (obj, key, {placeholder = '', onblur} = {}) => {
    const ta = h('textarea.dsl', {rows: 2, spellcheck: false, placeholder, value: obj[key] || '',
      oninput: e => { obj[key] = e.target.value; commit(false); }, onchange: () => onblur?.()});
    return h('div.effin', {}, ta, h('div.snips', {}, SNIPPETS.map(([label, code]) => h('button.mini', {onclick: () => {
      let c = code; if (c.includes('{N}')) { const n = prompt(label.replace('N', '') + 'の数', '1'); if (!n || !/^\d+$/.test(n)) return; c = c.replace('{N}', n); }
      obj[key] = obj[key] && obj[key].trim() ? obj[key].replace(/;?\s*$/, '; ') + c : c; ta.value = obj[key]; commit(false); onblur?.();
    }}, label))));
  };
  // 札を選ぶ（検索）。filter で候補を絞る
  const picker = (onPick, {filter = c => !c.upgraded && !c.custom, placeholder = '札を名前・略称で探して足す'} = {}) => {
    const res = h('div.pickres');
    const inp = h('input', {type: 'search', placeholder, oninput: e => fill(e.target.value)});
    const fill = q => res.replaceChildren(...(q ? search(D.cards.filter(filter), q, 8) : []).map(c => h('button.mini', {onclick: () => { onPick(c); }}, c.name)));
    return h('div.picker', {}, inp, res);
  };
  const cardChip = (id, onremove) => h('span.chip', {}, D.cardById.get(id)?.name || `札 ${id}`, h('button.x', {title: '外す', onclick: onremove}, '×'));

  // ---- アビリティ（HIF など）----
  const mergeSame = name => {   // 同じ効果の組を1つにまとめる
    const gs = CS.abilities[name]; const out = [];
    for (const g of gs) { const t = out.find(x => normA(x.actions) && normA(x.actions) === normA(g.actions)); if (t) { for (const c of g.cards) if (!t.cards.includes(c)) t.cards.push(c); } else out.push(g); }
    if (out.length !== gs.length) { CS.abilities[name] = out; toast('同じ効果の組をまとめました'); commit(true); }
  };
  const abilityBox = h('section.panel', {},
    h('h2', 'アビリティの効果（HIF など）'),
    h('p.note', '札を選び、使ったときに足される効果を入れます。同じ効果の札は1つの組にまとめます（効果の文字列が同じなら自動でまとめます）。札は通常版を選びます（＋版にも同じ効果が付きます）。'),
    Object.entries(CS.abilities).map(([name, groups]) => h('div.ability', {},
      h('h3', {}, name, name !== 'HIF' && h('button.mini.danger', {onclick: () => { if (confirm(`アビリティ「${name}」を消しますか？`)) { delete CS.abilities[name]; commit(true); } }}, '消す')),
      groups.map((g, gi) => h('div.group', {},
        h('div.row', {}, h('b', `組 ${gi + 1}`), h('button.mini.danger', {onclick: () => { groups.splice(gi, 1); commit(true); }}, 'この組を消す')),
        h('div.chips', g.cards.map(id => cardChip(id, () => { g.cards = g.cards.filter(x => x !== id); commit(true); }))),
        picker(c => {
          for (const o of groups) if (o !== g) o.cards = o.cards.filter(x => x !== c.id);   // 別の組にあれば移す
          if (!g.cards.includes(c.id)) g.cards.push(c.id); commit(true);
        }),
        h('div.fl2', '効果'), effectInput(g, 'actions', {placeholder: '例：cardUsesRemaining+=1; drawCard', onblur: () => mergeSame(name)}))),
      h('button', {onclick: () => { groups.push({cards: [], actions: ''}); commit(true); }}, '＋ 組を足す'))),
    h('button', {onclick: () => { const n = prompt('アビリティの名前（例：HIF2）'); if (!n) return; if (CS.abilities[n]) return alert('同じ名前があります'); CS.abilities[n] = []; commit(true); }}, '＋ アビリティを足す'));

  // ---- 自作の札 ----
  const customBox = h('section.panel', {},
    h('h2', '自作の札'),
    h('p.note', '名前・種別・効果・レッスン中1回かを入れると、デッキの検索（「自作」でも探せます）と局面で使えます。番号は自動で負の数になります。'),
    CS.customCards.map((c, i) => h('div.group', {},
      h('div.row', {},
        h('label.f', {}, h('span.fl', '名前'), h('input', {value: c.name || '', oninput: e => { c.name = e.target.value; commit(false); }, onchange: () => commit(true)})),
        h('label.f', {}, h('span.fl', '種別'), h('select', {onchange: e => { c.type = e.target.value; commit(true); }}, TYPES.map(([v, t]) => h('option', {value: v, selected: (c.type || 'mental') === v}, t)))),
        h('label.f', {}, h('input', {type: 'checkbox', checked: !!c.once, onchange: e => { c.once = e.target.checked; commit(true); }}), 'レッスン中1回'),
        h('span.note', `番号 ${c.id}`),
        h('button.mini.danger', {onclick: () => { if (confirm(`「${c.name}」を消しますか？（デッキに入っていれば、その札は使えなくなります）`)) { CS.customCards.splice(i, 1); commit(true); } }}, '消す')),
      h('div.fl2', '効果'), effectInput(c, 'actions', {placeholder: '例：setStance(strength); score+=10'}),
      h('label.f', {}, h('span.fl', '使用条件（任意）'), h('input.wide', {value: c.usable || '', placeholder: '例：if:isStrength', oninput: e => { c.usable = e.target.value; commit(false); }})))),
    h('button', {onclick: () => { const id = Math.min(0, ...CS.customCards.map(c => c.id)) - 1; CS.customCards.push({id, name: '自作の札' + -id, type: 'mental', once: false, actions: '', usable: ''}); commit(true); }}, '＋ 自作の札を足す'));

  // ---- データの上書き ----
  const ovBox = h('section.panel', {},
    h('h2', 'データの上書き'),
    h('p.note', 'gakumas-tools のデータと実際のゲームが違う札を、ここで直します。札を選び、直す項目と理由を入れます。'),
    CS.overrides.map((o, i) => { o.set ||= {}; o.ids ||= [];
      return h('div.group', {},
        h('div.row', {}, h('b', o.name || '（札を選んでください）'), h('button.mini.danger', {onclick: () => { CS.overrides.splice(i, 1); commit(true); }}, '消す')),
        h('div.chips', o.ids.map(id => cardChip(id, () => { o.ids = o.ids.filter(x => x !== id); commit(true); }))),
        picker(c => { for (const id of [c.id, c.plusId].filter(Boolean)) if (!o.ids.includes(id)) o.ids.push(id); o.name ||= c.baseName; commit(true); }, {filter: c => !c.upgraded && !c.custom, placeholder: '札を探して足す（通常と＋の両方が入ります）'}),
        Object.keys(o.set).map(k => h('div.ovrow', {}, h('span.fl', OV_FIELDS[k] || k),
          k === 'type' ? h('select', {onchange: e => { o.set.type = e.target.value; commit(true); }}, [['active', 'アクティブ'], ['mental', 'メンタル'], ['trouble', 'トラブル']].map(([v, t]) => h('option', {value: v, selected: o.set.type === v}, t)))
            : k === 'once' ? h('select', {onchange: e => { o.set.once = e.target.value === 'true'; commit(true); }}, [['true', 'はい'], ['false', 'いいえ']].map(([v, t]) => h('option', {value: v, selected: String(o.set.once) === v}, t)))
              : ['actions', 'effects'].includes(k) ? effectInput(o.set, k) : h('input.wide', {value: o.set[k] ?? '', oninput: e => { o.set[k] = e.target.value; commit(false); }}),
          h('button.x', {title: 'この項目を外す', onclick: () => { delete o.set[k]; commit(true); }}, '×'))),
        h('select', {onchange: e => { const k = e.target.value; if (!k) return; o.set[k] = k === 'type' ? 'mental' : k === 'once' ? true : ''; commit(true); }},
          h('option', {value: ''}, '＋ 直す項目を足す…'), Object.entries(OV_FIELDS).filter(([k]) => !(k in o.set)).map(([k, t]) => h('option', {value: k}, t))),
        h('label.f', {}, h('span.fl', '理由'), h('input.wide', {value: o.reason || '', placeholder: '例：実ゲームで確認（2026-11-03）', oninput: e => { o.reason = e.target.value; commit(false); }})));
    }),
    h('button', {onclick: () => { CS.overrides.push({ids: [], name: '', set: {}, reason: ''}); commit(true); }}, '＋ 上書きを足す'));

  // ---- 足した札の点検 ----
  // 点検する札：自作の札、上書きした札、アビリティ（HIF など）を付けた札（エンジンの inspectCards は {id, abilities:[名前]} の指定も受ける）
  const ids = [...new Set([...CS.customCards.map(c => c.id), ...CS.overrides.flatMap(o => o.ids)])];
  for (const [name, groups] of Object.entries(CS.abilities)) for (const g of groups) for (const id of g.cards) ids.push({id, abilities: [name]});
  const idName = x => typeof x === 'number' ? (D.cardById.get(x)?.name || x) : `${D.cardById.get(x.id)?.name || x.id}＋${x.abilities.join('・')}`;
  const ir = inspect.result;
  const inspectBox = h('section.panel', {},
    h('h2', '足した札の点検'),
    h('p.note', '自作の札・上書きした札・アビリティ（HIF など）を付けた札を、ランダムな局面で2つのエンジン（Talos と Tecnai）に計算させて、全部の状態が一致するかを調べます（最大1分）。'),
    h('p', ids.length ? '点検する札：' + ids.map(idName).join('、') : '点検する札がありません（自作の札・上書き・アビリティを足すと点検できます）。'),
    h('div.row', {},
      h('button.pri', {disabled: !ids.length || inspect.running || !checkCalcSettings(CS).ok, onclick: () => {
        inspect = {running: true, result: null, error: null}; rerender();
        startInspect({ids, calcSettings: CS, opts: {cases: 40, maxStates: 2000, maxMs: 60000}},
          {done: r => { inspect = {running: false, result: r, error: null}; rerender(); }, error: m => { inspect = {running: false, result: null, error: m}; rerender(); }});
      }}, inspect.running ? '点検中…' : '点検する'),
      inspect.running && h('button.danger', {onclick: () => { cancelInspect(); inspect = {running: false, result: null, error: '中止しました'}; rerender(); }}, '中止')),
    inspect.error && h('p.warnline', inspect.error),
    ir && (ir.error ? h('p.warnline', ir.error) : h('div', {},
      h('p', {class: ir.ok ? 'ok' : 'warnline'}, ir.ok ? '✔ 一致しました（2つのエンジンで、全部の状態が同じ）' : ir.cases ? `✖ 不一致が ${ir.mismatches} 件あります` : '✖ 点検できた局面がありません'),
      h('table.tbl.narrow', {}, h('tbody',
        h('tr', h('th', '局面'), h('td.n', ir.cases)), h('tr', h('th', '状態'), h('td.n', ir.states)), h('tr', h('th', '遷移'), h('td.n', ir.transitions)),
        h('tr', h('th', '時間'), h('td.n', (ir.ms / 1000).toFixed(1) + '秒')), ir.stopped && h('tr', h('th', '止めた理由'), h('td', ir.stopped)))),
      ir.loadErrors?.length ? h('details', {}, h('summary', `読み込めなかった局面 ${ir.loadErrors.length} 件`), h('pre', ir.loadErrors.join('\n'))) : null,
      ir.examples?.length ? h('details', {}, h('summary', '不一致の例'), h('pre', JSON.stringify(ir.examples, null, 1).slice(0, 4000))) : null)));

  // ---- データの更新 ----
  const un = unsupported(CS);
  const dataBox = h('section.panel', {},
    h('h2', 'データの更新（gakumas-tools の CSV）'),
    h('p', D.csvSource.kind === 'user' ? `読み込んだ CSV を使っています（${D.csvSource.loaded}、${D.csvSource.names.join('・')}）。` : `同梱のデータを使っています（gakumas-tools ${D.version.data.commit}、${D.version.data.fetched} 取得）。`),
    h('p.note', 'gakumas-tools の packages/gakumas-data/csv/ の CSV（skill_cards.csv・p_drinks.csv・p_items.csv・customizations.csv・p_idols.csv）を選ぶと、このブラウザの中だけで差し替えます。読み込んだら、対応していない効果を持つ札を一覧で知らせます。'),
    h('div.row', {},
      h('label.button', {}, 'CSV を選ぶ（複数可）', h('input', {type: 'file', accept: '.csv', multiple: true, hidden: true, onchange: e => readCsv([...e.target.files])})),
      D.csvSource.kind === 'user' && h('button', {onclick: () => { if (confirm('同梱のデータに戻しますか？（ページを読み込み直します）')) { saveUserCsv(null); location.reload(); } }}, '同梱のデータに戻す')),
    h('h3', '対応していない効果を持つもの（計算に使えません）'),
    h('table.tbl.narrow', {}, h('tbody',
      h('tr', h('th', '札'), h('td.n', `${un.counts.unsupportedCards} / ${un.counts.cards}`)),
      h('tr', h('th', 'ドリンク'), h('td.n', `${un.counts.unsupportedDrinks} / ${un.counts.drinks}`)),
      h('tr', h('th', 'P アイテム'), h('td.n', `${un.counts.unsupportedItems} / ${un.counts.items}`)))),
    h('p.note', 'ほかのプランの札や、全力・体力系の効果など、計算の範囲の外のものを含みます。デッキの札がこの一覧にあると、局面の確かめでエラーになります。'),
    [['札', un.cards.filter(c => D.cardById.has(c.id))], ['ドリンク', un.drinks], ['P アイテム', un.items]].map(([t, list]) =>
      h('details', {}, h('summary', `${t}（${list.length} 件）`),
        h('ul.unsup', list.slice(0, 400).map(x => h('li', {}, h('b', x.name), '　' + x.problems.slice(0, 2).join('／')))))));

  async function readCsv(files) {
    const byName = Object.fromEntries(Object.entries(CSV_FILES).map(([k, v]) => [v, k]));
    const got = {};
    for (const f of files) { const k = byName[f.name]; if (!k) { alert(`知らないファイル名です：${f.name}（${Object.values(CSV_FILES).join('・')} のどれか）`); return; } got[k] = await f.text(); }
    const prev = loadUserCsv()?.files || {};
    const merged = {...prev, ...got};
    try { loadData({...D.csv, ...merged}); } catch (e) { alert('この CSV は読み込めません：' + (e.message || e)); return; }
    saveUserCsv({loaded: new Date().toISOString().slice(0, 10), files: merged});
    alert('読み込みました。ページを読み込み直します。'); location.reload();
  }

  // ---- 書き出し・読み込み・既定・JSON ----
  const ioBox = h('section.panel', {},
    h('h2', '札の設定の保存'),
    h('p.note', S.calcSettings ? 'あなたが変えた設定を使っています（このブラウザに保存）。' : '既定の設定を使っています。'),
    h('div.row', {},
      h('button', {onclick: () => { const b = new Blob([JSON.stringify(CS, null, 1)], {type: 'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'aegis-card-settings.json'; a.click(); URL.revokeObjectURL(a.href); }}, 'ファイルに書き出す'),
      h('label.button', {}, 'ファイルから読み込む', h('input', {type: 'file', accept: '.json', hidden: true, onchange: e => e.target.files[0]?.text().then(t => { try { const o = JSON.parse(t); if (typeof o !== 'object' || Array.isArray(o)) throw 0; CS = o; S.calcSettings = o; syncCustomCards(o); save(); rerender(); toast('読み込みました'); } catch { alert('このファイルは読み込めません'); } })})),
      h('button.danger', {onclick: () => { if (confirm('札の設定を既定に戻しますか？（自作の札・上書きは消えます）')) { S.calcSettings = null; syncCustomCards(null); save(); rerender(); } }}, '既定に戻す')),
    h('details', {}, h('summary', '中身（JSON）を直接見る・直す'),
      h('textarea.json', {rows: 14, spellcheck: false, value: JSON.stringify(CS, null, 1), onchange: e => { try { CS = JSON.parse(e.target.value); commit(true); } catch (err) { alert('JSON の書き方の誤り：' + err.message); } }})));

  root.append(h('div.cs', {},
    h('section.panel.csprob', {}, h('h2', '設定の確かめ'), probBox),
    h('div.cols.cscols', {}, h('div', {}, abilityBox, customBox, ovBox), h('div', {}, inspectBox, dataBox, ioBox))));
}
