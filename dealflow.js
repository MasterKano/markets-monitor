/* Deal flow: material corporate announcements, last 30 days (data/dealflow.json, built by scripts/build_dealflow.py in the
   daily and power-run builds). Panel on the Equities page + helpers used by the company page (window.MMDeals).
   Types come from fixed keyword rules on the headline; routine notices are collapsed into counts. Times in Geneva time. */
(()=>{
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const TZ="Europe/Zurich",SEP=s=>s.replace(/\bSept\b/,"Sep");
const ft=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
const fd=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric",month:"short"});
const fdy=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric",month:"short",year:"numeric"});
const TYPES=[["ma","M&A","M&A / divestment"],["raise","Raise","Capital raise"],["ppa","PPA","PPA / offtake"],["financing","Debt","Financing / debt"],
 ["project","Project","Project / FID / operations"],["results","Results","Results / guidance"],["insider","Insider","Insider trade"],["other","Other","Other"]];
const TL=Object.fromEntries(TYPES.map(t=>[t[0],t])),TORDER=TYPES.map(t=>t[0]);
const GROUPS=[["all","All"],["ren","Renewables & Nordic"],["oil","Oil & gas"],["lse","London E&Ps"],["lun","Lundin Group"]];
const SRC={newsweb:"NewsWeb",mfn:"MFN",nasdaq:"Nasdaq Nordic",investegate:"RNS · Investegate",yahoo:"Yahoo Finance",fi:"FI register"};
const SRC_LONG={newsweb:"Oslo Børs NewsWeb",mfn:"MFN",nasdaq:"Nasdaq Nordic (GlobeNewswire)",investegate:"Investegate (RNS and other UK regulatory feeds)",yahoo:"Yahoo Finance news (media)",fi:"Finansinspektionen insider register"};
const TECH={solar:"Solar",wind:"Wind",battery:"Battery",datacentre:"Data centre"};
const LS="markets-monitor:dealflow";
const st=Object.assign({ty:"all",ren:false},(()=>{try{return JSON.parse(localStorage.getItem(LS)||"{}");}catch(e){return{};}})());
st.g=null;/* follows the table tab until a group chip is clicked */
let DF=null,P=null,shown=20,expanded=false;
const save=()=>{try{localStorage.setItem(LS,JSON.stringify({ty:st.ty,ren:st.ren}));}catch(e){}};

function load(){if(!P)P=fetch("data/dealflow.json?t="+Math.floor(Date.now()/6e5),{cache:"no-cache"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json();}).then(d=>{DF=d;return d;}).catch(e=>{P=null;throw e;});return P;}
const tAt=s=>SEP(ft.format(new Date(s)));
const ccyFmt=(c,v)=>{const a=Math.abs(v);const n=a>=1e9?(a/1e9).toFixed(a>=1e10?1:2)+"bn":a>=1e6?(a/1e6).toFixed(a>=1e8?0:a>=1e7?1:2)+"m":Math.round(a).toLocaleString("en-US");return(c==="EUR"?"€":c+" ")+n;};
const coName=s=>(DF&&DF.cos&&DF.cos[s]&&DF.cos[s].n)||s;
const inGroup=(s,g)=>{if(g==="all")return true;const gs=(DF.cos[s]||{}).g||[];return g==="oil"?gs.includes("og")||gs.includes("lse"):gs.includes(g);};
const renMA=it=>it.ty==="ma"&&it.f&&it.f.length;

/* "€/MW" with every input shown: stated amount ÷ stated capacity, converted at the build-day FX rate */
function mwHtml(m){if(!m)return"";const v=m.eur_mw/1e6;const lab=m.kind==="deal"?"Deal value per MW":"Investment per MW";
 const fx=m.ccy==="EUR"?"":' at EUR/'+esc(m.ccy)+' '+m.fx;
 return'<span class="df-mw" title="'+esc('Source sentence: "'+m.quote+'"')+'"><b>'+lab+' ≈ €'+(v>=1?v.toFixed(2):v.toFixed(3))+'m</b> = '+esc(m.amt_txt)+' ÷ '+(m.mw%1?m.mw:m.mw.toLocaleString("en-US"))+' MW'+fx+'</span>';}
function itemHtml(it,o){o=o||{};const T=TL[it.ty]||TL.other;const u=/^https?:\/\//i.test(it.u||"")?it.u:"#";
 const flags=(it.f||[]).map(f=>'<span class="df-flag f-'+f+'">'+TECH[f]+'</span>').join("");
 return'<li class="df-item">'+
  '<time datetime="'+esc(it.t)+'">'+esc(tAt(it.t))+'</time>'+
  '<span class="df-type t-'+it.ty+'" title="'+esc(T[2])+'">'+esc(T[1])+'</span>'+
  '<div class="df-main">'+(o.co!==false?'<button type="button" class="df-co" data-co="'+esc(it.s)+'" title="Open the company page">'+esc(coName(it.s))+'</button>':"")+
   '<a class="df-h" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(it.h)+'<span class="df-ext" aria-hidden="true"> ↗</span></a>'+
   (it.x?'<p class="df-x">'+esc(it.x)+'</p>':"")+
   ((flags||it.m)?'<div class="df-tags">'+flags+mwHtml(it.m)+'</div>':"")+
  '</div>'+
  '<span class="df-src">'+esc(SRC[it.src]||it.src)+(it.src==="yahoo"?"":"")+'</span></li>';}

function routineText(R){const L=(DF&&DF.routine_labels)||{};const tot={};Object.values(R).forEach(r=>Object.entries(r||{}).forEach(([k,v])=>tot[k]=(tot[k]||0)+v));
 const n=Object.values(tot).reduce((a,b)=>a+b,0);if(!n)return"";
 return n+" routine notice"+(n>1?"s":"")+" collapsed ("+Object.entries(tot).sort((a,b)=>b[1]-a[1]).map(([k,v])=>(L[k]||k).toLowerCase()+" "+v).join(", ")+")";}

/* ---------- Equities page panel ---------- */
function autoGroup(){const h=(location.hash||"").toLowerCase();return/renewables/.test(h)?"ren":/oil-gas/.test(h)?"oil":/lundin/.test(h)?"lun":"all";}
const curGroup=()=>st.g||autoGroup();
function filtered(){const g=curGroup();return DF.items.filter(it=>inGroup(it.s,g));}
function summary(list,g){const cnt={};list.forEach(it=>cnt[it.ty]=(cnt[it.ty]||0)+1);const n=list.length;if(!n)return"";
 const gl=(GROUPS.find(x=>x[0]===g)||GROUPS[0])[1];const ncos=new Set(Object.keys(DF.cos).filter(s=>inGroup(s,g))).size;
 const to=SEP(fd.format(new Date(DF.generated_utc)));
 return'<figure class="df-fig"><figcaption><span class="df-fig-t">Material announcements by type · '+esc(gl==="All"?"all groups":gl)+'<span class="df-fig-u"> · number of items</span></span>'+
  '<span class="df-fig-sub">Last '+(DF.window_days||30)+' days to '+esc(to)+' · '+ncos+' companies · exchange feeds, FI register and Yahoo news · routine notices excluded</span></figcaption>'+
  '<div class="df-bar" role="img" aria-label="'+esc(TORDER.filter(k=>cnt[k]).map(k=>TL[k][2]+" "+cnt[k]).join(", "))+'">'+
  TORDER.filter(k=>cnt[k]).map(k=>'<button type="button" class="t-'+k+(st.ty===k?" is-on":"")+'" style="flex:'+cnt[k]+'" data-dfty="'+k+'" title="'+esc(TL[k][2]+": "+cnt[k]+" · click to filter")+'">'+(cnt[k]/n>0.07?cnt[k]:"")+'</button>').join("")+'</div></figure>';}
function render(){const box=$("dfBody");if(!box)return;
 if(!DF){box.innerHTML='<p class="df-empty">Loading deal flow…</p>';return;}
 const g=curGroup(),base=filtered();let list=base.filter(it=>(st.ty==="all"||it.ty===st.ty)&&(!st.ren||renMA(it)));
 const tc={};base.forEach(it=>tc[it.ty]=(tc[it.ty]||0)+1);const nRen=base.filter(renMA).length;
 const gc=Object.fromEntries(GROUPS.map(([k])=>[k,DF.items.filter(it=>inGroup(it.s,k)).length]));
 $("dfMeta").textContent="Last "+(DF.window_days||30)+" days · updated "+SEP(ft.format(new Date(DF.generated_utc)))+" Geneva";
 const R={};Object.entries(DF.routine||{}).forEach(([s,v])=>{if(inGroup(s,g))R[s]=v;});
 box.innerHTML=summary(base,g)+
  '<div class="df-ctl"><div class="df-chips" role="group" aria-label="Company group">'+GROUPS.map(([k,l])=>'<button type="button" class="chip'+(g===k?" is-on":"")+'" data-dfg="'+k+'" aria-pressed="'+(g===k)+'">'+esc(l)+' <small>'+gc[k]+'</small></button>').join("")+'</div>'+
  '<div class="df-chips" role="group" aria-label="Announcement type"><button type="button" class="chip'+(st.ty==="all"?" is-on":"")+'" data-dfty="all" aria-pressed="'+(st.ty==="all")+'">All types <small>'+base.length+'</small></button>'+
   TORDER.filter(k=>tc[k]).map(k=>'<button type="button" class="chip df-tchip t-'+k+(st.ty===k?" is-on":"")+'" data-dfty="'+k+'" aria-pressed="'+(st.ty===k)+'" title="'+esc(TL[k][2])+'"><i></i>'+esc(TL[k][1])+' <small>'+tc[k]+'</small></button>').join("")+
   '<button type="button" class="chip df-ren'+(st.ren?" is-on":"")+'" data-dfren="1" aria-pressed="'+st.ren+'" title="M&A that mentions solar, wind, battery storage or data centres">Solar · wind · battery · data-centre M&A <small>'+nRen+'</small></button></div></div>'+
  (list.length?'<ol class="df-list">'+list.slice(0,expanded?list.length:shown).map(it=>itemHtml(it)).join("")+'</ol>'+
   (list.length>shown?'<button type="button" class="df-more" data-dfmore="1" aria-expanded="'+expanded+'">'+(expanded?"Show fewer":"Show all "+list.length)+'</button>':""):
   '<p class="df-empty">No announcements of this type in the last '+(DF.window_days||30)+' days for this group.</p>')+
  '<details class="df-how"><summary>How items are chosen and classified</summary><div class="df-how-body">'+
   '<p>Announcements from the last '+(DF.window_days||30)+' days for the companies in the Renewables (incl. strategic peers), Oil &amp; Gas (incl. London-listed E&amp;Ps) and Lundin Group tabs. Each headline gets the first matching type, in this order: '+
   '<b>Insider trade</b> (PDMR / primary-insider notices, director dealings) → <b>PPA / offtake</b> (PPA, offtake, CfD, gas/power sales agreements) → <b>M&amp;A</b> (acquire, merger, offer, scheme, divest, sale of, farm-in/out, JV) → <b>Capital raise</b> (placing, private placement, rights/share issue, IPO) → '+
   '<b>Financing</b> (bonds, notes, loans, facilities, refinancing) → <b>Results</b> (results, interim/annual report, trading or production update, guidance) → <b>Project</b> (FID, construction, commissioning, first oil/gas/power, drilling, discoveries, permits, orders, MW) → <b>Other</b>. '+
   'Source categories (NewsWeb, Nasdaq, MFN tags) are only used when the headline matches nothing.</p>'+
   '<p><b>Routine notices are collapsed</b>, not listed: buyback reports, voting rights / holdings / Form 8.3, AGM and meeting notices, dividend notices, calendars, invitations and employee share plans. '+esc(routineText(R)||"None in this group.")+'</p>'+
   '<p><b>Flags</b> (Solar, Wind, Battery, Data centre) come from the headline and the opening of the release. <b>Value per MW</b> is computed only when one sentence states exactly one amount and one capacity: amount ÷ MW, converted to euros at the FX rate of the build day. Headline values can include or exclude debt, earn-outs and development stage, so treat them as indicative.</p>'+
   '<p><b>Sources:</b> '+(DF.sources||[]).map(s=>esc(SRC_LONG[s.id]||s.label)+' ('+(s.fail?s.ok+" ok, "+s.fail+" failed":"ok")+')').join(" · ")+'. Media headlines from Yahoo are kept only when they name the company and match a type other than Other or Insider.</p>'+
  '</div></details>';}
function bind(){const box=$("dfBody");if(!box||box.dataset.bound)return;box.dataset.bound="1";
 box.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.dfg){st.g=b.dataset.dfg===autoGroup()?null:b.dataset.dfg;expanded=false;render();}
  else if(b.dataset.dfty){st.ty=st.ty===b.dataset.dfty&&b.closest(".df-bar")?"all":b.dataset.dfty;expanded=false;save();render();}
  else if(b.dataset.dfren){st.ren=!st.ren;if(st.ren)st.ty="all";expanded=false;save();render();}
  else if(b.dataset.dfmore){expanded=!expanded;render();if(!expanded)$("dfPanel").scrollIntoView({block:"start"});}
  else if(b.dataset.co){location.hash="co="+encodeURIComponent(b.dataset.co);}});}
function init(){if(!$("dfPanel"))return;bind();render();load().then(render).catch(e=>{const box=$("dfBody");if(box)box.innerHTML='<p class="df-empty">Deal flow not available yet ('+esc(e.message)+').</p>';});
 window.addEventListener("hashchange",()=>{if(!st.g&&DF&&!/^#co=/.test(location.hash))render();});}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();

/* ---------- company page helpers ---------- */
window.MMDeals={load,peek:()=>DF,itemHtml,
 covered:s=>!!(DF&&DF.cos&&DF.cos[s]),
 items:s=>DF?DF.items.filter(it=>it.s===s):[],
 routine:s=>(DF&&DF.routine&&DF.routine[s])||null,routineText:s=>DF&&DF.routine&&DF.routine[s]?routineText({[s]:DF.routine[s]}):"",
 fi:s=>(DF&&DF.fi&&DF.fi[s])||null,hasFi:s=>!!(DF&&DF.cos&&DF.cos[s]&&DF.cos[s].fi),
 source:s=>DF&&DF.cos&&DF.cos[s]?SRC_LONG[DF.cos[s].src]||"":"",
 meta:()=>DF?{days:DF.window_days||30,fiDays:DF.fi_days||90,updated:SEP(ft.format(new Date(DF.generated_utc)))}:null};
})();
