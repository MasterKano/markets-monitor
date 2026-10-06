/* Company panel: data/companies.json (Yahoo fundamentals, built by GitHub Actions) + Table rows/news.
   Opens from an equity name in the Table; URL hash #co=SYMBOL makes it shareable and back-button friendly.
   Real data only: anything missing renders as "—". */
(()=>{"use strict";
const TZ="Europe/Zurich";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isNum=v=>typeof v==="number"&&isFinite(v);
const DASH='<span class="co-na">—</span>';
const PHONE=matchMedia("(max-width:760px)");
const RM=matchMedia("(prefers-reduced-motion: reduce)");
const df=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric",month:"short",year:"numeric"});
const dfs=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
const mf=new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",month:"short",year:"2-digit"});
const mfl=new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",month:"short",year:"numeric"});
let CO=null,coP=null,cur=null,lastFocus=null,pushed=false,closing=0,finMode="annual",chartMode=null;

/* ---------- formatting ---------- */
function dp(v){const a=Math.abs(v);if(a>=10000)return 0;if(a>=1000)return 1;if(a>=1)return 2;if(a>=0.1)return 3;return 4;}
function fpx(v){return isNum(v)?v.toLocaleString("en-US",{minimumFractionDigits:dp(v),maximumFractionDigits:dp(v)}).replace(/^-/,"−"):DASH;}
function feps(v){if(!isNum(v))return DASH;const a=Math.abs(v),d=a>=100?0:a>=1?2:3;return sign(v)+a.toFixed(d);}
const sign=v=>v<0?"−":"";
function big(v){if(!isNum(v))return DASH;const a=Math.abs(v),s=sign(v);
 if(a>=1e12)return s+(a/1e12).toFixed(2)+"tn";if(a>=1e9)return s+(a/1e9).toFixed(a>=1e11?0:a>=1e10?1:2)+"bn";
 if(a>=1e6)return s+(a/1e6).toFixed(a>=1e8?0:a>=1e7?1:2)+"m";if(a>=1e3)return s+(a/1e3).toFixed(0)+"k";return s+a.toFixed(0);}
function pct(v,d){if(!isNum(v))return DASH;const a=Math.abs(v);return(v>0?"+":v<0?"−":"")+a.toFixed(d==null?(a>=100?0:1):d)+"%";}
function mult(v){return isNum(v)?v.toFixed(v>=100?0:1)+"×":DASH;}
function dateTxt(iso){if(!iso)return null;const d=new Date(iso+"T12:00:00Z");return isNaN(d)?null:df.format(d);}
function daysTo(iso){const d=new Date(iso+"T12:00:00Z");return Math.round((d-Date.now())/864e5);}
const ccyLab=c=>c==="GBp"?"GBp":c||"";
const majorCcy=c=>({GBp:"GBP",ILA:"ILS",ZAc:"ZAR"})[c]||c||"";

/* ---------- data ---------- */
function loadCo(){if(CO)return Promise.resolve(CO);if(coP)return coP;
 coP=fetch("data/companies.json?t="+Math.floor(Date.now()/6e4),{cache:"no-cache"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json();}).then(j=>(CO=j)).catch(e=>{coP=null;throw e;});return coP;}
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

/* ---------- sections ---------- */
const sec=(id,title,body,extra)=>'<section class="co-sec" id="'+id+'"><div class="co-sec-head"><h3>'+esc(title)+'</h3>'+(extra||"")+'</div>'+body+'</section>';
const empty=t=>'<p class="co-empty">'+esc(t)+'</p>';

function head(c,r){const name=(r&&r.name)||(c&&c.name)||cur;const px=r&&isNum(r.px)?r.px:c&&c.px;const ccy=(c&&c.ccy)||(r&&r.ccy);
 const d1=r&&r.pct&&isNum(r.pct["1D"])?r.pct["1D"]:c&&c.chg_pct;const exch=(c&&c.exch)||(r&&r.exch)||"";const p=(c&&c.profile)||{};
 const tags=[p.sector,p.industry].filter(Boolean).map(t=>'<span class="co-tag">'+esc(t)+'</span>').join("");
 $("coName").textContent=name;
 $("coSub").textContent=[cur,exch,(c&&c.long_name&&norm(c.long_name)!==norm(name))?c.long_name:null].filter(Boolean).join(" · ");
 $("coQuote").innerHTML='<span class="co-px">'+fpx(px)+'</span><span class="co-ccy">'+esc(ccyLab(ccy))+'</span>'+(isNum(d1)?'<span class="co-chg '+(d1>0?"up":d1<0?"dn":"")+'">'+pct(d1,2)+'</span>':"")+
  (r&&r.bar_date?'<span class="co-asof">close '+esc(dateTxt(r.bar_date)||r.bar_date)+'</span>':"");
 $("coTags").innerHTML=tags;$("coTags").hidden=!tags;
 $("coYahoo").href="https://finance.yahoo.com/quote/"+encodeURIComponent(cur);
 $("coChartBtn").hidden=!r;}

function lineChart(r){const p=r&&r.spark;if(!p||p.length<2)return'<div class="co-chart-empty">No price history available.</div>';
 const w=600,h=200;let mn=Math.min(...p),mx=Math.max(...p);const lo=mn,hi=mx;if(mx===mn)mx=mn+1;
 const pts=p.map((v,i)=>[(i/(p.length-1))*w,h-10-((v-mn)/(mx-mn))*(h-24)]);const d=pts.map((q,i)=>(i?"L":"M")+q[0].toFixed(1)+" "+q[1].toFixed(1)).join("");
 const up=p[p.length-1]>=p[0],c=up?"var(--good)":"var(--bad)";const chg=(p[p.length-1]/p[0]-1)*100;
 return'<div class="co-line"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" aria-label="1-year price line"><defs><linearGradient id="coGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+c+'" stop-opacity=".28"/><stop offset="1" stop-color="'+c+'" stop-opacity="0"/></linearGradient></defs>'+
  '<path d="'+d+'L'+w+' '+h+'L0 '+h+'Z" fill="url(#coGrad)"/><path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'+
  '<div class="co-line-axis"><span>'+esc(dateTxt(r.spark_from)||"")+'</span><span>1Y '+pct(chg)+' · hi '+fpx(hi)+' · lo '+fpx(lo)+'</span><span>'+esc(dateTxt(r.bar_date)||"")+'</span></div></div>';}
function chartSec(r){const tv=r&&r.tv;const seg=tv?'<div class="seg co-seg" role="group" aria-label="Chart type"><button class="button" type="button" data-chart="line">1Y line</button><button class="button" type="button" data-chart="tv">Interactive</button></div>':"";
 return sec("coChartSec","Price",'<div class="co-chart" id="coChart"></div>',seg);}
function drawChart(r){const box=$("coChart");if(!box)return;const tv=r&&r.tv;if(!chartMode)chartMode=tv&&!PHONE.matches?"tv":"line";if(!tv)chartMode="line";
 document.querySelectorAll("#coChartSec [data-chart]").forEach(b=>{const on=b.dataset.chart===chartMode;b.classList.toggle("is-on",on);b.setAttribute("aria-pressed",on);});
 if(chartMode==="line"||!window.MM||!window.MM.embed){box.innerHTML=lineChart(r);return;}
 box.innerHTML='<div class="co-tv" id="coTv"></div><div class="co-chart-status" id="coTvStatus">Loading chart…</div>';const want=cur;
 window.MM.embed("coTv",tv).then(()=>{const s=$("coTvStatus");setTimeout(()=>s&&s.remove(),1200);}).catch(()=>{if(cur===want&&chartMode==="tv"){box.innerHTML=lineChart(r)+'<p class="co-fine">Interactive chart unavailable (TradingView blocked or offline); showing the 1Y line from Yahoo closes.</p>';}});}

function tile(l,v,sub,tip){return'<div class="co-tile"'+(tip?' title="'+esc(tip)+'"':"")+'><span class="co-tl">'+esc(l)+'</span><span class="co-tv-val">'+v+'</span>'+(sub?'<span class="co-ts">'+sub+'</span>':"")+'</div>';}
function valuation(c){const v=c&&c.val;if(!v)return sec("coVal","Valuation",empty("No valuation data from Yahoo for this name."));
 const mc=majorCcy(c.ccy);const eur=x=>isNum(x)&&mc!=="EUR"?"€"+big(x):"";
 const neg=(x,flag)=>isNum(x)?mult(x):flag?'<span class="co-muted">neg.</span>':DASH;
 const t=[tile("Market cap",isNum(v.mcap)?big(v.mcap)+' <small>'+esc(mc)+'</small>':DASH,eur(v.mcap_eur)),
  tile("Enterprise value",isNum(v.ev)?big(v.ev)+' <small>'+esc(mc)+'</small>':DASH,eur(v.ev_eur),v.ev_src==="calc"?"Market cap + net debt + minorities (latest balance sheet)":v.ev_src==="yahoo"?"Yahoo enterprise value":""),
  tile("P/E · TTM",neg(v.pe,v.neg_earn),"","Price / trailing 12-month earnings (Yahoo)"),
  tile("P/E · forward",mult(v.pe_fwd),"","Price / forward earnings estimate (Yahoo)"),
  tile("EV / EBITDA",neg(v.ev_ebitda,v.neg_ebitda),"TTM","EV / trailing 12-month EBITDA (reporting currency)"),
  tile("EV / Sales",mult(v.ev_rev),"TTM","EV / trailing 12-month revenue"),
  tile("P / Book",mult(v.pb),"","Market cap / latest shareholders' equity"),
  tile("Dividend yield",isNum(v.dy)?v.dy.toFixed(v.dy>=10?1:2)+"%":DASH,"","Forward dividend yield (Yahoo)")];
 return sec("coVal","Valuation",'<div class="co-grid">'+t.join("")+'</div>');}

const RATING={strong_buy:"Strong buy",buy:"Buy",hold:"Hold",underperform:"Underperform",sell:"Sell",strong_sell:"Strong sell"};
function rangeBar(k,px){const lo=k.target_lo,hi=k.target_hi;if(!isNum(lo)||!isNum(hi)||hi<=lo)return"";
 const a=Math.min(lo,isNum(px)?px:lo),b=Math.max(hi,isNum(px)?px:hi),pos=x=>((x-a)/(b-a)*100).toFixed(1)+"%";
 return'<div class="co-range" aria-label="Analyst target range"><div class="co-range-track"><span class="co-range-band" style="left:'+pos(lo)+';right:calc(100% - '+pos(hi)+')"></span>'+
  (isNum(k.target)?'<span class="co-range-mean" style="left:'+pos(k.target)+'" title="Mean target '+esc(fpx(k.target).replace(/<[^>]+>/g,""))+'"></span>':"")+
  (isNum(px)?'<span class="co-range-px" style="left:'+pos(px)+'" title="Last price"></span>':"")+'</div>'+
  '<div class="co-range-lab"><span>Low '+fpx(lo)+'</span><span class="co-range-key"><i class="k-px"></i>Price <i class="k-mean"></i>Mean</span><span>High '+fpx(hi)+'</span></div></div>';}
function breakdown(b){if(!b)return"";const keys=[["strongBuy","Strong buy"],["buy","Buy"],["hold","Hold"],["sell","Sell"],["strongSell","Strong sell"]];const n=keys.reduce((s,[k])=>s+(b[k]||0),0);if(!n)return"";
 return'<div class="co-break"><div class="co-break-bar">'+keys.filter(([k])=>b[k]).map(([k,l])=>'<span class="b-'+k+'" style="flex:'+b[k]+'" title="'+l+': '+b[k]+'"></span>').join("")+'</div>'+
  '<div class="co-break-lab">'+keys.filter(([k])=>b[k]).map(([k,l])=>'<span><i class="b-'+k+'"></i>'+l+' '+b[k]+'</span>').join("")+'</div></div>';}
function estimates(e,c){if(!e||(!e.cy&&!e.ny))return"";const cols=[e.cy,e.ny].filter(Boolean);
 const fy=x=>"FY"+String(x.end||"").slice(2,4)+"e";const ccy=cols.map(x=>x.rev_ccy||x.eps_ccy).find(Boolean)||(c&&c.fin_ccy)||"";
 const cell=(v,g,n,f)=>'<td>'+(isNum(v)?f(v)+(isNum(g)?'<small class="'+(g>=0?"up":"dn")+'">'+pct(g)+'</small>':""):DASH)+(isNum(v)&&n?'<small class="co-n">'+n+' est.</small>':"")+'</td>';
 return'<table class="co-est"><thead><tr><th>Estimates <small>'+esc(ccy)+'</small></th>'+cols.map(x=>'<th title="Fiscal year ending '+esc(x.end||"")+'">'+esc(fy(x))+'</th>').join("")+'</tr></thead><tbody>'+
  '<tr><th>Revenue</th>'+cols.map(x=>cell(x.rev,x.rev_g,x.rev_n,big)).join("")+'</tr>'+
  '<tr><th>EPS</th>'+cols.map(x=>cell(x.eps,x.eps_g,x.eps_n,feps)).join("")+'</tr></tbody></table>';}
function consensus(c,r){const k=c&&c.cons;const has=k&&(k.analysts||isNum(k.target)||k.est);
 if(!has)return sec("coCons","Analyst consensus",empty("No analyst coverage on Yahoo for this name."));
 const px=c.px||(r&&r.px);const rk=k.rating&&RATING[k.rating];const ccy=ccyLab(c.ccy);
 const stats='<div class="co-stats">'+
  '<div><span class="co-tl">Mean target</span><b>'+fpx(k.target)+'</b><small>'+esc(isNum(k.target)?ccy:"")+'</small></div>'+
  '<div><span class="co-tl">Upside</span><b class="'+(isNum(k.upside)?(k.upside>=0?"up":"dn"):"")+'">'+pct(k.upside)+'</b></div>'+
  '<div><span class="co-tl">Rating</span><b>'+(rk?esc(rk):DASH)+'</b>'+(isNum(k.rating_mean)?'<small title="1 = strong buy … 5 = sell">'+k.rating_mean.toFixed(1)+' / 5</small>':"")+'</div>'+
  '<div><span class="co-tl">Analysts</span><b>'+(k.analysts||DASH)+'</b></div></div>';
 return sec("coCons","Analyst consensus",stats+rangeBar(k,px)+breakdown(k.breakdown)+estimates(k.est,c));}

function effMode(c){const f=c&&c.fin||{};const A=(f.annual||[]).length,Q=(f.quarterly||[]).length;
 return finMode==="annual"&&!A&&Q?"quarterly":finMode==="quarterly"&&!Q&&A?"annual":finMode;}
function finTable(c){const f=c&&c.fin;if(!f||(!(f.annual||[]).length&&!(f.quarterly||[]).length))return empty("No reported financials from Yahoo for this name.");
 const mode=effMode(c);let rows=mode==="annual"?(f.annual||[]).slice():(f.quarterly||[]).slice();
 const labs=rows.map(x=>mode==="annual"?"FY"+x.d.slice(2,4):mf.format(new Date(x.d+"T00:00:00Z")).replace(" ","\u00a0\u2019"));
 const tips=rows.map(x=>"Period ending "+x.d);
 if(mode==="annual"&&f.ttm&&(f.ttm.rev!=null||f.ttm.ebitda!=null)){rows.push(Object.assign({nd:null,ttm:1},f.ttm));labs.push("TTM");tips.push("Trailing twelve months to "+(f.ttm.d||""));}
 if(!rows.length)return empty(mode==="annual"?"No annual figures reported.":"No quarterly figures reported.");
 const margin=x=>isNum(x.ebitda)&&isNum(x.rev)&&x.rev>0?x.ebitda/x.rev*100:null;
 const L=[["Revenue","rev"],["EBITDA","ebitda"],["EBITDA margin","m"],["Net income","ni"],["Net debt","nd"],["Free cash flow","fcf"]];
 const td=(x,k)=>{if(k==="m"){const m=margin(x);return'<td class="co-m">'+(isNum(m)?m.toFixed(Math.abs(m)>=100?0:1)+"%":DASH)+'</td>';}
  const v=x[k];if(k==="nd"&&x.ttm)return'<td class="co-ttm" title="Balance-sheet item: see latest period">'+DASH+'</td>';
  return'<td class="'+(x.ttm?"co-ttm ":"")+(isNum(v)&&v<0&&k!=="nd"?"neg":"")+'"'+(k==="nd"&&isNum(v)&&v<0?' title="Net cash"':"")+'>'+big(v)+'</td>';};
 return'<div class="co-fin-wrap"><table class="co-fin"><thead><tr><th>'+esc(f.ccy||"")+'</th>'+labs.map((l,i)=>'<th title="'+esc(tips[i])+'"'+(rows[i].ttm?' class="co-ttm"':"")+'>'+esc(l)+'</th>').join("")+'</tr></thead><tbody>'+
  L.map(([l,k])=>'<tr'+(k==="m"?' class="co-mrow"':"")+'><th>'+l+'</th>'+rows.map(x=>td(x,k)).join("")+'</tr>').join("")+'</tbody></table></div>'+
  (c.fin_stale?'<p class="co-fine">Financials from an earlier fetch ('+esc(c.fin_stale.slice(0,10))+'); latest refresh failed.</p>':"");}
function financials(c){const seg='<div class="seg co-seg" role="group" aria-label="Period"><button class="button" type="button" data-fin="annual">Annual</button><button class="button" type="button" data-fin="quarterly">Quarterly</button></div>';
 return sec("coFin","Financials",'<div id="coFinBody">'+finTable(c)+'</div><p class="co-fine">Reporting currency'+(c&&c.fin&&c.fin.ccy?" ("+esc(c.fin.ccy)+")":"")+'. Net debt = total debt − cash &amp; short-term investments (negative = net cash). FCF = operating cash flow − capex.</p>',seg);}
function syncFin(c){const m=effMode(c);document.querySelectorAll("#coFin [data-fin]").forEach(b=>{const on=b.dataset.fin===m;b.classList.toggle("is-on",on);b.setAttribute("aria-pressed",on);});const fb=$("coFinBody");if(fb)fb.innerHTML=finTable(c);}

function dates(c){const d=c&&c.dates;if(!d)return sec("coDates","Key dates",empty("No calendar data."));const rows=[];
 const when=iso=>{const n=daysTo(iso);return n===0?"today":n===1?"tomorrow":n>1?"in "+n+" days":"";};
 if(d.earnings){const fut=daysTo(d.earnings)>=0;const t=dateTxt(d.earnings)+(d.earnings_to&&d.earnings_to!==d.earnings?" – "+dateTxt(d.earnings_to):"");
  rows.push([fut?"Next earnings":"Last earnings",esc(t)+(d.earnings_est?' <span class="co-pill">est.</span>':""),fut?when(d.earnings):"Next date not announced yet"]);}
 else rows.push(["Next earnings",DASH,""]);
 if(d.ex_div&&daysTo(d.ex_div)>-400){const fut=daysTo(d.ex_div)>=0;rows.push([fut?"Ex-dividend":"Last ex-dividend",esc(dateTxt(d.ex_div)),fut?when(d.ex_div):""]);}
 else rows.push(["Ex-dividend",DASH,c.val&&c.val.dy===0?"No dividend currently":""]);
 if(d.div_pay&&daysTo(d.div_pay)>-60)rows.push(["Dividend payment",esc(dateTxt(d.div_pay)),daysTo(d.div_pay)>=0?when(d.div_pay):""]);
 if(d.last_q)rows.push(["Latest reported quarter",esc(mfl.format(new Date(d.last_q+"T00:00:00Z"))),""]);
 return sec("coDates","Key dates",'<dl class="co-dates">'+rows.map(([l,v,s])=>'<div><dt>'+l+'</dt><dd>'+v+(s?'<small>'+esc(s)+'</small>':"")+'</dd></div>').join("")+'</dl>');}

function news(c,r){const name=(r&&r.name)||(c&&c.name)||cur;const items=newsFor(cur,name);
 const q='"'+cleanName((c&&c.long_name&&!/\b(ASA|AB|plc)\b/i.test(name)?name:name))+'"';
 const g="https://news.google.com/search?q="+encodeURIComponent(q)+"&hl=en-GB&gl=GB&ceid=GB:en";
 const list=items.length?'<ul class="co-news">'+items.map(it=>{const u=/^https?:\/\//i.test(it.url)?it.url:"#";return'<li><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(it.title)+'</a><span>'+(it.kind==="exchange"?'<span class="badge">Exchange</span>':"")+esc(it.source||"")+(it.time?' · '+esc(dfs.format(new Date(it.time))):"")+'</span></li>';}).join("")+'</ul>':empty("No recent headlines for this name in the site's news feed.");
 return sec("coNews","Latest news",list+'<a class="co-more" href="'+esc(g)+'" target="_blank" rel="noopener noreferrer">Search Google News for '+esc(cleanName(name))+' ↗</a>');}

function about(c){const p=c&&c.profile;if(!p||(!p.summary&&!p.website&&!p.country))return"";
 let host="";try{host=p.website?new URL(p.website).hostname.replace(/^www\./,""):"";}catch(e){}
 return sec("coAbout","About",(p.summary?'<p class="co-about">'+esc(p.summary)+'</p>':"")+'<p class="co-about-meta">'+[p.country?esc(p.country):"",host?'<a href="'+esc(p.website)+'" target="_blank" rel="noopener noreferrer">'+esc(host)+' ↗</a>':""].filter(Boolean).join(" · ")+'</p>');}

function render(){const body=$("coBody");const r=tableRow(cur);const c=CO&&CO.companies?CO.companies[cur]:null;head(c,r);
 if(!CO){body.innerHTML='<div class="co-loading"><span class="co-spin"></span>Loading company data…</div>';return;}
 let h=chartSec(r)+valuation(c)+consensus(c,r)+financials(c)+dates(c)+news(c,r)+about(c);
 const when=c&&c.fetched_at?dfs.format(new Date(c.fetched_at))+" Geneva":null;
 h+='<p class="co-note">Data: Yahoo Finance, may be incomplete for small caps.'+(when?' Fundamentals fetched '+esc(when)+'.':"")+(c&&c.stale?' Latest refresh failed; showing the previous values.':"")+(!c?' No fundamentals file entry for this symbol yet.':"")+' Not investment advice.</p>';
 body.innerHTML=h;
 body.querySelectorAll("[data-chart]").forEach(b=>b.onclick=()=>{chartMode=b.dataset.chart;drawChart(r);});
 body.querySelectorAll("[data-fin]").forEach(b=>b.onclick=()=>{finMode=b.dataset.fin;syncFin(c);});
 drawChart(r);syncFin(c);}

/* ---------- open / close ---------- */
const layer=()=>$("coLayer");
function show(sym){const L=layer();const was=!L.hidden&&L.classList.contains("is-open");const fresh=cur!==sym||L.hidden;
 if(cur!==sym)chartMode=null;cur=sym;clearTimeout(closing);
 if(!was){lastFocus=document.activeElement;L.hidden=false;document.body.classList.add("co-open");requestAnimationFrame(()=>requestAnimationFrame(()=>L.classList.add("is-open")));setTimeout(()=>$("coPanel").focus({preventScroll:true}),RM.matches?0:60);}
 render();if(fresh)$("coBody").scrollTop=0;
 if(!CO)loadCo().then(()=>{if(cur===sym&&!layer().hidden)render();}).catch(e=>{if(cur===sym)$("coBody").innerHTML='<p class="co-empty">Could not load company data ('+esc(e.message)+').</p>';});}
function hide(){const L=layer();if(L.hidden)return;L.classList.remove("is-open");document.body.classList.remove("co-open");
 closing=setTimeout(()=>{L.hidden=true;$("coBody").replaceChildren();cur=null;},RM.matches?0:280);
 if(lastFocus&&lastFocus.focus&&document.contains(lastFocus))lastFocus.focus({preventScroll:true});}
const hashSym=()=>{const m=location.hash.match(/^#co=([^&]+)/);try{return m?decodeURIComponent(m[1]):null;}catch(e){return null;}};
function open(sym){if(!sym)return;if(hashSym()!==sym){history.pushState({co:sym},"","#co="+encodeURIComponent(sym));pushed=true;}show(sym);}
function close(){if(hashSym()){if(pushed&&history.state&&history.state.co){pushed=false;history.back();return;}history.replaceState(null,"",location.pathname+location.search);}hide();}
function sync(){const s=hashSym();if(s){if(s===cur&&!layer().hidden)return;show(s);}else hide();}
window.addEventListener("popstate",sync);window.addEventListener("hashchange",sync);
document.addEventListener("keydown",e=>{if(e.key!=="Escape"||layer().hidden)return;const cm=$("chartModal");if(cm&&!cm.hidden)return;e.preventDefault();close();},true);
$("coClose").onclick=close;$("coBackdrop").onclick=close;
$("coChartBtn").onclick=()=>{const r=tableRow(cur);r&&window.MMTable&&window.MMTable.openChart&&window.MMTable.openChart(r);};
/* phone: swipe the sheet header down to close */
{let y0=null;const h=$("coHead");h.addEventListener("touchstart",e=>{y0=e.touches[0].clientY;},{passive:true});
 h.addEventListener("touchend",e=>{if(y0!=null&&e.changedTouches[0].clientY-y0>70&&PHONE.matches)close();y0=null;},{passive:true});}
/* focus trap */
$("coPanel").addEventListener("keydown",e=>{if(e.key!=="Tab")return;const f=[...$("coPanel").querySelectorAll('a[href],button:not([disabled]):not([hidden]),[tabindex="0"]')].filter(x=>x.offsetParent);if(!f.length)return;
 const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus();}});
window.MMCompany={open,close,ready(){const s=hashSym();if(!s)return;if(layer().hidden||cur!==s)show(s);else render();},has:sym=>!CO||!!(CO.companies&&CO.companies[sym])};
(window.requestIdleCallback||(f=>setTimeout(f,1500)))(()=>loadCo().catch(()=>{}));
})();
