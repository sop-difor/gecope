-- Acréscimo/supressão por fonte de recurso (06/11/2026).
--
-- Processo com mais de uma obra/fonte vinculada (codigo_obra + obras_adicionais, ver
-- sql/add_obras_adicionais_processos.sql) só tinha um par de valores Fiscalização/GECOPE: o
-- replanilhamento de 06882026SEDUC01 entrava e o de 06882026SEDUC02 ficava de fora.
--
-- As seis colunas acresc_/supress_/reperc_ (fiscal e gecope) CONTINUAM sendo o TOTAL do processo —
-- painel Financeiro, views, relatórios e Assistente leem só elas e não mudam. Esta coluna guarda a
-- divisão por fonte, gravada pela janela Gerenciar processo, que também grava o total = soma das
-- fontes vinculadas:
--   { "06882026SEDUC01": {"acresc_fiscal": 0, "supress_fiscal": 0, "acresc_gecope": 0, "supress_gecope": 0},
--     "06882026SEDUC02": { ... } }
-- null = processo de uma fonte só (ou ainda não dividido). Reverter: drop column.

alter table public.processos
    add column if not exists valores_por_fonte jsonb;

comment on column public.processos.valores_por_fonte is
    'Acréscimo/supressão (Fiscalização e GECOPE) por código de obra/fonte vinculada. As colunas acresc_*/supress_*/reperc_* seguem sendo o total do processo (soma das fontes). null = uma fonte só.';
