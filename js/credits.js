// クレジットと注意：データの出典とライセンス、画像の権利、計算の前提、答えの種類の意味、非公式のファンツールであること
import {D} from './data.js';
import {h} from './ui.js';
import {STATUS} from './result.js';

export function renderCredits(root) {
  const v = D.version;
  root.append(h('div.credits', {},
    h('section.panel', {},
      h('h2', 'Solitaire Lab について'),
      h('ul', {},
        h('li', h('b', '非公式のファンツールです。'), 'ゲーム「学園アイドルマスター」の権利者、および gakumas-tools とは関係がなく、公認を受けたものではありません。'),
        h('li', h('b', '営利目的ではありません。'), '無料で、広告もありません。'),
        h('li', '計算はすべて、あなたのブラウザの中で行います。入力したデッキや局面は、このブラウザの中だけに保存され、どこにも送りません。'),
        h('li', '答えは計算のモデル（下の「計算の前提」）に基づくもので、実際のゲームの結果を保証するものではありません。'))),
    h('section.panel', {},
      h('h2', '計算の前提'),
      h('ul', {},
        h('li', '1ターンの中の札の使い方（ソリティア）だけを計算します。次のターン以降に起きる効果は数えません（ターン終了時の効果は数えます）。'),
        h('li', 'cm燕のように全力を絡める場合について：このツールは1ターンだけのソリティアを想定しているため、全力の効果と、ターンをまたぐ効果（ソリティアのターンに発動するものは除く）は計算に入れていません。オバドラループを含めた計算はできません。オバドラを含む1ターンのソリティアは計算できます。'),
        h('li', 'ソリティアのターンの開始時に起きる効果（熱意の増加など）は、計算に含めません。その効果が起きた後の値を、局面の初期条件として入力してください。'),
        h('li', '体力・元気・全力は省きます（札は常に使える前提）。'),
        h('li', '札・ドリンク・P アイテムの効果は、gakumas-tools のデータの文面どおりに計算します。一部の札は、実際のゲームとの照合がまだです（試作・未検証）。'),
        h('li', '確率は分数で正確に扱います。'))),
    h('section.panel', {},
      h('h2', '答えの種類'),
      h('table.tbl', {}, h('tbody', Object.values(STATUS).map(([name, cls, desc]) => h('tr', h('th', h('span.status', {class: cls}, name)), h('td', desc)))))),
    h('section.panel', {},
      h('h2', 'データの出典とライセンス'),
      h('p', {}, '札・ドリンク・P アイテム・P アイドル・カスタマイズのデータは ', h('a', {href: v.data.url, target: '_blank', rel: 'noopener'}, 'gakumas-tools'),
        ` のものを使っています（コミット ${v.data.commit}、${v.data.fetched} 取得、変更なし）。ライセンスは BSD 3-Clause です。`),
      h('pre.license', D.license || '（ライセンスの文が読み込めませんでした）')),
    D.images && h('section.panel', {},
      h('h2', '画像について'),
      h('ul', {},
        h('li', '札・P ドリンク・P アイテム・P アイドルの画像の権利は、ゲーム「学園アイドルマスター」の権利者にあります。'),
        h('li', `画像は gakumas-tools（コミット ${D.images.commit.slice(0, 7)}、${D.images.fetched} 取得）から、必要な分だけを縮小して使っています。gakumas-tools の BSD 3-Clause ライセンスは、画像には及びません。`),
        h('li', '権利者から求められたときは、すぐに画像を外します。'))),
    h('section.panel', {},
      h('h2', '版'),
      h('p', `Solitaire Lab ${v.gui}／計算 ${v.engine.name || ''} ${v.engine.commit || ''}（${v.engine.date || ''}）／データ gakumas-tools ${v.data.commit}（${v.data.fetched} 取得）` +
        (D.images ? `／画像 ${D.images.fetched} 取得` : '／画像なしの版')))));
}
