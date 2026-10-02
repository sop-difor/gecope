-- Migração: ciclo de vida do agendamento de vistoria elétrica (regras do usuário, 02/10/2026).
--
--   1. Ao enviar o relatório, o agendamento aberto da obra é FECHADO (realizada_em preenchido).
--      O front passou a fazer isso; esta migração fecha, uma vez, os que já ficaram para trás.
--   2. Uma obra pode ter vários agendamentos ao longo do tempo, mas NUNCA dois abertos ao mesmo
--      tempo. "Aberto" = excluido_em nulo E realizada_em nulo. O índice único parcial abaixo
--      faz o banco impor isso (até aqui só a tela evitava; ver o cabeçalho de
--      sql/create_eletrica_vistorias_agendadas.sql, que dizia o contrário de propósito).
--   3. Definições (para o app e para quem for ler os números):
--        Agendada   = agendamento aberto, data_planejada ainda não passou.
--        Pendente   = agendamento aberto, data_planejada já passou, sem confirmação nem relatório.
--        Vistoriada = relatório anexado (ou realização confirmada no checkbox da aba Elétrica).
--
-- ORDEM: rode ANTES de publicar o front novo? Não é obrigatório: o front lê "aberto" também como
-- "sem relatório gravado depois dele", então os números ficam certos mesmo sem a etapa 1. Já a
-- etapa 2 (índice) só pode ser criada se não houver dois abertos na mesma obra; se houver, o
-- script PARA com a lista das obras — resolva (cancele o agendamento a mais na aba Elétrica da
-- obra, ou rode o UPDATE de soft delete indicado) e rode de novo.
--
-- Uso: rode este arquivo inteiro no SQL Editor do Supabase (Dashboard > SQL Editor).
-- Pré-requisito: sql/add_realizada_eletrica_vistorias_agendadas.sql já aplicado.

begin;

-- ── 1. fecha os agendamentos abertos que já têm relatório posterior ──────────
-- realizada_em = quando o primeiro relatório posterior ao agendamento foi gravado.
update eletrica_vistorias_agendadas a
set realizada_em = (
  select min(v.criado_em)
  from eletrica_vistorias v
  where v.id_obra = a.id_obra
    and v.excluido_em is null
    and v.criado_em >= a.criado_em
)
where a.excluido_em is null
  and a.realizada_em is null
  and exists (
    select 1
    from eletrica_vistorias v
    where v.id_obra = a.id_obra
      and v.excluido_em is null
      and v.criado_em >= a.criado_em
  );

-- ── 2. recusa duplicados abertos e cria o índice único parcial ───────────────
do $$
declare
  obras_duplicadas text;
begin
  select string_agg(id_obra::text || ' (' || n || ' abertos)', ', ' order by id_obra)
    into obras_duplicadas
  from (
    select id_obra, count(*) as n
    from eletrica_vistorias_agendadas
    where excluido_em is null and realizada_em is null
    group by id_obra
    having count(*) > 1
  ) d;

  if obras_duplicadas is not null then
    raise exception
      'Obras com mais de um agendamento aberto: %. Cancele os agendamentos a mais (UPDATE ... SET excluido_em = now() nos ids sobrando) e rode de novo. Para listar: select id, id_obra, data_planejada, responsavel_nome, criado_em from eletrica_vistorias_agendadas where excluido_em is null and realizada_em is null and id_obra in (...) order by id_obra, criado_em;',
      obras_duplicadas;
  end if;
end $$;

create unique index if not exists uq_eletrica_agenda_obra_aberto
  on eletrica_vistorias_agendadas (id_obra)
  where excluido_em is null and realizada_em is null;

commit;

-- Verificação pós-migração (devem voltar 0 linhas):
-- select id_obra, count(*) from eletrica_vistorias_agendadas
--  where excluido_em is null and realizada_em is null group by id_obra having count(*) > 1;
-- Agendamentos ainda abertos mas com relatório posterior (devem voltar 0 linhas):
-- select a.id, a.id_obra from eletrica_vistorias_agendadas a
--  where a.excluido_em is null and a.realizada_em is null
--    and exists (select 1 from eletrica_vistorias v where v.id_obra = a.id_obra and v.excluido_em is null and v.criado_em >= a.criado_em);
