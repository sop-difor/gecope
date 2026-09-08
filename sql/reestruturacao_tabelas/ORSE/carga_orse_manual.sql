-- ============================================================
-- Carga ORSE — comandos para o SQL Editor do Supabase
-- Troque a data '2026-06-01' pela referência que está carregando.
-- Ordem cronológica; não repita referência.
-- O CSV vem de gerar_stg_orse.py (serviços + insumos do mês).
-- ============================================================

-- PASSO 1 — esvaziar a área de recebimento
TRUNCATE stg_orse;

-- PASSO 2 — (na tela) Table Editor -> stg_orse -> Insert -> Import data from CSV
--           escolha o arquivo _csv/stg_orse_AAAA-MM.csv

-- PASSO 3 — gravar o delta (limpa a stg_orse no fim)
SELECT rt_aplicar_orse('2026-06-01');

-- PASSO 4 — conferir
SELECT count(*) AS linhas_na_fachada FROM orse_itens WHERE referencia = '2026-06-01';
SELECT count(*) FILTER (WHERE identificacao='C') AS servicos,
       count(*) FILTER (WHERE identificacao='I') AS insumos
FROM orse_itens WHERE referencia = '2026-06-01';
SELECT referencia_label FROM referencia_carregada WHERE fonte = 'ORSE' ORDER BY referencia_ord;

-- ------------------------------------------------------------
-- RECOMEÇAR O ORSE DO ZERO  (ver RECARGA.md)
-- ------------------------------------------------------------
-- TRUNCATE orse_preco, orse_descricao, orse_item_presenca, orse_item;
-- DELETE FROM referencia_carregada WHERE fonte='ORSE';
-- TRUNCATE stg_orse;
-- -- depois: para cada mês, na ordem, PASSO 1..3 (ou node subir_stg_orse.mjs)
