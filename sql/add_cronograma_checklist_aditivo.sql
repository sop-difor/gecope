-- Migração: novo item "8. Cronograma" no Checklist de Documentação do Aditivo
-- (Processos > Análise Documental), logo após "7. Curva ABC".
--
-- Nullable porque checklists já finalizados antes desta migração não têm essa
-- resposta; no relatório de Análise Documental eles aparecem como "N/A" nesse item.
--
-- Uso: rode este arquivo no SQL Editor do Supabase (Dashboard > SQL Editor).
-- IMPORTANTE: aplique ANTES de publicar o código novo — sem a coluna, o insert do
-- checklist falha ("column cronograma does not exist").

alter table checklist_documentacao_aditivo
  add column if not exists cronograma     boolean,
  add column if not exists cronograma_obs text;
