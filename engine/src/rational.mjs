const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b];}return a;};
export const R=(n,d=1n)=>{n=BigInt(n);d=BigInt(d);if(d===0n)throw Error('R_ZERO_DEN');if(d<0n){n=-n;d=-d;}const g=gcd(n,d)||1n;return {n:n/g,d:d/g};};
export const ZERO=R(0),ONE=R(1);
export const add=(x,y)=>R(x.n*y.d+y.n*x.d,x.d*y.d);
export const sub=(x,y)=>R(x.n*y.d-y.n*x.d,x.d*y.d);
export const mul=(x,y)=>R(x.n*y.n,x.d*y.d);
export const cmp=(x,y)=>{const l=x.n*y.d,r=y.n*x.d;return l<r?-1:l>r?1:0;};
export const eq=(x,y)=>x.n===y.n&&x.d===y.d;
export const toNum=x=>Number(x.n)/Number(x.d);
export const str=x=>x.d===1n?String(x.n):x.n+'/'+x.d;
export const parse=s=>{const [n,d='1']=String(s).split('/');return R(BigInt(n),BigInt(d));};
export const recovery={exact:0,nearest:0};
const fromFloatCache=new Map();
export function fromFloat(p,maxDen=10n**9n){
  const hit=fromFloatCache.get(p);if(hit)return hit;
  const r=fromFloatUncached(p,maxDen);if(fromFloatCache.size<1e6)fromFloatCache.set(p,r);return r;
}
function fromFloatUncached(p,maxDen){
  if(!Number.isFinite(p)||p<0||p>1)throw Error('R_FLOAT_RANGE');
  if(p===0)return ZERO;if(p===1)return ONE;
  let h0=0n,h1=1n,k0=1n,k1=0n,x=p;
  for(let i=0;i<64;i++){
    const a=BigInt(Math.floor(x));const h2=a*h1+h0,k2=a*k1+k0;
    if(k2>maxDen)break;h0=h1;h1=h2;k0=k1;k1=k2;
    if(Number(h1)/Number(k1)===p){recovery.exact++;return R(h1,k1);}
    if(k1<=10n**7n&&Math.abs(Number(h1)/Number(k1)-p)<=8*Number.EPSILON*p){recovery.nearest++;return R(h1,k1);}
    const f=x-Math.floor(x);if(f===0)break;x=1/f;
  }
  throw Error('R_FLOAT_NOT_RATIONAL:'+p);
}
