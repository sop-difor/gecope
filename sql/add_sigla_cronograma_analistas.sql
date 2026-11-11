-- Cadastro de analistas editável pela aba Administração (11/11/2026).
--
-- Antes, a inicial gravada em processos.analista (N, W, A, H, P, F) era traduzida
-- para o nome por tabelas fixas no código (index.html, processos.js, cronograma.html).
-- Agora a fonte única é public.cronograma_analistas — a mesma tabela que o Cronograma
-- já usa — com duas colunas novas:
--   sigla  → a letra (ou letras) gravada em processos.analista. Sem sigla, a pessoa
--            existe só no Cronograma e não aparece como opção em Processos.
--   ativo  → false tira a pessoa das listas de seleção de Processos, mas o nome
--            continua aparecendo nos processos antigos que já estão com a sigla dela.
--
-- O Cronograma grava a tabela por upsert só com id/nome/matricula/cargo, então não
-- sobrescreve sigla nem ativo.

alter table public.cronograma_analistas
  add column if not exists sigla text,
  add column if not exists ativo boolean not null default true;

alter table public.cronograma_analistas
  drop constraint if exists cronograma_analistas_sigla_formato;
alter table public.cronograma_analistas
  add constraint cronograma_analistas_sigla_formato
  check (sigla is null or sigla ~ '^[A-Z0-9]{1,3}$');

create unique index if not exists cronograma_analistas_sigla_unica
  on public.cronograma_analistas (sigla) where sigla is not null;

-- Siglas que já estão em uso em processos.analista.
update public.cronograma_analistas set sigla = 'A' where nome = 'Ada'     and sigla is null;
update public.cronograma_analistas set sigla = 'F' where nome = 'Felipe'  and sigla is null;
update public.cronograma_analistas set sigla = 'H' where nome = 'Helder'  and sigla is null;
update public.cronograma_analistas set sigla = 'N' where nome = 'Nildeno' and sigla is null;
update public.cronograma_analistas set sigla = 'P' where nome = 'Pedro'   and sigla is null;
update public.cronograma_analistas set sigla = 'W' where nome = 'Walace'  and sigla is null;

-- Leitura para qualquer usuário logado: quem vê Processos (inclusive com a autorização
-- "ver todos") precisa traduzir a sigla em nome. A gravação continua só para a equipe
-- (política cronograma_analistas_staff, já existente).
drop policy if exists cronograma_analistas_leitura on public.cronograma_analistas;
create policy cronograma_analistas_leitura on public.cronograma_analistas
  for select to authenticated using (true);
