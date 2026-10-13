-- ============================================================================
-- suite_tempo_manual — tempo na Fiscalização e data de despacho conferidos à mão
--
-- Para processo DESPACHADO cujo tempo o SUITE não entrega (a view de tempo devolve NULL e a
-- "Conferência da carga" do painel mostra em "Despachado sem tempo no SUITE"), o usuário
-- levantou as permanências direto no SUITE e registra aqui o total e a data do despacho.
-- vw_painel_desempenho_fiscais usa estes valores SÓ para preencher lacuna: se a view de tempo
-- calcular um valor, ele vale.
--
-- Chave: o NUP (processos.processo). O tempo é do PROCESSO, e vai para o fiscal que responde
-- por ele na view do painel (quem despachou) — a mesma regra do tempo calculado.
--
-- tempo_dias = soma das permanências, em dias (minutos / 1440). A conta fica escrita no insert
-- (dias*1440 + horas*60 + minutos), para conferir contra o que foi lido no SUITE. Menos de 1 dia
-- vale como "aberto já pronto" na view do painel (conta como despacho, fica fora da média), a
-- mesma regra do tempo calculado.
--
-- data_despacho = saída da última permanência (a data em que o processo foi à GECOPE).
--
-- Entra no cálculo do painel assim que sql/create_vw_painel_desempenho_fiscais.sql for
-- executado de novo (esse arquivo vem ANTES).
--
-- Execute no SQL Editor do Supabase, o arquivo inteiro: roda numa transação só. Pode executar
-- de novo. O insert do levantamento de 2026-10-13 SOBRESCREVE a própria linha (`do update`):
-- ele foi retificado pelo usuário no mesmo dia, e quem tiver rodado a primeira versão precisa
-- receber os valores novos. Correção posterior à mão: edite a linha e registre aqui também.
-- ============================================================================

begin;

create table if not exists public.suite_tempo_manual (
  processo      text primary key,                     -- NUP: processos.processo
  tempo_dias    numeric(10,4) not null check (tempo_dias >= 0),
  permanencias  text,                                 -- o que foi lido no SUITE, para auditoria
  observacao    text,
  registrado_em timestamptz not null default now()
);

-- coluna acrescentada na retificação de 2026-10-13 (quem já criou a tabela não a tem)
alter table public.suite_tempo_manual add column if not exists data_despacho date;

comment on table public.suite_tempo_manual is
  'Tempo na Fiscalização e data de despacho conferidos à mão no SUITE, para despachado sem tempo calculado. Preenche só a lacuna em vw_painel_desempenho_fiscais (tempo_manual = true).';

alter table public.suite_tempo_manual enable row level security;

-- Leitura só para quem usa o painel; escrita só pelo SQL Editor.
revoke insert, update, delete, truncate on public.suite_tempo_manual from anon, authenticated;
grant select on public.suite_tempo_manual to authenticated;

drop policy if exists suite_tempo_manual_select on public.suite_tempo_manual;
-- (select ...): mesmo padrão das demais tabelas de apoio do painel (cache do InitPlan).
create policy suite_tempo_manual_select on public.suite_tempo_manual
  for select to authenticated
  using ((select public.meu_papel()) in ('admin', 'gerente'));

-- Levantamento do usuário em 2026-10-13, retificado no mesmo dia: os 4 "Despachado sem tempo
-- no SUITE". Processo com mais de uma permanência soma todas; a data de despacho é a da última.
insert into public.suite_tempo_manual (processo, tempo_dias, data_despacho, permanencias, observacao) values
  ('43022.006727/2025-11',
   round(((8*1440 + 1*60 + 17) + (6*1440 + 22*60 + 3)) / 1440.0, 4),
   date '2025-12-01',
   '15/07/2025 08:34 — 08 d 01 h 17 min (despacho 23/07/2025); 24/11/2025 11:38 — 06 d 22 h 03 min (despacho 01/12/2025)',
   'Levantado à mão no SUITE (usuário, 2026-10-13). Soma de 2 permanências.'),
  ('43022.007860/2025-95',
   round((20*1440 + 2*60 + 25) / 1440.0, 4),
   date '2025-09-01',
   '12/08/2025 09:22 — 20 d 02 h 25 min (despacho 01/09/2025)',
   'Levantado à mão no SUITE (usuário, 2026-10-13).'),
  ('43022.007741/2026-13',
   round((21*60 + 45) / 1440.0, 4),
   date '2026-07-09',
   '09/07/2026 17:06 — 21 h 45 min (despacho 09/07/2026)',
   'Levantado à mão no SUITE (usuário, 2026-10-13). Menos de 1 dia: aberto já pronto, fora da média.'),
  ('43022.012162/2025-10',
   round((20*1440 + 4*60 + 31) / 1440.0, 4),
   date '2025-12-16',
   '26/11/2025 14:05 — 20 d 04 h 31 min (despacho 16/12/2025)',
   'Levantado à mão no SUITE (usuário, 2026-10-13).')
on conflict (processo) do update
  set tempo_dias    = excluded.tempo_dias,
      data_despacho = excluded.data_despacho,
      permanencias  = excluded.permanencias,
      observacao    = excluded.observacao,
      registrado_em = now();

-- Conferência: devem sair 14,9722 / 20,1007 / 0,9063 / 20,1882 e os 4 NUPs devem existir em
-- processos (processo_existe = true).
select m.processo, m.tempo_dias, m.data_despacho,
       exists (select 1 from public.processos p where trim(p.processo) = m.processo) as processo_existe
from public.suite_tempo_manual m
order by m.processo;

commit;
