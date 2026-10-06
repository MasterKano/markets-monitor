/* Table page: data/market.json + data/news.json (built by GitHub Actions). Real data only: null -> "n/a". */
(()=>{"use strict";
const LS="markets-monitor:table:v2";
const TZ="Europe/Zurich";
const PCT=["1D","1W","1M","6M","YTD","1Y","5Y","10Y"];
const FLOOR={"1D":1,"1W":2,"1M":4,"6M":8,"YTD":10,"1Y":12,"5Y":25,"10Y":40};
const FLOOR_BP={"1D":6,"1W":15,"1M":25,"6M":50,"YTD":60,"1Y":75,"5Y":150,"10Y":200};
const NARROW=matchMedia("(max-width:900px)");
const st=Object.assign({tab:"nordic",mode:"price",explain:null,sort:null,dir:-1,q:""},(()=>{try{return JSON.parse(localStorage.getItem(LS)||"{}");}catch(e){return{};}})());
if(st.mode!=="volma")st.mode="price";
const save=()=>{try{localStorage.setItem(LS,JSON.stringify({tab:st.tab,mode:st.mode,explain:st.explain,sort:st.sort,dir:st.dir}));}catch(e){}};
const showPrice=()=>st.mode==="price",showVolMa=()=>st.mode==="volma";
let DATA=null,NEWS=null;
const POWER="power";  // Nordic Power tab (power.js), not a market.json group
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NA='<span class="na">n/a</span>';
const isNum=v=>typeof v==="number"&&isFinite(v);
const gf=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
const gfs=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
function ago(iso){const m=(Date.now()-new Date(iso).getTime())/6e4;if(!isFinite(m))return"";if(m<1)return"just now";if(m<60)return Math.round(m)+"m ago";if(m<48*60)return Math.round(m/60)+"h ago";return Math.round(m/1440)+"d ago";}
function dp(v,kind){const a=Math.abs(v);if(kind==="fx"&&a<20)return 4;if(a>=10000)return 0;if(a>=1000)return 1;if(a>=1)return 2;if(a>=0.1)return 3;return 4;}
function fpx(v,kind){if(!isNum(v))return NA;const d=dp(v,kind);return v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});}
function fchg(v,ref,kind){if(!isNum(v))return NA;const d=dp(ref||v,kind);return(v>0?"+":v<0?"−":"")+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});}
function fpct(v){if(!isNum(v))return NA;const a=Math.abs(v);const d=a>=100?0:1;return(v>0?"+":v<0?"−":"")+a.toFixed(d)+"%";}
function fbp(v){if(!isNum(v))return NA;return(v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(Math.abs(v)>=10?0:1)+"bp";}
function fvol(v){if(!isNum(v))return NA;const a=Math.abs(v);if(a>=1e9)return(v/1e9).toFixed(2)+"B";if(a>=1e6)return(v/1e6).toFixed(a>=1e8?0:a>=1e7?1:2)+"M";if(a>=1e3)return(v/1e3).toFixed(a>=1e5?0:1)+"K";return String(v);}
/* neutral display labels for older data files (labels now come from scripts/universe.py) */
const SEC_FIX={"Potential acquirers":{label:"Strategic peers",note:"Speculative, illustrative screen of listed strategic and financial investors active in European renewables. Not based on any reported approach; not investment advice. Hover a name for the rationale."}};
const secLab=sec=>{const f=SEC_FIX[sec.label];return f?{label:f.label,note:f.note}:{label:sec.label,note:sec.note};};
const isCo=r=>r.kind==="equity"&&!!window.MMCompany;
const rows=()=>{const g=DATA&&DATA.groups.find(x=>x.id===st.tab);return g?g.sections.flatMap(s=>s.rows):[];};
function feur(v){if(!isNum(v))return NA;const a=Math.abs(v);if(a>=1e12)return(v/1e12).toFixed(2)+"T";if(a>=1e9)return(v/1e9).toFixed(a>=1e11?1:2)+"B";if(a>=1e6)return(v/1e6).toFixed(a>=1e8?0:a>=1e7?1:2)+"M";if(a>=1e3)return(v/1e3).toFixed(0)+"K";return String(Math.round(v));}
function fundTip(r,kind){const raw=kind==="ev"?r.ev:r.mcap;const eur=kind==="ev"?r.ev_eur:r.mcap_eur;const ccy=r.mcap_ccy||r.ccy||"";
 const bits=[];if(isNum(eur))bits.push("€"+feur(eur).replace(/<[^>]+>/g,""));if(isNum(raw)&&ccy)bits.push(feur(raw).replace(/<[^>]+>/g,"")+" "+ccy);if(DATA&&DATA.fx_asof)bits.push("FX as of "+DATA.fx_asof);return bits.join(" · ");}

/* ---------- columns ---------- */
const val={
 name:r=>r.name.toLowerCase(),px:r=>r.px,chg:r=>r.px&&r.chg!=null?r.chg/(r.px-r.chg)*100:null,spark:r=>r.pct&&r.pct["1Y"],
 mcap:r=>r.mcap_eur,ev:r=>r.ev_eur,vlast:r=>r.vol&&r.vol.last,
};
PCT.forEach(k=>val["p"+k]=r=>r.kind==="yield"&&r.bp?r.bp[k]:r.pct&&r.pct[k]);
[5,20,50].forEach(n=>val["v"+n]=r=>r.vol&&r.vol["r"+n]);
[10,20,50,200].forEach(n=>val["m"+n]=r=>r.ma&&r.ma[n]?(r.kind==="yield"?r.ma[n].bp:r.ma[n].pct):null);
const COLS=[
 {k:"name",g:"",l:"Instrument",cls:"c-name"},
 {k:"px",g:"",l:"Last",cls:"num c-px",t:"Latest daily close from Yahoo Finance, local currency (delayed ~15 min on most non-US venues)"},
 {k:"mcap",g:"",l:"Mkt cap €",cls:"num c-mcap",t:"Market capitalization converted to EUR (Yahoo; FX from Yahoo EUR crosses or ECB mid). Hover for original currency."},
 {k:"ev",g:"",l:"EV €",cls:"num c-ev",t:"Enterprise value converted to EUR when Yahoo provides it. Hover for original currency."},
 {k:"spark",g:"price",l:"1Y",t:"1-year daily close sparkline (sorts by 1Y %)",cls:"c-spark"},
 {k:"chg",g:"price",l:"1D chg",t:"Change vs previous close. Yields in bp."},
 ...PCT.map(k=>({k:"p"+k,g:"price",l:k==="1D"?"1D %":k,hz:k,
   t:(k==="YTD"?"Since prior year-end close":"Price return over "+k)+(k==="10Y"?". Futures: continuous front month, roll-affected (†)":"")+". Yields shown as bp change."})),
 {k:"vlast",g:"vol",l:"Last vol",t:"Volume of the latest session"},
 ...[5,20,50].map(n=>({k:"v"+n,g:"vol",l:n+"d avg",t:"Average volume of the "+n+" sessions before the latest; ratio = last ÷ average (highlighted > 1.5x)"})),
 ...[10,20,50,200].map(n=>({k:"m"+n,g:"ma",l:n+"d MA",t:"Price vs "+n+"-day simple moving average (●above / ●below). MA value in tooltip."})),
];
const GROUPS=[["","",1],["price","Price",0],["vol","Volume",0],["ma","Moving averages",0]];

/* ---------- cells ---------- */
function spark(r){const p=r.spark;if(!p||p.length<2)return NA;const w=84,h=24;let mn=Math.min(...p),mx=Math.max(...p);if(mx===mn)mx=mn+1;
 const pts=p.map((v,i)=>[(i/(p.length-1))*w,h-2-((v-mn)/(mx-mn))*(h-4)]);const d=pts.map((q,i)=>(i?"L":"M")+q[0].toFixed(1)+" "+q[1].toFixed(1)).join("");
 const up=p[p.length-1]>=p[0];const c=up?"var(--good)":"var(--bad)";const last=pts[pts.length-1];
 return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" aria-hidden="true"><path d="'+d+'L'+w+' '+h+'L0 '+h+'Z" fill="'+c+'" opacity=".12"/><path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="1.4" stroke-linejoin="round"/><circle cx="'+last[0].toFixed(1)+'" cy="'+last[1].toFixed(1)+'" r="2" fill="'+c+'"/></svg>';}
function heat(v,scale){if(!isNum(v)||!scale)return"";const h=Math.min(1,Math.abs(v)/scale);return' style="--h:'+(Math.round(h*100)/100)+'" data-s="'+(v>0?"p":v<0?"n":"z")+'"';}
function scales(rs){const out={},outbp={};for(const k of PCT){const a=rs.filter(r=>r.kind!=="yield").map(r=>r.pct&&r.pct[k]).filter(isNum).map(Math.abs).sort((x,y)=>x-y);
 const p=a.length?a[Math.floor(a.length*.8)]||a[a.length-1]:0;out[k]=Math.max(FLOOR[k],p);
 const b=rs.filter(r=>r.kind==="yield"&&r.bp).map(r=>r.bp[k]).filter(isNum).map(Math.abs).sort((x,y)=>x-y);outbp[k]=Math.max(FLOOR_BP[k],b.length?b[Math.floor(b.length*.8)]||b[b.length-1]:0);}
 return{pct:out,bp:outbp};}
function cell(c,r,S){const k=c.k,hid=c.hide?" c-opt":"";
 if(k==="name"){const sub=[r.sym,r.ccy].filter(Boolean).join(" · ");
  const flags=(r.note?'<span class="info" title="'+esc(r.note)+'">i</span>':"")+(r.error?'<span class="info bad" title="'+esc(r.error)+'">!</span>':"");
  const co=isCo(r);const nm=co?'<button type="button" class="nm co-link" aria-label="'+esc(r.name+": company profile")+'">'+esc(r.name)+'</button>':'<span class="nm">'+esc(r.name)+'</span>';
  return'<th scope="row" class="c-name'+(co?" has-co":"")+'"'+(r.note?' title="'+esc(r.name+" — "+r.note+(co?" · click for company profile":""))+'"':' title="'+esc(r.name+(co?" · click for company profile":r.bar_date?" · last bar "+r.bar_date:""))+'"')+'>'+nm+flags+'<span class="sym">'+esc(sub)+'</span></th>';}
 if(r.error&&k!=="name")return'<td class="na-cell'+hid+'">'+NA+'</td>';
 if(k==="px")return'<td class="num px c-px">'+fpx(r.px,r.kind)+'</td>';
 if(k==="mcap"){const v=r.mcap_eur;return'<td class="num c-mcap"'+(isNum(v)?' title="'+esc(fundTip(r,"mcap"))+'"':"")+'>'+feur(v)+'</td>';}
 if(k==="ev"){const v=r.ev_eur;return'<td class="num c-ev"'+(isNum(v)?' title="'+esc(fundTip(r,"ev"))+'"':"")+'>'+feur(v)+'</td>';}
 if(k==="spark")return'<td class="c-spark" title="1Y: '+esc(fpct(r.pct&&r.pct["1Y"]).replace(/<[^>]+>/g,""))+(r.spark_from?" (from "+r.spark_from+")":"")+'">'+spark(r)+'</td>';
 if(k==="chg"){const v=r.kind==="yield"?(r.bp&&r.bp["1D"]):r.chg;const s=isNum(v)?(v>0?"up":v<0?"dn":""):"";return'<td class="num '+s+'">'+(r.kind==="yield"?fbp(v):fchg(v,r.px,r.kind))+'</td>';}
 if(k[0]==="p"){const hz=c.hz;const y=r.kind==="yield";const v=y?(r.bp&&r.bp[hz]):(r.pct&&r.pct[hz]);
  const roll=hz==="10Y"&&r.roll&&isNum(v);const tip=roll?' title="Continuous front-month futures: 10Y figure is roll-affected"':y&&isNum(r.pct&&r.pct[hz])?' title="'+esc(fpct(r.pct[hz]))+' relative change in yield"':"";
  return'<td class="num heat'+hid+'"'+heat(v,y?S.bp[hz]:S.pct[hz])+tip+'>'+(y?fbp(v):fpct(v))+(roll?'<sup>†</sup>':"")+'</td>';}
 if(k==="vlast")return'<td class="num">'+(r.vol&&isNum(r.vol.last)?fvol(r.vol.last):NA)+'</td>';
 if(k[0]==="v"){const n=k.slice(1);const a=r.vol&&r.vol["a"+n],x=r.vol&&r.vol["r"+n];if(!isNum(a))return'<td class="num'+hid+'">'+NA+'</td>';
  return'<td class="num vol'+hid+(isNum(x)&&x>1.5?" hot":"")+'" title="'+n+'d avg volume '+a.toLocaleString("en-US")+(isNum(x)?" · last = "+x.toFixed(2)+"x":"")+'"><span class="ratio">'+(isNum(x)?x.toFixed(1)+"x":"n/a")+'</span><span class="avg">'+fvol(a)+'</span></td>';}
 if(k[0]==="m"){const n=k.slice(1);const m=r.ma&&r.ma[n];if(!m)return'<td class="num'+hid+'" title="Not enough history for a '+n+'d MA">'+NA+'</td>';
  const y=r.kind==="yield";const v=y?m.bp:m.pct;const above=v>=0;
  return'<td class="num ma'+hid+'" title="'+n+'d MA '+esc(fpx(m.v,r.kind))+' · price '+esc(fpx(r.px,r.kind))+'"><i class="dot '+(above?"above":"below")+'"></i>'+(y?fbp(v):fpct(v))+'</td>';}
 return"<td></td>";}

/* ---------- render ---------- */
function sortRows(rs){if(!st.sort||!val[st.sort])return rs;const f=val[st.sort];return rs.slice().sort((a,b)=>{const x=f(a),y=f(b);const nx=x==null||(typeof x==="number"&&!isFinite(x)),ny=y==null||(typeof y==="number"&&!isFinite(y));if(nx&&ny)return 0;if(nx)return 1;if(ny)return-1;if(typeof x==="string")return st.dir*x.localeCompare(y);return -st.dir*(y-x);});}
function renderTabs(){const box=$("tblTabs");box.replaceChildren();if(!DATA)return;DATA.groups.forEach(g=>{const rs=g.sections.flatMap(s=>s.rows).filter(r=>!r.error);const up=rs.filter(r=>r.pct&&r.pct["1D"]>0).length,dn=rs.filter(r=>r.pct&&r.pct["1D"]<0).length;const b=document.createElement("button");b.type="button";b.className="tbl-tab"+(g.id===st.tab?" is-on":"");b.setAttribute("role","tab");b.setAttribute("aria-selected",g.id===st.tab);
 b.innerHTML='<span>'+esc(g.label)+'</span><span class="breadth" title="'+up+' up / '+dn+' down today"><i style="width:'+(rs.length?Math.round(up/rs.length*100):0)+'%"></i></span>';b.onclick=()=>{st.tab=g.id;st.q="";$("tblFilter").value="";save();renderAll();};box.append(b);if(g.id==="nordic")box.append(powerTab());});}
function powerTab(){const b=document.createElement("button");b.type="button";b.className="tbl-tab tab-power"+(st.tab===POWER?" is-on":"");b.setAttribute("role","tab");b.setAttribute("aria-selected",st.tab===POWER);
 b.innerHTML='<span>Nordic Power</span><span class="breadth pw-tabbar" title="Day-ahead prices, forwards, hydro"><i></i></span>';b.onclick=()=>{st.tab=POWER;save();renderAll();};return b;}
function renderMovers(rs){const box=$("tblMovers");const ok=rs.filter(r=>!r.error&&r.kind!=="yield"&&r.pct&&isNum(r.pct["1D"]));const uniq=[...new Map(ok.map(r=>[r.sym,r])).values()];
 if(!uniq.length){box.replaceChildren();return;}const s=uniq.slice().sort((a,b)=>b.pct["1D"]-a.pct["1D"]);const best=s[0],worst=s[s.length-1];
 const spikes=[...new Map(rs.filter(r=>r.vol&&r.vol.r20>1.5).map(r=>[r.sym,r])).values()].sort((a,b)=>b.vol.r20-a.vol.r20).slice(0,3);
 const above=uniq.filter(r=>r.ma&&r.ma["200"]).length?Math.round(uniq.filter(r=>r.ma&&r.ma["200"]&&r.ma["200"].pct>=0).length/uniq.filter(r=>r.ma&&r.ma["200"]).length*100):null;
 const pill=(lab,r,txt,cls)=>'<button type="button" class="mover '+cls+'" data-sym="'+esc(r.sym)+'"><span class="ml">'+lab+'</span><b>'+esc(r.name)+'</b> '+txt+'</button>';
 let h=pill("Top",best,fpct(best.pct["1D"]),"up")+(worst!==best?pill("Bottom",worst,fpct(worst.pct["1D"]),"dn"):"");
 spikes.forEach(r=>h+=pill("Vol spike",r,r.vol.r20.toFixed(1)+"x 20d","hot"));
 if(above!=null)h+='<span class="mover static"><span class="ml">Above 200d</span><b>'+above+'%</b> of names</span>';
 box.innerHTML=h;box.querySelectorAll("button[data-sym]").forEach(b=>b.onclick=()=>{const r=rs.find(x=>x.sym===b.dataset.sym);r&&openChart(r);});}
const gsMark=(h,c)=>c.gs?h.replace('class="','class="gs '):h;
function renderTable(){const tbl=$("tbl");const g=DATA.groups.find(x=>x.id===st.tab)||DATA.groups[0];st.tab=g.id;const all=g.sections.flatMap(s=>s.rows);const S=scales(all);
 const q=st.q.trim().toLowerCase();
 const V=COLS.filter(c=>{
  if(c.g==="price")return showPrice();
  if(c.g==="vol"||c.g==="ma")return showVolMa();
  return true;
 });
 V.forEach(c=>c.gs=false);GROUPS.forEach(([id])=>{if(!id)return;const f=V.find(c=>c.g===id);if(f)f.gs=true;});
 let head='<thead><tr class="grp">';GROUPS.forEach(([id,l])=>{const n=V.filter(c=>c.g===id).length;if(!n)return;head+='<th scope="colgroup" class="g-'+(id||"name")+(id?" gs":"")+'" colspan="'+n+'"><span class="gl">'+esc(l)+'</span></th>';});
 head+='</tr><tr class="cols">';V.forEach(c=>{const on=st.sort===c.k;head+=gsMark('<th scope="col" class="'+(c.cls||"num")+(c.g?" g-"+c.g:"")+(on?" sorted":"")+'" data-k="'+c.k+'"'+(c.t?' title="'+esc(c.t)+'"':"")+' aria-sort="'+(on?(st.dir>0?"ascending":"descending"):"none")+'"><button type="button">'+esc(c.l)+'<span class="arrow">'+(on?(st.dir>0?"▲":"▼"):"")+'</span></button></th>',c);});
 head+='</tr></thead>';let body="";
 g.sections.forEach(sec=>{let rs=sec.rows;if(q)rs=rs.filter(r=>(r.name+" "+r.sym+" "+(r.ccy||"")).toLowerCase().includes(q));if(!rs.length)return;const sl=secLab(sec);
  if(sl.label)body+='<tbody class="sec"><tr class="sec-row"><th scope="rowgroup" class="c-name sec-name" title="'+esc(sl.note||"")+'">'+esc(sl.label)+'</th><td colspan="'+(V.length-1)+'" class="sec-note"><span class="sec-note-txt">'+esc(sl.note||"")+'</span></td></tr></tbody>';
  body+='<tbody class="rows">'+sortRows(rs).map(r=>'<tr data-sym="'+esc(r.sym)+'" tabindex="0"'+(r.error?' class="err"':"")+'>'+V.map(c=>gsMark(cell(c,r,S),c)).join("")+"</tr>").join("")+"</tbody>";});
 tbl.innerHTML=head+(body||'<tbody><tr><td class="empty" colspan="'+V.length+'">No matches</td></tr></tbody>');
 tbl.classList.remove("is-compact");
 tbl.querySelectorAll("thead th[data-k]").forEach(th=>th.querySelector("button").onclick=()=>{const k=th.dataset.k;const asc=k==="name";if(st.sort!==k){st.sort=k;st.dir=asc?1:-1;}else if((st.dir===-1&&!asc)||(st.dir===1&&asc))st.dir*=-1;else{st.sort=null;}save();renderTable();});
 const open=tr=>{const r=all.find(x=>x.sym===tr.dataset.sym);r&&openChart(r);};
 const pick=(tr,e)=>{const r=all.find(x=>x.sym===tr.dataset.sym);if(!r)return;if(e&&e.target.closest&&e.target.closest("th.has-co")&&isCo(r)){window.MMCompany.open(r.sym);return;}openChart(r);};
 tbl.querySelectorAll("tbody tr[data-sym]").forEach(tr=>{tr.onclick=e=>pick(tr,e);tr.onkeydown=e=>{if(e.key==="Enter"&&e.target===tr)open(tr);};});
 renderMovers(all);
 const futs=all.some(r=>r.roll);const fxN=DATA.fx_asof?(" Cap/EV in EUR (FX as of "+DATA.fx_asof+")."):" ";
 $("tblFoot").innerHTML='Prices delayed ~15 min (Yahoo). Price returns from daily closes (not total return).'+fxN+(futs?' † Continuous front-month futures: long-horizon (esp. 10Y) figures include roll effects.':"")+(st.tab==="rates"?" Yield rows show changes and MA distance in basis points.":"")+' n/a = not available from source or not enough history. Click a company name for its profile (valuation, consensus, financials); click elsewhere in the row for its chart.';}
function renderStamp(){const el=$("tblStamp");if(!DATA){el.textContent="";return;}const d=new Date(DATA.generated_utc);el.innerHTML='<span class="stamp-dot"></span>Data updated <b>'+esc(gf.format(d))+'</b> Geneva · '+esc(ago(DATA.generated_utc))+(DATA.errors&&DATA.errors.length?' · <span title="'+esc(DATA.errors.map(e=>e.sym+": "+e.error).join("\n"))+'">'+DATA.errors.length+' missing</span>':"");$("footStamp").textContent="Table data updated "+gf.format(d)+" Geneva.";$("exAsOf").textContent=gf.format(d)+" Geneva";const fxEl=$("exFxAsOf");if(fxEl)fxEl.textContent=DATA.fx_asof||"n/a";}
function renderNews(){const box=$("newsList"),hd=$("newsTitle"),meta=$("newsMeta");const g=DATA&&DATA.groups.find(x=>x.id===st.tab);hd.textContent="News · "+(st.tab===POWER?"Nordic Power":g?g.label:"");
 if(!NEWS){box.innerHTML='<li class="news-empty">News not available yet.</li>';meta.textContent="";return;}
 const items=(NEWS.tabs&&NEWS.tabs[st.tab])||[];meta.textContent="Updated "+gf.format(new Date(NEWS.generated_utc))+" Geneva";
 if(!items.length){box.innerHTML='<li class="news-empty">No recent headlines.</li>';return;}
 box.innerHTML=items.map(it=>{const u=/^https?:\/\//i.test(it.url)?it.url:"#";return'<li class="news-item'+(it.kind==="exchange"?" ex":"")+'"><time datetime="'+esc(it.time)+'">'+esc(gfs.format(new Date(it.time)))+'</time><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(it.title)+'</a><span class="src">'+(it.kind==="exchange"?'<span class="badge">Exchange</span>':"")+esc(it.source)+'</span></li>';}).join("");}
function renderAll(){const pw=st.tab===POWER;document.body.classList.toggle("is-power",pw);renderTabs();renderStamp();if(pw){window.MMPower&&window.MMPower.show();}else{window.MMPower&&window.MMPower.hide();if(DATA)renderTable();}renderNews();
 const pb=$("priceModeBtn"),vb=$("volMaModeBtn");
 if(pb&&vb){pb.classList.toggle("is-on",showPrice());vb.classList.toggle("is-on",showVolMa());
  pb.setAttribute("aria-pressed",showPrice());vb.setAttribute("aria-pressed",showVolMa());}}

/* ---------- chart modal ---------- */
function yahooUrl(s){return"https://finance.yahoo.com/quote/"+encodeURIComponent(s);}
function bigChart(r){const p=r.spark;if(!p||p.length<2)return'<p class="fallback-msg">No price history available.</p>';const w=600,h=220;let mn=Math.min(...p),mx=Math.max(...p);if(mx===mn)mx=mn+1;
 const d=p.map((v,i)=>(i?"L":"M")+((i/(p.length-1))*w).toFixed(1)+" "+(h-8-((v-mn)/(mx-mn))*(h-16)).toFixed(1)).join("");const c=p[p.length-1]>=p[0]?"var(--good)":"var(--bad)";
 return'<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" class="fallback-svg"><path d="'+d+'L'+w+' '+h+'L0 '+h+'Z" fill="'+c+'" opacity=".12"/><path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="fallback-axis"><span>'+esc(r.spark_from||"")+'</span><span>hi '+fpx(mx,r.kind)+' · lo '+fpx(mn,r.kind)+'</span><span>'+esc(r.bar_date||"")+'</span></div>';}
/* TradingView's embeddable widget refuses Cboe Treasury yields (TVC:US*) with an "only available on TradingView" popup,
   so yield rows open the Yahoo 1Y line straight away; the TradingView button still links to the full chart. */
const noWidget=r=>r.kind==="yield"||/^TVC:US\d/.test(r.tv||"");
function openChart(r){const m=$("chartModal");const y=noWidget(r);$("cmTitle").textContent=r.name;$("cmMeta").textContent=[r.tv||"no TradingView mapping",r.sym,r.ccy].filter(Boolean).join(" · ");
 $("cmTv").href=r.tv?"https://www.tradingview.com/chart/?symbol="+encodeURIComponent(r.tv):"https://www.tradingview.com/";$("cmYahoo").href=yahooUrl(r.sym);
 $("cmFallback").innerHTML='<div class="fallback-head">'+(y?"1Y daily closes (Yahoo, %). Treasury yields can't be embedded from TradingView; use TradingView ↗ for the interactive chart.":"1Y daily closes (Yahoo) — shown when the TradingView widget is unavailable for this symbol")+'</div>'+bigChart(r);
 m.hidden=false;document.body.classList.add("modal-open");$("cmClose").focus();
 const fb=$("cmFallback"),sb=$("cmSimple");
 if(r.tv&&!y&&window.MM&&window.MM.openChart){fb.hidden=true;sb.classList.remove("is-on");sb.disabled=false;sb.title="Toggle a simple 1Y line from the table data";window.MM.openChart(r.name,r.tv);setTimeout(()=>{if(!window.TradingView)fb.hidden=false;},5000);}
 else{fb.hidden=false;sb.classList.add("is-on");sb.disabled=true;sb.title=y?"Yields show the Yahoo 1Y line (no embeddable TradingView chart)":"No TradingView mapping: Yahoo 1Y line only";window.MM&&window.MM.clearChart&&window.MM.clearChart();const s=$("status_tablechart");if(s)s.hidden=true;$("chart_tablechart").replaceChildren();}}
function closeChart(){$("chartModal").hidden=true;document.body.classList.remove("modal-open");$("chart_tablechart").replaceChildren();}

/* ---------- load ---------- */
async function getJSON(u){const r=await fetch(u+(u.includes("?")?"&":"?")+"t="+Math.floor(Date.now()/6e4),{cache:"no-cache"});if(!r.ok)throw Error(u+": HTTP "+r.status);return r.json();}
async function load(){const tbl=$("tbl");if(!DATA)tbl.innerHTML='<tbody><tr><td class="empty">Loading market data…</td></tr></tbody>';
 const[a,b]=await Promise.allSettled([getJSON("data/market.json"),getJSON("data/news.json")]);
 if(a.status==="fulfilled")DATA=a.value;else if(!DATA)tbl.innerHTML='<tbody><tr><td class="empty">Could not load data/market.json ('+esc(a.reason&&a.reason.message)+'). If you opened the file directly, serve the folder over HTTP.</td></tr></tbody>';
 if(b.status==="fulfilled")NEWS=b.value;
 if(DATA&&st.tab!==POWER&&!DATA.groups.some(g=>g.id===st.tab))st.tab=DATA.groups[0].id;if(st.sort&&!val[st.sort])st.sort=null;renderAll();window.MMCompany&&window.MMCompany.ready();}
$("priceModeBtn").onclick=()=>{st.mode="price";save();renderAll();};
$("volMaModeBtn").onclick=()=>{st.mode="volma";save();renderAll();};
{const ex=$("explain");ex.open=st.explain==null?!NARROW.matches:st.explain;ex.addEventListener("toggle",()=>{st.explain=ex.open;save();});}
let ft;$("tblFilter").addEventListener("input",e=>{clearTimeout(ft);ft=setTimeout(()=>{st.q=e.target.value;renderTable();},120);});
$("cmClose").onclick=closeChart;$("cmSimple").onclick=()=>{const f=$("cmFallback");f.hidden=!f.hidden;$("cmSimple").classList.toggle("is-on",!f.hidden);};$("chartModal").addEventListener("click",e=>{if(e.target.id==="chartModal")closeChart();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("chartModal").hidden)closeChart();});
setInterval(()=>DATA&&renderStamp(),60000);
window.MMTable={data:()=>DATA,news:()=>NEWS,openChart:r=>openChart(r),reload:()=>{if(st.tab===POWER&&window.MMPower)window.MMPower.reload();return load();}};
load();
})();
