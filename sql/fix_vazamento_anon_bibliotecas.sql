-- Revisão de segurança de 04/11/2026: corta leitura anônima (chave anon pública em config.js)
-- de composicoes_biblioteca, orcamentos_biblioteca e da listagem dos buckets de Storage.
--
-- Antes: qualquer pessoa com a chave anon lia 2.894 composições (com criador_email,
-- criador_nome, comentários de revisão) e 26 orçamentos (com arquivo_url), e listava todos os
-- objetos dos buckets orcamentos/composicoes_biblioteca (policy SELECT para o papel public).
-- Só os módulos do index.html leem essas tabelas, e eles só carregam depois do login.
--
-- Leitura autenticada continua pelas policies composicoes_select / orcamentos_select
-- (tem_papel_valido()). O SELECT em storage.objects é mantido para autenticados com papel
-- válido porque storage.remove() precisa dele.
--
-- NÃO resolvido aqui: os buckets continuam public=true, então quem já tem a URL de um arquivo
-- ainda baixa sem login. Ver pendência no relatório da revisão.

begin;

drop policy if exists composicoes_biblioteca_read_public on public.composicoes_biblioteca;
drop policy if exists "Leitura Publica" on public.orcamentos_biblioteca;

drop policy if exists "Public Upload 1e0n1yt_0" on storage.objects;
drop policy if exists "Public Upload 1src1ab_0" on storage.objects;

create policy storage_bibliotecas_select_papel_valido on storage.objects
  for select to authenticated
  using (bucket_id in ('orcamentos', 'composicoes_biblioteca') and (select public.tem_papel_valido()));

commit;

-- Rollback (recria o estado anterior):
-- begin;
-- drop policy if exists storage_bibliotecas_select_papel_valido on storage.objects;
-- create policy composicoes_biblioteca_read_public on public.composicoes_biblioteca for select to anon, authenticated using (true);
-- create policy "Leitura Publica" on public.orcamentos_biblioteca for select to anon using (true);
-- create policy "Public Upload 1e0n1yt_0" on storage.objects for select to public using (bucket_id = 'composicoes_biblioteca');
-- create policy "Public Upload 1src1ab_0" on storage.objects for select to public using (bucket_id = 'orcamentos');
-- commit;
