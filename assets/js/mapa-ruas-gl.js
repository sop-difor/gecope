/* Mapa de ruas em MapLibre GL — modo "Ruas e rotas" nos níveis distrito e município (E1 do mapa 3D).
   O mapa de contornos (Estado > Região > Município) continua em Leaflet; este arquivo só desenha o que
   fica por cima dele quando o modo ruas está ligado: base vetorial (OpenFreeMap) ou satélite (Esri),
   o contorno da área aberta e os pinos das obras. Os dados e o conteúdo dos pinos vêm de mapa-obras.js;
   aqui só há desenho e interação.

   Carga sob demanda: a biblioteca (~900 KB) só é baixada no primeiro clique em "Ruas e rotas". Qualquer
   falha (sem WebGL2, script ou estilo que não chega) vira rejeição/aoFalhar e o chamador volta ao Leaflet.

   Decisões (grilling de 21/10/2026):
   - só provedores gratuitos e sem chave (OpenFreeMap, Esri World Imagery);
   - o mapa abre plano; rotação e inclinação ficam travadas e só o botão 3D as libera (inclina ~60°, liga o
     relevo do AWS Terrain Tiles com exagero 1,5× e sombreamento leve; os prédios vêm do OpenStreetMap e o
     estilo já os extruda a partir do zoom 14, então só mostram altura com o mapa inclinado);
   - o mapa é claro nos dois temas; só os controles e popups seguem o tema (CSS em mapa-obras.css). */
(function(){
'use strict';

const ML_JS='https://cdn.jsdelivr.net/npm/maplibre-gl@5.7.0/dist/maplibre-gl.js';
const ML_JS_SRI='sha384-Blts4zGbI8Hh/NvhcxTYsF2uLBbYIwHXEhPMxN3XpadJCDgstyLfJA3opgmkfBOc';
const ML_CSS='https://cdn.jsdelivr.net/npm/maplibre-gl@5.7.0/dist/maplibre-gl.css';
const ML_CSS_SRI='sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR';
const ESTILO='https://tiles.openfreemap.org/styles/liberty';
const ESRI_TILES='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR='Imagens © Esri, Maxar, Earthstar Geographics e a comunidade GIS';
const PREF_BASE='gecope_mapa_base';
const CELULA_PX=38;        // pontos a menos disto na tela viram um pino com a contagem (nível distrito)
const TIMEOUT_MS=15000;    // estilo que não chega neste prazo = falha, e o Leaflet assume
const SOMEM_NO_SATELITE=/shield|one_way|^poi_|^airport/; // camadas de ícone do estilo Liberty que atrapalham sobre a imagem
const DEM_TILES='https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const DEM_ATTR='Relevo: Mapzen e AWS Terrain Tiles';
const EXAGERO=1.5, PITCH_3D=60, PITCH_MAX=70;
// No satélite o exagero cai com o zoom: o DEM (SRTM) leva prédios e árvores embutidos e, de perto, a imagem desenhada
// sobre ele ondula nas cidades. De longe (serras, litoral) o relevo cheio fica ótimo.
const EXAGERO_SAT_PERTO=0.5, ZOOM_EXAGERO=[12,15];
const AVISO_MS=7000;
const LOCALE={
  'NavigationControl.ZoomIn':'Aproximar','NavigationControl.ZoomOut':'Afastar','NavigationControl.ResetBearing':'Voltar ao norte',
  'AttributionControl.ToggleAttribution':'Mostrar créditos','AttributionControl.MapFeedback':'Sugerir correção no mapa',
  'FullscreenControl.Enter':'Tela cheia','FullscreenControl.Exit':'Sair da tela cheia'
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

// cfg: {corLinha, corPreench, aoFalhar(motivo)}
function criar(host,cfg){
  const ml=window.maplibregl;
  cfg=cfg||{};
  const el=document.createElement('div');
  el.className='gc-gl';
  host.appendChild(el);

  const map=new ml.Map({
    container:el, style:ESTILO, center:[-39.3,-5.2], zoom:6.5, minZoom:5, maxZoom:18,
    attributionControl:false, renderWorldCopies:false, locale:LOCALE,
    // plano de saída: sem rotação nem inclinação até o botão 3D (liberaGestos)
    dragRotate:false, pitchWithRotate:true, touchPitch:false, maxPitch:0
  });
  map.touchZoomRotate.disableRotation();

  let base=lerBase(), pronto=false, visivel=false, carregou=false, tres=false, aviso=null, avisoT=null;
  let spec=null, marcadores=[], fc={type:'FeatureCollection',features:[]};
  let tip=null, pop=null, ajustePend=null;
  const visOrig=new Map(), rotOrig=new Map(), comIcone=new Set();

  // ---- falha: estilo que não chega ----
  let falhou=false;
  const falhar=motivo=>{ if(falhou) return; falhou=true; try{ cfg.aoFalhar&&cfg.aoFalhar(motivo); }catch(_){} };
  const prazo=setTimeout(()=>{ if(!carregou) falhar('tempo esgotado'); },TIMEOUT_MS);
  map.on('error',e=>{
    // erro de tile ou de fonte não derruba o mapa; só o estilo que nem veio
    if(!carregou&&e&&!e.sourceId&&!e.tile) falhar((e.error&&e.error.message)||'erro no estilo');
  });

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
    });
  }
  let btn3d=null;
  class Ctl3D{
    onAdd(){
      const d=document.createElement('div');
      d.className='maplibregl-ctrl maplibregl-ctrl-group gc-gl-3d';
      const b=document.createElement('button');
      b.type='button'; b.textContent='3D'; b.title='Visão 3D: inclinar e girar o mapa'; b.setAttribute('aria-pressed','false');
      b.addEventListener('click',()=>define3D(!tres));
      d.appendChild(b); this._d=d; btn3d=b; return d;
    }
    onRemove(){ this._d.remove(); }
  }
  map.addControl(new BaseCtl(),'top-right');
  map.addControl(new Ctl3D(),'top-right');
  // a bússola só aparece no 3D (CSS: .gc-gl:not(.gc-3d)); clicar nela volta ao norte
  map.addControl(new ml.NavigationControl({showCompass:true,visualizePitch:true}),'top-right');
  map.addControl(new ml.AttributionControl({compact:true}),'bottom-left');

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
  function aplicaBase(){
    if(!pronto) return;
    const sat=base==='satelite';
    if(map.getLayer('gc-satelite')) map.setLayoutProperty('gc-satelite','visibility',sat?'visible':'none');
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
      map.setLayoutProperty(id,'visibility',sat?'none':vis);
    }
  }
  function definirBase(k){
    base=k==='satelite'?'satelite':'mapa';
    try{ localStorage.setItem(PREF_BASE,base); }catch(_){}
    marcaBase(); aplicaBase(); aplicaExagero();
  }

  // ---- 3D: inclinação, relevo e prédios ----
  // Abre sempre plano; só o botão liga. O relevo é o terreno do mapa (setTerrain) mais um sombreamento leve; os
  // prédios do OpenStreetMap já vêm extrudados no estilo (camada building-3d, zoom 14+) e só mostram altura com
  // o mapa inclinado. No satélite o 3D mostra só o relevo (a imagem é desenhada sobre o terreno).
  function liberaGestos(on){
    if(on){
      map.setMaxPitch(PITCH_MAX); map.dragRotate.enable(); map.touchPitch.enable(); map.touchZoomRotate.enableRotation();
    } else {
      map.dragRotate.disable(); map.touchPitch.disable(); map.touchZoomRotate.disableRotation(); map.setMaxPitch(0);
    }
  }
  let exagAtual=EXAGERO;
  function exageroDoZoom(){
    if(base!=='satelite') return EXAGERO;
    const z=map.getZoom(), a=ZOOM_EXAGERO[0], b=ZOOM_EXAGERO[1];
    const e=z<=a?EXAGERO:z>=b?EXAGERO_SAT_PERTO:EXAGERO+(EXAGERO_SAT_PERTO-EXAGERO)*(z-a)/(b-a);
    return Math.round(e*20)/20; // passos de 0,05: não refaz o terreno a cada fração de zoom
  }
  function aplicaExagero(){
    if(!tres||!pronto) return;
    const e=exageroDoZoom();
    if(e===exagAtual) return;
    exagAtual=e; map.setTerrain({source:'gc-dem',exaggeration:e});
  }
  map.on('zoom',aplicaExagero);
  function marca3D(){
    el.classList.toggle('gc-3d',tres);
    if(btn3d){ btn3d.classList.toggle('on',tres); btn3d.setAttribute('aria-pressed',String(tres)); }
  }
  function escondeAviso(){ clearTimeout(avisoT); if(aviso){ aviso.remove(); aviso=null; } }
  function mostraAviso(){
    escondeAviso();
    aviso=document.createElement('div');
    aviso.className='gc-gl-aviso'; aviso.setAttribute('role','status');
    aviso.textContent=base==='satelite'
      ?'No satélite, o 3D mostra só o relevo. Arraste com o botão direito para inclinar e girar.'
      :'Prédios 3D dependem do OpenStreetMap e podem faltar em cidades menores. Arraste com o botão direito para inclinar e girar.';
    el.appendChild(aviso);
    avisoT=setTimeout(escondeAviso,AVISO_MS);
  }
  function define3D(on){
    if(!pronto||on===tres) return;
    tres=on; marca3D();
    if(on){
      liberaGestos(true);
      exagAtual=exageroDoZoom();
      map.setTerrain({source:'gc-dem',exaggeration:exagAtual});
      map.setLayoutProperty('gc-relevo','visibility','visible');
      map.easeTo({pitch:PITCH_3D,duration:900});
      mostraAviso();
    } else {
      escondeAviso();
      map.setLayoutProperty('gc-relevo','visibility','none');
      map.easeTo({pitch:0,bearing:0,duration:700});
      map.once('moveend',()=>{ if(tres) return; map.setTerrain(null); liberaGestos(false); });
    }
  }
  // volta ao plano na hora (ao fechar o modo ruas): sem animação, nada fica ligado por baixo
  function reset3D(){
    if(!tres) return;
    tres=false; marca3D(); escondeAviso();
    if(pronto){ map.setLayoutProperty('gc-relevo','visibility','none'); map.setTerrain(null); }
    map.jumpTo({pitch:0,bearing:0}); liberaGestos(false);
  }

  // ---- contorno da área aberta ----
  function aplicaContorno(){
    if(!pronto) return;
    const s=map.getSource('gc-contorno'); if(s) s.setData(fc);
  }
  function definirContornos(f){ fc=f||{type:'FeatureCollection',features:[]}; aplicaContorno(); }

  // ---- pinos ----
  function fechaPop(){ if(pop){ pop.remove(); pop=null; } }
  function escondeTip(){ if(tip){ tip.remove(); tip=null; } }
  function mostraTip(m){
    if(pop||!m.tip) return;
    escondeTip();
    tip=new ml.Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,className:'ruas-tip',maxWidth:'320px',offset:[0,-m.h+8]})
      .setLngLat([m.lng,m.lat]).setHTML(m.tip).addTo(map);
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
    e.addEventListener('mouseleave',escondeTip);
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
  function ocultar(){ reset3D(); visivel=false; el.classList.remove('on'); limpaPinos(); }
  function redimensionar(){ if(visivel) map.resize(); }
  function destruir(){ clearTimeout(prazo); escondeAviso(); limpaPinos(); map.remove(); el.remove(); }

  // ---- estilo carregado: camadas próprias ----
  map.once('load',()=>{
    carregou=true; clearTimeout(prazo);
    try{
      guardaOriginais();
      const antes=map.getStyle().layers.find(l=>l.type==='symbol'); // satélite e contorno ficam sob os rótulos
      const antesId=antes&&antes.id;
      map.addSource('gc-satelite',{type:'raster',tiles:[ESRI_TILES],tileSize:256,maxzoom:19,attribution:ESRI_ATTR});
      map.addLayer({id:'gc-satelite',type:'raster',source:'gc-satelite',layout:{visibility:'none'}},antesId);
      map.addSource('gc-dem',{type:'raster-dem',tiles:[DEM_TILES],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:DEM_ATTR});
      // o sombreamento fica sob a camada de água do estilo: o DEM traz a batimetria e, por cima da água, o mar
      // ganharia manchas escuras. Sob o satélite ele some junto com o resto do desenho do mapa.
      map.addLayer({id:'gc-relevo',type:'hillshade',source:'gc-dem',layout:{visibility:'none'},
        paint:{'hillshade-exaggeration':.3}},map.getLayer('water')?'water':antesId);
      map.addSource('gc-contorno',{type:'geojson',data:fc});
      map.addLayer({id:'gc-contorno-fill',type:'fill',source:'gc-contorno',
        paint:{'fill-color':cfg.corPreench||'#007233','fill-opacity':.07}},antesId);
      map.addLayer({id:'gc-contorno-line',type:'line',source:'gc-contorno',
        layout:{'line-join':'round'},paint:{'line-color':cfg.corLinha||'#007233','line-width':1.8,'line-opacity':.9}},antesId);
      pronto=true; aplicaBase();
    }catch(e){ falhar((e&&e.message)||'erro ao montar as camadas'); }
  });

  return {el,mapa:map,exagero:()=>exagAtual,mostrar,ocultar,definirPinos,definirContornos,ajustar,redimensionar,destruir,base:()=>base,em3D:()=>tres,define3D};
}

window.MapaRuasGL={suportado,carregar,criar};
})();
