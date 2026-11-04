-- Revisão de segurança de 04/11/2026 (item 4): torna privados os buckets de orçamentos e
-- composições. Enquanto public = true, qualquer pessoa com o link de um arquivo baixa sem
-- login (os links ficam gravados em arquivo_url, historico_versoes e anexos de comentário).
--
-- APLICAR SÓ DEPOIS que o front com urlAssinadaStorage/abrirArquivoStorage (utils.js)
-- estiver publicado: o front antigo abre o link público direto e pararia de baixar.
--
-- Depois disto, leitura só por link assinado, que exige sessão com papel válido
-- (policy storage_bibliotecas_select_papel_valido, de fix_vazamento_anon_bibliotecas.sql).
-- sop_inicial fica como está: o código não usa esse bucket.

update storage.buckets set public = false where id in ('orcamentos', 'composicoes_biblioteca');

-- Rollback:
-- update storage.buckets set public = true where id in ('orcamentos', 'composicoes_biblioteca');
