/* Company page: lean index data/companies.json (loaded at idle) + per-company detail data/co/<SYM>.json (loaded when
   a company opens). Opens from an equity name in the Table; URL hash #co=SYMBOL[&tab=fin|analysts|own|mgmt] makes it
   shareable and back-button friendly. Tabs: Overview · Financials · Analysts · Ownership & insiders · Management.
   Real data only: anything missing says so ("Not available for this listing") rather than inventing values. */
(()=>{"use strict";
const TZ="Europe/Zurich";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isNum=v=>typeof v==="number"&&isFinite(v);
const DASH='<span class="co-na">—</span>';
const PHONE=matchMedia("(max-width:760px)");
const RM=matchMedia("(prefers-reduced-motion: reduce)");
const SEP=f=>({format:d=>f.format(d).replace(/\bSept\b/,"Sep")});/* en-GB says "Sept"; site style is "Sep" */
const df=SEP(new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric",month:"short",year:"numeric"}));
const dfs=SEP(new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}));
const mf=SEP(new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",month:"short",year:"2-digit"}));
const mfl=SEP(new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",month:"short",year:"numeric"}));
const TABS=[["overview","Overview"],["fin","Financials"],["analysts","Analysts"],["own","Ownership & insiders","Ownership"],["mgmt","Management"]];
const NA_LISTING="Not available for this listing";
let CO=null,coP=null,cur=null,lastFocus=null,pushed=false,closing=0,finMode="annual",finStmt="is",chartMode=null,tab="overview";
const DET={},detP={},MORE=new Set();

/* ---------- formatting ---------- */
function dp(v){const a=Math.abs(v);if(a>=10000)return 0;if(a>=1000)return 1;if(a>=1)return 2;if(a>=0.1)return 3;return 4;}
function fpx(v){return isNum(v)?v.toLocaleString("en-US",{minimumFractionDigits:dp(v),maximumFractionDigits:dp(v)}).replace(/^-/,"−"):DASH;}
function feps(v){if(!isNum(v))return DASH;const a=Math.abs(v),d=a>=100?0:a>=1?2:3;return sign(v)+a.toFixed(d);}
const sign=v=>v<0?"−":"";
function big(v){if(!isNum(v))return DASH;const a=Math.abs(v),s=sign(v);
 if(a>=1e12)return s+(a/1e12).toFixed(2)+"tn";if(a>=1e9)return s+(a/1e9).toFixed(a>=1e11?0:a>=1e10?1:2)+"bn";
 if(a>=1e6)return s+(a/1e6).toFixed(a>=1e8?0:a>=1e7?1:2)+"m";if(a>=1e3)return s+(a/1e3).toFixed(a>=1e5?0:1)+"k";return s+a.toFixed(a>=100||a===Math.round(a)?0:1);}
function pct(v,d){if(!isNum(v))return DASH;const a=Math.abs(v);return(v>0?"+":v<0?"−":"")+a.toFixed(d==null?(a>=100?0:1):d)+"%";}
function pctU(v,d){if(!isNum(v))return DASH;return sign(v)+Math.abs(v).toFixed(d==null?(Math.abs(v)>=100?0:1):d)+"%";}
function mult(v){return isNum(v)?v.toFixed(v>=100?0:1)+"×":DASH;}
function dateTxt(iso){if(!iso)return null;const d=new Date(String(iso).slice(0,10)+"T12:00:00Z");return isNaN(d)?null:df.format(d);}
function dateCell(iso){const t=dateTxt(iso);return t?esc(t):DASH;}
function daysTo(iso){const d=new Date(iso+"T12:00:00Z");return Math.round((d-Date.now())/864e5);}
const ccyLab=c=>c==="GBp"?"GBp":c||"";
const majorCcy=c=>({GBp:"GBP",GBX:"GBP",ILA:"ILS",ZAc:"ZAR"})[c]||c||"";
const pxUnit=c=>c==="GBp"?"GBp (pence)":c||"";
const fyLab=d=>"FY"+String(d||"").slice(2,4);
const qLab=d=>mf.format(new Date(d+"T00:00:00Z")).replace(" ","\u00a0\u2019");
const titleCase=s=>String(s||"").toLowerCase().replace(/\b([a-z])/g,m=>m.toUpperCase());
/* "Lundin (Jack Oliver)" -> "Jack Oliver Lundin"; all-caps filer names -> title case */
function personName(n){n=String(n||"").trim();const m=n.match(/^([^()]+)\s+\(([^)]+)\)$/);if(m)n=m[2]+" "+m[1];return n===n.toUpperCase()&&/[A-Z]{3}/.test(n)?titleCase(n):n;}

/* ---------- data ---------- */
function loadCo(){if(CO)return Promise.resolve(CO);if(coP)return coP;
 coP=fetch("data/companies.json?t="+Math.floor(Date.now()/6e4),{cache:"no-cache"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json();}).then(j=>(CO=j)).catch(e=>{coP=null;throw e;});return coP;}
function loadDet(sym){if(DET[sym])return Promise.resolve(DET[sym]);if(detP[sym])return detP[sym];const c=CO&&CO.companies&&CO.companies[sym];
 if(!c||!c.detail)return Promise.resolve(null);
 detP[sym]=fetch("data/co/"+encodeURIComponent(c.detail)+"?v="+encodeURIComponent(CO.generated_utc||""),{cache:"default"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json();})
  .then(j=>(DET[sym]=j)).catch(e=>{delete detP[sym];throw e;});return detP[sym];}
function tableRow(sym){const d=window.MMTable&&window.MMTable.data&&window.MMTable.data();if(!d)return null;
 for(const g of d.groups)for(const s of g.sections)for(const r of s.rows)if(r.sym===sym)return r;return null;}
const norm=s=>String(s||"").toLowerCase().replace(/ø/g,"o").replace(/æ/g,"ae").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const ALIAS={"CLOUD.OL":"cloudberry","SCATC.OL":"scatec","EOLU-B.ST":"eolus","ORRON.ST":"orron","MGN.OL":"magnora","ORSTED.CO":"orsted",
 "VWS.CO":"vestas","FORTUM.HE":"fortum","EDPR.LS":"edp renovaveis|\\bedpr\\b","ANE.MC":"acciona energ","SLR.MC":"solaria","GRE.MC":"grenergy",
 "ERG.MI":"\\berg\\b","VLTSA.PA":"voltalia","NDX1.DE":"nordex","EQNR.OL":"equinor","AKER.OL":"aker asa","BONHR.OL":"bonheur|fred\\.? olsen",
 "VER.VI":"verbund","TTE.PA":"totalenergies","BEP":"brookfield renewable","EQT.ST":"\\beqt ab\\b","KKR":"\\bkkr\\b","SHEL.L":"\\bshell\\b",
 "BP.L":"\\bbp\\b","XOM":"exxon","COP":"conocophillips","CNQ.TO":"canadian natural","AKRBP.OL":"aker bp","VAR.OL":"var energi",
 "HBR.L":"harbour energy","TOU.TO":"tourmaline","IPCO.TO":"international petroleum|\\bipc\\b","LUN.TO":"lundin mining","LUG.TO":"lundin gold",
 "NGEX.TO":"ngex","LUC.TO":"lucara","MAU.TO":"montage gold","LUNR.TO":"\\blunr\\b","SNM.OL":"shamaran","BHP.L":"\\bbhp\\b","RIO.L":"rio tinto",
 "GLEN.L":"glencore","AAL.L":"anglo american","ANTO.L":"antofagasta","FCX":"freeport","FM.TO":"first quantum","TECK-B.TO":"\\bteck\\b",
 "BOL.ST":"boliden","NHY.OL":"norsk hydro","NEM":"newmont","B":"barrick","AEM":"agnico","CCJ":"cameco"};
const cleanName=n=>String(n||"").replace(/\s+(A|B|AB|ASA|plc|PLC|Inc\.?|Corp\.?|Ltd\.?|SA|SE|NV)$/,"").trim();
function newsFor(sym,name){const N=window.MMTable&&window.MMTable.news&&window.MMTable.news();if(!N||!N.tabs)return[];
 let re;try{re=new RegExp(ALIAS[sym]||("\\b"+norm(cleanName(name)).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b"),"i");}catch(e){return[];}
 const seen=new Set(),out=[];
 Object.values(N.tabs).flat().forEach(it=>{if(!it||!it.title)return;const k=norm(it.title).replace(/\W+/g," ").trim();if(seen.has(k))return;
  if(re.test(norm(it.title))||(it.topic&&norm(it.topic)===norm(name))){seen.add(k);out.push(it);}});
 return out.sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,6);}

/* ---------- building blocks ---------- */
const sec=(id,title,body,extra,sub)=>'<section class="co-sec" id="'+id+'"><div class="co-sec-head"><div><h3>'+esc(title)+'</h3>'+(sub?'<span class="co-sec-sub">'+sub+'</span>':"")+'</div>'+(extra||"")+'</div>'+body+'</section>';
/* empty state: always says "Not available for this listing", plus the specific reason when there is one */
const empty=t=>{const r=t?String(t).replace(/ for this listing/g,"").replace(/^Not available\.?\s*/,""):"";return'<p class="co-empty"><b>'+NA_LISTING+'</b>'+(r?'<span>'+esc(r)+'</span>':"")+'</p>';};
const failMsg=t=>'<p class="co-empty"><span>'+esc(t)+'</span></p>';
const fine=t=>'<p class="co-fine">'+t+'</p>';
const seg=(attr,opts,on,label)=>'<div class="seg co-seg" role="group" aria-label="'+esc(label)+'">'+opts.map(([v,l])=>'<button class="button'+(v===on?" is-on":"")+'" type="button" data-'+attr+'="'+v+'" aria-pressed="'+(v===on)+'">'+esc(l)+'</button>').join("")+'</div>';
function moreBtn(key,n,shown){if(n<=shown)return"";const open=MORE.has(key);return'<button class="co-showall" type="button" data-more="'+key+'" aria-expanded="'+open+'">'+(open?"Show fewer":"Show all "+n)+'</button>';}
const limit=(key,arr,n)=>MORE.has(key)?arr:arr.slice(0,n||5);
function tile(l,v,sub,tip){return'<div class="co-tile"'+(tip?' title="'+esc(tip)+'"':"")+'><span class="co-tl">'+esc(l)+'</span><span class="co-tv-val">'+v+'</span>'+(sub?'<span class="co-ts">'+sub+'</span>':"")+'</div>';}
const NA_KV='<span class="co-na" title="'+NA_LISTING+'">Not available</span>';
const kv=rows=>'<dl class="co-kv">'+rows.filter(Boolean).map(([l,v,tip])=>'<div'+(tip?' title="'+esc(tip)+'"':"")+'><dt>'+esc(l)+'</dt><dd>'+(v===DASH||v==null||v===""?NA_KV:v)+'</dd></div>').join("")+'</dl>';
const link=(u,t)=>/^https?:\/\//i.test(u||"")?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(t)+' ↗</a>':"";
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,"");}catch(e){return u||"";}};
const goTab=(t,l)=>'<button class="co-jump" type="button" data-tab-go="'+t+'">'+esc(l)+' →</button>';

/* horizontal range bar with markers (52-week range, analyst targets) */
function rangeBar(lo,hi,marks,labLo,labHi,aria){if(!isNum(lo)||!isNum(hi)||hi<=lo)return"";
 const vals=[lo,hi].concat(marks.filter(m=>isNum(m.v)).map(m=>m.v));const a=Math.min(...vals),b=Math.max(...vals),pos=x=>((x-a)/(b-a)*100).toFixed(1)+"%";
 return'<div class="co-range" role="img" aria-label="'+esc(aria)+'"><div class="co-range-track"><span class="co-range-band" style="left:'+pos(lo)+';right:calc(100% - '+pos(hi)+')"></span>'+
  marks.filter(m=>isNum(m.v)).map(m=>'<span class="co-range-'+m.k+'" style="left:'+pos(m.v)+'" title="'+esc(m.t)+'"></span>').join("")+'</div>'+
  '<div class="co-range-lab"><span>'+labLo+'</span><span class="co-range-key">'+marks.filter(m=>isNum(m.v)).map(m=>'<i class="k-'+m.k+'"></i>'+esc(m.l)).join(" ")+'</span><span>'+labHi+'</span></div></div>';}

/* responsive grouped bar chart (HTML/CSS, so text stays crisp at any width) */
function niceStep(range,n){const raw=range/n,p=Math.pow(10,Math.floor(Math.log10(raw)));const f=raw/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
/* chart caption, same convention as the Power tab: title = what + where, unit after " · ", subtitle = period · resolution · source */
function figcap(t,u,sub){return'<figcaption><span class="co-fig-t">'+esc(t)+(u?'<span class="co-fig-u"> · '+esc(u)+'</span>':"")+'</span>'+(sub?'<span class="co-fig-sub">'+esc(sub)+'</span>':"")+'</figcaption>';}
const SRC="Yahoo Finance";
function barChart(o){/* o: {title, ccy, scale:true|false, unit, labels, series:[{name,cls,vals}], tips} */
 const all=o.series.flatMap(s=>s.vals).filter(isNum);if(!all.length)return"";
 let div=1,uLab=o.unit||"";if(o.scale){const m=Math.max(...all.map(Math.abs));if(m>=1e9){div=1e9;uLab=o.ccy+" bn";}else if(m>=1e6){div=1e6;uLab=o.ccy+" m";}else if(m>=1e3){div=1e3;uLab=o.ccy+" k";}else uLab=o.ccy;}
 const vs=all.map(v=>v/div);let mn=Math.min(0,...vs),mx=Math.max(0,...vs);if(mx===mn)mx=mn+1;
 const step=niceStep(mx-mn,4);mn=Math.floor(mn/step+1e-9)*step;mx=Math.ceil(mx/step-1e-9)*step;if(mx===mn)mx=mn+step;
 const y=v=>((v-mn)/(mx-mn)*100),z=y(0),ticks=[];for(let t=mn;t<=mx+step/2;t+=step)ticks.push(t);
 const tf=t=>{const a=Math.abs(t);return sign(t)+(a>=100||a===0||Math.abs(a-Math.round(a))<1e-9?Math.round(a).toLocaleString("en-US"):a.toFixed(a>=10?1:2));};
 const grid=ticks.map(t=>'<div class="co-bc-tick'+(Math.abs(t)<1e-12?" is-zero":"")+'" style="bottom:'+y(t).toFixed(2)+'%"><span>'+tf(t)+'</span></div>').join("");
 const ns=o.series.length,bw=100/ns;
 const cols=o.labels.map((l,i)=>'<div class="co-bc-col"><div class="co-bc-bars">'+o.series.map((s,j)=>{const v=s.vals[i];if(!isNum(v))return"";const vv=v/div;const b=Math.min(y(vv),z),h=Math.abs(y(vv)-z);
   return'<span class="co-bc-bar '+s.cls+(v<0?" is-neg":"")+'" style="left:calc('+(j*bw).toFixed(2)+'% + 1px);width:calc('+bw.toFixed(2)+'% - 2px);bottom:'+b.toFixed(2)+'%;height:'+Math.max(h,0.6).toFixed(2)+'%" title="'+esc(s.name+" · "+l+": "+(o.fmt?o.fmt(v):big(v))+" "+(o.scale?o.ccy:uLab))+'"></span>';}).join("")+'</div><span class="co-bc-x">'+esc(l)+'</span></div>').join("");
 const legend=o.series.length>1?'<div class="co-legend">'+o.series.map(s=>'<span><i class="'+s.cls+'"></i>'+esc(s.name)+'</span>').join("")+'</div>':"";
 return'<figure class="co-fig">'+figcap(o.title,uLab,o.sub)+legend+'<div class="co-bc" role="img" aria-label="'+esc(o.title+(uLab?", "+uLab:"")+(o.sub?". "+o.sub:""))+'"><div class="co-bc-unit">'+esc(uLab)+'</div><div class="co-bc-plot">'+grid+'<div class="co-bc-cols">'+cols+'</div></div></div></figure>';}

/* ---------- header + tabs ---------- */
function head(c,r){const name=(r&&r.name)||(c&&c.name)||cur;const px=r&&isNum(r.px)?r.px:c&&c.px;const ccy=(c&&c.ccy)||(r&&r.ccy);
 const d1=r&&r.pct&&isNum(r.pct["1D"])?r.pct["1D"]:c&&c.chg_pct;const exch=(c&&c.exch)||(r&&r.exch)||"";const p=(c&&c.profile)||{};
 const tags=[p.sector,p.industry,p.country].filter(Boolean).map(t=>'<span class="co-tag">'+esc(t)+'</span>').join("");
 $("coName").textContent=name;
 $("coSub").textContent=[cur,exch,(c&&c.long_name&&norm(c.long_name)!==norm(name))?c.long_name:null].filter(Boolean).join(" · ");
 $("coQuote").innerHTML='<span class="co-px">'+fpx(px)+'</span><span class="co-ccy">'+esc(ccyLab(ccy))+'</span>'+(isNum(d1)?'<span class="co-chg '+(d1>0?"up":d1<0?"dn":"")+'">'+pct(d1,2)+'</span>':"")+
  (()=>{const q=r&&window.MMTable&&window.MMTable.quoteLabel&&window.MMTable.quoteLabel(r);return q?'<span class="co-asof" title="'+esc(q.tip)+'">'+esc(q.txt)+'</span>':r&&r.bar_date?'<span class="co-asof">close '+esc(dateTxt(r.bar_date)||r.bar_date)+'</span>':"";})();
 $("coTags").innerHTML=tags;$("coTags").hidden=!tags;
 $("coYahoo").href="https://finance.yahoo.com/quote/"+encodeURIComponent(cur);
 $("coChartBtn").hidden=!r;renderTabs();}
function tabsEl(){let t=$("coTabs");if(!t){t=document.createElement("nav");t.id="coTabs";t.className="co-tabs";t.setAttribute("role","tablist");t.setAttribute("aria-label","Company page sections");$("coHead").appendChild(t);
  t.addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(b)setTab(b.dataset.tab,true);});
  t.addEventListener("keydown",e=>{if(!/^Arrow(Left|Right)$|^Home$|^End$/.test(e.key))return;e.preventDefault();const i=TABS.findIndex(x=>x[0]===tab);
   const j=e.key==="Home"?0:e.key==="End"?TABS.length-1:(i+(e.key==="ArrowRight"?1:-1)+TABS.length)%TABS.length;setTab(TABS[j][0],true);const b=t.querySelector('[data-tab="'+TABS[j][0]+'"]');b&&b.focus();});}
 return t;}
function renderTabs(){const t=tabsEl();t.innerHTML=TABS.map(([id,l,sl])=>'<button type="button" role="tab" class="co-tab'+(id===tab?" is-on":"")+'" id="coTab-'+id+'" data-tab="'+id+'" aria-selected="'+(id===tab)+'" aria-controls="coBody" tabindex="'+(id===tab?0:-1)+'"'+(sl?' aria-label="'+esc(l)+'"':"")+'>'+(sl?'<span class="co-hide-xs">'+esc(l)+'</span><span class="co-show-xs">'+esc(sl)+'</span>':esc(l))+'</button>').join("");
 const on=t.querySelector(".is-on");if(on&&on.scrollIntoView&&t.scrollWidth>t.clientWidth){const L=on.offsetLeft,R=L+on.offsetWidth;if(L<t.scrollLeft||R>t.scrollLeft+t.clientWidth)t.scrollLeft=L-24;}}
function setTab(t,user){if(!TABS.some(x=>x[0]===t))t="overview";if(t===tab&&user)return;tab=t;
 if(cur&&/^#co=/.test(location.hash))history.replaceState(history.state,"","#co="+encodeURIComponent(cur)+(t!=="overview"?"&tab="+t:""));
 render();$("coBody").scrollTop=0;}

/* ---------- Overview ---------- */
function lineChart(r){const p=r&&r.spark;if(!p||p.length<2)return'<div class="co-chart-empty">No price history available.</div>';
 const w=600,h=200;let mn=Math.min(...p),mx=Math.max(...p);const lo=mn,hi=mx;if(mx===mn)mx=mn+1;
 const pts=p.map((v,i)=>[(i/(p.length-1))*w,h-10-((v-mn)/(mx-mn))*(h-24)]);const d=pts.map((q,i)=>(i?"L":"M")+q[0].toFixed(1)+" "+q[1].toFixed(1)).join("");
 const up=p[p.length-1]>=p[0],c=up?"var(--good)":"var(--bad)";const chg=r.pct&&isNum(r.pct["1Y"])?r.pct["1Y"]:(p[p.length-1]/p[0]-1)*100;/* same 1Y figure as the table */
 return'<div class="co-line"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="1-year price line, daily closes, '+esc(ccyLab(r.ccy))+'"><defs><linearGradient id="coGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+c+'" stop-opacity=".28"/><stop offset="1" stop-color="'+c+'" stop-opacity="0"/></linearGradient></defs>'+
  '<path d="'+d+'L'+w+' '+h+'L0 '+h+'Z" fill="url(#coGrad)"/><path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'+
  '<div class="co-line-axis"><span>'+esc(dateTxt(r.spark_from)||"")+'</span><span>1Y '+pct(chg)+' · hi '+fpx(hi)+' · lo '+fpx(lo)+(r.ccy?' '+esc(ccyLab(r.ccy)):"")+'</span><span>'+esc(dateTxt(r.bar_date)||"")+'</span></div></div>';}
function chartSec(r){const tv=r&&r.tv;const sg=tv?'<div class="seg co-seg" role="group" aria-label="Chart type"><button class="button" type="button" data-chart="line">1Y line</button><button class="button" type="button" data-chart="tv">Interactive</button></div>':"";
 return sec("coChartSec","Price",'<div class="co-chart" id="coChart"></div>',sg,r&&r.ccy?esc(pxUnit(r.ccy))+(r.exch?" · "+esc(r.exch):""):"");}
function drawChart(r){const box=$("coChart");if(!box)return;const tv=r&&r.tv;if(!chartMode)chartMode=tv&&!PHONE.matches?"tv":"line";if(!tv)chartMode="line";
 document.querySelectorAll("#coChartSec [data-chart]").forEach(b=>{const on=b.dataset.chart===chartMode;b.classList.toggle("is-on",on);b.setAttribute("aria-pressed",on);});
 if(chartMode==="line"||!window.MM||!window.MM.embed){box.innerHTML=lineChart(r);return;}
 box.innerHTML='<div class="co-tv" id="coTv"></div><div class="co-chart-status" id="coTvStatus">Loading chart…</div>';const want=cur;
 window.MM.embed("coTv",tv,r&&r.name).then(()=>{const s=$("coTvStatus");setTimeout(()=>s&&s.remove(),1200);}).catch(()=>{if(cur===want&&chartMode==="tv"&&$("coChart")===box){box.innerHTML=lineChart(r)+'<p class="co-fine">Interactive chart unavailable ('+(window.MM.selfDrawn&&window.MM.selfDrawn(tv)?"TradingView doesn't embed this exchange and the backup price feed failed":"TradingView blocked or offline")+'); showing the 1Y line from Yahoo closes.</p>';}});}

function valuation(c,r){let v=c&&c.val;if(!v)return sec("coVal","Valuation",empty("No valuation data from Yahoo for this listing."));
 /* same build, same method: show the Table's market cap / EV so both views always agree */
 if(r&&isNum(r.mcap)&&(r.mcap_ccy||r.ccy)===c.ccy){v=Object.assign({},v,{mcap:r.mcap,mcap_eur:isNum(r.mcap_eur)?r.mcap_eur:v.mcap_eur});
  if(r.ev_src&&isNum(r.ev))Object.assign(v,{ev:r.ev,ev_eur:isNum(r.ev_eur)?r.ev_eur:v.ev_eur,ev_src:r.ev_src});}
 const mc=majorCcy(c.ccy);const eur=x=>isNum(x)&&mc!=="EUR"?"€"+big(x):"";
 const neg=(x,flag)=>isNum(x)?mult(x):flag?'<span class="co-muted">neg.</span>':DASH;
 const yld=x=>isNum(x)?x.toFixed(Math.abs(x)>=10?1:2)+"%":DASH;
 const t=[tile("Market cap",isNum(v.mcap)?big(v.mcap)+' <small>'+esc(mc)+'</small>':DASH,eur(v.mcap_eur)),
  tile("Enterprise value",isNum(v.ev)?big(v.ev)+' <small>'+esc(mc)+'</small>':DASH,eur(v.ev_eur),v.ev_src==="calc"?"Market cap + net debt + minorities (latest balance sheet)":v.ev_src==="yahoo"?"Yahoo enterprise value":""),
  tile("P/E · TTM",neg(v.pe,v.neg_earn),"","Price / trailing 12-month earnings (Yahoo)"),
  tile("P/E · forward",mult(v.pe_fwd),"","Price / forward earnings estimate (Yahoo)"),
  tile("EV / EBITDA",neg(v.ev_ebitda,v.neg_ebitda),"TTM","EV / trailing 12-month EBITDA (reporting currency)"),
  tile("EV / Sales",mult(v.ev_rev),"TTM","EV / trailing 12-month revenue"),
  tile("P / Book",mult(v.pb),"","Market cap / latest shareholders' equity"),
  tile("Dividend yield",v.dy===0?"None":yld(v.dy),"","Forward dividend yield (Yahoo)"),
  tile("FCF yield",yld(v.fcf_y),"TTM","Trailing 12-month free cash flow / market cap"),
  tile("Cash returned",v.ret_y===0?"None":yld(v.ret_y),"TTM, div. + buybacks","Trailing 12-month dividends paid + share buybacks, as % of market cap")];
 return sec("coVal","Valuation",'<div class="co-grid co-grid-5">'+t.join("")+'</div>');}

function keyStats(c,r){const m=(c&&c.mkt)||{};const v=(c&&c.val)||{};const px=r&&isNum(r.px)?r.px:c&&c.px;const ccy=ccyLab(c&&c.ccy);
 const bar=rangeBar(m.lo52,m.hi52,[{k:"px",v:px,l:"Last",t:"Last price "+String(px)}],"Low "+fpx(m.lo52),"High "+fpx(m.hi52),"52-week price range");
 const rows=[["Shares outstanding",big(v.shares)],
  ["Free float",isNum(m.float)?big(m.float)+(isNum(m.float_pct)?' <small>'+m.float_pct.toFixed(0)+'% of shares</small>':""):DASH,"Shares available to the public (excludes large holders), per Yahoo"],
  ["Beta",isNum(m.beta)?m.beta.toFixed(2):DASH,"5-year monthly beta vs the local market (Yahoo)"],
  ["Avg daily volume",isNum(m.avg_vol)?big(m.avg_vol)+' <small>shares, 3M</small>':DASH],
  ["Short interest",isNum(m.short)?big(m.short)+(isNum(m.short_pf)?' <small>'+m.short_pf.toFixed(1)+'% of float</small>':""):'<span class="co-na">Not reported for this listing</span>',
   isNum(m.short)?"Shares sold short"+(m.short_d?" as of "+dateTxt(m.short_d):"")+(isNum(m.short_ratio)?" · "+m.short_ratio.toFixed(1)+" days to cover":"")+(isNum(m.short_prev)?" · prior month "+big(m.short_prev).replace(/<[^>]+>/g,""):""):"Yahoo reports short interest mainly for US and Canadian listings"],
  ["52-week change",pct(m.chg52)],
  ["50 / 200-day average",isNum(m.ma50)||isNum(m.ma200)?fpx(m.ma50)+" / "+fpx(m.ma200)+' <small>'+esc(ccy)+'</small>':DASH],
  ["Revenue growth",pct(m.rev_g),"Latest quarter vs the same quarter a year earlier (Yahoo)"],
  ["Earnings growth",pct(m.earn_g),"Latest quarter vs the same quarter a year earlier (Yahoo)"]];
 return sec("coStats","Key statistics",(bar?'<div class="co-sub-h">52-week range <small>'+esc(pxUnit(c&&c.ccy))+'</small></div>'+bar:"")+kv(rows));}

function glance(c,d){const k=(c&&c.cons)||{};const own=d&&d.own;const next=c&&c.dates&&c.dates.earnings&&daysTo(c.dates.earnings)>=0?c.dates.earnings:null;
 const rk=k.rating&&RATING[k.rating];
 const card=(t,body,go)=>'<div class="co-card"><span class="co-tl">'+esc(t)+'</span>'+body+(go||"")+'</div>';
 const a=k.analysts||isNum(k.target)?card("Analysts",'<b>'+(rk?esc(rk):"No rating")+'</b><small>'+(k.analysts?k.analysts+" analysts":"")+(isNum(k.upside)?' · target <span class="'+(k.upside>=0?"up":"dn")+'">'+pct(k.upside)+'</span>':"")+'</small>',goTab("analysts","Analysts")):card("Analysts",'<b class="co-na">No coverage</b><small>on Yahoo</small>');
 const e=card("Next earnings",next?'<b>'+esc(dateTxt(next))+'</b><small>'+(daysTo(next)===0?"today":"in "+daysTo(next)+" days")+(c.dates.earnings_est?" · estimated":"")+'</small>':'<b class="co-na">Not announced</b><small>&nbsp;</small>');
 const o=own&&(isNum(own.ins)||isNum(own.inst))?card("Ownership",'<b>'+(isNum(own.inst)?pctU(own.inst,own.inst<1?2:0):"—")+' <small>institutions</small></b><small>'+(isNum(own.ins)?pctU(own.ins,own.ins<1?2:0)+" insiders":"")+'</small>',goTab("own","Ownership")):
  card("Ownership",d?'<b class="co-na">Not available</b><small>for this listing</small>':'<b class="co-na">Loading…</b><small>&nbsp;</small>');
 return'<div class="co-cards">'+a+e+o+'</div>';}

function dates(c,d){const dd=c&&c.dates;if(!dd)return sec("coDates","Key dates",empty("No calendar data for this listing."));const rows=[];const ce=(d&&d.cal)||{};
 const when=iso=>{const n=daysTo(iso);return n===0?"today":n===1?"tomorrow":n>1?"in "+n+" days":"";};
 if(dd.earnings){const fut=daysTo(dd.earnings)>=0;const t=dateTxt(dd.earnings)+(dd.earnings_to&&dd.earnings_to!==dd.earnings?" – "+dateTxt(dd.earnings_to):"");
  const est=fut&&(isNum(ce.eps_avg)||isNum(ce.rev_avg))?"Consensus: "+[isNum(ce.eps_avg)?"EPS "+feps(ce.eps_avg):"",isNum(ce.rev_avg)?"revenue "+big(ce.rev_avg):""].filter(Boolean).join(", "):"";
  rows.push([fut?"Next earnings":"Last earnings",esc(t)+(dd.earnings_est?' <span class="co-pill">est.</span>':""),fut?[when(dd.earnings),est].filter(Boolean).join(" · "):"Next date not announced yet"]);}
 else rows.push(["Next earnings",DASH,"Not announced"]);
 if(dd.ex_div&&daysTo(dd.ex_div)>-400){const fut=daysTo(dd.ex_div)>=0;rows.push([fut?"Ex-dividend":"Last ex-dividend",esc(dateTxt(dd.ex_div)),fut?when(dd.ex_div):""]);}
 else rows.push(["Ex-dividend",DASH,c.val&&c.val.dy===0?"No dividend currently":""]);
 if(dd.div_pay&&daysTo(dd.div_pay)>-60)rows.push(["Dividend payment",esc(dateTxt(dd.div_pay)),daysTo(dd.div_pay)>=0?when(dd.div_pay):""]);
 if(dd.last_q)rows.push(["Latest reported period",esc(mfl.format(new Date(dd.last_q+"T00:00:00Z"))),""]);
 if(dd.fy_end)rows.push(["Fiscal year end",esc(new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",day:"numeric",month:"long"}).format(new Date(dd.fy_end+"T00:00:00Z"))),"Last: "+mfl.format(new Date(dd.fy_end+"T00:00:00Z"))]);
 return sec("coDates","Key dates",'<dl class="co-dates">'+rows.map(([l,v,s])=>'<div><dt>'+l+'</dt><dd>'+v+(s?'<small>'+esc(s)+'</small>':"")+'</dd></div>').join("")+'</dl>');}

function news(c,r){const name=(r&&r.name)||(c&&c.name)||cur;const items=newsFor(cur,name);
 const q='"'+cleanName(name)+'"';
 const g="https://news.google.com/search?q="+encodeURIComponent(q)+"&hl=en-GB&gl=GB&ceid=GB:en";
 const list=items.length?'<ul class="co-news">'+items.map(it=>{const u=/^https?:\/\//i.test(it.url)?it.url:"#";return'<li><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(it.title)+'</a><span>'+(it.kind==="exchange"?'<span class="badge">Exchange</span>':"")+esc(it.source||"")+(it.time?' · '+esc(dfs.format(new Date(it.time))):"")+'</span></li>';}).join("")+'</ul>':empty("No recent headlines for this name in the site's news feed.");
 return sec("coNews","Latest news",list+'<a class="co-more" href="'+esc(g)+'" target="_blank" rel="noopener noreferrer">Search Google News for '+esc(cleanName(name))+' ↗</a>');}

function about(c,d){const a=(d&&d.about)||{};const p=(c&&c.profile)||{};
 if(!d)return sec("coAbout","About",'<div class="co-skel"></div>');
 const long=a.summary&&a.lead&&a.summary.length>a.lead.length+40;const open=MORE.has("about");
 const txt=a.summary?'<p class="co-about">'+esc(open||!long?a.summary:a.lead)+'</p>'+(long?'<button class="co-showall" type="button" data-more="about" aria-expanded="'+open+'">'+(open?"Show less":"Read full description")+'</button>':""):empty("No company description on Yahoo for this listing.");
 const hq=[a.city,a.state,a.country].filter(Boolean).join(", ");
 const rows=[["Sector",p.sector?esc(p.sector):DASH],["Industry",p.industry?esc(p.industry):DASH],
  ["Employees",isNum(a.emp)?a.emp.toLocaleString("en-US")+' <small>full-time</small>':DASH],["Headquarters",hq?esc(hq):DASH],
  ["Website",a.web?link(a.web,host(a.web)):DASH],a.ir?["Investor relations",link(a.ir,host(a.ir))]:null,
  ["Listing",esc([cur,c&&c.exch,c&&ccyLab(c.ccy)].filter(Boolean).join(" · "))],
  ["Reporting currency",esc((c&&c.fin_ccy)||"—")]];
 return sec("coAbout","About",txt+kv(rows));}

/* ---------- deal flow (dealflow.js / data/dealflow.json) ---------- */
let dfWait=false;
function deals(){const M=window.MMDeals;if(!M)return null;if(M.peek())return M;if(!dfWait){dfWait=true;const sym=cur;
 M.load().then(()=>{dfWait=false;if(cur&&!layer().hidden){const b=$("coBody"),st=b.scrollTop;render();b.scrollTop=st;}}).catch(()=>{dfWait=false;});}return null;}
function announcements(){if(!window.MMDeals)return"";const M=deals(),T="Announcements";
 if(!M)return sec("coDeals",T,'<div class="co-skel"></div>');
 const m=M.meta();if(!M.covered(cur))return sec("coDeals",T,empty("The announcements feed covers the Renewables, Oil & Gas and Lundin Group companies."));
 const its=M.items(cur),rt=M.routineText(cur);
 const body=its.length?'<ol class="df-list">'+limit("deals",its,5).map(it=>M.itemHtml(it,{co:false})).join("")+'</ol>'+moreBtn("deals",its.length,5):failMsg("No material announcements in the last "+m.days+" days.");
 return sec("coDeals",T,body+'<p class="df-note">'+(rt?esc(rt.charAt(0).toUpperCase()+rt.slice(1))+". ":"")+'Type from fixed headline keyword rules; see “How items are chosen” under Deal flow on the Equities page.</p>',"",
  "Last "+m.days+" days · newest first · "+esc(M.source(cur))+" · Geneva time");}
const FI_K={buy:"Buy",sell:"Sell",subscription:"Subscription",grant:"Grant",exercise:"Exercise",dividend:"Dividend","gift in":"Gift received","gift out":"Gift given",pledge:"Pledge",exchange:"Exchange",internal:"Internal",inheritance:"Inheritance",loan:"Loan"};
function fiSec(c){if(!window.MMDeals)return"";const M=deals();if(!M||!M.hasFi(cur))return"";
 const rows=M.fi(cur)||[],m=M.meta(),T="Swedish insider register (FI)";
 const sub="Last "+m.fiDays+" days · transaction date · aggregated per person, day, type and instrument · Finansinspektionen";
 if(!rows.length)return sec("coFI",T,failMsg("No insider notifications to Finansinspektionen in the last "+m.fiDays+" days."),"",sub);
 const tr=limit("fi",rows,5).map(x=>'<tr><td>'+dateCell(x.d)+'</td><td class="co-name-cell">'+esc(x.p)+'<small>'+esc([x.r,x.rel?"closely associated person":""].filter(Boolean).join(" · "))+'</small></td>'+
  '<td><span class="co-act-pill k-'+(x.k==="buy"||x.k==="sell"?x.k:"other")+'">'+esc(FI_K[x.k]||x.k)+'</span><small class="co-fi-i">'+esc(x.i||"")+'</small></td>'+
  '<td class="r">'+big(x.v)+'</td><td class="r co-hide-xs">'+(isNum(x.px)?fpx(x.px):DASH)+'</td><td class="r">'+(isNum(x.val)?big(x.val)+' <small>'+esc(x.c||"")+'</small>':DASH)+'</td></tr>').join("");
 return sec("coFI",T,'<div class="co-fin-wrap"><table class="co-tbl co-tx"><thead><tr><th>Date</th><th>Person and role</th><th>Type</th><th class="r">Volume</th><th class="r co-hide-xs">Avg price</th><th class="r">Value</th></tr></thead><tbody>'+tr+'</tbody></table></div>'+moreBtn("fi",rows.length,5)+
  fine("Notifications of managers' transactions (MAR art. 19) from the FI insider register; cancelled notices excluded. Avg price is volume-weighted across the day's notices."),"",sub);}

function overview(c,r,d){return chartSec(r)+glance(c,d)+valuation(c,r)+keyStats(c,r)+dates(c,d)+announcements()+about(c,d)+news(c,r);}

/* ---------- Financials ---------- */
const STMT={
 is:{label:"Income statement",rows:[["Revenue","rev","b"],["Cost of revenue","cogs"],["Gross profit","gp","b"],["SG&A","sga"],["R&D","rnd"],["Operating expenses","opex"],
  ["Operating income","oi","b"],["EBITDA","ebitda","b"],["Depreciation & amortisation","da"],["EBIT","ebit"],["Interest expense","intx"],["Pre-tax income","pti"],["Tax","tax"],
  ["Net income","ni","b"],["EPS (diluted)","eps","eps"],["Diluted shares","dsh","sh"]]},
 bs:{label:"Balance sheet",rows:[["Total assets","ta","b"],["Current assets","ca"],["Cash & short-term inv.","cash"],["Receivables","ar"],["Inventory","inv"],["PP&E (net)","ppe"],["Goodwill & intangibles","gw"],
  ["Total liabilities","tl","b"],["Current liabilities","cl"],["Payables","ap"],["Short-term debt","std"],["Long-term debt","ltd"],["Total debt","debt","b"],["Net debt","nd","b"],
  ["Shareholders' equity","eq","b"],["Minority interest","mi"],["Working capital","wc"],["Shares outstanding","so","sh"]]},
 cf:{label:"Cash flow",rows:[["Operating cash flow","ocf","b"],["Change in working capital","dwc"],["Stock-based compensation","sbc"],["Capital expenditure","capex"],["Free cash flow","fcf","b"],
  ["Investing cash flow","icf"],["Financing cash flow","fincf"],["Dividends paid","div"],["Share buybacks","buy"],["Share issuance","iss"],["Debt issued","dis"],["Debt repaid","drp"]]},
 ratios:{label:"Key ratios",rows:[["Gross margin","gm","p"],["Operating margin","om","p"],["EBITDA margin","em","p"],["Net margin","nm","p"],["FCF margin","fcf_m","p"],
  ["Return on equity","roe","p"],["Return on assets","roa","p"],["Net debt / EBITDA","nd_ebitda","x"],["Debt / equity","de","x"],["Current ratio","cur","x"],["Interest cover (EBIT)","icov","x"],
  ["Capex / revenue","capex_rev","p"],["Payout ratio","payout","p"]]}};
function finRows(d,mode){const f=d&&d.fin||{};return(mode==="annual"?f.annual:f.quarterly)||[];}
function effMode(d){const A=finRows(d,"annual").length,Q=finRows(d,"quarterly").length;return finMode==="annual"&&!A&&Q?"quarterly":finMode==="quarterly"&&!Q&&A?"annual":finMode;}
function fmtCell(v,t){if(!isNum(v))return DASH;if(t==="eps")return feps(v);if(t==="p")return pctU(v);if(t==="x")return v.toFixed(Math.abs(v)>=100?0:Math.abs(v)>=10?1:2)+"×";return big(v);}
function finTable(d){const f=d&&d.fin;if(!f||(!(f.annual||[]).length&&!(f.quarterly||[]).length))return empty("No reported financials from Yahoo for this listing.");
 const mode=effMode(d),S=STMT[finStmt];let rows,labs,tips;
 if(finStmt==="ratios"){if(mode!=="annual")return empty("Key ratios are computed from annual figures and the trailing twelve months. Switch to Annual.");
  rows=((d.ratios||{}).annual||[]).slice();labs=rows.map(x=>fyLab(x.d));tips=rows.map(x=>"Fiscal year ending "+x.d);
  const t=(d.ratios||{}).ttm;if(t&&Object.keys(t).length>2){rows.push(Object.assign({ttm:1},t));labs.push("TTM");tips.push("Trailing twelve months to "+(t.d||"")+(t.bal_d?"; balance sheet at "+t.bal_d:""));}}
 else{rows=finRows(d,mode).slice();labs=rows.map(x=>mode==="annual"?fyLab(x.d):qLab(x.d));tips=rows.map(x=>"Period ending "+x.d);
  if(mode==="annual"&&finStmt!=="bs"&&f.ttm&&Object.keys(f.ttm).length>1){rows.push(Object.assign({ttm:1},f.ttm));labs.push("TTM");tips.push("Trailing twelve months to "+(f.ttm.d||""));}}
 if(!rows.length)return empty(mode==="annual"?"No annual figures for this listing.":"No quarterly figures for this listing (many London and Nordic small caps report half-yearly).");
 const lines=S.rows.filter(([,k])=>rows.some(x=>isNum(x[k])));if(!lines.length)return empty("No "+S.label.toLowerCase()+" lines from Yahoo for this listing.");
 const unit=finStmt==="ratios"?"":esc(f.ccy||"");
 return'<div class="co-fin-wrap"><table class="co-fin"><thead><tr><th>'+(unit||"&nbsp;")+'</th>'+labs.map((l,i)=>'<th title="'+esc(tips[i])+'"'+(rows[i].ttm?' class="co-ttm"':"")+'>'+esc(l)+'</th>').join("")+'</tr></thead><tbody>'+
  lines.map(([l,k,t])=>'<tr class="'+(t==="b"?"co-strong":"")+'"><th>'+esc(l)+'</th>'+rows.map(x=>{const v=x[k];return'<td class="'+(x.ttm?"co-ttm ":"")+(isNum(v)&&v<0&&k!=="nd"&&finStmt!=="cf"?"neg":"")+'"'+(k==="nd"&&isNum(v)&&v<0?' title="Net cash"':"")+'>'+fmtCell(v,t==="b"?null:t)+'</td>';}).join("")+'</tr>').join("")+
  '</tbody></table></div>';}
function finChart(d,c){const mode=effMode(d);const rows=finRows(d,mode);if(!rows.length||finStmt==="ratios")return"";const ccy=(d.fin&&d.fin.ccy)||"";
 const labs=rows.map(x=>mode==="annual"?fyLab(x.d):qLab(x.d));const per=labs.length>1?labs[0]+"–"+labs[labs.length-1]:labs[0];const nm=(c&&c.name)||cur;
 const ser={is:[["Revenue","rev","s1"],["EBITDA","ebitda","s2"],["Net income","ni","s3"]],bs:[["Total debt","debt","s4"],["Cash","cash","s1"],["Equity","eq","s2"]],cf:[["Operating cash flow","ocf","s1"],["Capex","capex","s4"],["Free cash flow","fcf","s2"]]}[finStmt]
  .filter(([,k])=>rows.some(x=>isNum(x[k])));if(!ser.length)return"";
 const what={is:"revenue, EBITDA and net income",bs:"debt, cash and equity",cf:"operating cash flow, capex and free cash flow"}[finStmt];
 return barChart({title:nm+" "+what,sub:(mode==="annual"?"Fiscal years ":"Quarters ")+per+" · "+(mode==="annual"?"annual":"quarterly")+(finStmt==="bs"?" balance sheet at period end":" figures")+" · "+SRC,ccy,scale:true,labels:labs,series:ser.map(([n,k,cl])=>({name:n,cls:cl,vals:rows.map(x=>x[k])}))});}
function finBody(c,d){return finChart(d,c)+finTable(d);}
function financials(c,d){if(!d)return sec("coFin","Financial statements",'<div class="co-skel tall"></div>');
 const ctl='<div class="co-ctl">'+seg("stmt",[["is","Income"],["bs","Balance sheet"],["cf","Cash flow"],["ratios","Ratios"]],finStmt,"Statement")+seg("fin",[["annual","Annual"],["quarterly","Quarterly"]],effMode(d),"Period")+'</div>';
 const f=d.fin||{};
 const note=finStmt==="ratios"?"Margins on revenue; ROE = net income / average equity; net debt / EBITDA and interest cover on the same period; TTM uses trailing flows and the latest balance sheet. Computed from Yahoo statements.":
  "Reporting currency"+(f.ccy?" ("+esc(f.ccy)+")":"")+", as reported to Yahoo. Net debt = total debt − cash &amp; short-term investments (negative = net cash). FCF = operating cash flow − capex. Cash-flow outflows are negative.";
 return sec("coFin","Financial statements",ctl+'<div id="coFinBody">'+finBody(c,d)+'</div>'+fine(note+(c&&c.fin_stale?" Statements from an earlier fetch; the latest refresh failed.":"")));}
function shareholderReturns(c,d){if(!d)return"";const dv=d.divs;const ann=finRows(d,"annual");const ccyF=(d.fin&&d.fin.ccy)||"";const nm=(c&&c.name)||cur;let h="";
 if(dv&&dv.years&&dv.years.length){let ys=dv.years.slice(-11);if(ys.length>2&&ys[0][2]<ys[1][2])ys=ys.slice(1);/* first year of the 10-year window is usually partial */ys=ys.slice(-10);const unit=(dv.ccy==="GBp"?"GBp (pence)":dv.ccy||"")+" per share";
  const thisY=new Date().getUTCFullYear();
  h+=barChart({title:nm+" dividends per share",unit,sub:"Calendar years "+ys[0][0]+"–"+ys[ys.length-1][0]+(ys[ys.length-1][0]===thisY?" ("+thisY+" year to date)":"")+" · sum of payments by ex-date year · "+SRC,labels:ys.map(y=>String(y[0])),series:[{name:"Dividend per share",cls:"s2",vals:ys.map(y=>y[1])}],fmt:v=>feps(v).replace(/<[^>]+>/g,"")});
  const kvs=[["Annual dividend rate",isNum(dv.rate)?feps(dv.rate)+' <small>'+esc(ccyLab(dv.ccy))+'</small>':DASH,"Forward annual dividend per share (Yahoo)"],["Trailing 12 months",dv.trail===0?"None":isNum(dv.trail)?feps(dv.trail)+' <small>'+esc(ccyLab(dv.ccy))+'</small>':DASH],
   ["Payout ratio",isNum(dv.payout)?pctU(dv.payout):DASH,"Dividends / earnings (Yahoo)"],["5-year avg. yield",isNum(dv.yield5)?dv.yield5.toFixed(2)+"%":DASH]];
  const last=(dv.last||[]);
  h+=kv(kvs)+(last.length?'<div class="co-sub-h">Recent payments <small>ex-date · amount per share</small></div><table class="co-tbl"><tbody>'+limit("divs",last,4).map(([dd,a])=>'<tr><td>'+dateCell(dd)+'</td><td class="r">'+feps(a)+' <small>'+esc(ccyLab(dv.ccy))+'</small></td></tr>').join("")+'</tbody></table>'+moreBtn("divs",last.length,4):"");}
 else h+=empty("No dividend payments on record for this listing (last 10 years).");
 const rr=ann.filter(x=>isNum(x.div)||isNum(x.buy));
 if(rr.length){const labs=rr.map(x=>fyLab(x.d));
  h+=barChart({title:nm+" cash returned to shareholders",sub:"Fiscal years "+labs[0]+(labs.length>1?"–"+labs[labs.length-1]:"")+" · annual, dividends paid and share buybacks from the cash-flow statement · "+SRC,ccy:ccyF,scale:true,labels:labs,
   series:[{name:"Dividends paid",cls:"s2",vals:rr.map(x=>isNum(x.div)?Math.abs(x.div):null)},{name:"Share buybacks",cls:"s1",vals:rr.map(x=>isNum(x.buy)?Math.abs(x.buy):null)}]});}
 return sec("coRet","Dividends & buybacks",h,"",dv&&dv.ccy?"Per-share amounts in "+esc(pxUnit(dv.ccy)):"");}
function finTab(c,r,d){return financials(c,d)+shareholderReturns(c,d);}

/* ---------- Analysts ---------- */
const RATING={strong_buy:"Strong buy",buy:"Buy",hold:"Hold",underperform:"Underperform",sell:"Sell",strong_sell:"Strong sell"};
const RKEYS=[["strongBuy","Strong buy"],["buy","Buy"],["hold","Hold"],["sell","Sell"],["strongSell","Strong sell"]];
function breakdown(b){if(!b)return"";const n=RKEYS.reduce((s,[k])=>s+(b[k]||0),0);if(!n)return"";
 return'<div class="co-break"><div class="co-break-bar">'+RKEYS.filter(([k])=>b[k]).map(([k,l])=>'<span class="b-'+k+'" style="flex:'+b[k]+'" title="'+l+': '+b[k]+'"></span>').join("")+'</div>'+
  '<div class="co-break-lab">'+RKEYS.filter(([k])=>b[k]).map(([k,l])=>'<span><i class="b-'+k+'"></i>'+l+' '+b[k]+'</span>').join("")+'</div></div>';}
function consensus(c,r){const k=c&&c.cons;const has=k&&(k.analysts||isNum(k.target));
 if(!has)return sec("coCons","Consensus",empty("No analyst coverage on Yahoo for this listing."));
 const px=r&&isNum(r.px)?r.px:c.px;const rk=k.rating&&RATING[k.rating];const ccy=ccyLab(c.ccy);
 const stats='<div class="co-stats">'+
  '<div><span class="co-tl">Mean target</span><b>'+fpx(k.target)+'</b><small>'+esc(isNum(k.target)?ccy:"")+(isNum(k.target_med)?" · median "+fpx(k.target_med).replace(/<[^>]+>/g,""):"")+'</small></div>'+
  '<div><span class="co-tl">Upside</span><b class="'+(isNum(k.upside)?(k.upside>=0?"up":"dn"):"")+'">'+pct(k.upside)+'</b><small>vs last price</small></div>'+
  '<div><span class="co-tl">Rating</span><b>'+(rk?esc(rk):DASH)+'</b>'+(isNum(k.rating_mean)?'<small title="1 = strong buy … 5 = sell">'+k.rating_mean.toFixed(1)+' on a 1–5 scale</small>':"")+'</div>'+
  '<div><span class="co-tl">Analysts</span><b>'+(k.analysts||DASH)+'</b><small>with a target</small></div></div>';
 const rb=rangeBar(k.target_lo,k.target_hi,[{k:"mean",v:k.target,l:"Mean",t:"Mean target"},{k:"px",v:px,l:"Price",t:"Last price"}],"Low "+fpx(k.target_lo),"High "+fpx(k.target_hi),"Analyst price targets, low to high, vs last price");
 return sec("coCons","Consensus",stats+(rb?'<figure class="co-fig co-fig-tbl">'+figcap(((c&&c.name)||cur)+" 12-month analyst price targets vs last price",pxUnit(c.ccy),"Current consensus, low to high · "+(k.analysts?k.analysts+" analysts · ":"")+SRC)+'</figure>'+rb:"")+'<div class="co-sub-h">Current ratings</div>'+breakdown(k.breakdown));}
function recTrend(c,d){const t=d&&d.an&&d.an.trend||[];if(!t.length)return"";const lab={"0m":"This month","-1m":"1 month ago","-2m":"2 months ago","-3m":"3 months ago"};
 const mx=Math.max(...t.map(x=>RKEYS.reduce((s,[k])=>s+(x[k]||0),0)));
 return sec("coTrend","Recommendation trend",'<figure class="co-fig">'+figcap(((c&&c.name)||cur)+" analyst recommendations","number of analysts","Last 4 months · monthly snapshot · "+SRC)+'<div class="co-rt">'+
  t.map(x=>{const n=RKEYS.reduce((s,[k])=>s+(x[k]||0),0);return'<div class="co-rt-row"><span class="co-rt-l">'+esc(lab[x.p]||x.p)+'</span><div class="co-rt-bar" style="width:'+(n/mx*100).toFixed(1)+'%">'+RKEYS.filter(([k])=>x[k]).map(([k,l])=>'<span class="b-'+k+'" style="flex:'+x[k]+'" title="'+l+': '+x[k]+'">'+(x[k]/n>0.12?x[k]:"")+'</span>').join("")+'</div><span class="co-rt-n">'+n+'</span></div>';}).join("")+
  '</div><div class="co-break-lab">'+RKEYS.map(([k,l])=>'<span><i class="b-'+k+'"></i>'+l+'</span>').join("")+'</div></figure>');}
function estimates(c,d){const e=d&&d.an&&d.an.est||[];if(!e.length)return sec("coEst","Estimates",empty("No consensus estimates on Yahoo for this listing."));
 const pl={"0q":"Current qtr","+1q":"Next qtr","0y":"Current FY","+1y":"Next FY"};
 const hd=x=>'<th title="Period ending '+esc(x.end||"")+'">'+esc(pl[x.p]||x.p)+'<small>'+esc(x.end?(x.p.endsWith("y")?fyLab(x.end):qLab(x.end)):"")+'</small></th>';
 const eccy=e.map(x=>x.eps&&x.eps.ccy).find(Boolean)||(c&&c.fin_ccy)||"";const rccy=e.map(x=>x.rev&&x.rev.ccy).find(Boolean)||(c&&c.fin_ccy)||"";
 const g=v=>isNum(v)?'<small class="'+(v>=0?"up":"dn")+'">'+pct(v)+' y/y</small>':"";
 const row=(l,f)=>'<tr><th>'+l+'</th>'+e.map(x=>'<td>'+f(x)+'</td>').join("")+'</tr>';
 const tbl='<div class="co-fin-wrap"><table class="co-est"><thead><tr><th>&nbsp;</th>'+e.map(hd).join("")+'</tr></thead><tbody>'+
  row("EPS · mean <small>"+esc(eccy)+"</small>",x=>x.eps?feps(x.eps.avg)+g(x.eps.g):DASH)+
  row("EPS · range",x=>x.eps&&isNum(x.eps.lo)?'<span class="co-muted">'+feps(x.eps.lo)+" – "+feps(x.eps.hi)+'</span>':DASH)+
  row("EPS · year ago",x=>x.eps?feps(x.eps.ya):DASH)+
  row("Analysts (EPS)",x=>x.eps?x.eps.n:DASH)+
  row("Revenue · mean <small>"+esc(rccy)+"</small>",x=>x.rev?big(x.rev.avg)+g(x.rev.g):DASH)+
  row("Revenue · range",x=>x.rev&&isNum(x.rev.lo)?'<span class="co-muted">'+big(x.rev.lo)+" – "+big(x.rev.hi)+'</span>':DASH)+
  row("Analysts (revenue)",x=>x.rev?x.rev.n:DASH)+'</tbody></table></div>';
 const tr=e.filter(x=>x.tr&&isNum(x.tr.cur));
 const rev=tr.length?'<div class="co-sub-h">EPS estimate revisions <small>'+esc(eccy)+' per share</small></div><div class="co-fin-wrap"><table class="co-est"><thead><tr><th>&nbsp;</th>'+tr.map(hd).join("")+'</tr></thead><tbody>'+
  [["Now","cur"],["7 days ago","d7"],["30 days ago","d30"],["60 days ago","d60"],["90 days ago","d90"]].map(([l,k])=>'<tr><th>'+l+'</th>'+tr.map(x=>'<td>'+feps(x.tr[k])+'</td>').join("")+'</tr>').join("")+
  '<tr><th>Change vs 90 days</th>'+tr.map(x=>{const a=x.tr.cur,b=x.tr.d90;const ch=isNum(a)&&isNum(b)&&b!==0?(a/b-1)*100*Math.sign(b):null;return'<td class="'+(isNum(ch)?(ch>0.05?"up":ch<-0.05?"dn":""):"")+'">'+pct(ch)+'</td>';}).join("")+'</tr>'+
  '<tr><th>Revised up / down · 30 days</th>'+tr.map(x=>'<td>'+(x.rv?'<span class="up">▲'+x.rv.u30+'</span> <span class="dn">▼'+x.rv.d30+'</span>':DASH)+'</td>').join("")+'</tr>'+
  '</tbody></table></div>':"";
 return sec("coEst","Estimates",tbl+rev+fine("Consensus from Yahoo Finance. EPS in the earnings currency, revenue in the revenue currency shown. Growth vs the same period a year earlier."));}
function surprises(c,d){const h=d&&d.an&&d.an.hist||[];if(!h.length)return sec("coSurp","Earnings surprises",empty("No earnings history on Yahoo for this listing."));
 const ccy=h.map(x=>x.ccy).find(Boolean)||(c&&c.fin_ccy)||"";const mx=Math.max(5,...h.map(x=>Math.abs(x.surp||0)));
 return sec("coSurp","Earnings surprises",'<figure class="co-fig co-fig-tbl">'+figcap(((c&&c.name)||cur)+" EPS vs consensus",ccy?ccy+" per share; surprise in %":"surprise in %","Last "+h.length+" reported quarters · quarterly · "+SRC)+'</figure><table class="co-tbl co-surp"><thead><tr><th>Quarter</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">Surprise</th><th class="co-surp-viz" aria-hidden="true"></th></tr></thead><tbody>'+
  h.slice().reverse().map(x=>{const s=x.surp;const w=isNum(s)?Math.min(50,Math.abs(s)/mx*50):0;
   return'<tr><td>'+(x.q?esc(qLab(x.q)):DASH)+'</td><td class="r">'+feps(x.est)+'</td><td class="r"><b>'+feps(x.act)+'</b></td><td class="r '+(isNum(s)?(s>=0?"up":"dn"):"")+'">'+pct(s)+'</td>'+
   '<td class="co-surp-viz"><span class="co-div"><i class="'+(isNum(s)&&s<0?"dn":"up")+'" style="'+(isNum(s)&&s<0?"right:50%":"left:50%")+';width:'+w.toFixed(1)+'%"></i></span></td></tr>';}).join("")+
  '</tbody></table>'+fine("EPS per share in "+esc(ccy)+", last reported quarters. Bars: surprise vs the consensus estimate (beat right, miss left)."));}
const ACT={up:"Upgrade",down:"Downgrade",main:"Maintains",init:"Initiated",reit:"Reiterated"};
function upgrades(c,d){const a=d&&d.an||{};const u=a.upg||[];
 if(!u.length)return sec("coUpg","Rating changes",empty(a.upg_total?"No rating actions in the last 3 years on Yahoo for this listing.":"No broker rating actions on Yahoo for this listing (Yahoo mainly tracks US and Canadian brokers)."));
 const ccy=ccyLab(c&&c.ccy);
 const rows=limit("upg",u,5).map(x=>{const pt=isNum(x.pt)?(isNum(x.ppt)&&x.ppt!==x.pt?'<span class="co-muted">'+fpx(x.ppt)+' →</span> ':"")+fpx(x.pt):DASH;
  return'<tr><td>'+dateCell(x.d)+'</td><td>'+esc(x.firm||"")+'</td><td><span class="co-act-pill a-'+esc(x.act||"")+'">'+esc(ACT[x.act]||x.act||"")+'</span></td><td>'+(x.fr&&x.fr!==x.to?'<span class="co-muted">'+esc(x.fr)+' →</span> ':"")+esc(x.to||"")+'</td><td class="r">'+pt+'</td></tr>';}).join("");
 return sec("coUpg","Rating changes",'<div class="co-fin-wrap"><table class="co-tbl"><thead><tr><th>Date</th><th>Firm</th><th>Action</th><th>Rating</th><th class="r">Target <small>'+esc(ccy)+'</small></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+moreBtn("upg",u.length,5)+
  fine((a.upg_12m!=null?a.upg_12m+" rating action"+(a.upg_12m===1?"":"s")+" in the last 12 months. ":"")+"Broker actions as listed by Yahoo (last 3 years, latest 25)."));}
function analystsTab(c,r,d){if(!d)return consensus(c,r)+'<div class="co-skel tall"></div>';return consensus(c,r)+recTrend(c,d)+estimates(c,d)+surprises(c,d)+upgrades(c,d);}

/* ---------- Ownership & insiders ---------- */
function holdersTable(key,list,ccy,title,sub){if(!list||!list.length)return sec("co"+key,title,empty("No "+title.toLowerCase()+" listed on Yahoo for this listing."));
 const rows=limit(key,list,5).map(h=>'<tr><td class="co-name-cell">'+esc(h.n)+'</td><td class="r"><b>'+(isNum(h.pct)?h.pct.toFixed(h.pct<0.1?2:1)+"%":DASH)+'</b></td><td class="r">'+big(h.pos)+'</td><td class="r co-hide-xs">'+big(h.val)+'</td><td class="r co-hide-xs '+(isNum(h.chg)?(h.chg>0?"up":h.chg<0?"dn":""):"")+'">'+pct(h.chg)+'</td><td class="r co-hide-xs">'+dateCell(h.d)+'</td></tr>').join("");
 const thin=Math.max(...list.map(h=>isNum(h.pct)?h.pct:0))<0.5;
 return sec("co"+key,title,(thin?'<p class="co-fine co-thin">Yahoo only lists small, mainly US-filed positions for this listing; the largest holders are probably missing. Check the company\'s shareholder register.</p>':"")+'<div class="co-fin-wrap"><table class="co-tbl"><thead><tr><th>Holder</th><th class="r">% held</th><th class="r">Shares</th><th class="r co-hide-xs">Value <small>'+esc(ccy)+'</small></th><th class="r co-hide-xs">Change</th><th class="r co-hide-xs">Reported</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+moreBtn(key,list.length,5),"",sub);}
function ownership(c,d){const o=d.own||{};const m=(c&&c.mkt)||{};const v=(c&&c.val)||{};
 const ins=isNum(o.ins)?Math.min(100,o.ins):null,inst=isNum(o.inst)?Math.min(100,o.inst):null;
 let bar="";if(isNum(ins)||isNum(inst)){const oth=Math.max(0,100-(ins||0)-(inst||0));
  bar='<figure class="co-fig">'+figcap(((c&&c.name)||cur)+" shareholder breakdown","% of shares outstanding","Latest filings · snapshot · "+SRC)+'<div class="co-own-bar">'+
   (ins?'<span class="o-ins" style="flex:'+ins+'" title="Insiders '+ins.toFixed(1)+'%">'+(ins>=8?ins.toFixed(0)+"%":"")+'</span>':"")+(inst?'<span class="o-inst" style="flex:'+inst+'" title="Institutions '+inst.toFixed(1)+'%">'+(inst>=8?inst.toFixed(0)+"%":"")+'</span>':"")+(oth?'<span class="o-oth" style="flex:'+oth+'" title="Other / retail '+oth.toFixed(1)+'%">'+(oth>=8?oth.toFixed(0)+"%":"")+'</span>':"")+
   '</div><div class="co-legend"><span><i class="o-ins"></i>Insiders '+pctU(ins)+'</span><span><i class="o-inst"></i>Institutions '+pctU(inst)+'</span><span><i class="o-oth"></i>Other / retail '+pctU(oth)+'</span></div></figure>';}
 const rows=[["Institutions holding",o.inst_n?o.inst_n.toLocaleString("en-US"):DASH],["Institutions, % of float",isNum(o.inst_float)?pctU(o.inst_float):DASH],
  ["Shares outstanding",big(v.shares)],["Free float",isNum(m.float)?big(m.float)+(isNum(m.float_pct)?' <small>'+m.float_pct.toFixed(0)+'%</small>':""):DASH],
  ["Short interest",isNum(m.short)?big(m.short)+(isNum(m.short_pf)?' <small>'+m.short_pf.toFixed(1)+'% of float</small>':""):'<span class="co-na">Not reported</span>']];
 if(!bar&&!o.inst_n)return sec("coOwn","Ownership",empty("No ownership breakdown on Yahoo for this listing.")+kv(rows.slice(2)));
 return sec("coOwn","Ownership",bar+kv(rows),"",'Insider = officers, directors and large strategic holders, as classified by Yahoo');}
/* Yahoo's 6-month summary is sometimes 0/0 while the transaction list has buys/sells: derive the counts from the list */
function deriveIA(tx){const from=new Date();from.setUTCMonth(from.getUTCMonth()-6);const f=from.toISOString().slice(0,10);
 const o={buy_n:0,buy_sh:0,sell_n:0,sell_sh:0};tx.forEach(x=>{if(!x.d||x.d<f||(x.k!=="buy"&&x.k!=="sell"))return;o[x.k+"_n"]++;o[x.k+"_sh"]+=isNum(x.sh)?x.sh:0;});
 o.net_sh=o.buy_sh-o.sell_sh;return o.buy_n||o.sell_n?o:null;}
function insiderActivity(c,d){let n=d.ins_net||{};const tx=d.ins_tx||[];
 if(!n.buy_n&&!n.sell_n&&!tx.length)return sec("coIA","Insider activity",empty("Yahoo reports insider purchases and sales mainly for US, Canadian and UK listings.")+(isNum(n.tot)?kv([["Insider shares held",big(n.tot)]]):""));
 const dv=!n.buy_n&&!n.sell_n?deriveIA(tx):null;if(dv)n=Object.assign({},n,dv,{p:"6m"});
 const mx=Math.max(1,n.buy_n||0,n.sell_n||0);const per=n.p==="6m"?"last 6 months":n.p||"";
 const b=(cls,l,cnt,sh)=>'<div class="co-ia-row"><span class="co-ia-l">'+l+'</span><div class="co-ia-track"><span class="'+cls+'" style="width:'+((cnt||0)/mx*100).toFixed(1)+'%"></span></div><span class="co-ia-v"><b>'+(cnt||0)+'</b> <small>'+(isNum(sh)&&sh?big(sh)+" sh.":"")+'</small></span></div>';
 const rows=[["Net insider shares"+(dv?" (derived)":""),isNum(n.net_sh)?'<span class="'+(n.net_sh>0?"up":n.net_sh<0?"dn":"")+'">'+(n.net_sh>0?"+":"")+big(n.net_sh)+'</span>':DASH],
  ["Insider shares held",big(n.tot)],["Net institutional buying",isNum(n.inst_net)?'<span class="'+(n.inst_net>0?"up":n.inst_net<0?"dn":"")+'">'+(n.inst_net>0?"+":"")+big(n.inst_net)+'</span>'+(isNum(n.inst_net_pct)?' <small>'+pct(n.inst_net_pct,2)+'</small>':""):DASH]];
 return sec("coIA","Insider activity",'<figure class="co-fig">'+figcap(((c&&c.name)||cur)+" insider purchases vs sales"+(dv?" (derived)":""),"number of transactions",per.charAt(0).toUpperCase()+per.slice(1)+" · shares traded beside each bar · "+(dv?"derived from the transaction list below (Yahoo's 6-month summary shows none) · ":"")+SRC)+b("ia-buy","Purchases",n.buy_n,n.buy_sh)+b("ia-sell","Sales",n.sell_n,n.sell_sh)+'</figure>'+kv(rows)+(dv?fine("Derived: purchases and sales in the last 6 months counted from the insider transactions listed below (latest "+tx.length+" filings on Yahoo); option exercises and other transactions are excluded."):""));}
function insiderTx(c,d){const t=d.ins_tx||[];if(!t.length)return sec("coTx","Insider transactions",empty("No insider transactions on Yahoo for this listing."));
 const mc=majorCcy(c&&c.ccy);const K={buy:"Buy",sell:"Sell",other:"Other"};
 const rows=limit("tx",t,5).map(x=>'<tr><td>'+dateCell(x.d)+'</td><td class="co-name-cell">'+esc(personName(x.n))+(x.rel?'<small>'+esc(x.rel)+'</small>':"")+'</td><td><span class="co-act-pill k-'+x.k+'" title="'+esc(x.txt||"")+'">'+K[x.k]+'</span></td><td class="r">'+big(x.sh)+'</td><td class="r co-hide-xs">'+big(x.val)+'</td></tr>'+(x.txt?'<tr class="co-tx-note"><td></td><td colspan="4">'+esc(x.txt)+'</td></tr>':"")).join("");
 return sec("coTx","Insider transactions",'<div class="co-fin-wrap"><table class="co-tbl co-tx"><thead><tr><th>Date</th><th>Insider</th><th>Type</th><th class="r">Shares</th><th class="r co-hide-xs">Value <small>'+esc(mc)+'</small></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+moreBtn("tx",t.length,5)+
  fine("Filings as listed by Yahoo (latest "+t.length+"). “Other” covers option exercises, awards, transfers and plan changes."));}
function insiderHolders(c,d){const h=d.ins_hold||[];if(!h.length)return"";
 const rows=limit("ih",h,5).map(x=>'<tr><td class="co-name-cell">'+esc(personName(x.n))+(x.rel?'<small>'+esc(x.rel)+'</small>':"")+'</td><td class="r"><b>'+big(x.pos)+'</b></td><td class="r co-hide-xs">'+dateCell(x.d)+(x.desc?'<small class="co-ih-desc">'+esc(x.desc)+'</small>':"")+'</td></tr>').join("");
 return sec("coIH","Insider holdings",'<div class="co-fin-wrap"><table class="co-tbl"><thead><tr><th>Insider</th><th class="r">Shares held <small>direct</small></th><th class="r co-hide-xs">Latest transaction</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+moreBtn("ih",h.length,5));}
function ownTab(c,r,d){if(!d)return'<div class="co-skel tall"></div>';const mc=majorCcy(c&&c.ccy);
 return ownership(c,d)+holdersTable("Inst",d.inst,mc,"Top institutional holders","Up to 10 largest, latest 13F-style filings via Yahoo")+holdersTable("Funds",d.funds,mc,"Top fund holders","Mutual funds and ETFs")+insiderActivity(c,d)+fiSec(c)+insiderTx(c,d)+insiderHolders(c,d);}

/* ---------- Management ---------- */
const BOARD_RE=/\b(chair|chairman|chairwoman|chairperson|director|board)\b/i;
function officers(c,d){const o=d.officers||[];if(!o.length)return sec("coOff","Executives",empty("No officers listed on Yahoo for this listing."));
 const thisY=new Date().getUTCFullYear();const anyPay=o.some(x=>isNum(x.pay));
 const rows=limit("off",o,6).map(x=>'<tr><td class="co-name-cell"><b>'+esc(x.n)+'</b><small>'+esc(x.t||"")+'</small></td><td class="r">'+(isNum(x.age)?x.age:isNum(x.yb)?thisY-x.yb:DASH)+'</td>'+(anyPay?'<td class="r">'+(isNum(x.pay)?big(x.pay)+(x.fy?'<small>FY'+String(x.fy).slice(2)+'</small>':""):DASH)+'</td>':"")+'</tr>').join("");
 return sec("coOff","Executives",'<div class="co-fin-wrap"><table class="co-tbl"><thead><tr><th>Name and title</th><th class="r">Age</th>'+(anyPay?'<th class="r">Total pay</th>':"")+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+moreBtn("off",o.length,6)+
  (anyPay?fine("Pay as reported to Yahoo for the fiscal year shown (salary, bonus and other compensation; Yahoo does not state the currency, usually the annual-report currency"+(c&&c.fin_ccy?", here likely "+esc(c.fin_ccy):"")+")."):""));}
function board(c,d){const o=(d.officers||[]).filter(x=>BOARD_RE.test(x.t||""));const a=d.about||{};
 const links=[];if(a.web)links.push("website "+link(a.web,host(a.web)));if(a.ir&&(!a.web||host(a.ir)!==host(a.web)))links.push("investor relations site "+link(a.ir,host(a.ir)));
 const list=o.length?'<ul class="co-board">'+o.map(x=>'<li><b>'+esc(x.n)+'</b><span>'+esc(x.t)+'</span></li>').join("")+'</ul>':"";
 return sec("coBoard","Board",(list||empty("Yahoo lists no officers with a chair or director title."))+'<p class="co-board-note">Yahoo Finance lists executive officers, not the full board. '+(o.length?"The names above are officers who also hold a chair or director title. ":"")+
  (links.length?"For the full board and its committees, see the company's "+links.join(" or ")+".":"See the company's annual report for the full board.")+'</p>');}
const GOV=[["audit","Audit"],["board","Board"],["comp","Compensation"],["rights","Shareholder rights"],["overall","Overall"]];
function governance(c,d){const g=d.gov;if(!g)return sec("coGov","Governance risk",empty("No governance scores on Yahoo for this listing (mostly covered for larger companies)."));
 const rows=GOV.filter(([k])=>isNum(g[k])).map(([k,l])=>{const v=g[k];const cls=v<=3?"g-lo":v<=6?"g-mid":"g-hi";
  return'<div class="co-gov-row'+(k==="overall"?" is-overall":"")+'"><span class="co-gov-l">'+l+'</span><div class="co-gov-track">'+Array.from({length:10},(_,i)=>'<i class="'+(i<v?cls:"")+'"></i>').join("")+'</div><b class="co-gov-v">'+v+'<small>/10</small></b></div>';}).join("");
 return sec("coGov","Governance risk",'<figure class="co-fig">'+figcap(((c&&c.name)||cur)+" governance risk scores","decile, 1 = lowest risk, 10 = highest",(g.d?"As of "+dateTxt(g.d)+" · ":"")+"latest assessment · ISS via "+SRC)+rows+'</figure>'+fine("ISS Governance QualityScore deciles as published on Yahoo Finance; relative to companies in the same region/index."));}
function mgmtTab(c,r,d){if(!d)return'<div class="co-skel tall"></div>';return officers(c,d)+board(c,d)+governance(c,d);}

/* ---------- render ---------- */
function footer(c,d){const when=c&&c.fetched_at?dfs.format(new Date(c.fetched_at))+" Geneva":null;
 return'<p class="co-note">Source: Yahoo Finance (quote summary, fundamentals time series, dividend history)'+(when?". Updated "+esc(when):"")+(c&&c.fin_asof?"; statements through "+esc(dateTxt(c.fin_asof)):"")+"."+
  (c&&c.stale?" Latest refresh failed; showing the previous values.":"")+(!c?" No company data for this symbol yet.":"")+' Data may be incomplete for small caps. Not investment advice.</p>';}
function render(){const body=$("coBody");if(!body||!cur)return;const r=tableRow(cur);const c=CO&&CO.companies?CO.companies[cur]:null;head(c,r);
 if(!CO){body.innerHTML='<div class="co-loading"><span class="co-spin"></span>Loading company data…</div>';return;}
 const d=DET[cur]||null;const sym=cur;
 if(!d&&c&&c.detail&&!detP[sym+"!"]){loadDet(sym).then(()=>{if(cur===sym&&!layer().hidden){const st=$("coBody").scrollTop;render();$("coBody").scrollTop=st;}}).catch(e=>{detP[sym+"!"]=1;if(cur===sym){render();}});}
 const noDet=!!c&&!c.detail,failed=!d&&(!!detP[sym+"!"]||noDet);
 let h;
 if(failed&&tab!=="overview")h=noDet?empty("Detailed company data is added in the next daily data build."):failMsg("Could not load the detailed company data. Try again later.");
 else h=tab==="fin"?finTab(c,r,d):tab==="analysts"?analystsTab(c,r,d):tab==="own"?ownTab(c,r,d):tab==="mgmt"?mgmtTab(c,r,d):overview(c,r,failed?{}:d);
 if(!c&&tab!=="overview")h=empty("No company data for this symbol yet.");
 body.setAttribute("role","tabpanel");body.setAttribute("aria-labelledby","coTab-"+tab);
 body.innerHTML=h+footer(c,d);
 body.querySelectorAll("[data-chart]").forEach(b=>b.onclick=()=>{chartMode=b.dataset.chart;drawChart(r);});
 body.querySelectorAll("[data-fin]").forEach(b=>b.onclick=()=>{finMode=b.dataset.fin;syncFin(c,d);});
 body.querySelectorAll("[data-stmt]").forEach(b=>b.onclick=()=>{finStmt=b.dataset.stmt;syncFin(c,d);});
 body.querySelectorAll("[data-more]").forEach(b=>b.onclick=()=>{const k=b.dataset.more;MORE.has(k)?MORE.delete(k):MORE.add(k);const st=body.scrollTop;render();body.scrollTop=st;const nb=body.querySelector('[data-more="'+k+'"]');nb&&nb.focus({preventScroll:true});});
 body.querySelectorAll("[data-tab-go]").forEach(b=>b.onclick=()=>setTab(b.dataset.tabGo,true));
 if(tab==="overview")drawChart(r);}
function syncFin(c,d){const m=effMode(d);document.querySelectorAll("#coFin [data-fin]").forEach(b=>{const on=b.dataset.fin===m;b.classList.toggle("is-on",on);b.setAttribute("aria-pressed",on);});
 document.querySelectorAll("#coFin [data-stmt]").forEach(b=>{const on=b.dataset.stmt===finStmt;b.classList.toggle("is-on",on);b.setAttribute("aria-pressed",on);});
 const fb=$("coFinBody");if(fb)fb.innerHTML=finBody(c,d);}

/* ---------- open / close ---------- */
const layer=()=>$("coLayer");
const hashSym=()=>{const m=location.hash.match(/^#co=([^&]+)/);try{return m?decodeURIComponent(m[1]):null;}catch(e){return null;}};
const hashTab=()=>{const m=location.hash.match(/[#&]tab=([a-z]+)/);return m&&TABS.some(x=>x[0]===m[1])?m[1]:null;};
function show(sym){const L=layer();const was=!L.hidden&&L.classList.contains("is-open");const fresh=cur!==sym||L.hidden;
 if(cur!==sym){chartMode=null;MORE.clear();}tab=hashTab()||(fresh?"overview":tab);cur=sym;clearTimeout(closing);
 if(!was){lastFocus=document.activeElement;L.hidden=false;document.body.classList.add("co-open");requestAnimationFrame(()=>requestAnimationFrame(()=>L.classList.add("is-open")));setTimeout(()=>$("coPanel").focus({preventScroll:true}),RM.matches?0:60);}
 render();if(fresh)$("coBody").scrollTop=0;
 if(!CO)loadCo().then(()=>{if(cur===sym&&!layer().hidden)render();}).catch(e=>{if(cur===sym)$("coBody").innerHTML='<p class="co-empty">Could not load company data ('+esc(e.message)+').</p>';});}
function hide(){const L=layer();if(L.hidden)return;L.classList.remove("is-open");document.body.classList.remove("co-open");
 closing=setTimeout(()=>{L.hidden=true;$("coBody").replaceChildren();cur=null;},RM.matches?0:280);
 if(lastFocus&&lastFocus.focus&&document.contains(lastFocus))lastFocus.focus({preventScroll:true});}
function open(sym){if(!sym)return;if(hashSym()!==sym){history.pushState({co:sym},"","#co="+encodeURIComponent(sym));pushed=true;}show(sym);}
function close(){if(hashSym()){if(pushed&&history.state&&history.state.co){pushed=false;history.back();return;}history.replaceState(null,"",location.pathname+location.search);}hide();}
function sync(){const s=hashSym();if(s){if(s===cur&&!layer().hidden){const t=hashTab()||"overview";if(t!==tab){tab=t;render();}return;}show(s);}else hide();}
window.addEventListener("popstate",sync);window.addEventListener("hashchange",sync);
document.addEventListener("keydown",e=>{if(e.key!=="Escape"||layer().hidden)return;const cm=$("chartModal");if(cm&&!cm.hidden)return;e.preventDefault();close();},true);
$("coClose").onclick=close;$("coBackdrop").onclick=close;
$("coChartBtn").onclick=()=>{const r=tableRow(cur);r&&window.MMTable&&window.MMTable.openChart&&window.MMTable.openChart(r);};
/* phone: swipe the sheet header down to close */
{let y0=null;const h=$("coHead");h.addEventListener("touchstart",e=>{y0=e.touches[0].clientY;},{passive:true});
 h.addEventListener("touchend",e=>{if(y0!=null&&e.changedTouches[0].clientY-y0>70&&PHONE.matches&&!e.target.closest(".co-tabs"))close();y0=null;},{passive:true});}
/* focus trap */
$("coPanel").addEventListener("keydown",e=>{if(e.key!=="Tab")return;const f=[...$("coPanel").querySelectorAll('a[href],button:not([disabled]):not([hidden]),[tabindex="0"]')].filter(x=>x.offsetParent);if(!f.length)return;
 const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus();}});
window.MMCompany={open,close,ready(){const s=hashSym();if(!s)return;if(layer().hidden||cur!==s)show(s);else render();},has:sym=>!CO||!!(CO.companies&&CO.companies[sym])};
(window.requestIdleCallback||(f=>setTimeout(f,1500)))(()=>loadCo().catch(()=>{}));
})();
