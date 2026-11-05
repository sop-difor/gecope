-- Processo com mais de uma obra/fonte do mesmo contrato (05/11/2026).
--
-- Antes o processo guardava um único `codigo_obra`. Uma obra paga por duas fontes de recurso vira
-- dois códigos no SIGSOP (ex.: 06882026SEDUC01 = Tesouro, 06882026SEDUC02 = Convênio Federal), e o
-- processo só conseguia apontar para um deles; um aditivo que abrange várias obras do contrato
-- também ficava preso a uma só.
--
-- `codigo_obra` continua sendo a obra PRINCIPAL (fiscal, distrito, município, Ficha Obra, painel de
-- desempenho). `obras_adicionais` guarda os demais códigos DO MESMO CONTRATO que o processo trata.
-- A base de cálculo dos percentuais (Gerenciar processo) passa a ser a soma das obras vinculadas
-- (decisão do usuário, 05/11/2026); com todas as obras do contrato vinculadas, é a base do contrato.
-- A conferência "mesmo contrato" é feita na tela (buscarBaseContrato, processos.js): código de
-- outro contrato é ignorado no cálculo e sinalizado.

alter table public.processos
    add column if not exists obras_adicionais text[] not null default '{}';

comment on column public.processos.obras_adicionais is
    'Códigos de obra (contratos_edificacao.codigo_obra) do MESMO contrato tratados pelo processo, além de codigo_obra (a principal). Entram na base de cálculo dos percentuais.';

-- Preenche os processos já cadastrados cuja obra tem "fontes irmãs": outro código do mesmo
-- contrato com a mesma descrição de obra (é assim que o SIGSOP separa as fontes de recurso).
-- Obras diferentes do mesmo contrato NÃO entram sozinhas: isso depende do que o processo trata.
-- Em 05/11/2026 eram 23 processos. Reverter: update processos set obras_adicionais = '{}'.
update public.processos p
   set obras_adicionais = x.irmas
  from (
        select p2.id, array_agg(o2.codigo_obra order by o2.codigo_obra) as irmas
          from public.processos p2
          join public.contratos_edificacao o  on o.codigo_obra = p2.codigo_obra
          join public.contratos_edificacao o2 on o2.nr_contrato_sop = o.nr_contrato_sop
                                             and o2.codigo_obra <> o.codigo_obra
                                             and upper(trim(o2.descricao_obra)) = upper(trim(o.descricao_obra))
         where p2.status <> 'EXCLUÍDO'
         group by p2.id
       ) x
 where p.id = x.id
   and p.obras_adicionais = '{}';
