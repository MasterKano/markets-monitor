"use strict";
/* Monitor page: four TradingView widget charts (Markets, Commodities, FX, Rates / Bonds), plus the chart modal
   used by the Table page (window.MM). Treasury yields (TVC:US*) are not embeddable, so Rates uses bond ETFs. */
const PANELS=[
{id:"markets",label:"Markets",search:true,options:[["S&P 500","OANDA:SPX500USD"],["Nasdaq 100","OANDA:NAS100USD"],["Dow Jones","OANDA:US30USD"],["FTSE 100","OANDA:UK100GBP"],["DAX","OANDA:DE30EUR"],["Euro Stoxx 50","OANDA:EU50EUR"],["SMI (Swiss)","OANDA:CH20CHF"],["Nikkei 225","OANDA:JP225USD"],["Hang Seng","OANDA:HK33HKD"],["ASX 200","OANDA:AU200AUD"]]},
{id:"commodities",label:"Commodities",options:[["Brent","OANDA:BCOUSD"],["WTI","OANDA:WTICOUSD"],["Nat Gas","OANDA:NATGASUSD"],["Gold","OANDA:XAUUSD"],["Silver","OANDA:XAGUSD"],["Copper","OANDA:XCUUSD"],["Platinum","OANDA:XPTUSD"],["Palladium","OANDA:XPDUSD"],["Corn","OANDA:CORNUSD"],["Wheat","OANDA:WHEATUSD"]]},
{id:"fx",label:"FX",options:[["EUR/CHF","OANDA:EURCHF"],["USD/CHF","OANDA:USDCHF"],["GBP/CHF","OANDA:GBPCHF"],["EUR/USD","OANDA:EURUSD"],["GBP/USD","OANDA:GBPUSD"],["USD/JPY","OANDA:USDJPY"],["EUR/GBP","OANDA:EURGBP"],["USD/CNH","OANDA:USDCNH"],["AUD/USD","OANDA:AUDUSD"],["DXY","TVC:DXY"]]},
/* exchange prefixes checked against TradingView symbol search (Nasdaq vs NYSE Arca = AMEX) */
{id:"rates",label:"Rates / Bonds",options:[["TLT 20Y+ Treasury","NASDAQ:TLT"],["TLH 10-20Y Treasury","AMEX:TLH"],["IEF 7-10Y Treasury","NASDAQ:IEF"],["IEI 3-7Y Treasury","NASDAQ:IEI"],["SHY 1-3Y Treasury","NASDAQ:SHY"],["VGSH Short Treasury","NASDAQ:VGSH"],["BIL 1-3M T-Bills","AMEX:BIL"],["TIP TIPS","AMEX:TIP"],["BND Total Bond","NASDAQ:BND"],["MBB MBS","NASDAQ:MBB"],["LQD IG Corporate","AMEX:LQD"],["HYG High Yield","AMEX:HYG"],["EMB EM USD Debt","NASDAQ:EMB"]]}
];
/* preset chips under the Markets chart */
const HOT=[["Apple","NASDAQ:AAPL"],["Microsoft","NASDAQ:MSFT"],["Nvidia","NASDAQ:NVDA"],["Amazon","NASDAQ:AMZN"],["Meta","NASDAQ:META"],["Alphabet","NASDAQ:GOOGL"],["Tesla","NASDAQ:TSLA"],["Berkshire","NYSE:BRK.B"],["Nestle","SIX:NESN"],["Roche","SIX:ROG"],["Novartis","SIX:NOVN"],["UBS","SIX:UBSG"],["ASML","EURONEXT:ASML"],["LVMH","EURONEXT:MC"],["Toyota","TSE:7203"]];
/* offline search list. UNIVERSE is generated from scripts/universe.py (equity, ETF and index rows with a TradingView symbol). */
const UNIVERSE=[
["Cloudberry Clean Energy","OSL:CLOUD","Stock"],
["Scatec","OSL:SCATC","Stock"],
["Eolus B","OMXSTO:EOLU_B","Stock"],
["Orrön Energy","OMXSTO:ORRON","Stock"],
["Magnora","OSL:MGN","Stock"],
["Ørsted","OMXCOP:ORSTED","Stock"],
["Vestas Wind Systems","OMXCOP:VWS","Stock"],
["Fortum","OMXHEX:FORTUM","Stock"],
["RWE","XETR:RWE","Stock"],
["EDP Renováveis","EURONEXT:EDPR","Stock"],
["Acciona Energía","BME:ANE","Stock"],
["Solaria","BME:SLR","Stock"],
["Grenergy","BME:GRE","Stock"],
["ERG","MIL:ERG","Stock"],
["Voltalia","EURONEXT:VLTSA","Stock"],
["Nordex","XETR:NDX1","Stock"],
["iShares Global Clean Energy (UCITS)","LSE:INRG","ETF"],
["Equinor","OSL:EQNR","Stock"],
["Aker ASA","OSL:AKER","Stock"],
["Bonheur","OSL:BONHR","Stock"],
["Verbund","VIE:VER","Stock"],
["TotalEnergies","EURONEXT:TTE","Stock"],
["Brookfield Renewable","NYSE:BEP","Stock"],
["EQT AB","OMXSTO:EQT","Stock"],
["KKR","NYSE:KKR","Stock"],
["Shell","LSE:SHEL","Stock"],
["BP","LSE:BP","Stock"],
["Exxon Mobil","NYSE:XOM","Stock"],
["ConocoPhillips","NYSE:COP","Stock"],
["Canadian Natural Resources","TSX:CNQ","Stock"],
["Aker BP","OSL:AKRBP","Stock"],
["Vår Energi","OSL:VAR","Stock"],
["Harbour Energy","LSE:HBR","Stock"],
["Tourmaline Oil","TSX:TOU","Stock"],
["Energy Select Sector SPDR","AMEX:XLE","ETF"],
["SPDR S&P Oil & Gas E&P","AMEX:XOP","ETF"],
["International Petroleum Corp","TSX:IPCO","Stock"],
["Lundin Mining","TSX:LUN","Stock"],
["Lundin Gold","TSX:LUG","Stock"],
["NGEx Minerals","TSX:NGEX","Stock"],
["Lucara Diamond","TSX:LUC","Stock"],
["Montage Gold","TSX:MAU","Stock"],
["LunR Royalties","TSX:LUNR","Stock"],
["ShaMaran Petroleum","OSL:SNM","Stock"],
["BHP","LSE:BHP","Stock"],
["Rio Tinto","LSE:RIO","Stock"],
["Glencore","LSE:GLEN","Stock"],
["Anglo American","LSE:AAL","Stock"],
["Antofagasta","LSE:ANTO","Stock"],
["Freeport-McMoRan","NYSE:FCX","Stock"],
["First Quantum","TSX:FM","Stock"],
["Teck Resources B","TSX:TECK.B","Stock"],
["Boliden","OMXSTO:BOL","Stock"],
["Norsk Hydro","OSL:NHY","Stock"],
["Newmont","NYSE:NEM","Stock"],
["Barrick Mining","NYSE:B","Stock"],
["Agnico Eagle","NYSE:AEM","Stock"],
["Cameco","NYSE:CCJ","Stock"],
["VanEck Gold Miners","AMEX:GDX","ETF"],
["Global X Copper Miners","AMEX:COPX","ETF"],
["Sprott Physical Uranium","TSX:U.UN","ETF"],
["EU carbon (EUA ETC)","LSE:CO2","ETF"],
["S&P 500","OANDA:SPX500USD","Index"],
["Nasdaq Composite","NASDAQ:IXIC","Index"],
["Dow Jones","OANDA:US30USD","Index"],
["STOXX Europe 600","TVC:SXXP","Index"],
["Euro Stoxx 50","OANDA:EU50EUR","Index"],
["DAX","OANDA:DE30EUR","Index"],
["FTSE 100","OANDA:UK100GBP","Index"],
["SMI","OANDA:CH20CHF","Index"],
["Oslo Børs Benchmark","OSL:OSEBX","Index"],
["OMX Stockholm 30","OMXSTO:OMXS30","Index"],
["OMX Copenhagen 25","OMXCOP:OMXC25","Index"],
["OMX Helsinki 25","OMXHEX:OMXH25","Index"],
["Nikkei 225","OANDA:JP225USD","Index"],
["Hang Seng","OANDA:HK33HKD","Index"],
["CBOE VIX","TVC:VIX","Index"],
["iShares 20+Y Treasury (TLT)","NASDAQ:TLT","ETF"]
];
const EXTRA=[["JPMorgan Chase","NYSE:JPM","Stock"],["Visa","NYSE:V","Stock"],["Eli Lilly","NYSE:LLY","Stock"],["Broadcom","NASDAQ:AVGO","Stock"],["Netflix","NASDAQ:NFLX","Stock"],["AMD","NASDAQ:AMD","Stock"],["Palantir","NASDAQ:PLTR","Stock"],["SAP","XETR:SAP","Stock"],["Siemens","XETR:SIE","Stock"],["Richemont","SIX:CFR","Stock"],["ABB","SIX:ABBN","Stock"],["Zurich Insurance","SIX:ZURN","Stock"],["Novo Nordisk","OMXCOP:NOVO_B","Stock"],
["SPDR S&P 500 ETF","AMEX:SPY","ETF"],["Invesco QQQ","NASDAQ:QQQ","ETF"],["iShares Russell 2000","AMEX:IWM","ETF"],["SPDR Gold Shares","AMEX:GLD","ETF"],["iShares Silver Trust","AMEX:SLV","ETF"],["iShares MSCI Emerging Markets","AMEX:EEM","ETF"],["Vanguard FTSE Europe","AMEX:VGK","ETF"],["US Oil Fund","AMEX:USO","ETF"],["Uranium ETF (URA)","AMEX:URA","ETF"]];
const KIND_BY_PANEL={markets:"Index",commodities:"Commodity",fx:"FX",rates:"ETF"};
const LOCAL=(()=>{const m=new Map();const add=(n,s,k)=>{if(!m.has(s))m.set(s,{name:n,symbol:s,exchange:s.split(":")[0],kind:k});};
 PANELS[0].options.forEach(([n,s])=>add(n,s,"Index"));HOT.forEach(([n,s])=>add(n,s,"Stock"));UNIVERSE.forEach(([n,s,k])=>add(n,s,k));EXTRA.forEach(([n,s,k])=>add(n,s,k));
 PANELS.slice(1).forEach(p=>p.options.forEach(([n,s])=>add(n,s,KIND_BY_PANEL[p.id])));return[...m.values()];})();
const KEY="markets-monitor:v6",MAX_RECENT=8;
const $=id=>document.getElementById(id);
function defState(){return{page:"table",tableLanding:true,tableChart:{name:"",symbol:""},interval:"D",studies:"ma",layout:"grid",theme:"dark",phoneIndex:0,selections:Object.fromEntries(PANELS.map(p=>[p.id,p.options[0][1]])),custom:Object.fromEntries(PANELS.map(p=>[p.id,[]]))};}
function load(){const c=defState();try{const s=JSON.parse(localStorage.getItem(KEY)||"null");if(!s)return c;
 if(s.page)c.page=s.tableLanding?(s.page==="equities"?"monitor":s.page):"table";if(c.page!=="table"&&c.page!=="monitor")c.page="table";
 ["interval","studies","layout","theme"].forEach(k=>{if(s[k])c[k]=s[k];});if(s.selections)PANELS.forEach(p=>{if(s.selections[p.id])c.selections[p.id]=s.selections[p.id];});
 /* the old Rates list used NASDAQ: for NYSE Arca ETFs; map saved picks onto the corrected symbols */
 const FIX={"NASDAQ:BIL":"AMEX:BIL","NASDAQ:HYG":"AMEX:HYG","NASDAQ:LQD":"AMEX:LQD","TVC:DXY":"NASDAQ:TLT"};if(FIX[c.selections.rates])c.selections.rates=FIX[c.selections.rates];
 if(s.custom)PANELS.forEach(p=>{if(Array.isArray(s.custom[p.id]))c.custom[p.id]=s.custom[p.id];});}catch(e){}return c;}
let state=load();let tvP=null;const dash=$("dashboard");
const runtime=Object.fromEntries(PANELS.map(p=>[p.id,{vis:false,done:false}]));runtime.tablechart={vis:true,done:false};const CHART_IDS=()=>[...PANELS.map(p=>p.id),"tablechart"];
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
function opts(id){return PANELS.find(p=>p.id===id).options.concat(state.custom[id]||[]);}
function nameOf(id){const s=state.selections[id];const m=opts(id).find(o=>o[1]===s)||(LOCAL.find(x=>x.symbol===s)||{}).name;return Array.isArray(m)?m[0]:(m||s);}
function studies(){const a=[];if(state.studies.includes("ma"))a.push({id:"MASimple@tv-basicstudies",inputs:{length:50}},{id:"MASimple@tv-basicstudies",inputs:{length:100}},{id:"MASimple@tv-basicstudies",inputs:{length:200}});if(state.studies.includes("vol"))a.push({id:"Volume@tv-basicstudies"});if(state.studies.includes("rsi"))a.push({id:"RSI@tv-basicstudies",inputs:{length:14}});return a;}
function loadTV(){if(window.TradingView)return Promise.resolve(window.TradingView);if(tvP)return tvP;tvP=new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://s3.tradingview.com/tv.js";s.async=true;s.onload=()=>window.TradingView?res(window.TradingView):rej(Error("TradingView did not initialise"));s.onerror=()=>{tvP=null;rej(Error("TradingView script blocked or offline"));};document.head.append(s);});return tvP;}
function status(id,mode,msg){const el=$("status_"+id);if(!el)return;if(mode==="ready"){el.hidden=true;el.replaceChildren();return;}el.hidden=false;el.textContent=msg||"";}
async function render(id,force){const r=runtime[id];if(!r)return;if(!force&&!r.vis&&!r.done)return;r.done=true;const box=$("chart_"+id);if(!box)return;box.replaceChildren();
 const tgt=id==="tablechart"?state.tableChart:null;const sym=tgt?tgt.symbol:state.selections[id];const nm=tgt?tgt.name:nameOf(id);if(!sym)return;if(id==="tablechart"&&$("chartModal").hidden)return;
 status(id,"loading","Loading "+nm+"…");
 try{const TV=await loadTV();box.replaceChildren();new TV.widget({autosize:true,symbol:sym,interval:state.interval,timezone:"Europe/Zurich",theme:state.theme,style:"1",locale:"en",hide_side_toolbar:true,
  allow_symbol_change:id==="markets"||id==="tablechart",studies:studies(),container_id:"chart_"+id,support_host:"https://www.tradingview.com"});setTimeout(()=>status(id,"ready"),1600);}
 catch(e){status(id,"err",e.message);}}

/* ---------- panels ---------- */
function fillSelect(id){const sel=$("select_"+id);if(!sel)return;sel.replaceChildren();const p=PANELS.find(x=>x.id===id);
 p.options.forEach(([n,s])=>sel.add(new Option(n,s,false,s===state.selections[id])));const cus=state.custom[id]||[];
 if(cus.length){const g=document.createElement("optgroup");g.label=p.search?"Recent":"Added";cus.forEach(([n,s])=>g.append(new Option(n,s,false,s===state.selections[id])));sel.append(g);}
 if(!opts(id).some(o=>o[1]===state.selections[id]))sel.add(new Option(nameOf(id),state.selections[id],true,true));}
function syncHead(id){$("title_"+id).textContent=nameOf(id);$("meta_"+id).textContent=state.selections[id];const sel=$("select_"+id);if(sel)sel.value=state.selections[id];
 if(id==="markets")document.querySelectorAll("#chips_markets .chip").forEach(c=>c.classList.toggle("is-on",c.dataset.symbol===state.selections.markets));}
function build(){const add=$("addPanelSelect");add.replaceChildren();const f=document.createDocumentFragment();
 PANELS.forEach(cfg=>{add.add(new Option(cfg.label,cfg.id));const p=document.createElement("section");p.className="panel panel-"+cfg.id;p.id="panel_"+cfg.id;p.dataset.panelId=cfg.id;
  p.innerHTML='<div class="panel-head"><div class="panel-id"><span class="panel-label"></span><strong class="panel-title" id="title_'+cfg.id+'"></strong><div class="panel-meta" id="meta_'+cfg.id+'"></div></div><div class="panel-controls"></div></div>'
   +(cfg.search?'<div class="chips panel-chips" id="chips_'+cfg.id+'" role="group" aria-label="Quick picks"></div>':"")
   +'<div class="chart-stage"><div class="chart" id="chart_'+cfg.id+'"></div><div class="chart-status" id="status_'+cfg.id+'"></div></div>';
  p.querySelector(".panel-label").textContent=cfg.label;const ctl=p.querySelector(".panel-controls");
  if(cfg.search){const sb=document.createElement("div");sb.className="search-box panel-search";sb.innerHTML='<input type="search" class="search-input" id="search_'+cfg.id+'" placeholder="Search stock, ETF, index or EXCH:SYM" autocomplete="off" spellcheck="false" aria-label="Search a symbol for the '+cfg.label+' chart" aria-autocomplete="list" aria-controls="suggest_'+cfg.id+'"><div class="suggest" id="suggest_'+cfg.id+'" role="listbox" hidden></div>';ctl.append(sb);}
  const sel=document.createElement("select");sel.className="instrument-select";sel.id="select_"+cfg.id;sel.dataset.panelId=cfg.id;sel.setAttribute("aria-label",cfg.label+" instrument");ctl.append(sel);f.append(p);});
 dash.replaceChildren(f);PANELS.forEach(cfg=>{fillSelect(cfg.id);syncHead(cfg.id);});chips();wireSearch("markets");}
function choose(id,item){const s=item.symbol.trim().toUpperCase();if(!s)return;
 if(!opts(id).some(o=>o[1]===s)){state.custom[id]=[[item.name||s,s]].concat((state.custom[id]||[]).filter(x=>x[1]!==s)).slice(0,MAX_RECENT);}
 state.selections[id]=s;save();fillSelect(id);syncHead(id);render(id,true);}
function chips(){const box=$("chips_markets");if(!box)return;box.replaceChildren();HOT.forEach(([name,symbol])=>{const b=document.createElement("button");b.type="button";b.className="chip"+(symbol===state.selections.markets?" is-on":"");b.dataset.symbol=symbol;b.textContent=name;b.title=symbol;b.onclick=()=>choose("markets",{name,symbol});box.append(b);});}

/* ---------- type-ahead search (local list first, TradingView lookup when reachable) ---------- */
const fold=s=>String(s).toLowerCase().replace(/ø/g,"o").replace(/æ/g,"ae").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
function localQ(q){const n=fold(q.trim());if(!n)return HOT.slice(0,10).map(([name,symbol])=>LOCAL.find(x=>x.symbol===symbol));
 const sc=x=>{const nm=fold(x.name),sy=fold(x.symbol),tk=sy.split(":")[1]||sy;if(tk===n||sy===n)return 0;if(tk.startsWith(n))return 1;if(nm.startsWith(n))return 2;if(nm.split(/[\s(/.-]+/).some(w=>w.startsWith(n)))return 3;if(nm.includes(n)||sy.includes(n))return 4;return 9;};
 return LOCAL.map(x=>[sc(x),x]).filter(a=>a[0]<9).sort((a,b)=>a[0]-b[0]).slice(0,10).map(a=>a[1]);}
async function remoteQ(q){const u="https://symbol-search.tradingview.com/symbol_search/v3/?text="+encodeURIComponent(q)+"&hl=0&lang=en&domain=production";const r=await fetch(u);if(!r.ok)throw Error("lookup "+r.status);const d=await r.json();const rows=Array.isArray(d)?d:(d.symbols||[]);
 return rows.slice(0,12).map(row=>{const t=(row.symbol||"").replace(/<\/?em>/g,"");const ex=row.prefix||row.exchange||"";return{name:(row.description||t).replace(/<\/?em>/g,""),symbol:ex&&t?ex+":"+t:t,exchange:ex,kind:row.type||""};}).filter(x=>x.symbol.includes(":"));}
function wireSearch(id){const inp=$("search_"+id),box=$("suggest_"+id);if(!inp)return;let items=[],act=-1,timer,seq=0;
 const draw=()=>{box.replaceChildren();if(!items.length){box.hidden=true;inp.setAttribute("aria-expanded","false");return;}
  items.forEach((it,i)=>{const b=document.createElement("button");b.type="button";b.setAttribute("role","option");b.className=i===act?"is-active":"";b.innerHTML='<span class="sym"></span><span class="ex"></span><span class="desc"></span>';b.querySelector(".sym").textContent=it.symbol;b.querySelector(".ex").textContent=[it.kind,it.exchange].filter(Boolean).join(" · ");b.querySelector(".desc").textContent=it.name;b.onmousedown=e=>{e.preventDefault();pick(it);};box.append(b);});
  box.hidden=false;inp.setAttribute("aria-expanded","true");};
 const pick=it=>{items=[];act=-1;draw();inp.value="";inp.blur();choose(id,it);};
 const run=async q=>{const my=++seq;items=localQ(q).filter(Boolean);act=-1;draw();const t=q.trim();if(t.length<2)return;
  try{const rem=await remoteQ(t);if(my!==seq||!rem.length)return;const have=new Set(items.map(x=>x.symbol));items=items.slice(0,5).concat(rem.filter(x=>!have.has(x.symbol))).slice(0,12);draw();}catch(e){/* offline or blocked: local results stay */}};
 inp.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>run(inp.value),140);});
 inp.addEventListener("focus",()=>run(inp.value));
 inp.addEventListener("blur",()=>setTimeout(()=>{box.hidden=true;inp.setAttribute("aria-expanded","false");},160));
 inp.addEventListener("keydown",e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){if(!items.length)return;e.preventDefault();act=(act+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;draw();box.children[act]&&box.children[act].scrollIntoView({block:"nearest"});}
  else if(e.key==="Enter"){e.preventDefault();const v=inp.value.trim();if(act>=0&&items[act])pick(items[act]);else if(/^[A-Za-z0-9_!.]+:[A-Za-z0-9_!.]+$/.test(v))pick({name:v.toUpperCase(),symbol:v});else if(items[0])pick(items[0]);}
  else if(e.key==="Escape"){items=[];draw();inp.blur();}});}

/* ---------- page, layout, phone ---------- */
function phone(){const on=matchMedia("(max-width:760px)").matches&&state.page==="monitor";document.body.classList.toggle("is-phone-focus",on);if(!on)return;state.phoneIndex=((state.phoneIndex%PANELS.length)+PANELS.length)%PANELS.length;PANELS.forEach((p,i)=>$("panel_"+p.id).classList.toggle("is-phone-active",i===state.phoneIndex));$("mobilePanelLabel").textContent=PANELS[state.phoneIndex].label;const id=PANELS[state.phoneIndex].id;runtime[id].vis=true;render(id,true);}
function setPage(pg){state.page=pg;save();document.body.dataset.page=pg;["table","monitor"].forEach(k=>{const on=pg===k;$(k+"Page").classList.toggle("is-on",on);const b=$("page"+k[0].toUpperCase()+k.slice(1));b.classList.toggle("is-on",on);b.setAttribute("aria-pressed",on);});
 if(pg!=="table"&&!$("chartModal").hidden)$("cmClose").click();phone();}
function apply(){$("intervalSelect").value=state.interval;$("studiesSelect").value=state.studies;dash.classList.toggle("is-stacked",state.layout==="stack");document.documentElement.dataset.theme=state.theme;$("themeButton").textContent=state.theme==="dark"?"Light":"Dark";$("layoutButton").textContent=state.layout==="stack"?"Grid view":"Stack view";setPage(state.page);}
function lazy(){if(!("IntersectionObserver"in window)){PANELS.forEach(p=>{runtime[p.id].vis=true;render(p.id,true);});return;}const io=new IntersectionObserver(es=>es.forEach(e=>{const id=e.target.dataset.panelId;runtime[id].vis=e.isIntersecting;if(e.isIntersecting)render(id,false);}),{rootMargin:"240px"});PANELS.forEach(p=>io.observe($("panel_"+p.id)));}
function clocks(){const g=$("genevaClock"),u=$("utcClock");const o={weekday:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false};const gf=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Zurich",...o}),uf=new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",...o});const t=()=>{const n=new Date();g.textContent=gf.format(n);u.textContent=uf.format(n);};t();setInterval(t,1000);}
const rerender=()=>CHART_IDS().forEach(id=>runtime[id].done&&render(id,true));
dash.addEventListener("change",e=>{const s=e.target.closest("select[data-panel-id]");if(!s)return;const id=s.dataset.panelId;state.selections[id]=s.value;save();syncHead(id);render(id,true);});
$("intervalSelect").onchange=e=>{state.interval=e.target.value;save();rerender();};
$("studiesSelect").onchange=e=>{state.studies=e.target.value;save();rerender();};
$("layoutButton").onclick=()=>{state.layout=state.layout==="grid"?"stack":"grid";save();apply();};
$("themeButton").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";save();apply();rerender();};
$("refreshButton").onclick=()=>state.page==="table"?(window.MMTable&&window.MMTable.reload()):PANELS.forEach(p=>render(p.id,true));
$("resetButton").onclick=()=>{const pg=state.page;state=defState();state.page=pg;save();build();apply();PANELS.forEach(p=>runtime[p.id].done&&render(p.id,true));};
$("addSymbolButton").onclick=()=>$("addBar").classList.toggle("is-open");
$("addConfirmButton").onclick=()=>{const id=$("addPanelSelect").value,n=$("addNameInput").value.trim(),s=$("addSymbolInput").value.trim().toUpperCase();if(!n||!s)return;state.custom[id]=(state.custom[id]||[]).filter(x=>x[1]!==s);state.custom[id].push([n,s]);state.selections[id]=s;save();fillSelect(id);syncHead(id);render(id,true);};
$("prevPanelButton").onclick=()=>{state.phoneIndex--;save();phone();};
$("nextPanelButton").onclick=()=>{state.phoneIndex++;save();phone();};
$("pageTable").onclick=()=>setPage("table");$("pageMonitor").onclick=()=>setPage("monitor");
window.addEventListener("resize",phone);
window.MM={openChart(name,symbol){state.tableChart={name,symbol};save();render("tablechart",true);},clearChart(){state.tableChart={name:"",symbol:""};save();const b=$("chart_tablechart");b&&b.replaceChildren();status("tablechart","ready");}};
build();apply();clocks();lazy();
