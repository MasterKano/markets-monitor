/* Nordic Power tab: data/power.json (built by GitHub Actions from EEX settlements, day-ahead prices, NVE hydro).
   Real data only: null -> "n/a". Hand-rolled SVG charts (no libraries), Geneva time (CET/CEST) throughout.
   Chart labelling convention: title = what + where, unit after " · " (e.g. "SE4 day-ahead price by hour · €/MWh");
   subtitle = period · resolution · time zone · source; y-axis carries the unit; legend whenever > 1 series;
   tooltips show value + unit. */
(()=>{"use strict";
const TZ="Europe/Zurich";
const LS="markets-monitor:power:v2";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NA='<span class="na">n/a</span>';
const isNum=v=>typeof v==="number"&&isFinite(v);
const mean=a=>{const b=a.filter(isNum);return b.length?b.reduce((x,y)=>x+y,0)/b.length:null;};
const SPOT=["NO1","NO2","NO3","NO4","NO5","SE1","SE2","SE3","SE4","FI","DK1","DK2","DE-LU","PL","LT"];
const NORDIC=SPOT.slice(0,12);
const NEIGH=["DE-LU","PL","LT"];
const FUT_N=["Nordic","NO1","NO2","NO3","NO4","NO5","SE1","SE2","SE3","SE4","FI"];
const FUT_EU=["DE","FR","NL","GB","ES","IT"];
const ZNAME={Nordic:"Nordic system",DE:"Germany",FR:"France",NL:"Netherlands",GB:"Great Britain",ES:"Spain",IT:"Italy","DE-LU":"DE-LU"};
const COL={zone:"var(--accent)",sys:"var(--pw-sys)",de:"var(--pw-de)",prev:"var(--faint)",se3:"var(--pw-se3)",wind:"var(--pw-wind)"};
const FOCUS="SE4";
const SE_Z=["SE1","SE2","SE3","SE4"];
const st=Object.assign({day:"today",zone:"SE4",mode:"p",eu:false,tenor:null,bench:"Y",hz:"Norway"},(()=>{try{return JSON.parse(localStorage.getItem(LS)||"{}");}catch(e){return{};}})());
const save=()=>{try{localStorage.setItem(LS,JSON.stringify({day:st.day,zone:st.zone,mode:st.mode,eu:st.eu,bench:st.bench,hz:st.hz}));}catch(e){}};
let P=null,loading=null,shown=false;

/* ---------- formatting ---------- */
const fdate=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,weekday:"short",day:"2-digit",month:"short"});
const fdt=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
const fhr=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",hour12:false});
const fymd=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"});
const dayKey=(off=0)=>fymd.format(new Date(Date.now()+off*864e5));
const dlabel=k=>{if(!k)return"";const d=new Date(k+"T12:00:00Z");return fdate.format(d).replace("Sept","Sep");};
const tdlabel=k=>{if(!k)return"";const d=new Date(k+"T12:00:00Z");return d.toLocaleDateString("en-GB",{timeZone:"UTC",weekday:"short",day:"2-digit",month:"short",year:"numeric"}).replace("Sept","Sep");};
const sdate=k=>new Date(k+"T12:00:00Z").toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"}).replace("Sept","Sep");
function fp(v,d=2){return isNum(v)?v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):NA;}
function fpt(v,d=2){return isNum(v)?v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"n/a";}
function fs(v,d=2){if(!isNum(v))return NA;return(v>0?"+":v<0?"−":"")+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});}
function fst(v,d=2){if(!isNum(v))return"n/a";return(v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(d);}
function ago(iso){const m=(Date.now()-new Date(iso).getTime())/6e4;if(!isFinite(m))return"";if(m<1)return"just now";if(m<60)return Math.round(m)+"m ago";if(m<48*60)return Math.round(m/60)+"h ago";return Math.round(m/1440)+"d ago";}

/* ---------- labelling helpers ---------- */
const EUR="€/MWh";
const U=u=>String(u||"").replace(/^EUR\s*\/\s*/,"€/").replace(/^USD\s*\/\s*/,"$/");
const ftz=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,timeZoneName:"short"});
function tzName(ms){try{const p=ftz.formatToParts(new Date(ms)).find(x=>x.type==="timeZoneName");const v=p?p.value:"";if(v==="CET"||v==="CEST")return v;return/\+0?2/.test(v)?"CEST":"CET";}catch(e){return"CET";}}
const tzSpan=(a,b)=>{const x=tzName(a),y=tzName(b==null?a:b);return x===y?x:"CET/CEST";};
const hRange=(t0,n)=>dlabel(fymd.format(new Date(t0)))+" – "+dlabel(fymd.format(new Date(t0+(n-1)*36e5)));
/* card head: title (what + where) · unit, subtitle (period · resolution · tz · source), optional legend / controls */
function ttlHtml(title,unit){return title+(unit?'<span class="pw-u"> · '+unit+'</span>':"");}
function cardHead(title,unit,sub,keys,right){return'<div class="pw-card-head"><div class="pw-ttl"><strong class="panel-title">'+ttlHtml(title,unit)+'</strong>'+(sub?'<span class="pw-card-sub">'+sub+'</span>':"")+'</div>'+(keys?'<div class="pw-keys">'+keys+'</div>':"")+(right||"")+'</div>';}
function setHead(id,title,unit,sub){const t=$(id);if(t)t.innerHTML=ttlHtml(title,unit);const b=$(id+"Sub");if(b)b.innerHTML=sub||"";}
const headSlot=id=>'<div class="pw-ttl"><strong class="panel-title" id="'+id+'"></strong><span class="pw-card-sub" id="'+id+'Sub"></span></div>';
/* legend swatch drawn with the series' own dash pattern */
const keyHtml=s=>'<span class="pw-key"><svg class="pw-kl" viewBox="0 0 18 6" width="18" height="6" aria-hidden="true"><line x1="1" x2="17" y1="3" y2="3" style="stroke:'+s.color+';stroke-width:'+(s.dash?2:2.8)+(s.dash?';stroke-dasharray:'+s.dash.split(" ").map(x=>Math.max(1.6,x*.6).toFixed(1)).join(" "):"")+(s.op?';opacity:'+s.op:"")+'"/></svg>'+esc(s.name)+'</span>';
const keysHtml=ser=>ser.map(keyHtml).join("");
/* hourly multi-day axis: day names centred on noon, faint lines at local midnight, a "now" marker, tz in the corner */
const fdnum=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric"}),fdwd=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,weekday:"short",day:"numeric"});
function hAxis(t0,n,el){const days=Math.max(1,n/24),per=((el&&el.clientWidth)||600)/days;const hr=i=>fhr.format(new Date(t0+i*36e5));const now=Math.floor((Date.now()-t0)/36e5);
 return{xall:true,xunit:tzSpan(t0,t0+(n-1)*36e5),now:now>=0&&now<n?now:null,vline:i=>i>0&&hr(i)==="00",
  xlab:i=>{if(hr(i)!=="12")return null;const d=new Date(t0+i*36e5);return per>=78?dlabel(fymd.format(d)):per>=44?fdwd.format(d):fdnum.format(d);}};}
const tipTime=(t0,i)=>esc(fdt.format(new Date(t0+i*36e5)).replace("Sept","Sep"))+' '+tzName(t0+i*36e5);

/* ---------- price colour scale (EUR/MWh, fixed so days are comparable) ---------- */
const STOPS=[[-40,[196,48,58]],[-10,[229,72,77]],[0,[180,140,70]],[25,[78,184,104]],[60,[45,160,120]],[100,[56,140,200]],[160,[70,110,230]],[250,[86,104,255]],[350,[50,70,200]]];
function pcol(v,a){if(!isNum(v))return"transparent";let i=0;while(i<STOPS.length-2&&v>STOPS[i+1][0])i++;const[x0,c0]=STOPS[i],[x1,c1]=STOPS[i+1];const t=Math.max(0,Math.min(1,(v-x0)/(x1-x0)));const c=c0.map((q,j)=>Math.round(q+(c1[j]-q)*t));return a==null?"rgb("+c+")":"rgba("+c+","+a+")";}
function ink(v){if(!isNum(v))return"";return (v>=15&&v<95)?"#10141c":"#fff";}
function legend(){const xs=[-40,0,40,100,160,250,350];return'<div class="pw-legend"><span class="pw-lg-bar" style="background:linear-gradient(90deg,'+xs.map((x,i)=>pcol(x)+" "+(i/(xs.length-1)*100).toFixed(0)+"%").join(",")+')"></span><span class="pw-lg-ticks">'+xs.map(x=>"<i>"+(x<0?"−"+(-x):x)+"</i>").join("")+'</span><span class="pw-lg-unit">€/MWh · daily average</span></div>';}

/* ---------- tooltip ---------- */
let tip;function showTip(html,e){if(!tip){tip=document.createElement("div");tip.className="pw-tip";document.body.append(tip);}tip.innerHTML=html;tip.hidden=false;const r=tip.getBoundingClientRect();let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.left=Math.max(6,x)+"px";tip.style.top=Math.max(6,y)+"px";}
function hideTip(){if(tip)tip.hidden=true;}

/* ---------- generic SVG line chart ---------- */
function nice(lo,hi,n=5){if(!isNum(lo)||!isNum(hi))return[0,1,[0,1]];if(lo===hi){lo-=1;hi+=1;}const span=hi-lo,step0=span/n,mag=Math.pow(10,Math.floor(Math.log10(step0))),f=step0/mag,step=(f<1.5?1:f<3?2:f<7?5:10)*mag;const a=Math.floor(lo/step)*step,b=Math.ceil(hi/step)*step;const t=[];for(let v=a;v<=b+step/2;v+=step)t.push(Math.round(v/step)*step);return[a,b,t];}
function lineChart(el,o){
 const W=Math.max(280,el.clientWidth||600),H=o.h||(W<520?220:270),m={l:44,r:12,t:o.yunit?24:12,b:o.xgroups?40:26};
 const n=o.n;const gx=o.gap||0;const groups=o.groups||[];let gaps=0;const xs=[];for(let i=0;i<n;i++){if(i&&groups[i]!==groups[i-1])gaps++;xs.push(i+gaps*gx);}
 const xmax=Math.max(1,xs[n-1]||1);const X=i=>m.l+(n<2?0.5:xs[i]/xmax)*(W-m.l-m.r);
 let vals=[];o.series.forEach(s=>vals=vals.concat(s.vals.filter(isNum)));if(o.band)o.band.forEach(b=>{vals.push(b[1],b[3]);});vals=vals.filter(isNum);
 if(o.zero)vals.push(0);
 if(!vals.length){el.innerHTML='<div class="pw-empty">No data available</div>';return;}
 let[lo,hi,ticks]=nice(Math.min(...vals),Math.max(...vals),W<520?4:5);if(o.ymin!=null){lo=o.ymin;}if(o.ymax!=null){hi=o.ymax;}if(o.ymin!=null||o.ymax!=null)ticks=nice(lo,hi,5)[2].filter(t=>t>=lo&&t<=hi);
 const Y=v=>m.t+(1-(v-lo)/(hi-lo))*(H-m.t-m.b);
 let s='<svg class="pw-svg" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img"'+(o.label?' aria-label="'+esc(o.label)+'"':"")+'>';
 ticks.forEach(t=>{s+='<line class="g" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+Y(t).toFixed(1)+'" y2="'+Y(t).toFixed(1)+'"/><text class="yt" x="'+(m.l-6)+'" y="'+(Y(t)+3.5).toFixed(1)+'">'+(o.yfmt?o.yfmt(t):t)+'</text>';});
 if(o.yunit)s+='<text class="yu" x="2" y="12">'+esc(o.yunit)+'</text>';
 if(o.vline)for(let i=0;i<n;i++)if(o.vline(i))s+='<line class="vg" x1="'+X(i).toFixed(1)+'" x2="'+X(i).toFixed(1)+'" y1="'+m.t+'" y2="'+(H-m.b)+'"/>';
 if(o.now!=null&&o.now>=0&&o.now<n){const x=X(o.now).toFixed(1);s+='<line class="nw" x1="'+x+'" x2="'+x+'" y1="'+m.t+'" y2="'+(H-m.b)+'"/><text class="nwt" x="'+(+x+3)+'" y="'+(m.t+9)+'">now</text>';}
 if(o.zero&&lo<0&&hi>0)s+='<line class="z" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+Y(0).toFixed(1)+'" y2="'+Y(0).toFixed(1)+'"/>';
 if(o.band){const B=o.band.filter(b=>isNum(b[1])&&isNum(b[3]));if(B.length){const up=B.map(b=>X(b[0]).toFixed(1)+" "+Y(b[3]).toFixed(1)),dn=B.slice().reverse().map(b=>X(b[0]).toFixed(1)+" "+Y(b[1]).toFixed(1));s+='<path class="band" d="M'+up.join("L")+"L"+dn.join("L")+'Z"/>';s+='<path class="band-mid" d="M'+B.map(b=>X(b[0]).toFixed(1)+" "+Y(b[2]).toFixed(1)).join("L")+'"/>';}}
 // x labels
 const step=Math.max(1,Math.ceil(n/((W-m.l-m.r)/(o.xw||46))));
 for(let i=0;i<n;i++){const lab=o.xlab(i);if(lab==null)continue;if(!o.xall&&i%step&&i!==n-1)continue;s+='<text class="xt" x="'+X(i).toFixed(1)+'" y="'+(H-m.b+14)+'">'+esc(lab)+'</text>';}
 if(o.xunit)s+='<text class="xu" x="'+(m.l-9)+'" y="'+(H-m.b+14)+'">'+esc(o.xunit)+'</text>';
 if(o.xgroups){const seen={};groups.forEach((g,i)=>{(seen[g]=seen[g]||[]).push(i);});Object.entries(seen).forEach(([g,ix])=>{const a=X(ix[0]),b=X(ix[ix.length-1]);s+='<line class="grp" x1="'+(a-4)+'" x2="'+(b+4)+'" y1="'+(H-14)+'" y2="'+(H-14)+'"/><text class="gt" x="'+((a+b)/2).toFixed(1)+'" y="'+(H-3)+'">'+esc(o.xgroups[g]||"")+'</text>';});}
 o.series.forEach(se=>{let d="",pen=false;for(let i=0;i<n;i++){const v=se.vals[i];if(!isNum(v)||(i&&groups.length&&groups[i]!==groups[i-1])){pen=false;}if(!isNum(v))continue;d+=(pen?"L":"M")+X(i).toFixed(1)+" "+Y(v).toFixed(1);pen=true;}
  s+='<path class="ln" d="'+d+'" style="stroke:'+se.color+';stroke-width:'+(se.w||2)+(se.dash?';stroke-dasharray:'+se.dash:"")+(se.op?';opacity:'+se.op:"")+'"/>';
  if(se.dots)for(let i=0;i<n;i++){const v=se.vals[i];if(isNum(v))s+='<circle class="dt" cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="'+(se.r||2.6)+'" style="fill:'+se.color+'"/>';}
  if(se.end){let li=-1;for(let i=n-1;i>=0;i--)if(isNum(se.vals[i])){li=i;break;}if(li>=0)s+='<circle cx="'+X(li).toFixed(1)+'" cy="'+Y(se.vals[li]).toFixed(1)+'" r="3.4" style="fill:'+se.color+'"/>';}});
 s+='<line class="hair" x1="0" x2="0" y1="'+m.t+'" y2="'+(H-m.b)+'" visibility="hidden"/><rect class="hit" x="'+m.l+'" y="'+m.t+'" width="'+(W-m.l-m.r)+'" height="'+(H-m.t-m.b)+'"/></svg>';
 el.innerHTML=s;
 const svg=el.querySelector("svg"),hair=svg.querySelector(".hair"),hit=svg.querySelector(".hit");
 const move=e=>{const r=svg.getBoundingClientRect();const px=(e.clientX-r.left)*W/r.width;let bi=0,bd=1e9;for(let i=0;i<n;i++){const d=Math.abs(X(i)-px);if(d<bd){bd=d;bi=i;}}hair.setAttribute("x1",X(bi));hair.setAttribute("x2",X(bi));hair.setAttribute("visibility","visible");showTip(o.tip(bi),e);};
 hit.addEventListener("pointermove",move);hit.addEventListener("pointerleave",()=>{hair.setAttribute("visibility","hidden");hideTip();});}
function sparkSvg(v,w=110,h=30){const p=v.filter(isNum);if(p.length<2)return"";let mn=Math.min(...p),mx=Math.max(...p);if(mx===mn)mx=mn+1;const pts=v.map((q,i)=>isNum(q)?[(i/(v.length-1))*w,h-3-((q-mn)/(mx-mn))*(h-6)]:null).filter(Boolean);const d=pts.map((q,i)=>(i?"L":"M")+q[0].toFixed(1)+" "+q[1].toFixed(1)).join("");const up=p[p.length-1]>=p[0];const c=up?"var(--good)":"var(--bad)";const l=pts[pts.length-1];
 return'<svg class="spark" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" aria-hidden="true"><path d="'+d+'L'+l[0].toFixed(1)+' '+h+'L0 '+h+'Z" fill="'+c+'" opacity=".12"/><path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="1.5" stroke-linejoin="round"/><circle cx="'+l[0].toFixed(1)+'" cy="'+l[1].toFixed(1)+'" r="2.2" fill="'+c+'"/></svg>';}
function heat(v,scale){if(!isNum(v)||!scale)return"";const h=Math.min(1,Math.abs(v)/scale);return' style="--h:'+(Math.round(h*100)/100)+'" data-s="'+(v>0?"p":v<0?"n":"z")+'"';}
function seg(id,opts,cur){return'<div class="seg pw-seg" id="'+id+'" role="group">'+opts.map(([k,l,dis,t])=>'<button type="button" class="button'+(k===cur?" is-on":"")+'" data-k="'+esc(k)+'"'+(dis?" disabled":"")+(t?' title="'+esc(t)+'"':"")+'>'+l+'</button>').join("")+'</div>';}
function bindSeg(id,fn){const el=$(id);if(!el)return;el.querySelectorAll("button[data-k]").forEach(b=>b.onclick=()=>fn(b.dataset.k));}

/* ---------- spot helpers ---------- */
const Z=z=>P&&P.spot&&P.spot.zones&&P.spot.zones[z]||null;
function dayRec(z,k){const r=Z(z);return r&&r.days&&r.days[k]||null;}
function dayAvg(z,k){const r=dayRec(z,k);if(r&&isNum(r.avg))return r.avg;const zz=Z(z);if(!zz)return null;const f=(zz.daily||[]).find(x=>x[0]===k);return f?f[1]:null;}
function winAvg(z,endKey,n){const zz=Z(z);if(!zz||!endKey)return null;const m=new Map(zz.daily||[]);const e=new Date(endKey+"T12:00:00Z");const vals=[];for(let i=0;i<n;i++){const k=new Date(e.getTime()-i*864e5).toISOString().slice(0,10);const v=m.get(k);if(!isNum(v))return null;vals.push(v);}return mean(vals);}
function nordicAvg(k,fn){const v=NORDIC.map(z=>fn(z,k));return v.every(isNum)?mean(v):null;}
const dayVal=(z,k)=>z==="NordicAvg"?nordicAvg(k,dayAvg):dayAvg(z,k);
const w7=(z,k)=>z==="NordicAvg"?nordicAvg(k,(zz,kk)=>winAvg(zz,kk,7)):winAvg(z,k,7);
const w30=(z,k)=>z==="NordicAvg"?nordicAvg(k,(zz,kk)=>winAvg(zz,kk,30)):winAvg(z,k,30);
function keys(){const t=dayKey(0),m=dayKey(1);const has=k=>SPOT.some(z=>dayRec(z,k));return{today:t,tomorrow:m,hasT:has(t),hasM:has(m)};}

/* ---------- layout ---------- */
function shell(){const v=$("powerView");v.innerHTML=
 '<div class="pw-kpis pw-kpis-focus" id="pwFocusKpis" aria-label="SE4 key figures"></div>'+
 '<div class="pw-kpis pw-kpis-nordic" id="pwKpis"></div>'+
 '<div class="pw-stamps" id="pwStamps"></div>'+
 '<section class="pw-sec" id="pwSecSpot"><h2 class="pw-h">Day-ahead <span class="pw-sub">spot prices by bidding zone · €/MWh · CET delivery day · times CET/CEST (Geneva)</span></h2>'+
 '<div class="pw-grid pw-grid-da">'+
  '<section class="pw-card pw-map-card"><div class="pw-card-head">'+headSlot("pwMapTitle")+'<div id="pwDaySeg"></div></div><div class="pw-map" id="pwMap"></div><div id="pwLegend"></div><div class="pw-side"><div class="pw-mini-h">Key spreads <em>€/MWh · day-ahead daily average, first zone − second</em></div><div class="pw-tbl-wrap"><table class="pw-tbl" id="pwSpreads"></table></div><div id="pwCapture"></div></div></section>'+
  '<section class="pw-card pw-heat-card"><div class="pw-card-head">'+headSlot("pwHeatTitle")+'<span class="pw-note" id="pwHeatNote"></span></div><div class="pw-heat-wrap" id="pwHeat"></div>'+
  '<div class="pw-side"><div class="pw-mini-h">Day-ahead price averages <em>€/MWh · Today / Tmrw = daily average of the delivery day · 7d / 30d = mean of the 7 / 30 delivery days ending today</em></div><div class="pw-tbl-wrap"><table class="pw-tbl" id="pwAvg"></table></div></div></section>'+
 '</div></section>'+
 '<section class="pw-sec" id="pwSecFw"><h2 class="pw-h">Forwards <span class="pw-sub">EEX base-load futures, daily settlement · €/MWh</span></h2>'+
 '<div class="pw-grid pw-grid-fw">'+
  '<section class="pw-card"><div class="pw-card-head">'+headSlot("pwCurveTitle")+'<div class="pw-keys" id="pwCurveKeys"></div></div><div class="pw-chips" id="pwZoneChips"></div><div class="pw-chart" id="pwCurve"></div></section>'+
  '<section class="pw-card"><div class="pw-card-head">'+headSlot("pwPremTitle")+'<div id="pwPremSeg"></div></div><div class="pw-bars" id="pwPrem"></div><div class="pw-mini-h" id="pwHistTitle"></div><div class="pw-keys pw-pad" id="pwHistKeys"></div><div class="pw-chart" id="pwHist"></div></section>'+
 '</div>'+
 '<section class="pw-card pw-full"><div class="pw-card-head">'+headSlot("pwFwTitle")+'<div class="pw-tools"><div id="pwModeSeg"></div><button class="button" id="pwEu" type="button">+ Europe</button></div></div><div class="pw-tbl-wrap pw-fw-wrap"><table class="pw-tbl pw-fw" id="pwFw"></table></div><p class="pw-foot" id="pwFwFoot"></p></section></section>'+
 '<section class="pw-sec" id="pwSecDrv"><h2 class="pw-h">Drivers <span class="pw-sub">fuels, carbon and GoO (EEX / ICE settlements) · hydro reservoirs</span></h2>'+
 '<div class="pw-mini-h pw-sec-h">Fuels · carbon · GoO <em>latest settlement in the unit shown · line = settlements since 1 Sep</em></div>'+
 '<div class="pw-drivers" id="pwDrivers"></div>'+
 '<div class="pw-mini-h pw-sec-h">Hydro <em>reservoir filling (% of capacity) and stored energy (GWh / TWh)</em></div>'+
 '<div class="pw-grid pw-grid-hy">'+
  '<section class="pw-card"><div class="pw-card-head">'+headSlot("pwHyTitle")+'<div class="pw-keys" id="pwHyKeys"></div></div><div class="pw-chips" id="pwHyChips"></div><div class="pw-chart" id="pwHydro"></div></section>'+
  '<section class="pw-card" id="pwHySide"></section>'+
 '</div>'+
 '<section class="pw-card pw-full" id="pwRes" hidden></section>'+
 '</section>'+
 '<section class="pw-sec" id="pwSecSE4"><h2 class="pw-h">SE4 <span class="pw-sub">southern Sweden · prices, wind, load, flows and outages (ENTSO-E Transparency, Svenska kraftnät, EEX)</span></h2>'+
 '<div class="pw-grid pw-grid-se4">'+
  '<section class="pw-card"><div class="pw-card-head">'+headSlot("pwS4HourTitle")+'<div class="pw-keys" id="pwS4HourKeys"></div></div><div class="pw-chart" id="pwS4Hour"></div></section>'+
  '<section class="pw-card"><div class="pw-card-head">'+headSlot("pwS4DayTitle")+'<div class="pw-keys" id="pwS4DayKeys"></div></div><div class="pw-chart" id="pwS4Day"></div></section>'+
 '</div>'+
 '<section class="pw-card pw-s4-wide" id="pwS4Wind" hidden></section>'+
 '<div class="pw-grid pw-grid-se4">'+
  '<section class="pw-card" id="pwS4Value" hidden></section>'+
  '<section class="pw-card" id="pwS4Svk"></section>'+
 '</div>'+
 '<div class="pw-grid pw-grid-se4">'+
  '<section class="pw-card" id="pwS4Flows"></section>'+
  '<section class="pw-card"><div class="pw-card-head">'+headSlot("pwS4FwTitle")+'</div><div class="pw-tbl-wrap pw-s4fw-wrap"><table class="pw-tbl" id="pwS4Fw"></table></div><p class="pw-foot">All figures €/MWh. EPAD = SE4 zonal future − Nordic system future (same tenor). Click a row to show SE4 in the forward curve.</p></section>'+
 '</div>'+
 '<div class="pw-grid pw-grid-se4">'+
  '<section class="pw-card" id="pwS4Out" hidden></section>'+
  '<section class="pw-card" id="pwS4Mix"></section>'+
 '</div>'+
 '</section>'+
 '<p class="pw-foot pw-credits" id="pwCredits"></p>';}

/* ---------- KPIs + stamps ---------- */
function kpi(label,val,sub,cls,title){return'<div class="pw-kpi'+(cls?" "+cls:"")+'"'+(title?' title="'+esc(title)+'"':"")+'><span class="pw-kpi-l">'+label+'</span><b>'+val+'</b><span class="pw-kpi-s">'+(sub||"")+'</span></div>';}
function renderKpis(){const K=keys(),E=P.eex,H=P.hydro&&P.hydro.no;const t=K.today;let h="";
 const na=dayVal("NordicAvg",t),de=dayVal("DE-LU",t);
 h+=kpi("Nordic avg · today",isNum(na)?fp(na)+'<small> €/MWh</small>':NA,isNum(na)&&isNum(de)?"vs DE-LU "+fs(na-de):"simple mean of 12 zones","","Unweighted mean of the 12 Nordic bidding-zone day-ahead averages (not the Nord Pool system price)");
 h+=kpi("DE-LU · today",isNum(de)?fp(de)+'<small> €/MWh</small>':NA,K.hasM?"tomorrow "+fpt(dayVal("DE-LU",K.tomorrow)):"tomorrow n/a yet");
 const sys=E&&E.zones&&E.zones.Nordic,fm=E&&E.bench&&E.bench.M,fy=E&&E.bench&&E.bench.Y;
 if(sys&&fm&&sys[fm])h+=kpi("Nordic system · "+esc(fm),fp(sys[fm].p)+(isNum(sys[fm].p)?'<small> €/MWh</small>':""),"1D "+fs(sys[fm].d1)+" · 1W "+fs(sys[fm].w1),"","EEX Nordic system price base month future, settlement "+(E.asof||""));
 if(E&&fy&&sys&&sys[fy]&&E.zones.DE&&E.zones.DE[fy]){const a=sys[fy].p,b=E.zones.DE[fy].p;h+=kpi("Nordic vs DE · "+esc(fy),isNum(a)&&isNum(b)?fs(a-b)+'<small> €/MWh</small>':NA,"Nordic "+fpt(a)+" · DE "+fpt(b),"","EEX base-load "+fy+" settlement, Nordic system minus Germany");}
 if(H&&H.regions&&H.regions.Norway&&H.regions.Norway.last){const L=H.regions.Norway.last;const b=(H.regions.Norway.band||[]).find(x=>x[0]===L.week);const dv=b&&isNum(L.fill)?L.fill-b[2]:null;h+=kpi("Norway reservoirs · wk "+L.week,fp(L.fill,1)+"%",isNum(dv)?fs(dv,1)+" pp vs median":"","pw-"+(isNum(dv)?(dv<0?"dn":"up"):""),"NVE: filling "+L.fill+"% ("+L.twh+" of "+L.cap+" TWh); median 2006–2025 for the week "+(b?b[2]+"%":"n/a"));}
 const ttf=E&&(E.drivers||[]).find(d=>d.key==="ttf_m");if(ttf)h+=kpi("TTF · "+esc((ttf.contract||"").replace("Gas Month ","")),fp(ttf.p)+(isNum(ttf.p)?'<small> '+esc(U(ttf.unit))+'</small>':""),"1D "+fs(ttf.d1)+" · since 1 Sep "+fs(ttf.s1));
 $("pwKpis").innerHTML=h;
 const sp=P.spot,stamps=[];
 if(E)stamps.push('<span><i class="pw-dot"></i>EEX settlements <b>'+esc(tdlabel(E.asof))+'</b> <em>(history from 1 Sep 2026)</em></span>');else stamps.push('<span class="bad">EEX n/a</span>');
 if(sp&&sp.asof)stamps.push('<span><i class="pw-dot"></i>Day-ahead fetched <b>'+esc(fdt.format(new Date(sp.asof)))+'</b> · '+esc(ago(sp.asof))+' · '+esc((sp.sources||[]).join(", ")||"no source")+'</span>');else stamps.push('<span class="bad">Day-ahead n/a</span>');
 if(H&&H.regions&&H.regions.Norway&&H.regions.Norway.last)stamps.push('<span><i class="pw-dot"></i>NVE hydro <b>week '+H.regions.Norway.last.week+'</b> (to '+esc(dlabel(H.regions.Norway.last.date))+')</span>');
 {const e=EN();if(e)stamps.push('<span><i class="pw-dot"></i>ENTSO-E Transparency <b>'+esc(e.asof?fdt.format(new Date(e.asof)):"")+'</b>'+((e.stale||[]).length?' <em>('+e.stale.length+' part(s) from an earlier build)</em>':"")+'</span>');}
 if(P.svk&&P.svk.zones)stamps.push('<span><i class="pw-dot"></i>Svenska kraftnät load / flows'+(P.svk.errors&&P.svk.errors.length?' <em>('+P.svk.errors.length+' part(s) n/a)</em>':'')+'</span>');
 const se=P.hydro&&P.hydro.se;if(se)stamps.push('<span><i class="pw-dot"></i>Energiföretagen <b>week '+se.week+'</b></span>');
 stamps.push('<span>Built '+esc(fdt.format(new Date(P.generated_utc)))+' Geneva</span>');
 if(P.errors&&P.errors.length)stamps.push('<span class="bad" title="'+esc(P.errors.map(e=>e.section+": "+e.error).join("\n"))+'">'+P.errors.length+' source error(s)</span>');
 $("pwStamps").innerHTML=stamps.join("");}

/* ---------- map ---------- */
function renderMap(){const M=window.PW_MAP,K=keys();const k=st.day==="tomorrow"?K.tomorrow:K.today;
 $("pwDaySeg").innerHTML=seg("pwDay",[["today","Today · "+esc(dlabel(K.today)),false],["tomorrow","Tomorrow · "+esc(dlabel(K.tomorrow)),!K.hasM,K.hasM?"":"Not published yet (day-ahead auction results ~12:45 CET)"]],st.day);
 bindSeg("pwDay",d=>{st.day=d;save();renderDA();});
 if(!M){$("pwMap").innerHTML='<div class="pw-empty">Map geometry not loaded</div>';return;}
 const zmap={DE:"DE-LU"};let s='<svg class="pw-mapsvg" viewBox="0 0 '+M.w+' '+M.h+'" role="img" aria-label="Map of Nordic bidding zones coloured by day-ahead average">';
 const order=["EE","LV","LT","PL","NL","DE","DK1","DK2","NO1","NO2","NO3","NO4","NO5","SE1","SE2","SE3","SE4","FI"];
 order.forEach(id=>{const g=M.z[id];if(!g)return;const z=zmap[id]||id;const live=SPOT.includes(z);const v=live?dayVal(z,k):null;
  s+='<path class="pw-zone'+(live?" live":" ctx")+(live&&!isNum(v)?" nodata":"")+'" data-z="'+z+'" d="'+g.d+'"'+(live&&isNum(v)?' style="fill:'+pcol(v)+'"':"")+'/>';});
 order.forEach(id=>{const g=M.z[id];const z=zmap[id]||id;if(!g||!g.c||!SPOT.includes(z))return;const v=dayVal(z,k);let[x,y]=g.c;if(id==="DE")y=Math.min(y,M.h-14);
  s+='<g class="pw-lbl" transform="translate('+x+' '+y+')"><text class="z" y="-4">'+esc(z)+'</text><text class="v" y="13">'+(isNum(v)?Math.round(v):"n/a")+'</text></g>';});
 s+="</svg>";$("pwMap").innerHTML=s;$("pwLegend").innerHTML=legend();
 {const r4=dayRec(FOCUS,k)||dayRec("SE3",k);const srcs=(P.spot&&P.spot.sources||[]).join(", ");
  setHead("pwMapTitle","Daily average day-ahead price by zone",EUR,(st.day==="tomorrow"?"Tomorrow":"Today")+" · "+esc(dlabel(k))+" · mean of all "+(r4&&r4.res===15?"15-min":"hourly")+" prices in the delivery day (CET)"+(srcs?" · "+esc(srcs):""));}
 $("pwMap").querySelectorAll("path.live").forEach(p=>{const z=p.dataset.z;p.addEventListener("pointermove",e=>{const r=dayRec(z,k),v=dayVal(z,k);const src=Z(z)&&Z(z).src;showTip('<b>'+esc(z)+'</b> · day-ahead · '+esc(dlabel(k))+'<br>Daily average <b>'+fpt(v)+'</b> €/MWh'+(r?'<br>Min '+fpt(r.min)+' · Max '+fpt(r.max)+' €/MWh <span class="src">('+(r.res===15?"15-min":"hourly")+')</span>'+(r.neg?'<br><span class="neg-t">'+r.neg+' negative '+(r.res===15?"15-min periods":"hours")+'</span>':""):"")+'<br>7d avg '+fpt(w7(z,K.today))+' · 30d '+fpt(w30(z,K.today))+' €/MWh'+(src?'<br><span class="src">'+esc(src)+'</span>':""),e);});p.addEventListener("pointerleave",hideTip);p.addEventListener("click",()=>{if(FUT_N.includes(z)){st.zone=z;save();renderFw();}});});}

/* ---------- heatmap ---------- */
function renderHeat(){const K=keys();const k=st.day==="tomorrow"?K.tomorrow:K.today;
 const recs=SPOT.map(z=>[z,dayRec(z,k)]);const any=recs.find(r=>r[1]);
 setHead("pwHeatTitle","Day-ahead price by zone and hour",EUR,esc(dlabel(k))+" · hourly · times CET/CEST");
 if(!any){$("pwHeat").innerHTML='<div class="pw-empty">'+(st.day==="tomorrow"?"Tomorrow's day-ahead prices are not published yet (auction results ~12:45 CET; this page refreshes ~14:30 Geneva daily).":"No day-ahead prices for today in the current data.")+'</div>';$("pwHeatNote").textContent="";return;}
 // hour columns from the longest record (23/24/25 h on DST days)
 const ref=recs.map(r=>r[1]).filter(Boolean).sort((a,b)=>b.h.length-a.h.length)[0];const t0=new Date(ref.t0).getTime();const nH=ref.h.length;
 let h='<table class="pw-heat"><thead><tr><th class="c-z" title="Bidding zone; columns are hours starting at the time shown ('+tzName(t0)+')">Zone</th>';for(let i=0;i<nH;i++)h+='<th>'+fhr.format(new Date(t0+i*36e5))+'</th>';h+='<th class="c-avg" title="Daily average of all periods in the delivery day, €/MWh">Avg</th></tr></thead><tbody>';
 recs.forEach(([z,r])=>{h+='<tr'+(z===FOCUS?' class="focus"':z===NEIGH[0]?' class="nb-first"':'')+'><th class="c-z" scope="row">'+esc(z)+'</th>';if(!r){h+='<td colspan="'+(nH+1)+'" class="pw-nodata">n/a</td></tr>';return;}
  const off=Math.round((new Date(r.t0).getTime()-t0)/36e5);
  for(let i=0;i<nH;i++){const v=r.h[i-off];if(!isNum(v)){h+='<td class="na-c">·</td>';continue;}h+='<td class="'+(v<0?"neg":"")+'" style="background:'+pcol(v)+';color:'+ink(v)+'" data-z="'+esc(z)+'" data-i="'+i+'">'+(v<0&&Math.round(v)===0?"−0":Math.round(v)<0?"−"+Math.abs(Math.round(v)):Math.round(v))+'</td>';}
  const a=isNum(r.avg)?r.avg:null;h+='<td class="c-avg"'+(isNum(a)?' style="background:'+pcol(a,.9)+';color:'+ink(a)+'"':"")+(r.full?"":' title="Incomplete day in source data"')+'>'+(isNum(a)?a.toFixed(1):"n/a")+'</td></tr>';});
 h+="</tbody></table>";$("pwHeat").innerHTML=h;
 const negs=recs.filter(r=>r[1]&&r[1].neg).map(r=>r[0]);const tz=tzSpan(t0,t0+(nH-1)*36e5);
 setHead("pwHeatTitle","Day-ahead price by zone and hour",EUR,esc(dlabel(k))+" · columns = hour starting ("+tz+")"+(ref.res===15?", mean of 4 × 15-min prices":"")+" · Avg = daily average");
 $("pwHeatNote").innerHTML=""+(negs.length?' · <span class="neg-t">negative prices: '+esc(negs.join(", "))+'</span>':"");
 $("pwHeat").querySelectorAll("td[data-z]").forEach(td=>{td.addEventListener("pointermove",e=>{const z=td.dataset.z,i=+td.dataset.i;const r=dayRec(z,k);const off=Math.round((new Date(r.t0).getTime()-t0)/36e5);const v=r.h[i-off];const a=new Date(t0+i*36e5),b=new Date(t0+(i+1)*36e5);
  showTip('<b>'+esc(z)+'</b> · '+esc(dlabel(k))+' '+fhr.format(a)+':00–'+fhr.format(b)+':00 '+tzName(a.getTime())+'<br>Day-ahead <b>'+fpt(v)+'</b> €/MWh'+(r.res===15?' <span class="src">(mean of 4 × 15-min)</span>':""),e);});td.addEventListener("pointerleave",hideTip);});}

/* ---------- averages + spreads ---------- */
function renderAvg(){const K=keys();const t=K.today,m=K.tomorrow;
 let h='<thead><tr><th class="c-z">Zone</th><th>Today</th><th>Tmrw</th><th title="Mean of the 7 delivery days ending today">7d</th><th title="Mean of the 30 delivery days ending today">30d</th><th title="Today\'s min and max (15-min or hourly resolution as published)">Min / max</th><th title="Number of negative-price periods today (15-min or hourly)">Neg.</th></tr></thead><tbody>';
 const row=(z,lab,cls)=>{const r=dayRec(z,t);const a=dayVal(z,t),b=dayVal(z,m),c=w7(z,t),d=w30(z,t);const cell=v=>'<td class="num"'+(isNum(v)?' style="--pc:'+pcol(v)+'"':"")+'>'+(isNum(v)?'<i class="pw-sw"></i>'+v.toFixed(1):NA)+'</td>';
  return'<tr class="'+(cls||"")+(z===FOCUS?" focus":"")+'"><th class="c-z" scope="row"'+(z==="NordicAvg"?' title="Unweighted mean of the 12 Nordic zones (needs all 12)"':"")+'>'+lab+'</th>'+cell(a)+cell(b)+cell(c)+cell(d)+'<td class="num mm">'+(r?'<span class="'+(r.min<0?"neg-t":"")+'">'+fpt(r.min,0)+'</span> / '+fpt(r.max,0):NA)+'</td><td class="num">'+(r?(r.neg?'<span class="neg-t">'+r.neg+(r.res===15?"×15m":"h")+'</span>':"0"):NA)+'</td></tr>';};
 SPOT.forEach(z=>h+=row(z,esc(z),z===NEIGH[0]?"nb-first":(NEIGH.includes(z)?"nb":"")));h+=row("NordicAvg","Nordic avg","sum");
 $("pwAvg").innerHTML=h+"</tbody>";
 const SP=[["SE4 − SE3","SE4","SE3"],["SE4 − DE-LU","SE4","DE-LU"],["SE2 − SE4","SE2","SE4"],["SE3 − FI","SE3","FI"],["NO2 − DE","NO2","DE-LU"],["Nordic avg − DE","NordicAvg","DE-LU"]];
 let s='<thead><tr><th class="c-z">Spread</th><th>Today</th><th>Tmrw</th><th>7d</th><th>30d</th></tr></thead><tbody>';
 SP.forEach(([l,a,b])=>{const f=(fn,k)=>{const x=fn(a,k),y=fn(b,k);return isNum(x)&&isNum(y)?x-y:null;};const vs=[f(dayVal,t),f(dayVal,m),f(w7,t),f(w30,t)];
  s+='<tr><th class="c-z" scope="row">'+esc(l)+'</th>'+vs.map(v=>'<td class="num heat"'+heat(v,40)+'>'+fs(v,1)+'</td>').join("")+'</tr>';});
 $("pwSpreads").innerHTML=s+"</tbody>";
 const C=P.capture&&P.capture.zones;let c="";if(C&&Object.keys(C).length){const c0=Object.values(C)[0]||{};c='<div class="pw-mini-h" title="Computed here: generation-weighted average day-ahead price over the period; not a published series">Capture prices <em>€/MWh · '+(c0.start&&c0.end?esc(sdate(c0.start))+' – '+esc(sdate(c0.end)):"last 30 days")+' · % = capture ÷ baseload · computed</em></div><div class="pw-tbl-wrap"><table class="pw-tbl"><thead><tr><th class="c-z">Zone</th><th title="Time-average day-ahead price">Baseload</th><th title="Wind-weighted day-ahead price and capture rate">Wind</th><th title="Solar-weighted day-ahead price and capture rate">Solar</th></tr></thead><tbody>';
  Object.entries(C).forEach(([z,r])=>{const f=x=>x?fp(x.cap,1)+' <span class="pw-ratio">'+(isNum(x.ratio)?Math.round(x.ratio*100)+"%":"")+'</span>':NA;const base=(r.wind||r.solar||{}).base;c+='<tr><th class="c-z">'+esc(z)+'</th><td class="num">'+fp(base,1)+'</td><td class="num">'+f(r.wind)+'</td><td class="num">'+f(r.solar)+'</td></tr>';});
  c+='</tbody></table></div>';}
 $("pwCapture").innerHTML=c;}
function renderDA(){renderMap();renderHeat();renderAvg();}

/* ---------- forwards ---------- */
const GL={M:"Months",Q:"Quarters",Y:"Years"};
function renderFw(){const E=P.eex;if(!E){["pwCurve","pwPrem","pwHist"].forEach(id=>$(id).innerHTML='<div class="pw-empty">EEX settlements not available</div>');$("pwFw").innerHTML="";return;}
 if(!FUT_N.includes(st.zone))st.zone="SE4";
 const T=E.tenors,zn=E.zones;
 // zone chips
 $("pwZoneChips").innerHTML=FUT_N.map(z=>'<button type="button" class="chip'+(z===st.zone?" is-on":"")+'" data-z="'+z+'">'+esc(z==="Nordic"?"System":z)+'</button>').join("");
 $("pwZoneChips").querySelectorAll(".chip").forEach(b=>b.onclick=()=>{st.zone=b.dataset.z;save();renderFw();});
 const zl=st.zone==="Nordic"?"Nordic system":st.zone;
 setHead("pwCurveTitle",esc(zl)+" forward curve",EUR,"EEX base-load futures · settlement "+esc(tdlabel(E.asof))+" · vs Nordic system, Germany and "+esc(zl)+" a week earlier");
 const v=(z,c)=>zn[z]&&zn[z][c]?zn[z][c].p:null;
 const ser=[{name:zl+" a week earlier",color:COL.prev,dash:"3 4",w:1.4,vals:T.map(t=>{const r=zn[st.zone]&&zn[st.zone][t.c];return r&&isNum(r.p)&&isNum(r.w1)?r.p-r.w1:null;})},
  {name:"Germany",color:COL.de,w:1.8,dash:"6 4",dots:true,vals:T.map(t=>v("DE",t.c))}];
 if(st.zone!=="Nordic")ser.push({name:"Nordic system",color:COL.sys,w:1.8,dots:true,vals:T.map(t=>v("Nordic",t.c))});
 ser.push({name:zl,color:COL.zone,w:2.6,dots:true,r:3.2,vals:T.map(t=>v(st.zone,t.c))});
 $("pwCurveKeys").innerHTML=keysHtml(ser.slice().reverse());
 lineChart($("pwCurve"),{h:($("pwCurve").clientWidth||600)<520?240:380,n:T.length,groups:T.map(t=>t.t),gap:.8,xgroups:GL,xall:true,xw:30,series:ser,yunit:EUR,label:zl+" base-load forward curve, €/MWh",
  xlab:i=>{const c=T[i].c,nar=($("pwCurve").clientWidth||600)<560;return T[i].t==="M"?(nar?c[0]:c.slice(0,3)):T[i].t==="Q"?(nar?c.slice(0,2):c.replace("-","'")):(nar?"":"'")+c.slice(-2);},
  tip:i=>'<b>'+esc(T[i].c)+'</b> <span class="src">delivery from '+esc(T[i].start)+'</span>'+tipRows(ser.slice().reverse(),i,2," €/MWh")+(isNum(v(st.zone,T[i].c))&&isNum(v("Nordic",T[i].c))&&st.zone!=="Nordic"?'<br><span class="src">'+esc(st.zone)+' − system '+fst(v(st.zone,T[i].c)-v("Nordic",T[i].c))+' €/MWh</span>':"")});
 renderPrem();renderFwTable();}
function renderPrem(){const E=P.eex,T=E.tenors,zn=E.zones;
 const opts=["M","Q","Y"].filter(k=>E.bench[k]).map(k=>[E.bench[k],E.bench[k]]);if(!st.tenor||!T.find(t=>t.c===st.tenor))st.tenor=E.bench.Y||T[0].c;
 if(!opts.find(o=>o[0]===st.tenor))opts.push([st.tenor,st.tenor]);
 $("pwPremSeg").innerHTML=seg("pwPremS",opts,st.tenor);bindSeg("pwPremS",k=>{st.tenor=k;renderPrem();renderFwTable();});
 setHead("pwPremTitle","Zone premium vs Nordic system · "+esc(st.tenor),EUR,"Zonal future − Nordic system future (implied EPAD) · last row: Nordic system − Germany · EEX settlement "+esc(tdlabel(E.asof)));
 const sys=zn.Nordic&&zn.Nordic[st.tenor]&&zn.Nordic[st.tenor].p;const rows=FUT_N.slice(1).map(z=>{const p=zn[z]&&zn[z][st.tenor]&&zn[z][st.tenor].p;return[z,isNum(p)&&isNum(sys)?p-sys:null,p];});
 const de=zn.DE&&zn.DE[st.tenor]&&zn.DE[st.tenor].p;rows.push(["Nordic − DE",isNum(sys)&&isNum(de)?sys-de:null,sys,true]);
 const mx=Math.max(10,...rows.map(r=>Math.abs(r[1]||0)));
 $("pwPrem").innerHTML=rows.map(([z,d,p,sep])=>{const w=isNum(d)?Math.abs(d)/mx*50:0;return'<div class="pw-bar'+(sep?" sep":"")+(z===st.zone?" on":"")+'" title="'+esc(sep?"Nordic system minus Germany, "+st.tenor:z+" minus Nordic system (implied EPAD), "+st.tenor+"; outright "+fpt(p))+'"><span class="bl">'+esc(z)+'</span><span class="bt"><i class="'+(d<0?"n":"p")+'" style="'+(d<0?"right:50%":"left:50%")+';width:'+w.toFixed(1)+'%"></i><b class="mid"></b></span><span class="bv">'+fs(d)+'</span></div>';}).join("");
 // benchmark history since 1 Sep
 const b=E.bench[st.bench]?st.bench:"Y";const c=E.bench[b];const H=E.hist||{};const D=E.dates||[];
 $("pwHistTitle").innerHTML=esc(c)+' settlement since 1 Sep <em>€/MWh</em> '+seg("pwBenchS",["M","Q","Y"].filter(k=>E.bench[k]).map(k=>[k,k==="M"?"Front month":k==="Q"?"Front quarter":"Front year"]),b);
 bindSeg("pwBenchS",k=>{st.bench=k;save();renderPrem();});
 const zs=st.zone==="Nordic"?["Nordic","DE"]:[st.zone,"Nordic","DE"];const cols={Nordic:COL.sys,DE:COL.de};
 const ser=zs.map(z=>({name:z==="Nordic"?"Nordic system":z==="DE"?"Germany":z,color:cols[z]||COL.zone,w:z===st.zone?2.4:1.7,dash:z==="DE"?"6 4":null,end:true,vals:(H[z]&&H[z][c])||[]}));
 $("pwHistKeys").innerHTML=keysHtml(ser.slice().reverse());
 lineChart($("pwHist"),{n:D.length,series:ser,h:200,yunit:EUR,label:c+" settlement since 1 Sep, €/MWh",xlab:i=>sdate(D[i]),xw:54,
  tip:i=>'<b>'+esc(c)+'</b> · '+esc(tdlabel(D[i]))+tipRows(ser.slice().reverse(),i,2," €/MWh")});}
const MODE_SUB={p:"Settlement price",d1:"Change vs previous settlement",w1:"Change vs a week earlier",s1:"Change since 1 Sep",sys:"Zone − Nordic system (implied EPAD)",de:"Zone − Germany"};
const MODES=[["p","Price"],["d1","Δ day"],["w1","Δ week"],["s1","Δ since 1 Sep"],["sys","vs system"],["de","vs DE"]];
function renderFwTable(){const E=P.eex,T=E.tenors,zn=E.zones;
 setHead("pwFwTitle","Base-load futures by zone and tenor",EUR,esc(MODE_SUB[st.mode]||"")+" · EEX, trade date "+esc(tdlabel(E.asof)));
 $("pwModeSeg").innerHTML=seg("pwMode",MODES,st.mode);bindSeg("pwMode",k=>{st.mode=k;save();renderFwTable();});
 $("pwEu").classList.toggle("is-on",st.eu);$("pwEu").onclick=()=>{st.eu=!st.eu;save();renderFwTable();};
 const zones=FUT_N.concat(st.eu?FUT_EU:["DE"]);
 const val=(z,c)=>{const r=zn[z]&&zn[z][c];if(!r)return null;if(st.mode==="p")return r.p;if(st.mode==="sys"){const s=zn.Nordic&&zn.Nordic[c];return z==="Nordic"?null:(isNum(r.p)&&s&&isNum(s.p)?r.p-s.p:null);}if(st.mode==="de"){const s=zn.DE&&zn.DE[c];return z==="DE"?null:(isNum(r.p)&&s&&isNum(s.p)?r.p-s.p:null);}return r[st.mode];};
 const all=[];zones.forEach(z=>T.forEach(t=>{const x=val(z,t.c);if(isNum(x))all.push(Math.abs(x));}));all.sort((a,b)=>a-b);const sc=Math.max(st.mode==="d1"?2:st.mode==="w1"?4:st.mode==="s1"?8:10,all.length?all[Math.floor(all.length*.85)]:1);
 let h='<thead><tr class="grp"><th class="c-z"></th>';["M","Q","Y"].forEach(g=>{const n=T.filter(t=>t.t===g).length;if(n)h+='<th colspan="'+n+'" class="g-'+g+'">'+GL[g]+'</th>';});h+='</tr><tr><th class="c-z">Zone</th>';
 T.forEach(t=>h+='<th class="'+(t.c===st.tenor?"sel":"")+'" data-c="'+esc(t.c)+'" title="'+esc(t.c+" · delivery from "+t.start)+' · click to use in premia">'+esc(t.c)+'</th>');h+='</tr></thead><tbody>';
 zones.forEach(z=>{h+='<tr class="'+(z===st.zone?"on ":"")+(z==="Nordic"?"sys":"")+(z==="DE"?" de":"")+'" data-z="'+z+'"><th class="c-z" scope="row" title="'+esc(ZNAME[z]||z)+'">'+esc(z==="Nordic"?"System":z)+'</th>';
  T.forEach(t=>{const r=zn[z]&&zn[z][t.c];const x=val(z,t.c);const tt=r?esc(z+" "+t.c+": "+fpt(r.p)+" · 1D "+fst(r.d1)+" · 1W "+fst(r.w1)+" · since "+(r.from||"1 Sep")+" "+fst(r.s1)):"";
   if(st.mode==="p")h+='<td class="num"'+(isNum(x)?' style="background:'+pcol(x,.28)+'"':"")+' title="'+tt+'">'+(isNum(x)?x.toFixed(2):NA)+'</td>';
   else h+='<td class="num heat"'+heat(x,sc)+' title="'+tt+'">'+fs(x)+(st.mode==="s1"&&r&&r.from?'<sup>*</sup>':"")+'</td>';});h+='</tr>';});
 $("pwFw").innerHTML=h+"</tbody>";
 $("pwFw").querySelectorAll("thead th[data-c]").forEach(th=>th.onclick=()=>{st.tenor=th.dataset.c;renderPrem();renderFwTable();});
 $("pwFw").querySelectorAll("tbody tr[data-z]").forEach(tr=>tr.onclick=()=>{if(FUT_N.includes(tr.dataset.z)){st.zone=tr.dataset.z;save();renderFw();}});
 const late=T.some(t=>zones.some(z=>zn[z]&&zn[z][t.c]&&zn[z][t.c].from));
 $("pwFwFoot").innerHTML='EEX settlement prices (€/MWh) for trade date <b>'+esc(tdlabel(E.asof))+'</b>. Nordic zones are <b>outright zonal futures</b> (EEX Nordic Zonal Futures, e.g. SE3 = 3SBM), not EPADs; “vs system” is the implied EPAD (zone − Nordic system price future). Δ day vs previous settlement, Δ week vs the last settlement ≥ 7 days earlier, Δ since 1 Sep vs the first settlement in this dataset'+(late?' (<sup>*</sup> contract listed later: change since listing)':"")+'. Contracts already in delivery ('+esc((E.in_delivery||[]).join(", ")||"none")+') are excluded. History starts 1 Sep 2026 and is not backfilled. DK1/DK2 futures are not in the source dataset.';}

/* ---------- drivers ---------- */
function renderDrivers(){const E=P.eex;if(!E){$("pwDrivers").innerHTML='<div class="pw-empty">n/a</div>';return;}
 $("pwDrivers").innerHTML=(E.drivers||[]).map(d=>'<div class="pw-drv" title="'+esc((d.note||d.name)+" · "+d.contract+" · settlement "+(d.asof||"n/a"))+'"><div class="pw-drv-h"><span class="panel-label">'+esc(d.name)+'</span><span class="pw-unit">'+esc(U(d.unit))+'</span></div><div class="pw-drv-v"><b>'+fp(d.p)+'</b>'+(d.hist?sparkSvg(d.hist).replace('aria-hidden="true"','role="img" aria-label="'+esc(d.name)+' settlements since 1 Sep, '+esc(U(d.unit))+'"'):"")+'</div><div class="pw-drv-c"><span>1D <em class="'+(d.d1>0?"up":d.d1<0?"dn":"")+'">'+fs(d.d1)+'</em></span><span>1W <em class="'+(d.w1>0?"up":d.w1<0?"dn":"")+'">'+fs(d.w1)+'</em></span><span>1 Sep <em class="'+(d.s1>0?"up":d.s1<0?"dn":"")+'">'+fs(d.s1)+'</em></span></div><div class="pw-drv-a">'+esc(d.asof?"Settlement "+tdlabel(d.asof):"n/a")+' · line since 1 Sep</div></div>').join("");}

/* ---------- hydro ---------- */
function renderHydro(){const H=P.hydro&&P.hydro.no;const box=$("pwHydro");
 if(!H||!H.regions){box.innerHTML='<div class="pw-empty">NVE data not available</div>';}
 else{const regs=Object.keys(H.regions);if(!regs.includes(st.hz))st.hz="Norway";
  $("pwHyChips").innerHTML=regs.map(r=>'<button type="button" class="chip'+(r===st.hz?" is-on":"")+'" data-r="'+r+'">'+esc(r)+'</button>').join("");
  $("pwHyChips").querySelectorAll(".chip").forEach(b=>b.onclick=()=>{st.hz=b.dataset.r;save();renderHydro();});
  const R=H.regions[st.hz];const L=R.last;setHead("pwHyTitle",esc(st.hz)+" reservoir filling","% of capacity","NVE weekly · "+(L?"week "+L.week+" "+H.year+" (to "+esc(dlabel(L.date))+")":"n/a")+" · vs "+(H.year-1)+" and the "+esc(H.band_period)+" range");
  const weeks=[];for(let w=1;w<=53;w++)weeks.push(w);const cur=new Map(R.cur),prev=new Map(R.prev),band=new Map(R.band.map(b=>[b[0],b]));
  const bd=weeks.map((w,i)=>{const b=band.get(w);return b?[i,b[1],b[2],b[3]]:null;}).filter(Boolean);
  const ser=[{name:String(H.year-1),color:"var(--muted)",w:1.3,dash:"4 3",vals:weeks.map(w=>prev.get(w))},{name:String(H.year),color:COL.zone,w:2.6,end:true,vals:weeks.map(w=>cur.get(w))}];
  $("pwHyKeys").innerHTML=keysHtml(ser.slice().reverse())+'<span class="pw-key"><i class="band"></i>Min–max '+esc(H.band_period)+'</span>'+keyHtml({name:"Median "+H.band_period,color:"var(--faint)",dash:"2 3"});
  lineChart(box,{n:53,series:ser,band:bd,ymin:0,ymax:100,yfmt:v=>v+"%",label:st.hz+" reservoir filling by week, % of capacity",xlab:i=>[1,9,18,27,36,45].includes(i+1)?"wk "+(i+1):null,xall:true,
   tip:i=>{const w=i+1,b=band.get(w);return'<b>Week '+w+'</b> · '+esc(st.hz)+'<br><i class="pw-tk" style="background:'+COL.zone+'"></i>'+H.year+' <b>'+(isNum(cur.get(w))?cur.get(w).toFixed(1)+"%":"n/a")+'</b><br><i class="pw-tk" style="background:var(--muted)"></i>'+(H.year-1)+' '+(isNum(prev.get(w))?prev.get(w).toFixed(1)+"%":"n/a")+(b?'<br><span class="src">Min '+b[1]+'% · median '+b[2]+'% · max '+b[3]+'% ('+esc(H.band_period)+')</span>':"");}});}
 // side card: Norway zones + Sweden snapshot
 const L0=H&&H.regions&&H.regions.Norway&&H.regions.Norway.last;let s=cardHead("Norway reservoir filling by zone","% of capacity","NVE · latest week"+(L0?" ("+L0.week+", to "+esc(dlabel(L0.date))+")":"")+" · bar = filling, tick = median, right = pp vs median");
 if(H&&H.regions){s+='<div class="pw-hy-list">';Object.entries(H.regions).forEach(([r,R])=>{const L=R.last;if(!L)return;const b=(R.band||[]).find(x=>x[0]===L.week);const dv=b?L.fill-b[2]:null;
  s+='<div class="pw-hy-row" title="'+esc(r+": "+L.fill+"% ("+L.twh+" / "+L.cap+" TWh), week change "+fst(L.chg,1)+" pp; median "+(b?b[2]:"n/a")+"%, min "+(b?b[1]:"n/a")+"%, max "+(b?b[3]:"n/a")+"%")+'"><span class="hl">'+esc(r)+'</span><span class="hb"><i style="width:'+Math.max(0,Math.min(100,L.fill))+'%"></i>'+(b?'<b style="left:'+b[2]+'%"></b>':"")+'</span><span class="hv">'+L.fill.toFixed(1)+'%</span><span class="hd '+(isNum(dv)?(dv<0?"dn":"up"):"")+'">'+fs(dv,1)+'</span></div>';});
  s+='</div><p class="pw-foot">Bar = filling; tick = 2006–2025 median for the week; right = pp vs median. NVE next update '+esc(H.next?fdt.format(new Date(H.next+"+02:00")):"n/a")+'.</p>';}
 const se=P.hydro&&P.hydro.se;s+='<div class="pw-mini-h">Sweden reservoir filling <em>% of capacity · Energiföretagen weekly'+(se?' · week '+se.week:"")+' · right = stored energy</em></div>';
 if(se){const dv=isNum(se.mean)?se.fill-se.mean:null;s+='<div class="pw-se"><div class="pw-se-main"><b>'+se.fill.toFixed(1)+'%</b><span>week '+se.week+' ('+esc(se.period)+') · '+fs(se.fill-se.prev,1)+' pp w/w</span><span class="'+(isNum(dv)?(dv<0?"dn":"up"):"")+'">'+fs(dv,1)+' pp vs '+esc(se.mean_period)+' mean ('+fp(se.mean,1)+'%)</span></div><div class="pw-hy-list">'+
  Object.entries(se.zones||{}).map(([z,r])=>'<div class="pw-hy-row"><span class="hl">'+esc(z)+'</span><span class="hb"><i style="width:'+Math.min(100,r.fill)+'%"></i></span><span class="hv">'+r.fill.toFixed(1)+'%</span><span class="hd">'+(r.gwh>=1000?(r.gwh/1000).toFixed(1)+' TWh':Math.round(r.gwh)+' GWh')+'</span></div>').join("")+'</div><p class="pw-foot">Snapshot from the weekly “Aktuellt magasinsläge” report (no free history feed, so no band).</p></div>';}
 else s+='<p class="pw-foot">n/a (weekly report could not be read)</p>';
 $("pwHySide").innerHTML=s;}

/* ---------- SE4 focus: KPI strip ---------- */
function spreadV(a,b,fn,k){const x=fn(a,k),y=fn(b,k);return isNum(x)&&isNum(y)?x-y:null;}
function renderFocusKpis(){const K=keys(),t=K.today,E=P.eex,z=FOCUS;let h="";
 const a=dayVal(z,t),r=dayRec(z,t),m=K.hasM?dayVal(z,K.tomorrow):null;
 h+=kpi(z+" day-ahead · today",isNum(a)?fp(a)+'<small> €/MWh</small>':NA,(K.hasM?"tomorrow "+fpt(m):"tomorrow n/a yet")+(r?" · "+fpt(r.min,0)+"–"+fpt(r.max,0):""),"pw-f","SE4 day-ahead daily average for "+dlabel(t)+(r?"; min/max "+fpt(r.min)+" / "+fpt(r.max):""));
 h+=kpi(z+" 7d · 30d",isNum(w7(z,t))?fp(w7(z,t),1)+'<small> · '+fpt(w30(z,t),1)+' €/MWh</small>':NA,"day-ahead, mean of delivery days ending today","pw-f");
 {const R=E4(),C=R&&R.capture,c30=C&&C.d30&&C.d30.wind,c7=C&&C.d7&&C.d7.wind,ct=C&&C.today_fc&&C.today_fc.wind;
  if(c30||c7)h+=kpi("Wind capture · 30d",c30?pct0(c30.rate)+'<small> · '+fpt(c30.cap,1)+' €/MWh</small>':NA,(c7?"7d "+pct0(c7.rate)+" ("+fpt(c7.cap,1)+")":"")+(ct?" · today exp. "+pct0(ct.rate):""),"pw-f"+(c30&&isNum(c30.rate)?(c30.rate<0.8?" pw-neg":""):""),"SE4 wind capture rate = wind-weighted day-ahead price ÷ baseload, last 30 complete days (computed from ENTSO-E A44 × A75). 7d = last 7 days; today expected = weighted by the day-ahead wind forecast.");}
 const s3=spreadV(z,"SE3",dayVal,t),s3w=spreadV(z,"SE3",w7,t);h+=kpi(z+" − SE3 · today",isNum(s3)?fs(s3)+'<small> €/MWh</small>':NA,"7d "+fst(s3w)+(K.hasM?" · tmrw "+fst(spreadV(z,"SE3",dayVal,K.tomorrow)):""),"pw-f"+(isNum(s3)?(s3>0?" pw-pos":" pw-neg"):""),"Day-ahead daily average spread SE4 minus SE3 (congestion between southern and central Sweden)");
 const sd=spreadV(z,"DE-LU",dayVal,t),sdw=spreadV(z,"DE-LU",w7,t);h+=kpi(z+" − DE-LU · today",isNum(sd)?fs(sd)+'<small> €/MWh</small>':NA,"7d "+fst(sdw)+(K.hasM?" · tmrw "+fst(spreadV(z,"DE-LU",dayVal,K.tomorrow)):""),"pw-f"+(isNum(sd)?(sd>0?" pw-pos":" pw-neg"):""),"Day-ahead daily average spread SE4 minus Germany-Luxembourg");
 if(E&&E.zones&&E.zones[z]){const zn=E.zones;[["M","front month"],["Y","front year"]].forEach(([b,lab])=>{const c=E.bench[b];const q=c&&zn[z][c];if(!q)return;const sys=zn.Nordic&&zn.Nordic[c];const ep=isNum(q.p)&&sys&&isNum(sys.p)?q.p-sys.p:null;
  h+=kpi(z+" fwd · "+esc(c),fp(q.p)+(isNum(q.p)?'<small> €/MWh</small>':""),"1D "+fs(q.d1)+" · EPAD "+fs(ep),"pw-f","EEX SE4 zonal base future, "+lab+" "+c+", settlement "+tdlabel(E.asof)+"; EPAD = SE4 − Nordic system "+fpt(sys&&sys.p));});}
 $("pwFocusKpis").innerHTML=h;}

/* ---------- SE4 focus: section ---------- */
function alignHours(z,k,t0,n){const r=dayRec(z,k);if(!r)return Array(n).fill(null);const off=Math.round((new Date(r.t0).getTime()-t0)/36e5);const o=[];for(let i=0;i<n;i++){const v=r.h[i-off];o.push(isNum(v)?v:null);}return o;}
function renderSe4(){const K=keys(),z=FOCUS;const t=K.today;const srcOf=q=>Z(q)&&Z(q).src||"";
 // SE4 day-ahead price by hour: today (+ tomorrow when published) vs SE3 / DE-LU on the same day
 const rt=dayRec(z,t)||dayRec(z,K.tomorrow);const box=$("pwS4Hour");
 if(!rt){setHead("pwS4HourTitle",z+" day-ahead price by hour",EUR,"No SE4 day-ahead prices in the current data");box.innerHTML='<div class="pw-empty">No SE4 day-ahead prices in the current data.</div>';$("pwS4HourKeys").innerHTML="";}
 else{const k0=dayRec(z,t)?t:K.tomorrow;const w0=k0===t?"today":"tomorrow";const t0=new Date(rt.t0).getTime(),n=rt.h.length,tz=tzSpan(t0,t0+(n-1)*36e5);
  const ser=[{name:"DE-LU "+w0,color:COL.de,w:1.5,dash:"6 4",vals:alignHours("DE-LU",k0,t0,n)},{name:"SE3 "+w0,color:COL.sys,w:1.6,vals:alignHours("SE3",k0,t0,n)}];
  const rm=k0===t&&dayRec(z,K.tomorrow);
  if(rm){const m1=new Map();const tm0=new Date(rm.t0).getTime();rm.h.forEach((v,j)=>{const hh=fhr.format(new Date(tm0+j*36e5));if(!m1.has(hh))m1.set(hh,isNum(v)?v:null);});
   ser.push({name:z+" tomorrow",color:COL.zone,w:1.8,dash:"3 3",op:.75,vals:Array.from({length:n},(_,i)=>{const v=m1.get(fhr.format(new Date(t0+i*36e5)));return v==null?null:v;})});}
  ser.push({name:z+" "+w0,color:COL.zone,w:2.6,dots:true,r:2.2,vals:alignHours(z,k0,t0,n)});
  const days=rm?"Today "+dlabel(t)+" + tomorrow "+dlabel(K.tomorrow):(w0==="today"?"Today ":"Tomorrow ")+dlabel(k0);
  setHead("pwS4HourTitle",z+" day-ahead price by hour",EUR,esc(days)+" · hourly"+(rt.res===15?" avg of 15-min prices":"")+", "+tz+" · vs SE3 and DE-LU (Germany)"+(srcOf(z)?" · "+esc(srcOf(z)):""));
  $("pwS4HourKeys").innerHTML=keysHtml(ser.slice().reverse());
  const nowI=k0===t?Math.floor((Date.now()-t0)/36e5):null;
  lineChart(box,{n,series:ser,zero:true,h:240,yunit:EUR,xunit:tz,now:nowI,label:z+" day-ahead price by hour, €/MWh",xlab:i=>fhr.format(new Date(t0+i*36e5)),xw:34,
   tip:i=>{const a=new Date(t0+i*36e5),b=new Date(t0+(i+1)*36e5);const s4=ser[ser.length-1].vals[i],s3=ser[1].vals[i];return'<b>'+fhr.format(a)+':00–'+fhr.format(b)+':00 '+tzName(a.getTime())+'</b> <span class="src">day-ahead price</span>'+tipRows(ser.slice().reverse(),i,2," €/MWh")+(isNum(s4)&&isNum(s3)?'<br><span class="src">SE4 − SE3 '+fst(s4-s3)+' €/MWh</span>':"");}});}
 // SE4 day-ahead price, daily average over the last 30 delivery days (incl. tomorrow once published)
 const zs=[z,"SE3","DE-LU"],maps=zs.map(q=>new Map((Z(q)&&Z(q).daily)||[]));const ds=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort().slice(-30);
 const dser=[{name:"DE-LU",color:COL.de,w:1.5,dash:"6 4",vals:ds.map(d=>maps[2].get(d))},{name:"SE3",color:COL.sys,w:1.6,vals:ds.map(d=>maps[1].get(d))},{name:z,color:COL.zone,w:2.6,end:true,vals:ds.map(d=>maps[0].get(d))}];
 $("pwS4DayKeys").innerHTML=keysHtml(dser.slice().reverse());
 const dl=ds[ds.length-1];
 setHead("pwS4DayTitle",z+" daily average day-ahead price",EUR,ds.length?ds.length+" delivery days, "+esc(sdate(ds[0]))+" – "+esc(sdate(dl))+(dl===K.tomorrow?" (incl. tomorrow)":dl===t?" (to today)":"")+" · mean of each day · vs SE3 and Germany (DE-LU)"+(srcOf(z)?" · "+esc(srcOf(z)):""):"n/a");
 lineChart($("pwS4Day"),{n:ds.length,series:dser,zero:true,h:240,yunit:EUR,label:z+" day-ahead daily average price, €/MWh",xlab:i=>sdate(ds[i]),xw:54,
  tip:i=>'<b>'+esc(tdlabel(ds[i]))+'</b>'+(ds[i]===K.tomorrow?' <span class="src">tomorrow</span>':ds[i]===t?' <span class="src">today</span>':"")+'<br><span class="src">day-ahead daily average</span>'+tipRows(dser.slice().reverse(),i,2," €/MWh")+(isNum(dser[2].vals[i])&&isNum(dser[1].vals[i])?'<br><span class="src">SE4 − SE3 '+fst(dser[2].vals[i]-dser[1].vals[i])+' €/MWh</span>':"")});
 renderSe4Fw();renderSvk();renderEntsoe();}
function renderSe4Fw(){const E=P.eex,tb=$("pwS4Fw");if(!E||!E.zones||!E.zones[FOCUS]){setHead("pwS4FwTitle","SE4 base-load futures by tenor",EUR,"EEX settlements not available");tb.innerHTML='<tbody><tr><td class="pw-empty">EEX settlements not available</td></tr></tbody>';return;}
 const zn=E.zones,z=FOCUS;setHead("pwS4FwTitle","SE4 base-load futures by tenor",EUR,"EEX zonal futures · settlement "+esc(tdlabel(E.asof))+" · Δ = change, EPAD = SE4 − Nordic system");
 const g=(q,c)=>zn[q]&&zn[q][c]&&isNum(zn[q][c].p)?zn[q][c].p:null;
 let h='<thead><tr><th class="c-z">Tenor</th><th>SE4</th><th>Δ day</th><th>Δ week</th><th title="SE4 − Nordic system (implied EPAD)">EPAD</th><th>vs SE3</th><th>vs DE</th></tr></thead><tbody>';
 E.tenors.forEach(t=>{const r=zn[z][t.c];if(!r)return;const p=r.p,d=(q)=>isNum(p)&&isNum(g(q,t.c))?p-g(q,t.c):null;
  h+='<tr class="'+(Object.values(E.bench).includes(t.c)?"bench":"")+'" data-c="'+esc(t.c)+'"><th class="c-z" scope="row" title="delivery from '+esc(t.start)+'">'+esc(t.c)+'</th><td class="num" style="background:'+pcol(p,.28)+'">'+fp(p)+'</td><td class="num heat"'+heat(r.d1,4)+'>'+fs(r.d1)+'</td><td class="num heat"'+heat(r.w1,8)+'>'+fs(r.w1)+'</td><td class="num heat"'+heat(d("Nordic"),30)+'>'+fs(d("Nordic"))+'</td><td class="num heat"'+heat(d("SE3"),20)+'>'+fs(d("SE3"))+'</td><td class="num heat"'+heat(d("DE"),30)+'>'+fs(d("DE"))+'</td></tr>';});
 tb.innerHTML=h+"</tbody>";
 tb.querySelectorAll("tbody tr[data-c]").forEach(tr=>tr.onclick=()=>{st.zone=z;st.tenor=tr.dataset.c;save();renderFw();const el=$("pwSecFw");el&&el.scrollIntoView({behavior:"smooth",block:"start"});});}
/* ---------- Svenska kraftnät (Kontrollrummet + data.svk.se), keyless ---------- */
const BORDER_COL={SE3:"var(--pw-sys)",DK2:"#b07cff","DE-LU":"var(--pw-de)",PL:"#e5484d",LT:"#2da0aa"};
function svkIdx(V){const t0=new Date(V.t0).getTime();const now=Date.now();const i=Math.floor((now-t0)/36e5);return{t0,n:V.n,now:i};}
function lastIdx(a,upto){if(!a)return -1;for(let i=Math.min(a.length-1,upto==null?a.length-1:upto);i>=0;i--)if(isNum(a[i]))return i;return -1;}
function dayMean(a,t0,k){if(!a)return null;const s=new Date(k+"T00:00:00");const vals=[];for(let i=0;i<a.length;i++){const d=fymd.format(new Date(t0+i*36e5));if(d===k&&isNum(a[i]))vals.push(a[i]);}return vals.length?mean(vals):null;}
function svkStats(items){return'<div class="pw-grid-stats">'+items.map(([a,b,c,t])=>'<div'+(t?' title="'+esc(t)+'"':"")+'><span>'+a+'</span><b>'+b+'</b><em>'+(c||"")+'</em></div>').join("")+'</div>';}
function svkEmpty(box,title,unit,sub,msg){box.innerHTML=cardHead(title,unit,sub)+'<div class="pw-empty">'+msg+'</div>';}
/* SE4 cross-border flows card (SVK primary, ENTSO-E A11 fallback): one layout, one set of labels */
const BORDER_NAME={SE3:"SE3 (central Sweden)",DK2:"DK2 (east Denmark)","DE-LU":"Germany (DE-LU)",PL:"Poland",LT:"Lithuania"};
function flowCard(B2,fl,t0,n,src,foot){const K=keys(),now=Math.floor((Date.now()-t0)/36e5);
 const BO=["SE3","DK2","DE-LU","PL","LT"];const order=BO.filter(k=>fl[k]).concat(Object.keys(fl).filter(k=>!BO.includes(k)));
 const fs_=order.map(k=>({name:BORDER_NAME[k]||k,color:BORDER_COL[k]||"var(--muted)",w:k==="SE3"?2.4:1.6,vals:fl[k]}));
 const li=lastIdx(fl[order[0]],now);let fi=-1;fl[order[0]].some((v,i)=>{if(isNum(v)){fi=i;return true;}return false;});
 const from=fi>=0?dlabel(fymd.format(new Date(t0+fi*36e5))):"";
 const ax=hAxis(t0,n,$("pwS4Flows"));
 B2.innerHTML=cardHead(FOCUS+" cross-border physical flows","MW","Hourly · "+esc(hRange(t0,n))+" · "+ax.xunit+" · + = into SE4, − = out of SE4 · "+src,keysHtml(fs_))+
 '<div class="pw-tbl-wrap pw-flow-wrap"><table class="pw-tbl"><thead><tr><th class="c-z">Border <span class="pw-mut">MW</span></th><th title="Latest hourly value">Latest</th><th title="Mean of today\'s hours so far">Today avg</th><th title="Mean of all hours in the chart'+(from?" (from "+esc(from)+")":"")+'">Period avg</th></tr></thead><tbody>'+
 order.map(k=>{const a=fl[k];const l=lastIdx(a,now);const c=v=>'<td class="num '+(isNum(v)?(v>=0?"imp":"exp"):"")+'">'+(isNum(v)?(v>=0?"+":"−")+fp(Math.abs(v),0):NA)+'</td>';
  return'<tr><th class="c-z">'+esc(k==="SE3"?"SE3 → SE4":"SE4 ↔ "+k)+'</th>'+c(l>=0?a[l]:null)+c(dayMean(a,t0,K.today))+c(mean(a.filter(isNum)))+'</tr>';}).join("")+'</tbody></table></div>'+
 '<div class="pw-chart" id="pwS4FlowChart"></div><p class="pw-foot">'+foot+(li>=0?' Latest '+esc(fdt.format(new Date(t0+li*36e5)).replace("Sept","Sep"))+' '+tzName(t0+li*36e5)+'.':'')+'</p>';
 lineChart($("pwS4FlowChart"),Object.assign(hAxis(t0,n,$("pwS4FlowChart")),{n,series:fs_,zero:true,h:200,yunit:"MW",label:FOCUS+" cross-border physical flows by border, MW, positive into SE4",
  tip:i=>'<b>'+tipTime(t0,i)+'</b> <span class="src">net flow, + = into SE4</span>'+fs_.map(s=>'<br><i class="pw-tk" style="background:'+s.color+'"></i>'+esc(s.name)+' <b>'+(isNum(s.vals[i])?fst(s.vals[i],0)+'</b> MW':'n/a</b>')).join("")}));return true;}
function entFlows(B2){const R=E4(),fl=R&&R.flows;if(!fl||!Object.keys(fl).length)return false;
 return flowCard(B2,fl,new Date(R.t0).getTime(),R.n,"ENTSO-E (A11)","Fallback source (Svenska kraftnät flows unavailable): ENTSO-E cross-border physical flows (A11), net into SE4 per border. Hourly means.");}
function renderSvk(){const V=P.svk;const B1=$("pwS4Svk"),B2=$("pwS4Flows"),B3=$("pwS4Mix");
 const entLoad=renderLoadEnt(B1);
 if(!V){if(!entLoad)svkEmpty(B1,FOCUS+" electricity demand (load)","MW","Svenska kraftnät","SVK data not available in this build.");if(!entFlows(B2))svkEmpty(B2,FOCUS+" cross-border physical flows","MW","Svenska kraftnät","SVK data not available in this build.");svkEmpty(B3,"Sweden generation by type","MW","Svenska kraftnät","SVK data not available in this build.");return;}
 const{t0,n,now}=svkIdx(V),K=keys(),Z4=(V.zones||{})[FOCUS]||{};const tzv=tzSpan(t0,t0+(n-1)*36e5);
 // 1) SE4 load (outcome + forecast) and solar plan: only when ENTSO-E load is missing
 const ser=[];if(Z4.load_plan)ser.push({name:"Load forecast",color:COL.de,w:1.4,dash:"4 3",vals:Z4.load_plan});if(Z4.load)ser.push({name:"Load actual",color:COL.zone,w:2.4,end:true,vals:Z4.load});if(Z4.solar_plan)ser.push({name:"Solar plan",color:SOLAR_C,w:1.6,vals:Z4.solar_plan});
 if(entLoad){}
 else if(!ser.length)svkEmpty(B1,FOCUS+" electricity demand (load)","MW","Svenska kraftnät Kontrollrummet","n/a");
 else{const li=lastIdx(Z4.load,now);const lt=dayMean(Z4.load,t0,K.today),lp=dayMean(Z4.load_plan,t0,K.today),sp=Z4.solar_plan?Math.max(...Z4.solar_plan.filter(isNum).concat([0])):null;
  const fl=V.flows_se4||{};const ni=lastIdx(Object.values(fl)[0],now);const net=ni>=0?Object.values(fl).reduce((a,v)=>a+(isNum(v[ni])?v[ni]:0),0):null;
  B1.innerHTML=cardHead(FOCUS+" electricity demand (load) vs forecast","MW","Hourly · "+esc(hRange(t0,n))+" · "+tzv+" · Svenska kraftnät Kontrollrummet",keysHtml(ser.slice().reverse()))+
  svkStats([["Load latest",li>=0?fp(Z4.load[li],0)+" MW":NA,li>=0?fhr.format(new Date(t0+li*36e5))+":00 "+tzName(t0+li*36e5):"","Consumption outcome, SE4"],["Load today",isNum(lt)?fp(lt,0)+" MW":NA,isNum(lp)?"forecast "+fp(lp,0)+" MW":"mean so far","Mean of today's hourly outcome vs SVK forecast"],["Net import",isNum(net)?fp(net,0)+" MW":NA,ni>=0?"all borders · "+fhr.format(new Date(t0+ni*36e5))+":00":"","Physical flows into SE4 minus out of SE4 (data.svk.se)"],["Solar plan peak",isNum(sp)?fp(sp,0)+" MW":NA,"max of the hours published","Solar production plans submitted by balance-responsible parties"]])+
  '<div class="pw-chart" id="pwS4SvkChart"></div>';
  lineChart($("pwS4SvkChart"),Object.assign(hAxis(t0,n,$("pwS4SvkChart")),{n,series:ser,h:210,yunit:"MW",label:FOCUS+" load and forecast, MW",tip:i=>'<b>'+tipTime(t0,i)+'</b>'+tipRows(ser.slice().reverse(),i)}));}
 // 2) SE4 flows per border (positive = import into SE4)
 const fl=V.flows_se4;
 if(!fl||!Object.keys(fl).length){if(!entFlows(B2))svkEmpty(B2,FOCUS+" cross-border physical flows","MW","Svenska kraftnät data.svk.se","n/a");}
 else flowCard(B2,fl,t0,n,"Svenska kraftnät","Positive = flow into SE4, negative = out of SE4. Hourly means of 15-min physical flows (data.svk.se).");
 // 3) Sweden production by type + SE1–SE4 load split
 const S=V.se;const zs=V.zones||{};
 if(!S&&!Object.keys(zs).length){svkEmpty(B3,"Sweden generation by type","MW","Svenska kraftnät Kontrollrummet","n/a");return;}
 const MIX=[["wind","Wind","var(--pw-wind)"],["hydro","Hydro","#4f7cff"],["nuclear","Nuclear","#b07cff"],["thermal","Thermal","#f08848"],["unspecified","Unspecified","var(--muted)"]];
 const mser=S?MIX.filter(([k])=>S[k]).map(([k,l,c])=>({name:l,color:c,w:k==="wind"?2.4:1.5,vals:S[k]})):[];
 let h=cardHead("Sweden generation by type","MW","Hourly · "+esc(hRange(t0,n))+" · "+tzv+" · whole of Sweden (no zone split) · Svenska kraftnät",keysHtml(mser));
 if(S){const li=lastIdx(S.total,now);const tot=li>=0?S.total[li]:null;
  h+='<div class="pw-mix"><div class="pw-mini-h">Latest hour <em>MW and share of total'+(li>=0?' · '+esc(fdt.format(new Date(t0+li*36e5)).replace("Sept","Sep"))+' '+tzName(t0+li*36e5):"")+'</em></div>'+MIX.filter(([k])=>S[k]).map(([k,l,c])=>{const v=li>=0?S[k][li]:null;const sh=isNum(v)&&isNum(tot)&&tot?v/tot*100:null;return'<div class="pw-mix-row"><span class="hl"><i style="background:'+c+'"></i>'+l+'</span><span class="hb"><i style="width:'+(isNum(sh)?Math.max(0,Math.min(100,sh)):0).toFixed(1)+'%;background:'+c+'"></i></span><span class="hv">'+(isNum(v)?fp(v,0):NA)+'</span><span class="hd">'+(isNum(sh)?sh.toFixed(0)+"%":"")+'</span></div>';}).join("")+
  '<div class="pw-mix-sum">Total '+(isNum(tot)?fp(tot,0):"n/a")+' MW · consumption '+(li>=0&&S.consumption?fpt(S.consumption[li],0):"n/a")+' MW · net export '+(li>=0&&S.net_export?fst(S.net_export[li],0):"n/a")+' MW</div></div>';}
 const zk=SE_Z.filter(z=>zs[z]);
 if(zk.length){h+='<div class="pw-mini-h pw-pad">Load by bidding area <em>MW · latest hour, today\'s mean and forecast · Kontrollrummet</em></div><div class="pw-tbl-wrap pw-pad"><table class="pw-tbl"><thead><tr><th class="c-z">Zone</th><th>Latest</th><th>Today avg</th><th>Forecast today</th><th title="Highest hourly solar production plan in the hours published">Solar plan peak</th></tr></thead><tbody>'+
  zk.map(z=>{const r=zs[z];const l=lastIdx(r.load,now);const sp=r.solar_plan?r.solar_plan.filter(isNum):[];return'<tr class="'+(z===FOCUS?"focus":"")+'"><th class="c-z">'+z+'</th><td class="num">'+(l>=0?fp(r.load[l],0):NA)+'</td><td class="num">'+fp(dayMean(r.load,t0,K.today),0)+'</td><td class="num">'+fp(dayMean(r.load_plan,t0,K.today),0)+'</td><td class="num">'+(sp.length?fp(Math.max(...sp),0):NA)+'</td></tr>';}).join("")+'</tbody></table></div>';}
 h+=(mser.length?'<div class="pw-mini-h pw-pad">Generation by type, hourly <em>MW · whole of Sweden</em></div>':"")+'<div class="pw-chart" id="pwS4MixChart"></div><p class="pw-foot">Production by type is published for Sweden as a whole (no bidding-area split at source) and is based on operators\' reported schedules, not settled outcome.</p>';
 B3.innerHTML=h;
 if(mser.length)lineChart($("pwS4MixChart"),Object.assign(hAxis(t0,n,$("pwS4MixChart")),{n,series:mser,h:190,yunit:"MW",label:"Sweden generation by type, MW",tip:i=>'<b>'+tipTime(t0,i)+'</b>'+tipRows(mser,i)}));}
/* ---------- ENTSO-E Transparency: SE4 wind, value of wind, load, outages; reservoirs (Drivers) ---------- */
const EN=()=>P.entsoe&&P.entsoe.enabled?P.entsoe:null;
const E4=()=>{const e=EN();return e&&e.se4&&e.se4.t0?e.se4:null;};
const SOLAR_C="#e2c454";
const tipRows=(ser,i,d=0,u=" MW")=>ser.map(s=>'<br><i class="pw-tk" style="background:'+s.color+'"></i>'+esc(s.name)+' <b>'+fpt(s.vals[i],d)+'</b>'+(isNum(s.vals[i])?u:"")).join("");
const pct0=v=>isNum(v)?Math.round(v*100)+"%":"n/a";
function staleNote(k){const e=EN();return e&&(e.stale||[]).includes(k)?' <span class="na">(kept from an earlier build: this part failed at the last update)</span>':"";}
function renderWind(){const box=$("pwS4Wind"),R=E4(),S=R&&R.series;
 if(!S||!(S.wind||S.wind_fc)){box.hidden=true;box.innerHTML="";return;}box.hidden=false;
 const t0=new Date(R.t0).getTime(),n=R.n,now=Math.floor((Date.now()-t0)/36e5),K=keys();
 const ser=[];if(S.solar_fc)ser.push({name:"Solar forecast (day-ahead)",color:SOLAR_C,w:1.2,dash:"4 3",op:.8,vals:S.solar_fc});if(S.solar)ser.push({name:"Solar actual",color:SOLAR_C,w:1.6,vals:S.solar});
 if(S.wind_fc)ser.push({name:"Wind forecast (day-ahead)",color:COL.wind,w:1.5,dash:"5 3",op:.85,vals:S.wind_fc});if(S.wind)ser.push({name:"Wind actual",color:COL.wind,w:2.6,end:true,vals:S.wind});
 const li=lastIdx(S.wind,now),wt=dayMean(S.wind_fc,t0,K.today),wa=dayMean(S.wind,t0,K.today),wm=dayMean(S.wind_fc,t0,K.tomorrow),er=R.wind_err;
 const stats=[["Wind latest",li>=0?fp(S.wind[li],0)+" MW":NA,li>=0?fhr.format(new Date(t0+li*36e5))+":00 "+tzName(t0+li*36e5)+" · actual":"","Latest actual hourly wind generation in SE4 (ENTSO-E A75)"],
  ["Today · forecast",isNum(wt)?fp(wt,0)+" MW":NA,isNum(wa)?"actual so far "+fp(wa,0)+" MW":"mean of the day","Day-ahead wind forecast (A69), mean MW over today"],
  ["Tomorrow · forecast",isNum(wm)?fp(wm,0)+" MW":NA,isNum(wm)?"mean of the day":"published the afternoon before","Day-ahead wind forecast for tomorrow (A69); appears after it is published, typically late afternoon the day before"],
  ["DA forecast error",er?fp(er.mae,0)+" MW":NA,er?"MAE 7d · "+(er.mean?Math.round(er.mae/er.mean*100)+"% of mean · ":"")+(er.bias<0?"under":"over")+"-forecast "+fp(Math.abs(er.bias),0)+" MW":"","Mean absolute error of the hourly day-ahead wind forecast vs actual over the last 7 complete days; bias = mean(forecast − actual)"]];
 const ax=hAxis(t0,n,box);
 box.innerHTML=cardHead(FOCUS+" wind and solar output vs day-ahead forecast","MW","Hourly · "+esc(hRange(t0,n))+" · "+ax.xunit+" · ENTSO-E (actual A75, forecast A69)",keysHtml(ser.slice().reverse()))+svkStats(stats)+'<div class="pw-chart" id="pwS4WindChart"></div>'+
  '<p class="pw-foot">Actual generation per type (A75) vs the TSO\'s <b>day-ahead</b> wind and solar forecast (A69), both in MW. A69 is a short-horizon forecast published the day before delivery (it covers today and, once published, tomorrow); it is not a multi-week outlook. Hourly means of 15-min values; times CET/CEST (Geneva).'+staleNote("series")+'</p>';
 lineChart($("pwS4WindChart"),Object.assign(hAxis(t0,n,$("pwS4WindChart")),{n,series:ser,h:230,yunit:"MW",label:FOCUS+" wind and solar output, actual vs day-ahead forecast, MW",band:null,
  tip:i=>'<b>'+tipTime(t0,i)+'</b>'+tipRows(ser.slice().reverse(),i)+(isNum(S.wind&&S.wind[i])&&isNum(S.wind_fc&&S.wind_fc[i])?'<br><span class="src">wind forecast − actual '+fst(S.wind_fc[i]-S.wind[i],0)+' MW</span>':"")}));}
function renderValue(){const box=$("pwS4Value"),R=E4(),C=R&&R.capture,D=R&&R.daily;
 if(!C&&!(D&&D.length)){box.hidden=true;box.innerHTML="";return;}box.hidden=false;
 const rows=[["Last 7 days","d7","actual"],["Last 30 days","d30","actual"],["Today","today_fc","expected"],["Tomorrow","tomorrow_fc","expected"]];
 const cell=x=>x?'<td class="num">'+fp(x.cap,1)+'</td><td class="num"><span class="pw-rate'+(isNum(x.rate)?(x.rate<0.8?" lo":x.rate>=0.95?" hi":""):"")+'">'+pct0(x.rate)+'</span></td>':'<td class="num">'+NA+'</td><td class="num">'+NA+'</td>';
 let t='<div class="pw-tbl-wrap pw-pad"><table class="pw-tbl pw-cap"><thead><tr><th class="c-z">Period <span class="pw-mut">€/MWh</span></th><th title="Time-average day-ahead price over the same periods, €/MWh">Baseload</th><th title="Wind-weighted day-ahead price, €/MWh">Wind capture</th><th title="Wind capture ÷ baseload">Rate</th><th title="Solar-weighted day-ahead price, €/MWh">Solar capture</th><th title="Solar capture ÷ baseload">Rate</th></tr></thead><tbody>';
 rows.forEach(([l,k,kind])=>{const r=C&&C[k];if(!r&&kind==="expected"&&k==="tomorrow_fc"){t+='<tr class="pw-dim"><th class="c-z" scope="row">'+l+' <em>expected</em></th><td class="num" colspan="5"><span class="na">needs tomorrow\'s prices and wind forecast</span></td></tr>';return;}
  const w=r&&r.wind,s=r&&r.solar;t+='<tr'+(kind==="expected"?' class="pw-exp"':"")+'><th class="c-z" scope="row">'+l+(kind==="expected"?' <em title="Weighted by the day-ahead wind forecast (A69), not by actual output">expected</em>':"")+'</th><td class="num">'+fp((w||s||{}).base,1)+'</td>'+cell(w)+cell(s)+'</tr>';});
 t+='</tbody></table></div>';
 const c30=C&&C.d30&&C.d30.wind,c7=C&&C.d7&&C.d7.wind;
 const stats=[["Wind capture · 30d",c30?fp(c30.cap,1):NA,c30?pct0(c30.rate)+" of baseload "+fpt(c30.base,1):"",EUR],["Wind capture · 7d",c7?fp(c7.cap,1):NA,c7?pct0(c7.rate)+" of baseload "+fpt(c7.base,1):"",EUR]];
 let ch="",ser=[];if(D&&D.length){ser=[{name:"Baseload (time-average)",color:COL.sys,w:1.6,vals:D.map(r=>r[1])},{name:"Wind capture price",color:COL.wind,w:2.6,end:true,vals:D.map(r=>r[2])}];
  ch='<div class="pw-mini-h pw-pad">Daily wind capture price vs baseload <em>€/MWh · '+D.length+' complete days, '+esc(sdate(D[0][0]))+' – '+esc(sdate(D[D.length-1][0]))+'</em></div><div class="pw-keys pw-pad">'+keysHtml(ser.slice().reverse())+'</div><div class="pw-chart" id="pwS4ValueChart"></div>';}
 box.innerHTML=cardHead(FOCUS+" wind capture price vs baseload",EUR,"Wind-weighted vs time-average day-ahead price · last 7 / 30 days, today and tomorrow (expected) · computed from ENTSO-E")+'<div class="pw-grid-stats pw-stats-2">'+stats.map(([a,b,c,u])=>'<div><span>'+a+'</span><b>'+b+(b!==NA?'<small> '+u+'</small>':"")+'</b><em>'+c+'</em></div>').join("")+'</div>'+t+ch+
  '<p class="pw-foot">Capture price = Σ(price × MW) ÷ Σ(MW) over 15-min periods, using ENTSO-E day-ahead prices (A44) and actual generation (A75); rate = capture ÷ baseload over the same periods. “Expected” uses the day-ahead forecast (A69) instead of actual output. Computed here, not a published series.'+staleNote("capture")+'</p>';
 if(ser.length)lineChart($("pwS4ValueChart"),{n:D.length,series:ser,zero:true,h:190,yunit:EUR,label:FOCUS+" daily wind capture price vs baseload, €/MWh",xw:54,xlab:i=>sdate(D[i][0]),
  tip:i=>{const r=D[i];return'<b>'+esc(tdlabel(r[0]))+'</b>'+tipRows(ser.slice().reverse(),i,1," €/MWh")+'<br><span class="src">capture rate '+(isNum(r[1])&&isNum(r[2])&&r[1]>0?Math.round(r[2]/r[1]*100)+"%":"n/a")+' · mean wind output '+fpt(r[3],0)+' MW'+(isNum(r[4])?' · solar capture '+fpt(r[4],1)+' €/MWh':"")+'</span>';}});}
function renderLoadEnt(box){const R=E4(),S=R&&R.series;if(!S||!S.load)return false;
 const t0=new Date(R.t0).getTime(),n=R.n,now=Math.floor((Date.now()-t0)/36e5),K=keys();
 const res=S.load.map((l,i)=>isNum(l)&&isNum(S.wind&&S.wind[i])?l-S.wind[i]-(isNum(S.solar&&S.solar[i])?S.solar[i]:0):null);
 const ser=[];if(S.load_fc)ser.push({name:"Load forecast (day-ahead)",color:COL.de,w:1.4,dash:"4 3",vals:S.load_fc});ser.push({name:"Load actual",color:COL.zone,w:2.4,end:true,vals:S.load});ser.push({name:"Residual (load − wind − solar)",color:COL.sys,w:1.5,vals:res});
 const li=lastIdx(S.load,now),lt=dayMean(S.load,t0,K.today),lf=dayMean(S.load_fc,t0,K.today),ri=lastIdx(res,now),W=R.load_week||[];const pk=W.length?Math.max(...W.map(r=>r[2]).filter(isNum)):null;
 const ax=hAxis(t0,n,box);
 box.innerHTML=cardHead(FOCUS+" electricity demand (load) vs forecast","MW","Hourly · "+esc(hRange(t0,n))+" · "+ax.xunit+" · ENTSO-E (A65)",keysHtml(ser.slice().reverse()))+
  svkStats([["Load latest",li>=0?fp(S.load[li],0)+" MW":NA,li>=0?fhr.format(new Date(t0+li*36e5))+":00 "+tzName(t0+li*36e5):"","Actual total load SE4 (A65)"],["Load today",isNum(lt)?fp(lt,0)+" MW":NA,isNum(lf)?"DA forecast "+fp(lf,0)+" MW":"mean so far","Mean of today's hourly actual load vs the day-ahead load forecast (A65, A01)"],["Residual latest",ri>=0?fp(res[ri],0)+" MW":NA,"load − wind − solar","What other generation and imports have to cover"],["Week-ahead peak",isNum(pk)?fp(pk,0)+" MW":NA,W.length?"next "+W.length+" days":"","Week-ahead load forecast (A65, A31): daily maximum"]])+
  '<div class="pw-chart" id="pwS4LoadChart"></div>'+
  (W.length?'<div class="pw-mini-h pw-pad">Week-ahead load forecast <em>MW · daily min – max · ENTSO-E A65 week-ahead</em></div><div class="pw-wk pw-pad">'+W.map(r=>'<div><span>'+esc(dlabel(r[0]))+'</span><b>'+fpt(r[1],0)+'–'+fpt(r[2],0)+'</b></div>').join("")+'</div>':"")+
  '<p class="pw-foot">Actual total load and the day-ahead load forecast (A65), in MW; residual = load − wind − solar (what other generation and imports have to cover). Hourly means; times CET/CEST (Geneva).'+staleNote("series")+'</p>';
 lineChart($("pwS4LoadChart"),Object.assign(hAxis(t0,n,$("pwS4LoadChart")),{n,series:ser,h:200,yunit:"MW",label:FOCUS+" load, forecast and residual load, MW",tip:i=>'<b>'+tipTime(t0,i)+'</b>'+tipRows(ser.slice().reverse(),i)}));return true;}
const fwd=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"2-digit",month:"short"}),fwt=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false});
const fwinH=iso=>{const d=new Date(iso);return esc(fwd.format(d).replace("Sept","Sep"))+'<span class="pw-t"> '+esc(fwt.format(d))+'</span>';};
function renderOutages(){const box=$("pwS4Out"),R=E4();const tx=R&&R.outages_tx,gen=R&&R.outages_gen;
 if(!R||(!tx&&!gen)){box.hidden=true;box.innerHTML="";return;}box.hidden=false;
 const PS={wind:"Wind",solar:"Solar",nuclear:"Nuclear",hydro:"Hydro",gas:"Gas",coal:"Coal",oil:"Oil",biomass:"Biomass",waste:"Waste",other:"Other"};
 let h=cardHead(FOCUS+" outages: interconnectors and generation units","MW","ENTSO-E reported unavailability (A78, A80) · in effect now and upcoming · times CET/CEST");
 h+='<div class="pw-mini-h pw-pad">Interconnectors <em>reported unavailabilities, now and next 30 days</em></div>';
 if(tx&&tx.length){h+='<div class="pw-tbl-wrap pw-pad"><table class="pw-tbl pw-out"><thead><tr><th class="c-z">Direction</th><th title="Remaining cross-border capacity in this direction during the event">Avail. MW</th><th>Window <span class="pw-mut">(CET/CEST)</span></th><th>Type</th></tr></thead><tbody>'+
  tx.map(r=>'<tr class="'+(r.now?"is-now":"")+'"><th class="c-z" scope="row"><i class="pw-now" title="'+(r.now?"In effect now":"Upcoming")+'"></i>'+esc(r.frm)+' → '+esc(r.to)+'</th><td class="num">'+fp(r.avail,0)+'</td><td class="num">'+fwinH(r.start)+' → '+fwinH(r.end)+'</td><td><span class="pw-pill '+(r.type==="forced"?"forced":"")+'">'+esc(r.type)+'</span></td></tr>').join("")+'</tbody></table></div>';}
 else h+='<div class="pw-empty pw-empty-s">No interconnector unavailability reported for SE4 borders.</div>';
 h+='<div class="pw-mini-h pw-pad">Generation units in SE4 <em>aggregated by fuel, next 7 days</em></div>';
 if(gen&&gen.length){h+='<div class="pw-tbl-wrap pw-pad"><table class="pw-tbl pw-out"><thead><tr><th class="c-z">Fuel</th><th title="Unavailable capacity now, MW (number of events)">Out now</th><th title="Sum of the largest unavailable capacity per event starting or running in the next 7 days, MW (number of events)">Next 7 days</th><th>Planned / forced</th></tr></thead><tbody>'+
  gen.map(r=>'<tr><th class="c-z" scope="row">'+esc(PS[r.type]||r.type)+'</th><td class="num">'+(r.now_mw?fp(r.now_mw,0)+' MW <span class="pw-mut">('+r.now_n+')</span>':"0")+'</td><td class="num">'+fp(r.wk_mw,0)+' MW <span class="pw-mut">('+r.wk_n+')</span></td><td class="num">'+r.planned+' / '+r.forced+'</td></tr>').join("")+'</tbody></table></div>';}
 else h+='<div class="pw-empty pw-empty-s">No generation-unit unavailability reported for SE4.</div>';
 h+='<p class="pw-foot"><i class="pw-now on"></i> = in effect now. Planned and forced unavailabilities published on the ENTSO-E Transparency Platform (A78 transmission, A80 generation units); unit, plant and line names are not shown. Avail. MW = capacity left in that direction during the event. Times CET/CEST (Geneva).'+staleNote("outages_tx")+'</p>';
 box.innerHTML=h;}
function renderReservoirs(){const box=$("pwRes"),e=EN(),RS=e&&e.reservoirs;
 if(!RS||!Object.keys(RS).length){box.hidden=true;box.innerHTML="";return;}box.hidden=false;
 const fmtE=v=>!isNum(v)?NA:Math.abs(v)>=1000?(v/1000).toFixed(1)+'<small> TWh</small>':Math.round(v)+'<small> GWh</small>';
 const fmtD=v=>!isNum(v)?NA:(v>0?"+":v<0?"−":"")+(Math.abs(v)>=1000?(Math.abs(v)/1000).toFixed(2)+" TWh":Math.round(Math.abs(v))+" GWh");
 const agg=zs=>{const have=zs.filter(z=>RS[z]);if(have.length!==zs.length)return null;const w=RS[have[0]].w;if(!have.every(z=>RS[z].w.join()===w.join()))return null;
  const sum=k=>w.map((_,i)=>{const v=have.map(z=>RS[z][k][i]);return v.every(isNum)?v.reduce((a,b)=>a+b,0):null;});return{w,v:sum("v"),ly:sum("ly")};};
 const rows=[["SE1",RS.SE1],["SE2",RS.SE2],["SE3",RS.SE3],["SE4",RS.SE4],["Sweden",agg(SE_Z),"sum"],["NO1",RS.NO1],["NO2",RS.NO2],["NO3",RS.NO3],["NO4",RS.NO4],["NO5",RS.NO5],["Norway",agg(["NO1","NO2","NO3","NO4","NO5"]),"sum"]].filter(r=>r[1]);
 let wk=null;rows.forEach(([,r])=>{const d=r.w[r.w.length-1];if(!wk||d>wk)wk=d;});
 let h=cardHead("Hydro reservoirs · stored energy by zone","GWh / TWh","ENTSO-E weekly (A72) · week of "+esc(dlabel(wk))+" · line = last 52 weeks");
 h+='<div class="pw-tbl-wrap pw-pad"><table class="pw-tbl pw-res"><thead><tr><th class="c-z">Zone</th><th>Stored</th><th title="Change vs the previous week">w/w</th><th title="Same week one year earlier">vs last year</th><th class="c-spark" title="Stored energy, last 52 weeks">Last 52 wks</th></tr></thead><tbody>';
 rows.forEach(([z,r,cls])=>{const n=r.v.length,v=r.v[n-1],p=r.v[n-2],ly=r.ly[n-1];const dw=isNum(v)&&isNum(p)?v-p:null,dy=isNum(v)&&isNum(ly)?v-ly:null,py=isNum(dy)&&ly?dy/ly*100:null;
  h+='<tr class="'+(cls||"")+(z===FOCUS?" focus":"")+'"><th class="c-z" scope="row">'+esc(z)+'</th><td class="num">'+fmtE(v)+'</td><td class="num '+(isNum(dw)?(dw<0?"dn":"up"):"")+'">'+fmtD(dw)+'</td><td class="num '+(isNum(dy)?(dy<0?"dn":"up"):"")+'">'+fmtD(dy)+(isNum(py)?' <span class="pw-mut">('+(py>0?"+":"−")+Math.abs(py).toFixed(0)+'%)</span>':"")+'</td><td class="c-spark">'+sparkSvg(r.v.slice(-52),96,24).replace('aria-hidden="true"','role="img" aria-label="'+esc(z)+' stored energy, last 52 weeks"')+'</td></tr>';});
 h+='</tbody></table></div><p class="pw-foot">Weekly aggregated filling of water reservoirs and hydro storage plants (A72), energy stored at week end. Complements NVE (Norway, % with history band) and Energiföretagen (Sweden) above.'+staleNote("reservoirs")+'</p>';
 box.innerHTML=h;}
function renderEntsoe(){renderWind();renderValue();renderOutages();}

/* ---------- sticky sub-navigation (static #pwSubnav in index.html) ---------- */
const NAV=[["pwSecSpot","Spot"],["pwSecFw","Forwards"],["pwSecDrv","Drivers"],["pwSecSE4","SE4"],["pwNews","News"]];
function navTarget(id){return $(id)||(id==="pwNews"?document.querySelector(".news-panel"):null);}
function initNav(){const nav=$("pwSubnav");if(!nav||nav.dataset.ready)return;nav.dataset.ready="1";
 nav.innerHTML=NAV.map(([id,l])=>'<a href="#'+id+'" class="pw-nav-a'+(id==="pwSecSE4"?" focus":"")+'" data-t="'+id+'">'+l+'</a>').join("");
 nav.querySelectorAll("a").forEach(a=>a.onclick=e=>{e.preventDefault();const el=navTarget(a.dataset.t);if(!el)return;const y=el.getBoundingClientRect().top+scrollY-nav.offsetHeight-8;scrollTo({top:Math.max(0,y),behavior:"smooth"});});
 let raf=0;addEventListener("scroll",()=>{if(raf||!shown)return;raf=requestAnimationFrame(()=>{raf=0;spy();});},{passive:true});}
function spy(){const nav=$("pwSubnav");if(!nav)return;const lim=nav.offsetHeight+40;let cur=NAV[0][0];
 NAV.forEach(([id])=>{const el=navTarget(id);if(el&&el.getBoundingClientRect().top<=lim)cur=id;});
 if(innerHeight+scrollY>=document.documentElement.scrollHeight-4)cur=NAV[NAV.length-1][0];
 nav.querySelectorAll("a").forEach(a=>{const on=a.dataset.t===cur;a.classList.toggle("is-on",on);if(on)a.setAttribute("aria-current","true");else a.removeAttribute("aria-current");});}

/* ---------- credits ---------- */
function renderCredits(){const sp=P.spot,srcs=(sp&&sp.sources)||[];const fail=(sp&&sp.status||[]).filter(x=>!x.ok&&x.src==="Energy-Charts"&&!(sp.zones&&sp.zones[x.zone]&&sp.zones[x.zone].src));
 $("pwCredits").innerHTML='Sources: forwards and drivers from <b>EEX</b> public daily settlements (API2 coal: ICE), collected by a daily scraper since 1 Sep 2026. Day-ahead: '+
 (srcs.includes("ENTSO-E")?'<a href="https://transparency.entsoe.eu" target="_blank" rel="noopener noreferrer">ENTSO-E Transparency Platform</a> (A44)'+(srcs.length>1?', ':''):'')+
 (srcs.includes("Energy-Charts")||!srcs.length?'<a href="https://www.energy-charts.info" target="_blank" rel="noopener noreferrer">Energy-Charts</a> (Fraunhofer ISE, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>)':'')+
 (srcs.includes("Energi Data Service")?', <a href="https://www.energidataservice.dk" target="_blank" rel="noopener noreferrer">Energi Data Service</a> (Energinet)':"")+(srcs.includes("spot-hinta.fi")?', <a href="https://spot-hinta.fi" target="_blank" rel="noopener noreferrer">spot-hinta.fi</a>':"")+
 (fail.length?' <span class="na">(primary source unavailable at last build for '+fail.length+' zone(s); fallback sources used where possible)</span>':"")+'. '+
 (P.capture&&P.capture.zones&&Object.keys(P.capture.zones).length?'FI / DE-LU capture prices use Energy-Charts generation (CC BY 4.0). ':'')+'Hydro: <a href="https://www.nve.no/energi/analyser-og-statistikk/magasinstatistikk/" target="_blank" rel="noopener noreferrer">NVE magasinstatistikk</a> (NLOD); Sweden: <a href="https://www.energiforetagen.se/statistik/kraftlaget/" target="_blank" rel="noopener noreferrer">Energiföretagen</a>. '+
 (P.svk?'SE4 load, flows and Sweden production: <a href="https://www.svk.se/om-kraftsystemet/kontrollrummet/" target="_blank" rel="noopener noreferrer">Svenska kraftnät Kontrollrummet</a> and <a href="https://data.svk.se" target="_blank" rel="noopener noreferrer">data.svk.se</a> (CC BY 4.0). ':'')+(EN()?'SE4 wind and solar (actual A75, day-ahead forecast A69), load (A65), flows (A11), outages (A78/A80) and reservoirs (A72): <a href="https://transparency.entsoe.eu" target="_blank" rel="noopener noreferrer">ENTSO-E Transparency Platform</a>; capture prices computed here. ':'')+'Zone outlines simplified from ENTSO-E bidding-zone shapes (entsoe-py, MIT). Day-ahead days follow the CET delivery day; times are Geneva time (CET/CEST). Prices in €/MWh, power in MW. Nordic avg is an unweighted mean of 12 zones, not the Nord Pool system price. n/a = not available from source.';}

/* ---------- main ---------- */
function renderAll(){if(!P)return;initNav();renderFocusKpis();renderKpis();renderDA();renderFw();renderDrivers();renderHydro();renderReservoirs();renderSe4();renderCredits();spy();}
async function load(force){if(loading&&!force)return loading;const v=$("powerView");if(!P)v.innerHTML='<div class="pw-empty pw-loading">Loading Nordic power data…</div>';
 loading=(async()=>{try{const r=await fetch("data/power.json?t="+Math.floor(Date.now()/6e4),{cache:"no-cache"});if(!r.ok)throw Error("HTTP "+r.status);P=await r.json();shell();renderAll();}
  catch(e){if(!P)v.innerHTML='<div class="pw-empty">Could not load data/power.json ('+esc(e.message)+'). If you opened the file directly, serve the folder over HTTP.</div>';}finally{loading=null;}})();return loading;}
let rt;window.addEventListener("resize",()=>{if(!shown||!P)return;clearTimeout(rt);rt=setTimeout(()=>{renderFw();renderHydro();renderSe4();},180);});
window.MMPower={show(){shown=true;if(!P)load();else renderAll();},hide(){shown=false;hideTip();},reload(){return load(true);}};
setInterval(()=>{if(shown&&P){renderFocusKpis();renderKpis();}},60000);
})();
