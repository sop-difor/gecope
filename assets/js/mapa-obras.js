(async function(){
try{
// lê os tokens de cor direto do :root (assets/css/mapa-obras.css) — regra da Fase 2:
// nenhuma cor pode ser hardcoded aqui e também no CSS; o JS só tem a leitura, o CSS
// é a única fonte da verdade da paleta.
// getComputedStyle(document.documentElement) é um objeto VIVO: depois que a classe
// 'theme-dark' entra/sai da raiz, reler _tok() já devolve os valores do outro tema.
// readTokens() reaproveita isso na troca ao vivo de tema (Bloco 6) — ver repaintTheme().
const _cs=getComputedStyle(document.documentElement);
const _tok=k=>_cs.getPropertyValue(k).trim();
function readTokens(){ return {
  ng:_tok('--ng'), ngRgb:_tok('--ng-rgb'), amber:_tok('--amber'),
  statusExec:_tok('--status-exec'), statusOk:_tok('--status-ok'), statusWait:_tok('--status-wait'), statusStop:_tok('--status-stop'),
  mapBase:_tok('--map-base'), mapOpenFill:_tok('--map-open-fill'), mapOpenBorder:_tok('--map-open-border'),
  mapGroupBorder:_tok('--map-group-border'), mapStateFill:_tok('--map-state-fill'), mapStateHover:_tok('--map-state-hover'),
  textBrightest:_tok('--text-brightest'),
  // Bloco 4: cor das linhas de hover/seleção do mapa e a fórmula da coroplética
  // (opacidade = floor + span·t). Vêm do CSS por tema; fallback = valores de sempre.
  mapLine:_tok('--map-line')||_tok('--text-brightest'),
  choroFloor:parseFloat(_tok('--choro-floor'))||0.10, choroSpan:parseFloat(_tok('--choro-span'))||0.62,
  // Etapa C — cinza de "sem correspondência" (filtro ativo, 0 contratos na área).
  // Tokens --nomatch-* definidos nos dois temas; CSS é a única fonte da cor.
  nomatchFill:_tok('--nomatch-fill'), nomatchBorder:_tok('--nomatch-border'),
  // Modo Replanilhamentos — área com amostra pequena demais para entrar na escala.
  amostraFill:_tok('--amostra-fill'), amostraOpacity:parseFloat(_tok('--amostra-opacity'))||0.40,
}; }
// TOKENS continua const (referência estável usada em todo o arquivo); na troca de
// tema o conteúdo é reescrito no lugar com Object.assign, não trocado o objeto.
const TOKENS=readTokens();
document.body.classList.add('boot-loading'); // pulso nos KPIs/gráficos até a 1ª carga de dados terminar (sucesso ou erro)

let GEO, ESTADO, GRP, MUN, DISTRITOS, NAMEIDX;
try{
  const _fetchJson=u=>fetch(u).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' em '+u); return r.json(); });
  const [_muni,_estado,_blocos,_ref]=await Promise.all([
    _fetchJson('assets/geo/ce-municipios.json'),
    _fetchJson('assets/geo/ce-estado.json'),
    _fetchJson('assets/geo/ce-blocos.json'),
    _fetchJson('assets/geo/ce-referencia.json'),
  ]);
  GEO=_muni; ESTADO=_estado; GRP=_blocos;
  MUN=_ref.MUN; DISTRITOS=_ref.DISTRITOS; NAMEIDX=_ref.NAMEIDX;
}catch(e){
  console.error('Falha ao carregar dados geográficos:',e);
  showDataError('Não foi possível carregar os dados geográficos do mapa. Verifique a conexão e recarregue a página.');
  throw e;
}
/* ============================================================
   CONEXÃO COM O SUPABASE
   URL/chave vêm de config.js (window.SUPABASE_URL/KEY), a mesma
   fonte usada pelo resto do GECOPE — carregue config.js e database.js
   antes deste script. Plano de permissões por papel (Fase 2): esta
   página deixou de ser pública — exige sessão do GECOPE. As tabelas
   abaixo têm RLS de leitura só para usuários autenticados com papel
   válido (admin/gerente/fiscal/externo); a antiga policy pública
   (role anon) foi removida (ver sql/fechar_acesso_publico_contratos.sql).
   Se o Supabase estiver inacessível, ou não houver sessão, o painel
   mostra um erro explícito (showDataError) — não há dataset de demonstração.
   ============================================================ */
const SB_URL=window.SUPABASE_URL;
// Token da sessão logada do GECOPE — usado como Authorization em vez da chave
// anônima fixa, para que o RLS saiba QUEM está pedindo os dados (antes, todo
// pedido ia como role anon, então não dava pra restringir por papel no banco).
// window.sbClient vem de database.js (mesmo cliente do resto do GECOPE, com
// storage guard e refresh automático). null se não houver sessão ativa.
let SESSION_TOKEN=null;
async function obterTokenSessao(){
  try{
    for(let i=0;i<20 && !window.sbClient;i++){ await new Promise(r=>setTimeout(r,100)); }
    if(!window.sbClient) return null;
    const {data}=await window.sbClient.auth.getSession();
    return data?.session?.access_token ?? null;
  }catch{ return null; }
}
// Papel do usuário logado (E1) — decide se o modo Replanilhamentos é OFERECIDO. Não é
// controle de acesso: o gate real é a view no banco, que devolve 0 linhas para quem não
// for admin/gerente. Aqui só evitamos mostrar um botão que levaria a uma tela vazia.
// app_users libera SELECT a qualquer autenticado (policy "Usuários autenticados podem
// ver perfis"), então esta consulta não depende de papel nenhum para funcionar.
let USER_PAPEL=null;
async function obterPapelUsuario(){
  try{
    if(!window.sbClient) return null;
    const {data}=await window.sbClient.auth.getSession();
    const email=data?.session?.user?.email; if(!email) return null;
    // ilike, não eq: public.meu_papel() casa por lower(email)=lower(jwt.email), e uma
    // comparação exata aqui deixaria um admin com e-mail gravado em caixa diferente
    // invisível para o front-end embora a view lhe devolva tudo.
    const {data:rows,error}=await window.sbClient
      .from('app_users').select('role').ilike('email',email).limit(1);
    if(error) throw error;
    return rows&&rows[0] ? rows[0].role : null;
  }catch(e){ console.warn('Não foi possível ler o papel do usuário:',e.message||e); return null; }
}
function podeVerReplanilhamentos(){ return PAPEIS_REPLAN.includes(USER_PAPEL); }
// Papel que não pôde ser lido (rede oscilando, usuário fora de app_users) é diferente
// de papel negado. Esconder o modo nesse caso faria um admin legítimo não achar o
// painel e não ter como descobrir por quê. Como o portão de verdade é a view no banco
// — que devolve 0 linhas e cai na mensagem de acesso restrito — errar para o lado de
// OFERECER é barato aqui, e errar para o lado de esconder é caro.
// Exige sessão: sem ela o papel não é "indeterminado", é inexistente — e a página
// inteira já está atrás do aviso de login.
function papelIndefinido(){ return USER_PAPEL===null && !!SESSION_TOKEN; }

const SB_KEY=window.SUPABASE_KEY;
const SB_TABLE='contratos_edificacao';
const SB_COMISSAO='comissao_fiscalizacao';
const SB_ADITIVOS='aditivos_contrato';
const SB_FICHA='ficha_contrato';
const SB_MEDICOES='medicoes'; // Etapa B: curva de evolução da medição na aba Resumo
const SB_ELETRICA='eletrica_vistorias'; // Fase 1 da aba "Elétrica" — relatórios de vistoria elétrica por obra
// só as colunas realmente usadas em mapRow()/openModal() — evita select=* (a tabela
// tem ~38 colunas, várias nunca lidas pelo app) e o payload extra que vem junto.
const CONTRATOS_COLS=['id_obra','nr_contrato_sop','codigo_obra','descricao_obra','descricao_tipo_contrato',
  'contratada','contratante','municipio','status_contrato','status_obra','data_assinatura','data_inicio_real',
  'valor_atual_contrato','valor_atual','valor_original','total_aditivo','total_reajuste','total_realinhado',
  'dias_paralisado','data_fim_previsto','distrito_operacional','nr_contrato_ext','nr_contrato_sic','nr_os',
  'prazo_execucao','prazo_vigencia_contrato',
  'data_fim_vigencia_contrato','cnpj_contratada','cnpj_contratante','atualizado_em'].join(',');
// prazo_execucao/prazo_vigencia_contrato: prazo ORIGINAL contratado em dias (aba
// Aditivos de prazo). nr_os: nº da ordem de serviço (bloco Detalhes do Resumo).
const COMISSAO_COLS='id_obra,nome_completo,nome_referencia,tipo,matricula,atualizado_em';
// aditivos_contrato/ficha_contrato não têm id_obra — a chave de junção com
// contratos_edificacao é nr_contrato_sop (texto, já denormalizado nas duas tabelas,
// evita depender de ficha_contrato.id_contrato pra cruzar com aditivos_contrato).
// data_publicacao é a data que a coluna "Publicação" das tabelas de aditivos mostra
// (antes ela exibia data_assinatura por engano — 92% dos aditivos têm as duas datas
// diferentes). observacao é a descrição textual do aditivo, exibida como linha de
// apoio nas tabelas. data_protocolo existe na tabela mas ainda não é exibida.
const ADITIVOS_COLS='nr_contrato_sop,nr_aditivo,tipo_aditivo,observacao,valor_aprovado,valor_supressao,valor_repercussao,execucao_aprovado,prazo_aprovado,nr_protocolo,data_assinatura,data_publicacao';
// ficha_contrato é NÍVEL CONTRATO (1 linha por nr_contrato_sop, agrega todas as obras).
// valor_original/valor_atual entram para o "contexto do contrato" nos contratos multi-obra.
const FICHA_COLS='nr_contrato_sop,total_medido,percentual_total_medido,valor_original,valor_atual';
// medicoes: junção por id_obra (como comissao_fiscalizacao). Alimenta a tabela mensal
// da aba Medições e a curva "Evolução da medição" do Resumo.
// Colunas de valor (todas POR PERÍODO, não acumuladas): `valor_medido` = bruto medido;
// `valor_ref_glosa` = glosa do período; `total` = LÍQUIDO (bruto − glosa − retenções).
// O "total medido" e a curva usam `total` (líquido); a tabela mostra os 3.
// A situação da medição é sigla_status_medicao (a coluna "status" não existe — o SELECT
// com ela fazia o PostgREST devolver 400 e a aba Medições/curva ficavam sempre vazias).
const MEDICOES_COLS='id_obra,periodo,nr_medicao,valor_medido,valor_ref_glosa,valor_atual,nr_protocolo,total,sigla_status_medicao';
// eletrica_vistorias: metadados dos relatórios de vistoria elétrica (o arquivo em si
// fica no Google Drive — ver supabase/functions/eletrica-drive-token). excluido_em
// filtrado aqui (não é policy: soft delete, ver sql/create_eletrica_vistorias.sql).
const ELETRICA_COLS='id,id_obra,data_vistoria,responsavel_nome,observacao,arquivo_nome_original,drive_web_view_link,criado_em';
const SB_ELETRICA_AGENDA='eletrica_vistorias_agendadas'; // agendamento de vistoria (obra+data+responsável), pedido do usuário 24/09/2026
const ELETRICA_AGENDA_COLS='id,id_obra,data_planejada,responsavel_nome,criado_em';
// referência estática dos códigos de situação da medição (STM) exibida na aba
// Medições — só rótulos, não vem do banco (o modelo do usuário traz esta lista).
const STM_LEGENDA=[
  ['ABE','Aberta'],['ACR','Aguardando correção'],['AVA','Aguardando validação'],['APT','Aguardando protocolo'],
  ['AAS','Aguardando assinatura'],['AFI','Aguardando financeiro'],['ECD','Em conferência de docs.'],['FEC','Fechada'],
];
// carteira ativa = tudo que não é "concluído/encerrado" (ver statusBucket) — é o recorte
// que a SOP-CE de fato gerencia; os outros ~90% do histórico só aparecem sob demanda
// (toggle "Histórico completo"), porque não mudam mais e só diluiriam os KPIs/gráficos.
const ACTIVE_STATUSES=['Em Execução','Aguardando OS','Paralisada'];

// aba "Elétrica" (Fase 1) — só eletrica/admin veem o formulário de novo relatório
// (a trava real é a RLS de eletrica_vistorias, ver sql/create_eletrica_vistorias.sql;
// isso aqui só evita OFERECER o formulário a quem não pode gravar — mesmo espírito
// de PAPEIS_REPLAN, algumas linhas abaixo).
const PAPEIS_ELETRICA_ESCRITA=['eletrica','admin'];
// marcos de medição que disparam "atenção elétrica" (Q2 do grill de 24/09/2026):
// só informativo, não bloqueia nada, não exige exatamente 1 relatório por marco.
const MARCOS_ELETRICA=[50,70,90];

// ---- modo Replanilhamentos (E1) ----
// Fonte única: a view já resolve fila/despacho/data de despacho/fiscal/obra, para que
// este módulo e a quebra por distrito de modules/processos/processos.js nunca calculem
// a mesma coisa de dois jeitos (ver sql/create_vw_painel_desempenho_fiscais.sql).
// A view é restrita a admin/gerente NO BANCO: quem não tem papel recebe 0 linhas, não
// erro. A porta no front (PAPEIS_REPLAN) existe para não OFERECER o que o banco negaria.
const SB_PROCESSOS='vw_painel_desempenho_fiscais';
const PAPEIS_REPLAN=['admin','gerente'];
const PROCESSOS_COLS=['id','processo','status','status_exibicao','tipo','prioritario',
  'na_fila','situacao','despachado','data_despacho','tempo_fiscal_dias','aberto_ja_pronto',
  'dias_na_unidade','conferencia',
  'data_compromisso_fiscal','meta_estourada',
  'fiscal_matricula','fiscal_nome','fiscal_gedop','fiscal_gerencia','fiscal_cadastrado',
  'codigo_obra','descricao','obra_descricao','obra_municipio','obra_valor','obra_status',
  'contratada','contratante','analista','data_recebimento','reperc_fiscal','reperc_gecope',
  'ultima_atualizacao'].join(',');
// ---- mapa do modo Replanilhamentos (E2) ----
const RP_METRICA={
  tempo:{label:'Tempo médio de resposta'},
  desp:{label:'Despachos'},
  fila:{label:'Processos'},
};
const RP_PERIODO={'6m':{meses:6,txt:'últimos 6 meses'},'12m':{meses:12,txt:'últimos 12 meses'},
                  '24m':{meses:24,txt:'últimos 24 meses'},
                  // "Hoje" (antes "Tudo"): processos com o fiscal agora; despachos e tempo
                  // médio do histórico inteiro — pedido do usuário, 2026-09-16.
                  'hoje':{meses:null,txt:'todo o histórico'}};
// Duas réguas de amostra, e não uma (decisão do usuário, 2026-09-17).
//
// AMOSTRA_MIN é o piso para EXISTIR média: abaixo disto não há número em lugar nenhum —
// nem cor no mapa, nem KPI, nem linha no ranking. Era 5 até 2026-09-17, e com esse corte
// só 11 dos 58 fiscais apareciam no ranking: um painel que não respondia à pergunta que
// existe para responder. Baixado para 2 a pedido do usuário.
//
// AMOSTRA_SOLIDA é o piso para o número ser tratado como FIRME. Entre os dois, a média é
// mostrada mas marcada como fina — porque a dispersão DENTRO de um mesmo fiscal é enorme
// (a tira de despachos da janela mostra o mesmo fiscal indo de 24 a 338 dias), e com 2
// ou 3 casos um único processo travado decide o número. Sem a marca, alguém com 2
// despachos seria ordenado nominalmente ao lado de alguém com 30, na mesma lista, diante
// de um conselho deliberativo — e é isso que a barra vazada e o contador impedem.
const AMOSTRA_MIN=2;
const AMOSTRA_SOLIDA=5;
// Amostra que existe mas não é firme (ver acima): vale só onde uma PESSOA é nomeada.
function amostraFina(n){ return n>=AMOSTRA_MIN && n<AMOSTRA_SOLIDA; }
// janelinha do botão "i" dos KPIs (mostraRpTip). Declarada aqui, e não junto das funções,
// porque renderPanelReplan pode rodar antes de o script chegar lá.
let _rpTip=null, _rpTipAlvo=null;
// janelinha de identificação da bolinha do eixoDias() (mostraEdTip), mesma razão acima.
let _edTip=null, _edTipAlvo=null;

// monta o objeto que o app consome (obras entram depois, no loadData).
// O módulo opera exclusivamente por Distrito Operacional — os dados de "Região"
// (ce-referencia.json:REGIOES, ce-blocos.json:reg) continuam no disco, mas não
// são mais lidos pelo app.
const DB={distritos:DISTRITOS, municipios:{}};
for(const cod in MUN){ DB.municipios[cod]={nome:MUN[cod].nome, do:MUN[cod].do, obras:[], processos:[]}; }

// Escapa texto vindo do banco (contratos_edificacao/comissao_fiscalizacao) antes de
// injetar via innerHTML \u2014 p\u00e1gina p\u00fablica, sem login, ent\u00e3o qualquer HTML gravado
// nesses campos (objeto, contratada, contratante, fiscal, status etc.) executaria
// no navegador de qualquer visitante do Mapa de Obras.
function escHtml(s){ return String(s??'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function normTxt(s){return (s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z ]/g,' ').replace(/\s+/g,' ').trim();}
// normaliza mantendo digitos (necessario p/ diferenciar 1o/2o/3o membro)
function normTxtNum(s){return (s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
// classifica o "tipo" de um integrante da comissao num rotulo padronizado + rank.
// `rank` = ordem de EXIBI\u00c7\u00c3O na lista da comiss\u00e3o (protocolo: Fiscal, Presidente,
// 1\u00ba..4\u00ba Membro, Membro, Suplente). N\u00c3O define sozinho quem \u00e9 o fiscal respons\u00e1vel \u2014
// isso \u00e9 pickFiscal() (Fiscal, sen\u00e3o 1\u00ba Membro).
function classifyComissao(tipoRaw){
  const t=normTxtNum(tipoRaw);
  // SUPLENTE primeiro: "1\u00ba Suplente" cont\u00e9m "1" (viraria 1\u00ba Membro) e "Fiscal
  // Suplente" cont\u00e9m "FISCAL" (viraria titular).
  if(t.includes('SUPLENTE')) return {label:'SUPLENTE', rank:0};
  if(t.includes('FISCAL')) return {label:'FISCAL', rank:7};
  if(t.includes('PRESIDENTE')) return {label:'PRESIDENTE', rank:6};
  if(t.includes('1') || t.includes('PRIMEIRO')) return {label:'1\u00ba MEMBRO', rank:5};
  if(t.includes('2') || t.includes('SEGUNDO')) return {label:'2\u00ba MEMBRO', rank:4};
  if(t.includes('3') || t.includes('TERCEIRO')) return {label:'3\u00ba MEMBRO', rank:3};
  if(t.includes('4') || t.includes('QUARTO')) return {label:'4\u00ba MEMBRO', rank:2};
  if(t.includes('MEMBRO')) return {label:'MEMBRO', rank:1};
  return {label: tipoRaw ? String(tipoRaw).toUpperCase() : 'MEMBRO', rank:-1};
}
// fiscal RESPONS\u00c1VEL: quem tem tipo "Fiscal"; sen\u00e3o o "1\u00ba Membro" (conselhos sem
// fiscal nomeado); sen\u00e3o o primeiro da lista (maior rank). Os demais s\u00e3o auxiliares \u2014
// continuam na lista completa da comiss\u00e3o.
function pickFiscal(com){
  if(!com || !com.length) return null;
  return com.find(m=>m.tipo==='FISCAL') || com.find(m=>m.tipo==='1\u00ba MEMBRO') || com[0];
}
// classificação da situação da obra em 4 estados fixos, cada um com cor reservada
// (nunca a mesma paleta usada nos distritos/regiões do mapa, para não confundir os dois canais de cor)
const STATUS_STATES=[
  {key:'exec', label:'Em execução',  color:TOKENS.statusExec},
  {key:'ok',   label:'Concluída/encerrada', color:TOKENS.statusOk},
  {key:'wait', label:'Aguardando OS', color:TOKENS.statusWait},
  {key:'stop', label:'Paralisada',   color:TOKENS.statusStop},
];
// .color é copiado de TOKENS no load; renderStatusChart() emite style="background:.."
// a partir daqui. Na troca de tema ao vivo, repaintTheme() chama isto pra re-derivar.
function syncStatusColors(){
  const m={exec:TOKENS.statusExec, ok:TOKENS.statusOk, wait:TOKENS.statusWait, stop:TOKENS.statusStop};
  STATUS_STATES.forEach(s=>{ s.color=m[s.key]; });
}
function statusBucket(rawStatus){
  const s=normTxt(rawStatus);
  if(s.includes('PARALIS')) return 'stop';
  if(s.includes('AGUARDANDO')) return 'wait';
  if(s.includes('ENCERRADO')||s.includes('CONCLU')) return 'ok';
  return 'exec';
}
function num(x){const n=parseFloat(x);return isFinite(n)?n:0;}
// Etapa C — buckets de filtro pré-computados por obra (uma vez, aqui e no loadData),
// para que passF() não recalcule nada por chamada (roda dezenas de milhares de vezes
// por frame de mapa). Faixas: limite inferior inclusivo, superior exclusivo (a faixa
// 75–100% inclui 100%; ">100%" é estritamente acima). Prazo: reusa prazoCalc.
function faixaValorBucket(v){ return v<1e6?'ate1m':v<5e6?'1a5m':v<20e6?'5a20m':'acima20m'; }
function prazoDateBucket(iniStr,fimStr){
  const c=prazoCalc(iniStr,fimStr);
  if(!c) return 'semdata';
  return c.overdue?'vencido':(c.remainingDays<=30?'avencer':'ok');
}
function medicaoBucket(pct){
  if(pct==null) return 'semficha';
  const x=num(pct);
  return x<25?'0a25':x<50?'25a50':x<75?'50a75':x<=100?'75a100':'acima100';
}
function mapRow(r){
  const ano=r.data_assinatura?+String(r.data_assinatura).slice(0,4):(r.data_inicio_real?+String(r.data_inicio_real).slice(0,4):null);
  // 1 contrato : N obras. contratos_edificacao tem 1 linha por OBRA. `valor` é o valor
  // DESTA obra (valor_atual → valor_original → só como último recurso o do contrato);
  // `valorContrato` (= valor_atual_contrato, igual em todas as obras do contrato) e
  // `nObras` são preenchidos no loadData. Métrica do mapa soma `valor` → sem contar o
  // contrato N vezes.
  const valor=num(r.valor_atual)||num(r.valor_original)||num(r.valor_atual_contrato);
  return {id_obra:r.id_obra, contrato:r.nr_contrato_sop||r.codigo_obra||('#'+r.id_obra), codigo_obra:r.codigo_obra||'',
    objeto:r.descricao_obra||'—', tipo:r.descricao_tipo_contrato||'', contratada:r.contratada||'—', contratante:r.contratante||'—',
    municipioTxt:r.municipio||'', status:r.status_contrato||r.status_obra||'—', statusObra:r.status_obra||'—', ano, valor,
    valorContrato:num(r.valor_atual_contrato)||valor, nObras:1, valorOriginalContrato:num(r.valor_original),
    valor_original:num(r.valor_original), aditivo:num(r.total_aditivo), reajuste:num(r.total_reajuste),
    realinhado:num(r.total_realinhado), paralisado:num(r.dias_paralisado),
    assinatura:r.data_assinatura||'', fim_prev:r.data_fim_previsto||'', fiscal:'—', raw:r,
    // buckets de filtro (Etapa C) — distrito e medição são preenchidos no loadData,
    // onde o código do município e o.ficha já são conhecidos.
    distrito:null, medicaoBucket:'semficha',
    faixaValorBucket:faixaValorBucket(valor),
    prazoExecBucket:prazoDateBucket(r.data_inicio_real,r.data_fim_previsto),
    vigenciaBucket:prazoDateBucket(r.data_inicio_real,r.data_fim_vigencia_contrato),
    paralisadaBucket:num(r.dias_paralisado)>0?'sim':'nao'};
}
// Busca uma tabela paginada. A 1ª página pede a contagem total via
// `Prefer: count=exact` (o servidor devolve em Content-Range: "0-999/N") — a partir
// daí as páginas restantes são conhecidas de antemão e disparadas todas em paralelo
// (Promise.all), em vez de um `while` sequencial esperando página a página.
async function fetchTable(tbl,{select='*',filter=''}={}){
  const qs=`select=${encodeURIComponent(select)}${filter?'&'+filter:''}`;
  // apikey continua sendo a chave anônima (exigida pelo PostgREST em toda chamada,
  // mesmo autenticada) — quem identifica o usuário pro RLS é o Authorization,
  // que agora é o token da sessão logada, não mais a chave anônima.
  const headers={apikey:SB_KEY, Authorization:'Bearer '+(SESSION_TOKEN||SB_KEY)};
  const PAGE=1000;
  const first=await fetch(`${SB_URL}/rest/v1/${tbl}?${qs}`,{headers:{...headers, Range:`0-${PAGE-1}`, Prefer:'count=exact'}});
  if(!first.ok) throw new Error('HTTP '+first.status+' em '+tbl+' — verifique URL/chave/RLS');
  const firstChunk=await first.json();
  const range=first.headers.get('content-range'); // "0-999/3577"
  const total=range && range.includes('/') ? parseInt(range.split('/')[1],10) : NaN;
  if(!isFinite(total)){ console.warn('Content-Range ausente/inválido em '+tbl+' — assumindo que a 1ª página já é a tabela inteira ('+firstChunk.length+' linhas). Se a tabela tiver mais que isso, os dados vêm truncados.'); return firstChunk; }
  if(firstChunk.length>=total) return firstChunk;
  const pageReqs=[];
  for(let from=PAGE; from<total; from+=PAGE){
    const to=Math.min(from+PAGE-1,total-1);
    pageReqs.push(fetch(`${SB_URL}/rest/v1/${tbl}?${qs}`,{headers:{...headers, Range:`${from}-${to}`}})
      .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' em '+tbl); return r.json(); }));
  }
  const rest=await Promise.all(pageReqs);
  return firstChunk.concat(...rest);
}
// monta o filtro `col=in.(...)` de uma query PostgREST. Valores de coluna texto
// (quote=true) vão entre aspas duplas, com qualquer aspa embutida escapada — sem
// isso, qualquer valor com vírgula/parêntese/aspa quebra a lista inteira (fetchTable
// lança, e o .catch em loadData desliga a aba pra TODOS os contratos do escopo, não
// só o de valor problemático). id_obra é numérico, não precisa — mesmo padrão já
// usado no filtro de status_obra em loadData().
function inListFilter(col,values,quote){
  if(!values||!values.length) return '';
  const list=quote ? values.map(v=>`"${String(v).replace(/"/g,'\\"')}"`).join(',') : values.join(',');
  return `${col}=in.(${list})`;
}
// id_obra -> comissão de fiscalização completa, ordenada pelo rank de EXIBIÇÃO de
// classifyComissao (Fiscal > Presidente > 1º..4º Membro > Membro > Suplente). Quem é
// o fiscal RESPONSÁVEL é decidido à parte por pickFiscal().
// idFilter restringe às obras já carregadas (só faz sentido na carteira ativa, onde a
// lista de ids cabe numa query — no histórico completo os ~350 ids estourariam a URL,
// então busca a tabela de comissão inteira, só com as colunas usadas).
async function fetchFiscais(idFilter){
  const filter=inListFilter('id_obra',idFilter,false);
  const rows=await fetchTable(SB_COMISSAO,{select:COMISSAO_COLS,filter}); const m={};
  const datasPorObra={};
  for(const r of rows){
    const data=String(r.atualizado_em||'').slice(0,10);
    if(data && (!datasPorObra[r.id_obra] || data>datasPorObra[r.id_obra])) datasPorObra[r.id_obra]=data;
  }
  for(const r of rows){
    const k=r.id_obra; if(k==null) continue;
    const data=String(r.atualizado_em||'').slice(0,10);
    if(datasPorObra[k] && data!==datasPorObra[k]) continue;
    const nome=r.nome_completo||r.nome_referencia; if(!nome) continue;
    const c=classifyComissao(r.tipo);
    (m[k]=m[k]||[]).push({nome, tipo:c.label, rank:c.rank, matricula:r.matricula||''});
  }
  for(const k in m) m[k].sort((a,b)=>b.rank-a.rank);
  return m;
}
// data em destaque na tabela de aditivos = publicação (fallback assinatura, hoje nunca
// necessário — nenhum aditivo tem data_publicacao nula). Um helper só pra não repetir
// a coalescência nos 3 pontos de render + no sort abaixo.
function adPubDate(a){ return a.data_publicacao||a.data_assinatura||''; }
// descrição textual do aditivo (observacao), com quebras/espaços colapsados — linha
// de apoio nas tabelas de aditivo. Vazio => a linha não é renderizada.
function adObs(a){ return String(a.observacao||'').replace(/\s+/g,' ').trim(); }
// a linha .{pfx}-obs opcional embaixo de cada linha das tabelas de aditivo (valor e
// prazo compartilham a marcação, só muda o prefixo da classe). escHtml: texto do banco.
function adObsRow(a,pfx){ const o=adObs(a); return o?`<div class="${pfx}-obs">${escHtml(o)}</div>`:''; }
// aviso de escopo obra × contrato (só aparece em contrato multi-obra). `msg` é o texto.
function advScopeNote(o,msg){ return (o.nObras||1)>1 ? `<div class="adv-scope-note">${msg}</div>` : ''; }
// nr_contrato_sop -> aditivos do contrato (ordenados pela data de PUBLICAÇÃO, mais
// recente primeiro — data_assinatura da base tem ruído, há registros com data futura;
// desempate por data_assinatura só pra deixar a ordem determinística).
// Mesma lógica de escopo que fetchFiscais: na carteira ativa filtra pelos contratos já
// carregados (cabe numa URL); no histórico completo busca a tabela inteira (~580 linhas).
async function fetchAditivos(nrFilter){
  const filter=inListFilter('nr_contrato_sop',nrFilter,true);
  const rows=await fetchTable(SB_ADITIVOS,{select:ADITIVOS_COLS,filter}); const m={};
  for(const r of rows){ const k=r.nr_contrato_sop; if(!k) continue; (m[k]=m[k]||[]).push(r); }
  for(const k in m) m[k].sort((a,b)=>
    adPubDate(b).localeCompare(adPubDate(a))
    || (b.data_assinatura||'').localeCompare(a.data_assinatura||''));
  return m;
}
// nr_contrato_sop -> ficha do contrato (só os 2 totais de medição já calculados
// upstream pelo SIGSOP — total_medido/percentual_total_medido, ver aba Medições do modal).
async function fetchFichas(nrFilter){
  const filter=inListFilter('nr_contrato_sop',nrFilter,true);
  const rows=await fetchTable(SB_FICHA,{select:FICHA_COLS,filter}); const m={};
  for(const r of rows){ if(r.nr_contrato_sop) m[r.nr_contrato_sop]=r; }
  return m;
}
// id_obra -> lista de medições (para a curva "Evolução da medição" do Resumo).
// Ordena por nr_medicao (as medições são sequenciais); periodo é só rótulo do eixo.
async function fetchMedicoes(idFilter){
  const filter=inListFilter('id_obra',idFilter,false);
  const rows=await fetchTable(SB_MEDICOES,{select:MEDICOES_COLS,filter}); const m={};
  for(const r of rows){ const k=r.id_obra; if(k==null) continue; (m[k]=m[k]||[]).push(r); }
  for(const k in m) m[k].sort((a,b)=>(num(a.nr_medicao)-num(b.nr_medicao)) || String(a.periodo||'').localeCompare(String(b.periodo||'')));
  return m;
}
// id_obra -> relatórios de vistoria elétrica (mais recente primeiro). Mesmo padrão de
// escopo de fetchFiscais/fetchMedicoes (idFilter só na carteira ativa).
async function fetchEletricaVistorias(idFilter){
  const filtroObra=inListFilter('id_obra',idFilter,false);
  const filter=(filtroObra?filtroObra+'&':'')+'excluido_em=is.null';
  const rows=await fetchTable(SB_ELETRICA,{select:ELETRICA_COLS,filter}); const m={};
  for(const r of rows){ const k=r.id_obra; if(k==null) continue; (m[k]=m[k]||[]).push(r); }
  for(const k in m) m[k].sort((a,b)=>String(b.data_vistoria||'').localeCompare(String(a.data_vistoria||'')));
  return m;
}
// agendamento de vistoria (id_obra -> agendamento ativo mais recente, ou undefined).
// Só 1 por obra é exibido mesmo que existisse mais de um ativo no banco (a UI evita
// criar 2, ver sql/create_eletrica_vistorias_agendadas.sql) — pega o mais recente.
async function fetchEletricaAgendamentos(idFilter){
  const filtroObra=inListFilter('id_obra',idFilter,false);
  const filter=(filtroObra?filtroObra+'&':'')+'excluido_em=is.null';
  const rows=await fetchTable(SB_ELETRICA_AGENDA,{select:ELETRICA_AGENDA_COLS,filter}); const m={};
  for(const r of rows){ const k=r.id_obra; if(k==null) continue; if(!m[k]||r.criado_em>m[k].criado_em) m[k]=r; }
  return m;
}
// `lastSync` é o maior `atualizado_em` dos contratos carregados (ver chamada em loadData),
// não o horário em que o navegador buscou os dados — "Base atualizada em" precisa refletir
// quando a BASE mudou de fato, não quando a página foi recarregada (antes usava
// `new Date()`, então mostrava "agora" mesmo em bases paradas há dias).
let _lastStatus=null; // últimos args — replay na troca de tema (o dot lê TOKENS.ng/amber inline)
// Último status do modo Obras, para a volta de Replanilhamentos. Capturado AQUI, a cada
// chamada, e não uma única vez na entrada do modo: uma loadData() (#btnScope, que fica
// escondido dentro do modo novo, ou uma carga já em andamento) pode terminar com o modo
// aberto, então um retrato congelado faria a volta para Obras exibir a contagem de
// contratos do escopo anterior.
// Declarado junto de _lastStatus de propósito — setStatus é chamada já na falha de carga
// do GeoJSON, antes de boa parte do arquivo ser avaliada.
let _statusObras=null;
// `replan` marca que o texto veio do modo Replanilhamentos.
function setStatus(txt,ok,lastSync,replan){
  _lastStatus={txt,ok,lastSync,replan:!!replan};
  if(!replan) _statusObras={txt,ok,lastSync,replan:false};
  const el=document.getElementById('connStatus');
  if(el){el.textContent=txt; const d=el.parentElement.querySelector('.d'); const dot=ok?TOKENS.ng:TOKENS.amber; d.style.background=dot; d.style.boxShadow='0 0 10px '+dot;}
  const b=document.querySelector('.badge');
  if(b){ b.classList.toggle('demo',!ok); const t=document.getElementById('badgeTxt'); if(t) t.textContent = ok?'Base de dados · ao vivo':'Erro de conexão'; }
  const syncEl=document.getElementById('syncTime');
  if(syncEl) syncEl.textContent = ok ? (lastSync ? fmtDateTimeBR(lastSync) : '—') : '— (falha na conexão)';
}
function showDataError(msg,titulo){
  document.body.classList.remove('boot-loading');
  setStatus('Erro ao carregar dados', false);
  const el=document.getElementById('dataError');
  if(el){
    const t=document.getElementById('dataErrorTitle'); if(t) t.textContent=titulo||'Não foi possível carregar os dados';
    const m=document.getElementById('dataErrorMsg'); if(m) m.textContent=msg;
    // sempre volta ao estado padrão (retry visível, link de login escondido) —
    // showLoginRequired() é quem inverte isso; sem este reset, um showDataError()
    // chamado depois de um showLoginRequired() herdaria o botão errado na tela.
    // Achado do rev-correcao (recheck): busca o botão na hora (document.getElementById),
    // igual aos outros elementos desta função — showDataError() já é chamado em L43
    // (falha ao carregar o GeoJSON), antes da constante de módulo _dataErrorRetryBtn
    // (declarada mais abaixo) existir; ler essa constante aqui lançava
    // ReferenceError (temporal dead zone) e mascarava o erro real de rede/geo.
    const retry=document.getElementById('dataErrorRetry'); if(retry) retry.style.display='';
    const link=document.getElementById('dataErrorLink'); if(link) link.style.display='none';
    el.hidden=false;
  }
}
const _dataErrorRetryBtn=document.getElementById('dataErrorRetry');
if(_dataErrorRetryBtn) _dataErrorRetryBtn.onclick=()=>location.reload();

// Achado do rev-produto (Fase 2): "Não foi possível carregar os dados" +
// "Tentar novamente" é enganoso pra quem simplesmente não está logado —
// soa como falha técnica, e recarregar não resolve nada sem sessão. Título
// e botão próprios: some o "Tentar novamente" (não ajuda aqui) e mostra o
// link de verdade pro Painel Principal.
function showLoginRequired(msg){
  showDataError(msg,'Entre no GECOPE para continuar');
  const retry=document.getElementById('dataErrorRetry'); if(retry) retry.style.display='none';
  const link=document.getElementById('dataErrorLink'); if(link) link.style.display='inline-block';
}

// cache (sessionStorage) para não refazer o fetch inteiro a cada F5. As bases de
// origem mudam no máximo 1x por dia (carga manual/mensal — ver docs/auditoria-egress-
// 2026-09.md, item 9), então 5min era bem mais curto do que precisava: toda sessão que
// passasse desse tempo — inclusive só de alguém deixando a aba aberta numa
// apresentação — refazia as 5 consultas inteiras. 1h ainda mostra "Base atualizada em"
// no cabeçalho (então a defasagem fica visível) e o botão "Atualizar dados" ao lado do
// alternador de escopo força uma recarga a qualquer momento, ignorando o cache.
const CACHE_TTL_MS=60*60*1000;
// Etapa B: o formato do cache ganhou `medic` (v3 — curva de medição do Resumo) e,
// depois, mais colunas em cada linha de `medic` (v4 — nr_protocolo/total/status pra
// a tabela mensal da aba Medições). v5: cada linha de `adit` ganhou data_publicacao.
// v6: `medic` voltou a ser preenchido de verdade (o SELECT pedia a coluna inexistente
// `status`; agora é `sigla_status_medicao`) — caches v5 guardaram `medic:{}`.
// v7: `rows` ganhou nr_os/prazo_execucao/prazo_vigencia_contrato e `fisc` ganhou
// matricula por integrante. v8: cada linha de `adit` ganhou observacao. v9: cada linha
// de `ficha` ganhou valor_original/valor_atual (contexto do contrato, multi-obra).
// v10: cada linha de `medic` ganhou valor_ref_glosa (glosa por período).
// v11: novo campo `vist` (relatórios de vistoria elétrica, aba "Elétrica" — Fase 1).
// v12: novo campo `agend` (agendamento de vistoria por obra, continuação da Fase 1).
// O bump de versão garante que um objeto de formato antigo nunca seja reidratado como
// se fosse completo.
function cacheKey(scope){ return 'gecope_mapa_cache_v12_'+scope; }
function readCache(scope){
  try{
    const raw=sessionStorage.getItem(cacheKey(scope)); if(!raw) return null;
    const obj=JSON.parse(raw);
    if(!obj || (Date.now()-obj.ts)>CACHE_TTL_MS) return null;
    return obj;
  }catch{ return null; }
}
function writeCache(scope,rows,fisc,adit,ficha,medic,vist,agend){
  try{ sessionStorage.setItem(cacheKey(scope), JSON.stringify({ts:Date.now(),rows,fisc,adit,ficha,medic,vist,agend})); }
  catch(e){ /* quota/privacidade — cache é só um bônus de velocidade, ignora e segue sem ele */ }
}

async function loadData(){
  // Achado do rev-seguranca (Fase 2): esta é a única checagem que vale — o gate no
  // fim do arquivo é só o caminho "normal" de entrada, mas #btnScope (Carteira
  // ativa/Histórico completo) chama loadData() direto, síncrono, sem esperar o
  // gate resolver. Sem este `return` aqui, uma pessoa sem sessão clicando bem
  // cedo (ou um script automatizado) rodaria loadData() com SESSION_TOKEN ainda
  // null, caindo no fallback da chave anônima em fetchTable() — reabrindo
  // exatamente o buraco que esta fase existe para fechar.
  if(!SESSION_TOKEN){ showLoginRequired('Faça login no GECOPE para consultar o módulo de Contratos.'); return; }
  for(const c in DB.municipios) DB.municipios[c].obras=[];
  invalidateAggCache(); // sem isso, um hover no mapa durante o fetch devolveria contagens da era de filtro anterior
  try{
    const scope=st.dataScope;
    const cached=readCache(scope);
    let rows, fisc, adit, ficha, medic, vist, agend;
    if(cached){
      rows=cached.rows; fisc=cached.fisc; adit=cached.adit||{}; ficha=cached.ficha||{}; medic=cached.medic||{}; vist=cached.vist||{}; agend=cached.agend||{};
    } else if(scope==='ativa'){
      // carteira ativa: filtra no servidor (só ~348 linhas) e, com os ids/números já em
      // mãos, busca comissão/aditivos/ficha/medições/vistorias elétricas/agendamentos só
      // desses contratos — evita baixar as tabelas inteiras quando 90% delas são de obras
      // já encerradas, fora da carteira ativa.
      const filter=`status_obra=in.(${ACTIVE_STATUSES.map(s=>`"${s}"`).join(',')})`;
      rows=await fetchTable(SB_TABLE,{select:CONTRATOS_COLS,filter});
      const ids=[...new Set(rows.map(r=>r.id_obra).filter(v=>v!=null))];
      const nrs=[...new Set(rows.map(r=>r.nr_contrato_sop).filter(Boolean))];
      [fisc,adit,ficha,medic,vist,agend]=await Promise.all([
        fetchFiscais(ids).catch(e=>{ console.warn('comissao_fiscalizacao indisponível:',e.message); return {}; }),
        fetchAditivos(nrs).catch(e=>{ console.warn('aditivos_contrato indisponível:',e.message); return {}; }),
        fetchFichas(nrs).catch(e=>{ console.warn('ficha_contrato indisponível:',e.message); return {}; }),
        fetchMedicoes(ids).catch(e=>{ console.warn('medicoes indisponível:',e.message); return {}; }),
        fetchEletricaVistorias(ids).catch(e=>{ console.warn('eletrica_vistorias indisponível:',e.message); return {}; }),
        fetchEletricaAgendamentos(ids).catch(e=>{ console.warn('eletrica_vistorias_agendadas indisponível:',e.message); return {}; }),
      ]);
      writeCache(scope,rows,fisc,adit,ficha,medic,vist,agend);
    } else {
      // histórico completo: os ids/números não cabem numa query in.(...), então busca
      // as tabelas inteiras (só com as colunas usadas) em paralelo.
      const [rowsR,fiscR,aditR,fichaR,medicR,vistR,agendR]=await Promise.all([
        fetchTable(SB_TABLE,{select:CONTRATOS_COLS}),
        fetchFiscais().catch(e=>{ console.warn('comissao_fiscalizacao indisponível:',e.message); return {}; }),
        fetchAditivos().catch(e=>{ console.warn('aditivos_contrato indisponível:',e.message); return {}; }),
        fetchFichas().catch(e=>{ console.warn('ficha_contrato indisponível:',e.message); return {}; }),
        fetchMedicoes().catch(e=>{ console.warn('medicoes indisponível:',e.message); return {}; }),
        fetchEletricaVistorias().catch(e=>{ console.warn('eletrica_vistorias indisponível:',e.message); return {}; }),
        fetchEletricaAgendamentos().catch(e=>{ console.warn('eletrica_vistorias_agendadas indisponível:',e.message); return {}; }),
      ]);
      rows=rowsR; fisc=fiscR; adit=aditR; ficha=fichaR; medic=medicR; vist=vistR; agend=agendR;
      writeCache(scope,rows,fisc,adit,ficha,medic,vist,agend);
    }
    // 1 contrato : N obras — conta quantas obras de cada contrato estão CARREGADAS
    // (na carteira ativa é só as ativas; no histórico completo é todas). Só usado como
    // sinal "tem mais de uma obra" (multiObra), não como número exibido ao usuário.
    const obraCountBySop={};
    for(const r of rows){ const k=r.nr_contrato_sop; if(k) obraCountBySop[k]=(obraCountBySop[k]||0)+1; }
    let sem=0;
    for(const r of rows){ const cod=NAMEIDX[normTxt(r.municipio)]; if(!cod){sem++;continue;} const o=mapRow(r); const com=fisc[o.id_obra]||[]; o.comissao=com; const _fi=pickFiscal(com); o.fiscal=_fi?_fi.nome:'—'; o.fiscalTipo=_fi?_fi.tipo:'FISCAL';
      const nrKey=r.nr_contrato_sop; o.aditivos=(nrKey&&adit[nrKey])||[]; o.ficha=(nrKey&&ficha[nrKey])||null;
      o.medicoes=medic[o.id_obra]||[];
      o.relatoriosEletrica=vist[o.id_obra]||[];
      o.agendamentoEletrica=agend[o.id_obra]||null;
      o.nObras=(nrKey&&obraCountBySop[nrKey])||1;
      // valor original DO CONTRATO: a ficha tem o valor real (1 linha por contrato,
      // agrega todas as obras). Sem ficha: obra única → o próprio valor_original;
      // multi-obra → valor_atual_contrato como piso (subestima o % do art. 125, o que é
      // conservador — não gera alarme falso). Nunca uma soma parcial das obras da carteira.
      o.valorOriginalContrato=num(o.ficha&&o.ficha.valor_original) || (o.nObras===1?o.valor_original:num(o.valorContrato)) || o.valor_original;
      // `o.aditivo` = total_aditivo DA OBRA (contratos_edificacao.total_aditivo é por obra —
      // obras diferentes do mesmo contrato têm valores diferentes). Só cai na Σ dos
      // aditivos do contrato quando é obra ÚNICA e o campo veio 0 mas o contrato tem
      // aditivo de valor (defasagem do SIGSOP) — os aditivos_contrato não separam por obra.
      if(o.nObras===1 && !num(r.total_aditivo) && o.aditivos.length)
        o.aditivo=o.aditivos.reduce((s,a)=>s+num(a.valor_repercussao),0);
      // buckets de filtro que dependem de dado só conhecido aqui (Etapa C)
      const _g=grpById(gidOf(cod)); o.distrito=_g?_g.nome:null;
      // filtro "Medição (% executado)" — NÍVEL OBRA (Σ das medições da obra ÷ valor da
      // obra), como o resto do modal; fallback na ficha só em contrato de obra única.
      o.medicaoBucket=medicaoBucket(medObraStats(o).pct);
      DB.municipios[cod].obras.push(o); }
    invalidateAggCache();
    const scopeTxt=scope==='ativa'?'carteira ativa':'histórico completo';
    // Comparação por string funciona porque `atualizado_em` vem do Postgres em ISO
    // (YYYY-MM-DD...), que ordena lexicograficamente igual a cronologicamente.
    let lastSync=null;
    for(const r of rows){ if(r.atualizado_em && (!lastSync || r.atualizado_em>lastSync)) lastSync=r.atualizado_em; }
    setStatus(`Base de dados · ${rows.length} contrato${rows.length===1?'':'s'}${sem?` (${sem} sem município no CE)`:''} · ${scopeTxt}`, true, lastSync);
    // #btnScope fica escondido no modo Replanilhamentos (body.modo-rp, CSS), mas uma
    // carga em andamento pode terminar já dentro do modo: o setStatus acima já atualizou
    // o retrato de Obras (_statusObras) para a volta, e aqui a linha de status volta a
    // falar do conjunto que está em foco.
    if(modoReplan()) atualizarStatusModo();
  }catch(e){
    console.error(e);
    showDataError('Não foi possível carregar os contratos: '+e.message);
    return;
  }
  document.body.classList.remove('boot-loading');
  fillFilters(); render(); refit(true);
}

/* ============================================================
   MODO REPLANILHAMENTOS — carga (E1)
   Os processos entram no MESMO índice geográfico das obras
   (DB.municipios[cod].processos), pelo município da obra — que a view garante
   em 100% dos casos, porque cai em processos.municipio quando a obra já encerrou
   e saiu de contratos_edificacao. Assim o modo novo herda de graça a navegação,
   os rótulos e o enquadramento que já existem.
   ============================================================ */
let PROCESSOS=[], _procCarregado=false, _procDiag=null;
// Processos por distrito, indexados nas duas chaves possíveis (String(gid) -> processos).
// Montados uma vez na carga. `_procPorObra` é a fonte do mapa e das janelas de detalhe
// (sempre pelo local da obra); `_procPorEquipe` (lotação do fiscal, gedop) sobrevive só
// para a coorte de fiscais da janela individual (coorteFiscais()), que nunca foi pelo
// local da obra — não é mais alternativa de régua do painel (removida em 2026-09-23).
let _procPorEquipe=new Map(), _procPorObra=new Map();
function modoReplan(){ return st.modo==='replanilhamentos'; }

// gedop (app_users) -> id do distrito no GeoJSON. Os 11 valores casam 1:1 com
// ce-referencia.json depois de normalizar acento e caixa; 'FORTALEZA' é a única
// exceção real (o mapa chama de 'RM Fortaleza'). De-para explícito em vez de
// heurística de prefixo: são 11 valores estáveis, e um casamento silenciosamente
// errado jogaria os fiscais de um distrito inteiro no balde errado.
const GEDOP_ALIAS={'FORTALEZA':'RM FORTALEZA'};
let _gedop2gid=null;
function gidDeGedop(gedop){
  if(!_gedop2gid){ _gedop2gid={}; groupsList().forEach(g=>{ _gedop2gid[normTxt(g.nome)]=g.id; }); }
  const k=normTxt(gedop||''); if(!k) return null;
  const alvo=GEDOP_ALIAS[k]||k;
  return _gedop2gid[alvo]!==undefined?_gedop2gid[alvo]:null;
}
function mapProcesso(r){
  const cod=r.obra_municipio?NAMEIDX[normTxt(r.obra_municipio)]:null;
  return {
    id:r.id, processo:r.processo||'—', status:r.status||'—',
    statusTxt:r.status_exibicao||r.status||'—',
    tipo:r.tipo||'', prioritario:!!r.prioritario,
    naFila:r.na_fila===true, despachado:r.despachado===true,
    // Arquivado no meio do trâmite (ARQUIVADO sem data de aprovação) não é despacho, nem
    // fila, nem GECOPE: fica fora das métricas. APROVADO sem data (erro de cadastro) e
    // processo sem linha na view de tempo (situacao nula) idem — contados na conferência.
    foraDoCiclo:r.situacao!=='em_tramitacao'&&r.situacao!=='despachado',
    situacao:r.situacao||'',
    dataDespacho:r.data_despacho||null,
    // Dias na unidade do fiscal no SUITE até a ida à GECOPE que resultou na aprovação, só
    // do fiscal que despachou (ver sql/create_vw_painel_desempenho_fiscais.sql). null é
    // dado ausente, não zero: aberto já pronto ou motivo em `conferencia`.
    tempoFiscal:r.tempo_fiscal_dias==null?null:num(r.tempo_fiscal_dias),
    abertoJaPronto:r.aberto_ja_pronto===true,
    conferencia:r.conferencia||'',
    // Processo na fila: dias desde a última entrada na unidade do fiscal no SUITE. null =
    // o status diz fila, mas o processo ainda tramita até a unidade do fiscal.
    diasNaUnidade:r.dias_na_unidade==null?null:num(r.dias_na_unidade),
    // Tri-estado preservado de propósito: a view devolve NULL quando o processo não tem
    // data_compromisso_fiscal, e NULL ("sem meta") é diferente de false ("dentro da
    // meta"). Colapsar os dois faria o denominador de "N além da meta" virar a fila
    // inteira e subestimar o atraso.
    metaEstourada:r.meta_estourada==null?null:r.meta_estourada===true,
    fiscalMat:r.fiscal_matricula||'', fiscalNome:r.fiscal_nome||'(sem fiscal)',
    fiscalCadastrado:r.fiscal_cadastrado===true,
    gedop:r.fiscal_gedop||'', gerencia:r.fiscal_gerencia||'', gid:gidDeGedop(r.fiscal_gedop),
    // Descrição da OBRA primeiro (padroniza pelo contrato); processo sem obra vigente em
    // contratos_edificacao (obra encerrada, saiu do sync — ver nota da view) cai para a
    // descrição do PRÓPRIO processo, cadastrada pelo fiscal — melhor que um cartão sem
    // nenhum texto. '—' só quando nenhuma das duas existe.
    codigo_obra:r.codigo_obra||'', objeto:r.obra_descricao||r.descricao||'—',
    municipioTxt:r.obra_municipio||'', municipioCod:cod||null,
    // obra já encerrada sai de contratos_edificacao, então 41% dos despachados não têm
    // valor. null (não 0) para que nenhuma média o conte como "obra de valor zero".
    valorObra:r.obra_valor==null?null:num(r.obra_valor),
    contratada:r.contratada||'—', contratante:r.contratante||'—',
    analista:r.analista||'', ultimaAtualizacao:r.ultima_atualizacao||null, raw:r
  };
}
// Maior `ultima_atualizacao` entre os processos carregados — mesmo papel que `lastSync`
// tem no modo Obras (linhas 572-574): "Base atualizada em" precisa refletir quando os
// DADOS mudaram de fato, não quando a página foi recarregada. `ultima_atualizacao` só é
// gravada em transição de status (ver vw_painel_desempenho_fiscais). NÃO usar
// `arquivado_check_em` pra isso — é o heartbeat de todo run do job `sincronizar-suite`
// (docs/painel-fiscais/etapa-1-revisao.md), sobrescrito com `now()` mesmo sem mudança
// real; mostraria sempre "agora", igual ao bug antigo do modo Obras (comentário acima,
// linha 407-408, antes de trocar pra `atualizado_em`).
let _procLastSync=null;
// Carrega uma vez por sessão de página. Não entra no cache de sessionStorage das obras:
// aquele é chaveado por escopo de carteira, que não existe aqui, e o volume é pequeno
// (algumas centenas de linhas) — não vale o risco de servir número velho num painel de
// desempenho.
async function loadProcessos(){
  if(_procCarregado) return {ok:true};
  if(!SESSION_TOKEN) return {ok:false,erro:'sem sessão'};
  const rows=await fetchTable(SB_PROCESSOS,{select:PROCESSOS_COLS});
  PROCESSOS=rows.map(mapProcesso);
  for(const p of PROCESSOS){ if(p.ultimaAtualizacao && (!_procLastSync || p.ultimaAtualizacao>_procLastSync)) _procLastSync=p.ultimaAtualizacao; }
  for(const c in DB.municipios) DB.municipios[c].processos=[];
  _procPorEquipe=new Map(); _procPorObra=new Map();
  const indexa=(m,gid,p)=>{ const k=String(gid); let a=m.get(k); if(!a){ a=[]; m.set(k,a); } a.push(p); };
  let semMunicipio=0, semGedop=0, gedopSemDistrito=0, comAmbos=0, divergencia=0, despSemData=0;
  let despSemTempo=0, abertosProntos=0, aprovSemData=0, semSituacao=0;
  for(const p of PROCESSOS){
    // Os dois ficam fora de todas as métricas (foraDoCiclo); contados para não sumirem calados.
    if(p.situacao==='aprovado_sem_data') aprovSemData++;
    if(!p.situacao) semSituacao++;
    // Sem data de despacho, o processo só entra no período "Hoje". Contado para que a
    // ausência apareça na conferência em vez de encolher os recortes em silêncio.
    if(p.despachado && !p.dataDespacho) despSemData++;
    // Despacho sem tempo conta nos despachos e fica fora da média: os dois motivos são
    // contados à parte, porque "aberto já pronto" é regra e o outro é caso a conferir.
    if(p.despachado && p.tempoFiscal==null){ if(p.abertoJaPronto) abertosProntos++; else despSemTempo++; }
    if(p.municipioCod) DB.municipios[p.municipioCod].processos.push(p); else semMunicipio++;
    // Dois motivos diferentes para não ter distrito do fiscal, contados à parte: fiscal
    // sem lotação preenchida, ou gedop grafado de um jeito que não casa com nenhum dos
    // 11 distritos. O segundo derruba um distrito inteiro e precisa ser distinguível.
    if(!p.gedop) semGedop++; else if(p.gid==null) gedopSemDistrito++;
    // Um processo tem DOIS distritos possíveis: o da obra (geografia, que o mapa usa) e
    // o do fiscal (gedop, que a leitura de desempenho pede). Medido aqui para que a
    // divergência seja um número conhecido e não uma surpresa no meio de uma reunião.
    p.gidObra = p.municipioCod ? gidOf(p.municipioCod) : null;
    if(p.gid!=null) indexa(_procPorEquipe,p.gid,p);
    if(p.gidObra!=null) indexa(_procPorObra,p.gidObra,p);
    if(p.gid!=null && p.gidObra!=null){
      comAmbos++;                                  // contado, não derivado por subtração:
      if(String(p.gid)!==String(p.gidObra)) divergencia++;  // as ausências se sobrepõem
    }
  }
  _procCarregado=true;
  _procDiag={total:PROCESSOS.length, semMunicipio, semGedop, gedopSemDistrito, comAmbos, divergencia, despSemData,
             despSemTempo, abertosProntos, aprovSemData, semSituacao};
  return {ok:true, ..._procDiag};
}

const BRL=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
// só pras abas Aditivos/Medições do modal (valores por contrato individual, onde
// centavos importam pra bater com o extrato oficial) — os KPIs do painel principal e
// os cards de obra continuam em BRL (sem casas decimais) de propósito: são somas de
// carteira/lista, ninguém confere centavo a centavo ali, e o número já é grande o
// bastante sem precisar de mais 3 caracteres de ruído.
const BRL2=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});
const NUM=new Intl.NumberFormat('pt-BR');
// os percentuais já existentes no app usam toFixed(0) (sem casa decimal, então sem
// separador nenhum) — as abas Aditivos/Medições do modal são o 1º lugar a mostrar
// 1 casa decimal de verdade, então precisam da vírgula pt-BR (Intl.NumberFormat
// seria mais robusto, mas pra 1 valor isolado o replace já resolve sem 3ª instância).
function fmtPct1(v){ return v.toFixed(1).replace('.',','); }
// valor em reais com sinal explícito só no negativo ("−R$ …"); positivo e zero sem
// prefixo. Usado onde o número pode ser negativo (repercussão de aditivo, total_aditivo
// líquido). O "−" é U+2212, como no resto do modal.
function signedBRL(n){ return (n<0?'−':'')+BRL2.format(Math.abs(n)); }

// Etapa D: nível inicial = 1 (11 Distritos Operacionais). O nível 0 ("Ceará
// inteiro" como bloco único) deixou de ser um destino navegável — o app nasce
// já dividido nos distritos e a animação de entrada termina neles.
const st={metric:'obras',level:1,group:null,city:null,hoverGroup:null,dataScope:'ativa',
  // E1 — 'obras' (comportamento de sempre) ou 'replanilhamentos'. Tudo que é específico
  // do modo novo fica atrás de modoReplan(); o modo Obras não enxerga nada disso.
  modo:'obras',
  // E2 — lente do mapa no modo Replanilhamentos. Todo processo conta para o distrito
  // onde fica a obra (município do processo) — nunca pela lotação do fiscal
  // (app_users.gedop): o seletor "Fiscal × Obra" que existia aqui foi removido em
  // 2026-09-23 a pedido do usuário, para a leitura do painel deixar de mudar de
  // significado conforme o controle. `_procPorEquipe` continua indexado (ver
  // loadProcessos) só para a coorte de fiscais da janela individual (coorteFiscais()),
  // que sempre foi pela lotação, nunca por esta lente.
  // E4 — `fiscal` é a matrícula escolhida no quadrante despachos × tempo (null = nenhuma).
  // Vive aqui, junto do resto da lente do modo novo, para que nenhum estado dele exista
  // fora de st. Sobrevive à volta a Obras (inerte: só o painel do modo novo a lê).
  // E6 — filtros do modo Replanilhamentos, sobre PROCESSOS: estado próprio (nunca `f`
  // abaixo, que é de contratos e fica intacto na troca de modo). Ver FILTER_DEFS_RP.
  rp:{metrica:'tempo', periodo:'6m', filtro:{q:'', situacao:new Set(), prazo:new Set()}},
  sel:null, // Ctrl+clique em vários distritos/municípios: {kind:'group'|'city', ids:Set}
  // Etapa C: chaves novas declaradas já como Set (as defs em FILTER_DEFS e a UI
  // entram no Bloco 2 — até lá ficam vazias e inertes).
  f:{ano:new Set(),status:new Set(),contratada:new Set(),contratante:new Set(),fiscal:new Set(),
     distrito:new Set(),municipio:new Set(),tipo:new Set(),faixaValor:new Set(),
     prazoExec:new Set(),vigencia:new Set(),paralisada:new Set(),medicao:new Set(),vistoria:new Set(),q:''}};

const METRIC={obras:{label:'Nº de obras',fmt:v=>NUM.format(v)},
              valor:{label:'Valor total',fmt:v=>BRL.format(v)},
              aditivo:{label:'Aditivos (R$)',fmt:v=>BRL.format(v)},
              eletrica:{label:'Obras em atenção elétrica',fmt:v=>NUM.format(v)}};
let BASE=TOKENS.mapBase; // re-derivado na troca de tema (repaintTheme)
const allIds=Object.keys(DB.municipios);
function groupsList(){return DB.distritos;}
function gidOf(id){return DB.municipios[id].do;}
function idsOfGroup(g){return allIds.filter(id=>String(gidOf(id))===String(g));}
function grpById(g){return groupsList().find(x=>String(x.id)===String(g));}

// Etapa C — passF orientado a dados: um laço sobre FILTER_DEFS em vez de um `if`
// cravado por campo. Cada def expõe `get(o)` → o valor de filtro daquela obra (string
// ou null); campos "de valores" (Contratada, Ano…) e "de categoria fixa" (Faixa de
// valor, Prazo…) usam o mesmo caminho — a diferença está só em como fillFilters()
// monta a lista de opções. A busca livre `q` continua um caso à parte.
function passF(o){const f=st.f;
  // cards do resumo "Atenção, Elétrica!" (eleFiltroCategoria, ver mais abaixo): mesmo
  // critério de CATEGORIA_TESTE em renderAtencaoEletrica(), aplicado aqui pra que o
  // clique no card recorte também o que o mapa pinta/soma — não só a listinha do
  // painel. Só entra em jogo na métrica Elétrica; 'atencao' representa o universo
  // inteiro (pedido do usuário, 24/09/2026 — antes o clique só filtrava a lista).
  if(st.metric==='eletrica' && eleFiltroCategoria && eleFiltroCategoria!=='atencao'){
    const rel=o.relatoriosEletrica||[];
    if(eleFiltroCategoria==='vistoriadas' && !rel.length) return false;
    if(eleFiltroCategoria==='avistoriar' && rel.length) return false;
    if(eleFiltroCategoria==='agendadas' && !(!rel.length && o.agendamentoEletrica)) return false;
  }
  for(let i=0;i<FILTER_DEFS.length;i++){
    const d=FILTER_DEFS[i], set=f[d.key];
    if(set && set.size){ const v=d.get(o); if(v==null || !set.has(v)) return false; }
  }
  if(f.q){
    // busca livre em TODOS os campos textuais da obra; ";" separa termos com lógica OU
    // (ex.: "ROBERTO BRINGEL; VIRNA" traz as obras de qualquer um dos dois fiscais).
    const terms=f.q.split(';').map(t=>t.trim().toLowerCase()).filter(Boolean);
    if(terms.length){
      const campos=[o.objeto,o.municipioTxt,o.fiscal,o.contratada,o.contratante,
        o.ano!=null?String(o.ano):'',o.statusObra,o.contrato,o.codigo_obra];
      const hit=terms.some(t=>campos.some(c=>String(c||'').toLowerCase().includes(t)));
      if(!hit) return false;
    }
  }
  return true;
}
// PERFORMANCE: obrasOf() é chamada dezenas de milhares de vezes por frame de pan/zoom
// do mapa (declutter de rótulos ordena por prioridade chamando-a pra cada item, várias
// vezes por sort) — sem memoização, cada chamada refiltra o array de obras do zero.
// O cache vale por uma "época" de filtro: qualquer mudança em st.f (busca, checkbox)
// ou recarga de dados (loadData) chama invalidateAggCache(), que só zera o Map — o
// próximo obrasOf(id) recalcula e guarda de novo. Município tem no máximo algumas
// dezenas de obras, então o custo de popular o cache inteiro é desprezível.
let _obrasOfCache=new Map();
// _atencaoEletricaDirty acompanha o mesmo evento que zera _obrasOfCache (dado de obra
// mudou) — reaproveitado por renderAtencaoEletrica() pra não recalcular a cada hover
// de distrito no mapa (setKPIs()/renderPanel() rodam nisso, e o resultado da Fase 1
// não depende do hover: é a carteira inteira, ver obrasComAtencaoEletrica()).
let _atencaoEletricaDirty=true;
function invalidateAggCache(){ _obrasOfCache=new Map(); _atencaoEletricaDirty=true; }
// como invalidateAggCache(), mas também descarta o cache de sessionStorage (ver
// CACHE_TTL_MS/cacheKey) — necessário sempre que uma mutação grava no banco por fora
// do fluxo normal de loadData() (agendar/cancelar vistoria, excluir/enviar relatório).
// Sem isto, um F5 dentro da 1h de TTL reidrata o dado velho (ex.: agendamento já
// cancelado reaparece com o checkbox habilitado de novo) e reabre a duplicidade que a
// UI deveria evitar.
function invalidateSessionCache(){
  invalidateAggCache();
  try{ sessionStorage.removeItem(cacheKey(st.dataScope)); }catch(e){ /* privacidade/quota — segue sem cache mesmo */ }
}
function obrasOf(id){
  let hit=_obrasOfCache.get(id);
  if(hit===undefined){ hit=DB.municipios[id].obras.filter(passF); _obrasOfCache.set(id,hit); }
  return hit;
}
// obra "em atenção elétrica": mesma régua de obrasComAtencaoEletrica() (passou do
// primeiro marco de medição, 50%) — reaproveitada aqui pra métrica de mapa/painel
// poder contar isso por município sem duplicar o critério.
function obraEmAtencaoEletrica(o){const pct=medObraStats(o).pct;return pct!=null&&pct>=MARCOS_ELETRICA[0];}
function aggIds(ids){let obras=0,valor=0,valorOriginal=0,par=0,adit=0,eletrica=0;ids.forEach(id=>obrasOf(id).forEach(o=>{obras++;valor+=o.valor;valorOriginal+=o.valor_original;adit+=o.aditivo;if(statusBucket(o.statusObra)==='stop')par++;if(st.metric==='eletrica'&&obraEmAtencaoEletrica(o))eletrica++;}));return{obras,valor,valorOriginal,par,adit,eletrica};}
function mval(a){return st.metric==='valor'?a.valor:st.metric==='aditivo'?a.adit:st.metric==='eletrica'?a.eletrica:a.obras;}
// ---- recorte e período do modo Replanilhamentos (E2) ----
// Mesma aritmética de `current_date - interval 'N months'` do Postgres, que o diagnóstico
// SQL usa: o dia é limitado ao último dia do mês de destino (31/08 − 6 meses = 28/02). O
// Date.setMonth transbordaria para março, e o corte daqui divergiria do SQL justamente
// nos dias em que alguém confere os dois lado a lado.
function corteDespacho(meses){
  if(meses==null) return null;
  const h=new Date(); let y=h.getFullYear(), m=h.getMonth()-meses;
  y+=Math.floor(m/12); m=((m%12)+12)%12;
  const d=Math.min(h.getDate(), new Date(y,m+1,0).getDate());
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
// O distrito vale para a entidade DISTRITO (local da obra), em qualquer nível: a lista de
// irmãos da trilha ("Outros distritos") abre no nível 2 e continua listando distritos — se
// ela consultasse o nível, mostraria Crateús com 10 despachos logo depois de o mapa ter
// mostrado 12.
// E6: filtraRp() aqui dentro é o único lugar que precisa filtrar por distrito — quem lê
// por município (procsDeMuns) ganha o filtro do próprio ponto de leitura. As versões "Raw"
// (sem filtro) nasceram só para resultsSuffixRp() dizer "quantos de quantos" — desde
// 2026-09-22 também alimentam as janelas de detalhe (coorteDistritos(), refEstadoPeriodo(),
// abreModalDistrito()), que mostram o panorama completo do recorte escolhido, sem o filtro
// do painel lateral (mesmo princípio que já valia para procsEquipeDistrito nessas janelas,
// herdado da E5).
function procsDoDistritoRaw(gid){ return _procPorObra.get(String(gid))||[]; }
function procsDoDistrito(gid){ return filtraRp(procsDoDistritoRaw(gid)); }
function procsDeMunsRaw(ids){ const out=[]; ids.forEach(id=>{ for(const p of DB.municipios[id].processos) out.push(p); }); return out; }
function procsDeMuns(ids){ return filtraRp(procsDeMunsRaw(ids)); }
// Espelha scopeIds(), mas devolve PROCESSOS: o recorte de um distrito (pelo local da obra)
// não é um conjunto de municípios. No nível 1 sem destaque, o total é a soma dos 11
// distritos — assim o estado bate com a soma do que o mapa pinta, e o que fica de fora
// aparece na "Conferência da carga".
function procsDoRecorte(){
  if(st.sel && st.sel.ids.size){
    return st.sel.kind==='group' ? [...st.sel.ids].flatMap(procsDoDistrito) : procsDeMuns([...st.sel.ids]);
  }
  if(st.level===1 && st.hoverGroup!=null) return procsDoDistrito(st.hoverGroup);
  if(st.level<=1) return groupsList().flatMap(g=>procsDoDistrito(g.id));
  if(st.level===2) return procsDeMuns(idsOfGroup(st.group));
  return procsDeMuns([st.city]);
}
// Espelho exato de procsDoRecorte(), mas sem passar por filtraRp — só serve de
// denominador pra resultsSuffixRp() dizer "N de M processos com o filtro" (E6, achado do
// rev-produto: sem isso, nenhuma superfície do modo Replanilhamentos avisava que estava
// mostrando um subconjunto). Nunca use pra agregar KPI/mapa — só pra essa contagem.
function procsDoRecorteRaw(){
  if(st.sel && st.sel.ids.size){
    return st.sel.kind==='group' ? [...st.sel.ids].flatMap(procsDoDistritoRaw) : procsDeMunsRaw([...st.sel.ids]);
  }
  if(st.level===1 && st.hoverGroup!=null) return procsDoDistritoRaw(st.hoverGroup);
  if(st.level<=1) return groupsList().flatMap(g=>procsDoDistritoRaw(g.id));
  if(st.level===2) return procsDeMunsRaw(idsOfGroup(st.group));
  return procsDeMunsRaw([st.city]);
}
// Agregado de uma lista de processos. `tempoMedio` sai só dos despachados NO PERÍODO e
// COM tempo medido, e `nTempo` viaja junto de propósito: média de desempenho sem o tamanho
// da amostra ao lado convida à conclusão errada sobre uma pessoa.
// Fila, atraso e GECOPE são a posição de HOJE; despachos, tempo e fiscais obedecem ao
// período (em "Hoje" o corte é nulo = todo o histórico — ver corteDespacho).
// `procs` é o card PROCESSOS (usuário, 2026-09-21): SEMPRE a fila de hoje, fixo, qualquer
// que seja o período — não soma mais os despachados do período.
// `fiscais` (usuário, 2026-09-21) é só quem DESPACHOU dentro do período — não soma mais
// quem está na fila agora: misturar os dois escopos (posição de hoje + histórico do
// período) tornava o card confuso, já que ele deveria seguir a mesma régua de Despachos e
// Tempo médio, não a de Processos. `semMatricula` conta, dentro desse mesmo recorte, quem
// não entra por falta de matrícula.
function aggProc(procs){
  let total=0,fila=0,despTotal=0,desp=0,somaTempo=0,nTempo=0,metaEst=0,comMeta=0,semMatricula=0,naGecope=0;
  // Despachos do período SEM tempo medido, separados por motivo: "aberto já pronto" é
  // regra (menos de 1 dia com o fiscal) e o outro é caso a conferir. Contados aqui para
  // que a janela possa DIZER por que alguém com 4 despachos não tem média — sem isso o
  // painel só mostra o buraco (achado do usuário em 2026-09-17, olhando Fortaleza).
  let prontos=0,semTempo=0;
  const fiscais=new Set(), gecope=new Map(), filaPorStatus=new Map();
  const contaFiscal=p=>{ if(p.fiscalMat) fiscais.add(p.fiscalMat); else semMatricula++; };
  // data_despacho chega como 'AAAA-MM-DD' (coluna date): comparar texto é comparar data.
  // corte null = "Hoje", que para despachos, tempo e fiscais é o histórico inteiro.
  const corte=corteDespacho(RP_PERIODO[st.rp.periodo].meses);
  for(const p of procs){
    total++;
    if(p.naFila){ fila++;
      // meta_estourada é NULL quando não há data_compromisso_fiscal, e o cadastro zera
      // essa data ao sair de um status com meta. "N atrasados" só significa algo contra
      // o total que TEM prazo, não contra a fila inteira.
      if(p.metaEstourada!=null) comMeta++;
      if(p.metaEstourada) metaEst++;
      // Quebrado por status (statusTxt já traz "REANÁLISE FISCAL" no lugar do rótulo
      // longo do banco — mesma fonte da seção "GECOPE × Fiscalização", usuário 2026-09-17).
      const kf=String(p.statusTxt||'').trim().toUpperCase()||'—';
      filaPorStatus.set(kf,(filaPorStatus.get(kf)||0)+1);
    } else if(p.despachado){ despTotal++;
      if(corte==null || (!!p.dataDespacho && p.dataDespacho>=corte)){
        desp++;
        contaFiscal(p);
        if(p.tempoFiscal!=null){ somaTempo+=p.tempoFiscal; nTempo++; }
        else if(p.abertoJaPronto) prontos++;
        else semTempo++;
      }
    } else if(!p.foraDoCiclo){ naGecope++;
      // Nem com o fiscal nem despachado: está na GECOPE (Diligência, Em Análise, Aguar.
      // Aprovação…). Quebrado por status para a seção "Processos na GECOPE".
      const k=String(p.status||'').trim().toUpperCase()||'—';
      gecope.set(k,(gecope.get(k)||0)+1);
    }
  }
  return {total,fila,desp,despTotal,naGecope,gecope,filaPorStatus,
          // PROCESSOS é sempre a posição de HOJE (fila: Análise Fiscal + Devolvido p/
          // Reanálise Fiscal), qualquer que seja o período em Controles — pedido do
          // usuário (2026-09-21): antes, fora de "Hoje", somava os despachados do
          // período (fila+desp) e o card inflava conforme o período crescia. Tempo
          // médio, Despachos e Fiscais continuam seguindo o período normalmente.
          procs:fila, fiscais:fiscais.size, semMatricula,
          metaEst,comMeta,prontos,semTempo,
          tempoMedio:nTempo?somaTempo/nTempo:null, nTempo};
}
// Valor que o mapa pinta para um agregado. `v` null = sem número comparável (só acontece
// no tempo médio, com amostra abaixo de AMOSTRA_MIN) — pinta em cinza, fora da escala.
function rpValor(a){
  const m=st.rp.metrica;
  if(m==='fila') return {v:a.procs, n:a.procs};   // o mesmo número do card PROCESSOS
  if(m==='desp') return {v:a.desp, n:a.desp};
  return {v:a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null, n:a.nTempo};
}
function rpFmt(v){
  if(v==null) return '—';
  return st.rp.metrica==='tempo' ? fmtDias(v) : NUM.format(v);
}
// rótulo curto do mapa: cabe sob o nome do distrito sem empurrar o declutter.
// Abaixo de AMOSTRA_MIN, "sem dado" (pedido do usuário, 2026-09-16): a contagem de
// despachos no lugar dos dias parecia outra medida ao lado dos vizinhos. O número de
// despachos continua no hover e no ranking.
function rpFmtCurto(r){
  if(st.rp.metrica!=='tempo') return NUM.format(r.v);
  if(r.v==null) return 'sem dado';
  return `${Math.round(r.v)} d`;
}

// ---- mapa ----
// zoomSnap/zoomDelta fracionários (pedido do usuário, 24/09/2026 — "aumentar um
// pouco mais o zoom, mas sem deixar faltar parte na tela"): por padrão o Leaflet só
// pula entre zooms INTEIROS, então fitBounds() é obrigado a "arredondar pra baixo"
// sempre que o próximo nível inteiro estourasse o contêiner — sobrando uma margem
// enorme mesmo com padding pequeno. Com passos de 0,25 o mapa preenche o espaço
// disponível de verdade, continuando 100% dentro da área visível (fitBounds nunca
// corta nada, só escolhe o zoom — a garantia de "sempre inteiro" não muda).
const map=L.map('map',{zoomControl:false,attributionControl:false,minZoom:6,maxZoom:11,zoomSnap:0.25,zoomDelta:0.25});
L.control.zoom({position:'bottomright'}).addTo(map);
let layer,stateShape,fullBounds=null;
const HID={weight:0,opacity:0,fillOpacity:0};
function zt(){const z=(map&&map.getZoom)?map.getZoom():NaN; return isFinite(z)?Math.max(0,Math.min(1,(z-6)/4)):0;}  // 0 no estado inteiro, 1 aproximado
function gw(){return 1.0+0.9*zt();}                                 // espessura da divisa de bloco

function visible(id){
  if(st.level<=1) return false;
  if(st.level===2) return String(gidOf(id))===String(st.group);
  return id===st.city;
}
// intensidade coroplética do nível 2 (municípios dentro do distrito/região aberto):
// recalculado 1x por render() em vez de 1x por município, já que styleFeature() é
// chamado 184x por layer.setStyle() — ver render() logo abaixo. A mesma choroT()
// alimenta o nível 1 (ver groupStyle) — uma curva só, calibrada num lugar só.
let _levelMax=1;
// razão value/max, sempre em [0,1] — clamp nos dois lados (não só no topo) porque o
// valor de entrada vem de dado ao vivo (Supabase); um agregado negativo (ex.: métrica
// "aditivo" com reduções líquidas) não pode gerar fillOpacity fora do intervalo válido.
function choroT(value,max){ return Math.max(0,Math.min(1,value/max)); }
// Etapa C — "sem correspondência": só existe com filtro ativo. Município: 0 contratos
// que passam. Distrito: consulta _groupCountByGid (contagem já calculada 1x por
// render(), como _groupValByGid). Fora de filtro, sempre false — mapa idêntico ao de hoje.
let _groupCountByGid=new Map();
// Os filtros são de contratos: no modo Replanilhamentos não acinzentam nem travam área
// (seguem guardados em st.f para a volta a Obras).
function noMatchCity(id){ return !modoReplan() && hasActiveFilter() && aggIds([id]).obras===0; }
function noMatchGroup(gid){ return !modoReplan() && hasActiveFilter() && (_groupCountByGid.get(String(gid))||0)===0; }
const NOMATCH_STYLE=()=>({fillColor:TOKENS.nomatchFill,color:TOKENS.nomatchBorder,weight:0.5+0.4*zt(),fillOpacity:.16,opacity:.5});

// ---- pintura do modo Replanilhamentos (E2) ----
// Calculado 1x por render(), como _groupValByGid: groupStyle/styleFeature/declutter só
// consultam (declutter chama a prioridade dentro de um sort). Nível 1 = os 11 distritos
// pelo local da obra; níveis 2 e 3 = as cidades do distrito aberto, mesma régua.
// Cada entrada: {v, n, tot} — valor pintado (null = amostra insuficiente), amostra, e
// total de processos (prioridade de rótulo, estável entre métricas).
let _rpGrp=new Map(), _rpMun=new Map(), _rpMaxGrp=1, _rpMaxMun=1, _rpTemEscala=true;
function rpPreparaMapa(){
  _rpGrp=new Map(); _rpMun=new Map();
  // tot sem os fora do ciclo: cidade só com arquivados no trâmite não entra no ranking
  const entrada=procs=>{ const a=aggProc(procs); return {...rpValor(a), tot:a.fila+a.despTotal+a.naGecope}; };
  if(st.level<=1) groupsList().forEach(g=>_rpGrp.set(String(g.id), entrada(procsDoDistrito(g.id))));
  else idsOfGroup(st.level===2?st.group:gidOf(st.city)).forEach(id=>_rpMun.set(id, entrada(filtraRp(DB.municipios[id].processos))));
  const maxDe=m=>{ let x=0; m.forEach(r=>{ if(r.v!=null && r.v>x) x=r.v; }); return x>0?x:1; };
  _rpMaxGrp=maxDe(_rpGrp); _rpMaxMun=maxDe(_rpMun);
  // Existe escala quando ao menos uma área tem número comparável. Se NENHUMA tem, marcar
  // cada uma como exceção não informa nada — a legenda diz a frase inteira, e o mapa fica
  // uniforme em vez de todo tracejado.
  _rpTemEscala=[...(st.level<=1?_rpGrp:_rpMun).values()].some(r=>r.v!=null);
}
// Mesma cor e a mesma escala de opacidade do modo Obras (BASE + choroT com floor/span por
// tema), em toda métrica — o mapa não tem paleta própria (E11, 2026-09-21: usuário pediu
// pra tirar a rampa âmbar que a métrica Tempo tinha; ver --map-warm removido do CSS).
// Amostra insuficiente sai da escala (cinza, TOKENS.amostraFill).
function rpPreenche(r,max){
  if(!r || r.v==null) return {fillColor:TOKENS.amostraFill, fillOpacity:TOKENS.amostraOpacity};
  return {fillColor:BASE, fillOpacity:TOKENS.choroFloor+TOKENS.choroSpan*choroT(r.v,max)};
}
// Métrica com juízo de valor (mais lento = pior): ainda marca o ranking em âmbar (.rrow.warm/
// .rbar.amber) — só o MAPA parou de usar cor própria para isto (ver rpPreenche acima).
function rpTempo(){ return modoReplan() && st.rp.metrica==='tempo'; }
function rpTip(nome,r,onde){
  const m=st.rp.metrica, per=RP_PERIODO[st.rp.periodo].txt, n=r?r.n:0;
  const desp=`${NUM.format(n)} despacho${n===1?'':'s'}`;
  let sub;
  if(m==='fila') sub=rpQuandoProc();
  else if(m==='desp') sub=per;
  else if(r && r.v!=null) sub=`em ${desp} · ${per}`;
  else sub=`só ${desp} · ${per} — a média pede ao menos ${AMOSTRA_MIN}`;
  return `<b>${escHtml(nome)}</b><br>${RP_METRICA[m].label}: ${rpFmt(r?r.v:null)}`
    +`<span class="tip-sub">${escHtml(sub)}</span><span class="tip-sub">${escHtml(onde)}</span>`;
}
// Recorte de tempo da contagem de PROCESSOS: sempre "hoje", nunca o período de
// Controles — ver o comentário de `procs` em aggProc(). Despachos e Tempo médio usam
// RP_PERIODO[st.rp.periodo].txt diretamente, não esta função.
function rpQuandoProc(){ return 'hoje'; }
function rpOndeGrupo(){ return 'Contado pelas obras localizadas no distrito'; }
// "o que está sendo contado, e como" — uma frase só, usada pela legenda do mapa e pela
// lista de irmãos da trilha, para as duas nunca discordarem.
function rpRecorteTxt(porDistrito){
  const quando = st.rp.metrica==='fila' ? rpQuandoProc() : RP_PERIODO[st.rp.periodo].txt;
  const alvo = `${porDistrito?'distritos':'cidades'} pelo local da obra`;
  return `${quando} · ${alvo}`;
}
function styleFeature(f){
  const id=f.properties.id;
  if(!visible(id)) return HID;                    // níveis 0 e 1: municípios escondidos
  if(st.level===2){
    // município na seleção combinada (Ctrl+clique): destaque cheio, sobrepõe a
    // intensidade coroplética normal — precisa ser visualmente inconfundível com
    // "só tem muita obra" (que usa a mesma cor base, só mais opaca)
    if(st.sel&&st.sel.kind==='city'&&st.sel.ids.has(String(id))) return {fillColor:TOKENS.ng,color:TOKENS.mapLine,weight:1.6+0.8*zt(),fillOpacity:.78,opacity:1};
    if(modoReplan()) return {...rpPreenche(_rpMun.get(id),_rpMaxMun),color:TOKENS.mapOpenBorder,weight:0.5+0.7*zt(),opacity:.85};
    if(noMatchCity(id)) return NOMATCH_STYLE();   // Etapa C: filtro ativo, 0 contratos
    // preenchimento varia com a métrica atual (obra/valor/aditivo), não é mais
    // uma cor uniforme — um município com 0 obras e um com o máximo do distrito
    // não podem ser visualmente idênticos (achado da revisão final de design)
    const t=choroT(mval(aggIds([id])),_levelMax);
    return {fillColor:BASE,color:TOKENS.mapOpenBorder,weight:0.5+0.7*zt(),fillOpacity:TOKENS.choroFloor+TOKENS.choroSpan*t,opacity:.85};
  }
  if(noMatchCity(id)) return NOMATCH_STYLE();     // Etapa C: nível 3, cidade aberta sem resultado
  return {fillColor:TOKENS.mapOpenFill,color:TOKENS.mapLine,weight:1.0+1.0*zt(),fillOpacity:.85,opacity:1};  // cidade aberta (nível 3)
}
function applyInteractivity(){
  // Etapa C: polígono "sem correspondência" também fica inerte (não navegável).
  layer.eachLayer(l=>{ if(l._path){ const id=l.feature.properties.id; l._path.style.pointerEvents = (visible(id) && !noMatchCity(id))?'':'none';
    // E2: o tracejado de "sem amostra" é classe, não opção de estilo — `setStyle` do
    // Leaflet MESCLA opções, então um dashArray aplicado aqui ficaria preso no polígono
    // ao voltar para o modo Obras. A classe sai sozinha na próxima passada.
    l._path.classList.toggle('sem-amostra', semAmostraMun(id)); } });
}
// Cinza fora da escala: só existe no nível 2, onde as cidades são pintadas pela escala
// (no nível 3 a cidade aberta tem preenchimento cheio, como no modo Obras).
function semAmostraMun(id){
  if(!modoReplan() || st.level!==2 || !_rpTemEscala) return false;
  const r=_rpMun.get(id); return !!r && r.v==null;
}
function semAmostraGrp(gid){
  if(!modoReplan() || !_rpTemEscala) return false;
  const r=_rpGrp.get(String(gid)); return !!r && r.v==null;
}
const tip=L.tooltip({sticky:true,direction:'top'});
function tipHtml(id){
  // Etapa D: nível 0 removido — o app nunca fica no "Ceará inteiro".
  if(modoReplan()) return rpTip(DB.municipios[id].nome,_rpMun.get(id),'Contado pelas obras localizadas na cidade');
  if(st.level===1){const g=gidOf(id),gg=grpById(g);const v=mval(aggIds(idsOfGroup(g)));return `<b>${gg.nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`;}
  const v=mval(aggIds([id]));return `<b>${DB.municipios[id].nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`;
}
function onEach(f,l){
  l.on('mouseover',()=>{ const id=f.properties.id; if(!visible(id)||noMatchCity(id))return; l.setStyle({weight:1.8,color:TOKENS.mapLine}); l.bringToFront();
                         tip.setLatLng(l.getBounds().getCenter()).setContent(tipHtml(id)).addTo(map); });
  l.on('mouseout',()=>{ layer.resetStyle(l); tip.remove(); });
  l.on('click',e=>onClick(f.properties.id,e));
}
function onClick(id,e){
  if(!visible(id) || noMatchCity(id)) return;
  // Ctrl/Cmd+clique num município (nível 2, dentro de um distrito/região aberto)
  // soma à seleção combinada em vez de abrir aquele município sozinho
  if(st.level===2 && e && e.originalEvent && (e.originalEvent.ctrlKey||e.originalEvent.metaKey)){ toggleSelection('city',id); return; }
  if(st.level===1) goGroup(gidOf(id));       // Etapa D: nível 0 removido
  else if(st.level===2) goCity(id);
}

// ---- camada de blocos (Distritos Operacionais dissolvidos) ----
let groupLayer=null;
// intensidade coroplética do nível 1 quando há busca/filtro ativo — mesmo raciocínio
// de _levelMax (nível 2, ver styleFeature): recalculado 1x por render(), não 1x por
// grupo, já que groupStyle() roda uma vez por distrito a cada setStyle().
// _groupValByGid guarda o valor de cada grupo desse mesmo cálculo (Map gid->valor),
// pra groupStyle() só consultar em vez de rechamar idsOfGroup()+aggIds() por feature
// (achado da revisão: sem isso, cada grupo era agregado 2x por render() — aqui e
// dentro de groupStyle). Começa como Map vazio, nunca null: buildGroupLayer() também
// invoca groupStyle() por feature (no init), antes do próximo render() repopular o
// Map — .get() num Map vazio devolve undefined (cai no "||0" abaixo) em vez de
// estourar. Mesma folga existe no debounce de 150ms da busca/filtros (fSearch e
// os checkboxes, mais abaixo): entre a mudança e o render() que recalcula este Map,
// um hover/zoomend nesse intervalo lê o valor de ANTES da mudança — vazio, se nenhum
// filtro estava ativo ainda, ou a combinação anterior, se já havia um — nunca a nova.
// Aceito de propósito (efeito cosmético de até 150ms, autocorrige sozinho) em vez de
// complicar o cache pra fechar uma janela tão estreita.
let _levelMaxGroup=1, _groupValByGid=new Map();
function groupStyle(f){
  // distrito/região na seleção combinada (Ctrl+clique): mesmo destaque cheio usado
  // pra município selecionado no nível 2 — consistência visual entre os dois níveis
  if(f&&st.sel&&st.sel.kind==='group'&&st.sel.ids.has(String(f.properties.gid))) return {fillColor:TOKENS.ng,color:TOKENS.mapLine,weight:gw()+1.2,fillOpacity:.68,opacity:1};
  if(f&&modoReplan()) return {...rpPreenche(_rpGrp.get(String(f.properties.gid)),_rpMaxGrp),color:TOKENS.mapGroupBorder,weight:gw(),opacity:.9};
  if(f&&noMatchGroup(f.properties.gid)) return NOMATCH_STYLE(); // Etapa C: filtro ativo, distrito sem contratos
  // sem busca/filtro ativos: cor uniforme, como sempre foi — a própria divisão em
  // distritos/regiões já é a informação. Com filtro ativo, escala a opacidade pela
  // intensidade — mesma fórmula de styleFeature no nível 2 (floor + span·t, por tema),
  // pra responder visualmente "onde estão os resultados" sem precisar descer de nível.
  const fillOpacity=hasActiveFilter() ? TOKENS.choroFloor+TOKENS.choroSpan*choroT(_groupValByGid.get(String(f.properties.gid))||0,_levelMaxGroup) : .5;
  return {fillColor:BASE,color:TOKENS.mapGroupBorder,weight:gw(),fillOpacity,opacity:.9};
}
function groupHover(){return {fillColor:TOKENS.mapOpenFill,color:TOKENS.mapLine,weight:gw()+0.8,fillOpacity:.72};}
function onGroup(f,l){
  const gid=f.properties.gid;
  // Etapa C: distrito "sem correspondência" (filtro ativo, 0 contratos) não reage.
  const inert=()=>noMatchGroup(gid);
  // renderPanel() refaz KPIs + os 3 gráficos (inclui reconstruir o SVG do gráfico por
  // ano) — à toa se o painel lateral estiver recolhido e ninguém puder ver o resultado.
  // panelVisible() é compartilhada (perto de _mainEl/openAside, mais abaixo) em vez de
  // recriada a cada feature — buildGroupLayer() chama onGroup() ~11-14x por build.
  l.on('mouseover',()=>{ if(inert()) return; l.setStyle(groupHover()); l.bringToFront(); st.hoverGroup=gid; if(panelVisible()) renderPanel();
    // com filtro ativo, _groupValByGid já tem esse valor (calculado em render() logo
    // antes do groupLayer.setStyle() que acabou de rodar) — não recalcula à toa aqui.
    if(modoReplan()){
      tip.setLatLng(l.getBounds().getCenter()).setContent(rpTip(f.properties.nome,_rpGrp.get(String(gid)),rpOndeGrupo())).addTo(map);
      return;
    }
    const v=hasActiveFilter()?(_groupValByGid.get(String(gid))||0):mval(aggIds(idsOfGroup(gid)));
    tip.setLatLng(l.getBounds().getCenter()).setContent(`<b>${f.properties.nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`).addTo(map); });
  l.on('mouseout',()=>{ groupLayer.resetStyle(l); st.hoverGroup=null; if(panelVisible()) renderPanel(); tip.remove(); });
  // Ctrl/Cmd+clique num distrito/região soma à seleção combinada em vez de entrar nele
  l.on('click',e=>{ if(inert()) return;
    if(e.originalEvent&&(e.originalEvent.ctrlKey||e.originalEvent.metaKey)){ toggleSelection('group',gid); return; }
    // No modo Replanilhamentos o clique abre o PAINEL do distrito, não a lista de
    // municípios (usuário, 2026-09-17): descer para cidades é a pergunta da aba
    // Contratos — aqui a pergunta é como aquela equipe está indo. O caminho para as
    // cidades continua no ranking do painel lateral, que não mudou.
    if(modoReplan()){ abreModalDistrito(gid); return; }
    goGroup(gid); });
}
function buildGroupLayer(){ if(groupLayer) groupLayer.remove(); groupLayer=L.geoJSON(GRP.do,{style:groupStyle,onEachFeature:onGroup}); }

function boundsOfIds(ids){
  let b=null; const set=new Set(ids);
  layer.eachLayer(l=>{ if(set.has(l.feature.properties.id)){const lb=l.getBounds(); b=b?b.extend(lb):L.latLngBounds(lb.getSouthWest(),lb.getNorthEast());} });
  return b;
}
// Pedido do usuário (24/09/2026): o mapa deve entrar já carregado, sem a entrada
// animada de câmera que existia antes (flyToBounds afastado → aproximando, mais o
// fade/scale de #mapWrap em CSS). fitFull/fitGroup/fitCity usam fitBounds direto;
// `instant` (true nas chamadas de arranque/resize) some com o pequeno pan/zoom
// embutido do próprio Leaflet, que senão apareceria como "salto" nesses casos.
//
// largura extra à esquerda quando o painel Controles está aberto: ele fica por cima
// do mapa (position:absolute, não entra no grid de `main`), então sem compensar isso
// aqui o Leaflet centraliza a área TODA do #map — inclusive a faixa coberta pelo
// painel — e o mapa parece puxado pra direita (achado do usuário, Print 1). O Painel
// lateral (aside) não precisa do mesmo tratamento: é uma coluna própria do grid, então
// #map já nasce menor e fitBounds centraliza certo sozinho.
function ctrlOverlayWidth(){
  return (_ctrl && _ctrl.classList.contains('show')) ? _ctrl.getBoundingClientRect().width+28 : 0;
}
function fitPad(base){ return {paddingTopLeft:[base+ctrlOverlayWidth(),base], paddingBottomRight:[base,base]}; }
function fitFull(instant){
  if(!fullBounds) return;
  const o=fitPad(16); if(instant) o.animate=false;
  map.fitBounds(fullBounds,o);
  updateLabels();
}
function fitGroup(instant){ const b=boundsOfIds(idsOfGroup(st.group)); if(!b) return;
  const o={...fitPad(40),maxZoom:10}; if(instant) o.animate=false; map.fitBounds(b,o); }
function fitCity(instant){ const b=boundsOfIds([st.city]); if(!b) return;
  const o={...fitPad(60),maxZoom:11}; if(instant) o.animate=false; map.fitBounds(b,o); }

// navegação
// Etapa D: o nível 0 saiu; "voltar ao topo" (troca de escopo, breadcrumb raiz,
// reset da busca) leva ao nível 1. goState fica como alias de goSub para os
// pontos que ainda o chamam.
function goSub(){st.sel=null;st.level=1;st.group=null;st.city=null;st.hoverGroup=null;render();fitFull();}
function goState(){goSub();}
function goGroup(g){st.sel=null;st.group=g;st.level=2;st.city=null;st.hoverGroup=null;render();fitGroup();}
function goCity(id){st.sel=null;st.city=id;st.level=3;st.hoverGroup=null;render();fitCity();}

// ---- rótulos ----
// centroide "de área" (não a média dos vértices) — evita rótulo deslocado em
// polígonos irregulares/côncavos, onde a densidade de vértices não é uniforme.
function ringCentroid(ring){
  let a=0,cx=0,cy=0;
  for(let i=0;i<ring.length-1;i++){
    const x1=ring[i][0],y1=ring[i][1],x2=ring[i+1][0],y2=ring[i+1][1];
    const cross=x1*y2-x2*y1; a+=cross; cx+=(x1+x2)*cross; cy+=(y1+y2)*cross;
  }
  a/=2;
  if(Math.abs(a)<1e-12){let sx=0,sy=0,n=0;ring.forEach(p=>{sx+=p[0];sy+=p[1];n++;});return{area:0,cx:sx/n,cy:sy/n};}
  return{area:Math.abs(a),cx:cx/(6*a),cy:cy/(6*a)};
}
// em formas côncavas/finas (ex.: município em forma de "C" ou faixa estreita) o
// centroide de área pode cair fora do polígono, dentro do vizinho — por isso
// validamos com um teste ponto-em-polígono e caímos para alternativas mais seguras.
function pointInRing(pt,ring){
  let inside=false;
  for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const hit=((yi>pt[1])!==(yj>pt[1])) && (pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}
function bboxCenterOfRing(ring){
  let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
  ring.forEach(p=>{if(p[0]<minx)minx=p[0];if(p[0]>maxx)maxx=p[0];if(p[1]<miny)miny=p[1];if(p[1]>maxy)maxy=p[1];});
  return[(minx+maxx)/2,(miny+maxy)/2];
}
function vertexAvgOfRing(ring){
  let sx=0,sy=0,n=0; ring.forEach(p=>{sx+=p[0];sy+=p[1];n++;}); return[sx/n,sy/n];
}
// distância de um ponto a um segmento — usado para achar o ponto mais "afundado"
// dentro do polígono (pólo de inacessibilidade), última linha de defesa para
// formas em "C"/"U" onde nem o centroide, nem o bbox, nem a média de vértices caem dentro.
function pointToSegDist(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;
  let t=len2>0?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len2:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));
}
function poleOfInaccessibility(ring,gridN){
  let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
  ring.forEach(p=>{if(p[0]<minx)minx=p[0];if(p[0]>maxx)maxx=p[0];if(p[1]<miny)miny=p[1];if(p[1]>maxy)maxy=p[1];});
  let best=null,bestD=-1; const stepx=(maxx-minx)/gridN, stepy=(maxy-miny)/gridN;
  for(let gx=0;gx<=gridN;gx++)for(let gy=0;gy<=gridN;gy++){
    const pt=[minx+gx*stepx,miny+gy*stepy]; if(!pointInRing(pt,ring))continue;
    let d=Infinity; for(let k=0;k<ring.length-1;k++){const dd=pointToSegDist(pt,ring[k],ring[k+1]); if(dd<d)d=dd;}
    if(d>bestD){bestD=d;best=pt;}
  }
  return best;
}
function pickLabelPoint(ring,areaC){
  const candidates=[[areaC.cx,areaC.cy], bboxCenterOfRing(ring), vertexAvgOfRing(ring)];
  for(const c of candidates){ if(pointInRing(c,ring)) return c; }
  return poleOfInaccessibility(ring,40) || candidates[0];
}
function centroidOf(geom){
  const polys=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates;
  let best=null,bestRing=null;
  polys.forEach(poly=>{ const outer=poly[0]; if(!outer||outer.length<4)return;
    const c=ringCentroid(outer); if(!best||c.area>best.area){best=c;bestRing=outer;} });
  if(!best){let sx=0,sy=0,n=0;
    (geom.type==='Polygon'?geom.coordinates:geom.coordinates.flat()).forEach(r=>r.forEach(p=>{sx+=p[0];sy+=p[1];n++;}));
    return[sy/n,sx/n];}
  const[cx,cy]=pickLabelPoint(bestRing,best);
  return[cy,cx];
}
const munC={}; GEO.features.forEach(f=>munC[f.properties.id]=centroidOf(f.geometry));

// Etapa D: o rótulo "CEARÁ" (stateLbl) saiu junto com o nível 0.
let cityItems=[], groupItems=[];
let cityLbl,groupLbl;
function buildCityState(){
  cityItems=allIds.map(id=>({id,ll:L.latLng(munC[id]),nome:DB.municipios[id].nome,
    mk:L.marker(munC[id],{interactive:false,keyboard:false,icon:L.divIcon({className:'mun-label',iconSize:[0,0],
      html:`<div class="lbl"><div class="lbl-name">${DB.municipios[id].nome}</div><div class="lbl-count"></div></div>`})})}));
  cityLbl=L.layerGroup(cityItems.map(i=>i.mk));
}
// ajustes manuais pontuais de posição de rótulo [Δlat,Δlon], por nome já sem o
// prefixo "D.O." — ver comentário de uso mais abaixo.
const GRP_LABEL_NUDGE={'Aracoiaba':[0,0.10],'Sertão de Sobral':[0.10,0.10],'Maciço de Baturité':[-0.05,0.05],'Vale do Jaguaribe':[-0.05,0.05],'RM Fortaleza':[0.12,0]};
// nomes curtos o bastante pra caber numa linha só, mesmo com 2+ palavras — pedido
// pontual do usuário pra "Santa Quitéria" (a quebra em 2 linhas do shortGroupLabel()
// é pensada pra nomes longos tipo "Sertão de Sobral", não faz sentido aqui).
const GRP_LABEL_ONE_LINE=new Set(['Santa Quitéria']);
// nome completo (usado em breadcrumb/painel/tooltip) pode ser longo demais pra
// caber lado a lado no mapa — tira as preposições de ligação (de/da/do/dos/das)
// e quebra em até 2 linhas centralizadas. Ex.: "SERTÃO DE SOBRAL" -> "SERTÃO"/"SOBRAL".
function shortGroupLabel(nome){
  const compact=nome.replace(/\s+(de|da|do|dos|das)\s+/gi,' ').trim();
  const words=compact.split(/\s+/);
  if(words.length<=1 || GRP_LABEL_ONE_LINE.has(nome)) return {plain:compact, html:escHtml(compact)};
  const mid=Math.ceil(words.length/2);
  const l1=words.slice(0,mid).join(' '), l2=words.slice(mid).join(' ');
  return {plain:compact, html:`${escHtml(l1)}<br>${escHtml(l2)}`};
}
function rebuildGroupLabels(){
  if(groupLbl) groupLbl.remove();
  groupItems=[];
  // rótulo do distrito usa o mesmo centroidOf() (área + pólo de inacessibilidade
  // em formas côncavas) já usado pros municípios — aplicado à forma REAL dissolvida
  // do distrito (GRP), não a uma média simples dos centros dos municípios membros.
  // A média simples empurra o rótulo pro lado onde há mais municípios pequenos
  // agrupados, mesmo que a forma do distrito como um todo seja bem diferente disso
  // — daí rótulos nitidamente fora do centro visual em distritos irregulares.
  const feats=(GRP.do&&GRP.do.features)||[];
  groupsList().forEach(g=>{
    const ids=idsOfGroup(g.id); if(!ids.length)return;
    const feat=feats.find(f=>String(f.properties.gid)===String(g.id));
    let la,lo;
    if(feat){ [la,lo]=centroidOf(feat.geometry); }
    else{ const ms=ids.map(id=>munC[id]); la=ms.reduce((s,x)=>s+x[0],0)/ms.length; lo=ms.reduce((s,x)=>s+x[1],0)/ms.length; }
    const short=g.nome.replace(/^D\.O\.\s*/,'');
    // ajuste manual fino pontual (pedido do usuário) — centroidOf() acerta a
    // grande maioria, mas "certo matematicamente" e "parece bem posicionado pro
    // olho humano" nem sempre coincidem num polígono específico; em vez de
    // afinar o algoritmo geral só por causa de 1 caso, desloca só esse rótulo.
    if(GRP_LABEL_NUDGE[short]){ const [dLa,dLo]=GRP_LABEL_NUDGE[short]; la+=dLa; lo+=dLo; }
    // rótulo no mapa é só a versão curta/quebrada (sem preposição, em 2 linhas) —
    // breadcrumb, painel e tooltip continuam usando o nome oficial completo
    // (grpById/g.nome), essa abreviação existe só pra caber no mapa.
    const compact=shortGroupLabel(short);
    groupItems.push({id:g.id,ll:L.latLng([la,lo]),nome:compact.plain,
      mk:L.marker([la,lo],{interactive:false,keyboard:false,icon:L.divIcon({className:'grp-label',iconSize:[0,0],
        html:`<div class="lbl"><div class="lbl-name">${compact.html}</div><div class="lbl-count"></div></div>`})})});
  });
  groupLbl=L.layerGroup(groupItems.map(i=>i.mk));
}
function setLayer(l,on){ if(!l)return; if(on&&!map.hasLayer(l))l.addTo(map); else if(!on&&map.hasLayer(l))l.remove(); }
function declutter(items,fs,H,pad,filt,prioFn){
  const placed=[];
  const prio=prioFn||(it=>it.prio||0);
  const sorted=[...items].sort((a,b)=>prio(b)-prio(a));
  for(const it of sorted){
    const el=it.mk.getElement(); if(!el)continue;
    if(filt&&!filt(it)){el.style.display='none';continue;}
    // caixa de colisão vem do tamanho REAL do texto renderizado (getBoundingClientRect
    // do wrapper .lbl), não de "nº de caracteres × fator estimado". A estimativa por
    // caractere é sempre uma média — apertar o fator o bastante pra caber rótulos
    // curtos deixa rótulos longos (ex. "Serra da Ibiapaba"/"Sertão de Sobral", ambos
    // ~17 caracteres) subestimados o bastante pra colidir de verdade sem o algoritmo
    // perceber (achado do usuário). Precisa estar visível pra medir — por isso troca
    // pra '' antes de ler o rect, e só volta pra 'none' se realmente colidir.
    el.style.display='';
    const inner=el.querySelector('.lbl');
    const p=map.latLngToContainerPoint(it.ll);
    let w=it.nome.length*fs+pad, h=H; // fallback, só usado se .lbl não for encontrado
    if(inner){ const r=inner.getBoundingClientRect(); w=r.width+pad; h=r.height+2; }
    const bx={x1:p.x-w/2,y1:p.y-h/2,x2:p.x+w/2,y2:p.y+h/2};
    let hit=false; for(const q of placed){if(bx.x1<q.x2&&bx.x2>q.x1&&bx.y1<q.y2&&bx.y2>q.y1){hit=true;break;}}
    el.style.display=hit?'none':''; if(!hit)placed.push(bx);
  }
}
// tamanhos base dos rótulos do mapa (nome do distrito/município + contador de
// obras) — aumentados a pedido: legibilidade em tela de projeção importa mais
// aqui do que caber mais texto por rótulo. declutter() deriva a caixa de colisão
// de cada rótulo destes mesmos valores (ver chamadas em updateLabels()), então
// aumentar aqui não desalinha a lógica de "esconder rótulo que colide" — ela
// escala junto.
// são 11 Distritos Operacionais; a quebra em 2 linhas (shortGroupLabel) resolve o
// aperto de nomes longos sem sacrificar o tamanho da fonte (pedido: legível em
// projeção).
function lblFS(){const t=zt();return {grp:12+3.5*t, mun:10.5+3*t, st:32};}
function applyLabelSizes(){const s=lblFS(),r=document.documentElement.style;
  r.setProperty('--grpfs',s.grp.toFixed(1)+'px');r.setProperty('--munfs',s.mun.toFixed(1)+'px');r.setProperty('--stfs',s.st+'px');return s;}
function refreshMapCounts(){
  if(modoReplan()){
    // Só os valores preparados em rpPreparaMapa(); rótulo fora do recorte fica vazio (ele
    // está oculto pelo declutter de qualquer jeito, e a volta a Obras reescreve todos).
    const escreve=(it,r)=>{ const el=it.mk.getElement(); if(!el) return;
      const c=el.querySelector('.lbl-count'); if(c) c.textContent=r?rpFmtCurto(r):'';
      el.classList.remove('nomatch');
      // O rótulo fora da escala ("sem dado") não pode sair no verde de acento dos que
      // têm valor: é outra unidade e outro significado. Só ele muda de cor — o nome do
      // distrito continua legível, ao contrário do .nomatch, que apaga o rótulo inteiro.
      el.classList.toggle('sem-amostra', _rpTemEscala && !!r && r.v==null); };
    groupItems.forEach(it=>escreve(it,_rpGrp.get(String(it.id))));
    cityItems.forEach(it=>escreve(it,_rpMun.get(it.id)));
    return;
  }
  const filt=hasActiveFilter();
  groupItems.forEach(it=>{
    const el=it.mk.getElement(); const c=el&&el.querySelector('.lbl-count');
    const n=aggIds(idsOfGroup(it.id)).obras;
    if(c) c.textContent=NUM.format(n);
    // Etapa C: rótulo esmaecido — só onde o rótulo aparece (nível 1 para distrito).
    if(el){ el.classList.toggle('nomatch', filt && n===0 && st.level===1);
            el.classList.remove('sem-amostra'); }   // resíduo do modo Replanilhamentos
  });
  cityItems.forEach(it=>{
    const el=it.mk.getElement(); const c=el&&el.querySelector('.lbl-count');
    const n=obrasOf(it.id).length;
    if(c) c.textContent=NUM.format(n);
    if(el){ el.classList.toggle('nomatch', filt && n===0 && visible(it.id)); // só o município visível no nível 2/3
            el.classList.remove('sem-amostra'); }
  });
}
function updateLabels(){
  const s=applyLabelSizes();
  setLayer(groupLbl,st.level===1);
  setLayer(cityLbl,st.level>=2);
  refreshMapCounts();
  // prioridade por nº de obras: em colisão de rótulos, o município/distrito
  // mais relevante (ex.: Sobral) vence e permanece visível, em vez do primeiro
  // da lista por ordem arbitrária de id.
  // fs/pad um pouco mais enxutos que o "esperado" pro tamanho real da fonte: o
  // aumento de fonte pedido pelo usuário deixou a caixa de colisão estimada
  // grande o bastante pra esconder Quixeramobim (cercado por outros 5 distritos)
  // em janelas não-maximizadas — a fonte renderizada não muda, só a folga usada
  // pra decidir o que colide com o quê.
  // no modo Replanilhamentos a prioridade é o nº de processos, lido do mapa preparado.
  const rp=modoReplan();
  const prioG=rp ? it=>(_rpGrp.get(String(it.id))||{tot:0}).tot : it=>aggIds(idsOfGroup(it.id)).obras;
  const prioC=rp ? it=>(_rpMun.get(it.id)||{tot:0}).tot : it=>obrasOf(it.id).length;
  if(st.level===1) declutter(groupItems, s.grp*0.48, s.grp*2.2, 2, null, prioG);
  else if(st.level===2) declutter(cityItems, s.mun*0.6, s.mun*2.6, 7, it=>String(gidOf(it.id))===String(st.group), prioC);
  else if(st.level===3) declutter(cityItems, s.mun*0.6, s.mun*2.6, 7, it=>it.id===st.city, prioC);
}

// ---- painel ----
// resolve a seleção (Ctrl+clique) pra ids de município, que é a unidade que
// obrasOf()/aggIds() entendem — kind='group' guarda ids de distrito/região, então
// precisa "abrir" cada um; kind='city' já são ids de município, direto.
function selectionMunIds(){
  if(!st.sel || !st.sel.ids.size) return null;
  return st.sel.kind==='group' ? [...st.sel.ids].flatMap(idsOfGroup) : [...st.sel.ids];
}
function scopeIds(){
  const sel=selectionMunIds(); if(sel) return sel;
  if(st.level===1 && st.hoverGroup!=null) return idsOfGroup(st.hoverGroup);
  if(st.level<=1) return allIds;
  if(st.level===2) return idsOfGroup(st.group);
  return [st.city];
}
// Ctrl+clique em distrito/região (nível 1, kind='group') ou município dentro de
// um distrito aberto (nível 2, kind='city') soma/remove da seleção combinada.
// Clique normal em qualquer lugar (goState/goSub/goGroup/goCity) limpa a seleção —
// ela só existe "pausada" no nível onde foi criada.
function toggleSelection(kind,id){
  // gid de distrito/região é numérico no GeoJSON, mas o dataset do chip removível
  // (data-selid) sempre serializa pra string — sem normalizar aqui, tirar um chip
  // clicando nele faz Set.has(id) falhar (3 !== "3") e ADICIONA em vez de remover.
  id=String(id);
  if(!st.sel || st.sel.kind!==kind) st.sel={kind,ids:new Set()};
  if(st.sel.ids.has(id)) st.sel.ids.delete(id); else st.sel.ids.add(id);
  if(!st.sel.ids.size) st.sel=null;
  render();
  // sem flyToBounds aqui de propósito: cada Ctrl+clique já reenquadraria o mapa,
  // e enquanto o usuário ainda está compondo a seleção (clicando em vários lugares
  // em sequência) isso mais atrapalha do que ajuda — pedido do usuário.
}
function clearSelection(){ if(st.sel){ st.sel=null; render(); } }
function statusBreakdown(ids){
  const c={exec:0,ok:0,wait:0,stop:0}; let total=0;
  ids.forEach(id=>obrasOf(id).forEach(o=>{ c[statusBucket(o.statusObra)]++; total++; }));
  return {c,total};
}
function renderStatusChart(ids){
  const {c,total}=statusBreakdown(ids);
  const bar=document.getElementById('statBar'), leg=document.getElementById('statLeg');
  // A barra empilhada saiu (ajuste visual pedido: 3 mini-cards verticais); o
  // elemento #statBar continua no HTML só por compatibilidade, sempre vazio.
  if(bar) bar.innerHTML='';
  if(!leg) return;
  if(!total){ leg.innerHTML='<div class="empty" style="padding:2px 0">Sem obras neste recorte.</div>'; return; }
  leg.innerHTML=STATUS_STATES.filter(s=>c[s.key]>0).map(s=>{
    const pct=Math.round(c[s.key]/total*100);
    return `<div class="sit"><span class="dot" style="background:${s.color}"></span>`
      +`<span class="sit-l">${s.label}</span>`
      +`<span class="sit-v"><b>${NUM.format(c[s.key])}</b> <span class="sit-p">(${pct}%)</span></span></div>`;
  }).join('');
}
// barra de 2 segmentos (mesma linguagem visual da "Situação das obras" acima) comparando
// o valor original dos contratos com o total já incorporado em aditivos — pergunta que a
// cúpula faz na prática: "quanto do valor atual da carteira é aditivo, não orçamento original?"
function renderAditivoChart(ids){
  const wrap=document.getElementById('aditivoWrap');
  // sem sentido na métrica Elétrica (pedido do usuário, 24/09/2026): a comparação de
  // valor original vs. aditivos não tem relação com vistoria elétrica.
  if(wrap) wrap.hidden=st.metric==='eletrica';
  if(st.metric==='eletrica') return;
  const bar=document.getElementById('aditivoBar'), leg=document.getElementById('aditivoLeg');
  if(!bar||!leg) return;
  const a=aggIds(ids), total=a.valorOriginal+a.adit;
  if(!total){ bar.innerHTML=''; leg.innerHTML='<div class="empty" style="padding:2px 0">Sem valores neste recorte.</div>'; return; }
  const pctAditReal=a.adit/total*100, pctOrigReal=100-pctAditReal;
  // largura mínima visível pro segmento de aditivo quando ele existe mas é pequeno
  // (ex.: 2%) — mesmo tratamento que rankRows() já dá às barras de ranking
  // (Math.max(4,...)), senão o segmento fica fino a ponto de sumir visualmente e a
  // única informação real vira o texto da legenda, não o gráfico em si.
  const pctAdit=a.adit>0?Math.max(3,pctAditReal):0, pctOrig=100-pctAdit;
  bar.innerHTML=
    `<i style="width:${pctOrig}%;background:var(--ng-deep)" title="Valor original: ${BRL.format(a.valorOriginal)} (${pctOrigReal.toFixed(0)}%)"></i>`
    +(a.adit>0?`<i style="width:${pctAdit}%;background:var(--amber)" title="Aditivos: ${BRL.format(a.adit)} (${pctAditReal.toFixed(0)}%)"></i>`:'');
  leg.innerHTML=
    `<span class="sit"><span class="dot" style="background:var(--ng-deep)"></span>Original <b>${BRL.format(a.valorOriginal)}</b></span>`
    +(a.adit>0?`<span class="sit"><span class="dot" style="background:var(--amber)"></span>Aditivos <b>${BRL.format(a.adit)}</b> (${pctAditReal.toFixed(0)}%)</span>`:'');
}
const MESES_ABREV=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
// mini gráfico de barras (HTML/flex) — genérico: recebe pares [chave,label,contagem]
// já prontos e desenha, sem saber se é ano de contrato ou mês de vistoria. Barras em
// flex (não SVG com preserveAspectRatio="none", que esticava barras e rótulos): o
// painel tem largura fluida, então flex resolve a distribuição sozinho, o texto fica
// nítido em qualquer largura, e cada coluna ganha o valor acima da barra, um trilho
// de fundo e destaque quando é o pico. Altura mínima de 6% pra colunas baixas não
// sumirem.
function renderBarChart(host,cols,unidadeSingular,unidadePlural,ariaLabel){
  if(!cols.length){ host.innerHTML=`<div class="empty" style="padding:2px 0">Sem ${unidadePlural} neste recorte.</div>`; return; }
  const max=Math.max(...cols.map(c=>c[2]));
  const html=cols.map(([,label,n])=>{
    const pct=Math.max(6, n/max*100);
    const peak=n===max ? ' peak' : '';
    return `<div class="ycol${peak}" title="${label}: ${NUM.format(n)} ${n===1?unidadeSingular:unidadePlural}">`
      +`<div class="yval">${NUM.format(n)}</div>`
      +`<div class="ytrack"><div class="ybar" style="height:${pct.toFixed(1)}%"></div></div>`
      +`<div class="ylab">${label}</div></div>`;
  }).join('');
  host.innerHTML=`<div class="ychart" role="img" aria-label="${ariaLabel}">${html}</div>`;
}
// contagem de contratos por ano de assinatura no recorte atual — dá noção de
// safra/tendência que nenhum KPI isolado mostra. Na métrica Elétrica vira "Vistorias
// realizadas (mês a mês)" (pedido do usuário, 24/09/2026): o ano de assinatura não diz
// nada sobre o ritmo de vistorias, que é o que a equipe de elétrica quer acompanhar.
function renderYearChart(ids){
  const host=document.getElementById('yearChart'); if(!host) return;
  const titulo=document.getElementById('yearChartTitulo');
  if(st.metric==='eletrica'){
    if(titulo) titulo.textContent='Vistorias realizadas (mês a mês)';
    const counts={};
    ids.forEach(id=>obrasOf(id).forEach(o=>(o.relatoriosEletrica||[]).forEach(r=>{
      const m=String(r.data_vistoria||'').slice(0,7); // 'YYYY-MM'
      if(m.length===7) counts[m]=(counts[m]||0)+1;
    })));
    const meses=Object.keys(counts).sort();
    const cols=meses.map(m=>[m, MESES_ABREV[+m.slice(5,7)-1]+'/'+m.slice(2,4), counts[m]]);
    renderBarChart(host,cols,'vistoria','vistorias','Vistorias realizadas por mês');
    return;
  }
  if(titulo) titulo.textContent='Contratos por ano de assinatura';
  const counts={};
  ids.forEach(id=>obrasOf(id).forEach(o=>{ if(o.ano) counts[o.ano]=(counts[o.ano]||0)+1; }));
  const anos=Object.keys(counts).map(Number).sort((a,b)=>a-b);
  const cols=anos.map(a=>[a, '’'+String(a).slice(2), counts[a]]);
  renderBarChart(host,cols,'contrato','contratos','Contratos por ano de assinatura');
}
function setKPIs(){
  const ids=scopeIds(); const a=aggIds(ids);
  kObras.textContent=NUM.format(a.obras); kValor.textContent=BRL.format(a.valor); kPar.textContent=NUM.format(a.par);
  kMedio.textContent=a.obras?BRL.format(a.valor/a.obras):'—';
  kMun.textContent=NUM.format(ids.filter(id=>obrasOf(id).length>0).length);
  kAdit.textContent=BRL.format(a.adit);
  renderStatusChart(ids);
  renderAditivoChart(ids);
  renderYearChart(ids);
  renderAtencaoEletrica();
}
// Fase 1 da aba "Elétrica" — obras que passaram de 50/70/90% de medição (Q2 do grill
// de 24/09/2026). Olha TODA a carteira carregada, não o recorte de filtro do painel:
// é um alerta do módulo inteiro pra equipe se planejar, não do que está em foco no
// mapa agora. Só informativo (Q10): nenhum julgamento de "pendente", nenhuma
// exigência de 1 relatório por marco — expõe o dado bruto (marco + quantos
// relatórios + data do último) e deixa a leitura pra equipe.
function obrasComAtencaoEletrica(){
  const arr=[];
  for(const cod in DB.municipios){
    for(const o of DB.municipios[cod].obras){
      const pct=medObraStats(o).pct;
      if(pct==null) continue;
      const marco=[...MARCOS_ELETRICA].reverse().find(m=>pct>=m);
      if(!marco) continue;
      const rel=o.relatoriosEletrica||[];
      const ultimo=rel[0]; // já ordenado mais-recente-primeiro (fetchEletricaVistorias)
      // agendamento só é relevante enquanto não há relatório — depois disso a obra já
      // saiu do "a vistoriar" e o agendamento correspondente é ignorado aqui (não é
      // apagado no banco, ver sql/create_eletrica_vistorias_agendadas.sql).
      const agendamento=rel.length?null:(o.agendamentoEletrica||null);
      arr.push({o, pct, marco, totalRelatorios:rel.length, ultimaData:ultimo?ultimo.data_vistoria:null, agendamento});
    }
  }
  // sem relatório primeiro (quem mais precisa de atenção), depois por % desc
  arr.sort((a,b)=>(a.totalRelatorios>0)-(b.totalRelatorios>0) || b.pct-a.pct);
  return arr;
}
let CUR_ELETRICA_ATENCAO=[];
let eleAtencaoExpandido=false;
// filtro por card do resumo (null | 'atencao' | 'vistoriadas' | 'avistoriar' |
// 'agendadas') — clicar de novo no card já ativo limpa o filtro. 'atencao' é o
// universo inteiro (mesmo efeito de null), mas precisa de valor próprio pra o card
// saber que está "ativo" quando clicado.
let eleFiltroCategoria=null;
// agrupa itens (já filtrados/visíveis) por Distrito Operacional → Município, na
// mesma ordem numérica fixa dos distritos usada em groupEntries() (grpById/gid) —
// o distrito da obra vem do município (NAMEIDX+DB.municipios[cod].do), não do texto
// bruto distrito_operacional da linha, pra usar o mesmo nome/ordem que o resto do
// app (evita divergência de grafia entre a tabela e o GeoJSON).
function agruparPorDistritoMunicipio(lista){
  const porDistrito=new Map();
  for(const it of lista){
    const cod=NAMEIDX[normTxt(it.o.municipioTxt)];
    const gid=(cod!=null&&DB.municipios[cod])?DB.municipios[cod].do:null;
    const g=grpById(gid);
    const distKey=gid!=null?gid:'—';
    const distNome=g?g.nome.replace(/^D\.O\.\s*/,''):'Sem distrito';
    if(!porDistrito.has(distKey)) porDistrito.set(distKey,{ordem:gid!=null?gid:999,nome:distNome,municipios:new Map()});
    const grupo=porDistrito.get(distKey);
    const munNome=it.o.municipioTxt||'Sem município';
    if(!grupo.municipios.has(munNome)) grupo.municipios.set(munNome,[]);
    grupo.municipios.get(munNome).push(it);
  }
  return [...porDistrito.values()].sort((a,b)=>a.ordem-b.ordem).map(g=>({
    nome:g.nome,
    municipios:[...g.municipios.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')).map(([nome,itensMun])=>({nome,itensMun})),
  }));
}
// Bloco "Atenção elétrica": só faz sentido enquanto a métrica do mapa é Elétrica — o
// resto do tempo fica fora do painel (pedido do usuário, 24/09/2026: antes ficava
// sempre visível, competindo por espaço com os KPIs de Obras/Valor). Guarda a
// visibilidade anterior pra forçar 1 reflow ao reaparecer (o cache de "sujo" abaixo
// só acompanha mudança de DADO, não a troca de métrica — sem isso o corpo ficaria
// vazio na primeira vez que o usuário troca pra Elétrica sem nenhum dado ter mudado).
let _eleAtencaoVisivelAntes=false;
// forceReflow: ignora o cache "sujo"/"limpo" e redesenha mesmo sem invalidateAggCache()
// ter rodado — usado só pelo toggle "ver todas/ver menos" (dado não mudou, só a
// quantidade exibida). Toda outra chamada (setKPIs a cada render) é barata: se nada
// mudou desde o último cálculo (_atencaoEletricaDirty===false), não recalcula nem
// reescreve o innerHTML — evita custo e perda de foco de teclado a cada hover no mapa.
function renderAtencaoEletrica(forceReflow){
  const wrap=document.getElementById('eleAtencaoWrap');
  const corpo=document.getElementById('eleAtencaoBody'); if(!corpo) return;
  const visivel=st.metric==='eletrica';
  if(wrap) wrap.hidden=!visivel;
  if(!visivel){ _eleAtencaoVisivelAntes=false; return; }
  const tornouVisivelAgora=!_eleAtencaoVisivelAntes;
  _eleAtencaoVisivelAntes=true;
  if(!forceReflow && !tornouVisivelAgora && !_atencaoEletricaDirty) return;
  _atencaoEletricaDirty=false;
  const titulo=document.getElementById('eleAtencaoTitulo');
  const itens=obrasComAtencaoEletrica();
  if(titulo) titulo.textContent=itens.length?`Atenção, Elétrica! (${itens.length})`:'Atenção, Elétrica!';
  if(!itens.length){ CUR_ELETRICA_ATENCAO=[]; corpo.innerHTML='<div class="empty">Nenhuma obra acima de 50% de medição no momento.</div>'; return; }
  const vistoriadas=itens.filter(it=>it.totalRelatorios>0).length;
  const agendadas=itens.filter(it=>it.agendamento).length;
  const avistoriar=itens.length-vistoriadas;
  // cada card filtra a lista abaixo pra só aquela categoria — clicar no card já
  // ativo limpa o filtro (mesmo padrão de toggle de outros chips no app). 'em
  // atenção' representa o universo inteiro (equivalente a nenhum filtro).
  const cardDef=[
    {k:'atencao',v:itens.length,l:'em atenção',cls:''},
    {k:'vistoriadas',v:vistoriadas,l:'vistoriadas',cls:'ok'},
    {k:'avistoriar',v:avistoriar,l:'a vistoriar',cls:'warn'},
    {k:'agendadas',v:agendadas,l:'agendadas',cls:'info'},
  ];
  const resumo=`<div class="ele-resumo">${cardDef.map(c=>
    `<div class="ele-resumo-i${c.cls?' '+c.cls:''}${eleFiltroCategoria===c.k?' on':''}" role="button" tabindex="0" data-filtro="${c.k}">`
    +`<span class="v">${NUM.format(c.v)}</span><span class="l">${c.l}</span></div>`).join('')}</div>`;
  const CATEGORIA_TESTE={
    atencao:()=>true,
    vistoriadas:it=>it.totalRelatorios>0,
    avistoriar:it=>!it.totalRelatorios,
    agendadas:it=>!!it.agendamento,
  };
  const itensFiltrados=eleFiltroCategoria?itens.filter(CATEGORIA_TESTE[eleFiltroCategoria]):itens;
  CUR_ELETRICA_ATENCAO=itensFiltrados.map(it=>it.o);
  if(!itensFiltrados.length){
    corpo.innerHTML=resumo+'<div class="empty">Nenhuma obra nesta categoria.</div>';
    wireEleResumoFiltro();
    return;
  }
  const MOSTRAR=6;
  const mostrar=(eleAtencaoExpandido?itensFiltrados:itensFiltrados.slice(0,MOSTRAR)).map((it,i)=>({...it,_i:i}));
  const linha=(it)=>{
    const chipAgenda=it.agendamento
      ?`<div class="ele-agenda-chip">Agendada p/ ${fmtDateBR(it.agendamento.data_planejada)} · ${escHtml(it.agendamento.responsavel_nome)}</div>`:'';
    return `<div class="ele-alert-row" role="button" tabindex="0" data-oid="${it._i}">
      <div class="ele-alert-body">
        <div class="ele-alert-main"><span class="ele-alert-nome">${escHtml(it.o.objeto||it.o.codigo_obra||it.o.contrato)}</span><span class="ele-alert-marco">${it.marco}%</span></div>
        <div class="ele-alert-sub">${it.totalRelatorios?`${it.totalRelatorios} relatório${it.totalRelatorios===1?'':'s'}${it.ultimaData?' · último em '+fmtDateBR(it.ultimaData):''}`:'sem relatório enviado'}</div>
        ${chipAgenda}
      </div>
    </div>`;
  };
  // Distrito Operacional → Município (pedido do usuário, 24/09/2026): só agrupa o
  // que está visível (`mostrar`) — `_i` já carrega o índice em itensFiltrados, que é
  // o mesmo espaço de índice de CUR_ELETRICA_ATENCAO, então o agrupamento visual não
  // muda o que data-oid resolve.
  const grupos=agruparPorDistritoMunicipio(mostrar);
  const listaHtml=grupos.map(g=>
    `<div class="ele-grupo-do"><div class="ele-grupo-do-h">${escHtml(g.nome)}</div>`
    +g.municipios.map(m=>`<div class="ele-grupo-mun"><div class="ele-grupo-mun-h">${escHtml(m.nome)}</div>${m.itensMun.map(linha).join('')}</div>`).join('')
    +`</div>`).join('');
  const verBtn=itensFiltrados.length>MOSTRAR
    ?`<button type="button" class="ele-alert-ver" id="eleAtencaoVer">${eleAtencaoExpandido?'ver menos':'ver todas ('+itensFiltrados.length+')'}</button>`:'';
  corpo.innerHTML=resumo+listaHtml+verBtn;
  const verEl=document.getElementById('eleAtencaoVer');
  if(verEl) verEl.onclick=()=>{ eleAtencaoExpandido=!eleAtencaoExpandido; renderAtencaoEletrica(true); };
  wireEleResumoFiltro();
}
// liga o clique/teclado dos 4 cards do resumo (filtro de categoria) — chamada de
// novo a cada reflow (innerHTML reconstruído, listeners velhos morrem junto).
function wireEleResumoFiltro(){
  const corpo=document.getElementById('eleAtencaoBody'); if(!corpo) return;
  corpo.querySelectorAll('.ele-resumo-i').forEach(card=>{
    card.addEventListener('click',()=>{
      const k=card.dataset.filtro;
      eleFiltroCategoria=(eleFiltroCategoria===k)?null:k;
      eleAtencaoExpandido=false; // troca de filtro reabre no recorte curto, senão "ver todas" de uma categoria vazaria pra outra
      // passF() agora também recorta por eleFiltroCategoria (ver comentário lá) — sem
      // invalidar o cache de obrasOf() por município, o mapa continuaria pintando com a
      // categoria anterior. render() já chama renderPanel()→setKPIs()→renderAtencaoEletrica(),
      // então isto substitui o renderAtencaoEletrica(true) antigo (pedido do usuário,
      // 24/09/2026: clicar no card também deve refletir no mapa, não só na listinha).
      invalidateAggCache();
      render();
    });
    card.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); card.click(); } });
  });
}
// entries pra ranking/popover de irmãos — mesma forma que rankRows() consome
// ({k,nome,sub,v}). Compartilhadas entre renderPanel() e o popover de navegação
// lateral da trilha (Fase 8): uma lista, uma ordenação, um lugar só calculando.
// Modo Replanilhamentos: o mesmo valor que o mapa pinta (rpValor), para que a lista de
// irmãos da trilha não mostre contagem de obras ao lado de um mapa de processos. No tempo
// médio o tamanho da amostra vai no subtítulo da linha: esta é uma lista feita para
// comparar áreas lado a lado, e 5 despachos não podem pesar como 97.
function rpEntrada(procs){
  const r=rpValor(aggProc(procs));
  return {v:r.v, sub:st.rp.metrica==='tempo'?`${NUM.format(r.n)} desp.`:''};
}
function groupEntries(){
  // ordem fixa dos Distritos Operacionais, pela numeração (1º, 2º, …).
  return groupsList().map(g=>{
    const e=modoReplan()?rpEntrada(procsDoDistrito(g.id)):null;
    return {k:g.id,nome:g.nome.replace(/^D\.O\.\s*/,''),sub:e?e.sub:g.sede,
            v:e?e.v:mval(aggIds(idsOfGroup(g.id)))};
  }).sort((a,b)=>a.k-b.k);
}
// includeZero=true pro popover de irmãos (Fase 8): lá qualquer município do grupo
// precisa ser navegável, mesmo sem contrato — diferente do ranking do painel do
// nível 2, que só lista quem tem obra (filtro original, mantido por padrão)
function cityEntries(ids,includeZero){
  return ids.map(id=>{
    const e=modoReplan()?rpEntrada(filtraRp(DB.municipios[id].processos)):null;
    return {k:id,nome:DB.municipios[id].nome,sub:e?e.sub:'',v:e?e.v:mval(aggIds([id]))};
  }).filter(e=>includeZero||e.v>0).sort((a,b)=>b.v-a.v);   // v null (amostra insuficiente) conta como 0: vai para o fim
}
function rankRows(entries,onClick){
  const max=Math.max(1,...entries.map(e=>e.v||0));
  const fmt=modoReplan()?rpFmt:METRIC[st.metric].fmt;
  const amber=(!modoReplan()&&st.metric==='aditivo')||rpTempo()?' amber':'';
  return entries.map((e,i)=>`<div class="rrow${rpTempo()?' warm':''}" role="button" tabindex="0" data-k="${e.k}" data-kind="${onClick}">
     <div class="t"><span class="nm">${escHtml(e.nome)} ${e.sub?`<span class="sub2">· ${escHtml(e.sub)}</span>`:''}</span><span class="vv">${fmt(e.v)}</span></div>
     <div class="rbar${amber}"><i style="width:${Math.max(4,(e.v||0)/max*100)}%"></i></div></div>`).join('');
}
// E5 — mesma linha do ranking, só que no modo Replanilhamentos e no nível dos distritos:
// cada um ganha um chip para abrir a janela de detalhe (ver abreModalDistrito), aninhado
// dentro de .nm como .chip.mun.locate já é aninhado dentro de .obra — mesmo padrão, não um
// segundo controle interativo inventado. Função separada, e não um ramo dentro de
// rankRows(): ela é comum ao modo Obras, que não pode herdar o chip por engano.
function rpRankRowsHtml(entries,kind){
  const max=Math.max(1,...entries.map(e=>e.v||0));
  return entries.map(e=>{
    const abre=kind==='group'
      ? ` <span class="chip abre" role="button" tabindex="0" data-abre="distrito" data-gid="${e.k}" title="Ver janela do distrito" aria-label="Ver janela do distrito ${escHtml(e.nome)}">${RS_ICO.dist}</span>`
      : '';
    return `<div class="rrow${rpTempo()?' warm':''}" role="button" tabindex="0" data-k="${e.k}" data-kind="${kind}">
     <div class="t"><span class="nm">${escHtml(e.nome)}${abre}${e.sub?` <span class="sub2">· ${escHtml(e.sub)}</span>`:''}</span><span class="vv">${rpFmt(e.v)}</span></div>
     <div class="rbar${rpTempo()?' amber':''}"><i style="width:${Math.max(4,(e.v||0)/max*100)}%"></i></div></div>`;
  }).join('');
}
// ativação de .rrow (painel de ranking e popover de irmãos usam o mesmo HTML/dataset)
function goRrow(rr){ if(rr.dataset.kind==='group')goGroup(rr.dataset.k); else goCity(rr.dataset.k); }
// Enter/Espaço → clique, pros cards que são <div role="button"> em vez de <button> nativo
function activateOnKey(e,selector){
  if(e.key!=='Enter' && e.key!==' ') return;
  const target=e.target.closest(selector); if(!target) return;
  e.preventDefault(); target.click();
}
let CUROBRAS=[];
const PIN_SVG='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.58 7-12A7 7 0 0 0 5 10c0 4.42 7 12 7 12z"/><circle cx="12" cy="10" r="2.3"/></svg>';
function obraCard(o,i){
  const cod=NAMEIDX[normTxt(o.municipioTxt)];
  const munTxt=escHtml(o.municipioTxt);
  const munChip=o.municipioTxt
    ? (cod ? `<span class="chip mun locate" role="button" tabindex="0" data-cod="${cod}" title="Ver ${munTxt} no mapa">${PIN_SVG}${munTxt}</span>`
           : `<span class="chip mun">${munTxt}</span>`)
    : '';
  return `<div class="obra" role="button" tabindex="0" aria-label="Ver todos os dados do contrato ${escHtml(o.contrato)}" data-oid="${i}">
    <div class="r1"><span class="ct">${escHtml(o.contrato)}</span><span class="vl">${BRL.format(o.valor)}</span></div>
    <div class="ob just">${escHtml(o.objeto)}</div>
    <div class="chips"><span class="chip">${escHtml(o.status)}</span>${o.tipo?`<span class="chip">${escHtml(o.tipo)}</span>`:''}${munChip}</div>
    <div class="info">
      <div><div class="l">Contratada</div><div class="d">${escHtml(o.contratada)}</div></div>
      <div><div class="l">Valor atual</div><div class="d">${BRL.format(o.valor)}</div></div>
      <div class="fis"><div class="l">${escHtml(o.fiscalTipo||'FISCAL')}</div><div class="d">${escHtml(o.fiscal||'—')}</div></div>
    </div>
    <div class="more">Ver todos os dados ↗</div>
  </div>`;
}
function obrasCards(ids){
  const arr=[]; ids.forEach(id=>obrasOf(id).forEach(o=>arr.push(o)));
  arr.sort((a,b)=>b.valor-a.valor);
  CUROBRAS=arr;
  if(!arr.length) return `<div class="empty">${hasActiveFilter()?'Nenhum contrato encontrado com estes filtros.':'Nenhum contrato neste recorte.'}</div>`;
  return arr.slice(0,120).map((o,i)=>obraCard(o,i)).join('') + (arr.length>120?`<div class="empty">+ ${arr.length-120} contratos… refine a busca/filtros</div>`:'');
}

// ---- modal com os dados do contrato ----
function fmtContratoExt(v){
  if(v===null||v===undefined||v==='') return '—';
  const s=String(v).trim();
  if(/\d\/\d{4}/.test(s)) return escHtml(s);
  const d=s.replace(/\D/g,'');
  if(d.length>4) return `${d.slice(0,-4)}/${d.slice(-4)}`;
  return escHtml(s);
}
function fmtDateBR(v){
  if(!v) return '—';
  const s=String(v);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d=new Date(s); if(!isNaN(d)) return d.toLocaleDateString('pt-BR');
  return escHtml(s);
}
// Achado do usuário, 2026-09-22: a versão anterior extraía os dígitos do texto na marra
// (regex, sem `Date`), então um `timestamptz` devolvido em UTC pelo PostgREST (é o padrão
// — `ultima_atualizacao`/`atualizado_em` são `timestamptz`, que o PostgREST sempre
// serializa com offset UTC explícito, `Z` ou `+00:00`, não importa se a coluna foi
// gravada via `.toISOString()` do JS deste repo — caso de `processos.ultima_atualizacao`
// — ou por um sync externo, como `contratos_edificacao.atualizado_em`, escrito pelo
// script Python `sigsop_contratos.py`) aparecia com a HORA de UTC rotulada como se já
// fosse horário do Ceará — 3h adiantado (sem horário de verão no Brasil desde 2019, a
// diferença é sempre exata).
// Passou despercebido porque as datas mostradas (contrato atualizado há dias/semanas) não
// deixavam o desvio óbvio; ficou claro só quando "Base atualizada em" (achado do painel
// de fiscais) passou a mostrar um horário de HOJE, à frente do relógio de quem via a tela.
// Fix: `Date` de verdade + `timeZone:'America/Fortaleza'` explícito — corrige também o
// "Atualizado em" da ficha de obra (mesma função, mesmo bug).
function fmtDateTimeBR(v){
  if(!v) return '—';
  const d=new Date(v);
  if(isNaN(d)) return escHtml(String(v));
  const data=d.toLocaleDateString('pt-BR',{timeZone:'America/Fortaleza'});
  const hora=d.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'});
  return `${data} ${hora}`;
}
function fmtVal(v){ return (v===null||v===undefined||v==='') ? '—' : escHtml(String(v)); }
function fmtCNPJ(v){
  if(v===null||v===undefined||v==='') return '—';
  const d=String(v).replace(/\D/g,'');
  if(d.length!==14) return escHtml(String(v));
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
}
function mSection(title,fields){
  return `<div class="msec">${title}</div><div class="mgrid">`
    +fields.map(([l,d,extra])=>`<div><div class="l">${l}</div><div class="d">${d}${extra||''}</div></div>`).join('')
    +`</div>`;
}
// ---- gráficos legados do modal ----
// donutGauge / pieLegend / divergingBars / timelineGauge NÃO são mais chamados pelo
// modal desde a Etapa B (o modelo do usuário usa tabelas e barras próprias). Ficam
// no arquivo por decisão de escopo (spec §3.1) — remoção seria mudança fora do que
// a Etapa B autoriza. `prazoCalc` (usado por todos) segue vivo e compartilhado.
// anel/gauge de 1 valor (0-100%).
function donutGauge(pct,color,size){
  size=size||110;
  const stroke=Math.round(size*0.13), r=(size-stroke)/2, c=2*Math.PI*r;
  const p=Math.max(0,Math.min(100,pct)), dash=c*p/100;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${p.toFixed(1)}% medido">
    <circle class="donut-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${(c-dash).toFixed(2)}" transform="rotate(-90 ${size/2} ${size/2})"/>
  </svg>`;
}
// legenda em lista (dot + rótulo + valor) compartilhada pelas duas fábricas de gráfico
// acima — "neutral" usa a cor de "trilho" do CSS em vez de uma cor de dado (evita
// hardcode de cor aqui pra algo que não representa categoria nenhuma, só o restante).
function pieLegend(items){
  return `<div class="pie-leg">${items.map(s=>
    `<div class="pie-item"><span class="pie-dot${s.neutral?' neutral':''}"${s.neutral?'':` style="background:${s.color}"`}></span>`
    +`<span class="pie-l">${escHtml(s.label)}</span><span class="pie-v">${s.pctLabel}</span></div>`).join('')}</div>`;
}
// barras DIVERGENTES (eixo zero ao centro) pra Acréscimo/Supressão/Repercussão — o
// gráfico certo pra esse dado específico: Acréscimo é sempre ganho (positivo, cresce
// pra direita), Supressão é sempre perda conceitual mesmo guardada como número
// positivo na base (por isso entra com sinal invertido aqui, cresce pra esquerda), e
// Repercussão é a diferença líquida das duas (valor_aprovado−valor_supressao) — pode
// dar positiva OU negativa de verdade, então precisa de um eixo que aceite os dois
// lados. Uma pizza não serve (fatia negativa não existe — foi o motivo da 1ª versão
// desta função ter tirado a Repercussão da pizza); barras na mesma direção também não
// (não mostram que Supressão é uma redução, nem pra que lado a Repercussão pende).
// Cada barra escala em relação ao maior |percentual| dos três — o rótulo ao lado
// sempre mostra o percentual real (sobre o valor original), a barra só dá a
// comparação visual entre os três.
function divergingBars(rows){
  const maxAbs=Math.max(.1,...rows.map(r=>Math.abs(r.pct)));
  return `<div class="divbars">${rows.map(r=>{
    const w=Math.abs(r.pct)/maxAbs*48; // até 48% de cada lado do centro, deixa folga da borda
    const left=r.pct<0 ? (50-w) : 50;
    return `<div class="divbar-row"><div class="divbar-h"><span class="divbar-l">${escHtml(r.label)}</span><span class="divbar-v" style="color:${r.color}">${r.valLabel}</span></div>
      <div class="divbar-track"><i class="divbar-mid"></i><i class="divbar-fill" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%;background:${r.color}"></i></div></div>`;
  }).join('')}</div>`;
}
function parseISODate(s){
  const m=s&&String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1],+m[2]-1,+m[3])) : null;
}
// linha de prazo: início → fim + quanto já passou (barra) + dias restantes/vencidos.
// Usa as datas JÁ vigentes do contrato (data_inicio_real/data_fim_previsto/
// data_fim_vigencia_contrato) — esses campos vêm de contratos_edificacao e já refletem
// qualquer aditivo de prazo aprovado até hoje, então não precisa somar dias de aditivo
// em aditivo pra saber "o prazo atual": a base já faz essa conta.
// núcleo do cálculo de prazo — MESMA fórmula de sempre, extraída para ser
// compartilhada entre a linha visual (timelineGauge, aba Aditivos) e os blocos
// Prazo/Execução da aba Resumo (Etapa B). Devolve null quando faltam datas.
function prazoCalc(startStr,endStr){
  const start=parseISODate(startStr), end=parseISODate(endStr);
  if(!start||!end) return null;
  const now=new Date(), today=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));
  const totalDays=Math.round((end-start)/86400000);
  const remainingDays=Math.round((end-today)/86400000);
  const pct=totalDays>0?Math.max(0,Math.min(100,(totalDays-remainingDays)/totalDays*100)):100;
  const overdue=remainingDays<0;
  const daysTxt=overdue?`Vencido há ${NUM.format(Math.abs(remainingDays))} dia${Math.abs(remainingDays)===1?'':'s'}`
    :`${NUM.format(remainingDays)} dia${remainingDays===1?'':'s'} restante${remainingDays===1?'':'s'}`;
  const color=overdue?TOKENS.statusStop:(remainingDays<=30?TOKENS.amber:TOKENS.ng);
  return {totalDays,remainingDays,pct,overdue,daysTxt,color};
}
// cor de TEXTO por estado (Etapa B / Bloco 7 — acessibilidade). A cor "cheia" de
// vermelho/âmbar/verde de TOKENS serve para preenchimentos (barras, pontos), mas em
// TEXTO pequeno sobre fundo claro ela não alcança WCAG AA — aqui mapeamos para as
// variantes de texto do tema (--status-stop-text / --amber-text / --ng-light), que
// o CSS já define escuras o suficiente no tema claro. Preenchimentos continuam com
// a cor cheia (TOKENS.*), inalterados.
function statusTextColor(c){
  if(c===TOKENS.statusStop) return 'var(--status-stop-text)';
  if(c===TOKENS.statusWait || c===TOKENS.amber) return 'var(--amber-text)';
  if(c===TOKENS.ng) return 'var(--ng-light)';
  return c;
}
function timelineGauge(label,startStr,endStr){
  const c=prazoCalc(startStr,endStr);
  if(!c) return `<div class="tl-row"><div class="tl-h"><span class="tl-l">${escHtml(label)}</span><span class="tl-days">—</span></div><div class="empty" style="padding:2px 0">Datas insuficientes pra calcular o prazo.</div></div>`;
  return `<div class="tl-row">
    <div class="tl-h"><span class="tl-l">${escHtml(label)}</span><span class="tl-days" style="color:${c.color}">${c.daysTxt}</span></div>
    <div class="tl-track"><i style="width:${c.pct.toFixed(1)}%;background:${c.color}"></i></div>
    <div class="tl-dates"><span>${fmtDateBR(startStr)}</span><span>${fmtDateBR(endStr)}</span></div>
  </div>`;
}
// card de indicador do modal (rótulo + valor) — .mkpi/.mkpis ainda estilizados no
// CSS; helper mantido para reuso futuro (nenhum pane o chama após a Etapa B).
function mkpi(label,valHtml){ return `<div class="mkpi"><div class="l">${label}</div><div class="v">${valHtml}</div></div>`; }
// botão discreto que recolhe/expande a lista de cards de um dos dois grupos de
// aditivo (valor/prazo) — o resumo (barras/timeline) fica sempre visível, só o
// detalhe por aditivo (mais verboso, cresce com o nº de aditivos) começa recolhido.
// Mesmo padrão de toggle já usado no botão "Comissão completa" de Dados Gerais.
function adToggle(targetId,n,kindLabel){
  return `<button type="button" class="adToggle" data-target="${targetId}" aria-expanded="false" aria-controls="${targetId}">
    <span>Ver ${n} aditivo${n===1?'':'s'} ${kindLabel}</span> <span class="adToggle-car">▾</span></button>`;
}
// cabeçalho do card de aditivo. Hoje só a lista "Outros aditivos" (buildAdValorPane)
// usa isto — valor e prazo têm tabelas próprias (.adv-*/.adp-*).
function adRowHeader(a){
  const obs=adObs(a);
  return `<div class="adrow-h"><span class="adnum">Aditivo ${fmtVal(a.nr_aditivo)}</span><span class="chip">${fmtVal(a.tipo_aditivo)}</span><span class="addate">${fmtDateBR(adPubDate(a))}</span></div>
    <div class="adproto">Processo ${fmtVal(a.nr_protocolo)}</div>${obs?`<div class="adobs">${escHtml(obs)}</div>`:''}`;
}
// Etapa B / Bloco 1 — a antiga aba única "Aditivos" foi dividida em duas:
// "Aditivos de valor" e "Aditivos de prazo". adCompute() é o prelúdio comum
// (as 3 sublistas), pra não duplicar a filtragem entre os dois panes.
function adCompute(o,raw){
  const list=(o.aditivos||[]);
  // aditivos_contrato é NÍVEL CONTRATO (não separa por obra) — as abas de aditivo
  // trabalham com o valor original DO CONTRATO, não o da obra.
  const orig=num(o.valorOriginalContrato)||num(raw.valor_original);
  const hasValor=a=>!!(num(a.valor_aprovado)||num(a.valor_supressao)||num(a.valor_repercussao));
  const hasPrazo=a=>!!(num(a.execucao_aprovado)||num(a.prazo_aprovado));
  return {
    orig,
    valorList:list.filter(hasValor),
    prazoList:list.filter(hasPrazo),
    outrosList:list.filter(a=>!hasValor(a)&&!hasPrazo(a)),
  };
}
// Aba "Aditivos de valor" (Etapa B / Bloco 4 — modelo janela_contrato_melhorado):
// faixa de 5 cartões → tabela por aditivo (com pílula de %) → widget do art. 125.
// As Σ acréscimo/supressão/repercussão são AS MESMAS que o pane usava para as
// barras divergentes — nenhum número muda; a barra do art. 125 é Σ acréscimo ÷
// valor_original contra a constante legal de 25% (não é dado novo).
function buildAdValorPane(o,raw){
  const {valorList,outrosList,orig}=adCompute(o,raw);
  if(!valorList.length && !outrosList.length)
    return `<div class="msec">Aditivos de valor</div><div class="empty">Nenhum aditivo de valor registrado para este contrato.</div>`;

  const pctS=v=>orig?fmtPct1(v/orig*100)+'%':'—';
  // aditivos_contrato não separa por obra: nos contratos multi-obra estes números
  // são do CONTRATO INTEIRO (todas as obras).
  let out=advScopeNote(o,'Aditivos do contrato — abrangem todas as obras deste contrato (a base não os separa por obra).');

  if(valorList.length){
    const acres =valorList.reduce((s,a)=>s+num(a.valor_aprovado),0);
    const supr  =valorList.reduce((s,a)=>s+num(a.valor_supressao),0);
    const reperc=valorList.reduce((s,a)=>s+num(a.valor_repercussao),0);
    const repClsT=reperc>0?'pos':reperc<0?'neg':'zero';

    const strip=`<div class="adv-strip">
      <div class="adv-c"><div class="rs-lbl">Valor original</div><div class="adv-n">${BRL2.format(orig)}</div></div>
      <div class="adv-c"><div class="rs-lbl">Acréscimos</div><div class="adv-n pos">${BRL2.format(acres)}</div><div class="adv-s">${pctS(acres)} do original</div></div>
      <div class="adv-c"><div class="rs-lbl">Supressões</div><div class="adv-n neg">${supr?'−'+BRL2.format(supr):BRL2.format(0)}</div><div class="adv-s">${pctS(supr)} do original</div></div>
      <div class="adv-c"><div class="rs-lbl">Repercussão líquida</div><div class="adv-n ${repClsT}">${signedBRL(reperc)}</div><div class="adv-s ${repClsT}">${pctS(Math.abs(reperc))} do original</div></div>
      <div class="adv-c adv-hero"><div class="rs-lbl">Valor atual${(o.nObras||1)>1?' (contrato)':''}</div><div class="adv-n">${BRL2.format(num(o.valorContrato))}</div><div class="adv-s">${NUM.format(valorList.length)} aditivo${valorList.length===1?'':'s'} de valor</div></div>
    </div>`;

    const cell=(val,cls,pill)=>`<div class="adv-cell"><span class="adv-v ${cls}">${val}</span>${pill||''}</div>`;
    const trows=valorList.map((a,i)=>{
      const av=num(a.valor_aprovado), sv=num(a.valor_supressao), rv=num(a.valor_repercussao);
      const aC=cell(av>0?BRL2.format(av):'—', av>0?'pos':'zero', av>0?`<span class="adv-pill pos">+${pctS(av)}</span>`:'');
      const sC=cell(sv>0?'−'+BRL2.format(sv):'—', sv>0?'neg':'zero', sv>0?`<span class="adv-pill neg">−${pctS(sv)}</span>`:'');
      const rC=cell(rv!==0?signedBRL(rv):'—', rv>0?'pos':rv<0?'neg':'zero', rv!==0?`<span class="adv-pill ${rv<0?'neg':'pos'}">${rv<0?'−':'+'}${pctS(Math.abs(rv))}</span>`:'');
      return `<div class="adv-row${i%2?' odd':''}">
        <div class="adv-rmain">
          <div class="adv-num">${fmtVal(a.nr_aditivo)}</div>
          <div class="adv-nup"><span class="adv-nup-p">${fmtVal(a.nr_protocolo)}</span></div>
          <div class="adv-pub">${fmtDateBR(adPubDate(a))}</div>
          ${aC}${sC}${rC}
        </div>${adObsRow(a,'adv')}</div>`;
    }).join('');
    const table=`<div class="adv-table">
      <div class="adv-thead"><div class="rs-lbl">Aditivos de valor (${valorList.length})</div><span class="adv-note">Valores em reais · pílula = % sobre o valor original</span></div>
      <div class="adv-scroll"><div class="adv-grid">
        <div class="adv-hrow"><div>Nº</div><div>NUP · nº do processo</div><div>Publicação</div><div class="r">Acréscimo</div><div class="r">Supressão</div><div class="r">Repercussão</div></div>
        ${trows}
      </div></div></div>`;

    const pctA=orig?acres/orig*100:0;
    const lc=pctA>=25?TOKENS.statusStop:pctA>=20?TOKENS.statusWait:TOKENS.ng;
    const lTxt=pctA>=25
      ? 'Limite de 25% atingido — novo acréscimo depende de justificativa e enquadramento legal.'
      : `Margem disponível de ${fmtPct1(25-pctA)}% do valor original.`;
    const limite=`<div class="adv-limite">
      <div class="rs-lbl">Limite legal de acréscimo · art. 125 da Lei 14.133/2021</div>
      <div class="adv-lim-row"><span>Acréscimo acumulado sobre o valor original</span><b style="color:${statusTextColor(lc)}">${fmtPct1(pctA)}% de 25,0%</b></div>
      <div class="adv-lim-bar"><i style="width:${Math.min(100,pctA/25*100).toFixed(1)}%;background:${lc}"></i></div>
      <div class="adv-lim-txt" style="color:${statusTextColor(lc)}">${lTxt}</div></div>`;

    out+=strip+table+limite;
  }

  if(outrosList.length){
    const rows=outrosList.map(a=>`<div class="adrow">${adRowHeader(a)}</div>`).join('');
    out+=`<div class="msec">Outros aditivos (${outrosList.length})</div><div class="adlist">${rows}</div>`;
  }
  return out;
}
// Aba "Aditivos de prazo" (Etapa B / Bloco 5 — modelo janela_contrato_melhorado):
// dois blocos (execução / vigência), cada um com cabeçalho Original·Prorrogado·Vigente
// em dias, 3 mini-cartões (calendário, via prazoCalc), tabela com "Prazo acumulado" e
// barra empilhada. "Original" = coluna autoritativa do contrato (prazo_execucao /
// prazo_vigencia_contrato — 100% preenchidas na base); "Prorrogado" = Σ dos dias dos
// aditivos de prazo (auditável linha a linha na tabela); "Vigente" = Original +
// Prorrogado (prazo CONTRATUAL). Antes o "Original" saía do intervalo de datas menos
// as prorrogações, e o intervalo absorvia os dias de paralisação — inflava o número.
function buildAdPrazoPane(o,raw){
  const {prazoList}=adCompute(o,raw);
  const dd=n=>{ const r=Math.round(n); return NUM.format(r)+' dia'+(Math.abs(r)===1?'':'s'); };
  const block=(titulo,sub,aditField,origField,startStr,endStr,vazioLabel)=>{
    // c = janela de CALENDÁRIO (inclui paralisações) — só alimenta os 3 mini-cartões.
    // O trio Original/Prorrogado/Vigente e a tabela são CONTRATUAIS e não dependem de
    // datas: aparecem mesmo em contrato "Aguardando OS" sem data_inicio_real.
    const c=prazoCalc(startStr,endStr);
    const lista=prazoList.filter(a=>num(a[aditField]));
    const prorrog=lista.reduce((s,a)=>s+num(a[aditField]),0);
    const original=num(raw[origField]);
    const vigente=original+prorrog;                    // prazo contratual (não o span de datas)
    const base=original>0?original:(vigente||1);       // evita ÷0 se a coluna vier zerada
    const pctBlock=base>0?prorrog/base*100:0;
    const cor=pctBlock>=100?TOKENS.statusStop:(pctBlock>=50?TOKENS.statusWait:TOKENS.ng);
    let acc=original;
    const trows=lista.map((a,i)=>{
      const d=num(a[aditField]); acc+=d;
      return `<div class="adp-row${i%2?' odd':''}">
        <div class="adp-rmain">
          <div class="adp-num">${fmtVal(a.nr_aditivo)}</div>
          <div class="adp-nup"><span class="adp-nup-p">${fmtVal(a.nr_protocolo)}</span></div>
          <div class="adp-pub">${fmtDateBR(adPubDate(a))}</div>
          <div class="adp-cell"><span class="adp-v">+${dd(d)}</span><span class="adp-pill">+${base>0?fmtPct1(d/base*100)+'%':'—'}</span></div>
          <div class="adp-acc">${dd(acc)}</div>
        </div>${adObsRow(a,'adp')}</div>`;
    }).join('');
    const tableInner=lista.length
      ? `<div class="adp-hrow"><div>Nº</div><div>NUP · nº do processo</div><div>Publicação</div><div class="r">Prorrogação</div><div class="r">Prazo acumulado</div></div>${trows}`
      : `<div class="empty" style="padding:14px 16px">${vazioLabel}</div>`;
    const origW=100/(1+pctBlock/100);
    const txt=pctBlock>=100
      ? 'As prorrogações já dobraram o prazo originalmente contratado.'
      : `Prorrogações somam ${fmtPct1(pctBlock)}% do prazo original.`;
    const minis=c?`<div class="adp-minis">
        <div class="adp-mini"><div class="rs-lbl">Data-limite</div><div class="adp-mv">${fmtDateBR(endStr)}</div></div>
        <div class="adp-mini"><div class="rs-lbl">Falta para encerrar</div><div class="adp-mv" style="color:${statusTextColor(c.color)}">${escHtml(c.daysTxt)}</div></div>
        <div class="adp-mini"><div class="rs-lbl">Prazo decorrido</div><div class="adp-mv">${fmtPct1(c.pct)}%</div>
          <div class="adp-mini-bar"><i style="width:${c.pct.toFixed(1)}%;background:${c.color}"></i></div></div>
      </div>
      <div class="adp-cal-note">Datas de calendário — incluem paralisações; podem não fechar com o prazo contratual acima.</div>`:'';
    return `<div class="adp-block">
      <div class="adp-head">
        <div><div class="adp-h">${titulo}</div><div class="adp-sub">${sub}</div></div>
        <div class="adp-trio">
          <div><div class="rs-lbl">Original</div><div class="adp-d">${dd(original)}</div></div>
          <div><div class="rs-lbl">Prorrogado</div><div class="adp-d" style="color:${statusTextColor(cor)}">${prorrog?'+'+dd(prorrog):'—'}</div></div>
          <div><div class="rs-lbl">Vigente</div><div class="adp-d">${dd(vigente)}</div></div>
        </div>
      </div>
      ${minis}
      <div class="adp-scroll"><div class="adp-grid">${tableInner}</div></div>
      <div class="adp-foot">
        <div class="adp-stack"><i style="width:${origW.toFixed(1)}%"></i></div>
        <div class="adp-leg"><span><i class="d-o"></i>Prazo original</span><span><i class="d-p"></i>Prorrogações</span>
          <b style="color:${statusTextColor(cor)}">${txt}</b></div>
      </div>
    </div>`;
  };
  const cE=prazoCalc(raw.data_inicio_real,raw.data_fim_previsto);
  const cV=prazoCalc(raw.data_inicio_real,raw.data_fim_vigencia_contrato);
  if(!prazoList.length && !cE && !cV)
    return `<div class="msec">Aditivos de prazo</div><div class="empty">Nenhum aditivo de prazo registrado para este contrato.</div>`;
  // "Original" (prazo_execucao/prazo_vigencia_contrato) é por OBRA; as prorrogações
  // (aditivos_contrato) são do CONTRATO. Nos contratos multi-obra os dois níveis
  // aparecem juntos — aviso explícito.
  return `<div class="adp-wrap">`
    +advScopeNote(o,'Original é o prazo desta obra; as prorrogações vêm dos aditivos do contrato (a base não os separa por obra).')
    +block('Prazo de execução','Período para conclusão física da obra','execucao_aprovado','prazo_execucao',raw.data_inicio_real,raw.data_fim_previsto,'Nenhum aditivo de prazo de execução registrado.')
    +block('Prazo de vigência','Período de validade jurídica do contrato','prazo_aprovado','prazo_vigencia_contrato',raw.data_inicio_real,raw.data_fim_vigencia_contrato,'Nenhum aditivo de prazo de vigência registrado.')
    +`</div>`;
}
// total_medido/percentual_total_medido vêm prontos de ficha_contrato (mesma origem/
// escopo já usada pros outros totais do contrato) — evita somar as dezenas de linhas
// mensais de medições no cliente só pra chegar num número que a base já calcula.
// Aba "Medições" (Etapa B / Bloco 6 — modelo janela_contrato_melhorado): faixa de
// 4 indicadores (da ficha, autoritativa) → tabela mensal de o.medicoes → rodapé
// (também da ficha) → legendas STM. Sem STP/glosa/ajuste (não existem na base).
// total_medido/percentual_total_medido continuam vindo de ficha_contrato — NÃO se
// soma a tabela mês a mês pra chegar nesses números.
function buildMedicoesPane(o,raw){
  const f=o.ficha;
  const meds=o.medicoes||[];
  if(!f && !meds.length)
    return `<div class="msec">Medições</div><div class="empty">Sem dados de medição disponíveis para este contrato.</div>`;

  const multiObra=(o.nObras||1)>1;
  const {total,pct,saldo}=medObraStats(o);   // total/pct/saldo NO NÍVEL DA OBRA
  const pctW=pct==null?0:Math.max(0,Math.min(100,pct));
  const lastM=meds[meds.length-1];
  const ultima=lastM?`${fmtVal(lastM.periodo)}${lastM.nr_medicao!=null?' · '+NUM.format(lastM.nr_medicao)+'ª medição':''}`:'—';
  const qtdTxt=meds.length
    ? (meds.length===1?'1 medição registrada':`${NUM.format(meds.length)} medições registradas`)
    : 'sem medições desta obra';
  const nota=advScopeNote(o,`Medições desta obra${f&&f.percentual_total_medido!=null?` · medido no contrato (todas as obras): ${fmtPct1(num(f.percentual_total_medido))}%`:''}.`);

  const strip=`<div class="med-strip">
    <div class="med-c"><div class="rs-lbl">Total medido${multiObra?' na obra':''}</div><div class="med-n">${total==null?'—':BRL2.format(total)}</div><div class="med-s">${qtdTxt}</div></div>
    <div class="med-c"><div class="rs-lbl">Saldo da obra</div><div class="med-n">${saldo==null?'—':BRL2.format(saldo)}</div><div class="med-s">Sobre ${BRL2.format(num(o.valor))}</div></div>
    <div class="med-c"><div class="rs-lbl">Percentual executado</div><div class="med-n pos">${pct==null?'—':fmtPct1(pct)+'%'}</div>
      <div class="rs-bar"><i class="g" style="width:${pctW.toFixed(1)}%"></i></div></div>
    <div class="med-c med-hero"><div class="rs-lbl">Última medição</div><div class="med-n">${ultima}</div></div>
  </div>`;

  let tableBlock;
  if(meds.length){
    const glosaTot=meds.reduce((s,m)=>s+num(m.valor_ref_glosa),0);
    const brutoTot=meds.reduce((s,m)=>s+num(m.valor_medido),0);
    // bruto − glosa − líquido: em algumas obras `total` já embute outras retenções
    // (não registradas em valor_ref_glosa). Mostra a diferença pra o rodapé sempre fechar.
    const outrasRet=(total==null)?0:Math.round((brutoTot-glosaTot-total)*100)/100;
    const trows=meds.map((m,i)=>{ const g=num(m.valor_ref_glosa); return `<div class="med-row${i%2?' odd':''}">
      <div class="med-nr">${fmtVal(m.nr_medicao)}</div>
      <div><span class="med-stm">${fmtVal(m.sigla_status_medicao)}</span></div>
      <div class="med-per">${fmtVal(m.periodo)}</div>
      <div class="med-proto">${fmtVal(m.nr_protocolo)}</div>
      <div class="med-val">${BRL2.format(num(m.valor_medido))}</div>
      <div class="med-val med-glosa">${g>0?'−'+BRL2.format(g):'—'}</div>
      <div class="med-tot">${BRL2.format(num(m.total))}</div>
    </div>`; }).join('');
    const foot=`<div class="med-foot">
      <div><div class="rs-lbl">Medido (bruto)</div><div class="med-fn">${BRL2.format(brutoTot)}</div></div>
      <div><div class="rs-lbl">Glosas</div><div class="med-fn med-glosa">${glosaTot>0?'−'+BRL2.format(glosaTot):BRL2.format(0)}</div></div>
      ${outrasRet>=0.01?`<div><div class="rs-lbl">Outras retenções</div><div class="med-fn med-glosa">−${BRL2.format(outrasRet)}</div></div>`:''}
      <div><div class="rs-lbl">Total medido (líquido)</div><div class="med-fn pos">${total==null?'—':BRL2.format(total)}</div></div>
      <div><div class="rs-lbl">Saldo da obra</div><div class="med-fn">${saldo==null?'—':BRL2.format(saldo)}</div></div>
      <div><div class="rs-lbl">Percentual</div><div class="med-fn pos">${pct==null?'—':fmtPct1(pct)+'%'}</div></div>
    </div>`;
    tableBlock=`<div class="med-table">
      <div class="med-thead"><div class="rs-lbl">Medições ${multiObra?'da obra':'do contrato'}</div><span class="adv-note">STM = situação da medição · Medido = bruto · Total = líquido (após glosa) · valores em reais</span></div>
      <div class="med-scroll"><div class="med-grid">
        <div class="med-hrow"><div>Nr</div><div>STM</div><div>Período</div><div>Protocolo</div><div class="r">Medido</div><div class="r">Glosa</div><div class="r">Total</div></div>
        ${trows}${foot}
      </div></div></div>`;
  } else {
    tableBlock=`<div class="med-table"><div class="med-thead"><div class="rs-lbl">Medições ${multiObra?'da obra':'do contrato'}</div></div>`
      +`<div class="empty" style="padding:14px 16px">Sem medições registradas para esta obra.</div></div>`;
  }

  const legend=meds.length?`<div class="med-leg">
    <div class="rs-lbl">Legendas de situação da medição (STM)</div>
    <div class="med-leg-grid">${STM_LEGENDA.map(([c,t])=>`<div class="med-leg-i"><b>${escHtml(c)}</b><span>${escHtml(t)}</span></div>`).join('')}</div></div>`:'';

  return nota+strip+tableBlock+legend;
}
// ---- Aba "Resumo" (dashboard executivo — Etapa B, revisado a partir de modelo do
// usuário). Só leitura; valores de UMA obra já carregada. Os percentuais são razão de
// valores que já existem; a curva plota o `total` LÍQUIDO ACUMULADO no cliente (a base
// entrega por período, já com glosas descontadas) ÷ valor da obra. Ícones = SVG inline. ----
const RS_ICO={
  obj:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M6 21V7l6-4 6 4v14M10 21v-4h4v4"/><path d="M9 10h.01M15 10h.01M9 13.5h.01M15 13.5h.01"/></svg>',
  pin:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-7.16 7-12A7 7 0 0 0 5 9c0 4.84 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>',
  dist:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V8l5-3 5 3v13M14 21V11l6-3v10M3 21h18M8 10v.01M8 13v.01"/></svg>',
  pessoa:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
  banco:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 20h18"/></svg>',
  valor:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
  comissao:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6.6a3 3 0 0 1 0 5.6M21 20a6 6 0 0 0-4-5.6"/></svg>',
  clock:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16M8 14l3-3 3 2 4-5"/></svg>',
  voltar:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  lixeira:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
};
// medição NO NÍVEL DA OBRA: Σ do `total` LÍQUIDO das medições desta obra (já com as
// glosas descontadas — não `valor_medido`, que é o bruto) ÷ valor da obra. Denominador =
// `o.valor` (valor_atual da obra em contratos_edificacao — autoritativo; medicoes.valor_atual
// é cópia denormalizada, fica de fallback). `denom` é reexposto para a curva do Resumo (R4)
// usar o MESMO. Sem linhas de medição da obra: só cai na ficha (NÍVEL CONTRATO) quando é
// contrato de obra única; multi-obra fica "—" (a ficha somaria todas as obras).
function medObraStats(o){
  const meds=o.medicoes||[];
  const denom=num(o.valor)||Math.max(0,...meds.map(m=>num(m.valor_atual)))||0;
  if(meds.length){
    const total=meds.reduce((s,m)=>s+num(m.total),0);
    return {total, pct:denom?total/denom*100:0, saldo:Math.max(0,denom-total), denom, fonte:'obra'};
  }
  if((o.nObras||1)===1 && o.ficha && o.ficha.total_medido!=null){
    const total=num(o.ficha.total_medido);
    return {total, pct:num(o.ficha.percentual_total_medido), saldo:Math.max(0,denom-total), denom, fonte:'ficha'};
  }
  return {total:null, pct:null, saldo:null, denom, fonte:'nenhuma'};
}
// gráfico de linha simples (SVG inline, sem lib) — série única: % de medição por
// período. Largura total do cartão, com linhas de grade horizontais (modelo).
function rsLineChart(pts){
  if(!pts.length) return `<div class="empty">Sem medições registradas para este contrato.</div>`;
  const W=920,H=210,PADL=8,PADR=14,PADT=16,PADB=24, iw=W-PADL-PADR, ih=H-PADT-PADB;
  const maxY=Math.max(10,...pts.map(p=>p.y));
  const X=i=>PADL+(pts.length<2?iw/2:i/(pts.length-1)*iw);
  const Y=v=>PADT+ih-(Math.max(0,Math.min(maxY,v))/maxY)*ih;
  const grid=[0,.25,.5,.75,1].map(f=>`<line class="rs-lc-grid" x1="${PADL}" x2="${(W-PADR).toFixed(1)}" y1="${(PADT+ih*f).toFixed(1)}" y2="${(PADT+ih*f).toFixed(1)}"/>`).join('');
  const line=pts.map((p,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area=`${line} L${X(pts.length-1).toFixed(1)},${(PADT+ih).toFixed(1)} L${X(0).toFixed(1)},${(PADT+ih).toFixed(1)} Z`;
  const dots=pts.map((p,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6"/>`).join('');
  const idxs=pts.length<=6?pts.map((_,i)=>i):[0,Math.round((pts.length-1)/2),pts.length-1];
  const xlabs=idxs.map(i=>`<text x="${X(i).toFixed(1)}" y="${H-7}" text-anchor="${i===0?'start':i===pts.length-1?'end':'middle'}" class="rs-lc-lab">${escHtml(String(pts[i].label||'').slice(0,7))}</text>`).join('');
  const last=pts[pts.length-1];
  return `<svg viewBox="0 0 ${W} ${H}" class="rs-lc" preserveAspectRatio="none" role="img" aria-label="Evolução da medição: ${fmtPct1(last.y)}% no último período">
    ${grid}<path class="rs-lc-area" d="${area}"/><path class="rs-lc-line" d="${line}"/>${dots}
    <text x="${X(pts.length-1).toFixed(1)}" y="${Math.max(12,Y(last.y)-7).toFixed(1)}" text-anchor="end" class="rs-lc-val">${fmtPct1(last.y)}%</text>${xlabs}</svg>`;
}
function buildResumoPane(o,raw){
  const orig=num(raw.valor_original);
  const aditRows=o.aditivos||[];
  // `o.aditivo` já foi corrigido no loadData (Σ repercussão líquida dos aditivos,
  // fallback total_aditivo) — o campo cru do contrato vem zerado em ~1/3 dos casos.
  const adit=num(o.aditivo);
  // acréscimo BRUTO (Σ valor_aprovado) — é o que o art. 125 da Lei 14.133/2021 limita
  // a 25%; supressões não entram nessa conta (usado só nos "pontos de atenção", R5).
  const multiObra=(o.nObras||1)>1;
  const origC=num(o.valorOriginalContrato)||orig;        // valor original do CONTRATO (todas as obras)
  // art. 125: acréscimo BRUTO ÷ valor original DO CONTRATO (o limite legal é do contrato,
  // e os aditivos_contrato não separam por obra).
  const pctAcr=origC?aditRows.reduce((s,a)=>s+num(a.valor_aprovado),0)/origC*100:0;
  const med=medObraStats(o);                             // medição NO NÍVEL DA OBRA
  const medTot=med.total, medPct=med.pct;
  const pR=medPct==null?0:Math.max(0,Math.min(100,medPct)); // % para as barras (clamp 0-100)
  const pctAdit=orig?adit/orig*100:0;                    // repercussão líquida da OBRA ÷ valor original da OBRA
  const pct1=v=>fmtPct1(v)+'%';
  const dd=n=>NUM.format(Math.abs(n))+' dia'+(Math.abs(n)===1?'':'s');
  const cExec=prazoCalc(raw.data_inicio_real,raw.data_fim_previsto);
  const cVig=prazoCalc(raw.data_inicio_real,raw.data_fim_vigencia_contrato);
  const paral=num(raw.dias_paralisado);
  const com=(o.comissao&&o.comissao.length)?o.comissao:[];
  const fiscalResp=pickFiscal(com);

  // ---- R1 — cartão de identificação (objeto + grade de 4) ----
  const idCell=(label,val,sub)=>`<div class="rs-id-cell"><div class="rs-lbl">${label}</div><div class="rs-id-v">${val}</div>${sub?`<div class="rs-id-sub">${sub}</div>`:''}</div>`;
  const fiscSub=`${com.length?NUM.format(com.length)+' membro'+(com.length===1?'':'s'):'sem comissão'} · <button type="button" class="mlink" id="mResumoVerComissao">ver aba &rarr;</button>`;
  const r1=`<div class="rs-row"><div class="rs-id">
    <div><div class="rs-lbl">${RS_ICO.obj} Objeto ${multiObra?'da obra':'do contrato'}</div><div class="rs-obj-txt">${escHtml(o.objeto)}</div></div>
    <div class="rs-id-grid">
      ${idCell('Município', fmtVal(raw.municipio||o.municipioTxt))}
      ${idCell('Distrito Operacional', fmtVal(raw.distrito_operacional))}
      ${idCell('Contratada', fmtVal(raw.contratada), 'CNPJ '+fmtCNPJ(raw.cnpj_contratada))}
      ${idCell('Fiscalização', fiscalResp?escHtml(fiscalResp.nome):'—', fiscSub)}
    </div></div></div>`;

  // ---- R2 — 2 cartões de status (obra / contrato), cor de TOKENS.status* ----
  const stCard=(label,word,c,ini,fim,colOverride,extra)=>{
    const fill=colOverride||(c?c.color:null)||'var(--text-dim)';        // preenchimento (ponto, barra)
    const txt=colOverride?statusTextColor(colOverride):(c?statusTextColor(c.color):'var(--text-dim)'); // texto (AA)
    return `<div class="rs-st">
      <div class="rs-st-head"><i class="rs-st-dot" style="background:${fill}"></i>
        <div class="rs-st-hx"><div class="rs-lbl">${label}</div><div class="rs-st-word" style="color:${txt}">${word||'—'}</div></div></div>
      <div class="rs-st-dates"><span>${fmtDateBR(ini)}</span><span>${fmtDateBR(fim)}</span></div>
      <div class="rs-st-track"><i style="width:${c?c.pct.toFixed(1):0}%;background:${fill}"></i></div>
      <div class="rs-st-days" style="color:${c?statusTextColor(c.color):'var(--text-dim)'}">${c?escHtml(c.daysTxt):'datas insuficientes'}</div>
      ${extra||''}</div>`;
  };
  const obraCol=paral>0?TOKENS.statusStop:(cExec?cExec.color:null);
  const r2=`<div class="rs-row rs-status">`
    +stCard('Situação da obra', fmtVal(raw.status_obra), cExec, raw.data_inicio_real, raw.data_fim_previsto, obraCol,
       paral>0?`<div class="rs-st-paral">Paralisada há ${dd(paral)}</div>`:'')
    +stCard('Situação do contrato', fmtVal(raw.status_contrato), cVig, raw.data_inicio_real, raw.data_fim_vigencia_contrato)
    +`</div>`;

  // ---- R3 — faixa de 4 indicadores ----
  // O card "Aditivos" mostra a REPERCUSSÃO LÍQUIDA (adit = Σ acréscimo − supressão),
  // que pode ser NEGATIVA (supressão líquida): sinal explícito ("−"), barra travada
  // em ≥0, cor neutra. O limite do art. 125 (acréscimo BRUTO) é aferido à parte, no
  // R5, com pctAcr — não nesta barra.
  const aditCol=pctAdit>=25?TOKENS.statusStop:pctAdit>=10?TOKENS.amber:TOKENS.ng;
  const aditSubColor=adit<0?'var(--text-dim)':statusTextColor(aditCol);
  const aditPctTxt=`${adit<0?'−':'+'}${pct1(Math.abs(pctAdit))}`;
  const aditContrato=aditRows.reduce((s,a)=>s+num(a.valor_repercussao),0); // Σ nível contrato
  const saldo=med.saldo;
  const valTxt=multiObra?'do valor da obra':'do valor atual';
  const heroCard=`<div class="rs-card rs-hero"><span class="rs-ic sm">${RS_ICO.valor}</span><div class="rs-lbl">Valor ${multiObra?'desta obra':'atual do contrato'}</div>
    <div class="rs-num big">${BRL2.format(o.valor)}</div>
    <div class="rs-card-sub">Original: ${BRL2.format(orig)}</div>
    ${multiObra?`<div class="rs-card-sub">Contrato (todas as obras): ${BRL2.format(num(o.valorContrato))}</div>`:''}</div>`;
  const aditCard=`<div class="rs-card"><div class="rs-lbl">Aditivos${multiObra?' da obra':''}</div>
    <div class="rs-num">${signedBRL(adit)}</div>
    <div class="rs-card-sub" style="color:${aditSubColor}">${aditPctTxt} sobre o valor original</div>
    ${multiObra?`<div class="rs-card-sub">Contrato: ${signedBRL(aditContrato)}</div>`:''}
    <div class="rs-bar"><i style="width:${Math.max(0,Math.min(100,pctAdit/25*100)).toFixed(1)}%;background:${adit<0?'var(--text-dim)':aditCol}"></i></div></div>`;
  const medCard=`<div class="rs-card"><div class="rs-lbl">Total medido${multiObra?' na obra':''}</div>
    <div class="rs-num">${medTot==null?'—':BRL2.format(medTot)}</div>
    <div class="rs-card-sub">${medPct==null?(med.fonte==='nenhuma'?'sem medições registradas':'—'):pct1(medPct)+' '+valTxt}${med.fonte==='ficha'?' (ficha do contrato)':''}</div>
    ${multiObra&&o.ficha&&o.ficha.percentual_total_medido!=null?`<div class="rs-card-sub">Contrato: ${fmtPct1(num(o.ficha.percentual_total_medido))}% medido</div>`:''}
    <div class="rs-bar"><i class="g" style="width:${pR.toFixed(1)}%"></i></div></div>`;
  const saldoCard=`<div class="rs-card"><div class="rs-lbl">Saldo a medir</div>
    <div class="rs-num">${saldo==null?'—':BRL2.format(saldo)}</div>
    <div class="rs-card-sub">${medPct==null?'—':pct1(Math.max(0,100-pR))+' '+valTxt}</div>
    <div class="rs-bar"><i class="b" style="width:${medPct==null?0:Math.max(0,100-pR).toFixed(1)}%"></i></div></div>`;
  const r3=`<div class="rs-row rs-ind">${heroCard}${aditCard}${medCard}${saldoCard}</div>`;

  // ---- R4 — curva de evolução da medição (largura total, com grade) ----
  // acumula o `total` LÍQUIDO por período (glosas já descontadas), na ordem de nr_medicao
  // (o.medicoes já vem ordenado de fetchMedicoes). Denominador = `med.denom` (valor DA
  // OBRA) — o mesmo dos cards de medição; assim a curva e o card "% executado" fecham.
  const meds=o.medicoes||[];
  const medDenom=med.denom;
  let accMed=0;
  const pts=meds.map(m=>{ accMed+=num(m.total); return {label:m.periodo, y:medDenom?accMed/medDenom*100:0}; }).filter(p=>isFinite(p.y));
  const lastM=meds[meds.length-1];
  const ultimaTxt=lastM?`Última medição: ${fmtVal(lastM.periodo)}${lastM.nr_medicao!=null?' · '+NUM.format(lastM.nr_medicao)+'ª':''}`:'';
  const r4=`<div class="rs-row"><div class="rs-chartbox">
    <div class="rs-cb-head"><div class="rs-lbl">${RS_ICO.chart} Evolução da medição (%)</div>${ultimaTxt?`<span class="rs-cb-sub">${escHtml(ultimaTxt)}</span>`:''}</div>
    ${rsLineChart(pts)}</div></div>`;

  // ---- R5 — pontos de atenção (só rotula valores já exibidos; limiares fixos) ----
  const att=[];
  if(paral>0) att.push([TOKENS.statusStop, `Obra paralisada há ${dd(paral)}.`]);
  if(cExec&&cExec.overdue) att.push([TOKENS.statusStop, `Prazo de execução vencido há ${dd(cExec.remainingDays)}.`]);
  else if(cExec&&cExec.color===TOKENS.amber) att.push([TOKENS.amber, `Prazo de execução encerra em ${dd(cExec.remainingDays)}.`]);
  if(cVig&&cVig.overdue) att.push([TOKENS.statusStop, `Vigência contratual vencida há ${dd(cVig.remainingDays)}.`]);
  if(pctAcr>=25) att.push([TOKENS.statusStop, `Acréscimos somam ${pct1(pctAcr)} do valor original — acima do limite de 25% do art. 125 da Lei 14.133/2021.`]);
  else if(pctAdit>=10) att.push([TOKENS.amber, `Aditivos somam ${pct1(pctAdit)} do valor original.`]);
  if(!att.length) att.push([TOKENS.ng, 'Nenhum ponto de atenção identificado neste contrato.']);
  const r5=`<div class="rs-row"><div class="rs-att">
    <div class="rs-lbl">${RS_ICO.clock} Pontos de atenção</div>
    <div class="rs-att-grid">${att.map(([c,t])=>`<div class="rs-att-i"><i style="background:${c}"></i><span>${escHtml(t)}</span></div>`).join('')}</div>
  </div></div>`;

  // ---- R6 — "Detalhes do contrato" recolhível (fechado por padrão). Reusa .adToggle. ----
  const detFields=[
    ['CÓDIGO DA OBRA', fmtVal(raw.codigo_obra)],
    ['TIPO DE CONTRATO', fmtVal(raw.descricao_tipo_contrato||o.tipo)],
    ['SAC', fmtVal(raw.nr_contrato_sic)],
    ['ORDEM DE SERVIÇO', fmtVal(raw.nr_os)],
    ['DATA DE ASSINATURA', fmtDateBR(raw.data_assinatura)],
    ['CONTRATANTE', fmtVal(raw.contratante)],
    ['CNPJ DO CONTRATANTE', fmtCNPJ(raw.cnpj_contratante)],
    ['TOTAL DE REAJUSTE', BRL2.format(num(raw.total_reajuste))],
    ['TOTAL REALINHADO', BRL2.format(num(raw.total_realinhado))],
  ];
  const detalhes=`<button type="button" class="adToggle" data-target="mDetList" aria-expanded="false" aria-controls="mDetList">`
    +`<span>Detalhes do contrato</span> <span class="adToggle-car">&#9662;</span></button>`
    +`<div id="mDetList" hidden><div class="mgrid" style="margin-top:10px">`
    +detFields.map(([l,d])=>`<div><div class="l">${l}</div><div class="d">${d}</div></div>`).join('')
    +`</div></div>`;
  return r1+r2+r3+r4+r5+detalhes;
}
// obra atualmente exibida no modal — guardada só para redesenhar o modal na troca
// de tema ao vivo (os gráficos internos carregam cor de TOKENS no innerHTML).
let _lastModalObra=null;
function openModal(o){
  _lastModalObra=o;
  const raw=o.raw||{};
  const resumoHTML=buildResumoPane(o,raw);
  const fiscalizacaoHTML=buildFiscalizacaoPane(o);
  const adValorHTML=buildAdValorPane(o,raw);
  const adPrazoHTML=buildAdPrazoPane(o,raw);
  const medicoesHTML=buildMedicoesPane(o,raw);
  const eletricaHTML=buildEletricaPane(o);
  // "Localizar no mapa": fecha o modal e navega até o município da obra (nível 3),
  // pelo mesmo goCity() de um clique no mapa — não altera filtros, métrica nem escopo.
  const munCod=o.municipioTxt?NAMEIDX[normTxt(o.municipioTxt)]:null;
  const munTxt=escHtml(o.municipioTxt||raw.municipio||'');
  const locateBtn=munCod
    ? `<button type="button" class="m-locate" id="modalLocate" title="Fechar e ver ${munTxt} no mapa">${PIN_SVG}<span>Localizar no mapa</span></button>`
    : `<button type="button" class="m-locate" id="modalLocate" disabled title="Este contrato não tem município mapeável no Ceará">${PIN_SVG}<span>Localizar no mapa</span></button>`;
  document.getElementById('modal').innerHTML=
    `<div class="mtop" data-tab="resumo">
       <div class="mh"><div class="mh-titles">
           <div class="mt">DADOS DO CONTRATO Nº ${fmtContratoExt(raw.nr_contrato_ext)}</div>
           ${(o.nObras||1)>1?`<div class="mobra">${RS_ICO.dist}<span>Obra ${escHtml(o.codigo_obra||('#'+o.id_obra))} · uma das obras deste contrato</span></div>`:''}
           <div class="msub">${RS_ICO.chart}<span>Resumo executivo do contrato</span></div></div>
         <div class="mh-actions">${locateBtn}<button class="mx" id="modalX" aria-label="Fechar">✕</button></div></div>
       <div class="mtabs" role="tablist">
         <button type="button" class="mtab on" role="tab" aria-selected="true" aria-controls="mPaneResumo" data-tab="resumo">Resumo</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneAdValor" data-tab="aditivos-valor">Aditivos de valor</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneAdPrazo" data-tab="aditivos-prazo">Aditivos de prazo</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneMedicoes" data-tab="medicoes">Medições</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneFiscalizacao" data-tab="fiscalizacao">Fiscalização</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneEletrica" data-tab="eletrica">Elétrica</button>
       </div>
     </div>
     <div class="mbody" data-tab="resumo">
       <div class="mobj">${escHtml(o.objeto)}</div>
       <div class="mpane" id="mPaneResumo" role="tabpanel" data-pane="resumo">${resumoHTML}</div>
       <div class="mpane" id="mPaneAdValor" role="tabpanel" data-pane="aditivos-valor" hidden>${adValorHTML}</div>
       <div class="mpane" id="mPaneAdPrazo" role="tabpanel" data-pane="aditivos-prazo" hidden>${adPrazoHTML}</div>
       <div class="mpane" id="mPaneMedicoes" role="tabpanel" data-pane="medicoes" hidden>${medicoesHTML}</div>
       <div class="mpane" id="mPaneFiscalizacao" role="tabpanel" data-pane="fiscalizacao" hidden>${fiscalizacaoHTML}</div>
       <div class="mpane" id="mPaneEletrica" role="tabpanel" data-pane="eletrica" hidden>${eletricaHTML}</div>
       <div class="mupd">Atualizado em ${fmtDateTimeBR(raw.atualizado_em)}</div>
     </div>`;
  document.getElementById('modalBg').classList.add('show');
  document.getElementById('modalX').onclick=closeModal;
  const _loc=document.getElementById('modalLocate');
  if(_loc && munCod) _loc.onclick=()=>{ closeModal(); goCity(munCod); };
  const _vc=document.getElementById('mResumoVerComissao');
  if(_vc) _vc.onclick=()=>{ const t=document.querySelector('.modal .mtab[data-tab="fiscalizacao"]'); if(t) t.click(); };
  wireModalTabs();
  wireAdToggles();
  wireEletricaPane(o);
}
// Aba "Fiscalização": fiscal titular em destaque + suplente (se houver) + comissão
// completa. Ordenação/classificação já vêm prontas de fetchFiscais (rank desc via
// classifyComissao). A matrícula (comissao_fiscalizacao.matricula) aparece quando
// preenchida — nem todo integrante tem.
function buildFiscalizacaoPane(o){
  const com=(o.comissao&&o.comissao.length)?o.comissao:[];
  if(!com.length) return `<div class="empty">Sem dados de fiscalização para este contrato.</div>`;
  // com[] já vem ordenado por rank de EXIBIÇÃO (fetchFiscais). O fiscal responsável
  // NÃO é necessariamente com[0] — é pickFiscal (Fiscal, senão 1º Membro).
  const titular=pickFiscal(com);
  const suplente=com.find(m=>m.tipo==='SUPLENTE');
  // matrícula (quando houver) sempre no mesmo <span class="mcommat"> — some da lista e
  // do card sem herdar o uppercase de .rs-fi-func.
  const matTag=m=>m.matricula?` <span class="mcommat">· mat. ${escHtml(m.matricula)}</span>`:'';
  const fiCard=(label,m)=>`<div class="rs-fi-card"><span class="rs-ic sm">${RS_ICO.pessoa}</span>
    <div><div class="rs-lbl">${label}</div><div class="rs-fi-nome">${escHtml(m.nome)}</div><div class="rs-fi-func">${escHtml(m.tipo)}${matTag(m)}</div></div></div>`;
  const top=`<div class="rs-fi-top">${fiCard('Fiscal responsável',titular)}${(suplente&&suplente!==titular)?fiCard('Suplente',suplente):''}</div>`;
  const list=`<div class="msec">Comissão de fiscalização (${com.length})</div>`
    +`<div class="mcomlist">${com.map(m=>`<div class="mcomrow"><span class="mcomtipo">${escHtml(m.tipo)}</span><span class="mcomnome">${escHtml(m.nome)}${matTag(m)}</span></div>`).join('')}</div>`;
  return top+list;
}
// Aba "Elétrica" (Fase 1, grill de 24/09/2026): progresso de medição da obra (mesmo
// medObraStats do Resumo/Medições, nunca duplicado em SQL — única fonte de verdade,
// ver plano da Fase 1) + relatórios de vistoria já enviados. Marcos de 50/70/90% são
// só informativos (Q2/Q10 do grill): não bloqueiam nada, não exigem 1 relatório por
// marco — servem pra equipe se planejar. O formulário de novo relatório é montado à
// parte (Frontend parte 2), porque precisa de wiring de eventos (dropzone) que
// openModal() não repete depois de já ter montado o innerHTML.
function buildEletricaPane(o){
  const med=medObraStats(o);
  const pct=med.pct;
  const pR=pct==null?0:Math.max(0,Math.min(100,pct));
  const marcoAtingido=[...MARCOS_ELETRICA].reverse().find(m=>pR>=m);
  const rel=o.relatoriosEletrica||[];
  const progCard=`<div class="rs-card ele-prog">
    <div class="rs-lbl">${RS_ICO.chart} Medição da obra</div>
    <div class="rs-num big">${pct==null?'—':fmtPct1(pct)+'%'}</div>
    <div class="rs-card-sub">${pct==null?'sem medições registradas':marcoAtingido?`passou de ${marcoAtingido}% de medição`:'abaixo de 50% de medição'}</div>
    <div class="ele-bar-wrap">
      <div class="rs-bar"><i class="amber" style="width:${pR.toFixed(1)}%"></i></div>
      ${MARCOS_ELETRICA.map(m=>`<span class="ele-tick${pR>=m?' on':''}" style="left:${m}%" title="${m}% de medição"></span>`).join('')}
    </div>
  </div>`;
  // segundo cartão da fileira: a mesma leitura de "vistoriada/aguardando" que o painel
  // lateral usa (renderAtencaoEletrica) — resume de relance a situação da obra, sem
  // repetir os números de "Relatórios enviados" logo abaixo.
  const statusInfo = pct==null||!marcoAtingido
    ? {cls:'',txt:'Fora do radar da elétrica', sub:'abaixo do marco de atenção (50% de medição)'}
    : rel.length
      ? {cls:'ok',txt:'Vistoriada', sub:`${rel.length} relatório${rel.length===1?'':'s'} enviado${rel.length===1?'':'s'}`}
      : {cls:'warn',txt:'Aguardando vistoria', sub:`passou de ${marcoAtingido}% sem relatório enviado`};
  const statusCard=`<div class="rs-card ele-status">
    <div class="rs-lbl">${RS_ICO.clock} Situação da vistoria</div>
    <div class="ele-status-chip ${statusInfo.cls}">${statusInfo.txt}</div>
    <div class="rs-card-sub">${statusInfo.sub}</div>
  </div>`;
  const topRow=`<div class="ele-top-row">${progCard}${statusCard}</div>`;
  // só eletrica/admin (PAPEIS_ELETRICA_ESCRITA) veem os botões de agendar/inserir/
  // excluir — a trava real é a RLS de eletrica_vistorias/eletrica_vistorias_agendadas;
  // isto só evita OFERECER a ação a quem não pode gravar (mesmo espírito de
  // PAPEIS_REPLAN). wireEletricaPane() liga abrir/fechar dos diálogos depois que este
  // HTML entra no DOM.
  const podeEnviar=PAPEIS_ELETRICA_ESCRITA.includes(USER_PAPEL);
  const hoje=new Date().toISOString().slice(0,10);
  const nomeSessao=sessionStorage.getItem('sop_user_name')||'';
  // agendamento de vistoria: independente do relatório (tabelas irmãs, sem FK — ver
  // sql/create_eletrica_vistorias_agendadas.sql). Clicar na obra na lista "Atenção,
  // Elétrica!" abre esta aba direto (pedido do usuário, 24/09/2026) — daqui o
  // usuário escolhe agendar OU inserir um relatório, sem UI própria na lista.
  // Cancelamento é soft-delete (UPDATE excluido_em), nunca DELETE físico.
  const agenda=o.agendamentoEletrica;
  const agendaSecao=!podeEnviar?'':agenda
    ?`<div class="msec">Agendamento de vistoria</div>
      <div class="ele-agenda-info">
        <span>Agendada p/ <b>${fmtDateBR(agenda.data_planejada)}</b> · ${escHtml(agenda.responsavel_nome)}</span>
        <button type="button" class="ele-agenda-cancelar-btn" id="eleAgendaCancelarBtn">Cancelar agendamento</button>
      </div>`
    :`<div class="msec">Agendamento de vistoria</div>
      <button type="button" class="ele-btn ele-insert-btn" id="eleAbrirAgenda">Agendar vistoria</button>
      <div class="ele-dialog-bg" id="eleAgendaDialogBg" hidden>
        <div class="ele-dialog" role="dialog" aria-modal="true" aria-label="Agendar vistoria">
          <div class="ele-dialog-head"><span>Agendar vistoria</span>
            <button type="button" class="ele-dialog-x" id="eleAgendaDialogX" aria-label="Fechar">&times;</button></div>
          <form id="eleAgendaForm" class="eleform" novalidate>
            <div class="elefields">
              <label>Data planejada<input type="date" id="eleAgendaData" required value="${hoje}"></label>
              <label>Responsável<input type="text" id="eleAgendaResp" required maxlength="120" value="${escHtml(nomeSessao)}"></label>
            </div>
            <div class="ele-erro" id="eleAgendaErro" hidden></div>
            <button type="submit" class="ele-btn" id="eleAgendaBtnSalvar">Agendar vistoria</button>
          </form>
        </div>
      </div>`;

  // versão do relatório (V1, V2, …) = ordem de ENVIO (criado_em), não a ordem de
  // exibição da lista (que é por data_vistoria desc, ver fetchEletricaVistorias) —
  // um relatório de vistoria retroativa não deve "roubar" o número de um mais antigo.
  const versaoPorId={};
  [...rel].sort((a,b)=>String(a.criado_em||'').localeCompare(String(b.criado_em||''))).forEach((r,idx)=>{ versaoPorId[r.id]=idx+1; });
  const lista=rel.length
    ? `<div class="elelist">${rel.map(r=>`<div class="elerow" title="Enviado em ${fmtDateTimeBR(r.criado_em)}">
        <div class="elerow-line">
          <span class="elerow-ver">V${versaoPorId[r.id]}</span>
          <span class="elerow-data">${fmtDateBR(r.data_vistoria)}</span>
          <span class="elerow-resp">${escHtml(r.responsavel_nome)}</span>
          ${r.drive_web_view_link
            ?`<a class="elerow-link" href="${escHtml(r.drive_web_view_link)}" target="_blank" rel="noopener">${escHtml(r.arquivo_nome_original||'Abrir relatório')}</a>`
            :`<span class="elerow-link off">${escHtml(r.arquivo_nome_original||'Arquivo')}</span>`}
          ${podeEnviar?`<button type="button" class="elerow-excluir" data-id="${r.id}" title="Excluir relatório" aria-label="Excluir relatório de ${fmtDateBR(r.data_vistoria)}">${RS_ICO.lixeira}</button>`:''}
        </div>
        ${r.observacao?`<div class="elerow-obs">${escHtml(r.observacao)}</div>`:''}
      </div>`).join('')}</div>`
    : `<div class="empty">Nenhum relatório de vistoria enviado para esta obra ainda.</div>`;

  // formulário de novo relatório mora dentro de um diálogo próprio (pedido do
  // usuário, 24/09/2026: antes ficava sempre aberto na aba, ocupando espaço mesmo
  // quando ninguém ia enviar nada agora) — o botão "Inserir relatório" abre.
  const trigger=podeEnviar?`<button type="button" class="ele-btn ele-insert-btn" id="eleAbrirForm">Inserir relatório</button>`:'';
  const dialog=podeEnviar?`<div class="ele-dialog-bg" id="eleDialogBg" hidden>
    <div class="ele-dialog" role="dialog" aria-modal="true" aria-label="Novo relatório de vistoria">
      <div class="ele-dialog-head"><span>Novo relatório de vistoria</span>
        <button type="button" class="ele-dialog-x" id="eleDialogX" aria-label="Fechar">&times;</button></div>
      <form id="eleForm" class="eleform" novalidate>
        <div id="eleDrop" class="edrop" tabindex="0" role="button" aria-label="Selecionar relatório">
          <svg class="edrop-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>
          <p class="edrop-txt">Arraste o relatório aqui ou clique para selecionar</p>
          <div class="edrop-fmt"><span>.pdf</span><span>.doc</span><span>.docx</span></div>
          <div class="edrop-nome" id="eleArquivoNome" hidden></div>
          <input type="file" id="eleFile" accept=".pdf,.doc,.docx" hidden>
        </div>
        <div class="elefields">
          <label>Data da vistoria<input type="date" id="eleData" required value="${hoje}"></label>
          <label>Responsável<input type="text" id="eleResp" required maxlength="120" value="${escHtml(nomeSessao)}"></label>
          <label class="span2">Observação<textarea id="eleObs" maxlength="500" rows="2" placeholder="Opcional"></textarea></label>
        </div>
        <div class="ele-erro" id="eleErro" hidden></div>
        <button type="submit" class="ele-btn" id="eleBtnEnviar" disabled>Enviar relatório</button>
      </form>
    </div>
  </div>`:'';

  return topRow+agendaSecao+`<div class="msec">Relatórios enviados (${rel.length})</div>`+lista+trigger+dialog;
}
// upload multipart/related direto pra API do Google Drive v3, com o access_token de
// curta duração devolvido por eletrica-drive-token (Fase 1 — ver comentário no topo
// dessa Edge Function: o arquivo NUNCA passa pelo backend do GECOPE, só pelo Drive).
async function uploadParaDrive(accessToken,folderId,arquivo,nomeArquivo){
  const boundary='-------eletrica'+Math.random().toString(36).slice(2);
  const metadata={name:nomeArquivo,parents:[folderId]};
  const corpo=new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${arquivo.type}\r\n\r\n`,
    arquivo,
    `\r\n--${boundary}--`,
  ]);
  const resp=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',{
    method:'POST',
    headers:{Authorization:'Bearer '+accessToken,'Content-Type':`multipart/related; boundary=${boundary}`},
    body:corpo,
  });
  if(!resp.ok) throw new Error('O Google Drive recusou o upload (HTTP '+resp.status+'). Tente novamente.');
  return resp.json(); // {id, webViewLink}
}
const ELE_TIPOS_ACEITOS={'application/pdf':1,'application/msword':1,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':1};
const ELE_TAMANHO_MAX=20*1024*1024; // 20MB — mesmo teto validado em eletrica-drive-token
// liga a dropzone e o submit do formulário de novo relatório. Chamada de novo a cada
// re-render da aba (sucesso de envio redesenha só #mPaneEletrica), então os listeners
// antigos morrem com o innerHTML velho — mesmo padrão de wireModalTabs/openModal.
function wireEletricaPane(o){
  const pane=document.getElementById('mPaneEletrica'); if(!pane) return;
  // botão "Excluir" de cada relatório: soft delete (mesma UPDATE+excluido_em de
  // sql/create_eletrica_vistorias.sql) — não depende do formulário existir, mas só
  // é renderizado junto com ele (mesma trava PAPEIS_ELETRICA_ESCRITA).
  pane.querySelectorAll('.elerow-excluir').forEach(btnDel=>{
    btnDel.addEventListener('click',async()=>{
      if(!window.confirm('Excluir este relatório de vistoria? Essa ação não pode ser desfeita pelo app.')) return;
      btnDel.disabled=true;
      const{error}=await window.sbClient.from('eletrica_vistorias').update({excluido_em:new Date().toISOString()}).eq('id',btnDel.dataset.id);
      if(error){ window.alert('Não consegui excluir o relatório agora. Tente novamente.'); btnDel.disabled=false; return; }
      const novo=await fetchEletricaVistorias([o.id_obra]).catch(()=>null);
      o.relatoriosEletrica=novo?(novo[o.id_obra]||[]):(o.relatoriosEletrica||[]).filter(r=>String(r.id)!==String(btnDel.dataset.id));
      pane.innerHTML=buildEletricaPane(o);
      wireEletricaPane(o);
      invalidateSessionCache(); renderAtencaoEletrica();
    });
  });
  // "Cancelar agendamento": soft delete (mesma UPDATE+excluido_em de
  // sql/create_eletrica_vistorias_agendadas.sql).
  const btnCancelarAgenda=pane.querySelector('#eleAgendaCancelarBtn');
  if(btnCancelarAgenda) btnCancelarAgenda.addEventListener('click',async()=>{
    if(!o.agendamentoEletrica) return;
    if(!window.confirm('Cancelar o agendamento de vistoria desta obra?')) return;
    btnCancelarAgenda.disabled=true;
    const{error}=await window.sbClient.from(SB_ELETRICA_AGENDA).update({excluido_em:new Date().toISOString()}).eq('id',o.agendamentoEletrica.id);
    if(error){ window.alert('Não consegui cancelar o agendamento agora. Tente novamente.'); btnCancelarAgenda.disabled=false; return; }
    o.agendamentoEletrica=null;
    pane.innerHTML=buildEletricaPane(o);
    wireEletricaPane(o);
    invalidateSessionCache(); renderAtencaoEletrica();
  });
  // "Agendar vistoria" abre um diálogo próprio (mesmo padrão do de "Inserir
  // relatório" logo abaixo) com data planejada + responsável.
  const agendaDialogBg=pane.querySelector('#eleAgendaDialogBg');
  const agendaTrigger=pane.querySelector('#eleAbrirAgenda');
  if(agendaTrigger&&agendaDialogBg){
    const agendaDialogX=pane.querySelector('#eleAgendaDialogX');
    agendaTrigger.onclick=()=>{ agendaDialogBg.hidden=false; };
    if(agendaDialogX) agendaDialogX.onclick=()=>{ agendaDialogBg.hidden=true; };
    agendaDialogBg.addEventListener('click',e=>{ if(e.target===agendaDialogBg) agendaDialogBg.hidden=true; });
  }
  const agendaForm=pane.querySelector('#eleAgendaForm');
  if(agendaForm) agendaForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const data=pane.querySelector('#eleAgendaData').value;
    const resp=pane.querySelector('#eleAgendaResp').value.trim();
    const elErroAgenda=pane.querySelector('#eleAgendaErro');
    const setErroAgenda=m=>{ if(elErroAgenda){ elErroAgenda.textContent=m||''; elErroAgenda.hidden=!m; } };
    if(!data){ setErroAgenda('Informe a data planejada.'); return; }
    if(!resp){ setErroAgenda('Informe o responsável.'); return; }
    setErroAgenda('');
    const btnSalvar=pane.querySelector('#eleAgendaBtnSalvar');
    btnSalvar.disabled=true; const txtOriginal=btnSalvar.textContent; btnSalvar.textContent='Agendando…';
    try{
      const{data:sessao}=await window.sbClient.auth.getSession();
      const email=sessao&&sessao.session&&sessao.session.user?sessao.session.user.email:'';
      const{data:inserida,error}=await window.sbClient.from(SB_ELETRICA_AGENDA)
        .insert({id_obra:o.id_obra,data_planejada:data,responsavel_nome:resp,criado_por_email:email||''})
        .select(ELETRICA_AGENDA_COLS).single();
      if(error) throw error;
      o.agendamentoEletrica=inserida;
      pane.innerHTML=buildEletricaPane(o);
      wireEletricaPane(o);
      invalidateSessionCache(); renderAtencaoEletrica();
    }catch(err){
      setErroAgenda('Não consegui salvar o agendamento agora. Tente novamente.');
      btnSalvar.disabled=false; btnSalvar.textContent=txtOriginal;
    }
  });
  // "Inserir relatório" abre o diálogo com o formulário/dropzone — antes ficava
  // sempre aberto na aba (pedido do usuário, 24/09/2026).
  const dialogBg=pane.querySelector('#eleDialogBg');
  const trigger=pane.querySelector('#eleAbrirForm');
  if(trigger&&dialogBg){
    const dialogX=pane.querySelector('#eleDialogX');
    trigger.onclick=()=>{ dialogBg.hidden=false; };
    if(dialogX) dialogX.onclick=()=>{ dialogBg.hidden=true; };
    dialogBg.addEventListener('click',e=>{ if(e.target===dialogBg) dialogBg.hidden=true; });
  }
  const form=pane.querySelector('#eleForm'); if(!form) return; // sem permissão: formulário não existe
  const drop=form.querySelector('#eleDrop'), input=form.querySelector('#eleFile');
  const btn=form.querySelector('#eleBtnEnviar'), elErro=form.querySelector('#eleErro');
  const elNome=form.querySelector('#eleArquivoNome');
  let arquivo=null;

  function setErro(msg){ elErro.textContent=msg||''; elErro.hidden=!msg; }
  function limparSelecao(){ arquivo=null; elNome.hidden=true; elNome.textContent=''; btn.disabled=true; }
  function selecionarArquivo(f){
    setErro('');
    if(!ELE_TIPOS_ACEITOS[f.type]){ limparSelecao(); setErro('Envie um arquivo PDF, DOC ou DOCX.'); return; }
    if(f.size>ELE_TAMANHO_MAX){ limparSelecao(); setErro('Arquivo maior que o limite de 20MB.'); return; }
    arquivo=f; elNome.textContent=f.name; elNome.hidden=false; btn.disabled=false;
  }

  drop.onclick=()=>input.click();
  drop.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); input.click(); } };
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop',e=>{ if(e.dataTransfer.files[0]) selecionarArquivo(e.dataTransfer.files[0]); });
  input.addEventListener('change',()=>{ if(input.files[0]) selecionarArquivo(input.files[0]); });
  // solto fora da caixa mas ainda dentro da aba: sem isso o navegador navega pro
  // arquivo (sai do SPA) — mesmo guard de curva_abc.js:943-944, aplicado ao pane.
  pane.addEventListener('dragover',e=>e.preventDefault());
  pane.addEventListener('drop',e=>{ e.preventDefault(); if(e.target===drop||drop.contains(e.target)) return; if(e.dataTransfer.files[0]) selecionarArquivo(e.dataTransfer.files[0]); });

  form.onsubmit=async(e)=>{
    e.preventDefault();
    const dataVistoria=form.querySelector('#eleData').value;
    const responsavel=form.querySelector('#eleResp').value.trim();
    const observacao=form.querySelector('#eleObs').value.trim();
    if(!arquivo){ setErro('Selecione um arquivo.'); return; }
    if(!dataVistoria){ setErro('Informe a data da vistoria.'); return; }
    if(!responsavel){ setErro('Informe o responsável.'); return; }
    setErro('');
    btn.disabled=true; const txtOriginal=btn.textContent; btn.textContent='Enviando…';
    let drive, tokenJson;
    try{
      const {data:sessao}=await window.sbClient.auth.getSession();
      const token=sessao&&sessao.session?sessao.session.access_token:null;
      const emailUsuario=sessao&&sessao.session&&sessao.session.user?sessao.session.user.email:'';
      if(!token) throw new Error('Sua sessão do GECOPE expirou. Entre novamente.');
      const tokenResp=await fetch(`${SB_URL}/functions/v1/eletrica-drive-token`,{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,apikey:SB_KEY},
        body:JSON.stringify({id_obra:o.id_obra,arquivo_mime:arquivo.type,arquivo_tamanho_bytes:arquivo.size}),
      });
      tokenJson=await tokenResp.json().catch(()=>({}));
      if(!tokenResp.ok||!tokenJson.ok) throw new Error(tokenJson.erro||'Não consegui autorizar o envio agora. Tente novamente.');

      const nomeSeguro=responsavel.replace(/[\\/:*?"<>|]/g,'-');
      const nomeNoDrive=`${dataVistoria}_${nomeSeguro}_${arquivo.name}`;
      drive=await uploadParaDrive(tokenJson.accessToken,tokenJson.folderId,arquivo,nomeNoDrive);

      const {error:erroInsert}=await window.sbClient.from('eletrica_vistorias').insert({
        id_obra:o.id_obra, data_vistoria:dataVistoria, responsavel_nome:responsavel, observacao:observacao||null,
        arquivo_nome_original:arquivo.name, arquivo_mime:arquivo.type, arquivo_tamanho_bytes:arquivo.size,
        drive_file_id:drive.id, drive_folder_id:tokenJson.folderId, drive_web_view_link:drive.webViewLink||null,
        criado_por_email:emailUsuario||'',
      });
      if(erroInsert) throw new Error('O arquivo foi enviado ao Drive, mas não consegui salvar o registro: '+erroInsert.message);
    }catch(err){
      setErro((err&&err.message)||'Não consegui enviar o relatório agora. Tente novamente.');
      btn.disabled=false; btn.textContent=txtOriginal;
      return;
    }
    // Envio e gravação JÁ confirmados neste ponto — uma falha daqui em diante é só de
    // ATUALIZAÇÃO DA TELA, não do envio. Tratada à parte para não fazer o usuário
    // reenviar (e duplicar) um relatório que já foi salvo com sucesso.
    try{
      const novo=await fetchEletricaVistorias([o.id_obra]);
      o.relatoriosEletrica=novo[o.id_obra]||[];
      pane.innerHTML=buildEletricaPane(o);
      wireEletricaPane(o);
      invalidateSessionCache(); renderAtencaoEletrica(); // painel "Atenção elétrica" reflete o novo relatório
    }catch(err){
      setErro('Relatório enviado com sucesso, mas não consegui atualizar a lista aqui. Feche e reabra esta obra para ver.');
      btn.textContent=txtOriginal;
    }
  };
}
// troca de aba: cada openModal() reconstrói o innerHTML do zero, então os listeners
// são refeitos a cada abertura — igual ao padrão já usado pro botão de fechar/comissão.
function wireModalTabs(){
  const tabs=[...document.querySelectorAll('.modal .mtab')];
  const body=document.querySelector('.modal .mbody');
  const top=document.querySelector('.modal .mtop');
  tabs.forEach(t=>t.onclick=()=>{
    tabs.forEach(x=>{ const on=x===t; x.classList.toggle('on',on); x.setAttribute('aria-selected',String(on)); });
    document.querySelectorAll('.modal .mpane').forEach(p=>{ p.hidden=p.dataset.pane!==t.dataset.tab; });
    if(body) body.dataset.tab=t.dataset.tab; // a aba Resumo esconde a linha .mobj (o objeto já está no cartão)
    if(top) top.dataset.tab=t.dataset.tab;   // e o subtítulo "Resumo executivo do contrato" no cabeçalho
    // telas estreitas: as abas não cabem todas; traz a aba ativa para dentro da faixa
    // rolável (block:'nearest' evita pulo vertical da página).
    try{ t.scrollIntoView({inline:'nearest',block:'nearest'}); }catch(_){}
  });
}
// mesmo padrão do botão de comissão (Dados Gerais), generalizado pros 2 toggles de
// lista de aditivo (valor/prazo) — reconstruído a cada openModal(), então não precisa
// de delegação de evento nem de limpar listener velho.
function wireAdToggles(){
  document.querySelectorAll('.modal .adToggle, .modal .dsh-tile[data-target]').forEach(btn=>{
    btn.onclick=()=>{
      const el=document.getElementById(btn.dataset.target); if(!el) return;
      const willOpen=el.hidden;
      el.hidden=!willOpen; btn.setAttribute('aria-expanded',String(willOpen));
      const car=btn.querySelector('.adToggle-car'); if(car) car.textContent=willOpen?'▴':'▾';
      // Abriu por um ladrilho lá em cima, a lista pode estar fora da tela — sem isso o
      // clique "não faz nada" aos olhos de quem não rolou a janela primeiro.
      if(willOpen) requestAnimationFrame(()=>el.scrollIntoView({behavior:'smooth',block:'nearest'}));
    };
  });
  // Ladrilho que só aponta pra uma seção JÁ visível (ex.: "Fiscais no período" → os
  // cartões de Fiscalização, que nunca ficam escondidos) — sem esconder/mostrar, só rola.
  document.querySelectorAll('.modal .dsh-tile[data-scrollto]').forEach(btn=>{
    btn.onclick=()=>{
      const el=document.getElementById(btn.dataset.scrollto); if(!el) return;
      el.scrollIntoView({behavior:'smooth',block:'start'});
    };
  });
}
function closeModal(){ escondeEdTip(); document.getElementById('modalBg').classList.remove('show'); delete document.getElementById('modal').dataset.rpDistrito; }
// Fecha OU volta um nível: se a janela do fiscal está aberta por cima de um distrito
// (o botão "#modalVoltar" existe), Esc e clicar fora devem se comportar como o próprio
// "← Voltar" faria — não só o clique nele. Sem isso os dois gestos mais comuns de
// dispensar um modal reabriam exatamente o beco que a E5 devia fechar (achado do
// rev-produto, 2026-09-18): o "✕" ganhava o "Voltar", mas Esc/clicar fora continuavam
// pulando direto pro mapa, perdendo a janela de distrito de origem.
// `closeModal` não limpa o innerHTML do `#modal` (só esconde), então "#modalVoltar" da
// última janela renderizada continua existindo no DOM, escondido, depois de fechar. Sem
// este guard, apertar Esc DEPOIS de já ter fechado tudo clicaria nesse botão fantasma e
// REABRIRIA o modal — pior que o beco original. Só age com o modal de fato visível.
function fecharOuVoltar(){
  // diálogos da aba Elétrica ("novo relatório"/"agendar vistoria") são uma camada
  // acima do modal — Esc fecha o que estiver aberto primeiro, mesmo padrão de
  // early-return por camada já usado no handler de Esc que limpa a seleção combinada
  // (checa modalBg/.msel.on/fullscreen abaixo).
  for(const id of ['eleDialogBg','eleAgendaDialogBg']){
    const dlg=document.getElementById(id);
    if(dlg&&!dlg.hidden){ dlg.hidden=true; return; }
  }
  if(!document.getElementById('modalBg').classList.contains('show')) return;
  const v=document.getElementById('modalVoltar'); if(v){ v.click(); return; } closeModal();
}
document.getElementById('modalBg').addEventListener('click',e=>{ if(e.target.id==='modalBg') fecharOuVoltar(); });
// E5 — a janela de distrito lista a equipe em cartões (.fcard), e cada um abre o painel
// daquele fiscal por cima. #modal fica fora de #body, então precisa do próprio listener.
// `dataset.rpDistrito` (gravado por abreModalDistrito, sobrevive à troca de innerHTML)
// é de onde a janela do fiscal sabe que foi aberta por cima de um distrito, e não do
// ranking lateral — é essa origem que decide se o cabeçalho mostra "← Voltar" ou "✕".
document.getElementById('modal').addEventListener('click',e=>{
  const abre=e.target.closest('.chip.abre');
  if(abre){ abrirJanela(abre); return; }
  const fc=e.target.closest('.fcard');
  if(fc){ abreModalFiscal(fc.dataset.mat,document.getElementById('modal').dataset.rpDistrito); return; }
});
document.getElementById('modal').addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ') return;
  const abre=e.target.closest('.chip.abre');
  if(abre){ e.preventDefault(); abrirJanela(abre); return; }
  const fc=e.target.closest('.fcard');
  if(fc){ e.preventDefault(); abreModalFiscal(fc.dataset.mat,document.getElementById('modal').dataset.rpDistrito); return; }
  const tl=e.target.closest('.dsh-tile[role="button"]');
  if(tl){ e.preventDefault(); tl.click(); }
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape') fecharOuVoltar(); });
// Esc limpa a seleção combinada (Ctrl+clique) — mas só quando não há nada "mais
// em cima" pra fechar primeiro (modal aberto, dropdown de filtro aberto), senão
// um só Esc fecharia o modal E perderia a seleção ao mesmo tempo, e só fora de
// tela cheia: dentro dela o navegador reserva o Esc pra sair da tela cheia (não
// dá pra bloquear isso por código, é assim de propósito, por segurança — já
// tentamos religar a tela cheia em seguida e não é confiável, o navegador
// bloqueia de propósito essa reentrada). Sair da tela cheia (botão OU Esc) nunca
// mexe na seleção — ela só é limpa clicando em espaço vazio do mapa (ver
// map.on('click',...) mais abaixo) ou no botão/chip dedicados no painel.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape' || !st.sel) return;
  if(document.getElementById('modalBg').classList.contains('show')) return;
  if(document.querySelector('.msel.on')) return;
  if(document.fullscreenElement) return;
  if(isSiblingPopoverOpen()) return; // mesma regra: fecha o popover de irmãos primeiro, não perde a seleção no mesmo Esc
  clearSelection();
});
// Etapa C: genérico — qualquer chave de st.f que seja um Set com itens conta como
// filtro ativo (não só as que já têm def em FILTER_DEFS).
function hasActiveFilter(){ return !!st.f.q || Object.keys(st.f).some(k=>st.f[k] instanceof Set && st.f[k].size>0)
  || (st.metric==='eletrica' && !!eleFiltroCategoria && eleFiltroCategoria!=='atencao'); }
// Etapa C — sufixo "· N contrato(s) encontrado(s)" na linha de escopo do painel,
// visível em TODOS os níveis quando há filtro ativo (o nível Estado/Distritos já
// tinha o seu; aqui cobre distrito, município e seleção combinada). N sai de
// aggIds → obrasOf → passF, a mesma fonte de tudo no painel.
function resultsSuffix(ids){
  if(!hasActiveFilter()) return '';
  const n=aggIds(ids).obras;
  return ` · <b>${NUM.format(n)}</b> contrato${n===1?'':'s'} encontrado${n===1?'':'s'}`;
}
// Descreve o recorte REAL, não o nível de navegação. scopeIds() também honra
// st.sel (Ctrl+clique) e st.hoverGroup (mouse sobre um distrito no nível 1) — e
// passar o mouse é o gesto mais comum do mapa. Derivar o rótulo só de st.level
// fazia o painel trocar os números para um distrito e continuar escrito
// "Ceará . Todos os Distritos Operacionais".
function escopoReplanTxt(){
  if(st.sel && st.sel.ids.size){
    const k=st.sel.kind==='group'?'distrito':'município', n=st.sel.ids.size;
    return `${NUM.format(n)} ${k}${n===1?'':'s'} selecionado${n===1?'':'s'}`;
  }
  if(st.level===1 && st.hoverGroup!=null){
    const nome=grpById(st.hoverGroup).nome.replace(/^D\.O\.\s*/,'');
    return `Obras em ${nome}`;
  }
  if(st.level<=1) return 'Ceará . Todos os Distritos Operacionais';
  if(st.level===2) return `Obras em ${grpById(st.group).nome.replace(/^D\.O\.\s*/,'')}`;
  return `Obras em ${DB.municipios[st.city].nome}`;
}
// dias com uma casa decimal. fmtPct1 fazia o mesmo, mas o nome dela promete
// percentual e mentia no call site.
function fmtDias(v){ return v.toFixed(1).replace('.',',')+' dias'; }
// anel de rosca com N fatias (usuário, 2026-09-17: Atrasado × No prazo × Sem prazo dentro
// da Fiscalização). Cor só por classe CSS (`cls`), nunca hex aqui — mesma regra do
// quadrante (docs/painel-fiscais/revisores.md, rev-aderencia). Fatias de tamanho 0 não
// desenham arco (dasharray zerado gera artefato visual).
function donutMulti(segs,size){
  size=size||118;
  const total=segs.reduce((s,x)=>s+x.n,0);
  const stroke=Math.round(size*.17), r=(size-stroke)/2, c=2*Math.PI*r, cx=size/2, cy=size/2;
  const aria=segs.map(s=>`${s.label}: ${NUM.format(s.n)}`).join(', ');
  if(!total) return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Sem processos">
    <circle class="donut-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}"/></svg>`;
  let acc=0;
  const arcos=segs.filter(s=>s.n>0).map(s=>{
    const len=c*(s.n/total), offset=-acc; acc+=len;
    return `<circle class="donut-seg ${s.cls}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}" `
      +`stroke-dasharray="${len.toFixed(2)} ${(c-len).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" `
      +`transform="rotate(-90 ${cx} ${cy})"><title>${escHtml(s.label)}: ${NUM.format(s.n)} (${fmtPct1(s.n/total*100)}%)</title></circle>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escHtml(aria)}">
    <circle class="donut-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}"/>${arcos}
    <text class="donut-ctr" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${NUM.format(total)}</text></svg>`;
}
// legenda da rosca: dot + rótulo + valor + percentual, uma linha por fatia com n > 0.
function donutLeg(segs){
  const total=segs.reduce((s,x)=>s+x.n,0);
  return `<div class="donut-leg">${segs.filter(s=>s.n>0).map(s=>
    `<div class="donut-leg-i"><span class="donut-dot ${s.cls}"></span>`
    +`<span class="donut-leg-l">${escHtml(s.label)}</span>`
    +`<span class="donut-leg-v">${NUM.format(s.n)} <span class="donut-leg-p">(${total?fmtPct1(s.n/total*100):'0,0'}%)</span></span></div>`
  ).join('')}</div>`;
}
// ---- painel do modo Replanilhamentos (E3) ----
// Ranking do recorte: distritos no nível 1 (pelo local da obra), cidades dentro de um
// distrito. Ordenado pela métrica, do maior para o menor — é o que o mapa pinta, em
// forma de lista navegável. Área sem número comparável (amostra curta) vai para o fim,
// mas continua na lista: ela existe e é navegável, só não tem média.
function rpRanking(){
  if(st.level>=3) return null;
  const kind = st.level<=1 ? 'group' : 'city';
  // Reaproveita o que rpPreparaMapa() já agregou para pintar o mapa: mesmas áreas, mesmo
  // recorte, mesma passada. A lista não pode divergir do mapa nem por engano, e o hover de
  // distrito — que redesenha o painel, não o mapa — deixa de repetir 11 agregações.
  const de=r=>({v:r.v, tot:r.tot, sub:st.rp.metrica==='tempo'?`${NUM.format(r.n)} desp.`:''});
  const vazio={v:null,n:0,tot:0};
  const ents = kind==='group'
    ? groupsList().map(g=>({k:g.id,nome:g.nome.replace(/^D\.O\.\s*/,''),...de(_rpGrp.get(String(g.id))||vazio)}))
    // parênteses: sem eles o .filter parece aplicar-se ao ternário inteiro
    : (idsOfGroup(st.group).map(id=>({k:id,nome:DB.municipios[id].nome,...de(_rpMun.get(id)||vazio)}))
                           .filter(e=>e.tot>0));   // cidade sem processo nenhum só alongaria a lista
  // Desempate por volume e depois por nome: quando NENHUMA área tem média (comum entre
  // cidades), ordenar só pelo valor deixaria a lista na ordem do arquivo GeoJSON, que não
  // diz nada — quem tem mais processos é a leitura útil que sobra.
  ents.sort((a,b)=>(b.v==null?-1:b.v)-(a.v==null?-1:a.v) || b.tot-a.tot || a.nome.localeCompare(b.nome,'pt-BR'));
  return {kind,ents};
}
// Ordem de leitura da lista de processos: quem está parado na fila há mais tempo primeiro,
// depois o que está na GECOPE, o histórico já despachado (mais recente antes) e, no fim, os
// arquivados no meio do trâmite.
function rpOrdemProc(a,b){
  const pos=p=>p.naFila?0:p.despachado?2:p.foraDoCiclo?3:1;
  if(pos(a)!==pos(b)) return pos(a)-pos(b);
  // na fila sem dias na unidade (ainda tramitando até o fiscal) vai para o fim da fila
  if(a.naFila) return (b.diasNaUnidade??-1)-(a.diasNaUnidade??-1);
  if(a.despachado) return String(b.dataDespacho||'').localeCompare(String(a.dataDespacho||''));
  return 0;
}
function procCard(p){
  const estado = p.naFila
    // sem dias: o motivo vem da view; o caso comum é o processo ainda tramitando até o fiscal
    ? (p.diasNaUnidade==null?(/fora da unidade/.test(p.conferencia)||!p.conferencia?'tramitando até o fiscal':'com o fiscal, sem registro no SUITE')
       :`${NUM.format(p.diasNaUnidade)} dia${p.diasNaUnidade===1?'':'s'} com o fiscal`)
    : p.despachado ? (p.dataDespacho?`despachado em ${fmtDateBR(p.dataDespacho)}`:'despachado, sem data')
    : p.foraDoCiclo ? (p.situacao==='arquivado_no_tramite'?'arquivado no trâmite':'aprovado, sem data')
                   : 'na GECOPE';
  // Tempo só do despachado, e só de quem despachou. Sem tempo, diz o porquê quando é regra
  // (aberto já pronto); o caso a conferir fica sem número, nunca com zero.
  const tempo = !p.despachado ? ''
    : p.tempoFiscal!=null ? `${fmtDias(p.tempoFiscal)} no setor`
    : p.abertoJaPronto ? 'aberto já pronto' : '';
  return `<div class="proc${p.metaEstourada?' meta':''}">`
    +`<div class="proc-h"><span class="proc-n">${escHtml(p.processo)}</span>`
    +`<span class="proc-s">${escHtml(p.statusTxt)}</span></div>`
    // objeto ausente vem como '—' de mapProcesso: uma linha inteira do cartão para um
    // travessão não diz nada, então ela some
    +(p.objeto&&p.objeto!=='—'?`<div class="proc-o">${escHtml(p.objeto)}</div>`:'')
    +`<div class="proc-m"><span>${escHtml(p.fiscalNome)}</span>`
    +`<span>${escHtml(estado)}${tempo?` · ${escHtml(tempo)}`:''}</span></div>`
    +(p.metaEstourada?`<div class="proc-meta">Atrasado</div>`:'')+`</div>`;
}
const PROC_LISTA_MAX=15;
/* ---- ranking de fiscais por tempo médio (E4) ----
   O mapa compara ÁREAS; esta seção compara PESSOAS, que é a pergunta que sobra depois
   dele: entre os fiscais deste recorte, quem está mais lento. Uma barra horizontal por
   fiscal, do mais lento ao mais rápido — leitura direta, sem eixo nem quadrante para
   explicar antes. O gráfico anterior (dispersão despachos × tempo, com medianas e
   quadrantes) passou por 3 rodadas de revisão, mas exigia explicação verbal para um
   gestor lê-lo; trocado por decisão do usuário em 2026-09-17. O número de despachos
   aparece ao lado de cada barra — explica o volume por trás do tempo, mas não é o que a
   barra mede. */
// Acima disto a lista de fiscais rola dentro da própria caixa (ver .qdf-rola no CSS).
const QUAD_LISTA_ROLA=8;
// Agregado por fiscal. NÃO reimplementa as regras de aggProc: agrupa os processos por
// matrícula e chama a mesma função que alimenta os KPIs logo acima, para que o número de
// um fiscal nunca possa divergir do total que o painel afirma três centímetros acima.
// População: quem tem fila hoje OU despacho no período — mais larga que o card FISCAIS
// (2026-09-21: só despacho no período), de propósito: o ranking também é onde um gestor
// vê alguém com fila parada mas nenhum despacho ainda no período, e essa pessoa não pode
// sumir da lista só porque não contribui pro card.
// `opts.todosLotados` (E4, 2026-09-23) desliga esse corte por período: usada só pelos
// cartões de fiscais da janela do distrito (equipeCardsHtml()), que precisam listar todo
// fiscal que já atuou nas obras do distrito, mesmo sem fila nem despacho no período ativo
// — a lista de PESSOAS fica estável, só os números de cada cartão seguem o período
// (pedido do usuário: "os cards de todos os fiscais fiquem, independente do período").
// `procs` já não é filtrado por período (vem de procsDoDistritoRaw/PROCESSOS, histórico
// completo) — o corte de período mora inteiramente dentro de aggProc(), nunca aqui.
function aggFiscais(procs,opts){
  const todosLotados=!!(opts&&opts.todosLotados);
  const porMat=new Map(); let semFiscal=0;
  for(const p of procs){
    // Processo sem matrícula não vira linha: "(sem fiscal)" não é uma pessoa, e juntar
    // todos numa linha só criaria um fiscal fantasma com a carga somada de vários. Contado
    // para aparecer no rodapé em vez de encolher a lista em silêncio.
    if(!p.fiscalMat){ semFiscal++; continue; }
    let a=porMat.get(p.fiscalMat); if(!a){ a=[]; porMat.set(p.fiscalMat,a); }
    a.push(p);
  }
  const lista=[];
  porMat.forEach((ps,mat)=>{
    const a=aggProc(ps);
    // mesma regra do KPI: só GECOPE não conta como presença — exceto com todosLotados,
    // onde ter QUALQUER processo histórico (ps.length>0, já garantido por porMat) basta.
    if(!todosLotados && !a.fila && !a.desp) return;
    lista.push({mat, nome:ps[0].fiscalNome, gedop:ps[0].gedop,
                fila:a.fila, desp:a.desp, n:a.nTempo, tempo:a.tempoMedio,
                prontos:a.prontos, semTempo:a.semTempo});
  });
  return {lista, semFiscal};
}
function rpFiscaisRanking(procs){
  const {lista,semFiscal}=aggFiscais(procs);
  // Mesma régua de amostra do mapa, da legenda e dos KPIs: sem AMOSTRA_MIN despachos COM
  // TEMPO MEDIDO não há média, e sem média não há linha. Quem passa do piso mas não chega
  // a AMOSTRA_SOLIDA entra marcado, não escondido (ver fiscaisRankingLista).
  const pts=lista.filter(f=>f.n>=AMOSTRA_MIN);
  // Do mais lento para o mais rápido: a mesma pergunta que o painel inteiro faz.
  pts.sort((a,b)=>b.tempo-a.tempo || b.desp-a.desp || a.nome.localeCompare(b.nome,'pt-BR'));
  // `nFiscais` é o denominador do "N de M" do cabeçalho — a confissão de cobertura
  // parcial que sobrou depois de a seção perder os parágrafos explicativos.
  // `semTempoBastante` é o caso que confunde: despachou o bastante, mas os despachos não
  // têm tempo medido no SUITE. Sem esta contagem o leitor vê alguém com 4 despachos fora
  // da lista e conclui que o painel está errado (achado do usuário, 2026-09-17).
  const semTempoBastante=lista.filter(f=>f.n<AMOSTRA_MIN && f.desp>=AMOSTRA_MIN).length;
  return {pts, nFiscais:lista.length, semFiscal, semTempoBastante};
}
// Uma linha por fiscal: nome à esquerda, tempo médio à direita, barra proporcional
// abaixo — e nada mais. Pedido do usuário em 2026-09-17: "apenas o nome do Fiscal e o
// Tempo médio dele e só"; despachos, lotação, delta sobre a média e fila poluíam a
// leitura sem explicar o número. A explicação inteira passou para a janela do fiscal,
// que a própria linha abre no clique.
// A barra usa o mais lento da lista como 100% e os demais relativos a ele (mesma técnica
// de .rbar/rankRows() do ranking de distritos/cidades, não uma escala inventada aqui).
// `avg` é a média do RECORTE inteiro (a.tempoMedio, o mesmo número do card "Tempo médio"
// no topo do painel) — não a média só de quem entrou na lista, que se moveria a cada
// fiscal excluído por amostra e deixaria de bater com o card três centímetros acima.
// Vira um traço vertical dentro de cada barra (mesma posição em todas, eixo comum), e
// quem está acima dele — mais lento que o próprio recorte — ganha a barra em âmbar.
function fiscaisRankingLista(q,avg){
  const max=Math.max(1,avg||0,...q.pts.map(p=>p.tempo));
  const refPct=avg!=null?Math.max(0,Math.min(100,avg/max*100)):null;
  const ref=refPct!=null?`<b class="rbar-ref" style="left:${refPct}%"></b>`:'';
  return q.pts.map(p=>{
    const acima=avg!=null&&p.tempo>avg;
    // Amostra fina: o contador de despachos volta SÓ nesta linha, e a barra fica vazada.
    // A limpeza pedida em 2026-09-17 continua valendo para quem tem número firme — a
    // informação extra aparece exatamente onde ela muda a leitura, e em lugar nenhum mais.
    const fina=amostraFina(p.n);
    const cont=fina?`<span class="qdf-fina">${escHtml(`${NUM.format(p.n)} desp.`)}</span>`:'';
    return `<div class="qdf" role="button" tabindex="0" data-mat="${escHtml(p.mat)}"`
      +` title="Ver painel de ${escHtml(p.nome)}" aria-label="Ver painel de ${escHtml(p.nome)}${fina?`, média sobre ${NUM.format(p.n)} despachos`:''}">`
      +`<div class="qdf-top"><span class="qdf-n"><span class="qdf-nome">${escHtml(p.nome)}</span>${cont}</span>`
      +`<span class="qdf-v">${escHtml(fmtDias(p.tempo))}</span></div>`
      +`<div class="rbar${acima?' amber':''}${fina?' fina':''}"><i style="width:${Math.max(4,p.tempo/max*100)}%"></i>${ref}</div></div>`;
  }).join('');
}
function rpFiscaisRankingHtml(procs,a){
  // Do nível 2 para baixo o recorte é geográfico (município/cidade): os fiscais que
  // aparecem ali são só os que atuaram naquelas obras, uma fatia pequena demais do
  // trabalho de cada um para comparar pessoa com pessoa. No nível dos distritos a régua
  // "Fiscal × Obra" que existia aqui foi removida (2026-09-23): o painel considera sempre
  // o distrito da obra, e a seção passou a existir também nesse recorte — mede quem está
  // resolvendo o trabalho deste distrito, não a carreira inteira de cada fiscal (o mesmo
  // critério que a janela do distrito usa desde a mesma mudança).
  if(st.level>1){
    return `<div class="statwrap"><div class="sec-h"><span>Fiscais · tempo médio</span></div>`
      +`<div class="qd-aviso">Esta comparação entre fiscais não aparece dentro de uma cidade ou processo aberto: o recorte já não é mais um distrito inteiro.</div></div>`;
  }
  return fiscaisRankingBlockHtml(procs,a);
}
// E5 — núcleo do ranking de fiscais, separado de rpFiscaisRankingHtml() porque este
// devolve, antes dele, o aviso de por que a comparação não existe fora do nível distrito.
function fiscaisRankingBlockHtml(procs,a){
  const q=rpFiscaisRanking(procs);
  if(!q.nFiscais && !q.semFiscal) return '';
  const per=RP_PERIODO[st.rp.periodo].txt;
  // Média do card "Tempo médio" (topo do painel), não uma média local da lista — ver
  // fiscaisRankingLista. Some junto com o card, pela mesma régua de amostra (AMOSTRA_MIN).
  const avg=a&&a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null;
  const cab=`<div class="sec-h"><span>Fiscais · tempo médio</span>`
    +`<span>${NUM.format(q.pts.length)} de ${NUM.format(q.nFiscais)}</span></div>`;
  // Uma linha de recorte no lugar dos três parágrafos que a seção carregava (cobertura em
  // volume, legenda do traço e rodapé de exclusões, todos somados a seis números por
  // linha): o usuário pediu a seção limpa em 2026-09-17, e cada uma dessas contas passou
  // para a janela do fiscal, onde há espaço para explicá-la. O "N de M" do cabeçalho
  // continua confessando a cobertura parcial, que é o essencial que não podia sair daqui.
  // "do mais lento ao mais rápido" saiu: a ordem é visível na própria coluna de números e
  // nas barras, e a linha precisa caber em uma só. A barra vazada, porém, precisa ser
  // explicada — é a única marca da lista cujo significado não se deduz olhando.
  // Duas legendas e a dica de clique já enchem a linha: "número frágil" sai, porque a
  // barra vazada mais o contador de despachos ao lado do nome já dizem isso, e a janela
  // do fiscal soletra a ressalva por extenso para quem abrir.
  const temFina=q.pts.some(p=>amostraFina(p.n));
  const sub=`<div class="sec-sub">${escHtml(per
    +(avg!=null?` · traço = média do recorte (${fmtDias(avg)}) · âmbar = acima do traço`:'')
    +(temFina?` · barra vazada = menos de ${AMOSTRA_SOLIDA} despachos`:'')
    +'. Clique para ver o painel.')}</div>`;
  if(!q.pts.length){
    return `<div class="statwrap">${cab}`
      +`<div class="empty">Nenhum fiscal deste recorte despachou ${AMOSTRA_MIN} vezes no período — sem média, não há barra para comparar.</div></div>`;
  }
  // A lista ganha rolagem própria a partir de QUAD_LISTA_ROLA nomes, em vez de corte: todo
  // fiscal listado precisa continuar alcançável, mas sem empurrar o ranking dos 11
  // distritos para fora da primeira dobra.
  const rola=q.pts.length>QUAD_LISTA_ROLA?' qdf-rola':'';
  // A única exclusão que o leitor não consegue deduzir do cabeçalho: despachou o bastante,
  // mas os despachos não têm tempo medido. Uma linha, e só quando o caso existe.
  const nota=q.semTempoBastante
    ? `<div class="foot-note">${escHtml(`${NUM.format(q.semTempoBastante)} ${q.semTempoBastante===1?'fiscal despachou':'fiscais despacharam'} `
      +`${AMOSTRA_MIN} vezes ou mais no período, mas sem tempo medido no SUITE em ${AMOSTRA_MIN} `
      +`${AMOSTRA_MIN===1?'delas':'deles'} — a média sai do tempo, não da contagem.`)}</div>`
    : '';
  return `<div class="statwrap">${cab}${sub}<div class="qdf-box${rola}">${fiscaisRankingLista(q,avg)}</div>${nota}</div>`;
}

/* ---- E5 — janelas de detalhe de distrito e de fiscal ----
   Duas janelas de leitura (sem edição, sem abas), reaproveitando o modal genérico que a
   obra já usa (#modalBg/#modal) em vez de um segundo overlay: só um modal fica aberto por
   vez, e o padrão de abrir/fechar/clicar fora já existe e já foi revisado. */

function mostraJanelaGenerica(){
  escondeEdTip();   // o innerHTML já trocou; a bolinha-âncora de uma tooltip antiga sumiu junto
  document.getElementById('modalBg').classList.add('show');
  const x=document.getElementById('modalX'); if(x) x.onclick=closeModal;
  wireAdToggles();   // listas recolhidas das duas janelas (ver verToggle)
  document.getElementById('modal').scrollTop=0;   // reabrir por cima de outra janela herdava a rolagem dela
}
// Mesma mecânica do .adToggle das abas de aditivo (wireAdToggles liga qualquer botão
// dentro de .modal pelo data-target), com o texto livre: aqui o que se abre é a lista de
// processos, e não um grupo de aditivos.
function verToggle(targetId,texto){
  return `<button type="button" class="adToggle" data-target="${targetId}" aria-expanded="false" aria-controls="${targetId}">`
    +`<span>${escHtml(texto)}</span> <span class="adToggle-car">▾</span></button>`;
}

/* ---- a régua única das duas janelas: DIAS ----
   O mesmo eixo horizontal desenha as três comparações que os painéis fazem — cada
   despacho de um fiscal, cada fiscal da base, cada distrito do estado. Quem aprende a
   ler a primeira já sabe ler as outras duas, e nenhuma delas precisa de uma escala
   própria para ser explicada antes. Um ponto é um caso real na posição do número dele;
   pontos sobrepostos escurecem uns aos outros (densidade) em vez de se esconderem.
   `marcas` são as referências verticais — a média de quem a janela é e a média geral. */
function eixoDias(pts,marcas,opts){
  opts=opts||{};
  if(!pts.length) return `<div class="empty">${escHtml(opts.vazio||'Sem despachos com tempo medido para comparar.')}</div>`;
  marcas=(marcas||[]).filter(m=>m&&m.v!=null);
  const W=640,H=opts.altura||92,PADL=16,PADR=16,iw=W-PADL-PADR;
  const topo=Math.max(...pts.map(p=>p.v),...marcas.map(m=>m.v),1);
  // A escala termina numa dezena redonda, não no maior valor da amostra: o eixo é lido em
  // voz alta numa reunião, e "0 a 213" não é um número que alguém repita.
  const passo=topo>400?100:topo>150?50:topo>60?20:10;
  const max=Math.max(passo,Math.ceil(topo/passo)*passo);
  const X=v=>PADL+Math.max(0,Math.min(1,v/max))*iw;
  const yBase=H-20, yPt=yBase-15;
  let grade='';
  for(let v=0;v<=max;v+=passo){
    // A unidade vai no último tique, não numa legenda à parte: um rótulo faz os dois
    // trabalhos, e o eixo deixa de precisar de um "dias" solto ao lado dele.
    const rot=v===max?`${v} dias`:String(v);
    grade+=`<line class="ed-tick" x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="10" y2="${yBase}"/>`
      +`<text class="ed-tlab" x="${X(v).toFixed(1)}" y="${H-6}" text-anchor="${v===max?'end':'middle'}">${rot}</text>`;
  }
  // E5, 2026-09-23 — destaque maior da marca de referência: uma bandeirola no topo além
  // da linha tracejada. Antes a única pista de qual linha era "a média" ficava na legenda
  // abaixo do gráfico; a bandeirola torna a marca reconhecível de cara, sem precisar ler
  // a legenda primeiro.
  const linhas=marcas.map(m=>{
    const xn=X(m.v), x=xn.toFixed(1);
    const bandeira=m.cls==='ref'
      ?`<polygon class="ed-flag" points="${(xn-5).toFixed(1)},1 ${(xn+5).toFixed(1)},1 ${x},10"/>`
      :'';
    return `${bandeira}<line class="ed-mark ${escHtml(m.cls||'')}" x1="${x}" x2="${x}" y1="6" y2="${yBase}"/>`;
  }).join('');
  // data-label alimenta o tooltip por clique/toque (mostraEdTip(), mais abaixo) — o
  // <title> nativo continua para quem passa o mouse; nenhum dos dois é exclusivo do outro.
  const dots=pts.map(p=>`<circle class="ed-dot${p.on?' on':''}${p.on&&p.acima?' acima':''}" cx="${X(p.v).toFixed(1)}" cy="${yPt}" r="${p.on?6.5:5}" data-label="${escHtml(p.label||'')}">`
    +`<title>${escHtml(p.label||'')}</title></circle>`).join('');
  const aria=`${NUM.format(pts.length)} pontos entre 0 e ${max} dias`
    +marcas.map(m=>`; ${m.label}: ${fmtDias(m.v)}`).join('');
  const leg=marcas.length?`<div class="ed-leg">`
    +marcas.map(m=>`<span class="ed-leg-i"><i class="ed-key ${escHtml(m.cls||'')}"></i>${escHtml(m.label)} <b>${escHtml(fmtDias(m.v))}</b></span>`).join('')
    +`</div>`:'';
  return `<div class="ed-wrap"><svg viewBox="0 0 ${W} ${H}" class="ed" preserveAspectRatio="none" role="img" aria-label="${escHtml(aria)}">`
    +`${grade}<line class="ed-base" x1="${PADL}" x2="${W-PADR}" y1="${yBase}" y2="${yBase}"/>${linhas}${dots}</svg>${leg}</div>`;
}
// Cartão-herói: o número que a janela existe para dizer, com a distância dele até a
// referência logo abaixo. Um por janela — é o único lugar com tipo grande, e o resto do
// painel fica deliberadamente quieto em volta dele.
function heroTempo(valor,n,referencia,rotuloRef){
  if(valor==null){
    return `<div class="dsh-hero dsh-hero-vazio"><div class="rs-lbl">${RS_ICO.clock} Tempo médio no setor</div>`
      +`<div class="dsh-big">—</div>`
      +`<div class="dsh-sub">${escHtml(n?`só ${NUM.format(n)} despacho${n===1?'':'s'} com tempo medido — a média pede ao menos ${AMOSTRA_MIN}`
        :'nenhum despacho com tempo medido')}</div></div>`;
  }
  const d=referencia!=null?valor-referencia:null;
  // O sinal é o que o conselho lê primeiro: acima da referência é âmbar e aponta para
  // cima, abaixo é verde e aponta para baixo. Sem referência, nenhuma das duas.
  const delta=d==null?'':`<div class="dsh-delta ${d>0?'acima':'abaixo'}">`
    +`<span class="dsh-seta">${d>0?'▲':'▼'}</span>${escHtml(`${fmtDias(Math.abs(d))} ${d>0?'acima':'abaixo'} ${rotuloRef} (${fmtDias(referencia)})`)}</div>`;
  // Amostra fina: o aviso fica colado no número grande, não no rodapé da janela. É o
  // número que vai ser lido em voz alta numa reunião, e a ressalva precisa viajar junto.
  const fraco=amostraFina(n)
    ? `<div class="dsh-fraco">${escHtml(`Amostra pequena: com ${NUM.format(n)} despachos, um único processo travado move bastante esta média.`)}</div>`
    : '';
  return `<div class="dsh-hero${d!=null&&d>0?' dsh-hero-acima':''}${amostraFina(n)?' dsh-hero-fina':''}"><div class="rs-lbl">${RS_ICO.clock} Tempo médio no setor</div>`
    +`<div class="dsh-big">${escHtml(fmtDias(valor).replace(' dias',''))}<span class="dsh-un">dias</span></div>`
    +delta
    +`<div class="dsh-sub">${escHtml(`em ${NUM.format(n)} despacho${n===1?'':'s'} com tempo medido`)}</div>${fraco}</div>`;
}
// Ladrilho pequeno: o terceiro e mais leve peso de superfície da janela (herói → gráfico →
// ladrilho). Não repete o .mkpi do modal de obra para não herdar o tamanho dele aqui.
// `opts.target` faz do ladrilho um gatilho a mais para uma lista que já existe escondida
// no resto da janela (mesmo mecanismo de .adToggle, ver wireAdToggles) — abre a lista por
// trás do número. `opts.scrollTo` é para o caso do ladrilho "Fiscais no período": a lista
// (os .fcard da seção Fiscalização) já fica sempre visível, então o clique só rola a
// janela até ela, sem esconder/mostrar nada.
function tile(valor,label,sub,opts){
  opts=opts||{};
  const attrs=opts.target
    ? ` role="button" tabindex="0" data-target="${escHtml(opts.target)}" aria-expanded="false" aria-controls="${escHtml(opts.target)}"`
    : opts.scrollTo
      ? ` role="button" tabindex="0" data-scrollto="${escHtml(opts.scrollTo)}"`
      : '';
  return `<div class="dsh-tile${attrs?' dsh-tile-clic':''}"${attrs}><div class="dsh-tv">${escHtml(valor)}</div>`
    +`<div class="dsh-tl">${escHtml(label)}</div>`+(sub?`<div class="dsh-ts">${escHtml(sub)}</div>`:'')+`</div>`;
}
// Barra empilhada da fila de hoje. Mesmo tri-estado do donut GECOPE × Fiscalização, e
// pela mesma razão: processo SEM data de compromisso não é "no prazo", é um terceiro
// grupo — somá-lo ao verde inflaria justamente o número que tranquiliza.
function barraAtraso(atrasado,noPrazo,semPrazo){
  const tot=atrasado+noPrazo+semPrazo;
  if(!tot) return '';
  const seg=(n,cls,rot)=>n?`<i class="${cls}" style="width:${(n/tot*100).toFixed(2)}%" title="${escHtml(`${rot}: ${NUM.format(n)}`)}"></i>`:'';
  const item=(n,cls,rot)=>n?`<span class="sbar-i"><i class="sbar-dot ${cls}"></i>${escHtml(`${NUM.format(n)} ${rot}`)}</span>`:'';
  return `<div class="sbar"><div class="sbar-track">${seg(atrasado,'atraso','Atrasado')}${seg(noPrazo,'noprazo','No prazo')}${seg(semPrazo,'semprazo','Sem prazo')}</div>`
    +`<div class="sbar-leg">${item(atrasado,'atraso','atrasado'+(atrasado===1?'':'s'))}${item(noPrazo,'noprazo','no prazo')}${item(semPrazo,'semprazo','sem prazo')}</div></div>`;
}
/* Referências da janela do fiscal, TODAS no período ativo (decisão do usuário,
   2026-09-17: "tudo segue o período"). Antes a janela lia a carreira inteira da pessoa e
   a comparava com a média histórica; a lista de processos, porém, passou a ser separada
   pelo filtro, e a tela ficou com três recortes ao mesmo tempo. Uma tela, uma pergunta,
   uma janela — é o que sobrevive a alguém perguntando "isso é de quando?" numa reunião.
   Nenhuma das duas tem cache: o período muda, e servir número velho num painel de
   desempenho é pior que recalcular 400 linhas ao abrir uma janela. */
function refGeral(){
  const a=aggProc(PROCESSOS);
  return {media:a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null, n:a.nTempo};
}
// O time inteiro do ESTADO, sempre pela LOTAÇÃO do fiscal (gedop) — a janela do fiscal
// compara pessoas, e agrupar pelo local da obra (como o mapa e a janela de distrito fazem
// desde 2026-09-23) fatiaria cada uma pela geografia das obras que passou, não pela carga
// inteira dela. Não é `aggFiscais(PROCESSOS)` (versão anterior): PROCESSOS é a base bruta,
// sem excluir quem não tem lotação válida nos 11 distritos (semGedop/gedopSemDistrito) —
// exatamente quem o ranking lateral também não mostra. Comparar "onde este fiscal está"
// contra esses fantasmas inflava o denominador e podia dar uma posição que não bate com
// nada visível na tela (achado do rev-correcao na revisão da E5, 2026-09-18). A carga
// da pessoa (tiles da janela) segue sempre estadual pelo mesmo motivo dos vizinhos — não é
// recortada por onde a janela foi aberta (hover/seleção no mapa, ou um cartão dentro de um
// distrito específico): a pergunta "essa pessoa é rápida ou lenta" não muda com a fatia
// geográfica de onde alguém entrou.
function coorteFiscais(){
  return aggFiscais(groupsList().flatMap(g=>procsEquipeDistrito(g.id))).lista
    .filter(f=>f.n>=AMOSTRA_MIN)
    .map(f=>({mat:f.mat, nome:f.nome, n:f.n, media:f.tempo}))
    .sort((x,y)=>x.media-y.media);
}
// Os 11 distritos NO PERÍODO ATIVO, sempre pelo local da obra — a mesma fonte que decide
// como o mapa pinta cada distrito: ao contrário da coorte de fiscais acima (sempre pessoa,
// nunca geografia), aqui o recorte precisa ser o mesmo que a janela do distrito mostra no
// corpo, senão "onde este distrito está" compara uma coisa contra outra. procsDoDistritoRaw()
// é essa mesma fonte, sem aplicar o filtro da E6 (não é procsDoDistrito) pelo mesmo motivo
// do resto desta janela. Sem cache: o período muda.
function coorteDistritos(){
  return groupsList().map(g=>{
    const a=aggProc(procsDoDistritoRaw(g.id));
    return {gid:String(g.id),nome:g.nome.replace(/^D\.O\.\s*/,''),
            media:a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null,n:a.nTempo};
  }).filter(d=>d.media!=null).sort((a,b)=>a.media-b.media);
}
// Média do estado no período ativo, pela mesma fonte (pelo local da obra) da janela de
// distrito (ver coorteDistritos() acima).
function refEstadoPeriodo(){
  const a=aggProc(groupsList().flatMap(g=>procsDoDistritoRaw(g.id)));
  return {media:a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null,n:a.nTempo};
}
// "Onde isto está" — a coorte inteira no eixo de dias, com o item da janela destacado.
// Um gráfico só responde a pergunta que o conselho faz de verdade ("somos bons ou ruins
// nisto?") melhor que uma lista de 11 ou 58 barras: mostra a POSIÇÃO e a DISPERSÃO na
// mesma linha — se todo mundo está mal, ou se este é o ponto fora da curva.
function posicaoHtml(titulo,coorte,chave,valorChave,ref,rotuloRef,unidade){
  if(coorte.length<2) return '';
  // Fora da coorte (amostra abaixo de AMOSTRA_MIN) a seção não existe: um eixo cheio de
  // pares sem nenhum ponto destacado responde "onde este está" com "em lugar nenhum", e
  // o herói ao lado já disse por que não há média.
  const idx=coorte.findIndex(c=>String(c[chave])===String(valorChave));
  if(idx<0) return '';
  const pts=coorte.map(c=>({v:c.media,on:String(c[chave])===String(valorChave),acima:ref!=null&&c.media>ref,
                            label:`${c.nome}: ${fmtDias(c.media)}`}));
  const marcas=ref!=null?[{v:ref,label:rotuloRef,cls:'ref'}]:[];
  // Conta pela ponta mais próxima: "19º mais rápido de 20" é verdade, mas a frase que o
  // conselho precisa ouvir sobre esse caso é "2º mais lento de 20". A coorte vem ordenada
  // do mais rápido para o mais lento, então a posição pelo fim é o espelho da do começo.
  const txtPos=idx<coorte.length/2
    ? `${NUM.format(idx+1)}º mais rápido de ${NUM.format(coorte.length)} ${unidade}`
    : `${NUM.format(coorte.length-idx)}º mais lento de ${NUM.format(coorte.length)} ${unidade}`;
  const pos=`<div class="dsh-pos">${escHtml(txtPos)}</div>`;
  return `<div class="dsh-plot"><div class="rs-lbl">${RS_ICO.chart} ${escHtml(titulo)}</div>${pos}`
    +eixoDias(pts,marcas,{altura:84})+`</div>`;
}

// Equipe lotada no distrito, sempre — usada só pela coorte de FISCAIS (coorteFiscais(),
// acima), que compara pessoas e por isso nunca muda com o modo como o mapa agrupa (pelo
// local da obra fatiaria cada fiscal pela geografia das obras que passou, não pela carga
// inteira dela). A janela do distrito em si (abreModalDistrito()) NÃO usa mais esta função
// — desde 2026-09-22 ela segue sempre o local da obra via procsDoDistritoRaw(), a mesma
// fonte do mapa.
function procsEquipeDistrito(gid){ return _procPorEquipe.get(String(gid))||[]; }
/* Sobre QUANTOS despachos a média foi tirada — e, quando ela não existe, por quê.
   O corte de AMOSTRA_MIN é sobre despachos COM TEMPO MEDIDO no SUITE, não sobre
   despachos: quem despachou 4 vezes mas só tem 1 tempo registrado fica sem média. Sem
   esta frase o painel mostrava o buraco sem explicá-lo, e o usuário encontrou o caso em
   Fortaleza (2026-09-17) sem ter como saber a causa. Os dois motivos de um despacho não
   ter tempo são diferentes e aparecem separados: "aberto já pronto" é regra (menos de
   1 dia com o fiscal), "sem tempo no SUITE" é caso a conferir no cadastro. */
function baseDaMedia(f){
  if(!f.desp) return 'sem despacho no período';
  const falta=f.desp-f.n;
  if(!falta) return `média sobre ${NUM.format(f.n)} despacho${f.n===1?'':'s'}`;
  const porque=[];
  if(f.prontos) porque.push(`${NUM.format(f.prontos)} aberto${f.prontos===1?'':'s'} já pronto${f.prontos===1?'':'s'}`);
  if(f.semTempo) porque.push(`${NUM.format(f.semTempo)} sem tempo no SUITE`);
  return `${NUM.format(f.n)} de ${NUM.format(f.desp)} despachos com tempo medido`
    +(porque.length?` — ${porque.join(', ')}`:'');
}
// Os fiscais do distrito em cartões, cada um com o macro dele (pedido do usuário,
// 2026-09-17). Do mais lento ao mais rápido — a mesma pergunta que o painel inteiro faz.
// Quem ainda não tem amostra comparável vai para o fim com "sem média", e não com um
// número: a régua de AMOSTRA_MIN vale aqui igual ao mapa, ao ranking e aos KPIs.
// `todosLotados:true` (E4, 2026-09-23): a lista de PESSOAS é sempre o histórico completo
// do distrito, nunca recortada pelo período ativo — só os números de cada cartão (f.desp,
// f.fila, f.tempo…) seguem o período, porque vêm de aggProc() dentro de aggFiscais(), que
// sempre respeita st.rp.periodo. Pedido do usuário: os cartões não podem sumir/reaparecer
// ao trocar o período, só os números dentro deles mudam.
function equipeCardsHtml(procs,refMedia){
  const {lista,semFiscal}=aggFiscais(procs,{todosLotados:true});
  if(!lista.length) return '';
  const comMedia=lista.filter(f=>f.n>=AMOSTRA_MIN).sort((a,b)=>b.tempo-a.tempo);
  const sem=lista.filter(f=>f.n<AMOSTRA_MIN)
                 .sort((a,b)=>b.desp-a.desp||a.nome.localeCompare(b.nome,'pt-BR'));
  const max=Math.max(1,...comMedia.map(f=>f.tempo));
  // Mesma régua do ranking de fiscais do painel e do herói desta janela: âmbar = mais lento
  // que a média do ESTADO no período. Comparar com a média da própria equipe pintaria de
  // verde um fiscal de 100 dias num distrito lento — e ele é âmbar no ranking do painel.
  const avg=refMedia!=null?refMedia:null;
  const card=f=>{
    const tem=f.n>=AMOSTRA_MIN, fina=amostraFina(f.n), acima=avg!=null&&f.tempo>avg;
    const valor=tem?escHtml(fmtDias(f.tempo)):'<span class="fcard-sem">sem média</span>';
    // Mesma marca do ranking, pela mesma razão: aqui também uma pessoa é nomeada.
    const barra=tem?`<div class="rbar${acima?' amber':''}${fina?' fina':''}"><i style="width:${Math.max(4,f.tempo/max*100)}%"></i></div>`:'';
    // Sem média, o cartão precisa dizer POR QUE — era o buraco que o usuário encontrou em
    // Fortaleza (2026-09-17): fiscal com mais de 2 despachos e nenhum número, sem pista.
    const aviso=(!tem||fina)?`<div class="fcard-fina">${escHtml(baseDaMedia(f))}</div>`:'';
    return `<div class="fcard" role="button" tabindex="0" data-mat="${escHtml(f.mat)}"`
      +` title="Ver painel de ${escHtml(f.nome)}" aria-label="Ver painel de ${escHtml(f.nome)}">`
      +`<div class="fcard-n">${escHtml(f.nome)}</div>`
      +`<div class="fcard-v">${valor}</div>${barra}${aviso}`
      +`<div class="fcard-s">${escHtml(`${NUM.format(f.desp)} despacho${f.desp===1?'':'s'} · ${NUM.format(f.fila)} em tramitação`)}</div></div>`;
  };
  const nota=semFiscal
    ? `<div class="foot-note">${escHtml(`${NUM.format(semFiscal)} processo${semFiscal===1?'':'s'} destas obras `
      +`${semFiscal===1?'está':'estão'} sem matrícula de fiscal gravada e ${semFiscal===1?'fica':'ficam'} fora dos cartões.`)}</div>`
    : '';
  // id fixo: só existe um chamador (abreModalDistrito) — é o alvo do ladrilho "Fiscais no
  // período" (data-scrollto), que só precisa rolar até aqui, já que os cartões nunca
  // ficam escondidos.
  return `<div class="statwrap" id="secFiscalizacaoDist"><div class="sec-h"><span>Fiscalização</span>`
    +`<span>${NUM.format(lista.length)} ${lista.length===1?'fiscal':'fiscais'}</span></div>`
    +`<div class="sec-sub">Do mais lento ao mais rápido${avg!=null?` · âmbar = acima da média dos distritos operacionais (${escHtml(fmtDias(avg))})`:''}. Clique num cartão para abrir o painel do fiscal.</div>`
    +`<div class="fcards">${comMedia.map(card).join('')}${sem.map(card).join('')}</div>${nota}</div>`;
}
function abreModalDistrito(gid){
  const g=grpById(gid); if(!g) return;
  // procsDoDistritoRaw() é a mesma fonte do mapa (sempre pelo local da obra), sem aplicar
  // o filtro da E6 (continua NÃO sendo procsDoDistrito) pelo mesmo motivo de sempre: a
  // janela mostra o panorama completo do distrito, não a fatia que o filtro do painel
  // deixou visível (ver comentário de filtraRp()).
  const procs=procsDoDistritoRaw(gid), a=aggProc(procs);
  const nome=g.nome.replace(/^D\.O\.\s*/,'');
  const per=RP_PERIODO[st.rp.periodo].txt;
  // Obras do RECORTE, não da carga inteira da equipe — mesma régua "tudo segue o período"
  // que a janela do fiscal já aplica (fichaFiscal). Era o único número da janela que ainda
  // contava a carreira toda, e não reagia às trocas de período como os três vizinhos.
  // (achado do rev-correcao na revisão da E5, 2026-09-18)
  const corteObras=corteDespacho(RP_PERIODO[st.rp.periodo].meses);
  // Mapa (não Set): guarda um processo representante de cada obra, é dele que sai a lista
  // por trás do ladrilho "Obras atendidas" (obraResumoCard usa codigo_obra/objeto/
  // município/valor, todos já presentes no próprio processo — ver mapProcesso).
  const obrasMapDist=new Map();
  for(const p of procs){
    if(!p.codigo_obra) continue;
    const dentro=p.naFila || (p.despachado && (corteObras==null || (!!p.dataDespacho && p.dataDespacho>=corteObras)));
    if(dentro && !obrasMapDist.has(p.codigo_obra)) obrasMapDist.set(p.codigo_obra,p);
  }
  const obrasListDist=[...obrasMapDist.values()].sort((x,y)=>(y.valorObra??-1)-(x.valorObra??-1));
  // Mesmo tri-estado do card/donut GECOPE × Fiscalização: sem prazo não é "no prazo".
  const noPrazo=Math.max(0,a.comMeta-a.metaEst), semPrazo=Math.max(0,a.fila-a.comMeta);
  const est=refEstadoPeriodo();
  const media=a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null;
  // Mesma frase da dica do mapa (rpOndeGrupo()), sem o "Contado pelas": a janela precisa
  // dizer a mesma coisa que o hover já diz.
  const sub=`<div class="msub">${RS_ICO.dist}<span>Obras localizadas no distrito · ${escHtml(per)}</span></div>`;
  const topo=`<div class="dsh-topo">${heroTempo(media,a.nTempo,est.media,'da média dos distritos operacionais')}`
    +posicaoHtml('Desempenho do Distrito Operacional',coorteDistritos(),'gid',String(gid),est.media,'Média dos Distritos Operacionais','distritos comparáveis')
    +`</div>`;
  // E5, 2026-09-23 — "Fiscais" virou "Fiscais no período" (mesma convenção já usada em
  // "Processos no período" no card Carga no período da janela do fiscal, abaixo): agora
  // que a seção Fiscalização sempre lista todo o histórico do distrito, esse ladrilho e o
  // cabeçalho dela mostram números de escopos diferentes com o mesmo nome curto — o
  // rótulo precisa dizer sozinho qual dos dois é.
  // A janela do fiscal já tinha uma nota explicando que "Processos" é sempre hoje,
  // diferente dos demais ladrilhos que seguem o período — aqui os 4 ladrilhos ficavam
  // lado a lado sem nenhuma pista de que um deles (Processos) não muda com o seletor de
  // período em Controles, achado ao revisar os prints reais desta janela (2026-09-23).
  // Cada ladrilho aponta para a lista correspondente mais abaixo na mesma janela (pedido
  // do usuário, 2026-09-23): Processos/Despachos/Obras abrem uma lista escondida (mesmo
  // mecanismo do .adToggle); Fiscais no período só rola até a seção Fiscalização, que já
  // fica sempre visível — não há o que abrir/esconder ali.
  const tiles=`<div class="dsh-tiles">`
    +tile(NUM.format(a.procs),'Processos',rpQuandoProc(),{target:'fichaFilaDist'})
    +tile(NUM.format(a.desp),'Despachos',per,{target:'fichaDespDist'})
    +tile(NUM.format(a.fiscais),'Fiscais no período',per,{scrollTo:'secFiscalizacaoDist'})
    +tile(NUM.format(obrasMapDist.size),'Obras atendidas','dos processos acima',{target:'fichaObrasDist'})
    +`</div><div class="dsh-nota">Processos é sempre a fila de hoje; despachos, fiscais e obras seguem o período escolhido em Controles.</div>`;
  // A fila de hoje, na mesma linguagem horizontal do resto da janela. O donut de atraso
  // do painel lateral diria o mesmo aqui — uma barra a mais, um gráfico a menos.
  // Lista dos processos por trás da barra: usuário relatou (2026-09-21) que dava pra ver
  // "com a fiscalização hoje" mas não QUAIS processos são esses. procCard() (não
  // fichaProcCard, que omite o fiscal) porque o recorte do distrito tem vários fiscais.
  const filaDist=procs.filter(p=>p.naFila)
    .sort((x,y)=>ordemMeta(x)-ordemMeta(y) || (y.diasNaUnidade??-1)-(x.diasNaUnidade??-1));
  const hoje=a.fila
    ? `<div class="dsh-plot"><div class="rs-lbl">${RS_ICO.pessoa} Com a fiscalização hoje</div>`
      +barraAtraso(a.metaEst,noPrazo,semPrazo)
      +`<div class="dsh-nota">${escHtml(`Outros ${NUM.format(a.naGecope)} processo${a.naGecope===1?'':'s'} destas obras `
        +`${a.naGecope===1?'está':'estão'} na GECOPE, fora das mãos do fiscal.`)}</div>`
      +grupoProcs('fichaFilaDist','Processos','',filaDist,null,'',procCard)
      +`</div>`
    : '';
  // Despachados do período — mesmo corte de aggProc() (corteObras), então a contagem bate
  // com o ladrilho Despachos acima. Não existia lista nenhuma aqui antes: o distrito só
  // mostrava a fila de hoje, nunca quem já tinha despachado no período.
  const despDist=procs.filter(p=>p.despachado && (corteObras==null || (!!p.dataDespacho && p.dataDespacho>=corteObras)))
    .sort((x,y)=>String(y.dataDespacho||'').localeCompare(String(x.dataDespacho||'')));
  const rotDespDist=p=>p.dataDespacho?fmtDateBR(p.dataDespacho):'sem data';
  const despSecao=despDist.length
    ? `<div class="dsh-plot">${grupoProcs('fichaDespDist',`Despachados · ${per}`,
        'Do mais recente para o mais antigo.',despDist,rotDespDist,'',procCard)}</div>`
    : '';
  // Obras atendidas: uma obra por linha (não um processo), agrupadas em obrasMapDist —
  // mesmo recorte "hoje na fila OU despachado no período" que soma o número do ladrilho.
  const obrasSecao=obrasListDist.length
    ? `<div class="dsh-plot">${grupoProcs('fichaObrasDist','Obras atendidas','',obrasListDist,null,'',obraResumoCard,['obra','obras'])}</div>`
    : '';
  // A régua "Fiscal × Obra" que restringia esta seção à lotação do fiscal foi removida
  // (2026-09-23): o painel considera sempre o distrito da obra, então a comparação passa a
  // ser sobre quem trabalhou nas obras deste distrito — mesmo critério do ranking lateral
  // (rpFiscaisRankingHtml, ajustado junto).
  const equipeSecao=equipeCardsHtml(procs,est.media);
  const corpo=a.total
    ? topo+tiles+hoje+despSecao+obrasSecao+equipeSecao
    : `<div class="empty">Nenhum processo de replanilhamento nas obras deste distrito.</div>`;
  document.getElementById('modal').innerHTML=`<div class="mtop"><div class="mh">
      <div class="mh-titles"><div class="mt">${escHtml(nome)}</div>${sub}</div>
      <div class="mh-actions"><button class="mx" id="modalX" aria-label="Fechar">✕</button></div>
    </div></div>
    <div class="mbody dsh">${avisoFiltroRpHtml()}${corpo}</div>`;
  // A janela de distrito é sempre a "casa" — nunca chega por "← Voltar" de outra janela —,
  // mas grava o próprio gid no #modal (sobrevive à troca de innerHTML) para que um fiscal
  // aberto por cima saiba pra onde voltar. Ver o listener de .fcard, acima.
  document.getElementById('modal').dataset.rpDistrito=String(gid);
  mostraJanelaGenerica();
}

// Fiscal: a carga da pessoa em TODOS os distritos (a fatia geográfica de onde a janela foi
// aberta nunca serviu para avaliar alguém), medida no PERÍODO ativo. Passa por aggProc() de
// propósito — a mesma função que imprime os KPIs do painel e monta o ranking —, para que
// nenhum número da janela possa divergir do que a tela ao lado afirma. `todos` continua
// sendo a lista completa: é dela que sai o grupo "Fora deste recorte", que existe para a
// conta da lista fechar em vez de sumirem processos em silêncio.
function fichaFiscal(mat){
  const todos=PROCESSOS.filter(p=>p.fiscalMat===mat);
  const a=aggProc(todos);
  // Obras do RECORTE, não da carga inteira: era o único número da janela que ainda
  // contava a carreira, e um ladrilho fora do período no meio de três dentro dele é
  // exatamente a confusão que "tudo segue o período" veio resolver.
  const corte=corteDespacho(RP_PERIODO[st.rp.periodo].meses);
  const dentroPeriodo=p=>p.naFila || (p.despachado && (corte==null || (!!p.dataDespacho && p.dataDespacho>=corte)));
  const noPeriodo=todos.filter(dentroPeriodo);
  // Usuário, 2026-09-22: card "Carga no período" (abreModalFiscal) — quantos processos,
  // quantas obras e o valor somado delas o fiscal teve DENTRO do período ativo. Obra
  // deduplicada (um Map por codigo_obra, não soma o valor uma vez por processo — vários
  // processos da mesma obra não podem inflar o total). Mapa, não Set, porque já guarda o
  // valor da obra ali mesmo — evita um segundo laço só pra achar de novo o valor de cada
  // codigo_obra. `obrasComValor` conta só as obras com `valorObra` conhecido (cobertura é
  // ~99%, não 100% — medido em docs/painel-fiscais/diagnostico-carga-concorrente-tempo.sql,
  // achado E12): sem isso, `valorObras` somaria 0 pras obras sem match e o card mostraria
  // um total menor sem avisar que faltou gente na conta (achado rev-correcao, 2026-09-22)
  // — mesmo princípio do "N de M" já usado em rpFiscaisRanking (nFiscais, acima).
  // Guarda o PROCESSO representante (não só o valor): é dele que sai o cartão da lista por
  // trás do ladrilho "Obras" (obraResumoCard, mesmo padrão de abreModalDistrito).
  const obrasMap=new Map();
  let obrasComValor=0;
  for(const p of noPeriodo){
    if(!p.codigo_obra) continue;
    if(!obrasMap.has(p.codigo_obra)){
      obrasMap.set(p.codigo_obra, p);
      if(p.valorObra!=null) obrasComValor++;
    }
  }
  const obrasList=[...obrasMap.values()].sort((x,y)=>(y.valorObra??-1)-(x.valorObra??-1));
  const valorObras=obrasList.reduce((s,p)=>s+(p.valorObra||0),0);
  return {todos, a, obras:obrasMap.size, obrasComValor, obrasList, processosNoPeriodo:noPeriodo.length, valorObrasNoPeriodo:valorObras};
}
// Cartão de processo da ficha: NUP, descrição, contratada e contratante — não é o
// procCard() da lista por cidade, que repete o nome do fiscal a cada linha (redundante
// aqui, já que a janela inteira é de UM fiscal só). `estado` é o rótulo do grupo a que
// ele pertence, e muda com o grupo: na fila diz o prazo, despachado diz a data.
function fichaProcCard(p,estado){
  return `<div class="proc${p.naFila&&p.metaEstourada===true?' meta':''}">`
    +`<div class="proc-h"><span class="proc-n">${escHtml(p.processo)}</span>`
    +(estado?`<span class="proc-s">${escHtml(estado)}</span>`:'')+`</div>`
    +(p.objeto&&p.objeto!=='—'?`<div class="proc-o">${escHtml(p.objeto)}</div>`:'')
    +`<div class="proc-m"><span>${escHtml(p.contratada)}</span><span>${escHtml(p.contratante)}</span></div></div>`;
}
// Cartão da lista "Obras" (ladrilho Obras/Obras atendidas): `o` é um PROCESSO qualquer
// daquela obra (o primeiro achado ao agrupar por codigo_obra em fichaFiscal/
// abreModalDistrito) — não é o cartão de contrato completo (obraCard, linha 1601), que
// pede o array CONTRATOS/OBRAS carregado à parte; aqui os campos já vêm de
// vw_painel_desempenho_fiscais (mapProcesso), então reaproveita-se o próprio processo.
// Reusa a classe .proc (mesmo visual de fichaProcCard/procCard) para não abrir uma
// terceira variante de cartão só para isto.
function obraResumoCard(o){
  return `<div class="proc">`
    +`<div class="proc-h"><span class="proc-n">${escHtml(o.codigo_obra||'—')}</span>`
    +(o.municipioTxt?`<span class="proc-s">${escHtml(o.municipioTxt)}</span>`:'')+`</div>`
    +(o.objeto&&o.objeto!=='—'?`<div class="proc-o">${escHtml(o.objeto)}</div>`:'')
    +`<div class="proc-m"><span>${escHtml(o.contratada)}</span>`
    +`<span>${o.valorObra!=null?BRL.format(o.valorObra):'valor não informado'}</span></div></div>`;
}
// Rótulo de prazo de um processo que está com o fiscal agora. Tri-estado preservado: sem
// data de compromisso não é "no prazo", é "sem prazo" (mesma regra do donut e da barra).
function rotuloPrazo(p){
  const q=p.metaEstourada===true?'Atrasado':p.metaEstourada===false?'No prazo':'Sem prazo';
  return p.diasNaUnidade!=null ? `${q} · ${NUM.format(p.diasNaUnidade)} dia${p.diasNaUnidade===1?'':'s'}` : q;
}
// Ordem de leitura da fila de hoje (janela de fiscal e de distrito, mesma régua):
// atrasado primeiro, sem prazo por último; dentro de cada grupo, quem espera há mais
// tempo primeiro (ver o .sort que usa isto).
function ordemMeta(p){ return p.metaEstourada===true?0:p.metaEstourada===false?1:2; }
/* Um grupo da lista de processos da janela do fiscal: cabeçalho com a contagem, e os
   cartões atrás de um toggle — os dados macro primeiro, a lista no clique (pedido do
   usuário, 2026-09-17). A janela mostrava os processos todos numa lista só, misturando
   quem está com o fiscal agora e quem ele despachou há dois anos.
   `extra` é HTML já pronto (não escapado aqui — quem chama monta com escHtml/helpers
   próprios) injetado entre o cabeçalho e o toggle: o grupo Análise Fiscal usa para a
   barra de atraso, que os outros dois grupos não têm.
   `cardFn`, se vier, substitui o cartão padrão (fichaProcCard+rotulo): a janela do
   fiscal omite o nome dele nos cartões (é sempre o mesmo); a janela do distrito cobre
   VÁRIOS fiscais e precisa do procCard() que já imprime o nome de cada um. */
// `nome`, se vier, é [singular,plural] do item da lista para o texto do toggle — só a
// janela de Obras usa (não são "processos" ali, mesmo vindo do mesmo cartão/lista).
function grupoProcs(id,titulo,sub,procs,rotulo,extra,cardFn,nome){
  if(!procs.length) return '';
  const mostra=procs.slice(0,PROC_LISTA_MAX);
  const sing=nome?nome[0]:'processo', plur=nome?nome[1]:'processos';
  return `<div class="gproc">`
    +`<div class="gproc-h"><span>${escHtml(titulo)}</span><b>${NUM.format(procs.length)}</b></div>`
    +(sub?`<div class="gproc-s">${escHtml(sub)}</div>`:'')
    +(extra||'')
    +verToggle(id,`Ver ${NUM.format(procs.length)} ${procs.length===1?sing:plur}`)
    +`<div id="${id}" hidden>`
    +mostra.map(p=>cardFn?cardFn(p):fichaProcCard(p,rotulo?rotulo(p):'')).join('')
    +(procs.length>mostra.length?`<div class="foot-note">Mostrando ${NUM.format(mostra.length)} de ${NUM.format(procs.length)}.</div>`:'')
    +`</div></div>`;
}
// `voltarGid` (gid do distrito) só vem preenchido quando a janela abriu por cima de um
// distrito (clique num .fcard) — nesse caso o cabeçalho troca o ✕ por "← Voltar", que
// reabre aquela janela em vez de fechar tudo. Direto do ranking lateral, voltarGid é
// undefined e o comportamento é o de sempre: só fechar. Nunca os dois botões juntos —
// "Voltar" já implica que dar zoom-out primeiro no distrito exige aquele clique, e o ✕
// continua alcançável a partir de lá (ou por Esc/clique fora, que sempre fecham tudo).
function abreModalFiscal(mat,voltarGid){
  const f=fichaFiscal(mat); if(!f.todos.length) return;
  const ref=f.todos[0], a=f.a;
  const geral=refGeral();
  const media=a.nTempo>=AMOSTRA_MIN?a.tempoMedio:null;
  const lot=ref.gedop?` · ${ref.gedop}`:'';
  const perTxt=RP_PERIODO[st.rp.periodo].txt;
  // O subtítulo declara o recorte da janela inteira: era "Carga completa", e passou a ser
  // o período ativo quando todos os números da tela passaram a segui-lo.
  const sub=`<div class="msub">${RS_ICO.pessoa}<span>${escHtml(perTxt)}${ref.fiscalMat?` · mat. ${escHtml(ref.fiscalMat)}`:''}${escHtml(lot)}</span></div>`;
  const topo=`<div class="dsh-topo">${heroTempo(media,a.nTempo,geral.media,'da média geral')}`
    +posicaoHtml('Onde este fiscal está',coorteFiscais(),'mat',mat,geral.media,'Média geral','fiscais comparáveis')
    +`</div>`;
  // A TIRA DE DESPACHOS — a explicação da média que o usuário pediu ao clicar no nome
  // (2026-09-17). Um ponto por despacho no mesmo eixo de dias das outras comparações:
  // com 8 ou 15 casos dá para VER se a média é o retrato do trabalho ou se dois
  // processos parados puxaram todo o resto. Um histograma com essa amostra seria quase
  // todo feito de caixas vazias, e a média sozinha esconde exatamente o que interessa.
  // Só os despachos DO PERÍODO, como todo o resto da janela: a tira existe para explicar
  // o número grande logo acima, e pontos fora do recorte dele explicariam outra coisa.
  const corte=corteDespacho(RP_PERIODO[st.rp.periodo].meses);
  const noPeriodo=p=>p.despachado && (corte==null || (!!p.dataDespacho && p.dataDespacho>=corte));
  const desps=f.todos.filter(p=>noPeriodo(p)&&p.tempoFiscal!=null)
                     .sort((x,y)=>x.tempoFiscal-y.tempoFiscal);
  const marcas=[];
  if(media!=null) marcas.push({v:media,label:'Média do fiscal',cls:'med'});
  if(geral.media!=null) marcas.push({v:geral.media,label:'Média geral',cls:'ref'});
  const lento=desps.length?desps[desps.length-1]:null;
  const nota=desps.length>=2
    ? `Mais demorado: ${lento.processo}, ${fmtDias(lento.tempoFiscal)}. Mais rápido: ${desps[0].processo}, ${fmtDias(desps[0].tempoFiscal)}.`
    : '';
  const tira=`<div class="dsh-plot"><div class="rs-lbl">${RS_ICO.clock} Cada despacho, do mais rápido ao mais lento</div>`
    +eixoDias(desps.map(p=>({v:p.tempoFiscal,label:`${p.processo}: ${fmtDias(p.tempoFiscal)}`})),marcas,{altura:96,
      vazio:`Nenhum despacho com tempo medido no SUITE ${perTxt} — sem casos para mostrar no eixo.`})
    +(nota?`<div class="dsh-nota">${escHtml(nota)}</div>`:'')+`</div>`;
  // Fila de hoje: mesma ordem de leitura de ordemMeta() (atrasado primeiro).
  const fila=f.todos.filter(p=>p.naFila)
    .sort((x,y)=>ordemMeta(x)-ordemMeta(y) || (y.diasNaUnidade??-1)-(x.diasNaUnidade??-1));
  const atras=fila.filter(p=>p.metaEstourada===true).length;
  const noPrazo=fila.filter(p=>p.metaEstourada===false).length;
  const semPrazo=fila.filter(p=>p.metaEstourada==null).length;
  const espera=fila.reduce((mx,p)=>p.diasNaUnidade!=null&&p.diasNaUnidade>mx?p.diasNaUnidade:mx,-1);
  // PROCESSOS usa a mesma definição do card homônimo do painel lateral (aggProc.procs):
  // sempre a posição de hoje (fila), qualquer que seja o período — por isso não tem mais
  // ladrilho "Em tramitação" ao lado: seria sempre o mesmo número (2026-09-21). Despachos
  // e Obras continuam seguindo o período.
  // Cada ladrilho abre a lista correspondente mais abaixo (pedido do usuário, 2026-09-23):
  // Processos → o grupo Análise Fiscal (fichaFila); Despachos → o grupo Despachados
  // (fichaDesp), ambos já existentes em `processos`; Obras → o grupo novo dentro de
  // "Carga no período" (fichaObrasFiscal), mesmo recorte que soma f.obras.
  const tiles=`<div class="dsh-tiles">`
    +tile(NUM.format(a.procs),'Processos',rpQuandoProc(),{target:'fichaFila'})
    +tile(NUM.format(a.desp),'Despachos',perTxt,{target:'fichaDesp'})
    +tile(NUM.format(f.obras),'Obras','dos processos acima',{target:'fichaObrasFiscal'})
    +`</div>`;
  // Card "Carga no período" — pedido do usuário em 2026-09-22 (grill sobre a correlação
  // carga×tempo, docs/painel-fiscais/diagnostico-carga-concorrente-tempo.sql): gestor
  // quer ver, juntos, quantos processos esse fiscal teve e o valor somado das obras deles
  // DENTRO do período ativo — não o "instantâneo de hoje" que o ladrilho PROCESSOS
  // (acima) sempre mostra. Rótulo "no período" nos dois ladrilhos de propósito: mesmo
  // princípio de nunca deixar dois números de significado diferente (fila de hoje ×
  // janela de tempo) parecerem a mesma coisa por terem o mesmo nome curto.
  // Ressalva de não-causalidade e "N de M obras" — achados rev-produto/rev-correcao,
  // 2026-09-22: a correlação que motivou este card é fraca e, numa regressão com
  // processos+valor juntos, nenhuma das duas variáveis é significativa isoladamente
  // (docs/painel-fiscais/, E12) — sem o aviso, um valor alto ao lado de um tempo alto lê
  // como causa, o que os dados não sustentam. E sem o "N de M", a soma parece completa
  // mesmo quando faltou valor de alguma obra (cobertura ~99%, não 100%).
  // Achado rev-design, rodada 2: a ressalva no `sec-sub` (3 frases coladas) sobrecarregava
  // a hierarquia do card, e o subtítulo longo no ladrilho ("N de M obras com valor
  // conhecido") estourava `.dsh-ts` em larguras intermediárias, empurrando só aquele
  // ladrilho pra 2 linhas. Fix: ressalva move pro `.dsh-nota` (mesma legenda secundária já
  // usada em `hoje`/`fichaProcCard`, abaixo dos tiles, sem orçamento de largura fixo) e o
  // subtítulo do ladrilho encurta pro mesmo porte de `perTxt`.
  // Achado rev-produto, rodada 2 (2ª vez que bloqueia — escalado ao usuário, que autorizou
  // esta correção): o card tinha um terceiro ladrilho "Obras no período" mostrando
  // `f.obras`, o MESMO valor do ladrilho "Obras" já existente em `tiles` (acima) — este já
  // era escopado ao período antes deste diff, então "no período" duplicava sem avisar.
  // Removido; "Obras" continua disponível no card de cima, sem repetição.
  const covObras=f.obras>f.obrasComValor
    ? `${NUM.format(f.obrasComValor)}/${NUM.format(f.obras)} com valor`
    : perTxt;
  // Lista por trás do ladrilho "Obras" (acima) e do ladrilho "Valor das obras" logo
  // abaixo — mesmo Map (f.obrasList, de fichaFiscal) que soma os dois números.
  const obrasGrupo=f.obrasList.length
    ? grupoProcs('fichaObrasFiscal','Obras','',f.obrasList,null,'',obraResumoCard,['obra','obras'])
    : '';
  const cargaPeriodo=`<div class="statwrap">
    <div class="sec-h"><span>Carga no período</span></div>
    <div class="sec-sub">${escHtml(`${perTxt}. Diferente do ladrilho "Processos" acima, que é sempre a fila de hoje — aqui os números seguem o período escolhido em Controles.`)}</div>
    <div class="dsh-tiles dsh-tiles-cap">`
      +tile(NUM.format(f.processosNoPeriodo),'Processos no período',perTxt)
      +tile(f.valorObrasNoPeriodo>0?BRL.format(f.valorObrasNoPeriodo):'—','Valor das obras',covObras)
    +`</div>`
    +`<div class="dsh-nota">${escHtml('Valor é exposição financeira das obras, não medida de desempenho: a relação com o tempo de despacho é fraca e não se sustenta separada da carga de processos.')}</div>`
    +obrasGrupo
    +`</div>`;
  // PROCESSOS: uma seção só, com três subgrupos disjuntos que somam o total do
  // cabeçalho — Análise Fiscal (com o fiscal agora), Despachados (no período ativo) e
  // Fora deste recorte (o resto, pra conta fechar em vez de sumir processo em silêncio).
  // Antes eram duas seções soltas (uma pra "hoje", outra chamada "Processos" só com os
  // outros dois grupos); usuário relatou que a divisão ficava confusa (2026-09-21).
  const analiseExtra=barraAtraso(atras,noPrazo,semPrazo)
    +(espera>=0?`<div class="dsh-nota">${escHtml(`O mais antigo está há ${NUM.format(espera)} dia${espera===1?'':'s'} na unidade do fiscal.`)}</div>`:'');
  const despPer=f.todos.filter(noPeriodo)
    .sort((x,y)=>String(y.dataDespacho||'').localeCompare(String(x.dataDespacho||'')));
  const dentro=new Set([...fila,...despPer]);
  const resto=f.todos.filter(p=>!dentro.has(p)).sort(rpOrdemProc);
  const rotDesp=p=>p.dataDespacho?fmtDateBR(p.dataDespacho):'sem data';
  const processos=`<div class="statwrap"><div class="sec-h"><span>Processos</span><span>${NUM.format(f.todos.length)}</span></div>`
    +grupoProcs('fichaFila','Análise Fiscal','',fila,rotuloPrazo,analiseExtra)
    +grupoProcs('fichaDesp',`Despachados · ${perTxt}`,'Do mais recente para o mais antigo.',despPer,rotDesp)
    +grupoProcs('fichaResto','Fora deste recorte',
        'Na GECOPE, despachados antes do período ou arquivados no meio do trâmite.',resto,null)
    +`</div>`;
  const acoes=voltarGid
    ? `<button type="button" class="m-locate" id="modalVoltar" title="Voltar para o distrito">${RS_ICO.voltar}<span>Voltar</span></button>`
    : `<button class="mx" id="modalX" aria-label="Fechar">✕</button>`;
  document.getElementById('modal').innerHTML=`<div class="mtop"><div class="mh">
      <div class="mh-titles"><div class="mt">${escHtml(ref.fiscalNome)}</div>${sub}</div>
      <div class="mh-actions">${acoes}</div>
    </div></div>
    <div class="mbody dsh">${avisoFiltroRpHtml()}${topo}${tira}${tiles}${cargaPeriodo}${processos}</div>`;
  mostraJanelaGenerica();
  const v=document.getElementById('modalVoltar');
  if(v) v.onclick=()=>abreModalDistrito(voltarGid);
}
// Chip ".chip.abre" das linhas de distrito do ranking — checado antes de .rrow no clique e
// no teclado, porque fica aninhado dentro dela: sem isso o mesmo clique também desceria
// para as cidades por baixo da janela que acabou de abrir.
function abrirJanela(el){
  if(el.dataset.abre==='distrito') abreModalDistrito(el.dataset.gid);
}

function renderPanelReplan(scope,body){
  escondeRpTip();   // o innerHTML abaixo apaga o botão âncora; a janelinha ficaria órfã
  const procs=procsDoRecorte(), a=aggProc(procs), per=RP_PERIODO[st.rp.periodo].txt;
  // "Replanilhamentos" já aparece sozinho no cabeçalho (1.1, 2026-09-17): repeti-lo aqui
  // era a mesma poluição que as outras correções da rodada estão tirando (achado do
  // rev-correcao). O escopo some com a palavra sozinho.
  scope.innerHTML=`<b>${escHtml(escopoReplanTxt())}</b>${resultsSuffixRp(procs.length)}`;
  // escapa dentro dos helpers, não em cada chamada: parte dos argumentos (nome de fiscal,
  // descrição de obra, nº do processo) vem do banco.
  const linha=(rot,val,sub)=>`<div class="sit"><span class="sit-l">${escHtml(rot)}</span>`
    +`<span class="sit-v">${escHtml(val)}${sub?` <span class="sit-p">${escHtml(sub)}</span>`:''}</span></div>`;
  // Pedido do usuário: o cartão mostra só rótulo curto e número; a explicação (e o
  // denominador que antes ia no subtítulo) mora na janelinha do botão "i" — ver rpTip.
  // `sub` fica para o que é DADO e não explicação (atrasados × no prazo, média suprimida).
  const kpi=(rot,val,tip,sub)=>`<div class="kpi kpi-rp"><div class="k">${escHtml(rot)}`
    +`<button type="button" class="kpi-info" data-tip="${escHtml(tip)}" aria-label="O que é ${escHtml(rot)}?">i</button></div>`
    +`<div class="v">${escHtml(val)}</div>`+(sub?`<div class="ks">${sub}</div>`:'')+`</div>`;
  // Anomalias de carga são da BASE INTEIRA — não do recorte —, daí ficarem à parte e o
  // rótulo dizer isso. O subtítulo diz de qual contagem cada uma fica de fora: as duas
  // réguas perdem processos diferentes. Aparecem inclusive no recorte vazio, onde podem
  // ser a explicação do vazio.
  const d=_procDiag, anomalias=[];
  if(d&&d.semMunicipio) anomalias.push(linha('Sem município reconhecido', NUM.format(d.semMunicipio), 'fora da contagem pelo local da obra'));
  if(d&&d.semGedop) anomalias.push(linha('Fiscal sem lotação', NUM.format(d.semGedop), 'fora da contagem pela equipe'));
  if(d&&d.gedopSemDistrito) anomalias.push(linha('Lotação fora dos 11 distritos', NUM.format(d.gedopSemDistrito), 'fora da contagem pela equipe'));
  if(d&&d.despSemData) anomalias.push(linha('Despachado sem data', NUM.format(d.despSemData), 'só entra no período “Hoje”'));
  if(d&&d.despSemTempo) anomalias.push(linha('Despachado sem tempo no SUITE', NUM.format(d.despSemTempo), 'conta como despacho, fora do tempo médio'));
  if(d&&d.aprovSemData) anomalias.push(linha('Aprovado sem data de aprovação', NUM.format(d.aprovSemData), 'fora de todas as contagens'));
  if(d&&d.semSituacao) anomalias.push(linha('Sem cálculo do SUITE', NUM.format(d.semSituacao), 'fora de todas as contagens'));
  if(d&&d.abertosProntos) anomalias.push(linha('Aberto já pronto', NUM.format(d.abertosProntos), 'menos de 1 dia com o fiscal: conta como despacho, fora do tempo médio'));
  if(d&&d.divergencia) anomalias.push(linha('Distrito da obra ≠ do fiscal', NUM.format(d.divergencia), `de ${NUM.format(d.comAmbos)} com os dois conhecidos`));
  const conferencia = anomalias.length?`<div class="statwrap">
      <div class="sec-h"><span>Conferência da carga</span><span>base inteira</span></div>
      <div class="statleg cards">${anomalias.join('')}</div>
    </div>`:'';
  if(!a.total){
    // Achado do rev-produto (E6): "nenhum processo aqui" e "seu filtro não bateu nada
    // aqui" são situações diferentes — a primeira é sobre o recorte, a segunda é sobre a
    // busca/seleção que o próprio usuário fez, e confundir as duas lê como bug.
    const msgVazio=hasFiltroRp()
      ? 'Nenhum processo bateu com o filtro ativo neste recorte.'
      : 'Nenhum processo de replanilhamento neste recorte.';
    body.innerHTML=`<div class="empty">${escHtml(msgVazio)}</div>`+conferencia;
    return;
  }
  // Mesma regra do mapa (rpValor): abaixo de AMOSTRA_MIN a média não é exibida — o
  // painel não pode mostrar um número que o mapa se recusou a pintar.
  const nDesp=`${NUM.format(a.nTempo)} despacho${a.nTempo===1?'':'s'}`;
  const tempo = a.nTempo>=AMOSTRA_MIN ? fmtDias(a.tempoMedio) : '—';
  const nota = st.level>=2
    ? 'Dentro do distrito, cidades e totais contam pelo local da obra; os fiscais são os que atuaram nesses processos, não necessariamente a equipe lotada aqui.'
    : 'Distritos contados pelo local da obra; os fiscais são os que atuaram nesses processos, não a equipe lotada no distrito.';
  // PROCESSOS é sempre a posição de HOJE, nunca o período de Controles (usuário,
  // 2026-09-21 — ver aggProc()). TEMPO MÉDIO, DESPACHOS e FISCAIS sempre seguem o
  // período (em "Hoje" o corte é nulo = todo o histórico). O resto é contexto e vem
  // abaixo, em corpo menor.
  const fmtN=(n,s,p)=>`${NUM.format(n)} ${n===1?s:p}`;
  // Atrasado = passou da data de compromisso do fiscal. Processo SEM essa data não é "no
  // prazo" — não há prazo para cumprir —, então vira um terceiro grupo e só aparece
  // quando existe; somá-lo ao "no prazo" inflaria justamente o número que tranquiliza.
  // Só em "Hoje": atraso é condição de quem está com o fiscal agora, e numa janela o card
  // também soma despachados, para os quais "atrasado" não quer dizer nada.
  const noPrazo=a.comMeta-a.metaEst, semPrazo=a.fila-a.comMeta;
  // O card PROCESSOS não leva mais subtexto (usuário, 2026-09-17): "N com o fiscal hoje ·
  // M despachados" (fora de "Hoje") e "N atrasados · M no prazo" (em "Hoje") eram
  // redundantes com os outros cards e com o donut da seção GECOPE × Fiscalização, que já
  // mostra a mesma quebra atrasado/no prazo/sem prazo. `noPrazo`/`semPrazo`/`a.metaEst`
  // continuam vivos — o donut (`segsAtraso`, mais abaixo) é quem os usa agora.
  const procSub='';
  // Textos do "i" em parágrafos (separados por \n\n): mostraRpTip() quebra cada um numa
  // <p>, para não virar um bloco só difícil de ler (usuário, 2026-09-17).
  // Sempre a explicação de "hoje" — não muda com o período (ver aggProc()).
  const tipProc = '1. Processos que estão com os fiscais hoje com status Análise Fiscal ou Devolvido p/ Reanálise Fiscal.\n\n'
    +'2. Atrasado: já passou da data de compromisso do fiscal.\n\n'
    +'3. No prazo: a data estipulada para conclusão da análise/reanálise ainda não chegou.'
    +(semPrazo?'\n\n4. Sem prazo: não tem data de compromisso cadastrada.':'');
  const tipTempo='Média de dias que o processo ficou na unidade do fiscal no SUITE até ir para a GECOPE (ou, sem '
    +'passagem pela GECOPE, para a DIFOR) e ser aprovado, somando idas e voltas.\n\n'
    +'Conta só o tempo de quem despachou, desde que assumiu o processo; o tempo de um fiscal anterior não entra. '
    +'Processo aberto já pronto (menos de 1 dia com o fiscal) conta como despacho, mas não entra na média.\n\n'
    +`Calculada sobre ${fmtN(a.nTempo,'despacho','despachos')} — ${per}. `
    +`Com menos de ${AMOSTRA_MIN} despachos a média não é mostrada: um único processo decidiria o resultado.`;
  const tipDesp='Processos aprovados pela GECOPE (Aprovado, ou Arquivado com data de aprovação), na data em que '
    +`saíram da unidade do fiscal no SUITE (sem passagem por ela, na data da ida à GECOPE) — ${per}.\n\n`
    +'Arquivado sem data de aprovação não conta.';
  // Mesma régua de Despachos e Tempo médio (usuário, 2026-09-21): só quem despachou dentro
  // do período conta — não soma mais quem só tem processo na fila agora sem ter despachado
  // nela, que era o que tornava o card confuso (parecia ora "posição de hoje", ora
  // "histórico", sem seguir nenhuma das duas réguas de forma limpa).
  const tipFiscais=`Fiscais que despacharam algum processo — ${per}. Cada fiscal conta uma vez, `
    +'seja qual for o número de despachos dele.'
    +(a.semMatricula?`\n\n${fmtN(a.semMatricula,'processo está','processos estão')} sem matrícula de fiscal gravada e não `
      +`${a.semMatricula===1?'entra':'entram'} nesta conta.`:'');
  const kpis=`<div class="kpis">
      ${kpi('Processos', NUM.format(a.procs), tipProc, procSub)}
      ${kpi('Tempo médio', tempo, tipTempo,
            a.nTempo>=AMOSTRA_MIN ? '' : escHtml(a.nTempo ? `só ${nDesp}` : 'nenhum despacho'))}
      ${kpi('Despachos', NUM.format(a.desp), tipDesp)}
      ${kpi('Fiscais', NUM.format(a.fiscais), tipFiscais,
            a.semMatricula ? escHtml(`${fmtN(a.semMatricula,'processo','processos')} sem matrícula`) : '')}
    </div>`;
  // GECOPE: total e a quebra por status, uma linha cada (pedido do usuário). Os cinco
  // status pedidos aparecem sempre, mesmo zerados; qualquer outro que a base tenha (EM
  // REANÁLISE, CONTRATANTE…) só quando existe — sem ele as linhas não fechariam com o total.
  const GECOPE_ST=['DILIGÊNCIA','EM ANÁLISE','AGUAR. ANÁLISE','AGUAR. REANÁLISE','AGUAR. APROVAÇÃO'];
  const extras=[...a.gecope.keys()].filter(k=>!GECOPE_ST.includes(k)).sort((x,y)=>x.localeCompare(y,'pt-BR'));
  const gecRows=[...GECOPE_ST,...extras].map(k=>{
    const n=a.gecope.get(k)||0;
    return `<div class="gec-st${n?'':' zero'}"><span>${escHtml(k)}</span><b>${NUM.format(n)}</b></div>`;
  }).join('');
  // FISCALIZAÇÃO: mesma ideia do GECOPE, quebrado pelos dois status da fila (statusTxt já
  // traz "REANÁLISE FISCAL" no lugar do rótulo longo do banco).
  const FILA_ST=['ANÁLISE FISCAL','REANÁLISE FISCAL'];
  const filaExtras=[...a.filaPorStatus.keys()].filter(k=>!FILA_ST.includes(k)).sort((x,y)=>x.localeCompare(y,'pt-BR'));
  const filaRows=[...FILA_ST,...filaExtras].map(k=>{
    const n=a.filaPorStatus.get(k)||0;
    return `<div class="gec-st${n?'':' zero'}"><span>${escHtml(k)}</span><b>${NUM.format(n)}</b></div>`;
  }).join('');
  // GECOPE × Fiscalização: os dois lados da fila de replanilhamento, hoje. Base = quem está
  // num dos dois grupos (naGecope + fila), não o total do recorte (que inclui já
  // despachado). Pedido do usuário em 2026-09-17: um título só, percentual de cada lado, e
  // um anel mostrando quantos dos que estão na Fiscalização estão atrasados × no prazo —
  // "sem prazo" (sem data de compromisso) entra como terceira fatia só quando existe, pela
  // mesma razão do card PROCESSOS: somá-lo ao "no prazo" inflaria o número que tranquiliza.
  const baseGxF=a.naGecope+a.fila;
  const pctGxF=n=>baseGxF?`${fmtPct1(n/baseGxF*100)}%`:'—';
  const segsAtraso=[
    {n:a.metaEst, label:'Atrasado', cls:'atraso'},
    {n:Math.max(noPrazo,0), label:'No prazo', cls:'noprazo'},
    {n:Math.max(semPrazo,0), label:'Sem prazo', cls:'semprazo'},
  ];
  // Tamanho reduzido (84, não o padrão 118): dentro de .gxf-grp a coluna real do painel
  // fica perto de 170px (achado do rev-design, 2026-09-17) — o anel padrão não cabia nem
  // empilhado sobre a legenda sem sobrar quase nada de largura útil para os rótulos.
  const donut=a.fila?`<div class="gxf-donut">${donutMulti(segsAtraso,84)}${donutLeg(segsAtraso)}</div>`:'';
  const contexto=`<div class="statwrap">
      <div class="sec-h"><span>Processos em Tramitação — GECOPE × FISCALIZAÇÃO</span></div>
      <div class="sec-sub">Situação dos processos na GECOPE e na FISCALIZAÇÃO</div>
      <div class="gxf">
        <div class="gxf-grp">
          <div class="gxf-h"><span>GECOPE</span><b>${NUM.format(a.naGecope)}</b><span class="gxf-pct">${pctGxF(a.naGecope)}</span></div>
          <div class="gec-lista">${gecRows}</div>
        </div>
        <div class="gxf-grp">
          <div class="gxf-h"><span>Fiscalização</span><b>${NUM.format(a.fila)}</b><span class="gxf-pct">${pctGxF(a.fila)}</span></div>
          <div class="gec-lista">${filaRows}</div>
          ${donut}
        </div>
      </div>
      <div class="foot-note">${escHtml(nota)}</div>
    </div>`;
  // Ranking: a mesma métrica do mapa, em lista navegável. O cabeçalho nomeia a métrica —
  // sem isso a coluna de números à direita fica sem unidade.
  const r=rpRanking();
  const ranking = r && r.ents.length ? `<div class="statwrap">
      <div class="sec-h"><span>${r.kind==='group'?'Distritos':'Cidades'}</span>`
      +`<span>${escHtml(RP_METRICA[st.rp.metrica].label)}</span></div>`
      // mesma frase da legenda do mapa e da lista de irmãos da trilha: é a terceira
      // superfície com estes números, e nenhuma delas pode dizer o recorte de um jeito
      // diferente das outras
      +`<div class="sec-sub">${escHtml(rpRecorteTxt(r.kind==='group'))}</div>`
      +rpRankRowsHtml(r.ents,r.kind)+`</div>` : '';
  // Nível 3 (cidade aberta): sem ranking abaixo, a navegação terminaria num beco. A lista
  // dos processos é o detalhe que fecha o caminho macro → micro.
  let lista='';
  if(st.level>=3){
    const ordenados=[...procs].sort(rpOrdemProc), mostra=ordenados.slice(0,PROC_LISTA_MAX);
    lista=`<div class="statwrap">
      <div class="sec-h"><span>Processos</span><span>${NUM.format(procs.length)}</span></div>`
      +`<div class="sec-sub">Primeiro os que estão há mais tempo com o fiscal; depois os que estão na GECOPE, os já despachados e os arquivados no trâmite.</div>`
      +mostra.map(procCard).join('')
      +(procs.length>mostra.length?`<div class="foot-note">Mostrando ${NUM.format(mostra.length)} de ${NUM.format(procs.length)}, nesta ordem.</div>`:'')
      +`</div>`;
  }
  // Ordem de leitura: os quatro números do recorte, o contexto deles, as pessoas (E4), as
  // áreas em lista navegável e, no fim do caminho, os processos.
  body.innerHTML=kpis+contexto+rpFiscaisRankingHtml(procs,a)+ranking+lista+conferencia;
}

function renderPanel(){
  const scope=document.getElementById('scope'), body=document.getElementById('body');
  const methodName='Distritos Operacionais';
  // Tira de cena os KPIs e gráficos estáticos de OBRAS no modo novo (regra no CSS).
  // Alternado aqui, e não em setModo, porque renderPanel roda nos dois modos: a volta
  // para Obras — inclusive por reverterParaObras() — limpa a classe sem caminho próprio.
  _asideEl.classList.toggle('modo-replan',modoReplan());
  if(modoReplan()){ renderPanelReplan(scope,body); return; }
  // Depois do desvio: setKPIs agrega obras e redesenha 3 gráficos, e renderPanel roda a
  // cada hover de distrito — no modo novo esse trabalho iria para blocos ocultos.
  setKPIs();
  if(st.sel && st.sel.ids.size){
    // seleção combinada (Ctrl+clique em vários distritos/municípios) tem
    // prioridade sobre o ranking/busca normais — é um recorte explícito do usuário
    const kindLabel=st.sel.kind==='group'?'distrito':'município';
    const chips=[...st.sel.ids].map(id=>{
      const nome=st.sel.kind==='group' ? (grpById(id)?grpById(id).nome.replace(/^D\.O\.\s*/,''):id)
                                        : (DB.municipios[id]?DB.municipios[id].nome:id);
      return `<span class="chip chip-sel" role="button" tabindex="0" data-selid="${id}" title="Remover ${escHtml(nome)} da seleção">${escHtml(nome)} ✕</span>`;
    }).join('');
    const n=st.sel.ids.size;
    scope.innerHTML=`<b>${n}</b> ${kindLabel}${n===1?'':'s'} selecionado${n===1?'':'s'}${resultsSuffix(selectionMunIds())} — Ctrl+clique pra somar/tirar da seleção`
      +` <button class="clearf" id="clearSelBtn" style="display:inline-flex;margin-left:8px;padding:3px 10px;font-size:10px">Limpar seleção</button>`;
    document.getElementById('clearSelBtn').onclick=clearSelection;
    body.innerHTML=`<div class="chips" style="margin-bottom:14px">${chips}</div>`
      +`<div class="sec-h"><span>Contratos combinados</span></div>`+obrasCards(selectionMunIds());
  } else if(st.level<=1 && hasActiveFilter()){
    // busca/filtro ativo com o mapa ainda no nível Estado/Distritos: mostra os
    // contratos encontrados direto (em vez do ranking por distrito), cada um com
    // o município clicável — sem precisar descer manualmente até lá
    const cards=obrasCards(allIds), n=CUROBRAS.length;
    scope.innerHTML=`<b>${NUM.format(n)}</b> contrato${n===1?'':'s'} encontrado${n===1?'':'s'}${n?' — clique no município do card para localizar no mapa':''}`;
    body.innerHTML=`<div class="sec-h"><span>Resultados da busca</span><span>${NUM.format(n)}</span></div>`+cards;
  } else if(st.level<=1){
    if(st.level===1 && st.hoverGroup!=null){
      const g=grpById(st.hoverGroup); const ids=idsOfGroup(st.hoverGroup);
      scope.innerHTML=`Distrito destacado — <b>clique para abrir os municípios</b>${resultsSuffix(ids)}`;
      body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${g.nome}</div>`
        +`<div class="scope" style="margin-top:8px">${ids.length} municípios neste distrito</div>`;
    } else {
      scope.innerHTML=`Estado dividido por <b>${methodName}</b> — passe o mouse ou clique para entrar`; // Etapa D: nível 0 removido
      // na métrica Elétrica o ranking por distrito some daqui (pedido do usuário,
      // 24/09/2026): o mesmo dado já está pintado no mapa por distrito, a lista de
      // texto seria redundante.
      if(st.metric==='eletrica'){ body.innerHTML=''; }
      else{
        const ents=groupEntries();
        body.innerHTML=`<div class="sec-h"><span>${methodName}</span><span>${ents.length}</span></div>`+rankRows(ents,'group');
      }
    }
  } else if(st.level===2){
    const g=grpById(st.group);
    const ids=idsOfGroup(st.group);
    scope.innerHTML=`Distrito selecionado${resultsSuffix(ids)}`;
    const ents=cityEntries(ids);
    body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${g.nome}</div>`
      +`<div class="sec-h"><span>Cidades (${ids.length})</span><span>clique p/ abrir</span></div>`+rankRows(ents,'city')
      +`<div class="sec-h" style="margin-top:20px"><span>Contratos do distrito</span></div>`+obrasCards(ids);
  } else {
    const id=st.city, g=grpById(gidOf(id));
    scope.innerHTML=`Município selecionado · ${g.nome.replace(/^D\.O\.\s*/,'')}${resultsSuffix([id])}`;
    body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${DB.municipios[id].nome}</div>`
      +`<div class="sec-h" style="margin-top:12px"><span>Contratos</span><span>${obrasOf(id).length}</span></div>`+obrasCards([id]);
  }
}
function renderCrumb(){
  const c=document.getElementById('crumb');
  const methodName='Distritos';
  // qualquer render() reconstrói a trilha do zero (innerHTML) — a âncora que o popover
  // de irmãos guardava fica órfã, então fecha aqui em vez de tentar reposicionar.
  closeSiblingPopover();
  const sibTrig=(nome)=>`<a data-nav="siblings" class="cur sib" role="button" tabindex="0" aria-haspopup="true" title="Ver outros ${st.level===2?'distritos':'municípios'}"><span class="sib-text">${nome}</span> <span class="sib-caret">▾</span></a>`;
  let h='';
  // Etapa D: nível 1 é a "casa" do app — a trilha começa em "Distritos", sem o
  // "Ceará" isolado que antes representava o nível 0.
  if(st.level===1){h=`<span class="cur">${methodName}</span>`;}
  else if(st.level===2){h=`<a data-nav="sub">${methodName}</a><span class="sep">›</span>${sibTrig(grpById(st.group).nome.replace(/^D\.O\.\s*/,''))}`;}
  else {h=`<a data-nav="sub">${methodName}</a><span class="sep">›</span><a data-nav="group">${grpById(gidOf(st.city)).nome.replace(/^D\.O\.\s*/,'')}</a><span class="sep">›</span>${sibTrig(DB.municipios[st.city].nome)}`;}
  if(st.sel && st.sel.ids.size) h+=`<span class="sep">›</span><span class="cur">${st.sel.ids.size} selecionado${st.sel.ids.size===1?'':'s'}</span>`;
  c.innerHTML=h;
}
function renderFoot(){
  // O clique no mapa faz coisas diferentes nos dois modos (ver onGroup): em Obras desce
  // para as cidades, em Replanilhamentos abre o painel do distrito. O rodapé é o único
  // lugar que explica o gesto, então precisa dizer o que ele faz AQUI.
  const txt=modoReplan()
    ? `Clique num <b>Distrito Operacional</b> no mapa para abrir o painel do distrito; use o ranking ao lado para descer até as cidades.
       Divisão oficial dos 11 D.Os (SOP). Processos de replanilhamento do GECOPE; tempo de resposta pelo histórico do SUITE.`
    : `Fluxo: <b>Distritos Operacionais → cidades</b>. Clique numa área para descer; use a trilha no topo para voltar.
       Divisão oficial dos 11 D.Os (SOP). Dados oficiais da base de contratos de obras da SOP-CE.`;
  document.getElementById('foot').innerHTML=txt;
}

// Classes de modo na raiz E no body. A raiz porque os tokens do modo (paleta calma do escuro,
// piso da rampa) são lidos por getComputedStyle(documentElement) — TOKENS precisa ser relido
// quando o modo vira, senão o JS pintaria o mapa com a paleta do outro modo.
function sincronizaModoRp(){
  const rp=modoReplan(), raiz=document.documentElement;
  const mudou=raiz.classList.contains('modo-rp')!==rp;
  raiz.classList.toggle('modo-rp',rp);
  document.body.classList.toggle('modo-rp',rp);
  if(!mudou) return;
  Object.assign(TOKENS,readTokens());
  BASE=TOKENS.mapBase;
  if(stateShape) stateShape.setStyle({fillColor:TOKENS.mapStateFill,color:`rgba(${TOKENS.ngRgb},.42)`});
  syncStatusColors();
  if(_lastStatus) setStatus(_lastStatus.txt,_lastStatus.ok,_lastStatus.lastSync,_lastStatus.replan);
}
function render(){
  // E2 — reavalia se o filtro Prazo pode ficar visível/aplicado ANTES de qualquer leitura
  // de processo (rpPreparaMapa/filtraRp, logo abaixo): se Situação deixou de ser só
  // "Fiscalização", syncPrazoRp() já limpa st.rp.filtro.prazo neste mesmo render, em vez
  // de deixar um filtro fantasma valer por mais um ciclo.
  syncPrazoRp();
  // Ganchos de CSS do modo Replanilhamentos (rótulos do mapa e escala de peso; ver body.modo-rp).
  sincronizaModoRp();
  if(modoReplan()) rpPreparaMapa();
  else if(st.level===2) _levelMax=Math.max(1,...idsOfGroup(st.group).map(id=>mval(aggIds([id]))));
  if(!modoReplan() && st.level===1 && hasActiveFilter()){
    _groupValByGid=new Map(); _groupCountByGid=new Map();
    groupsList().forEach(g=>{ const a=aggIds(idsOfGroup(g.id)); _groupValByGid.set(String(g.id),mval(a)); _groupCountByGid.set(String(g.id),a.obras); });
    _levelMaxGroup=Math.max(1,...[..._groupValByGid.values()]);
  } else {
    _groupValByGid=new Map(); _groupCountByGid=new Map();
  }
  layer.setStyle(styleFeature); applyInteractivity(); updateLabels();
  // groupStyle() agora faz trabalho de verdade (idsOfGroup+aggIds) quando há filtro
  // ativo, não só devolve um objeto constante — só compensa recalcular enquanto o
  // próprio groupLayer está visível (nível 1). Ctrl+clique em grupo (st.sel.kind
  // ==='group') também só existe nesse nível (goGroup/goCity/goState/goSub sempre
  // zeram st.sel antes de sair dele), então esta guarda não perde o "reflete seleção
  // sem esperar o zoomend" que esta chamada existe pra garantir.
  if(st.level===1 && groupLayer){
    groupLayer.setStyle(groupStyle);
    // Etapa C: distrito "sem correspondência" fica sem pointer (cursor normal, não navegável)
    groupLayer.eachLayer(l=>{ if(!l._path) return;
      l._path.style.pointerEvents = noMatchGroup(l.feature.properties.gid)?'none':'';
      l._path.classList.toggle('sem-amostra', semAmostraGrp(l.feature.properties.gid)); });
  }
  setLayer(stateShape, false); // Etapa D: nível 0 removido — stateShape nunca é exibido
  setLayer(groupLayer, st.level===1); if(st.level===1 && groupLayer) groupLayer.bringToFront();
  renderCrumb(); renderPanel(); renderFoot(); renderFilterChips(); renderFilterChipsRp();
  syncControlesModo(); renderLegendaReplan();
}

// ---- filtros / busca (multi-seleção) ----
// Etapa C — cada def é "de valores" (get:o=>string|null; opções varridas dos dados,
// como Contratada) OU "de categoria fixa" (get:o=>chave do bucket; opções fixas em
// `cats`, com rótulo próprio — faixas e derivados). passF() trata as duas igual;
// só fillFilters() difere. Ordem: navegação → atributos do contrato → pessoas/empresas.
// ocultoEletrica: filtro some do painel na métrica Elétrica (pedido do usuário,
// 24/09/2026 — esses 5 não fazem sentido pra quem está planejando vistoria). soEletrica:
// o oposto, só aparece NESSA métrica (caso único hoje: 'vistoria'). filterDefsVisiveis()
// decide qual conjunto mostrar; o clique no seletor de métrica (mais abaixo) limpa o
// valor selecionado de quem estiver saindo de cena, pra nunca sobrar filtro escondido
// recortando resultado sem nenhum chip/selo visível explicando por quê.
const FILTER_DEFS=[
  {key:'distrito',label:'Distrito Operacional',get:o=>o.distrito||null,ocultoEletrica:true},
  {key:'municipio',label:'Município',get:o=>o.municipioTxt||null},
  {key:'tipo',label:'Tipo de contrato',get:o=>o.tipo||null,ocultoEletrica:true},
  {key:'ano',label:'Ano',get:o=>o.ano?String(o.ano):null,numeric:true},
  {key:'status',label:'Status da obra',get:o=>(o.statusObra&&o.statusObra!=='—')?o.statusObra:null},
  {key:'prazoExec',label:'Prazo de execução',get:o=>o.prazoExecBucket,ocultoEletrica:true,cats:[
    {v:'ok',label:'No prazo'},{v:'avencer',label:'A vencer (≤ 30 dias)'},{v:'vencido',label:'Vencido'},{v:'semdata',label:'Sem data'}]},
  {key:'vigencia',label:'Vigência do contrato',get:o=>o.vigenciaBucket,ocultoEletrica:true,cats:[
    {v:'ok',label:'Vigente'},{v:'avencer',label:'A vencer (≤ 30 dias)'},{v:'vencido',label:'Vencida'},{v:'semdata',label:'Sem data'}]},
  {key:'paralisada',label:'Obra paralisada',get:o=>o.paralisadaBucket,cats:[
    {v:'sim',label:'Sim'},{v:'nao',label:'Não'}]},
  {key:'faixaValor',label:'Faixa de valor',get:o=>o.faixaValorBucket,ocultoEletrica:true,cats:[
    {v:'ate1m',label:'Até R$ 1 mi'},{v:'1a5m',label:'R$ 1–5 mi'},{v:'5a20m',label:'R$ 5–20 mi'},{v:'acima20m',label:'Acima de R$ 20 mi'}]},
  {key:'medicao',label:'Medição (% executado)',get:o=>o.medicaoBucket,cats:[
    {v:'0a25',label:'0–25%'},{v:'25a50',label:'25–50%'},{v:'50a75',label:'50–75%'},{v:'75a100',label:'75–100%'},{v:'acima100',label:'Acima de 100%'},{v:'semficha',label:'Sem ficha'}]},
  {key:'vistoria',label:'Vistorias',get:o=>(o.relatoriosEletrica&&o.relatoriosEletrica.length)?'realizada':'arealizar',soEletrica:true,cats:[
    {v:'realizada',label:'Realizadas'},{v:'arealizar',label:'A realizar'}]},
  {key:'contratada',label:'Contratada',get:o=>(o.contratada&&o.contratada!=='—')?o.contratada:null},
  {key:'contratante',label:'Contratante',get:o=>(o.contratante&&o.contratante!=='—')?o.contratante:null},
  {key:'fiscal',label:'Fiscal',get:o=>(o.fiscal&&o.fiscal!=='—')?o.fiscal:null},
];
function filterDefsVisiveis(){ return FILTER_DEFS.filter(d=>st.metric==='eletrica'?!d.ocultoEletrica:!d.soEletrica); }
function updateMselBtn(key){
  const m=document.querySelector(`.msel[data-key="${key}"]`); if(!m) return;
  const btn=m.querySelector('.msel-btn'); const label=btn.dataset.label; const n=st.f[key].size;
  btn.innerHTML = n ? `${label} <span class="cnt">(${n})</span>` : `${label}: todos`;
}
function fillFilters(){
  const all=[]; allIds.forEach(id=>DB.municipios[id].obras.forEach(o=>all.push(o)));
  const host=document.getElementById('filtersHost');
  host.innerHTML=filterDefsVisiveis().map(d=>{
    let vals; // [{v,label}]
    if(d.cats){
      // categoria fixa: opções sempre as mesmas; rótulo próprio.
      vals=d.cats.map(c=>({v:c.v,label:c.label}));
    } else {
      const set=new Set(); all.forEach(o=>{const v=d.get(o); if(v)set.add(v);});
      // poda "fantasma": valor selecionado que não existe mais no recorte carregado
      // (ex.: troca Carteira↔Histórico) não pode continuar recortando.
      if(st.f[d.key].size) st.f[d.key]=new Set([...st.f[d.key]].filter(v=>set.has(v)));
      vals=[...set].sort(d.numeric?(a,b)=>b-a:(a,b)=>a.localeCompare(b,'pt-BR')).map(v=>({v,label:v}));
    }
    const empty=vals.length===0;
    const opts=vals.map(x=>`<label class="msel-opt"><input type="checkbox" value="${escHtml(x.v)}">${escHtml(x.label)}</label>`).join('')
      || '<div class="msel-empty">Sem opções neste recorte</div>';
    return `<div class="msel${empty?' is-empty':''}" data-key="${d.key}">
      <button type="button" class="msel-btn" data-label="${escHtml(d.label)}"${empty?' disabled title="Nenhum contrato do recorte atual tem este atributo"':''}></button>
      <div class="msel-panel">
        <div class="msel-query"></div>
        ${opts}
        <div class="msel-noresult">Nenhuma opção encontrada</div>
      </div>
    </div>`;
  }).join('');
  // Escopado a `host` (#filtersHost), não document: sem isso o laço também pega os
  // .msel do Replanilhamentos (#filtersHostRp, já preenchidos por fillFiltersRp() no
  // carregamento do script) e tenta st.f['situacao']/st.f['prazo'], que não existem
  // nesse objeto — TypeError que interrompe o forEach ANTES de chegar em qualquer
  // filtro de Obras, deixando todos os botões sem rótulo (bug relatado: "sumiram os
  // nomes" dos filtros).
  host.querySelectorAll('.msel').forEach(m=>{
    const key=m.dataset.key;
    m.querySelectorAll('.msel-opt input').forEach(cb=>{ cb.checked=st.f[key].has(cb.value); });
    updateMselBtn(key);
  });
}
// busca por digitação direta (sem campo de texto): com o painel aberto, as teclas
// digitadas filtram as opções ao vivo — reseta sozinho após uma pausa ou ao fechar.
function normSearch(s){ return (s==null?'':String(s)).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
let mselQuery='', mselQueryTimer=null;
function mselFilterOpts(m){
  const q=normSearch(mselQuery); let anyVisible=false;
  m.querySelectorAll('.msel-opt').forEach(opt=>{
    const show=!q || normSearch(opt.querySelector('input').value).includes(q);
    opt.classList.toggle('hide',!show); if(show) anyVisible=true;
  });
  const qEl=m.querySelector('.msel-query');
  if(qEl){ qEl.textContent=mselQuery?`Buscando: "${mselQuery}"`:''; qEl.classList.toggle('show',!!mselQuery); }
  const nr=m.querySelector('.msel-noresult');
  if(nr) nr.classList.toggle('show', !!mselQuery && !anyVisible);
}
function mselResetQuery(m){ mselQuery=''; if(m) mselFilterOpts(m); }
const _fHost=document.getElementById('filtersHost');
_fHost.addEventListener('click',e=>{
  const btn=e.target.closest('.msel-btn'); if(!btn) return;
  const m=btn.closest('.msel'); const wasOn=m.classList.contains('on');
  document.querySelectorAll('.msel.on').forEach(x=>{x.classList.remove('on'); mselResetQuery(x);});
  if(!wasOn){ m.classList.add('on'); mselResetQuery(m); }
});
_fHost.addEventListener('change',e=>{
  const cb=e.target.closest('.msel-opt input'); if(!cb) return;
  const key=cb.closest('.msel').dataset.key;
  if(cb.checked) st.f[key].add(cb.value); else st.f[key].delete(cb.value);
  updateMselBtn(key); invalidateAggCache(); render(); autoLocateSearch();
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.msel')) document.querySelectorAll('.msel.on').forEach(x=>{x.classList.remove('on'); mselResetQuery(x);});
});
document.addEventListener('keydown',e=>{
  const m=document.querySelector('.msel.on'); if(!m) return;
  if(e.target.tagName==='INPUT' && e.target.type!=='checkbox') return;
  if(e.key==='Escape'){ m.classList.remove('on'); mselResetQuery(m); return; }
  if(e.key==='Backspace'){ mselQuery=mselQuery.slice(0,-1); mselFilterOpts(m); e.preventDefault(); }
  else if(e.key.length===1 && /[a-zA-Z0-9À-ÿ]/.test(e.key)){ mselQuery+=e.key; mselFilterOpts(m); e.preventDefault(); }
  else return;
  clearTimeout(mselQueryTimer); mselQueryTimer=setTimeout(()=>mselResetQuery(m),2500);
});
// A pedido: pesquisar nos filtros NÃO reposiciona mais o mapa. Antes, 1 município
// encontrado fazia a câmera voar até ele (fitCity, zoom alto — o "zoom grande sem
// necessidade" reclamado, ex.: busca por "ALVES FREITAS") e vários faziam um
// flyToBounds pra enquadrar todos. Agora a busca só refiltra dados, cores do mapa
// e painel; o enquadramento só muda por navegação explícita (clique numa área).
let _searchNav=false; // mantido por compatibilidade — a busca não navega mais o mapa
function autoLocateSearch(){ /* no-op: busca/filtro não mexe na câmera */ }
let _fSearchTimer=null;
document.getElementById('fSearch').addEventListener('input',e=>{
  // PERFORMANCE: render() reestiliza toda a camada GeoJSON + roda o algoritmo de
  // declutter de rótulos a cada chamada — sem debounce isso rodava a cada tecla digitada.
  st.f.q=e.target.value.trim(); // mantém o caso digitado (o chip mostra); passF() minúsculo no compare
  clearTimeout(_fSearchTimer);
  _fSearchTimer=setTimeout(()=>{ invalidateAggCache(); render(); autoLocateSearch(); },150);
});
// Etapa C — zera busca + todos os campos de filtro. Compartilhado pelo botão do
// rodapé do painel (#clearF) e pelo "Limpar tudo" do bloco de chips.
function clearAllFilters(){
  Object.keys(st.f).forEach(k=>{ if(st.f[k] instanceof Set) st.f[k].clear(); });
  st.f.q=''; const fs=document.getElementById('fSearch'); if(fs) fs.value='';
  _fHost.querySelectorAll('.msel-opt input').forEach(cb=>cb.checked=false);
  // Escopado a _fHost pelo mesmo motivo do laço de fillFilters() acima: sem isso pega
  // também os .msel do Replanilhamentos e quebra em st.f['situacao']/st.f['prazo'].
  _fHost.querySelectorAll('.msel').forEach(m=>{updateMselBtn(m.dataset.key); m.classList.remove('on'); mselResetQuery(m);});
  invalidateAggCache(); render(); autoLocateSearch();
}
document.getElementById('clearF').onclick=clearAllFilters;

// Etapa C — bloco "Filtros ativos": um chip por valor selecionado (× remove só
// aquele valor), + "Limpar tudo". Some quando não há filtro. Acende o selo do
// #ctrlToggle. Chamado no fim de render(), então acompanha qualquer mudança.
function fchipLabel(d,v){ const c=d.cats&&d.cats.find(x=>x.v===v); return c?c.label:v; }
function renderFilterChips(){
  const host=document.getElementById('filterChips'); if(!host) return;
  const chips=[];
  if(st.f.q) chips.push(`<span class="chip fchip" data-key="__q" role="button" tabindex="0" title="Remover a busca">Busca: “${escHtml(st.f.q)}” <b class="x" aria-hidden="true">✕</b></span>`);
  FILTER_DEFS.forEach(d=>{
    const set=st.f[d.key]; if(!set||!set.size) return;
    [...set].forEach(v=>{
      const lab=`${d.label}: ${fchipLabel(d,v)}`;
      chips.push(`<span class="chip fchip" data-key="${escHtml(d.key)}" data-val="${escHtml(v)}" role="button" tabindex="0" title="Remover ${escHtml(lab)}">${escHtml(lab)} <b class="x" aria-hidden="true">✕</b></span>`);
    });
  });
  host.innerHTML = chips.length
    ? chips.join('')+`<button type="button" class="fchip-clear" id="fchipClear">Limpar tudo</button>`
    : '';
  const c=document.getElementById('fchipClear'); if(c) c.onclick=clearAllFilters;
  // O selo diz "há filtro agindo no mapa". No modo Replanilhamentos os filtros de obras
  // ficam guardados, mas não agem — o selo aí passa a refletir o filtro de PROCESSOS da
  // E6 (hasFiltroRp), não os chips de obras que `chips` acima descreve.
  const tgl=document.getElementById('ctrlToggle'); if(tgl) tgl.classList.toggle('has-filters', modoReplan()?hasFiltroRp():chips.length>0);
  // "+" fica em destaque quando há algum filtro selecionado (podem estar recolhidos)
  const ft=document.getElementById('filtToggle');
  if(ft) ft.classList.toggle('has-active', FILTER_DEFS.some(d=>{const s=st.f[d.key];return s&&s.size;}));
}
function removeFilterChip(chip){
  const key=chip.dataset.key;
  if(key==='__q'){ st.f.q=''; const fs=document.getElementById('fSearch'); if(fs) fs.value=''; }
  else {
    const val=chip.dataset.val; st.f[key].delete(val); updateMselBtn(key);
    document.querySelectorAll(`.msel[data-key="${key}"] .msel-opt input`).forEach(cb=>{ if(cb.value===val) cb.checked=false; });
  }
  invalidateAggCache(); render(); autoLocateSearch();
}
document.getElementById('filterChips').addEventListener('click',e=>{
  const chip=e.target.closest('.fchip'); if(chip) removeFilterChip(chip);
});
document.getElementById('filterChips').addEventListener('keydown',e=>{
  if(e.key!=='Enter' && e.key!==' ') return;
  const chip=e.target.closest('.fchip'); if(!chip) return;
  e.preventDefault(); removeFilterChip(chip);
});

// painel de filtros recolhível (recolhido por padrão)
const _ctrl=document.getElementById('ctrl'), _ctrlT=document.getElementById('ctrlToggle');
// Etapa C — com ~14 campos o painel pode passar da altura da tela (ainda mais quando
// o cabeçalho quebra em várias linhas em telas estreitas). Limita a altura ao espaço
// real abaixo do topo do painel na viewport; o overflow-y:auto do CSS rola o resto.
function fitCtrlHeight(){
  if(!_ctrl.classList.contains('show')) return;
  const top=_ctrl.getBoundingClientRect().top;
  _ctrl.style.maxHeight=Math.max(160,window.innerHeight-top-14)+'px';
}
// abrir/fechar Controles muda a largura que fitPad() precisa compensar à esquerda
// (ver fitFull/fitGroup/fitCity) — sem o refit() aqui, o mapa só recentraria no
// próximo reenquadramento por outro motivo (navegar, redimensionar a janela).
function openCtrl(o){ _ctrl.classList.toggle('show',o); _ctrlT.style.display=o?'none':''; if(o) fitCtrlHeight(); if(layer) refit(); }
_ctrlT.onclick=()=>openCtrl(true);
document.getElementById('ctrlClose').onclick=()=>openCtrl(false);
window.addEventListener('resize',fitCtrlHeight);
openCtrl(false);

// o bloco de filtros (as ~13 multi-seleções, #filtersHost) começa RECOLHIDO — só
// Métrica + Buscar à mostra. O "+" ao lado de "Filtros" expande/recolhe. Os chips de
// filtro ativo e o botão "Limpar" ficam sempre visíveis (o usuário vê/remove o que
// está filtrando). Reusa _fHost (delegação de eventos das multi-seleções, acima).
const _filtT=document.getElementById('filtToggle');
function toggleFilters(show){
  const on = show===undefined ? _fHost.hidden : !!show;
  _fHost.hidden=!on;
  _filtT.textContent=on?'−':'+';       // − (U+2212) / +
  _filtT.setAttribute('aria-expanded',String(on));
  const t=on?'Recolher filtros':'Mostrar todos os filtros';
  _filtT.title=t; _filtT.setAttribute('aria-label',t);
  if(_ctrl.classList.contains('show')) fitCtrlHeight();
}
if(_filtT){ _filtT.onclick=()=>toggleFilters(); toggleFilters(false); } // estado inicial numa fonte só

// painel lateral (KPIs/ranking) recolhível — aberto por padrão (ver modo apresentação abaixo)
const _mainEl=document.querySelector('main'), _asideT=document.getElementById('asideToggle');
// Lido por renderPanel(). Seguro aqui porque todo render() — o inicial, o de tema e os
// de interação — acontece depois de `layer` existir, e ele só é criado mais abaixo.
const _asideEl=_mainEl.querySelector('aside');
// compartilhada com onGroup() (nível 1) — evita recriar o mesmo closure a cada feature
// em buildGroupLayer() (~11-14x por build/troca de método).
function panelVisible(){ return !_mainEl.classList.contains('aside-collapsed'); }
function openAside(o){
  _mainEl.classList.toggle('aside-collapsed',!o); _asideT.style.display=o?'none':'';
  // ao reabrir, o painel pode estar com conteúdo velho (onGroup pula renderPanel()
  // enquanto está recolhido, ver Fase 7) — atualiza 1x na hora de abrir pra não mostrar
  // o hover de antes de fechar caso o mouse ainda esteja sobre um distrito/região.
  if(o) renderPanel();
  clearTimeout(openAside._t); openAside._t=setTimeout(()=>{ map.invalidateSize(false); refit(); },380);
}
_asideT.onclick=()=>openAside(true);
document.getElementById('asideClose').onclick=()=>openAside(false);

// modo apresentação: layout padrão fixo desta página (tipografia maior) —
// pensado para projetar em reunião (ex.: conselho deliberativo). O painel
// lateral de KPIs começa recolhido (só o mapa à mostra); "Sair" (topo
// esquerdo) sai do módulo; "Filtros" e "Painel" continuam disponíveis.
// O botão "Tela cheia" só liga/desliga a tela cheia real do navegador.
document.body.classList.add('presentation');
openCtrl(false);
openAside(false);

const _btnPresent=document.getElementById('btnPresent'), _btnPresentTxt=document.getElementById('btnPresentTxt');
function syncFullscreenBtn(){
  const on=!!document.fullscreenElement;
  _btnPresent.classList.toggle('on',on);
  _btnPresentTxt.textContent = on ? 'Sair da tela cheia' : 'Tela cheia';
}
function requestRealFullscreen(){
  const root=document.documentElement;
  if(!document.fullscreenElement && root.requestFullscreen) return root.requestFullscreen().catch(()=>{});
  return Promise.resolve();
}
_btnPresent.addEventListener('click',()=>{
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  else requestRealFullscreen();
});
document.addEventListener('fullscreenchange',syncFullscreenBtn);

// ---- Etapa A / Bloco 1 — alternância de tema (claro/escuro) ----
// A decisão INICIAL do tema roda num <script> inline no topo do <body> (antes de
// qualquer pintura, pra não "piscar"): escolha salva em localStorage 'gecope_theme'
// vence; na ausência dela, segue o prefers-color-scheme do SO; a classe 'theme-dark'
// na raiz e no <body> marca o escuro. Aqui tratamos a troca MANUAL pelo botão, o
// "sensor" do tema do SO, a sincronização do rótulo/ícone do botão e a REPINTURA
// ao vivo (repaintTheme): painel/CSS já reagem sozinhos via var(), mas o mapa
// (camadas Leaflet) e as cores injetadas inline por JS a partir de TOKENS precisam
// ser reaplicadas na troca.
const _btnTheme=document.getElementById('btnTheme');
function isDarkTheme(){ return document.documentElement.classList.contains('theme-dark'); }
// A etiqueta 'theme-dark' vai na raiz do documento E no <body>: a raiz para o CSS
// (:root:not(.theme-dark)) e para o JS que lê as cores via
// getComputedStyle(document.documentElement); o <body> para a convenção
// body.theme-dark compartilhada com o resto do GECOPE. Mantém as duas em sincronia.
function applyThemeClass(dark){
  document.documentElement.classList.toggle('theme-dark',dark);
  document.body.classList.toggle('theme-dark',dark);
}
function syncThemeBtn(){
  if(!_btnTheme) return;
  const txt = isDarkTheme() ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
  _btnTheme.title=txt; _btnTheme.setAttribute('aria-label',txt);
}
// repintura ao vivo (Bloco 6): a classe do tema já foi trocada na raiz, então
// getComputedStyle volta os valores do novo tema. Reescreve TOKENS no lugar,
// re-deriva o que ficou capturado à parte (BASE), re-estiliza a silhueta do
// estado (stateShape — o render() não a re-estiliza), redesenha o modal se
// estiver aberto (os gráficos internos carregam cor de TOKENS no innerHTML) e
// chama render() UMA vez, que reaplica styleFeature/groupStyle nas camadas,
// refaz os rótulos e regenera KPIs/gráficos/painel a partir de TOKENS.
function repaintTheme(){
  Object.assign(TOKENS, readTokens());
  BASE=TOKENS.mapBase;
  syncStatusColors();                 // cores de STATUS_STATES (dots de "Situação das obras")
  if(_lastStatus) setStatus(_lastStatus.txt,_lastStatus.ok,_lastStatus.lastSync,_lastStatus.replan); // dot de "Base de dados"
  if(!layer) return; // troca antes do init do mapa: o render() inicial já pinta no tema certo
  if(stateShape) stateShape.setStyle({fillColor:TOKENS.mapStateFill,color:`rgba(${TOKENS.ngRgb},.42)`});
  const _mbg=document.getElementById('modalBg');
  if(_mbg&&_mbg.classList.contains('show')&&_lastModalObra) openModal(_lastModalObra);
  render();
}
function setTheme(dark){
  applyThemeClass(dark);
  try{ localStorage.setItem('gecope_theme', dark?'dark':'light'); }
  catch(e){ /* privacidade/quota — a troca ainda vale nesta sessão */ }
  syncThemeBtn();
  repaintTheme();
}
if(_btnTheme){
  _btnTheme.addEventListener('click',()=>setTheme(!isDarkTheme()));
  syncThemeBtn();
}
// "sensor" da configuração do SO: só age enquanto NÃO houver escolha manual salva.
// Depois de uma escolha explícita, mudar o tema do SO não mexe mais no módulo.
if(window.matchMedia){
  const _mqLight=window.matchMedia('(prefers-color-scheme: light)');
  const _onOsThemeChange=e=>{
    let pref=null; try{ pref=localStorage.getItem('gecope_theme'); }catch(_){}
    if(pref) return;
    const dark=!e.matches;
    if(dark===isDarkTheme()) return; // evento do SO sem mudança efetiva — nada a repintar
    applyThemeClass(dark);
    syncThemeBtn();
    repaintTheme();
  };
  if(_mqLight.addEventListener) _mqLight.addEventListener('change',_onOsThemeChange);
  else if(_mqLight.addListener) _mqLight.addListener(_onOsThemeChange); // navegadores antigos
}

// A tela cheia é acionada SOMENTE pelo botão "Tela cheia" (ver _btnPresent, acima).
// O gatilho automático no 1º clique/tecla em qualquer lugar da página foi removido
// a pedido — clicar fora do mapa não entra mais em tela cheia.

// prefetch leve da página de destino ao passar o mouse no botão "Voltar"
function prefetchPagina(url){
  if(document.querySelector(`link[rel="prefetch"][href="${url}"]`)) return;
  const link=document.createElement('link'); link.rel='prefetch'; link.href=url; document.head.appendChild(link);
}
window.prefetchPagina=prefetchPagina;

// alterna entre a carteira ativa (padrão — obras que ainda podem ser geridas) e o
// histórico completo (todas, incluindo as ~90% já concluídas/encerradas)
const _btnScope=document.getElementById('btnScope'), _btnScopeTxt=document.getElementById('btnScopeTxt');
function syncScopeBtn(loading){
  if(!_btnScopeTxt) return;
  _btnScopeTxt.textContent = loading ? 'Carregando…' : (st.dataScope==='ativa' ? 'Carteira ativa' : 'Histórico completo');
  if(_btnScope) _btnScope.classList.toggle('on', st.dataScope==='historico');
}
function setDataScope(scope){
  if(scope===st.dataScope) return;
  st.dataScope=scope; goState();
  syncScopeBtn(true);
  if(_btnScope) _btnScope.disabled=true;
  loadData().finally(()=>{ syncScopeBtn(false); if(_btnScope) _btnScope.disabled=false; });
}
if(_btnScope) _btnScope.addEventListener('click',()=>setDataScope(st.dataScope==='ativa'?'historico':'ativa'));
syncScopeBtn(false);

// Escape hatch para o cache de 1h (ver CACHE_TTL_MS acima): limpa só a entrada do
// escopo atual e recarrega — sem isto, quem precisasse ver uma edição feita minutos
// atrás em outra tela não teria como forçar isso antes do cache expirar sozinho.
const _btnRefresh=document.getElementById('btnRefresh'), _btnRefreshTxt=document.getElementById('btnRefreshTxt');
if(_btnRefresh) _btnRefresh.addEventListener('click',()=>{
  try{ sessionStorage.removeItem(cacheKey(st.dataScope)); }catch(e){ /* privacidade/quota — segue sem cache mesmo */ }
  _btnRefresh.disabled=true;
  if(_btnRefreshTxt) _btnRefreshTxt.textContent='Atualizando…';
  loadData().finally(()=>{
    _btnRefresh.disabled=false;
    if(_btnRefreshTxt) _btnRefreshTxt.textContent='Atualizar dados';
  });
});

// (o segmento "Dividir por" — Distrito Op. / Região — foi removido; o módulo opera
//  exclusivamente por Distrito Operacional.)
// ---- seletor de modo (E1) ----
// Revelado só depois que o papel é conhecido.
const _segControle=document.getElementById('segControle'), _lblControle=document.getElementById('lblControle');
// ---- controles e legenda do modo Replanilhamentos (E2) ----
// Declarados antes de `layer`: todo render() — que chama as duas funções abaixo — só
// acontece depois que ele existe (mesma garantia de _asideEl).
const _ctrlReplan=document.getElementById('ctrlReplan'), _ctrlObras=document.getElementById('ctrlObras');
const _rpLeg=document.getElementById('rpLegenda');
// Alterna os blocos de controle pelo modo. Chamada em todo render(), e não em setModo,
// para que reverterParaObras() e qualquer outro caminho de volta a cubram sozinhos.
// Busca e filtros de Obras saem de cena no modo novo (operam sobre contratos); os
// filtros próprios dos processos chegam na E6.
function syncControlesModo(){
  if(!_ctrlReplan||!_ctrlObras) return;
  const rp=modoReplan(), trocou=_ctrlReplan.hidden===rp;
  _ctrlReplan.hidden=!rp; _ctrlObras.hidden=rp;
  if(trocou && _ctrl.classList.contains('show')) fitCtrlHeight();
}
// Legenda da escala. Os extremos são os da escala EM USO (0 até o máximo do nível), para
// que o tom mais escuro do mapa tenha um número ao lado. No nível 3 a cidade aberta é
// pintada cheia, sem escala — a legenda sai.
function renderLegendaReplan(){
  if(!_rpLeg) return;
  const mostra=modoReplan() && st.level<=2;
  _rpLeg.hidden=!mostra; if(!mostra) return;
  const m=st.rp.metrica;
  const max=st.level===1?_rpMaxGrp:_rpMaxMun;
  // max vale 1 quando nenhuma área tem valor positivo (ver rpPreparaMapa). Contagem toda
  // zerada ainda é uma escala (topo 0); tempo sem nenhuma média não é — aí a barra sairia
  // com um extremo vazio, e o que a legenda precisa dizer é por que está tudo cinza.
  const semEscala = m==='tempo' && !_rpTemEscala;
  const temValor = (st.level===1?[..._rpGrp.values()]:[..._rpMun.values()]).some(r=>r.v!=null && r.v>0);
  const topo = m==='tempo' ? `${Math.round(max)} dias` : NUM.format(temValor?max:0);
  const escala = semEscala
    ? `<div class="rp-leg-s">Nenhuma ${st.level===1?'área':'cidade'} com ${AMOSTRA_MIN} despachos ou mais neste período.</div>`
    : `<div class="rp-leg-bar" aria-hidden="true"></div><div class="rp-leg-esc"><span>0</span><span>${escHtml(topo)}</span></div>`;
  _rpLeg.innerHTML=`<div class="rp-leg-t">${escHtml(RP_METRICA[m].label)}</div>`
    +`<div class="rp-leg-s">${escHtml(rpRecorteTxt(st.level===1))}</div>`
    +escala
    // o cinza só precisa de nome enquanto divide o mapa com a escala; quando TUDO está
    // cinza, a frase acima já explicou.
    +(m==='tempo'&&!semEscala?`<div class="rp-leg-item"><span class="rp-leg-sw" aria-hidden="true"></span>Menos de ${AMOSTRA_MIN} despachos — sem dado</div>`:'');
}
// Janelinha de explicação dos KPIs do modo Replanilhamentos (botão "i"). Um único
// elemento no <body>, posicionado por coordenada: dentro do cartão (overflow:hidden) ela
// seria cortada, e o painel é refeito por innerHTML a cada render — a delegação no
// document sobrevive a isso. Abre no hover e no foco, para funcionar também no teclado
// e no toque.
function mostraRpTip(btn){
  if(!_rpTip){
    _rpTip=document.createElement('div');
    _rpTip.className='kpi-tip'; _rpTip.id='kpiTip'; _rpTip.setAttribute('role','tooltip');
    document.body.appendChild(_rpTip);
  }
  if(_rpTipAlvo && _rpTipAlvo!==btn) _rpTipAlvo.removeAttribute('aria-describedby');
  _rpTipAlvo=btn; btn.setAttribute('aria-describedby','kpiTip');
  // Parágrafos separados por \n\n (ver tipProc/tipTempo/tipDesp/tipFiscais): cada um
  // numa <p>, para não cair tudo numa única linha justificada.
  _rpTip.innerHTML=(btn.dataset.tip||'').split('\n\n').filter(Boolean).map(p=>`<p>${escHtml(p)}</p>`).join('');
  _rpTip.hidden=false;
  const r=btn.getBoundingClientRect(), w=_rpTip.offsetWidth, h=_rpTip.offsetHeight, m=10;
  const x=Math.min(Math.max(m, r.left+r.width/2-w/2), innerWidth-w-m);
  let y=r.bottom+8; if(y+h>innerHeight-m) y=Math.max(m, r.top-h-8);
  _rpTip.style.left=`${x}px`; _rpTip.style.top=`${y}px`;
}
function escondeRpTip(){
  if(_rpTipAlvo) _rpTipAlvo.removeAttribute('aria-describedby');
  _rpTipAlvo=null; if(_rpTip) _rpTip.hidden=true;
}
const kpiInfo=e=>e.target.closest&&e.target.closest('.kpi-info');
document.addEventListener('mouseover',e=>{ const b=kpiInfo(e); if(b) mostraRpTip(b); });
document.addEventListener('mouseout',e=>{ const b=kpiInfo(e); if(b && !b.contains(e.relatedTarget) && document.activeElement!==b) escondeRpTip(); });
document.addEventListener('focusin',e=>{ const b=kpiInfo(e); if(b) mostraRpTip(b); });
document.addEventListener('focusout',e=>{ if(e.target===_rpTipAlvo) escondeRpTip(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && _rpTipAlvo) escondeRpTip(); });
// o painel rola: a âncora sai do lugar e a janelinha ficaria solta sobre outra coisa
window.addEventListener('scroll',()=>{ if(_rpTipAlvo) escondeRpTip(); },true);
// E3 — identifica a bolinha do eixoDias() (distrito ou fiscal) ao clicar/tocar: o <title>
// nativo do SVG já diz quem é no hover do mouse, mas não existe hover em touch. Mesmo
// mecanismo de _rpTip acima (um elemento só no <body>, position:fixed, sobrevive ao
// innerHTML do modal ser refeito), só que disparado por clique — clicar na MESMA bolinha
// fecha, clicar noutra troca, clicar fora/Esc/rolar fecha.
function mostraEdTip(dot){
  if(!_edTip){
    _edTip=document.createElement('div');
    _edTip.className='kpi-tip ed-tip'; _edTip.id='edTip'; _edTip.setAttribute('role','tooltip');
    document.body.appendChild(_edTip);
  }
  _edTipAlvo=dot;
  _edTip.textContent=dot.dataset.label||'';
  _edTip.hidden=false;
  const r=dot.getBoundingClientRect(), w=_edTip.offsetWidth, h=_edTip.offsetHeight, m=10;
  const x=Math.min(Math.max(m, r.left+r.width/2-w/2), innerWidth-w-m);
  // Prioridade para cima da bolinha (não tampa a marca/eixo logo abaixo dela); só desce
  // se não couber em cima.
  let y=r.top-h-8; if(y<m) y=r.bottom+8;
  _edTip.style.left=`${x}px`; _edTip.style.top=`${y}px`;
}
function escondeEdTip(){ _edTipAlvo=null; if(_edTip) _edTip.hidden=true; }
document.addEventListener('click',e=>{
  const dot=e.target.closest&&e.target.closest('.ed-dot');
  if(dot){ if(_edTipAlvo===dot) escondeEdTip(); else mostraEdTip(dot); return; }
  if(_edTipAlvo) escondeEdTip();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && _edTipAlvo) escondeEdTip(); });
window.addEventListener('scroll',()=>{ if(_edTipAlvo) escondeEdTip(); },true);
// Seletores de métrica e período. Um handler para os dois: cada um só troca uma chave de
// st.rp e redesenha.
function ligaSegRp(id,chave){
  const seg=document.getElementById(id); if(!seg) return;
  seg.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b || b.disabled || st.rp[chave]===b.dataset.v) return;
    st.rp[chave]=b.dataset.v;
    seg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
    render();
  });
}
ligaSegRp('segRpMetrica','metrica'); ligaSegRp('segRpPeriodo','periodo');

/* ---- E6 — filtros do modo Replanilhamentos ----
   Mesma mecânica de multi-seleção do modo Obras (FILTER_DEFS/msel/chips: busca por
   digitação dentro do painel, botão com contagem, chip removível por valor), mas sobre
   PROCESSOS, não contratos, e com estado próprio (st.rp.filtro) — nunca st.f, que é de
   Obras e continua guardado intacto na troca de modo (nota fixa do painel, E2).
   Duplicar os handlers de host/change em vez de generalizar os de Obras é deliberado:
   aqueles tocam o caminho quente de contratos (obrasOf/passF/declutter, vigiado pela
   revisão) — não vale misturar os dois modelos de dado num código genérico só para
   economizar ~15 linhas. O que É genérico e comum aos dois hosts (abrir/fechar um
   .msel, busca por teclado dentro dele, fchipLabel) continua compartilhado, porque já
   opera em qualquer .msel do documento, não num host específico.

   As duas categorias são sempre fixas (Situação com 4 opções, Prazo com 3, nunca
   "descobertas" a partir dos dados carregados) — mesmo tratamento que Obras já dá a
   prazoExec/vigencia/paralisada: sempre as mesmas opções, nunca desabilitadas, sem a
   poda de fantasma que os atributos
   livres (Contratada, Ano…) precisam. */
const FILTER_DEFS_RP=[
  // Situação: as 4 posições de rpOrdemProc (naFila=0, naGecope=1, despachado=2,
  // foraDoCiclo=3), não 3 — "não fila, não despachado" ainda se divide em dois grupos
  // que o resto do arquivo trata como opostos: naGecope (em trâmite normal, fora das
  // mãos do fiscal — base do card GECOPE×Fiscalização) e foraDoCiclo (arquivado no meio
  // do trâmite / aprovado sem data, fora de toda métrica). Usa o campo `foraDoCiclo` já
  // calculado em mapProcesso, não reinventa a partição por ausência de naFila/despachado
  // (achado do rev-correcao e do rev-aderencia na mesma rodada: a versão anterior
  // fundia os dois grupos sob "Fora do ciclo", contradizendo o card GxF do mesmo painel).
  // Rótulos renomeados a pedido do usuário (2026-09-23), os valores internos (`v`) não
  // mudaram: "Na fila" -> "Fiscalização" (está com o fiscal agora), "Na GECOPE" ->
  // "GECOPE" (em trâmite: Diligência, Em Análise, Aguar. Aprovação…), "Despachado"
  // mantido, "Fora do ciclo" -> "Dado Incompleto" (o nome antigo não dizia que o processo
  // fica de fora de toda métrica por falta de data/situação consistente).
  {key:'situacao',label:'Situação',cats:[
    {v:'na_fila',label:'Fiscalização'},{v:'na_gecope',label:'GECOPE'},
    {v:'despachado',label:'Despachado'},{v:'fora_do_ciclo',label:'Dado Incompleto'}],
   get:p=>p.naFila?'na_fila':p.despachado?'despachado':p.foraDoCiclo?'fora_do_ciclo':'na_gecope'},
  // O filtro Prazo só é significativo para processos "Fiscalização" (na_fila): só eles
  // têm data_compromisso_fiscal ativa — em Despachado/GECOPE/Dado Incompleto o campo vem
  // nulo e cai tudo em "Sem prazo", esvaziando a amostra das métricas Tempo médio e
  // Despachos (bug relatado pelo usuário, 2026-09-23: o mapa "perdia os dados" ao marcar
  // Atrasado/No prazo). Por isso ele só aparece na UI quando Situação tem exatamente
  // "Fiscalização" marcada — ver prazoDisponivel()/syncPrazoRp() mais abaixo.
  {key:'prazo',label:'Prazo',cats:[
    {v:'atrasado',label:'Atrasado'},{v:'no_prazo',label:'No prazo'},{v:'sem_prazo',label:'Sem prazo'}],
   get:p=>p.metaEstourada===true?'atrasado':p.metaEstourada===false?'no_prazo':'sem_prazo'},
];
function passFRp(p){
  const f=st.rp.filtro;
  if(f.q && !normSearch(`${p.fiscalNome||''} ${p.fiscalMat||''}`).includes(normSearch(f.q))) return false;
  for(let i=0;i<FILTER_DEFS_RP.length;i++){
    const d=FILTER_DEFS_RP[i], set=f[d.key];
    if(set.size && !set.has(d.get(p))) return false;
  }
  return true;
}
function hasFiltroRp(){ const f=st.rp.filtro; return !!f.q || FILTER_DEFS_RP.some(d=>f[d.key].size>0); }
// Ponto único de filtragem: toda leitura de processo do modo Replanilhamentos passa por
// aqui (procsDoDistrito, procsDeMuns, e as duas leituras diretas de
// DB.municipios[id].processos no nível de cidade) — o mesmo processo nunca aparece
// filtrado num lugar e não noutro. As janelas de detalhe da E5 (abreModalDistrito/
// abreModalFiscal) NÃO passam por aqui de propósito: usam procsDoDistritoRaw/PROCESSOS
// direto, porque abrir o painel de um distrito/pessoa já escolhido mostra o panorama
// completo dele, não a fatia que o filtro deixou visível no painel — mesmo princípio já
// aplicado à régua/seleção/hover nessas duas janelas (E5, achado do rev-produto).
function filtraRp(procs){ return hasFiltroRp() ? procs.filter(passFRp) : procs; }
// Mesma ideia de resultsSuffix() (Obras, mais acima): quando há filtro ativo, a linha de
// escopo declara quanto do recorte passou — nunca deixa o número parecer o total quando
// é uma fatia. `n` é o tamanho já filtrado (o chamador já tem `procs.length` à mão, não
// vale recalcular); só o denominador (`procsDoRecorteRaw()`) é computado aqui. Achado do
// rev-produto na revisão da E6, 2026-09-18: sem isso, nenhuma superfície do modo
// Replanilhamentos avisava que estava mostrando um subconjunto.
function resultsSuffixRp(n){
  if(!hasFiltroRp()) return '';
  const tot=procsDoRecorteRaw().length;
  return ` · <b>${NUM.format(n)}</b> de ${NUM.format(tot)} processo${tot===1?'':'s'} com o filtro`;
}
// "fiscal 'x' · situação: Na fila, Despachado · prazo: Atrasado" — o mesmo texto que os
// chips já mostram, numa frase só, pra explicar por que as janelas de detalhe (abaixo)
// não bateram com o que o painel filtrado mostrava.
function resumoFiltroRpTxt(){
  const partes=[];
  if(st.rp.filtro.q) partes.push(`fiscal “${st.rp.filtro.q}”`);
  FILTER_DEFS_RP.forEach(d=>{
    const set=st.rp.filtro[d.key]; if(!set.size) return;
    partes.push(`${d.label.toLowerCase()}: ${[...set].map(v=>fchipLabel(d,v)).join(', ')}`);
  });
  return partes.join(' · ');
}
// Aviso dentro das janelas de detalhe da E5 (abreModalDistrito/abreModalFiscal): elas
// ignoram o filtro da E6 de propósito (comentário de filtraRp, acima), mas sem dizer isso
// na tela, ver um fiscal "Atrasado" no ranking filtrado e abrir a janela dele com
// processos no prazo lia como dado inconsistente, não como escolha deliberada (mesmo
// achado do rev-produto). `.adv-scope-note` já existe pra avisos de escopo dentro do
// modal (obra × contrato) — mesma linguagem visual, outro escopo.
function avisoFiltroRpHtml(){
  if(!hasFiltroRp()) return '';
  return `<div class="adv-scope-note">Esta janela mostra o panorama completo, sem aplicar o filtro ativo no painel (${escHtml(resumoFiltroRpTxt())}).</div>`;
}
function updateMselBtnRp(key){
  const m=document.querySelector(`#filtersHostRp .msel[data-key="${key}"]`); if(!m) return;
  const btn=m.querySelector('.msel-btn'); const label=btn.dataset.label; const n=st.rp.filtro[key].size;
  btn.innerHTML = n ? `${label} <span class="cnt">(${n})</span>` : `${label}: todos`;
}
function fillFiltersRp(){
  const host=document.getElementById('filtersHostRp'); if(!host) return;
  host.innerHTML=FILTER_DEFS_RP.map(d=>{
    const opts=d.cats.map(c=>`<label class="msel-opt"><input type="checkbox" value="${escHtml(c.v)}">${escHtml(c.label)}</label>`).join('');
    return `<div class="msel" data-key="${d.key}">
      <button type="button" class="msel-btn" data-label="${escHtml(d.label)}"></button>
      <div class="msel-panel">
        <div class="msel-query"></div>
        ${opts}
        <div class="msel-noresult">Nenhuma opção encontrada</div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('#filtersHostRp .msel').forEach(m=>{
    const key=m.dataset.key;
    m.querySelectorAll('.msel-opt input').forEach(cb=>{ cb.checked=st.rp.filtro[key].has(cb.value); });
    updateMselBtnRp(key);
  });
  syncPrazoRp();
}
// E2 — Prazo só é um filtro significativo com Situação em "Fiscalização" (ver o comentário
// em FILTER_DEFS_RP): fora disso, esconde o botão e limpa a seleção, para nunca deixar um
// filtro escondido continuar valendo sem o usuário perceber quando ele reaparecer.
function prazoDisponivel(){ return st.rp.filtro.situacao.size===1 && st.rp.filtro.situacao.has('na_fila'); }
function syncPrazoRp(){
  const m=document.querySelector('#filtersHostRp .msel[data-key="prazo"]'); if(!m) return;
  const disp=prazoDisponivel();
  m.hidden=!disp;
  if(!disp){
    // Fecha o painel (se estava aberto) e limpa a seleção — nunca deixa um filtro
    // escondido continuar valendo sem o usuário perceber quando ele reaparecer.
    m.classList.remove('on'); mselResetQuery(m);
    if(st.rp.filtro.prazo.size){
      st.rp.filtro.prazo.clear();
      m.querySelectorAll('.msel-opt input').forEach(cb=>cb.checked=false);
      updateMselBtnRp('prazo');
    }
  }
}
const _fHostRp=document.getElementById('filtersHostRp');
if(_fHostRp){
  _fHostRp.addEventListener('click',e=>{
    const btn=e.target.closest('.msel-btn'); if(!btn) return;
    const m=btn.closest('.msel'); const wasOn=m.classList.contains('on');
    document.querySelectorAll('.msel.on').forEach(x=>{x.classList.remove('on'); mselResetQuery(x);});
    if(!wasOn){ m.classList.add('on'); mselResetQuery(m); }
  });
  _fHostRp.addEventListener('change',e=>{
    const cb=e.target.closest('.msel-opt input'); if(!cb) return;
    const key=cb.closest('.msel').dataset.key;
    if(cb.checked) st.rp.filtro[key].add(cb.value); else st.rp.filtro[key].delete(cb.value);
    updateMselBtnRp(key); render();
  });
}
let _fSearchRpTimer=null;
const _fSearchRpEl=document.getElementById('fSearchRp');
if(_fSearchRpEl) _fSearchRpEl.addEventListener('input',e=>{
  st.rp.filtro.q=e.target.value.trim();
  clearTimeout(_fSearchRpTimer);
  _fSearchRpTimer=setTimeout(()=>render(),150);
});
// Sem botão de rodapé próprio (ver nota no HTML) — só o "Limpar tudo" dentro do bloco de
// chips, então clearAllFiltersRp só precisa existir para esse botão chamar.
function clearAllFiltersRp(){
  FILTER_DEFS_RP.forEach(d=>st.rp.filtro[d.key].clear());
  st.rp.filtro.q=''; const fs=document.getElementById('fSearchRp'); if(fs) fs.value='';
  document.querySelectorAll('#filtersHostRp .msel-opt input').forEach(cb=>cb.checked=false);
  document.querySelectorAll('#filtersHostRp .msel').forEach(m=>{updateMselBtnRp(m.dataset.key); m.classList.remove('on'); mselResetQuery(m);});
  render();
}
function renderFilterChipsRp(){
  const host=document.getElementById('filterChipsRp'); if(!host) return;
  const chips=[];
  if(st.rp.filtro.q) chips.push(`<span class="chip fchip" data-key="__q" role="button" tabindex="0" title="Remover a busca">Fiscal: “${escHtml(st.rp.filtro.q)}” <b class="x" aria-hidden="true">✕</b></span>`);
  FILTER_DEFS_RP.forEach(d=>{
    const set=st.rp.filtro[d.key]; if(!set.size) return;
    [...set].forEach(v=>{
      const lab=`${d.label}: ${fchipLabel(d,v)}`;
      chips.push(`<span class="chip fchip" data-key="${escHtml(d.key)}" data-val="${escHtml(v)}" role="button" tabindex="0" title="Remover ${escHtml(lab)}">${escHtml(lab)} <b class="x" aria-hidden="true">✕</b></span>`);
    });
  });
  host.innerHTML = chips.length
    ? chips.join('')+`<button type="button" class="fchip-clear" id="fchipClearRp">Limpar tudo</button>`
    : '';
  const c=document.getElementById('fchipClearRp'); if(c) c.onclick=clearAllFiltersRp;
}
function removeFilterChipRp(chip){
  const key=chip.dataset.key;
  if(key==='__q'){ st.rp.filtro.q=''; const fs=document.getElementById('fSearchRp'); if(fs) fs.value=''; }
  else {
    const val=chip.dataset.val; st.rp.filtro[key].delete(val); updateMselBtnRp(key);
    document.querySelectorAll(`#filtersHostRp .msel[data-key="${key}"] .msel-opt input`).forEach(cb=>{ if(cb.value===val) cb.checked=false; });
  }
  render();
}
const _filterChipsRpEl=document.getElementById('filterChipsRp');
if(_filterChipsRpEl){
  _filterChipsRpEl.addEventListener('click',e=>{ const chip=e.target.closest('.fchip'); if(chip) removeFilterChipRp(chip); });
  _filterChipsRpEl.addEventListener('keydown',e=>{
    if(e.key!=='Enter' && e.key!==' ') return;
    const chip=e.target.closest('.fchip'); if(!chip) return;
    e.preventDefault(); removeFilterChipRp(chip);
  });
}
fillFiltersRp();

function revelarControleModo(){
  const mostrar=podeVerReplanilhamentos()||papelIndefinido();
  if(_segControle) _segControle.hidden=!mostrar;
  if(_lblControle) _lblControle.hidden=!mostrar;
  if(_ctrl&&_ctrl.classList.contains('show')) fitCtrlHeight();
}
const _modoAviso=document.getElementById('modoAviso');
function avisoModo(msg){
  if(!_modoAviso) return;
  if(!msg){ _modoAviso.hidden=true; _modoAviso.textContent=''; return; }
  _modoAviso.textContent=msg; _modoAviso.hidden=false;   // textContent: nunca injeta HTML
  openCtrl(true);                                        // sem isso o aviso nasce dentro da gaveta fechada
}
// Volta o seletor e o status para Obras. Chamado em todo caminho de falha: sem ele o
// botão fica aceso num modo em que não se entrou, e o status continua afirmando erro
// sobre uma carteira de obras que está íntegra.
function reverterParaObras(){
  st.modo='obras';
  document.querySelectorAll('#segControle button').forEach(x=>x.classList.toggle('on',x.dataset.v==='obras'));
  // No caminho do catch o render() do modo novo pode ter escrito parte do painel antes
  // de falhar; sem redesenhar, o cabeçalho continuaria dizendo "Replanilhamentos".
  render();
  atualizarStatusModo();
}
let _trocandoModo=false;
async function setModo(modo){
  if(modo===st.modo || _trocandoModo) return;
  if(modo==='replanilhamentos' && !podeVerReplanilhamentos() && !papelIndefinido()){
    // Última linha de defesa (o botão nem deveria estar visível). Barra, mas não em
    // silêncio: um controle que não responde ao clique parece defeito.
    avisoModo('Este painel é restrito a administradores e gerentes.');
    return;
  }
  _trocandoModo=true;
  avisoModo(null);
  document.querySelectorAll('#segControle button').forEach(x=>x.classList.toggle('on',x.dataset.v===modo));
  // Carregar os replanilhamentos busca a view inteira (tempo no SUITE calculado na
  // leitura, sem coluna materializada) — na primeira troca da sessão isso leva mais de
  // um segundo. Sem aviso nenhum o botão já acendia e a tela ficava parada, parecendo
  // travada (usuário, 2026-09-17). Desabilita os dois botões (evita clique duplo por
  // cima do _trocandoModo) e troca o texto de status até a troca terminar, em qualquer
  // caminho — sucesso, falha ou volta pra Obras já reescrevem o status logo em seguida.
  if(modo==='replanilhamentos'){
    document.querySelectorAll('#segControle button').forEach(x=>x.disabled=true);
    setStatus('Carregando replanilhamentos…', true, null, true);
  }
  try{
    if(modo==='replanilhamentos'){
      const r=await loadProcessos();
      if(!r.ok){
        avisoModo('Sua sessão expirou. Entre no GECOPE novamente para ver os replanilhamentos.');
        reverterParaObras(); return;
      }
      // 0 linhas com sessão válida = a view negou por papel. O botão não deveria estar
      // visível nesse caso, mas o papel pode ter mudado no meio da sessão.
      if(!PROCESSOS.length){
        avisoModo('Este painel é restrito a administradores e gerentes. Seu usuário não tem acesso aos dados de replanilhamento.');
        reverterParaObras(); return;
      }
    }
    st.modo=modo;
    // Mantém nível, distrito e município: scopeIds() é puramente geográfico e os dois
    // conjuntos usam o mesmo índice de município, então trocar de lente sem perder o
    // lugar é o gesto que o painel quer ensinar — "mesmo recorte, outros dados".
    render();
    atualizarStatusModo();
  }catch(e){
    // O detalhe técnico (HTTP, nome de view, RLS) vai para o console, não para a tela
    // de um gestor — lá ele não sugere nenhuma ação possível.
    console.error('Falha ao trocar para o modo Replanilhamentos:',e);
    avisoModo('Não foi possível carregar os replanilhamentos agora. O painel continua na carteira de obras; tente de novo em instantes.');
    reverterParaObras();
  }finally{
    _trocandoModo=false;
    document.querySelectorAll('#segControle button').forEach(x=>x.disabled=false);
  }
}
// A linha "Base de dados · N contratos" do painel passa a falar do conjunto em foco.
function atualizarStatusModo(){
  if(!modoReplan()){
    if(_statusObras) setStatus(_statusObras.txt,_statusObras.ok,_statusObras.lastSync);
    return;
  }
  // Achado do usuário (etapa-8-revisao.md): "Base atualizada em" ficava sempre em "—" no
  // modo Replanilhamentos — `_procLastSync` (o maior `ultima_atualizacao` dos processos
  // carregados) é o equivalente do `lastSync` de contratos no modo Obras.
  setStatus('Replanilhamentos', true, _procLastSync, true);
}
if(_segControle) _segControle.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  setModo(b.dataset.v);
});

document.getElementById('segMetric').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  document.querySelectorAll('#segMetric button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  const metricAntiga=st.metric; st.metric=b.dataset.v;
  if(st.metric!==metricAntiga){
    // troca de métrica pode esconder/revelar filtros (ver FILTER_DEFS.ocultoEletrica/
    // soEletrica) — limpa o valor de quem está saindo de cena antes de reconstruir o
    // painel, senão um filtro escondido continuaria recortando resultado sem nenhum
    // chip/selo visível explicando por quê.
    FILTER_DEFS.forEach(d=>{
      if(st.metric==='eletrica'?d.ocultoEletrica:d.soEletrica) st.f[d.key].clear();
    });
    fillFilters();
  }
  render();
});
document.getElementById('crumb').addEventListener('click',e=>{
  const a=e.target.closest('a'); if(!a)return; const n=a.dataset.nav;
  if(n==='state')goState(); else if(n==='sub')goSub(); else if(n==='group')goGroup(gidOf(st.city));
  else if(n==='siblings') isSiblingPopoverOpen()?closeSiblingPopover():openSiblingPopover(a);
});
// mesmo padrão de teclado já usado em #body pra .rrow/.obra/etc. (Enter/Espaço aciona
// como clique) — só pro gatilho novo; os outros links da trilha (data-nav sem
// "siblings") já não tinham tabindex antes desta fase, fora do escopo consertar aqui.
document.getElementById('crumb').addEventListener('keydown',e=>activateOnKey(e,'a[data-nav="siblings"]'));
// ---- popover de navegação lateral entre irmãos (Fase 8) ----
// mesmo mecanismo nos níveis 2 e 3: o segmento atual da trilha (nome do distrito/
// região ou do município) abre a lista de irmãos pra pular direto — sem precisar
// voltar ao nível 1 primeiro e entrar de novo (antes: sempre 2 navegações + 2 voos
// de câmera; agora, 1). Reaproveita rankRows()/.rrow — mesmo HTML/clique/teclado dos
// rankings que já existem no painel — em vez de um componente novo.
const _crumbPop=document.getElementById('crumbPop');
// #mapWrap tem transform:scale(...) o tempo todo (intro do mapa — mesmo depois de
// terminar, ".in" deixa "scale(1)", não "none") — isso vira o containing block de
// qualquer descendente position:fixed, então um fixed aqui NÃO fica relativo à
// viewport como o nome sugere, fica relativo ao #mapWrap. Resolvido usando
// position:absolute (ver CSS) de propósito, com as coordenadas convertidas pra esse
// referencial — window.innerWidth/innerHeight continuam sendo a régua certa pra
// decidir "cabe na tela", só a atribuição final que precisa do offset do wrap.
const _mapWrapEl=document.getElementById('mapWrap');
function isSiblingPopoverOpen(){ return _crumbPop.classList.contains('show'); }
function closeSiblingPopover(){ _crumbPop.classList.remove('show'); }
function openSiblingPopover(anchorEl){
  let title,entries,kind;
  // "outros" — exclui o grupo/município atual da própria lista (groupEntries/
  // cityEntries devolvem a lista completa, usada como está no ranking do painel;
  // aqui precisa ficar só quem realmente é diferente de onde já se está)
  if(st.level===2){ title='Outros distritos'; entries=groupEntries().filter(e=>String(e.k)!==String(st.group)); kind='group'; }
  else if(st.level===3){ title='Outros municípios'; entries=cityEntries(idsOfGroup(gidOf(st.city)),true).filter(e=>String(e.k)!==String(st.city)); kind='city'; }
  else return;
  // .pop-body é a única parte que rola — o cabeçalho (também a alça de arrasto) e
  // a alça de resize ficam FORA dela de propósito, senão sumiriam de vista assim
  // que o usuário rolasse até o fim da lista de irmãos.
  // No modo Replanilhamentos a lista mostra a métrica do mapa, e precisa dizer de qual
  // recorte ela saiu: sem isto, "93,1 dias" ao lado de um nome não diz nem o período nem
  // a régua que produziu o número.
  const sub=modoReplan()?`<div class="pop-sub">${escHtml(RP_METRICA[st.rp.metrica].label)} · ${escHtml(rpRecorteTxt(kind==='group'))}</div>`:'';
  _crumbPop.innerHTML=`<div class="sec-h" title="Arraste para mover"><span>${title}</span><span>${entries.length}</span></div>`
    +sub
    +`<div class="pop-body">`+(entries.length?rankRows(entries,kind):'<div class="msel-empty">Nenhum resultado neste recorte</div>')+`</div>`
    +`<div class="resize-grip" title="Arraste para redimensionar"></div>`;
  // o gatilho não é o pai direto do popover no DOM (fica fora de #crumb, que
  // reconstrói o innerHTML a cada render() — um filho ali seria apagado a cada
  // navegação), e a trilha muda de largura/posição conforme o nome do grupo/
  // município, então o cálculo de onde abrir tem que ser dinâmico.
  // "show" entra ANTES de medir a largura: o popover é redimensionável (pedido do
  // usuário) e o tamanho escolhido numa abertura anterior persiste — com
  // display:none, offsetWidth sempre devolveria 0, e o clamp usaria um número
  // errado (a versão antiga usava a largura padrão fixa, ficava errada assim que
  // alguém arrastava o canto pra deixar mais largo).
  _crumbPop.classList.add('show');
  const wrapRect=_mapWrapEl.getBoundingClientRect();
  const r=anchorEl.getBoundingClientRect();
  const popW=_crumbPop.offsetWidth;
  const leftVp=Math.max(8,Math.min(window.innerWidth-popW-8,r.left+r.width/2-popW/2));
  _crumbPop.style.left=(leftVp-wrapRect.left)+'px';
  _crumbPop.style.top=(r.bottom+8-wrapRect.top)+'px';
  // clamp vertical contra a viewport de verdade (não o #mapWrap, que em telas
  // estreitas — layout empilhado, mapa só com 56vh — é bem mais baixo que a tela
  // toda) — popover ficou mais alto (pedido do usuário), sem isso ele passava a
  // renderizar parcialmente fora da área visível.
  const popRect=_crumbPop.getBoundingClientRect();
  if(popRect.bottom>window.innerHeight-8){
    const topVp=Math.max(8,window.innerHeight-8-popRect.height);
    _crumbPop.style.top=(topVp-wrapRect.top)+'px';
  }
}
_crumbPop.addEventListener('click',e=>{
  if(_crumbPop.dataset.dragged==='1'){ delete _crumbPop.dataset.dragged; return; } // clique no fim de um arrasto não deve navegar
  const rr=e.target.closest('.rrow'); if(!rr) return;
  closeSiblingPopover();
  goRrow(rr);
});
_crumbPop.addEventListener('keydown',e=>activateOnKey(e,'.rrow'));
// arrasto (mover, pela alça do título) e redimensionar (pela alça .resize-grip no
// canto) — pedido do usuário. Tentamos primeiro a propriedade CSS resize: nativa,
// mas ela se mostrou pouco confiável bem no canto arredondado do popover (o alvo de
// arrasto do navegador fica menor que a área visível ali, e um clique um pouco fora
// do ponto exato virava "clique fora fecha" em vez de redimensionar) — daí a alça
// própria, com uma área de agarrar previsível.
let _popDrag=null, _popResize=null;
// limites em sincronia com min-width/min-height/max-width/max-height de .crumb-pop
// no CSS — CSS não tem como impor esses limites num resize feito via JS puro
// (só existe pra "resize:both" nativo), então o clamp é feito aqui também.
const POP_MIN_W=260,POP_MIN_H=160,POP_MAX_W=560,POP_MAX_H=560;
_crumbPop.addEventListener('mousedown',e=>{
  if(e.target.closest('.resize-grip')){
    _popResize={startW:_crumbPop.offsetWidth,startH:_crumbPop.offsetHeight,startX:e.clientX,startY:e.clientY};
    e.preventDefault();
    return;
  }
  const handle=e.target.closest('.sec-h'); if(!handle) return;
  const wrapRect=_mapWrapEl.getBoundingClientRect();
  const popRect=_crumbPop.getBoundingClientRect();
  _popDrag={dx:e.clientX-popRect.left,dy:e.clientY-popRect.top,wrapRect,moved:false};
  e.preventDefault(); // evita selecionar texto durante o arrasto
});
document.addEventListener('mousemove',e=>{
  if(_popResize){
    const {startW,startH,startX,startY}=_popResize;
    _crumbPop.style.width=Math.max(POP_MIN_W,Math.min(POP_MAX_W,startW+(e.clientX-startX)))+'px';
    _crumbPop.style.height=Math.max(POP_MIN_H,Math.min(POP_MAX_H,startH+(e.clientY-startY)))+'px';
    return;
  }
  if(!_popDrag) return;
  _popDrag.moved=true;
  const {dx,dy,wrapRect}=_popDrag;
  const maxLeft=Math.max(4,wrapRect.width-_crumbPop.offsetWidth-4);
  const maxTop=Math.max(4,wrapRect.height-_crumbPop.offsetHeight-4);
  _crumbPop.style.left=Math.max(4,Math.min(maxLeft,e.clientX-wrapRect.left-dx))+'px';
  _crumbPop.style.top=Math.max(4,Math.min(maxTop,e.clientY-wrapRect.top-dy))+'px';
});
document.addEventListener('mouseup',()=>{
  if(_popResize){ _popResize=null; _crumbPop.dataset.dragged='1'; return; } // mesma supressão do click final usada no arrasto
  if(_popDrag && _popDrag.moved) _crumbPop.dataset.dragged='1'; // suprime o click subsequente no mouseup do arrasto
  _popDrag=null;
});
// clique fora fecha (mesmo padrão do .msel de filtros); clique EM CIMA do próprio
// gatilho não conta como "fora" — senão o toggle do handler de #crumb abriria e este
// listener fecharia de volta no mesmo clique, e o popover nunca apareceria.
document.addEventListener('click',e=>{
  // clique final de um arrasto/resize (mouseup) não conta como "fora", mesmo que o
  // cursor tenha acabado fora do popover — acontece sempre que o usuário arrasta o
  // canto além do tamanho máximo (560px): a caixa para de crescer no limite, mas o
  // cursor continua indo, então solta o botão já fora da área. Sem essa checagem
  // aqui (achado reportado pelo usuário), "ampliar e soltar" fechava o popover.
  if(_crumbPop.dataset.dragged==='1'){ delete _crumbPop.dataset.dragged; return; }
  if(isSiblingPopoverOpen() && !e.target.closest('.crumb-pop') && !e.target.closest('a[data-nav="siblings"]')) closeSiblingPopover();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && isSiblingPopoverOpen()) closeSiblingPopover(); });

document.getElementById('body').addEventListener('click',e=>{
  // E5 — chip de abrir a janela do distrito: checado ANTES de .rrow porque o chip vive
  // aninhado dentro dela (mesmo padrão de .chip.mun.locate dentro de .obra); sem checar
  // primeiro, o mesmo clique também dispararia goRrow() por baixo.
  const abre=e.target.closest('.chip.abre');
  if(abre){ abrirJanela(abre); return; }
  // chip de item selecionado (Ctrl+clique): clicar nele tira da seleção combinada
  const sc=e.target.closest('.chip-sel');
  if(sc){ toggleSelection(st.sel?st.sel.kind:'group',sc.dataset.selid); return; }
  // linha da lista de fiscais: a linha INTEIRA abre o painel do fiscal (usuário,
  // 2026-09-17). Antes ela só se destacava — um clique que não levava a lugar nenhum — e
  // a janela ficava atrás de um chip de 11px dentro dela.
  const qp=e.target.closest('.qdf');
  if(qp){ abreModalFiscal(qp.dataset.mat); return; }
  const rr=e.target.closest('.rrow');
  if(rr){ goRrow(rr); return; }
  // chip de município do card do contrato: leva direto até ele no mapa,
  // em vez de precisar descer Estado → Distrito → Cidade manualmente
  const loc=e.target.closest('.chip.mun.locate');
  if(loc){ goCity(loc.dataset.cod); return; }
  const ob=e.target.closest('.obra'); if(ob){ const o=CUROBRAS[+ob.dataset.oid]; if(o) openModal(o); }
});
// bloco "Atenção elétrica" (Fase 1) — vive no <aside>, fora do #body que os listeners
// acima cobrem (aquele é o painel que troca de conteúdo a cada navegação; este é fixo).
// Array próprio (CUR_ELETRICA_ATENCAO), não CUROBRAS: reaproveitar o array da lista
// principal seria arriscado — ele é reatribuído a cada render() com outra ordem/recorte.
if(_asideEl) _asideEl.addEventListener('click',e=>{
  const row=e.target.closest('.ele-alert-row'); if(!row) return;
  const o=CUR_ELETRICA_ATENCAO[+row.dataset.oid]; if(!o) return;
  openModal(o);
  const t=document.querySelector('.modal .mtab[data-tab="eletrica"]'); if(t) t.click();
});
if(_asideEl) _asideEl.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ') return;
  const row=e.target.closest('.ele-alert-row'); if(!row) return;
  e.preventDefault(); row.click();
});
// mesmas ações acima, via teclado (Enter/Espaço) — os cards (.rrow/.obra/
// .chip.mun.locate/.chip-sel/.chip.abre) são <div>/<span> com role="button" e tabindex,
// não elementos <button> nativos, então não recebem ativação por teclado de graça;
// painel público de órgão estadual precisa ser navegável sem mouse.
document.getElementById('body').addEventListener('keydown',e=>{
  // O chip de abrir janela é checado antes do resto pelo mesmo motivo do clique: ele fica
  // aninhado dentro de .rrow. .qdf entra na lista comum — a linha inteira só abre a janela.
  if(e.key==='Enter'||e.key===' '){
    const abre=e.target.closest&&e.target.closest('.chip.abre');
    if(abre){ e.preventDefault(); abrirJanela(abre); return; }
  }
  activateOnKey(e,'.qdf,.rrow,.obra,.chip.mun.locate,.chip-sel');
});
map.on('zoomend',()=>{ layer.setStyle(styleFeature); if(groupLayer&&map.hasLayer(groupLayer))groupLayer.setStyle(groupStyle); updateLabels(); });
map.on('moveend',()=>updateLabels());
// clicar em espaço vazio do mapa (fora de qualquer distrito/região/município)
// limpa a seleção combinada — caminho alternativo ao Esc que funciona igual
// dentro e fora de tela cheia, sem depender do navegador (ver histórico de
// tentativas com Esc: o navegador reserva Esc pra sair da tela cheia e não dá
// pra garantir que a seleção seja limpa sem sair junto). Clique EM cima de um
// polígono não conta — quem trata isso é o handler de clique do próprio
// polígono (onGroup/onClick), que decide entre navegar e Ctrl+selecionar.
map.on('click',e=>{
  if(!st.sel) return;
  const t=e.originalEvent&&e.originalEvent.target;
  if(t&&t.closest&&t.closest('.leaflet-interactive')) return;
  clearSelection();
});

// ---- init ----
// medido (Fase 7): construir as 184 features aqui custa ~6-15ms mesmo invisível
// nos níveis 0/1 (HID) — não compensa adiar/complicar a inicialização por isso.
layer=L.geoJSON(GEO,{style:styleFeature,onEachFeature:onEach}).addTo(map);
fullBounds=layer.getBounds();
// Etapa D: o polígono do estado deixou de ser um destino navegável — sem clique,
// sem hover, sem o tooltip "Clique para dividir". Os 11 polígonos de distrito
// (municípios dissolvidos) já cobrem todo o estado, então stateShape nem é mais
// exibido (ver render()); permanece criado só como objeto inerte para repaintTheme.
stateShape=L.geoJSON(ESTADO,{interactive:false,style:{fillColor:TOKENS.mapStateFill,color:`rgba(${TOKENS.ngRgb},.42)`,weight:1.5,fillOpacity:.96}});
buildCityState(); rebuildGroupLabels(); buildGroupLayer();
// mapa já entra no enquadramento final, sem animação de câmera (pedido do usuário,
// 24/09/2026) — fitFull(true) é instantâneo.
fitFull(true);
render();
// Porta de sessão (plano de permissões por papel, Fase 2): resolve o token e
// delega pra loadData() — que é quem de fato checa SESSION_TOKEN (mesmo guard
// vale tanto pra esta chamada inicial quanto pro clique em #btnScope).
(async()=>{
  SESSION_TOKEN=await obterTokenSessao();
  loadData();   // sem sessão, mostra o aviso de login (showLoginRequired); com falha real, showDataError
  // Papel resolvido em paralelo com a carga das obras: ele só decide se o seletor de
  // modo aparece, então não vale atrasar o painel esperando por ele.
  USER_PAPEL=await obterPapelUsuario();
  revelarControleModo();
})();

// mantém o mapa centralizado apesar de fontes, layout e barra de endereço (mobile)
function refit(instant){ if(st.level>=3) fitCity(instant); else if(st.level===2) fitGroup(instant); else fitFull(instant); }
// segurança de layout (fontes ainda carregando, resize, orientação, barra de endereço
// do celular somem/aparecem): sempre instantâneo — não é navegação do usuário, é só
// reajuste, então uma animação aqui só chamaria atenção à toa.
function ensureSize(){ map.invalidateSize(false); refit(true); }
requestAnimationFrame(ensureSize);
[80,200,400,700,1100,1700,2500].forEach(t=>setTimeout(ensureSize,t));
['load','resize','pageshow','orientationchange'].forEach(ev=>window.addEventListener(ev,()=>setTimeout(ensureSize,60)));
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) ensureSize(); });
if(document.fonts && document.fonts.ready) document.fonts.ready.then(ensureSize);
if(window.ResizeObserver){ let t; new ResizeObserver(()=>{ clearTimeout(t); t=setTimeout(ensureSize,50); }).observe(document.getElementById('map')); }

}catch(e){
  console.error('Erro fatal na inicialização do painel:',e);
  if(typeof showDataError==='function') showDataError('Ocorreu um erro ao carregar o painel: '+(e&&e.message||e));
  window.__bootError=(e&&e.stack)||String(e);
}
})();
