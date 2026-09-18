-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — distrito da OBRA × distrito do FISCAL
--
-- Pergunta que destrava a E2 do painel de desempenho dos fiscais: quando um
-- fiscal lotado num distrito analisa o replanilhamento de uma obra em outro, o
-- processo conta para qual distrito? Estas duas consultas medem o tamanho do
-- problema e mostram o que muda no mapa conforme a régua escolhida.
--
-- Usa as MESMAS réguas do mapa (assets/js/mapa-obras.js), para que o número bata
-- com o bloco "Conferência da carga" do painel:
--   * distrito da obra   = município (coalesce(obra, processo)) → distrito pelo
--                          de-para de assets/geo/ce-referencia.json, embutido abaixo.
--                          NÃO usa o texto livre distrito_operacional.
--   * distrito do fiscal = app_users.gedop, com 'FORTALEZA' → 'RM FORTALEZA'.
--   * nomes normalizados como normTxt(): sem acento, caixa alta, só letras.
--
-- Lê as tabelas-fonte, não a view: no SQL Editor não há JWT, então meu_papel()
-- é NULL e a view devolveria zero linhas. Filtros e joins reproduzem os da view
-- (excluido_por is null; lateral ... limit 1 com order by).
--
-- O SQL Editor mostra só o resultado da ÚLTIMA consulta: selecione a consulta 1
-- inteira e execute; depois a 2. Cada uma é autônoma.
--
-- Não altera nada no banco.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONSULTA 1 — RESUMO: quanto diverge no total, na fila e nos despachos dos
-- últimos 12 meses (a janela padrão do painel).
-- ---------------------------------------------------------------------------
with mun(nome, distrito) as (values
    ('ABAIARA','CRATO'),
    ('ACARAPE','ARACOIABA'),
    ('ACARAU','ITAPIPOCA'),
    ('ACOPIARA','IGUATU'),
    ('AIUABA','TAUA'),
    ('ALCANTARAS','SOBRAL'),
    ('ALTANEIRA','CRATO'),
    ('ALTO SANTO','LIMOEIRO DO NORTE'),
    ('AMONTADA','ITAPIPOCA'),
    ('ANTONINA DO NORTE','TAUA'),
    ('APUIARES','ITAPIPOCA'),
    ('AQUIRAZ','RM FORTALEZA'),
    ('ARACATI','LIMOEIRO DO NORTE'),
    ('ARACOIABA','ARACOIABA'),
    ('ARARENDA','CRATEUS'),
    ('ARARIPE','CRATO'),
    ('ARATUBA','ARACOIABA'),
    ('ARNEIROZ','TAUA'),
    ('ASSARE','CRATO'),
    ('AURORA','CRATO'),
    ('BAIXIO','IGUATU'),
    ('BANABUIU','QUIXERAMOBIM'),
    ('BARBALHA','CRATO'),
    ('BARREIRA','ARACOIABA'),
    ('BARRO','CRATO'),
    ('BARROQUINHA','SOBRAL'),
    ('BATURITE','ARACOIABA'),
    ('BEBERIBE','RM FORTALEZA'),
    ('BELA CRUZ','ITAPIPOCA'),
    ('BOA VIAGEM','QUIXERAMOBIM'),
    ('BREJO SANTO','CRATO'),
    ('CAMOCIM','SOBRAL'),
    ('CAMPOS SALES','TAUA'),
    ('CANINDE','SANTA QUITERIA'),
    ('CAPISTRANO','ARACOIABA'),
    ('CARIDADE','ARACOIABA'),
    ('CARIRE','SOBRAL'),
    ('CARIRIACU','CRATO'),
    ('CARIUS','IGUATU'),
    ('CARNAUBAL','SANTA QUITERIA'),
    ('CASCAVEL','RM FORTALEZA'),
    ('CATARINA','TAUA'),
    ('CATUNDA','SANTA QUITERIA'),
    ('CAUCAIA','RM FORTALEZA'),
    ('CEDRO','IGUATU'),
    ('CHAVAL','SOBRAL'),
    ('CHORO','ARACOIABA'),
    ('CHOROZINHO','ARACOIABA'),
    ('COREAU','SOBRAL'),
    ('CRATEUS','CRATEUS'),
    ('CRATO','CRATO'),
    ('CROATA','SANTA QUITERIA'),
    ('CRUZ','ITAPIPOCA'),
    ('DEPUTADO IRAPUAN PINHEIRO','QUIXERAMOBIM'),
    ('ERERE','LIMOEIRO DO NORTE'),
    ('EUSEBIO','RM FORTALEZA'),
    ('FARIAS BRITO','CRATO'),
    ('FORQUILHA','SOBRAL'),
    ('FORTALEZA','RM FORTALEZA'),
    ('FORTIM','LIMOEIRO DO NORTE'),
    ('FRECHEIRINHA','SOBRAL'),
    ('GENERAL SAMPAIO','ITAPIPOCA'),
    ('GRACA','SOBRAL'),
    ('GRANJA','SOBRAL'),
    ('GRANJEIRO','CRATO'),
    ('GROAIRAS','SOBRAL'),
    ('GUAIUBA','RM FORTALEZA'),
    ('GUARACIABA DO NORTE','SANTA QUITERIA'),
    ('GUARAMIRANGA','ARACOIABA'),
    ('HIDROLANDIA','SANTA QUITERIA'),
    ('HORIZONTE','ARACOIABA'),
    ('IBARETAMA','ARACOIABA'),
    ('IBIAPINA','SANTA QUITERIA'),
    ('IBICUITINGA','ARACOIABA'),
    ('ICAPUI','LIMOEIRO DO NORTE'),
    ('ICO','IGUATU'),
    ('IGUATU','IGUATU'),
    ('INDEPENDENCIA','CRATEUS'),
    ('IPAPORANGA','CRATEUS'),
    ('IPAUMIRIM','IGUATU'),
    ('IPU','SANTA QUITERIA'),
    ('IPUEIRAS','CRATEUS'),
    ('IRACEMA','LIMOEIRO DO NORTE'),
    ('IRAUCUBA','ITAPIPOCA'),
    ('ITAICABA','LIMOEIRO DO NORTE'),
    ('ITAITINGA','RM FORTALEZA'),
    ('ITAPAJE','ITAPIPOCA'),
    ('ITAPIPOCA','ITAPIPOCA'),
    ('ITAPIUNA','ARACOIABA'),
    ('ITAREMA','ITAPIPOCA'),
    ('ITATIRA','SANTA QUITERIA'),
    ('JAGUARETAMA','LIMOEIRO DO NORTE'),
    ('JAGUARIBARA','LIMOEIRO DO NORTE'),
    ('JAGUARIBE','LIMOEIRO DO NORTE'),
    ('JAGUARUANA','LIMOEIRO DO NORTE'),
    ('JARDIM','CRATO'),
    ('JATI','CRATO'),
    ('JIJOCA DE JERICOACOARA','SOBRAL'),
    ('JUAZEIRO DO NORTE','CRATO'),
    ('JUCAS','IGUATU'),
    ('LAVRAS DA MANGABEIRA','IGUATU'),
    ('LIMOEIRO DO NORTE','LIMOEIRO DO NORTE'),
    ('MADALENA','QUIXERAMOBIM'),
    ('MARACANAU','RM FORTALEZA'),
    ('MARANGUAPE','RM FORTALEZA'),
    ('MARCO','ITAPIPOCA'),
    ('MARTINOPOLE','SOBRAL'),
    ('MASSAPE','SOBRAL'),
    ('MAURITI','CRATO'),
    ('MERUOCA','SOBRAL'),
    ('MILAGRES','CRATO'),
    ('MILHA','QUIXERAMOBIM'),
    ('MIRAIMA','ITAPIPOCA'),
    ('MISSAO VELHA','CRATO'),
    ('MOMBACA','QUIXERAMOBIM'),
    ('MONSENHOR TABOSA','QUIXERAMOBIM'),
    ('MORADA NOVA','LIMOEIRO DO NORTE'),
    ('MORAUJO','SOBRAL'),
    ('MORRINHOS','ITAPIPOCA'),
    ('MUCAMBO','SOBRAL'),
    ('MULUNGU','ARACOIABA'),
    ('NOVA OLINDA','CRATO'),
    ('NOVA RUSSAS','CRATEUS'),
    ('NOVO ORIENTE','CRATEUS'),
    ('OCARA','ARACOIABA'),
    ('OROS','IGUATU'),
    ('PACAJUS','ARACOIABA'),
    ('PACATUBA','RM FORTALEZA'),
    ('PACOTI','ARACOIABA'),
    ('PACUJA','SOBRAL'),
    ('PALHANO','LIMOEIRO DO NORTE'),
    ('PALMACIA','ARACOIABA'),
    ('PARACURU','ITAPIPOCA'),
    ('PARAIPABA','ITAPIPOCA'),
    ('PARAMBU','TAUA'),
    ('PARAMOTI','SANTA QUITERIA'),
    ('PEDRA BRANCA','QUIXERAMOBIM'),
    ('PENAFORTE','CRATO'),
    ('PENTECOSTE','ITAPIPOCA'),
    ('PEREIRO','LIMOEIRO DO NORTE'),
    ('PINDORETAMA','RM FORTALEZA'),
    ('PIQUET CARNEIRO','QUIXERAMOBIM'),
    ('PIRES FERREIRA','SANTA QUITERIA'),
    ('PORANGA','CRATEUS'),
    ('PORTEIRAS','CRATO'),
    ('POTENGI','CRATO'),
    ('POTIRETAMA','LIMOEIRO DO NORTE'),
    ('QUITERIANOPOLIS','TAUA'),
    ('QUIXADA','ARACOIABA'),
    ('QUIXELO','IGUATU'),
    ('QUIXERAMOBIM','QUIXERAMOBIM'),
    ('QUIXERE','LIMOEIRO DO NORTE'),
    ('REDENCAO','ARACOIABA'),
    ('RERIUTABA','SANTA QUITERIA'),
    ('RUSSAS','LIMOEIRO DO NORTE'),
    ('SABOEIRO','IGUATU'),
    ('SALITRE','CRATO'),
    ('SANTA QUITERIA','SANTA QUITERIA'),
    ('SANTANA DO ACARAU','SOBRAL'),
    ('SANTANA DO CARIRI','CRATO'),
    ('SAO BENEDITO','SANTA QUITERIA'),
    ('SAO GONCALO DO AMARANTE','RM FORTALEZA'),
    ('SAO JOAO DO JAGUARIBE','LIMOEIRO DO NORTE'),
    ('SAO LUIS DO CURU','ITAPIPOCA'),
    ('SENADOR POMPEU','QUIXERAMOBIM'),
    ('SENADOR SA','SOBRAL'),
    ('SOBRAL','SOBRAL'),
    ('SOLONOPOLE','QUIXERAMOBIM'),
    ('TABULEIRO DO NORTE','LIMOEIRO DO NORTE'),
    ('TAMBORIL','CRATEUS'),
    ('TARRAFAS','CRATO'),
    ('TAUA','TAUA'),
    ('TEJUCUOCA','ITAPIPOCA'),
    ('TIANGUA','SOBRAL'),
    ('TRAIRI','ITAPIPOCA'),
    ('TURURU','ITAPIPOCA'),
    ('UBAJARA','SANTA QUITERIA'),
    ('UMARI','IGUATU'),
    ('UMIRIM','ITAPIPOCA'),
    ('URUBURETAMA','ITAPIPOCA'),
    ('URUOCA','SOBRAL'),
    ('VARJOTA','SANTA QUITERIA'),
    ('VARZEA ALEGRE','IGUATU'),
    ('VICOSA DO CEARA','SOBRAL'),
    ('ITAPAGE','ITAPIPOCA')
),
p as (
  select
    upper(trim(coalesce(pr.status, ''))) as status_norm,
    pr.tempo_suite,
    coalesce(pr.data_aprovacao_gecope, pr.ultima_atualizacao::date) as data_despacho,
    coalesce(ce.municipio, pr.municipio) as municipio,
    u.gedop
  from public.processos pr
  left join lateral (
    select au.gedop from public.app_users au
    where au.matricula = pr.fiscal_matricula
    order by au.id limit 1
  ) u on true
  left join lateral (
    select c.municipio from public.contratos_edificacao c
    where c.codigo_obra = pr.codigo_obra
    order by c.id_obra limit 1
  ) ce on true
  where pr.excluido_por is null
),
n as (
  -- normTxt(): tira acento nos dois tamanhos de letra ANTES do upper (para não
  -- depender do locale do banco), caixa alta, troca o que não é letra por espaço.
  select p.*,
    trim(regexp_replace(regexp_replace(upper(translate(coalesce(p.municipio, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g')) as mun_norm,
    trim(regexp_replace(regexp_replace(upper(translate(coalesce(p.gedop, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g')) as gedop_norm
  from p
),
c as (
  select
    n.status_norm in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL') as na_fila,
    n.status_norm in ('APROVADO', 'ARQUIVADO')
      and n.data_despacho >= current_date - interval '12 months'        as despachado_12m,
    n.tempo_suite,
    m.distrito                                                          as dist_obra,
    d.nome                                                              as dist_fiscal,
    n.gedop_norm
  from n
  left join mun m on m.nome = n.mun_norm
  left join (select distinct distrito as nome from mun) d
         on d.nome = case when n.gedop_norm = 'FORTALEZA' then 'RM FORTALEZA' else n.gedop_norm end
)
select
  count(*)                                                                   as processos,
  count(*) filter (where dist_obra is null)                                  as sem_distrito_obra,
  count(*) filter (where gedop_norm = '')                                    as fiscal_sem_gedop,
  count(*) filter (where gedop_norm <> '' and dist_fiscal is null)           as gedop_fora_dos_11,
  count(*) filter (where dist_obra is not null and dist_fiscal is not null)  as com_os_dois,
  count(*) filter (where dist_obra <> dist_fiscal)                           as divergem,
  count(*) filter (where na_fila)                                            as fila,
  count(*) filter (where na_fila and dist_obra <> dist_fiscal)               as fila_divergem,
  count(*) filter (where despachado_12m)                                     as despachos_12m,
  count(*) filter (where despachado_12m and dist_obra <> dist_fiscal)        as despachos_12m_divergem
from c;

-- ---------------------------------------------------------------------------
-- CONSULTA 2 — POR DISTRITO: o que muda no mapa conforme a régua. Despachos e
-- tempo médio (dias de tempo_suite) dos últimos 12 meses, e fila atual, contados
-- pelo distrito da obra e pelo distrito do fiscal, lado a lado.
-- ---------------------------------------------------------------------------
with mun(nome, distrito) as (values
    ('ABAIARA','CRATO'),
    ('ACARAPE','ARACOIABA'),
    ('ACARAU','ITAPIPOCA'),
    ('ACOPIARA','IGUATU'),
    ('AIUABA','TAUA'),
    ('ALCANTARAS','SOBRAL'),
    ('ALTANEIRA','CRATO'),
    ('ALTO SANTO','LIMOEIRO DO NORTE'),
    ('AMONTADA','ITAPIPOCA'),
    ('ANTONINA DO NORTE','TAUA'),
    ('APUIARES','ITAPIPOCA'),
    ('AQUIRAZ','RM FORTALEZA'),
    ('ARACATI','LIMOEIRO DO NORTE'),
    ('ARACOIABA','ARACOIABA'),
    ('ARARENDA','CRATEUS'),
    ('ARARIPE','CRATO'),
    ('ARATUBA','ARACOIABA'),
    ('ARNEIROZ','TAUA'),
    ('ASSARE','CRATO'),
    ('AURORA','CRATO'),
    ('BAIXIO','IGUATU'),
    ('BANABUIU','QUIXERAMOBIM'),
    ('BARBALHA','CRATO'),
    ('BARREIRA','ARACOIABA'),
    ('BARRO','CRATO'),
    ('BARROQUINHA','SOBRAL'),
    ('BATURITE','ARACOIABA'),
    ('BEBERIBE','RM FORTALEZA'),
    ('BELA CRUZ','ITAPIPOCA'),
    ('BOA VIAGEM','QUIXERAMOBIM'),
    ('BREJO SANTO','CRATO'),
    ('CAMOCIM','SOBRAL'),
    ('CAMPOS SALES','TAUA'),
    ('CANINDE','SANTA QUITERIA'),
    ('CAPISTRANO','ARACOIABA'),
    ('CARIDADE','ARACOIABA'),
    ('CARIRE','SOBRAL'),
    ('CARIRIACU','CRATO'),
    ('CARIUS','IGUATU'),
    ('CARNAUBAL','SANTA QUITERIA'),
    ('CASCAVEL','RM FORTALEZA'),
    ('CATARINA','TAUA'),
    ('CATUNDA','SANTA QUITERIA'),
    ('CAUCAIA','RM FORTALEZA'),
    ('CEDRO','IGUATU'),
    ('CHAVAL','SOBRAL'),
    ('CHORO','ARACOIABA'),
    ('CHOROZINHO','ARACOIABA'),
    ('COREAU','SOBRAL'),
    ('CRATEUS','CRATEUS'),
    ('CRATO','CRATO'),
    ('CROATA','SANTA QUITERIA'),
    ('CRUZ','ITAPIPOCA'),
    ('DEPUTADO IRAPUAN PINHEIRO','QUIXERAMOBIM'),
    ('ERERE','LIMOEIRO DO NORTE'),
    ('EUSEBIO','RM FORTALEZA'),
    ('FARIAS BRITO','CRATO'),
    ('FORQUILHA','SOBRAL'),
    ('FORTALEZA','RM FORTALEZA'),
    ('FORTIM','LIMOEIRO DO NORTE'),
    ('FRECHEIRINHA','SOBRAL'),
    ('GENERAL SAMPAIO','ITAPIPOCA'),
    ('GRACA','SOBRAL'),
    ('GRANJA','SOBRAL'),
    ('GRANJEIRO','CRATO'),
    ('GROAIRAS','SOBRAL'),
    ('GUAIUBA','RM FORTALEZA'),
    ('GUARACIABA DO NORTE','SANTA QUITERIA'),
    ('GUARAMIRANGA','ARACOIABA'),
    ('HIDROLANDIA','SANTA QUITERIA'),
    ('HORIZONTE','ARACOIABA'),
    ('IBARETAMA','ARACOIABA'),
    ('IBIAPINA','SANTA QUITERIA'),
    ('IBICUITINGA','ARACOIABA'),
    ('ICAPUI','LIMOEIRO DO NORTE'),
    ('ICO','IGUATU'),
    ('IGUATU','IGUATU'),
    ('INDEPENDENCIA','CRATEUS'),
    ('IPAPORANGA','CRATEUS'),
    ('IPAUMIRIM','IGUATU'),
    ('IPU','SANTA QUITERIA'),
    ('IPUEIRAS','CRATEUS'),
    ('IRACEMA','LIMOEIRO DO NORTE'),
    ('IRAUCUBA','ITAPIPOCA'),
    ('ITAICABA','LIMOEIRO DO NORTE'),
    ('ITAITINGA','RM FORTALEZA'),
    ('ITAPAJE','ITAPIPOCA'),
    ('ITAPIPOCA','ITAPIPOCA'),
    ('ITAPIUNA','ARACOIABA'),
    ('ITAREMA','ITAPIPOCA'),
    ('ITATIRA','SANTA QUITERIA'),
    ('JAGUARETAMA','LIMOEIRO DO NORTE'),
    ('JAGUARIBARA','LIMOEIRO DO NORTE'),
    ('JAGUARIBE','LIMOEIRO DO NORTE'),
    ('JAGUARUANA','LIMOEIRO DO NORTE'),
    ('JARDIM','CRATO'),
    ('JATI','CRATO'),
    ('JIJOCA DE JERICOACOARA','SOBRAL'),
    ('JUAZEIRO DO NORTE','CRATO'),
    ('JUCAS','IGUATU'),
    ('LAVRAS DA MANGABEIRA','IGUATU'),
    ('LIMOEIRO DO NORTE','LIMOEIRO DO NORTE'),
    ('MADALENA','QUIXERAMOBIM'),
    ('MARACANAU','RM FORTALEZA'),
    ('MARANGUAPE','RM FORTALEZA'),
    ('MARCO','ITAPIPOCA'),
    ('MARTINOPOLE','SOBRAL'),
    ('MASSAPE','SOBRAL'),
    ('MAURITI','CRATO'),
    ('MERUOCA','SOBRAL'),
    ('MILAGRES','CRATO'),
    ('MILHA','QUIXERAMOBIM'),
    ('MIRAIMA','ITAPIPOCA'),
    ('MISSAO VELHA','CRATO'),
    ('MOMBACA','QUIXERAMOBIM'),
    ('MONSENHOR TABOSA','QUIXERAMOBIM'),
    ('MORADA NOVA','LIMOEIRO DO NORTE'),
    ('MORAUJO','SOBRAL'),
    ('MORRINHOS','ITAPIPOCA'),
    ('MUCAMBO','SOBRAL'),
    ('MULUNGU','ARACOIABA'),
    ('NOVA OLINDA','CRATO'),
    ('NOVA RUSSAS','CRATEUS'),
    ('NOVO ORIENTE','CRATEUS'),
    ('OCARA','ARACOIABA'),
    ('OROS','IGUATU'),
    ('PACAJUS','ARACOIABA'),
    ('PACATUBA','RM FORTALEZA'),
    ('PACOTI','ARACOIABA'),
    ('PACUJA','SOBRAL'),
    ('PALHANO','LIMOEIRO DO NORTE'),
    ('PALMACIA','ARACOIABA'),
    ('PARACURU','ITAPIPOCA'),
    ('PARAIPABA','ITAPIPOCA'),
    ('PARAMBU','TAUA'),
    ('PARAMOTI','SANTA QUITERIA'),
    ('PEDRA BRANCA','QUIXERAMOBIM'),
    ('PENAFORTE','CRATO'),
    ('PENTECOSTE','ITAPIPOCA'),
    ('PEREIRO','LIMOEIRO DO NORTE'),
    ('PINDORETAMA','RM FORTALEZA'),
    ('PIQUET CARNEIRO','QUIXERAMOBIM'),
    ('PIRES FERREIRA','SANTA QUITERIA'),
    ('PORANGA','CRATEUS'),
    ('PORTEIRAS','CRATO'),
    ('POTENGI','CRATO'),
    ('POTIRETAMA','LIMOEIRO DO NORTE'),
    ('QUITERIANOPOLIS','TAUA'),
    ('QUIXADA','ARACOIABA'),
    ('QUIXELO','IGUATU'),
    ('QUIXERAMOBIM','QUIXERAMOBIM'),
    ('QUIXERE','LIMOEIRO DO NORTE'),
    ('REDENCAO','ARACOIABA'),
    ('RERIUTABA','SANTA QUITERIA'),
    ('RUSSAS','LIMOEIRO DO NORTE'),
    ('SABOEIRO','IGUATU'),
    ('SALITRE','CRATO'),
    ('SANTA QUITERIA','SANTA QUITERIA'),
    ('SANTANA DO ACARAU','SOBRAL'),
    ('SANTANA DO CARIRI','CRATO'),
    ('SAO BENEDITO','SANTA QUITERIA'),
    ('SAO GONCALO DO AMARANTE','RM FORTALEZA'),
    ('SAO JOAO DO JAGUARIBE','LIMOEIRO DO NORTE'),
    ('SAO LUIS DO CURU','ITAPIPOCA'),
    ('SENADOR POMPEU','QUIXERAMOBIM'),
    ('SENADOR SA','SOBRAL'),
    ('SOBRAL','SOBRAL'),
    ('SOLONOPOLE','QUIXERAMOBIM'),
    ('TABULEIRO DO NORTE','LIMOEIRO DO NORTE'),
    ('TAMBORIL','CRATEUS'),
    ('TARRAFAS','CRATO'),
    ('TAUA','TAUA'),
    ('TEJUCUOCA','ITAPIPOCA'),
    ('TIANGUA','SOBRAL'),
    ('TRAIRI','ITAPIPOCA'),
    ('TURURU','ITAPIPOCA'),
    ('UBAJARA','SANTA QUITERIA'),
    ('UMARI','IGUATU'),
    ('UMIRIM','ITAPIPOCA'),
    ('URUBURETAMA','ITAPIPOCA'),
    ('URUOCA','SOBRAL'),
    ('VARJOTA','SANTA QUITERIA'),
    ('VARZEA ALEGRE','IGUATU'),
    ('VICOSA DO CEARA','SOBRAL'),
    ('ITAPAGE','ITAPIPOCA')
),
p as (
  select
    upper(trim(coalesce(pr.status, ''))) as status_norm,
    pr.tempo_suite,
    coalesce(pr.data_aprovacao_gecope, pr.ultima_atualizacao::date) as data_despacho,
    coalesce(ce.municipio, pr.municipio) as municipio,
    u.gedop
  from public.processos pr
  left join lateral (
    select au.gedop from public.app_users au
    where au.matricula = pr.fiscal_matricula
    order by au.id limit 1
  ) u on true
  left join lateral (
    select c.municipio from public.contratos_edificacao c
    where c.codigo_obra = pr.codigo_obra
    order by c.id_obra limit 1
  ) ce on true
  where pr.excluido_por is null
),
n as (
  -- normTxt(): tira acento nos dois tamanhos de letra ANTES do upper (para não
  -- depender do locale do banco), caixa alta, troca o que não é letra por espaço.
  select p.*,
    trim(regexp_replace(regexp_replace(upper(translate(coalesce(p.municipio, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g')) as mun_norm,
    trim(regexp_replace(regexp_replace(upper(translate(coalesce(p.gedop, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g')) as gedop_norm
  from p
),
c as (
  select
    n.status_norm in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL') as na_fila,
    n.status_norm in ('APROVADO', 'ARQUIVADO')
      and n.data_despacho >= current_date - interval '12 months'        as despachado_12m,
    n.tempo_suite,
    m.distrito                                                          as dist_obra,
    d.nome                                                              as dist_fiscal,
    n.gedop_norm
  from n
  left join mun m on m.nome = n.mun_norm
  left join (select distinct distrito as nome from mun) d
         on d.nome = case when n.gedop_norm = 'FORTALEZA' then 'RM FORTALEZA' else n.gedop_norm end
),
por_obra as (
  select dist_obra as distrito,
         count(*) filter (where despachado_12m and tempo_suite is not null) as despachos,
         round(avg(tempo_suite) filter (where despachado_12m), 1)           as tempo_medio,
         count(*) filter (where na_fila)                                    as fila
  from c where dist_obra is not null group by 1
),
por_fiscal as (
  select dist_fiscal as distrito,
         count(*) filter (where despachado_12m and tempo_suite is not null) as despachos,
         round(avg(tempo_suite) filter (where despachado_12m), 1)           as tempo_medio,
         count(*) filter (where na_fila)                                    as fila
  from c where dist_fiscal is not null group by 1
)
select coalesce(o.distrito, f.distrito) as distrito,
       o.despachos   as desp_regua_obra,   f.despachos   as desp_regua_fiscal,
       o.tempo_medio as tempo_regua_obra,  f.tempo_medio as tempo_regua_fiscal,
       o.fila        as fila_regua_obra,   f.fila        as fila_regua_fiscal
from por_obra o
full join por_fiscal f on f.distrito = o.distrito
order by 1;
