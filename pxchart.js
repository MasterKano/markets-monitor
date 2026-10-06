"use strict";
/* Own price chart for symbols TradingView's free embed refuses ("This symbol is only available on TradingView":
   LSE, HKEX, Tokyo and TVC/NASDAQ indices). Bars come straight from the browser via CNBC's public chart API
   (keyless, CORS-enabled, ~15 min delayed); no data files or scheduled jobs. If that fails, the caller gets a
   rejection and shows a message with TradingView / Yahoo links (or the table's 1Y line). window.PXChart. */
(()=>{
const NO_EMBED_EX=new Set(["LSE","HKEX","TSE","TVC"]),NO_EMBED_SYM=new Set(["NASDAQ:IXIC","NASDAQ:NDX"]);
const up=s=>String(s||"").trim().toUpperCase();
function embeddable(sym){const s=up(sym);return!(NO_EMBED_EX.has(s.split(":")[0])||NO_EMBED_SYM.has(s));}
/* TradingView symbol -> CNBC symbol, plus the exchange name CNBC must report (guards against a wrong-market match) */
const SPECIAL={"TVC:VIX":".VIX","TVC:DXY":".DXY","TVC:SXXP":".STOXX","NASDAQ:IXIC":".IXIC","NASDAQ:NDX":".NDX","TVC:NI225":".N225","TVC:HSI":".HSI","TVC:SPX":".SPX"};
const SUF={LSE:["-GB",/london/i],HKEX:["-HK",/hong kong/i],OSL:["-NO",/oslo/i],OMXSTO:["-SE",/stockholm/i],TSX:["-CA",/toronto/i],TSXV:["-V",/venture/i],
 OMXHEX:["-FI",/helsinki/i],XETR:["-DE",/xetra|frankfurt|germany/i],SIX:["-CH",/swiss|six/i],BME:["-ES",/madrid|spain|bme/i],MIL:["-IT",/milan|ital/i]};
function cnbc(sym){const s=up(sym);if(SPECIAL[s])return{c:SPECIAL[s],re:null};const[ex,t]=s.split(":");if(!t)return null;
 if(ex==="NYSE"||ex==="NASDAQ"||ex==="AMEX")return/^[A-Z.]+$/.test(t)?{c:t,re:/nyse|nasdaq|arca|american|cboe|bats/i}:null;
 const m=SUF[ex];if(!m)return null;let k=t;if(ex==="HKEX")k=t.replace(/^0+(?=\d)/,"");else if(ex==="LSE"||ex==="TSX"||ex==="TSXV")k=t.replace(/-/g,".");else if(ex==="OMXSTO")k=t.replace(/_/g,".");
 return{c:k+m[0],re:m[1]};}
function yahoo(sym){const s=up(sym);const Y={"TVC:VIX":"^VIX","TVC:DXY":"DX-Y.NYB","TVC:SXXP":"^STOXX","NASDAQ:IXIC":"^IXIC","NASDAQ:NDX":"^NDX","TVC:NI225":"^N225","TVC:HSI":"^HSI","TVC:SPX":"^GSPC"};if(Y[s])return Y[s];
 const[ex,t]=s.split(":");if(!t)return s;const d=t.replace(/[._]/g,"-");
 const suf={LSE:".L",HKEX:".HK",TSE:".T",OSL:".OL",OMXSTO:".ST",TSX:".TO",TSXV:".V",OMXCOP:".CO",OMXHEX:".HE",XETR:".DE",SIX:".SW",BME:".MC",MIL:".MI",VIE:".VI"}[ex];
 if(ex==="HKEX")return t.replace(/^0+(?=\d)/,"").padStart(4,"0")+".HK";if(ex==="LSE")return t.replace(/\.$/,"").replace(/[._]/g,"-")+".L";return d+(suf||"");}
const links=sym=>{const s=up(sym);return{tv:"https://www.tradingview.com/symbols/"+encodeURIComponent(s.replace(":","-"))+"/",yh:"https://finance.yahoo.com/quote/"+encodeURIComponent(yahoo(s))};};
const exName=sym=>({LSE:"London Stock Exchange",HKEX:"Hong Kong",TSE:"Tokyo",TVC:"TVC index"}[up(sym).split(":")[0]]||up(sym).split(":")[0]);

/* ---------- data ---------- */
const API="https://ts-api.cnbc.com/harmony/app/",cache=new Map();
const ymd=ms=>new Date(ms).toISOString().slice(0,10).replace(/-/g,"")+"000000";
const num=v=>{const n=parseFloat(String(v==null?"":v).replace(/,/g,""));return isFinite(n)?n:null;};
function memo(key,fn){if(!cache.has(key))cache.set(key,fn().catch(e=>{cache.delete(key);throw e;}));return cache.get(key);}
async function getJSON(u){const r=await fetch(u);if(!r.ok)throw Error("price source HTTP "+r.status);return r.json();}
function quote(c){return memo("q|"+c,async()=>{const d=await getJSON("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols="+encodeURIComponent(c)+"&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json");
 const q=d&&d.FormattedQuoteResult&&d.FormattedQuoteResult.FormattedQuote&&d.FormattedQuoteResult.FormattedQuote[0];if(!q||q.code!==0)throw Error("symbol not found at the price source");return q;});}
/* CNBC keeps ~100 days of hourly bars, so 4-hour MAs are shorter-lived than on TradingView */
const SPAN={"60":[110,"1H"],"240":[110,"1H"],D:[1130,"1D"],W:[3660,"1W"],M:[9500,"1W"]};
function rawBars(c,tf){const[days,type]=SPAN[tf]||SPAN.D;const now=Date.now();
 return memo("b|"+c+"|"+type+"|"+days,async()=>{const d=await getJSON(API+"bars/"+encodeURIComponent(c)+"/"+type+"/"+ymd(now-days*864e5)+"/"+ymd(now+864e5)+"/adjusted/EST5EDT.json");
  const pb=d&&d.barData&&d.barData.priceBars;if(!pb||!pb.length)throw Error((d&&d.statusMessage)||"no price history");
  return pb.map(b=>({t:String(b.tradeTime),ms:+b.tradeTimeinMills,o:num(b.open),h:num(b.high),l:num(b.low),c:num(b.close),v:num(b.volume)||0})).filter(b=>b.c>0);});}
function agg(cur,b){cur.h=Math.max(cur.h,b.h);cur.l=Math.min(cur.l,b.l);cur.c=b.c;cur.v+=b.v;cur.n++;}
function byKey(a,keyOf){const out=[];let cur=null,k=null;for(const b of a){const kk=keyOf(b);if(!cur||kk!==k){cur={...b,n:1};out.push(cur);k=kk;}else agg(cur,b);}return out;}
/* 4-hour bars: up to 4 hourly bars, never across a session gap */
function by4h(a){const out=[];let cur=null,prev=0;for(const b of a){if(!cur||cur.n>=4||b.ms-prev>3*36e5){cur={...b,n:1};out.push(cur);}else agg(cur,b);prev=b.ms;}return out;}
/* resolve -> {bars, quote, src}; throws with a readable reason */
async function load(sym,tf){const m=cnbc(sym);if(!m)throw Error("no free price source for "+exName(sym)+" symbols");
 const[q,raw]=await Promise.all([quote(m.c).catch(e=>({err:e})),rawBars(m.c,tf)]);
 if(q.err&&/not found/.test(q.err.message))throw q.err;
 if(!q.err&&m.re&&!m.re.test(q.exchange||""))throw Error("price source matched a different market ("+(q.exchange||"?")+")");
 let bars=raw;
 if(tf==="240")bars=by4h(raw);
 if(tf==="M")bars=byKey(raw,b=>b.t.slice(0,6));
 if(tf==="D"&&!q.err){const lt=q.last_time&&new Date(q.last_time),px=num(q.last);const last=bars[bars.length-1];
  if(lt&&px&&last){const day=lt.toLocaleDateString("en-CA",{timeZone:"America/New_York"}).replace(/-/g,"");
   if(day>last.t.slice(0,8)&&Date.now()-lt<4*864e5)bars=bars.concat({t:day+"000000",ms:+lt,o:num(q.open)||px,h:num(q.high)||px,l:num(q.low)||px,c:px,v:num(q.volume)||0,live:true});}}
 return{bars,quote:q.err?null:q,src:"CNBC"};}

/* ---------- drawing ---------- */
const NS="http://www.w3.org/2000/svg";
const sma=(a,n)=>{const o=new Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)o[i]=s/n;}return o;};
function rsi(a,n=14){const o=new Array(a.length).fill(null);let g=0,l=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1],G=Math.max(d,0),L=Math.max(-d,0);
 if(i<=n){g+=G;l+=L;if(i===n){g/=n;l/=n;o[i]=l?100-100/(1+g/l):100;}}else{g=(g*(n-1)+G)/n;l=(l*(n-1)+L)/n;o[i]=l?100-100/(1+g/l):100;}}return o;}
const VIS={"60":150,"240":160,D:260,W:260,M:240};
const fmtPx=v=>v==null?"–":Math.abs(v)>=1000?v.toLocaleString("en-US",{maximumFractionDigits:0}):Math.abs(v)>=100?v.toFixed(1):Math.abs(v)>=1?v.toFixed(2):v.toPrecision(3);
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const gva=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Zurich",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
function dLab(b,tf,long){if(b.synthetic)return b.lab||"";if(tf==="60"||tf==="240")return long?gva.format(new Date(b.ms)):gva.format(new Date(b.ms)).replace(/^\w+,?\s*/,"").replace(/,.*$/,"");
 const y=b.t.slice(0,4),m=MON[+b.t.slice(4,6)-1],d=+b.t.slice(6,8);if(tf==="M")return m+" "+y;return long?d+" "+m+" "+y:(tf==="W"?m+" "+y.slice(2):d+" "+m);}
function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);parent&&parent.append(e);return e;}
function clear(box){if(box&&box._pxro){box._pxro.disconnect();box._pxro=null;}}
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TFN={"60":"1-hour","240":"4-hour",D:"daily",W:"weekly",M:"monthly"};
/* paint(box,data,{symbol,name,interval,studies,compact,note}) */
function paint(box,data,o){clear(box);box.replaceChildren();const tf=o.interval||"D",st=o.studies||"ma",all=data.bars;const L=links(o.symbol);
 const wrap=document.createElement("div");wrap.className="px-chart"+(o.compact?" is-compact":"");box.append(wrap);
 const q=data.quote,ccy=q&&q.currencyCode||"";
 const head=document.createElement("div");head.className="px-legend";wrap.append(head);
 const svgBox=document.createElement("div");svgBox.className="px-plot";wrap.append(svgBox);
 const foot=document.createElement("div");foot.className="px-foot";
 foot.innerHTML='<span>'+esc(o.note||(o.compact?"Daily · CNBC (delayed)":"Own chart · "+(TFN[tf]||"daily")+" bars from "+data.src+" (delayed)"+(embeddable(o.symbol)?"":" · TradingView doesn't license "+exName(o.symbol)+" data to free embeds")))+'</span><span class="px-links"><a href="'+L.tv+'" target="_blank" rel="noopener noreferrer">TradingView ↗</a><a href="'+L.yh+'" target="_blank" rel="noopener noreferrer">Yahoo ↗</a></span>';
 wrap.append(foot);
 const closes=all.map(b=>b.c);const showMA=st.includes("ma")&&!data.noMA,showVol=st.includes("vol")&&all.some(b=>b.v>0)&&!data.noMA,showRsi=st.includes("rsi")&&!data.noMA;
 const MA=showMA?[[50,"var(--amber)"],[100,"var(--violet)"],[200,"var(--accent)"]].map(([n,c])=>({n,c,v:sma(closes,n)})):[];
 const R=showRsi?rsi(closes):null;const n0=Math.max(0,all.length-(o.compact?Math.min(VIS[tf],260):VIS[tf]));const bars=all.slice(n0);
 const first=bars[0],last=bars[bars.length-1],chg=(last.c/first.c-1)*100,col=last.c>=first.c?"var(--good)":"var(--bad)";
 function legend(i){const b=bars[i],gi=n0+i;const prev=gi>0?all[gi-1].c:null,dc=prev?(b.c/prev-1)*100:null;
  head.innerHTML='<span class="px-name">'+esc(o.name||o.symbol)+'</span><span class="px-px">'+fmtPx(b.c)+(ccy?' <small>'+esc(ccy)+'</small>':"")+'</span>'+
   (dc!=null?'<span class="'+(dc>0?"up":dc<0?"dn":"")+'">'+(dc>0?"+":"")+dc.toFixed(2)+'%</span>':"")+'<span class="px-date">'+esc(dLab(b,tf,true))+(b.live?" · live":"")+'</span>'+
   MA.map(m=>m.v[gi]!=null?'<span class="px-ma" style="--c:'+m.c+'">MA'+m.n+' '+fmtPx(m.v[gi])+'</span>':"").join("")+
   (R&&R[gi]!=null?'<span class="px-ma" style="--c:var(--muted)">RSI '+R[gi].toFixed(0)+'</span>':"");}
 function draw(){const W=Math.max(160,svgBox.clientWidth),H=Math.max(60,svgBox.clientHeight);svgBox.replaceChildren();
  const svg=el("svg",{viewBox:"0 0 "+W+" "+H,width:W,height:H,class:"px-svg",role:"img","aria-label":(o.name||o.symbol)+" price chart"},svgBox);
  const padR=o.compact?44:54,padB=18,padT=6,rsiH=R?Math.round(H*.2):0,pw=W-padR,ph=H-padB-padT-rsiH-(R?8:0);
  const vis=[];bars.forEach((b,i)=>{vis.push(b.c);MA.forEach(m=>{const v=m.v[n0+i];if(v!=null)vis.push(v);});});
  let lo=Math.min(...vis),hi=Math.max(...vis);if(hi===lo){hi+=1;lo-=1;}const padY=(hi-lo)*.06;lo-=padY;hi+=padY;
  const X=i=>bars.length<2?pw/2:i/(bars.length-1)*(pw-4)+2,Y=v=>padT+(1-(v-lo)/(hi-lo))*ph;
  /* grid + price axis */
  const step=(()=>{const raw=(hi-lo)/(o.compact?3:5),p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p;return(f<1.5?1:f<3?2:f<7?5:10)*p;})();
  for(let v=Math.ceil(lo/step)*step;v<=hi;v+=step){const y=Y(v);el("line",{x1:0,x2:pw,y1:y,y2:y,class:"px-grid"},svg);const t=el("text",{x:pw+5,y:y+3.5,class:"px-ax"},svg);t.textContent=fmtPx(v);}
  /* date axis */
  const nt=Math.max(2,Math.floor(pw/(o.compact?100:95)));for(let k=0;k<nt;k++){const i=Math.round(k*(bars.length-1)/(nt-1||1));const x=X(i);
   el("line",{x1:x,x2:x,y1:padT,y2:H-padB,class:"px-grid"},svg);const t=el("text",{x:Math.min(Math.max(x,18),pw-18),y:H-5,class:"px-ax","text-anchor":"middle"},svg);t.textContent=dLab(bars[i],tf,false);}
  /* volume */
  if(showVol){const vm=Math.max(...bars.map(b=>b.v))||1,vh=ph*.2,bw=Math.max(1,pw/bars.length*.7);
   bars.forEach((b,i)=>{const h=b.v/vm*vh;if(h>0)el("rect",{x:X(i)-bw/2,y:padT+ph-h,width:bw,height:h,class:"px-vol",fill:i&&b.c<bars[i-1].c?"var(--bad)":"var(--good)"},svg);});}
  /* area + line */
  const d=bars.map((b,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(b.c).toFixed(1)).join("");
  const gid="pxg"+Math.random().toString(36).slice(2,8);const defs=el("defs",{},svg);const lg=el("linearGradient",{id:gid,x1:0,x2:0,y1:0,y2:1},defs);
  el("stop",{offset:0,"stop-color":col,"stop-opacity":.26},lg);el("stop",{offset:1,"stop-color":col,"stop-opacity":0},lg);
  el("path",{d:d+"L"+X(bars.length-1).toFixed(1)+" "+(padT+ph)+"L"+X(0).toFixed(1)+" "+(padT+ph)+"Z",fill:"url(#"+gid+")"},svg);
  MA.forEach(m=>{let p="",on=false;bars.forEach((b,i)=>{const v=m.v[n0+i];if(v==null){on=false;return;}p+=(on?"L":"M")+X(i).toFixed(1)+" "+Y(v).toFixed(1);on=true;});if(p)el("path",{d:p,class:"px-maline",stroke:m.c},svg);});
  el("path",{d,class:"px-line",stroke:col},svg);
  const ly=Y(last.c);el("line",{x1:0,x2:pw,y1:ly,y2:ly,class:"px-lastline",stroke:col},svg);
  const tag=el("g",{},svg);el("rect",{x:pw+1,y:ly-8,width:padR-2,height:16,rx:3,fill:col},tag);const tt=el("text",{x:pw+5,y:ly+3.5,class:"px-tag"},tag);tt.textContent=fmtPx(last.c);
  /* RSI pane */
  if(R){const top=padT+ph+8,Yr=v=>top+(1-v/100)*rsiH;[30,70].forEach(v=>el("line",{x1:0,x2:pw,y1:Yr(v),y2:Yr(v),class:"px-grid"},svg));
   let p="",on=false;bars.forEach((b,i)=>{const v=R[n0+i];if(v==null){on=false;return;}p+=(on?"L":"M")+X(i).toFixed(1)+" "+Yr(v).toFixed(1);on=true;});el("path",{d:p,class:"px-maline",stroke:"var(--muted)"},svg);
   const t=el("text",{x:pw+5,y:top+10,class:"px-ax"},svg);t.textContent="RSI 14";}
  /* crosshair */
  const cx=el("line",{x1:0,x2:0,y1:padT,y2:H-padB,class:"px-cross",visibility:"hidden"},svg),dot=el("circle",{r:3.2,fill:col,visibility:"hidden"},svg);
  const move=e=>{const r=svg.getBoundingClientRect();const x=(e.clientX-r.left)*(W/r.width);const i=Math.max(0,Math.min(bars.length-1,Math.round((x-2)/(pw-4)*(bars.length-1))));
   const xx=X(i);cx.setAttribute("x1",xx);cx.setAttribute("x2",xx);dot.setAttribute("cx",xx);dot.setAttribute("cy",Y(bars[i].c));cx.setAttribute("visibility","visible");dot.setAttribute("visibility","visible");legend(i);};
  svg.addEventListener("pointermove",move);svg.addEventListener("pointerdown",move);
  svg.addEventListener("pointerleave",()=>{cx.setAttribute("visibility","hidden");dot.setAttribute("visibility","hidden");legend(bars.length-1);});}
 const sum=document.createElement("span");sum.className="px-sum "+(chg>=0?"up":"dn");sum.textContent=dLab(first,tf,true)+" → "+(chg>=0?"+":"")+chg.toFixed(1)+"%";head.after(sum);
 legend(bars.length-1);draw();
 if("ResizeObserver"in window){let w0=svgBox.clientWidth,h0=svgBox.clientHeight,t;box._pxro=new ResizeObserver(()=>{if(svgBox.clientWidth===w0&&svgBox.clientHeight===h0)return;w0=svgBox.clientWidth;h0=svgBox.clientHeight;clearTimeout(t);t=setTimeout(draw,60);});box._pxro.observe(svgBox);}}
/* table rows carry a 1Y spark (every 2nd close) - used when the live source is unreachable */
function fromSpark(r){const p=r&&r.spark;if(!p||p.length<2)return null;const a=Date.parse(r.spark_from||""),b=Date.parse(r.bar_date||"");const ok=isFinite(a)&&isFinite(b);
 const f=ms=>{const d=new Date(ms);return d.getUTCDate()+" "+MON[d.getUTCMonth()]+" "+d.getUTCFullYear();};
 return{bars:p.map((c,i)=>({c,v:0,synthetic:true,lab:ok?f(a+(b-a)*i/(p.length-1)):""})),quote:{currencyCode:r.ccy||""},src:"table",noMA:true};}
function message(box,sym,name,why){clear(box);const L=links(sym);box.replaceChildren();const d=document.createElement("div");d.className="px-msg";
 d.innerHTML='<strong>'+esc(name||sym)+'</strong><p>TradingView doesn\'t allow '+esc(exName(sym))+' charts in free website embeds, and the backup price feed '+(why?'failed ('+esc(why)+')':'is unavailable')+'.</p><p class="px-links"><a class="button" href="'+L.tv+'" target="_blank" rel="noopener noreferrer">Open on TradingView ↗</a><a class="button" href="'+L.yh+'" target="_blank" rel="noopener noreferrer">Yahoo ↗</a></p>';box.append(d);}
window.PXChart={embeddable,cnbc,yahoo,links,load,paint,fromSpark,message,clear};
})();
