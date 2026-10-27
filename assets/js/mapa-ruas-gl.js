/* Mapa de ruas em MapLibre GL — modo "Ruas e rotas" nos níveis distrito e município.
   O mapa de contornos (Estado > Região > Município) continua em Leaflet; este arquivo só desenha o que
   fica por cima dele quando o modo ruas está ligado: base vetorial (OpenFreeMap) ou satélite (Esri),
   o contorno da área aberta e os pinos das obras. Os dados e o conteúdo dos pinos vêm de mapa-obras.js;
   aqui só há desenho e interação.

   Carga sob demanda: a biblioteca (~900 KB) só é baixada no primeiro clique em "Ruas e rotas". Qualquer
   falha (sem WebGL2, script ou estilo que não chega) vira rejeição/aoFalhar e o chamador volta ao Leaflet.

   Decisões (grilling de 21/10/2026):
   - só provedores gratuitos (OpenFreeMap sem chave; Esri World Imagery com a chave gratuita do
     ArcGIS Location Platform em window.ESRI_API_KEY, porque a licença do Esri não cobre o uso sem conta; sem chave o
     satélite simplesmente não existe);
   - o mapa é sempre plano: rotação e inclinação ficam travadas. A visão 3D (relevo, prédios extrudados) existiu e foi
     removida em 27/10/2026 porque deixava o carregamento do mapa pesado; sem ela, os prédios do estilo viram polígonos
     planos (camada predios-planos) e não há fonte de relevo;
   - o mapa é claro nos dois temas; só os controles e popups seguem o tema (CSS em mapa-obras.css). */
(function(){
'use strict';

const ML_JS='https://cdn.jsdelivr.net/npm/maplibre-gl@5.7.0/dist/maplibre-gl.js';
const ML_JS_SRI='sha384-Blts4zGbI8Hh/NvhcxTYsF2uLBbYIwHXEhPMxN3XpadJCDgstyLfJA3opgmkfBOc';
const ML_CSS='https://cdn.jsdelivr.net/npm/maplibre-gl@5.7.0/dist/maplibre-gl.css';
const ML_CSS_SRI='sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR';
const ESTILO='https://tiles.openfreemap.org/styles/liberty';
const ESRI_TILES='https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=';
const ESRI_ORIGEM='https://ibasemaps-api.arcgis.com';
// O Esri só tem imagem até o zoom 17 em boa parte do Ceará (18 em várias cidades, 19 quase só na capital) e responde 404
// além disso. O mapa usa tiles de 256 px, que são pedidos um nível acima do zoom da tela: o teto 18 evita os pedidos do
// 19 (404 e console cheio); onde falta o 18 o MapLibre amplia o nível de baixo.
const ESRI_MAXZOOM=18;
const AQUECE_MS=6000; // quanto tempo o satélite pré-carregado (opacidade 0) fica ligado se o clique não vier
const ESRI_ATTR='Imagens © Esri, Vantor, Earthstar Geographics e a comunidade GIS';
const SAT_ERROS_MAX=3; // tiles do satélite que falham sem nenhum ter chegado: chave inválida ou serviço fora
const VEC_ERROS_MAX=6; // idem para os tiles vetoriais do mapa: sem nenhum, o mapa ficaria em branco e o Leaflet assume
const CONTEXTO_PERDIDO_MS=4000; // contexto WebGL que não volta neste prazo: o Leaflet assume
const PREF_BASE='gecope_mapa_base';
const CELULA_PX=38;        // pontos a menos disto na tela viram um pino com a contagem (nível distrito)
const TIMEOUT_MS=15000;    // estilo que não chega neste prazo = falha, e o Leaflet assume
const SOMEM_NO_SATELITE=/shield|one_way|^poi_|^airport/; // camadas de ícone do estilo Liberty que atrapalham sobre a imagem
const AVISO_MS=7000;
const NOMINATIM='https://nominatim.openstreetmap.org/search';
const NOMINATIM_GAP_MS=1100; // a política de uso do Nominatim pede no máximo 1 consulta por segundo e sem autocomplete
const BUSCA_MIN=2;
const LOCALE={
  'NavigationControl.ZoomIn':'Aproximar','NavigationControl.ZoomOut':'Afastar',
  'AttributionControl.ToggleAttribution':'Mostrar créditos','AttributionControl.MapFeedback':'Sugerir correção no mapa',
  'FullscreenControl.Enter':'Tela cheia','FullscreenControl.Exit':'Sair da tela cheia',
  'GeolocateControl.FindMyLocation':'Minha posição','GeolocateControl.LocationNotAvailable':'Localização indisponível'
};

let _webgl2=null, _promessa=null;

// O MapLibre 5 exige WebGL2. Testado uma vez; o contexto de teste é descartado na hora.
function suportado(){
  if(_webgl2!=null) return _webgl2;
  try{
    const c=document.createElement('canvas'), gl=c.getContext('webgl2');
    _webgl2=!!gl;
    const ext=gl&&gl.getExtension('WEBGL_lose_context'); if(ext) ext.loseContext();
  }catch(_){ _webgl2=false; }
  return _webgl2;
}

function carregar(){
  if(window.maplibregl) return Promise.resolve();
  if(_promessa) return _promessa;
  _promessa=new Promise((ok,erro)=>{
    const css=document.createElement('link');
    css.rel='stylesheet'; css.href=ML_CSS; css.integrity=ML_CSS_SRI; css.crossOrigin='anonymous';
    document.head.appendChild(css);
    const js=document.createElement('script');
    js.src=ML_JS; js.integrity=ML_JS_SRI; js.crossOrigin='anonymous';
    const t=setTimeout(()=>erro(new Error('MapLibre não carregou a tempo')),TIMEOUT_MS);
    js.onload=()=>{ clearTimeout(t); window.maplibregl?ok():erro(new Error('MapLibre carregou sem a biblioteca')); };
    js.onerror=()=>{ clearTimeout(t); erro(new Error('Falha ao baixar o MapLibre')); };
    document.head.appendChild(js);
  });
  _promessa.catch(()=>{ _promessa=null; });
  return _promessa;
}

function lerBase(){
  try{ return localStorage.getItem(PREF_BASE)==='satelite'?'satelite':'mapa'; }catch(_){ return 'mapa'; }
}

// cfg: {corLinha, corPreench, chaveEsri, aoFalhar(motivo), buscar(texto)→[{titulo,sub,semLoc,...}], aoEscolher(item), caixa:{latMin,latMax,lngMin,lngMax}}
function criar(host,cfg){
  const ml=window.maplibregl;
  cfg=cfg||{};
  const el=document.createElement('div');
  el.className='gc-gl';
  host.appendChild(el);

  const map=new ml.Map({
    container:el, style:ESTILO, center:[-39.3,-5.2], zoom:6.5, minZoom:5, maxZoom:18,
    attributionControl:false, renderWorldCopies:false, locale:LOCALE,
    // sempre plano: sem rotação nem inclinação
    dragRotate:false, pitchWithRotate:false, touchPitch:false, maxPitch:0
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation(); // Shift+setas também giram/inclinam

  const temSat=!!cfg.chaveEsri;
  if(temSat&&lerBase()==='satelite') preconectaEsri();
  let vecErros=0, vecOk=false, perdidoT=null;
  let satErros=0, satOk=false, satFora=false; // satFora: o satélite não respondeu e foi desativado nesta sessão
  let satPronto=false; // a imagem já cobre a tela: só então o desenho do mapa por baixo é apagado
  let aqueceT=null;
  let base=temSat?lerBase():'mapa', pronto=false, visivel=false, carregou=false, aviso=null, avisoT=null;
  let spec=null, marcadores=[], fc={type:'FeatureCollection',features:[]};
  let tip=null, tipT=null, pop=null, ajustePend=null;
  const visOrig=new Map(), rotOrig=new Map(), comIcone=new Set();

  // ---- falha: estilo que não chega ----
  let falhou=false;
  const falhar=motivo=>{ if(falhou) return; falhou=true; try{ cfg.aoFalhar&&cfg.aoFalhar(motivo); }catch(_){} };
  const prazo=setTimeout(()=>{ if(!carregou) falhar('tempo esgotado'); },TIMEOUT_MS);
  map.on('error',e=>{
    // erro de tile ou de fonte não derruba o mapa; só o estilo que nem veio
    if(!carregou&&e&&!e.sourceId&&!e.tile) falhar((e.error&&e.error.message)||'erro no estilo');
    if(e&&e.sourceId==='gc-satelite'&&!satOk&&!satFora&&++satErros>=SAT_ERROS_MAX) satIndisponivel();
    if(e&&e.sourceId==='openmaptiles'&&!vecOk&&++vecErros>=VEC_ERROS_MAX) falhar('tiles do mapa não chegam');
  });
  map.on('data',e=>{
    if(e.dataType!=='source'||!e.tile) return;
    if(e.sourceId==='gc-satelite') satOk=true; else if(e.sourceId==='openmaptiles') vecOk=true;
  });
  const cv=map.getCanvas();
  cv.addEventListener('webglcontextlost',()=>{ clearTimeout(perdidoT); perdidoT=setTimeout(()=>falhar('contexto WebGL perdido'),CONTEXTO_PERDIDO_MS); });
  cv.addEventListener('webglcontextrestored',()=>clearTimeout(perdidoT));
  // com o satélite ligado o desenho do mapa fica apagado: se a imagem não chega, volta ao mapa em vez de ficar em branco
  function satIndisponivel(){
    satFora=true;
    if(base==='satelite') definirBase('mapa');
    marcaBase();
    mostraAviso('O satélite não respondeu agora; voltei ao mapa.');
  }

  // ---- busca: obras primeiro, endereço só quando o usuário pede ----
  // Digitar lista as obras (cfg.buscar, local e instantâneo). O endereço só é consultado no Nominatim (OpenStreetMap,
  // restrito ao Ceará) pelo Enter sem obra correspondente ou pelo clique na última linha da lista.
  let buscaInp=null, buscaLista=null, buscaRows=[], buscaSel=-1, buscaUlt=0, buscaPend=false, buscaQ='', lugarMk=null;
  const LUPA='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
  function fechaLista(){
    if(!buscaLista) return;
    buscaLista.hidden=true; buscaRows=[]; buscaSel=-1;
    buscaInp.setAttribute('aria-expanded','false'); buscaInp.removeAttribute('aria-activedescendant');
  }
  function marcaSel(i){
    buscaSel=i;
    buscaLista.querySelectorAll('.gc-busca-i').forEach((b,k)=>b.classList.toggle('sel',k===i));
    if(i>=0){ buscaInp.setAttribute('aria-activedescendant','gc-busca-i'+i); const b=buscaLista.children[i]; if(b&&b.scrollIntoView) b.scrollIntoView({block:'nearest'}); }
    else buscaInp.removeAttribute('aria-activedescendant');
  }
  // rows: {tipo:'obra'|'lugar'|'acao'|'msg', titulo, sub?, semLoc?, ref?}; o texto vem do banco ou da rede: sempre textContent
  function mostraLista(rows){
    buscaRows=rows; buscaSel=-1; buscaLista.textContent='';
    rows.forEach((r,i)=>{
      const b=document.createElement('button');
      b.type='button'; b.id='gc-busca-i'+i; b.className='gc-busca-i'+(r.tipo==='msg'?' msg':'')+(r.tipo==='acao'?' acao':'');
      b.setAttribute('role','option');
      const t=document.createElement('b'); t.textContent=r.titulo; b.appendChild(t);
      if(r.sub){ const u=document.createElement('span'); u.textContent=r.sub; b.appendChild(u); }
      if(r.semLoc){ const u=document.createElement('em'); u.textContent='sem localização no mapa'; b.appendChild(u); }
      if(r.tipo==='msg') b.disabled=true; else b.addEventListener('click',()=>escolhe(r));
      buscaLista.appendChild(b);
    });
    buscaLista.hidden=false; buscaInp.setAttribute('aria-expanded','true');
  }
  function aoDigitar(){
    buscaQ=buscaInp.value.trim();
    if(buscaQ.length<BUSCA_MIN){ fechaLista(); return; }
    const locais=(cfg.buscar?cfg.buscar(buscaQ):[]).map(it=>({tipo:'obra',titulo:it.titulo,sub:it.sub,semLoc:it.semLoc,ref:it}));
    locais.push({tipo:'acao',titulo:'Buscar “'+buscaQ+'” como endereço ou lugar',sub:'Consulta o OpenStreetMap, só no Ceará'});
    mostraLista(locais);
  }
  function escolhe(r){
    if(r.tipo==='obra'){ fechaLista(); buscaInp.value=r.titulo; buscaInp.blur(); if(cfg.aoEscolher) cfg.aoEscolher(r.ref); }
    else if(r.tipo==='lugar'){ fechaLista(); buscaInp.value=r.titulo; buscaInp.blur(); voaLugar(r.ref); }
    else if(r.tipo==='acao') buscaEndereco(buscaQ);
  }
  async function buscaEndereco(q){
    if(buscaPend) return;
    buscaPend=true; mostraLista([{tipo:'msg',titulo:'Buscando…'}]);
    const espera=Math.max(0,NOMINATIM_GAP_MS-(Date.now()-buscaUlt));
    if(espera) await new Promise(ok=>setTimeout(ok,espera));
    buscaUlt=Date.now();
    const ctl=new AbortController(), t=setTimeout(()=>ctl.abort(),10000);
    try{
      const c=cfg.caixa||{latMin:-7.95,latMax:-2.70,lngMin:-41.50,lngMax:-37.20};
      const url=NOMINATIM+'?format=jsonv2&limit=6&countrycodes=br&bounded=1&addressdetails=1&accept-language=pt-BR&viewbox='
        +[c.lngMin,c.latMax,c.lngMax,c.latMin].join(',')+'&q='+encodeURIComponent(q);
      const r=await fetch(url,{signal:ctl.signal});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const js=await r.json();
      if(buscaInp.value.trim()!==q) return; // o usuário já mudou o texto
      // a caixa do Ceará é retangular e pega trechos de RN, PB, PE e PI: o resultado precisa ser do estado
      const doCeara=x=>!x.address||x.address['ISO3166-2-lvl4']==='BR-CE'||x.address.state==='Ceará';
      const rows=(Array.isArray(js)?js:[]).filter(x=>isFinite(+x.lat)&&isFinite(+x.lon)&&doCeara(x)).map(x=>({tipo:'lugar',
        titulo:x.name||String(x.display_name||'').split(',')[0],sub:x.display_name,ref:{lat:+x.lat,lng:+x.lon,nome:x.display_name,bbox:x.boundingbox}}));
      mostraLista(rows.length?rows:[{tipo:'msg',titulo:'Nenhum lugar encontrado no Ceará.'}]);
    }catch(e){
      if(buscaInp.value.trim()===q) mostraLista([{tipo:'msg',titulo:'Não foi possível buscar o endereço agora. Tente de novo em instantes.'}]);
    }finally{ clearTimeout(t); buscaPend=false; }
  }
  function limpaLugar(){ if(lugarMk){ lugarMk.remove(); lugarMk=null; } }
  function voaLugar(r){
    limpaLugar();
    const e=document.createElement('div'); e.className='gc-gl-lugar';
    const box=document.createElement('div'); box.className='ruas-pop';
    const h=document.createElement('div'); h.className='ruas-pop-h'; h.textContent=r.nome; box.appendChild(h);
    if(cfg.rotaUrl){
      const a=document.createElement('a'); a.className='ruas-rota'; a.href=cfg.rotaUrl(r.lat,r.lng); a.target='_blank'; a.rel='noopener';
      a.textContent='Como chegar'; box.appendChild(a);
    }
    const pp=new ml.Popup({className:'ruas-popup',offset:14,maxWidth:'320px'}).setDOMContent(box);
    lugarMk=new ml.Marker({element:e}).setLngLat([r.lng,r.lat]).setPopup(pp).addTo(map);
    const b=r.bbox&&r.bbox.length===4?r.bbox.map(Number):null; // [sul, norte, oeste, leste]
    if(b&&b.every(isFinite)&&(b[1]-b[0]>.0008||b[3]-b[2]>.0008)) map.fitBounds([[b[2],b[0]],[b[3],b[1]]],{padding:80,maxZoom:17,duration:900});
    else map.flyTo({center:[r.lng,r.lat],zoom:16.5,duration:900});
    map.once('moveend',()=>{ if(lugarMk&&!lugarMk.getPopup().isOpen()) lugarMk.togglePopup(); });
  }
  function irPara(lng,lat,zoom){ map.flyTo({center:[lng,lat],zoom:zoom||17,duration:900}); }
  class BuscaCtl{
    onAdd(){
      const d=document.createElement('div'); d.className='maplibregl-ctrl gc-gl-busca';
      const l=document.createElement('span'); l.className='gc-busca-lupa'; l.innerHTML=LUPA; d.appendChild(l);
      const i=document.createElement('input');
      i.type='search'; i.placeholder='Buscar obra, município ou endereço'; i.autocomplete='off'; i.spellcheck=false;
      i.setAttribute('role','combobox'); i.setAttribute('aria-label','Buscar obra, município ou endereço');
      i.setAttribute('aria-autocomplete','list'); i.setAttribute('aria-expanded','false'); i.setAttribute('aria-controls','gc-busca-lista');
      const u=document.createElement('div'); u.id='gc-busca-lista'; u.className='gc-busca-lista'; u.setAttribute('role','listbox'); u.hidden=true;
      d.append(i,u);
      buscaInp=i; buscaLista=u;
      i.addEventListener('input',aoDigitar);
      i.addEventListener('focus',()=>{ if(i.value.trim().length>=BUSCA_MIN&&!buscaRows.length) aoDigitar(); });
      i.addEventListener('keydown',ev=>{
        const n=buscaRows.length;
        if(ev.key==='ArrowDown'&&n){ ev.preventDefault(); marcaSel((buscaSel+1)%n); }
        else if(ev.key==='ArrowUp'&&n){ ev.preventDefault(); marcaSel((buscaSel-1+n)%n); }
        else if(ev.key==='Enter'){
          ev.preventDefault();
          const r=buscaRows[buscaSel>=0?buscaSel:0]; // sem seleção: o primeiro resultado (uma obra, ou a busca de endereço)
          if(r) escolhe(r); else if(i.value.trim().length>=BUSCA_MIN) aoDigitar();
        }
        else if(ev.key==='Escape'){ if(!buscaLista.hidden) fechaLista(); else i.blur(); }
      });
      this._fora=ev=>{ if(!d.contains(ev.target)) fechaLista(); };
      document.addEventListener('mousedown',this._fora);
      this._d=d; return d;
    }
    onRemove(){ document.removeEventListener('mousedown',this._fora); this._d.remove(); }
  }

  // ---- controles ----
  class BaseCtl{
    onAdd(){
      const d=document.createElement('div');
      d.className='maplibregl-ctrl maplibregl-ctrl-group gc-gl-base';
      d.setAttribute('role','group'); d.setAttribute('aria-label','Tipo de mapa');
      for(const [k,t] of [['mapa','Mapa'],['satelite','Satélite']]){
        const b=document.createElement('button');
        b.type='button'; b.textContent=t; b.dataset.base=k;
        b.addEventListener('click',()=>definirBase(k));
        // ponteiro, foco ou toque no botão já começam a baixar a imagem: quando o clique vem, ela está a caminho ou pronta
        if(k==='satelite') for(const ev of ['pointerenter','focus','touchstart']) b.addEventListener(ev,preaquece,{passive:true});
        d.appendChild(b);
      }
      this._d=baseEl=d; marcaBase(); return d;
    }
    onRemove(){ this._d.remove(); }
  }
  let baseEl=null; // o controle ainda não está no DOM quando onAdd roda: marca pelo elemento, não por busca
  function marcaBase(){
    if(!baseEl) return;
    baseEl.querySelectorAll('button').forEach(b=>{
      const on=b.dataset.base===base; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on));
      if(b.dataset.base==='satelite'){ b.disabled=satFora; b.title=satFora?'Satélite indisponível agora':''; }
    });
  }
  map.addControl(new BuscaCtl(),'top-left');
  if(temSat) map.addControl(new BaseCtl(),'top-right');
  map.addControl(new ml.NavigationControl({showCompass:false}),'top-right'); // só aproximar/afastar: o mapa não gira
  // "minha posição": pede a localização do aparelho uma vez e centra nela (o iframe do módulo já libera geolocation)
  map.addControl(new ml.GeolocateControl({positionOptions:{enableHighAccuracy:true,timeout:15000},trackUserLocation:false,
    showAccuracyCircle:false,fitBoundsOptions:{maxZoom:16}}),'top-right');
  map.addControl(new ml.AttributionControl({compact:true}),'bottom-left');

  // O estilo Liberty desenha os prédios como fill-extrusion (building-3d), que custa GPU e não rende nada num mapa
  // que não inclina. Troca por polígonos planos, com a mesma fonte e filtro; a cor é a do estilo Liberty (v. ESTILO),
  // copiada à mão: se o OpenFreeMap mudar o estilo, ajustar aqui.
  function achataPredios(){
    const ant=map.getLayer('building-3d'); if(!ant) return;
    const ls=map.getStyle().layers, i=ls.findIndex(l=>l.id==='building-3d');
    const depois=ls[i+1]&&ls[i+1].id;
    map.addLayer({id:'predios-planos',type:'fill',source:ant.source,'source-layer':ant.sourceLayer,minzoom:14,
      filter:map.getFilter('building-3d'),
      paint:{'fill-color':'hsl(35,8%,85%)','fill-outline-color':'hsl(35,6%,79%)','fill-opacity':.8}},depois);
    map.removeLayer('building-3d');
  }

  // ---- base: mapa x satélite ----
  // Uma só folha de estilo. No satélite apagam-se as camadas de desenho do mapa (terra, água, ruas,
  // prédios) e fica a imagem com os rótulos por cima; ao voltar, cada camada recupera a visibilidade
  // que o estilo lhe deu.
  function guardaOriginais(){
    for(const l of map.getStyle().layers){
      if(l.id.startsWith('gc-')) continue;
      visOrig.set(l.id,(l.layout&&l.layout.visibility)||'visible');
      if(l.type==='symbol'){
        rotOrig.set(l.id,{c:map.getPaintProperty(l.id,'text-color'), h:map.getPaintProperty(l.id,'text-halo-color')});
        if(SOMEM_NO_SATELITE.test(l.id)) comIcone.add(l.id); // placas de rodovia, setas de mão única, ícones de lugares
      }
    }
  }
  function preconectaEsri(){
    if(document.querySelector('link[data-gc-esri]')) return;
    const l=document.createElement('link');
    l.rel='preconnect'; l.href=ESRI_ORIGEM; l.crossOrigin='anonymous'; l.dataset.gcEsri='1';
    document.head.appendChild(l);
  }
  // Liga o satélite com opacidade 0: a camada visível faz o MapLibre pedir os tiles, mas nada aparece. Sem clique, desliga.
  function preaquece(){
    if(!pronto||satFora||base==='satelite'||!map.getLayer('gc-satelite')) return;
    preconectaEsri();
    clearTimeout(aqueceT);
    map.setPaintProperty('gc-satelite','raster-opacity',0);
    map.setLayoutProperty('gc-satelite','visibility','visible');
    aqueceT=setTimeout(()=>{ if(base!=='satelite'&&map.getLayer('gc-satelite')) map.setLayoutProperty('gc-satelite','visibility','none'); },AQUECE_MS);
  }
  // O desenho do mapa só some depois que a imagem chegou (idle = tiles e transições concluídos): até lá ele aparece
  // por baixo e o satélite entra por cima, em vez de a tela ficar em branco esperando a rede.
  function aplicaBase(){
    if(!pronto) return;
    const sat=base==='satelite';
    satPronto=false; clearTimeout(aqueceT);
    if(map.getLayer('gc-satelite')){
      map.setPaintProperty('gc-satelite','raster-opacity',1);
      map.setLayoutProperty('gc-satelite','visibility',sat?'visible':'none');
    }
    aplicaDesenho();
    if(sat) map.once('idle',()=>{ if(base==='satelite'&&!satPronto){ satPronto=true; aplicaDesenho(); } });
  }
  function aplicaDesenho(){
    const sat=base==='satelite', apaga=sat&&satPronto;
    for(const [id,vis] of visOrig){
      if(!map.getLayer(id)) continue;
      const tipo=map.getLayer(id).type;
      if(tipo==='symbol'){
        const r=rotOrig.get(id); if(!r) continue;
        // as placas de rodovia são caixas brancas com texto: com o texto branco do satélite sumiriam, e sobre a
        // imagem só atrapalham; essas camadas ficam apagadas no satélite (os rótulos de cidade continuam)
        if(comIcone.has(id)) map.setLayoutProperty(id,'visibility',sat?'none':vis);
        map.setPaintProperty(id,'text-color',sat?'#ffffff':r.c);
        map.setPaintProperty(id,'text-halo-color',sat?'rgba(0,0,0,.75)':r.h);
        continue;
      }
      map.setLayoutProperty(id,'visibility',apaga?'none':vis);
    }
  }
  function definirBase(k){
    base=k==='satelite'?'satelite':'mapa';
    try{ localStorage.setItem(PREF_BASE,base); }catch(_){}
    marcaBase(); aplicaBase();
  }

  // ---- aviso temporário sobre o mapa ----
  function escondeAviso(){ clearTimeout(avisoT); if(aviso){ aviso.remove(); aviso=null; } }
  function mostraAviso(texto){
    escondeAviso();
    aviso=document.createElement('div');
    aviso.className='gc-gl-aviso'; aviso.setAttribute('role','status');
    aviso.textContent=texto;
    el.appendChild(aviso);
    avisoT=setTimeout(escondeAviso,AVISO_MS);
  }

  // ---- contorno da área aberta ----
  function aplicaContorno(){
    if(!pronto) return;
    const s=map.getSource('gc-contorno'); if(s) s.setData(fc);
  }
  // as cores vêm dos tokens do tema e mudam na troca claro/escuro: quem chama repassa a cada render
  function definirCores(linha,preench){
    if(linha===cfg.corLinha&&preench===cfg.corPreench) return;
    cfg.corLinha=linha; cfg.corPreench=preench;
    if(!pronto) return;
    map.setPaintProperty('gc-contorno-line','line-color',linha); map.setPaintProperty('gc-contorno-fill','fill-color',preench);
  }
  function definirContornos(f){ fc=f||{type:'FeatureCollection',features:[]}; aplicaContorno(); }

  // ---- pinos ----
  function fechaPop(){ if(pop){ pop.remove(); pop=null; } }
  function escondeTip(){ clearTimeout(tipT); if(tip){ tip.remove(); tip=null; } }
  // o tooltip de um pino com "Como chegar" é clicável: fecha com uma pequena folga, para o mouse alcançar o link
  function agendaFechaTip(){ clearTimeout(tipT); tipT=setTimeout(escondeTip,250); }
  function mostraTip(m){
    clearTimeout(tipT);
    if(pop||!m.tip) return;
    escondeTip();
    tip=new ml.Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,className:'ruas-tip'+(m.rota?' com-rota':''),maxWidth:'320px',offset:[0,-m.h+8]})
      .setLngLat([m.lng,m.lat]).setHTML(m.tip).addTo(map);
    if(m.rota){
      const pe=tip.getElement();
      pe.addEventListener('mouseenter',()=>clearTimeout(tipT)); pe.addEventListener('mouseleave',agendaFechaTip);
    }
  }
  function abrePop(m){
    escondeTip(); fechaPop();
    pop=new ml.Popup({className:'ruas-popup',maxWidth:'340px',offset:[0,-m.h+6],closeButton:true})
      .setLngLat([m.lng,m.lat]).setDOMContent(m.popup(fechaPop)).addTo(map);
    pop.on('close',()=>{ pop=null; });
  }
  function ativa(m){
    escondeTip();
    if(m.bounds){ // vários pontos próximos: aproxima; sem mais zoom possível, lista as obras
      const cam=map.cameraForBounds(m.bounds,{padding:60,maxZoom:map.getMaxZoom()});
      if(cam&&cam.zoom>map.getZoom()+.01){ map.fitBounds(m.bounds,{padding:60,maxZoom:map.getMaxZoom(),duration:500}); return; }
    }
    if(m.abrir){ m.abrir(); return; }
    if(m.popup) abrePop(m);
  }
  function limpaPinos(){ marcadores.forEach(mk=>mk.remove()); marcadores=[]; escondeTip(); fechaPop(); }
  function adicionaPino(m){
    const e=document.createElement('div');
    e.className='ruas-pin '+m.cls+(m.n>1?' multi':'');
    e.innerHTML=m.svg; e.tabIndex=0; e.setAttribute('role','button'); e.setAttribute('aria-label',m.titulo);
    e.addEventListener('mouseenter',()=>mostraTip(m));
    e.addEventListener('mouseleave',()=>{ if(m.rota) agendaFechaTip(); else escondeTip(); });
    e.addEventListener('focus',()=>mostraTip(m));
    e.addEventListener('blur',escondeTip);
    e.addEventListener('click',ev=>{ ev.stopPropagation(); ativa(m); });
    e.addEventListener('keydown',ev=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); ativa(m); } });
    marcadores.push(new ml.Marker({element:e,anchor:'bottom'}).setLngLat([m.lng,m.lat]).addTo(map));
  }
  // O agrupamento usa a célula em pixels de mundo (estável ao arrastar), igual ao do Leaflet.
  function redesenha(){
    limpaPinos();
    if(!spec) return;
    let itens;
    if(spec.agrupar){
      const tam=512*Math.pow(2,map.getZoom()), cel=new Map();
      for(const g of spec.grupos){
        const c=ml.MercatorCoordinate.fromLngLat([g.lng,g.lat]);
        const k=Math.floor(c.x*tam/CELULA_PX)+':'+Math.floor(c.y*tam/CELULA_PX);
        let a=cel.get(k); if(!a){ a=[]; cel.set(k,a); } a.push(g);
      }
      itens=[...cel.values()];
    } else itens=spec.grupos.map(g=>[g]);
    for(const gs of itens) adicionaPino(spec.fabrica(gs));
  }
  // spec: {grupos:[{lat,lng,obras}], agrupar:bool, fabrica(gs[])→{lat,lng,n,cls,svg,h,titulo,tip,abrir?,popup?(fechar),bounds?}}
  function definirPinos(s){ spec=s; redesenha(); }
  map.on('zoomend',()=>{ if(spec&&spec.agrupar&&visivel) redesenha(); });

  // ---- câmera / visibilidade ----
  function ajustar(b,op){
    if(!b) return;
    op=op||{};
    const roda=()=>{ map.resize(); map.fitBounds(b,{padding:op.padding||60,maxZoom:op.maxZoom||17,duration:0}); };
    if(visivel) roda(); else ajustePend=roda;
  }
  function mostrar(){
    visivel=true; el.classList.add('on'); map.resize();
    if(ajustePend){ const f=ajustePend; ajustePend=null; f(); }
    if(spec&&spec.agrupar) redesenha();
  }
  function ocultar(){ escondeAviso(); visivel=false; el.classList.remove('on'); limpaPinos(); limpaLugar(); fechaLista(); }
  function redimensionar(){ if(visivel) map.resize(); }
  function destruir(){ clearTimeout(prazo); clearTimeout(perdidoT); clearTimeout(aqueceT); escondeAviso(); limpaPinos(); limpaLugar(); map.remove(); el.remove(); }

  // ---- estilo carregado: camadas próprias ----
  map.once('load',()=>{
    carregou=true; clearTimeout(prazo);
    try{
      // antes de guardaOriginais: a camada nova entra na troca mapa/satélite como as do estilo. É só desempenho:
      // se o estilo mudar e a troca falhar, o mapa segue com os prédios do estilo em vez de cair para o Leaflet
      try{ achataPredios(); }catch(e){ console.warn('Prédios planos indisponíveis; mantido o estilo original:',(e&&e.message)||e); }
      guardaOriginais();
      const antes=map.getStyle().layers.find(l=>l.type==='symbol'); // satélite e contorno ficam sob os rótulos
      const antesId=antes&&antes.id;
      if(temSat){
        map.addSource('gc-satelite',{type:'raster',tiles:[ESRI_TILES+encodeURIComponent(cfg.chaveEsri)],tileSize:256,maxzoom:ESRI_MAXZOOM,attribution:ESRI_ATTR});
        map.addLayer({id:'gc-satelite',type:'raster',source:'gc-satelite',layout:{visibility:'none'}},antesId);
      }
      map.addSource('gc-contorno',{type:'geojson',data:fc});
      map.addLayer({id:'gc-contorno-fill',type:'fill',source:'gc-contorno',
        paint:{'fill-color':cfg.corPreench||'#007233','fill-opacity':.07}},antesId);
      map.addLayer({id:'gc-contorno-line',type:'line',source:'gc-contorno',
        layout:{'line-join':'round'},paint:{'line-color':cfg.corLinha||'#007233','line-width':1.8,'line-opacity':.9}},antesId);
      // no celular a atribuição abre recolhida (só o "i"): expandida ela cobre o botão "Ocultar ruas e rotas"
      if(window.matchMedia&&window.matchMedia('(max-width:600px)').matches){
        const at=el.querySelector('.maplibregl-ctrl-attrib'); if(at) at.classList.remove('maplibregl-compact-show');
      }
      pronto=true; aplicaBase();
    }catch(e){ falhar((e&&e.message)||'erro ao montar as camadas'); }
  });

  return {el,mapa:map,definirCores,irPara,avisar:mostraAviso,mostrar,ocultar,definirPinos,definirContornos,ajustar,redimensionar,destruir,base:()=>base};
}

window.MapaRuasGL={suportado,carregar,criar};
})();
