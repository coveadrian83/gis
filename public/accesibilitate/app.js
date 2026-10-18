/* Accesibilitatea la transportul public – Iași și ZMI.
   Date: data/detaliu.json (caroiaj 100 m, Madina), data/general.json (cartiere și UAT-uri) și
   data/frecventa.json (frecvența din GTFS CTP și bazinele de captare, scripts/accesibilitate/frecventa.py) și
   data/velo.json (rețeaua velo propusă prin MPM 2026, scripts/accesibilitate/velo.py). */
(async()=>{
'use strict';
const load=async n=>{const r=await fetch('data/'+n,{cache:'no-cache'});if(!r.ok)throw new Error(n+': '+r.status);return r.json();};
let DET,GEN,FRQ,VEL;
try{[DET,GEN,FRQ,VEL]=await Promise.all([load('detaliu.json'),load('general.json'),load('frecventa.json'),load('velo.json')]);}
catch(e){const el=document.getElementById('loading');if(el)el.textContent='Datele nu s-au putut încărca. Reîncărcați pagina.';return;}
document.getElementById('loading')?.remove();
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt=n=>Math.round(n).toLocaleString('ro-RO');
const f1=n=>n==null?'–':n.toLocaleString('ro-RO',{maximumFractionDigits:1});
const lat0=47.16,lon0=27.59,kx=111320*Math.cos(lat0*Math.PI/180),ky=110540;
const pr=q=>[(q[0]-lon0)*kx,-(q[1]-lat0)*ky];
const S={scen:'existent',tren:'v1'};
const scenKey=()=>S.scen==='existent'?'existent':'propus_'+S.tren;
const listeners=[];

/* reusable pan/zoom canvas */
function MapView(mapEl,cv,onDraw,onClick,onHover){
  const ctx=cv.getContext('2d');const m={ctx,view:{x:0,y:0,s:.02},W:0,H:0,dpr:1,fitted:false,bounds:null};
  m.sx=x=>(x-m.view.x)*m.view.s+m.W/2;m.sy=y=>(y-m.view.y)*m.view.s+m.H/2;
  m.fit=(a=m.bounds)=>{m.view.x=(a[0]+a[2])/2;m.view.y=(a[1]+a[3])/2;m.view.s=Math.min(m.W/(a[2]-a[0]),m.H/(a[3]-a[1]))*.95;};
  m.size=()=>{const r=mapEl.getBoundingClientRect();m.dpr=devicePixelRatio||1;m.W=r.width;m.H=r.height;cv.width=m.W*m.dpr;cv.height=m.H*m.dpr;};
  m.draw=()=>{if(!m.W)return;ctx.setTransform(m.dpr,0,0,m.dpr,0,0);onDraw(m);};
  m.zoomAt=(f,cx,cy)=>{const v=m.view,wx=(cx-m.W/2)/v.s+v.x,wy=(cy-m.H/2)/v.s+v.y;v.s=Math.max(.004,Math.min(1.5,v.s*f));v.x=wx-(cx-m.W/2)/v.s;v.y=wy-(cy-m.H/2)/v.s;m.draw();};
  m.world=(px,py)=>[(px-m.W/2)/m.view.s+m.view.x,(py-m.H/2)/m.view.s+m.view.y];
  mapEl.addEventListener('wheel',e=>{e.preventDefault();const r=mapEl.getBoundingClientRect();m.zoomAt(e.deltaY<0?1.25:.8,e.clientX-r.left,e.clientY-r.top);},{passive:false});
  const ptrs=new Map();let last=null,pinch=null,moved=0;
  mapEl.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;  /* butoanele de zoom nu pornesc deplasarea hărții */
    mapEl.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,[e.clientX,e.clientY]);last=[e.clientX,e.clientY];moved=0;});
  mapEl.addEventListener('pointerup',e=>{if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);pinch=null;if(moved<5&&!ptrs.size&&onClick){const r=mapEl.getBoundingClientRect();onClick(...m.world(e.clientX-r.left,e.clientY-r.top));}last=ptrs.size?[...ptrs.values()][0]:null;});
  mapEl.addEventListener('pointercancel',e=>{ptrs.delete(e.pointerId);pinch=null;});
  mapEl.addEventListener('pointermove',e=>{const r=mapEl.getBoundingClientRect();
    if(ptrs.has(e.pointerId)){ptrs.set(e.pointerId,[e.clientX,e.clientY]);if(onHover)onHover(null);
      if(ptrs.size===2){const[a,b]=[...ptrs.values()];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinch)m.zoomAt(d/pinch,(a[0]+b[0])/2-r.left,(a[1]+b[1])/2-r.top);pinch=d;moved=99;return;}
      if(last){moved+=Math.abs(e.clientX-last[0])+Math.abs(e.clientY-last[1]);m.view.x-=(e.clientX-last[0])/m.view.s;m.view.y-=(e.clientY-last[1])/m.view.s;last=[e.clientX,e.clientY];m.draw();}return;}
    if(onHover)onHover(e.clientX-r.left,e.clientY-r.top);});
  mapEl.addEventListener('pointerleave',()=>onHover&&onHover(null));
  new ResizeObserver(()=>{m.size();if(!m.W)return;if(!m.fitted&&m.bounds){m.fit();m.fitted=true;}m.draw();}).observe(mapEl);
  return m;
}
/* I6 „Acces velo” = % din locuitori la ≤ 300 m de o pistă: pistele existente (cele declarate neconforme de IPJ Iași)
   în situația existentă, plus rețeaua velo MPM 2026 în cea propusă. Pistele neconforme se pot exclude (S.necon). Indicele și clasa se recalculează cu aceleași ponderi (I4 lipsă redistribuit); unitățile fără
   stații TP își păstrează clasa „fără date TP”. */
const W6=[.30,.25,.15,.10,.10,.10];
S.necon=true;
function applyVelo(){for(const u of GEN.u)for(const k of ['existent','propus_v1','propus_v2']){const c=u.sc[k],v=VEL.u[u.n];if(!v)continue;
  if(!c.base)c.base={I:c.I.slice(),idx:c.idx,c:c.c};
  c.I=c.base.I.slice();c.I[5]=k==='existent'?(S.necon?v.pn:0):(S.necon?v.p300:v.pp);let n=0,d=0;c.I.forEach((x,i)=>{if(x!=null){n+=W6[i]*x;d+=W6[i];}});
  c.idx=Math.round(n/d*10)/10;c.c=c.base.c==='fără date TP'?c.base.c:c.idx>70?'bună':c.idx>40?'medie':'slabă';}}
applyVelo();
const VR=VEL.r.map(([k,c])=>({k,c:c.map(pr)})),VN=VEL.rn.map(c=>c.map(pr));
const VCOL={r0:'--velo',r1:'--velo',r2:'--velo',rad:'--velo',con:'--velo'},VDASH={con:[6,4]};
function drawVelo(m,lw,prop){const ctx=m.ctx;ctx.lineJoin='round';
  ctx.strokeStyle=css('--velo-n');ctx.globalAlpha=S.necon?.95:.55;ctx.setLineDash([4,3]);ctx.lineWidth=lw*1.4;
  for(const r of VN){ctx.beginPath();r.forEach(([x,y],i)=>i?ctx.lineTo(m.sx(x),m.sy(y)):ctx.moveTo(m.sx(x),m.sy(y)));ctx.stroke();}
  ctx.setLineDash([]);ctx.globalAlpha=.95;
  if(!prop){ctx.globalAlpha=1;return;}ctx.strokeStyle=css('--velo-p');
  for(const r of VR){ctx.lineWidth=['r0','r1','r2'].includes(r.k)?lw*1.6:lw;ctx.setLineDash(VDASH[r.k]||[]);ctx.beginPath();r.c.forEach(([x,y],i)=>i?ctx.lineTo(m.sx(x),m.sy(y)):ctx.moveTo(m.sx(x),m.sy(y)));ctx.stroke();}
  ctx.setLineDash([]);ctx.globalAlpha=1;}
const IASB=bbox(GEN.ias.flat().map(pr));  /* limita municipiului Iași, pentru butonul de centrare */
const ringPath=(m,P)=>{P.forEach(r=>{r.forEach(([x,y],i)=>i?m.ctx.lineTo(m.sx(x),m.sy(y)):m.ctx.moveTo(m.sx(x),m.sy(y)));m.ctx.closePath();});};
function bbox(rings){let a=[1e9,1e9,-1e9,-1e9];rings.forEach(([x,y])=>{a=[Math.min(a[0],x),Math.min(a[1],y),Math.max(a[2],x),Math.max(a[3],y)]});return a;}

/* ================= SCALE 1: detail ================= */
(()=>{
  const D=DET;
  const CL=[[300,'--c1','≤ 300 m'],[500,'--c2','300–500 m'],[800,'--c3','500–800 m'],[1500,'--c4','800 m–1,5 km'],[Infinity,'--c5','peste 1,5 km']];
  const GL=[['--g1','acces nou la ≤ 500 m'],['--g2','mai aproape cu ≥ 100 m, tot peste 500 m'],['--weak','rămâne la peste 500 m'],['--g0','deja la ≤ 500 m']];
  const FL=[['--c1','linie la ≤ 10 min'],['--c2','10–20 min'],['--c3','20–30 min'],['--c4','peste 30 min'],['--c5','nicio linie CTP la ≤ 500 m']];
  const FV=FRQ.fv,FO=FRQ.fo,UN=FRQ.u;let win='v';
  const fcls=i=>+(win==='v'?FV:FO)[i];
  const COL={existent:3,tramvai:4,metropolitan:5,propus_v1:6,propus_v2:7};
  const MODE={t:'tramvai',u:'autobuz urban',m:'autobuz metropolitan',c:'gară CF',A1:'tren metropolitan',A2:'tren metropolitan, extindere aeroport',B:'traseu TP propus',C:'inel R1',D:'inel R2',E:'punct intermodal propus'};
  const MNAME={a1:'Tren metropolitan V1',a2:'Tren metropolitan V2 (cu aeroportul)',b:'Trasee TP propuse',c:'Inel periurban R1',d:'Inel metropolitan R2',e:'Puncte intermodale propuse',propus_v1:'Toate măsurile, tren V1',propus_v2:'Toate măsurile, tren V2'};
  const PCOL={tm:'--p-train',aero:'--p-train',prop:'--p-prop',r1:'--p-r1',r2:'--p-r2'};
  const MCOL={A1:'--p-train',A2:'--p-train',B:'--p-prop',C:'--p-r1',D:'--p-r2',E:'--ink'};
  let view='existent';
  const P=D.b.map(r=>pr([r[0],r[1]]));
  const ES=D.s.map(r=>{const[x,y]=pr([r[1],r[2]]);return{m:r[0],x,y,l:r[3],p:r[4],n:r[5]}});
  const GS=FRQ.stops.map(r=>{const[x,y]=pr([r[0],r[1]]);return{x,y,n:r[2],hv:r[3],ho:r[4],l:r[5]}});
  const hcls=h=>h<0?4:h<=10?0:h<=20?1:h<=30?2:3;
  const hw=h=>h<0?'fără curse':'interval '+(Math.round(h*10)/10).toLocaleString('ro-RO')+' min';
  const PS=D.ps.map(r=>{const[x,y]=pr([r[1],r[2]]);return{m:r[0],x,y,g:r[3],n:r[4]}});
  const R=D.r.map(([k,c])=>({k,c:c.map(pr)}));
  const O=D.o.map(r=>r.map(pr));
  const B=D.bnd.map(u=>{const P=u.geo.map(r=>r.map(pr));const Rr=P.reduce((a,b)=>b.length>a.length?b:a);let cx=0,cy=0;Rr.forEach(([x,y])=>{cx+=x;cy+=y});return{t:u.t,n:u.n,P,cx:cx/Rr.length,cy:cy/Rr.length};});
  const $=id=>document.getElementById(id);
  const cls=d=>{if(d<0)return 4;for(let i=0;i<4;i++)if(d<=CL[i][0])return i;return 4;};
  const propCol=()=>S.tren==='v1'?6:7;
  function gcls(r){const e=r[3],n=r[propCol()];const ne=e<0?1e9:e,nn=n<0?1e9:n;if(ne<=500)return 3;if(nn<=500)return 0;if(ne-nn>=100)return 1;return 2;}
  const isProp=()=>S.scen==='propus';
  function currentView(){if(view==='cov')return 'cov';if(view==='frecv')return isProp()?scenKey():'frecv';return isProp()?(view==='gain'?'gain':scenKey()):view;}
  const CV=[['--c1','≤ 500 m de o stație'],['--p-train','500–800 m de o gară (tren)'],['--c5','neacoperit']];
  const allCol=()=>isProp()?propCol():3, trCol=()=>isProp()?(S.tren==='v1'?10:11):9;
  function ccls(r){const a=r[allCol()],t=r[trCol()];if(a>=0&&a<=500)return 0;if(t>=0&&t<=800)return 1;return 2;}
  function views(){
    const el=$('d-views');const v=isProp()?[['acc','Distanța până la stație'],['cov','Acoperire: 500 m autobuz/tramvai, 800 m tren'],['gain','Câștig față de situația existentă']]:[['existent','Distanța până la orice stație'],['cov','Acoperire: 500 m autobuz/tramvai, 800 m tren'],['frecv','Frecvență: linie la ≤ 20 min (art. 21 lit. d)'],['tramvai','Doar tramvai'],['metropolitan','Doar autobuz metropolitan']];
    if(isProp()&&!['acc','gain','cov'].includes(view))view='acc';if(!isProp()&&['acc','gain'].includes(view))view='existent';
    el.innerHTML=v.map(([k,l])=>`<button data-v="${k}" aria-pressed="${k===view}">${l}</button>`).join('');
    el.querySelectorAll('button').forEach(b=>b.onclick=()=>{view=b.dataset.v;refresh();});
    const w=$('d-win');w.hidden=view!=='frecv'||isProp();w.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.w===win));
  }
  const map=MapView($('d-map'),$('d-cv'),draw,null,hover);
  map.bounds=bbox(O.flat());
  function draw(m){
    const ctx=m.ctx,W=m.W,H=m.H,s=m.view.s;ctx.fillStyle=css('--mapbg');ctx.fillRect(0,0,W,H);
    ctx.strokeStyle=css('--line');ctx.lineWidth=1.5;O.forEach(r=>{ctx.beginPath();ringPath(m,[r]);ctx.stroke();});
    const cv=currentView(),cell=Math.max(1.2,100*s);
    if(cv==='cov'){const cols=CV.map(g=>css(g[0]));for(let c=2;c>=0;c--){ctx.fillStyle=cols[c];for(let i=0;i<P.length;i++){const r=D.b[i];if(ccls(r)!==c)continue;const x=m.sx(P[i][0]),y=m.sy(P[i][1]);if(x<-9||y<-9||x>W+9||y>H+9)continue;ctx.globalAlpha=Math.min(1,.4+Math.sqrt(r[2])/12);ctx.fillRect(x-cell/2,y-cell/2,cell,cell);}}}
    else if(cv==='gain'){const cols=GL.map(g=>css(g[0]));for(let c=3;c>=0;c--){ctx.fillStyle=cols[c];for(let i=0;i<P.length;i++){const r=D.b[i];if(gcls(r)!==c)continue;const x=m.sx(P[i][0]),y=m.sy(P[i][1]);if(x<-9||y<-9||x>W+9||y>H+9)continue;ctx.globalAlpha=c===3?.5:Math.min(1,.45+Math.sqrt(r[2])/12);ctx.fillRect(x-cell/2,y-cell/2,cell,cell);}}}
    else if(cv==='frecv'){const cols=FL.map(g=>css(g[0]));for(let c=4;c>=0;c--){ctx.fillStyle=cols[c];for(let i=0;i<P.length;i++){if(fcls(i)!==c)continue;const r=D.b[i];const x=m.sx(P[i][0]),y=m.sy(P[i][1]);if(x<-9||y<-9||x>W+9||y>H+9)continue;ctx.globalAlpha=Math.min(1,.35+Math.sqrt(r[2])/12);ctx.fillRect(x-cell/2,y-cell/2,cell,cell);}}}
    else{const k=COL[cv],cols=CL.map(c=>css(c[1]));for(let c=4;c>=0;c--){ctx.fillStyle=cols[c];for(let i=0;i<P.length;i++){const r=D.b[i];if(cls(r[k])!==c)continue;const x=m.sx(P[i][0]),y=m.sy(P[i][1]);if(x<-9||y<-9||x>W+9||y>H+9)continue;ctx.globalAlpha=Math.min(1,.35+Math.sqrt(r[2])/12);ctx.fillRect(x-cell/2,y-cell/2,cell,cell);}}}
    ctx.globalAlpha=1;
    const bnd=$('g-bnd').checked;
    if(bnd){for(const u of B){ctx.strokeStyle=css('--ink');ctx.globalAlpha=u.t==='comună'?.5:.4;ctx.lineWidth=u.t==='comună'?1.2:.8;ctx.setLineDash(u.t==='comună'?[]:[4,3]);ctx.beginPath();ringPath(m,u.P);ctx.stroke();}ctx.setLineDash([]);ctx.globalAlpha=1;}
    if($('g-routes').checked){ctx.lineJoin='round';const lw=Math.max(1,Math.min(2.5,s*30));
      for(const r of R){const old=['tram','bus','metro','train'].includes(r.k);if(r.k==='train')continue;
        if(!old&&!isProp())continue;if(r.k==='aero'&&S.tren!=='v2')continue;
        if(old){ctx.strokeStyle=css(isProp()?'--r-old':({tram:'--r-tram',bus:'--r-bus',metro:'--r-metro'})[r.k]);ctx.globalAlpha=isProp()?.55:(r.k==='bus'?.55:.85);ctx.lineWidth=isProp()?Math.max(.8,lw*.6):lw;ctx.setLineDash([]);}
        else{ctx.strokeStyle=css(PCOL[r.k]);ctx.globalAlpha=.95;ctx.lineWidth=lw*1.5;ctx.setLineDash(r.k==='aero'?[7,4]:r.k==='r2'?[10,4]:[]);}
        ctx.beginPath();r.c.forEach(([x,y],i)=>i?ctx.lineTo(m.sx(x),m.sy(y)):ctx.moveTo(m.sx(x),m.sy(y)));ctx.stroke();}
      ctx.setLineDash([]);ctx.globalAlpha=1;}
    if($('g-velo').checked)drawVelo(m,Math.max(1,Math.min(2.5,s*30)),isProp());
    const showSt=$('g-stops').checked;
    if(showSt&&currentView()==='frecv'){const rr=Math.max(2.5,Math.min(6,s*45)),cols=FL.map(g=>css(g[0]));for(const st of GS){const h=win==='v'?st.hv:st.ho;ctx.fillStyle=cols[hcls(h)];ctx.strokeStyle=css('--ink');ctx.lineWidth=1;ctx.beginPath();ctx.arc(m.sx(st.x),m.sy(st.y),rr/2+1,0,6.283);ctx.fill();ctx.stroke();}}
    else if(showSt){const rr=Math.max(2,Math.min(5,s*40));for(const st of ES){if(!isProp()&&!(view==='existent'||(view==='tramvai'&&st.m==='t')||(view==='metropolitan'&&st.m==='m')))continue;
      ctx.fillStyle=css('--stop');ctx.strokeStyle=css('--mapbg');ctx.lineWidth=1.2;ctx.globalAlpha=isProp()?.6:1;ctx.beginPath();ctx.rect(m.sx(st.x)-rr/2,m.sy(st.y)-rr/2,rr,rr);ctx.fill();ctx.stroke();}ctx.globalAlpha=1;}
    if(isProp()){const rr=Math.max(3,Math.min(6,s*55));for(const st of PS){if(st.m==='A2'&&S.tren!=='v2')continue;if(!showSt&&!st.m.startsWith('A')&&st.m!=='E')continue;
      const x=m.sx(st.x),y=m.sy(st.y),r=st.m.startsWith('A')?rr*1.3:rr;ctx.beginPath();
      if(st.m==='E'){const q=rr*1.8;ctx.moveTo(x,y-q);ctx.lineTo(x+q,y);ctx.lineTo(x,y+q);ctx.lineTo(x-q,y);ctx.closePath();ctx.fillStyle=css('--panel');ctx.fill();ctx.strokeStyle=css('--ink');ctx.lineWidth=2.2;ctx.stroke();continue;}
      ctx.arc(x,y,r,0,6.283);
      if(st.g){ctx.fillStyle=css('--panel');ctx.fill();ctx.strokeStyle=css(MCOL[st.m]);ctx.lineWidth=2;ctx.stroke();}else{ctx.fillStyle=css(MCOL[st.m]);ctx.fill();ctx.strokeStyle=css('--panel');ctx.lineWidth=1.5;ctx.stroke();}}}
    if(bnd){ctx.textAlign='center';ctx.textBaseline='middle';for(const u of B){const show=u.t==='comună'?s>.009:s>.04;if(!show)continue;const X=m.sx(u.cx),Y=m.sy(u.cy);if(X<0||Y<0||X>W||Y>H)continue;
      ctx.font=(u.t==='comună'?'600 11px ':'600 10px ')+'system-ui, sans-serif';ctx.lineWidth=3;ctx.strokeStyle=css('--mapbg');ctx.strokeText(u.n,X,Y);ctx.fillStyle=css('--ink');ctx.fillText(u.n,X,Y);}ctx.textAlign='start';ctx.textBaseline='alphabetic';}
    const mm=s*1000>120?1000:(s*5000>120?5000:10000),px=mm*s;ctx.fillStyle=css('--ink');ctx.fillRect(14,H-18,px,3);ctx.font='11px ui-monospace, monospace';ctx.fillText(mm/1000+' km',14,H-24);
  }
  function hover(px,py){const tip=$('d-tip');if(px==null){tip.hidden=true;return;}
    const[wx,wy]=map.world(px,py),s=map.view.s;let txt=null,bd=(9/s)**2;
    if(isProp())for(const st of PS){if(st.m==='A2'&&S.tren!=='v2')continue;if(!$('g-stops').checked&&!st.m.startsWith('A')&&st.m!=='E')continue;const d=(st.x-wx)**2+(st.y-wy)**2;if(d<bd){bd=d;txt=`${st.n||'stație'} · ${MODE[st.m]}${st.g?' · generată (ipoteză)':''}`;}}
    if(!txt&&$('g-stops').checked&&currentView()==='frecv')for(const st of GS){const d=(st.x-wx)**2+(st.y-wy)**2;if(d<bd){bd=d;txt=`${st.n} · ${st.l} ${st.l===1?'linie':'linii'} · cea mai frecventă linie: vârf ${hw(st.hv)}, în afara vârfului ${hw(st.ho)}`;}}
    if(!txt&&$('g-stops').checked&&currentView()!=='frecv')for(const st of ES){const d=(st.x-wx)**2+(st.y-wy)**2;if(d<bd){bd=d;txt=`${st.n||'stație'} · ${MODE[st.m]} · ${st.l} ${st.l===1?'linie':'linii'} · ${fmt(st.p)} loc. la 500 m`;}}
    if(!txt){bd=Math.max(60,8/s)**2;let bi=-1;for(let i=0;i<P.length;i++){const d=(P[i][0]-wx)**2+(P[i][1]-wy)**2;if(d<bd){bd=d;bi=i;}}
      if(bi>=0){const r=D.b[bi],cv=currentView();const dd=x=>x<0?'peste 1,5 km':x+' m';
        const FT=['linie la ≤ 10 min','linie la 10–20 min','linie la 20–30 min','linii la peste 30 min','nicio linie CTP'];
        txt=cv==='frecv'?`${r[2].toFixed(0)} loc. · ${FT[fcls(bi)]} la ≤ 500 m (${win==='v'?'vârf 07–09':'10–14'}) · stație ${dd(r[3])}`:cv==='gain'?`${r[2].toFixed(0)} loc. · existent ${dd(r[3])} → propus ${dd(r[propCol()])}`:cv==='cov'?`${r[2].toFixed(0)} loc. · stație ${dd(r[allCol()])} · gară ${dd(r[trCol()])}`:`${r[2].toFixed(0)} loc. · ${dd(r[COL[cv]])} până la stație`;}}
    if(!txt){tip.hidden=true;return;}tip.textContent=txt;tip.hidden=false;tip.style.left=Math.max(6,Math.min(px+12,map.W-tip.offsetWidth-6))+'px';tip.style.top=(py+12)+'px';}
  function panel(){
    const cv=currentView(),key=(cv==='gain'||cv==='cov'||cv==='frecv')?scenKey():cv,s=D.st[key],e=D.st.existent,prop=isProp();
    const dlt=(a,b,unit,inv)=>{const d=+(a-b).toFixed(1);if(!prop||!d)return prop?'<small>fără schimbare</small>':'';const good=inv?d<0:d>0;return `<small class="${good?'up':''}">${d>0?'+':''}${unit==='loc'?fmt(d):d.toLocaleString('ro-RO')}${unit==='m'?' m':unit==='pp'?' pp':''} față de existent</small>`;};
    $('d-kpis').innerHTML=[[s.med+' m','mediana distanței pe locuitor',dlt(s.med,e.med,'m',true)],[s.p500.toLocaleString('ro-RO')+'%','locuitori ≤ 500 m',dlt(s.p500,e.p500,'pp')],[s.pcov.toLocaleString('ro-RO')+'%','acoperire, tren la 800 m',dlt(s.pcov,e.pcov,'pp')],[s.p800.toLocaleString('ro-RO')+'%','locuitori ≤ 800 m',dlt(s.p800,e.p800,'pp')],[fmt(s.out),'locuitori la peste 1,5 km',dlt(s.out,e.out,'loc',true)]]
      .map(([v,l,d])=>`<div class="kpi"><b>${v}</b><span>${l}</span>${d||''}</div>`).join('');
    if(cv==='cov'){const w=[0,0,0];let T=0;D.b.forEach(r=>{if(!r[8])return;w[ccls(r)]+=r[2];T+=r[2];});
      $('d-legh').textContent='Acoperire cu prag pe mod de transport';$('d-legnote').textContent='Autobuz și tramvai: 500 m (Legea 155/2023, art. 21 lit. d). Tren: 800 m, raza de captare pietonală TOD (400–800 m). Procente din locuitorii ZMI.';
      $('d-legend').innerHTML=CV.map((g,i)=>`<div><i class="sw" style="background:var(${g[0]})"></i><span>${g[1]}</span><span>${(w[i]/T*100).toFixed(1).replace('.',',')}%</span></div>`).join('');
      $('d-bar').innerHTML=CV.map((g,i)=>`<i style="flex:${w[i]};background:var(${g[0]})"></i>`).join('');}
    else if(cv==='frecv'){const w=[0,0,0,0,0];let T=0;D.b.forEach((r,i)=>{if(!r[8])return;w[fcls(i)]+=r[2];T+=r[2];});
      let ia=0,iT=0;D.b.forEach((r,i)=>{const u=UN[i];if(u<0||D.bnd[u].t!=='cartier')return;iT+=r[2];if(fcls(i)<=1)ia+=r[2];});const pi=ia/iT*100;
      $('d-legh').textContent='Cea mai frecventă linie la ≤ 500 m';$('d-legnote').innerHTML=`Interval mediu al celei mai frecvente linii (un sens) din stațiile aflate la ≤ 500 m pe jos, zile lucrătoare, ${win==='v'?'07–09':'10–14'}. Procente din locuitorii ZMI. <b>Municipiul Iași: ${pi.toFixed(1).replace('.',',')}% din locuitori</b> au o linie la ≤ 20 min, față de ținta de 60% din art. 21 lit. d) (${pi>=60?'atinsă':'neatinsă'}).`;
      $('d-legend').innerHTML=FL.map((g,i)=>`<div><i class="sw" style="background:var(${g[0]})"></i><span>${g[1]}</span><span>${(w[i]/T*100).toFixed(0)}%</span></div>`).join('');
      $('d-bar').innerHTML=FL.map((g,i)=>`<i style="flex:${w[i]};background:var(${g[0]})"></i>`).join('');}
    else if(cv==='gain'){const w=[0,0,0,0];let T=0;D.b.forEach(r=>{if(!r[8])return;w[gcls(r)]+=r[2];T+=r[2];});
      $('d-legh').textContent='Câștig față de situația existentă';$('d-legnote').textContent='Număr de locuitori din ZMI, pe celule de 100 m. Comparația e cu toate stațiile existente; pragul e 500 m pentru orice mod (art. 21 lit. d). Roșu: golurile rămase și după măsurile MPM.';
      $('d-legend').innerHTML=GL.map((g,i)=>`<div><i class="sw" style="background:var(${g[0]})"></i><span>${g[1]}</span><span>${fmt(w[i])}</span></div>`).join('');
      $('d-bar').innerHTML=GL.map((g,i)=>`<i style="flex:${w[i]};background:var(${g[0]})"></i>`).join('');}
    else{const k=COL[cv],w=[0,0,0,0,0];let T=0;D.b.forEach(r=>{if(!r[8])return;w[cls(r[k])]+=r[2];T+=r[2];});
      $('d-legh').textContent='Distanță pe jos până la stație';$('d-legnote').textContent='Procente din locuitorii ZMI. Fiecare punct e o celulă de 100 m locuită.';
      $('d-legend').innerHTML=CL.map((c,i)=>`<div><i class="sw" style="background:var(${c[1]})"></i><span>${c[2]}</span><span>${(w[i]/T*100).toFixed(0)}%</span></div>`).join('');
      $('d-bar').innerHTML=CL.map((c,i)=>`<i style="flex:${w[i]};background:var(${c[1]})"></i>`).join('');}
    $('d-topsec').hidden=prop;$('d-meassec').hidden=!prop;$('d-trainsec').hidden=!prop;$('d-catsec').hidden=!prop;$('d-gapsec').hidden=!prop;
    if(prop){gaps();catchment();}
    if(prop){const VC={'în interval':'--good','sub interval':'--mid','peste interval':'--weak','fără date':'--nodata'};
      document.querySelector('#d-train tbody').innerHTML=D.train.filter(t=>S.tren==='v2'||t[1]==='V1').map(t=>`<tr><td class="l">${t[0]}</td><td class="l">${t[1]==='V1'?'V1':'V2 · aeroport'}</td><td class="l">${t[2]?'urban (0,8–1,2 km)':'suburban (1,5–3 km)'}</td><td class="l">${t[3]}</td><td>${t[4]==null?'–':t[4].toLocaleString('ro-RO')+' km'}</td><td class="l"><i class="sw" style="background:var(${VC[t[5]]});margin-right:6px;vertical-align:-1px"></i>${t[5]}</td></tr>`).join('');}
    if(!prop){const f=view==='tramvai'?'t':view==='metropolitan'?'m':null,seen=new Set();
      const top=ES.filter(x=>!f||x.m===f).sort((a,b)=>b.p-a.p).filter(x=>{const key=x.n.replace(/[\s()\d]+$/,'');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,7);
      $('d-top').innerHTML=top.map(x=>`<li>${x.n||'<em>fără nume</em>'} <span>${fmt(x.p)} loc. · ${x.l} ${x.l===1?'linie':'linii'}</span></li>`).join('');}
    else{const keys=['a1','a2','b','c','d','e',scenKey()];const lab={a1:'a)',a2:'a)',b:'b)',c:'c)',d:'d)',e:'e)',propus_v1:'Σ',propus_v2:'Σ'};
      $('d-meas').innerHTML=`<div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em"><span></span><span>Măsura</span><span class="v">+ la ≤ 500 m · + acoperire · ies din peste 1,5 km</span></div>`+
        D.meas.filter(x=>keys.includes(x.k)&&!(x.k==='a2'&&S.tren==='v1')&&!(x.k==='a1'&&S.tren==='v2')).map(x=>`<div class="${x.k.startsWith('propus')?'tot':''}"><b>${lab[x.k]}</b><span>${MNAME[x.k]}</span><span class="v">+${fmt(x.gain)} · +${fmt(x.gcov)} · ${fmt(x.less)}</span></div>`).join('');}
    const vl=$('g-velo').checked?[['--velo-n','piste existente, declarate neconforme (IPJ)'+(S.necon?'':', excluse din I6'),'dash'],...(prop?[['--velo-p','piste velo propuse',''],['--velo-p','conexiuni velo propuse','dash']]:[])]:[];
    const rl=prop?[...vl,['--r-old','trasee existente',''],['--p-train','tren metropolitan V1',''],...(S.tren==='v2'?[['--p-train','extindere aeroport','dash']]:[]),['--p-prop','trasee TP propuse',''],['--p-r1','inel R1',''],['--p-r2','inel R2','dash']]:[['--r-tram','tramvai',''],['--r-bus','autobuz urban',''],['--r-metro','autobuz metropolitan',''],...vl];
    $('d-rleg').innerHTML=rl.map(([c,l,d])=>`<span><i class="ln ${d}" style="background:var(${c});color:var(${c})"></i>${l}</span>`).join('')+(prop?`<span><i class="sw" style="border-radius:50%;background:var(--p-prop)"></i> stație MPM</span><span><i class="sw" style="border-radius:50%;border:2px solid var(--p-prop)"></i> stație generată</span><span><i class="sw" style="transform:rotate(45deg) scale(.8);border:2px solid var(--ink)"></i> punct intermodal propus</span>`:'');
    const ci=prop?(S.tren==='v1'?3:4):2;
    $('d-uath').textContent=prop?`Pe unități administrative, situația propusă (tren ${S.tren.toUpperCase()})`:'Pe unități administrative, situația existentă';
    document.querySelector('#d-uat thead').innerHTML=`<tr><th class="l">UAT</th><th>Locuitori</th><th>≤ 500 m</th>${prop?'':'<th>≤ 500 m, linie<br>≤ 20 min (vârf)</th>'}<th>≤ 800 m</th><th>Peste 1,5 km</th>${prop?'<th>Δ ≤ 500 m</th>':''}</tr>`;
    const fq=uatFreq();
    document.querySelector('#d-uat tbody').innerHTML=D.ut.map(r=>{const v=r[ci],e=r[2],d=+(v[0]-e[0]).toFixed(1),f=fq[norm(r[0])];return `<tr><td class="l">${r[0]}</td><td>${fmt(r[1])}</td><td><i class="pb" style="width:${v[0]*0.6}px"></i>${v[0].toFixed(0)}%</td>${prop?'':`<td>${f==null?'–':f.toFixed(0)+'%'}</td>`}<td>${v[1].toFixed(0)}%</td><td>${fmt(v[2])}</td>${prop?`<td class="${d>0?'up':''}">${d>0?'+'+d.toLocaleString('ro-RO')+' pp':'–'}</td>`:''}</tr>`;}).join('');
  }
  const norm=n=>n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
  const uatOf=u=>u<0?null:D.bnd[u].t==='cartier'?'iasi':norm(D.bnd[u].n);
  let FQ=null;
  function uatFreq(){if(FQ)return FQ;const a={},t={};D.b.forEach((r,i)=>{const k=uatOf(UN[i]);if(!k)return;t[k]=(t[k]||0)+r[2];if(+FV[i]<=1)a[k]=(a[k]||0)+r[2];});FQ={};for(const k in t)FQ[k]=(a[k]||0)/t[k]*100;return FQ;}
  function gaps(){const g={},t={},v={};D.b.forEach((r,i)=>{const u=UN[i];if(u<0)return;const n=D.bnd[u].n;t[n]=(t[n]||0)+r[2];const c=gcls(r);if(c===1||c===2){g[n]=(g[n]||0)+r[2];if(ccls(r)===2)v[n]=(v[n]||0)+r[2];}});
    const rows=Object.keys(g).map(n=>[n,D.bnd.find(b=>b.n===n).t,g[n],g[n]/t[n]*100,v[n]||0]).sort((a,b)=>b[2]-a[2]).slice(0,12);
    document.querySelector('#d-gap tbody').innerHTML=rows.map(([n,tp,v,p,nc])=>`<tr><td class="l">${n}</td><td class="l">${tp==='cartier'?'cartier':'comună'}</td><td>${fmt(v)}</td><td>${fmt(nc)}</td><td><i class="pb" style="width:${p*0.6}px;background:var(--weak)"></i>${p.toFixed(0)}%</td></tr>`).join('');}
  function catchment(){const T={A1:'tren metropolitan',A2:'tren, extindere aeroport',E:'punct intermodal'};
    const rows=FRQ.cat.filter(c=>c[0]!=='A2'||S.tren==='v2').sort((a,b)=>(a[0]==='E')-(b[0]==='E')||b[3]-a[3]);
    document.querySelector('#d-cat tbody').innerHTML=rows.map(c=>`<tr><td class="l">${c[1]}</td><td class="l">${T[c[0]]}</td><td>${fmt(c[2])}</td><td><i class="pb" style="width:${Math.min(60,c[3]/300)}px"></i>${fmt(c[3])}</td><td>${c[4]||'–'}</td><td>${c[5]||'–'}</td><td class="l" style="font-size:12px;color:var(--muted)">${c[6]}</td></tr>`).join('');}
  function refresh(){views();panel();map.draw();}
  document.querySelectorAll('#d-win button').forEach(b=>b.onclick=()=>{win=b.dataset.w;refresh();});
  ['g-routes','g-stops','g-bnd'].forEach(id=>$(id).onchange=()=>map.draw());$('g-velo').onchange=()=>refresh();
  $('d-zin').onclick=()=>map.zoomAt(1.4,map.W/2,map.H/2);$('d-zout').onclick=()=>map.zoomAt(1/1.4,map.W/2,map.H/2);$('d-zreset').onclick=()=>{map.fit();map.draw();};$('d-zcenter').onclick=()=>{map.fit(IASB);map.draw();};
  listeners.push(refresh);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>map.draw());
  new MutationObserver(()=>map.draw()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
})();

/* ================= SCALE 2: general ================= */
(()=>{
  const D=GEN;const $=id=>document.getElementById(id);
  const CLS={'bună':'--good','medie':'--mid','slabă':'--weak','fără date TP':'--nodata'};
  const SEQ=[[20,'--s1'],[40,'--s2'],[60,'--s3'],[80,'--s4'],[101,'--s5']];
  const DSEQ=[[0.05,'--g0',' fără schimbare'],[5,'--g2','+0–5 puncte'],[15,'--g1','+5–15 puncte'],[Infinity,'--g3','peste +15 puncte']];
  const RSEQ=[[70,'--s1','sub 70% din medie'],[90,'--s2','70–90%'],[110,'--s3','90–110% (în jurul mediei)'],[130,'--s4','110–130%'],[Infinity,'--s5','peste 130% din medie']];
  let metric='idx',sel=null,ref='ias';
  /* media indicelui ponderată cu populația: municipiul Iași (cartierele) și ZMI (cartiere și comune) */
  let MEAN;function calcMean(){MEAN={};for(const k of ['existent','propus_v1','propus_v2']){const w=a=>a.reduce((s,u)=>s+u.sc[k].idx*u.pop,0)/a.reduce((s,u)=>s+u.pop,0);MEAN[k]={ias:w(D.u.filter(u=>u.t==='cartier')),zmi:w(D.u)};}}
  calcMean();
  const mean=r=>MEAN[scenKey()][r];
  const rel=(u,r)=>cur(u).idx/mean(r)*100;
  const relTxt=(u,r)=>{const v=rel(u,r),d=cur(u).idx-mean(r);return `${Math.round(v)}% <small style="color:var(${d>=0?'--good':'--weak'})">(${d>=0?'+':'−'}${Math.abs(d).toFixed(1).replace('.',',')} p.)</small>`;};
  D.u.forEach(u=>u.P=u.geo.map(r=>r.map(pr)));
  const IAS=D.ias.map(r=>r.map(pr));
  const cur=u=>u.sc[scenKey()],ex=u=>u.sc.existent,isProp=()=>S.scen==='propus';
  const map=MapView($('a-map'),$('a-cv'),draw,(wx,wy)=>{const u=hit(wx,wy);if(u)select(u);},null);
  map.bounds=bbox(D.u.flatMap(u=>u.P.flat()));
  function color(u){const c=cur(u);
    if(metric==='idx')return css(CLS[c.c]);
    if(metric==='delta'){const d=c.idx-ex(u).idx;for(const[t,col] of DSEQ)if(d<t)return css(col);}
    if(metric==='rel'){const v=rel(u,ref);for(const[t,col] of RSEQ)if(v<t)return css(col);}
    if(metric==='vp'){const v=c.I[5];if(v==null)return css('--nodata');for(const[t,col] of SEQ)if(v<t)return css(col);}
    const v=c[metric];if(v==null||(metric!=='pd'&&c.c==='fără date TP'))return css('--nodata');for(const[t,col] of SEQ)if(v<t)return css(col);}
  function draw(m){const ctx=m.ctx;ctx.fillStyle=css('--mapbg');ctx.fillRect(0,0,m.W,m.H);
    for(const u of [...D.u].sort((a,b)=>(a.t==='cartier')-(b.t==='cartier'))){ctx.beginPath();ringPath(m,u.P);ctx.fillStyle=color(u);ctx.globalAlpha=.88;ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=css('--panel');ctx.lineWidth=u.t==='cartier'?.8:1.2;ctx.stroke();}
    ctx.strokeStyle=css('--ink');ctx.lineWidth=1.6;ctx.setLineDash([5,3]);ctx.beginPath();ringPath(m,IAS);ctx.stroke();ctx.setLineDash([]);
    if(metric==='vp')drawVelo(m,Math.max(1,Math.min(2.2,m.view.s*25)),isProp());
    if(sel){ctx.beginPath();ringPath(m,sel.P);ctx.strokeStyle=css('--ink');ctx.lineWidth=3;ctx.stroke();}
    ctx.font='600 11px system-ui, sans-serif';ctx.textAlign='center';ctx.fillStyle=css('--ink');
    for(const u of D.u){const big=u.t==='comună'?m.view.s>.012:m.view.s>.05;if(!big)continue;let cx=0,cy=0;const r=u.P.reduce((a,b)=>b.length>a.length?b:a);r.forEach(([x,y])=>{cx+=x;cy+=y});const X=m.sx(cx/r.length),Y=m.sy(cy/r.length);ctx.lineWidth=3;ctx.strokeStyle=css('--panel');ctx.strokeText(u.n,X,Y);ctx.fillText(u.n,X,Y);}
    ctx.textAlign='start';}
  function legend(){const el=$('a-legend');
    if(metric==='idx'){el.innerHTML=Object.entries(CLS).map(([k,v])=>`<div><i class="sw" style="background:var(${v})"></i>${k==='fără date TP'?k:'accesibilitate '+k}</div>`).join('')+'<div><i class="sw" style="border:1.5px dashed var(--ink)"></i>limita mun. Iași</div>';return;}
    if(metric==='rel'){el.innerHTML=`<div style="font-weight:600">Indicele față de media ${ref==='ias'?'mun. Iași':'ZMI'} (${f1(mean(ref))} = 100%)</div>`+RSEQ.map(d=>`<div><i class="sw" style="background:var(${d[1]})"></i>${d[2]}</div>`).join('')+'<div><i class="sw" style="border:1.5px dashed var(--ink)"></i>limita mun. Iași</div>';return;}
    if(metric==='delta'){el.innerHTML=DSEQ.map(d=>`<div><i class="sw" style="background:var(${d[1]})"></i>${d[2].trim()}</div>`).join('');return;}
    const lab=['sub 20%','20–40%','40–60%','60–80%','peste 80%'];el.innerHTML=(metric==='vp'?`<div style="font-weight:600">Locuitori la ≤ 300 m de o pistă velo${isProp()?' (existentă sau propusă)':''}</div>`:'')+SEQ.map((s,i)=>`<div><i class="sw" style="background:var(${s[1]})"></i>${lab[i]}</div>`).join('')+`<div><i class="sw" style="background:var(--nodata)"></i>fără date</div>`+(metric==='vp'?'<div><i class="ln dash" style="background:var(--velo-n);color:var(--velo-n)"></i>piste existente neconforme (IPJ)</div>'+(isProp()?'<div><i class="ln" style="background:var(--velo-p)"></i>piste propuse (MPM 2026)</div>':''):'');}
  const pill=c=>`<span class="pill" style="background:var(${CLS[c]});color:${c==='medie'?'#1d2421':'#fff'}">${c==='fără date TP'?c:'accesibilitate '+c}</span>`;
  const INAME=['I1 Acoperire pietonală (500 m / tren 800 m)','I2 Linii distincte','I3 Noduri intermodale','I4 Dotări ≤ 300 m de stație','I5 Benzi dedicate','I6 Acces velo (locuitori ≤ 300 m de pistă)'];
  function detail(u){const el=$('a-detail');if(!u){el.innerHTML='<h2>Fișa unității</h2><p class="note">Alege un cartier sau o comună pe hartă sau în tabel.</p>';return;}
    const c=cur(u),e=ex(u),prop=isProp(),d=+(c.idx-e.idx).toFixed(1);
    el.innerHTML=`<h2>${u.t==='cartier'?'Cartier, mun. Iași':'Comună, ZMI'}</h2><h3>${u.n}</h3><div>${pill(c.c)} <span style="font:600 22px var(--f-mono);margin-left:6px">${f1(c.idx)}</span><span class="note"> / 100</span>${prop?`<div class="note" style="margin-top:4px">existent: ${f1(e.idx)} (${e.c})${d?`, <b style="color:var(--good)">+${d.toLocaleString('ro-RO')}</b>`:''}</div>`:''}</div>
    <div class="ib">${c.I.map((v,i)=>`<span>${INAME[i]}</span><span class="v">${v==null?'–':Math.round(v)}</span><span class="bar"><i style="width:${v||0}%"></i>${prop&&e.I[i]!=null&&e.I[i]!==v?`<u style="left:${e.I[i]}%"></u>`:''}</span>`).join('')}</div>
    ${prop?'<p class="note">Linia subțire de pe bare marchează valoarea din situația existentă.</p>':''}
    <dl class="facts"><dt>Față de media mun. Iași (${f1(mean('ias'))})</dt><dd>${relTxt(u,'ias')}</dd><dt>Față de media ZMI (${f1(mean('zmi'))})</dt><dd>${relTxt(u,'zmi')}</dd>${VEL.u[u.n]?`<dt>Locuitori la ≤ 300 m de o pistă velo</dt><dd>${f1(VEL.u[u.n].pn)}% existent (piste neconforme) · ${f1(VEL.u[u.n].p300)}% cu MPM 2026 (${f1(VEL.u[u.n].pp)}% doar rețeaua MPM)</dd><dt>Piste velo propuse (MPM 2026)</dt><dd>${f1(VEL.u[u.n].km)} km</dd>`:''}<dt>Locuitori (WorldPop 2020)</dt><dd>${fmt(u.pop)}</dd><dt>Mediana distanței la stație</dt><dd>${c.med==null?'peste 1,5 km':fmt(c.med)+' m'}</dd><dt>Acoperire (500 m / tren 800 m)</dt><dd>${f1(c.pc)}%</dd><dt>Locuitori ≤ 500 m / ≤ 800 m</dt><dd>${f1(c.p5)}% / ${f1(c.p8)}%</dd><dt>Locuitori la peste 1,5 km</dt><dd>${fmt(c.out)}</dd><dt>Stații / linii distincte</dt><dd>${c.ns} / ${c.nl}</dd><dt>Noduri legate direct</dt><dd style="font-family:var(--f-display)">${c.nod||'niciunul'}</dd><dt>Dotări ≤ 300 m de stație</dt><dd>${c.nd?f1(c.pd)+'% din '+c.nd:'nu au fost identificate'}</dd><dt>Art. 21 lit. d), componenta spațială</dt><dd style="font-family:var(--f-display)">${c.p5>=60?'prag de 60% atins':'sub pragul de 60%'}</dd>${u.old!=null?`<dt>Indice 2025 (Covăsnianu)</dt><dd>${f1(u.old)}</dd>`:''}</dl>`;}
  function kpis(){const c=D.u.filter(u=>u.t==='cartier'),m=D.u.filter(u=>u.t==='comună'),pc=c.reduce((a,u)=>a+u.pop,0),pm=m.reduce((a,u)=>a+u.pop,0),prop=isProp();
    const avg=a=>a.reduce((s,u)=>s+cur(u).idx,0)/a.length,avgE=a=>a.reduce((s,u)=>s+ex(u).idx,0)/a.length;
    const n=(a,k)=>a.filter(u=>cur(u).c===k).length;
    const lc=c.filter(u=>cur(u).p5>=60).reduce((s,u)=>s+u.pop,0)/pc*100,lm=m.filter(u=>cur(u).p5>=60).reduce((s,u)=>s+u.pop,0)/pm*100;
    const lcE=c.filter(u=>ex(u).p5>=60).reduce((s,u)=>s+u.pop,0)/pc*100,lmE=m.filter(u=>ex(u).p5>=60).reduce((s,u)=>s+u.pop,0)/pm*100;
    const up=(a,b,suf)=>prop?`<small class="${a>b+.05?'up':''}">${a>b+.05?'+'+(a-b).toFixed(1).replace('.',',')+suf+' față de existent':'fără schimbare'}</small>`:'';
    const mE=MEAN.existent,mC=MEAN[scenKey()];
    $('a-kpis').innerHTML=[
      [f1(mC.ias)+' · '+f1(mC.zmi),'media ponderată: Iași · ZMI',prop?`<small class="up">+${(mC.ias-mE.ias).toFixed(1).replace('.',',')} · +${(mC.zmi-mE.zmi).toFixed(1).replace('.',',')} puncte față de existent</small>`:'<small>ponderată cu populația; referința 100%</small>'],
      [f1(avg(c)),'media simplă, cartiere',prop?up(avg(c),avgE(c),' puncte'):'<small>63,4 în analiza din 2025</small>'],
      [`${n(c,'bună')} · ${n(c,'medie')} · ${n(c,'slabă')}`,'cartiere bune · medii · slabe','<small>17 cartiere delimitate după PUG</small>'],
      [f1(avg(m)),'media simplă, comune',prop?up(avg(m),avgE(m),' puncte'):'<small>18 comune din ZMI</small>'],
      [`${n(m,'bună')} · ${n(m,'medie')} · ${n(m,'slabă')} · ${n(m,'fără date TP')}`,'comune bune · medii · slabe · fără date',''],
      [Math.round(lc)+'% · '+Math.round(lm)+'%','pop. în unități ≥ 60% la 500 m','<small>cartiere · comune, art. 21 lit. d)</small>'+(prop&&(lm-lmE>.5)?`<small class="up">comune: +${Math.round(lm-lmE)} pp</small>`:'')]
    ].map(([v,l,s])=>`<div class="kpi"><b>${v}</b><span>${l}</span>${s}</div>`).join('');}
  function table(){const prop=isProp();
    $('a-math').textContent=prop?`Matricea de analiză, situația propusă (tren ${S.tren.toUpperCase()})`:'Matricea de analiză, situația existentă';
    document.querySelector('#a-mat thead').innerHTML=`<tr><th class="l">Clasa</th><th class="l">Unitate</th><th>Locuitori</th><th title="I1: locuitori la ≤ 500 m de o stație de autobuz/tramvai sau ≤ 800 m de o gară (Madina)">Acoperire<br>30%</th><th title="I2: linii distincte, raportate la 30">Linii<br>25%</th><th title="I3: noduri intermodale legate direct">Noduri<br>15%</th><th title="I4: dotări la ≤ 300 m de stație">Dotări<br>10%</th><th title="I5: benzi dedicate">Benzi<br>10%</th><th title="I6: locuitori la ≤ 300 m de o pistă velo">Velo<br>10%</th><th>Indice 2026<br>(Madina)</th><th title="Indicele, în procente din media ponderată a municipiului Iași">% din<br>media Iași</th><th title="Indicele, în procente din media ponderată a ZMI">% din<br>media ZMI</th>${prop?'<th>Indice<br>existent</th><th>Δ</th>':'<th>Indice 2025<br>(Covăsnianu)</th>'}</tr>`;
    let h='';for(const t of ['cartier','comună']){h+=`<tr class="grp"><td colspan="${prop?14:13}">${t==='cartier'?'Cartierele municipiului Iași':'Comunele din Zona Metropolitană Iași'}</td></tr>`;
      D.u.filter(u=>u.t===t).sort((a,b)=>cur(b).idx-cur(a).idx).forEach(u=>{const c=cur(u),e=ex(u),d=+(c.idx-e.idx).toFixed(1),i=D.u.indexOf(u);
        h+=`<tr data-i="${i}" tabindex="0" class="${u===sel?'sel':''}"><td class="l">${pill(c.c)}</td><td class="l">${u.n}</td><td>${fmt(u.pop)}</td>${c.I.map(v=>`<td>${v==null?'–':Math.round(v)}</td>`).join('')}<td><b>${f1(c.idx)}</b></td>${['ias','zmi'].map(r=>{const v=rel(u,r);return `<td style="color:var(${v>=110?'--good':v<90?'--weak':'--ink'})">${Math.round(v)}%</td>`;}).join('')}${prop?`<td>${f1(e.idx)}</td><td class="${d>0?'up':''}">${d>0?'+'+d.toLocaleString('ro-RO'):'–'}</td>`:`<td>${f1(u.old)}</td>`}</tr>`;});}
    const tb=document.querySelector('#a-mat tbody');tb.innerHTML=h;
    tb.querySelectorAll('tr[data-i]').forEach(r=>{const go=()=>select(D.u[+r.dataset.i]);r.onclick=go;r.onkeydown=e=>{if(e.key==='Enter')go();};});}
  function select(u){sel=u;detail(u);document.querySelectorAll('#a-mat tr[data-i]').forEach(r=>r.classList.toggle('sel',D.u[+r.dataset.i]===u));map.draw();}
  function hit(wx,wy){const inR=r=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if(((yi>wy)!==(yj>wy))&&(wx<(xj-xi)*(wy-yi)/(yj-yi)+xi))c=!c;}return c;};
    const cs=D.u.filter(u=>u.P.some(inR));return cs.find(u=>u.t==='cartier')||cs[0]||null;}
  function setMetric(k){metric=k;document.querySelectorAll('#a-metrics button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.m===k));$('a-ref').hidden=k!=='rel';document.querySelectorAll('#a-ref button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.r===ref));legend();map.draw();}
  document.querySelectorAll('#a-ref button').forEach(b=>b.onclick=()=>{ref=b.dataset.r;setMetric('rel');});
  document.querySelectorAll('#a-metrics button').forEach(b=>b.onclick=()=>setMetric(b.dataset.m));
  $('a-zin').onclick=()=>map.zoomAt(1.4,map.W/2,map.H/2);$('a-zout').onclick=()=>map.zoomAt(1/1.4,map.W/2,map.H/2);$('a-zreset').onclick=()=>{map.fit();map.draw();};$('a-zcenter').onclick=()=>{map.fit(sel?bbox(sel.P.flat()):IASB);map.draw();};
  function refresh(){calcMean();$('a-mdelta').hidden=!isProp();if(!isProp()&&metric==='delta')metric='idx';setMetric(metric);kpis();table();detail(sel);map.draw();}
  sel=D.u.find(u=>u.n==='Galata-Mircea');
  listeners.push(refresh);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>map.draw());
  new MutationObserver(()=>map.draw()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
})();

/* ================= switches ================= */
(()=>{
  const $=id=>document.getElementById(id);
  function store(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  function read(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function setScen(k){S.scen=k;$('sc-ex').setAttribute('aria-selected',k==='existent');$('sc-pr').setAttribute('aria-selected',k==='propus');$('tren').hidden=k!=='propus';store('scen',k);listeners.forEach(f=>f());}
  function setNecon(v){S.necon=v;document.querySelectorAll('#necon button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.n==='1')===v)));store('necon',v?'1':'0');applyVelo();listeners.forEach(f=>f());}
  document.querySelectorAll('#necon button').forEach(b=>b.onclick=()=>setNecon(b.dataset.n==='1'));
  function setTren(t){S.tren=t;document.querySelectorAll('#tren button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===t));store('tren',t);listeners.forEach(f=>f());}
  function setScale(k){$('s-detail').setAttribute('aria-selected',k==='detail');$('s-general').setAttribute('aria-selected',k==='general');$('scale-detail').hidden=k!=='detail';$('scale-general').hidden=k!=='general';store('scale',k);}
  $('sc-ex').onclick=()=>setScen('existent');$('sc-pr').onclick=()=>setScen('propus');
  document.querySelectorAll('#tren button').forEach(b=>b.onclick=()=>setTren(b.dataset.t));
  $('s-detail').onclick=()=>setScale('detail');$('s-general').onclick=()=>setScale('general');
  const h=location.hash.replace('#','');
  S.tren=read('tren')==='v2'?'v2':'v1';document.querySelectorAll('#tren button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===S.tren));
  setScale(h==='general'?'general':h==='detaliu'?'detail':(read('scale')==='general'?'general':'detail'));
  S.necon=read('necon')!=='0';applyVelo();document.querySelectorAll('#necon button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.n==='1')===S.necon)));
  setScen(h==='propus'?'propus':h==='existent'?'existent':(read('scen')==='propus'?'propus':'existent'));
})();
})();
