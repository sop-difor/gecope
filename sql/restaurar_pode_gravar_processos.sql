-- ============================================================================
-- restaurar_pode_gravar_processos.sql — APLICAR. Decisão do usuário em 22/09/2026: sim, a
-- caixa "Processos: gravar/editar/excluir (igual Gerente)" deve voltar a valer.
--
-- Este script NÃO corrige um defeito de funcionamento: ele restaura uma intenção que se
-- perdeu. O par dele no navegador — `|| temAutorizacao('processos_gravar')` em
-- `podeGravarProcessos()`, core/auth.js — **já está commitado**. Enquanto este script não for
-- aplicado, a tela fica mais permissiva que o banco: quem tiver a autorização verá SALVAR e
-- EXCLUIR e levará erro do banco ao clicar. Por isso a ordem importa: **aplique este script
-- ANTES de a branch `revisao/processos-2026-09-22` ir para produção.**
--
-- RAIO DE ALCANCE HOJE: nenhum. Em 22/09/2026 uma única pessoa tinha a autorização
-- `processos_gravar` ativa, e o papel dela é **admin** — ou seja, já grava pelo papel.
-- Ninguém perdeu acesso com a quebra de 18/09 e ninguém ganha acesso com esta restauração.
-- O que se conserta é a promessa da caixa para a próxima vez que ela for usada.
--
-- O QUE ACONTECEU (achado de 22/09/2026, durante a revisão do módulo Processos):
--
-- A Fase 5 (sql/autorizacoes_especiais.sql) criou a função `public.pode_gravar_processos()`
-- — admin, gerente OU quem tem a autorização especial `processos_gravar` — e amarrou as
-- políticas `processos_insert` e `processos_update` a ela.
--
-- Em 18/09/2026, durante a correção de egress, o script
-- `sql/_aplicados/fix_processos_rw_authenticated_leftover.sql` removeu uma política órfã
-- (`processos_rw_authenticated`) e, no bloco secundário de desempenho, RECRIOU
-- `processos_insert` e `processos_update` — só que a partir da definição ANTERIOR à Fase 5:
--
--     using ((select public.meu_papel()) in ('admin','gerente'))
--
-- O ramo `tenho_autorizacao('processos_gravar')` foi apagado junto, sem que ninguém notasse:
-- o script mirava a política órfã e levou estas duas de carona. `processos_select` escapou
-- (aquele script não o tocou) e por isso continua usando `pode_ver_todos_processos()`.
--
-- CONSEQUÊNCIA ENQUANTO ISSO DUROU: a autorização `processos_gravar` não gravou nada em
-- `processos` entre 18/09 e a aplicação deste script, embora a caixa continuasse sendo
-- oferecida em Administração.
--
-- SE ESTE SCRIPT FOR REVERTIDO um dia, ou se a política for mexida de novo, desfaça também a
-- linha correspondente em `core/auth.js` (`podeGravarProcessos()`) no mesmo dia. Tela mais
-- larga que o banco = erro na cara do usuário; tela mais estreita = poder escondido. Os dois
-- lados são um par.
--
-- A ALTERNATIVA DESCARTADA em 22/09/2026 era remover a caixa `processos_gravar` da tela de
-- Administração e deixar o banco como estava — coerente também, e mais simples, mas perde a
-- granularidade de autorizar alguém a editar processos sem promovê-lo a gerente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [0] CONFIRME ANTES — SOMENTE LEITURA. Duas coisas de uma vez:
--
--     (a) `qual` de processos_insert/processos_update deve mostrar HOJE
--         `meu_papel() in ('admin','gerente')` — o estado descrito acima. Se já mostrar
--         `pode_gravar_processos()`, alguém já restaurou: PARE, este script não é
--         necessário.
--     (b) Se `qual` mostrar qualquer OUTRA coisa, alguém ajustou a política direto no
--         banco depois de 22/09/2026 — o bloco [2] sobrescreveria esse ajuste em silêncio.
--         PARE e me mande o resultado.
-- ----------------------------------------------------------------------------
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'processos'
order by cmd, policyname;


-- ----------------------------------------------------------------------------
-- [1] A FUNÇÃO EXISTE? — SOMENTE LEITURA.
--
--     O bloco [2] amarra as políticas a `public.pode_gravar_processos()`. Se a função não
--     existir, o CREATE POLICY falha e a transação inteira volta atrás (a tabela não fica
--     sem política — é para isso que o BEGIN/COMMIT está lá), mas é melhor descobrir aqui.
--
--     RESULTADO ESPERADO: uma linha, com a definição que soma `tenho_autorizacao`.
--     Se vier VAZIO, a função foi removida em algum momento: reaplique a parte de funções
--     de sql/autorizacoes_especiais.sql antes de continuar.
-- ----------------------------------------------------------------------------
select p.proname, pg_get_functiondef(p.oid) as definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'pode_gravar_processos';


-- ----------------------------------------------------------------------------
-- [2] A RESTAURAÇÃO.
--
--     Volta as duas políticas à definição da Fase 5. O `(select fn())` é mantido de
--     propósito: sem ele o Postgres reavalia a função linha a linha em vez de cachear como
--     InitPlan — foi justamente esse ganho que o script de 18/09 veio buscar, e ele
--     continua valendo aqui.
--
--     TRANSAÇÃO OBRIGATÓRIA: entre o DROP e o CREATE de `processos_update` existe um
--     instante em que a tabela está com RLS ligado e sem política de UPDATE — nesse
--     intervalo NINGUÉM grava, admin inclusive. Dentro de BEGIN/COMMIT isso nunca fica
--     visível, e um erro em qualquer ponto desfaz tudo em vez de deixar a tabela
--     inalterável para a aplicação inteira. Cole do BEGIN ao COMMIT de uma vez só.
--
--     INSERT e UPDATE juntos de propósito: os dois foram apagados pelo mesmo script e os
--     dois compõem "gravar". Restaurar só um deixaria a autorização pela metade — capaz de
--     criar e não de editar o que criou.
-- ----------------------------------------------------------------------------
BEGIN;

drop policy if exists "processos_insert" on public.processos;
create policy "processos_insert"
  on public.processos
  for insert
  to authenticated
  with check ((select public.pode_gravar_processos()));

drop policy if exists "processos_update" on public.processos;
create policy "processos_update"
  on public.processos
  for update
  to authenticated
  using ((select public.pode_gravar_processos()))
  with check ((select public.pode_gravar_processos()));

COMMIT;


-- ----------------------------------------------------------------------------
-- [3] CONFIRME DEPOIS — devem constar processos_select, processos_insert, processos_update
--     e ia_ro_select, e mais nada. `qual`/`with_check` de insert e update agora mostram
--     `pode_gravar_processos()`.
--
--     Traz a condição à vista de propósito: sem ela só dá para conferir que a política
--     existe, não que está certa.
-- ----------------------------------------------------------------------------
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'processos'
order by cmd, policyname;


-- ============================================================================
-- DEPOIS DE APLICAR — a conferência de tela que fecha o assunto (passo 14 da seção 6 de
-- docs/revisoes/2026-09-22-processos.md):
--
--   Conceder a caixa "Processos: gravar/editar/excluir (igual Gerente)" a um fiscal, entrar
--   com ele e confirmar que o modal abre COM os campos editáveis, SALVAR e EXCLUIR — e que
--   salvar de fato grava. Antes da mudança em core/auth.js, o modal abre em leitura.
--
-- LIÇÃO REGISTRADA: o script de 18/09 recriou políticas que não eram o alvo dele. Um
-- `drop policy` + `create policy` fora do arquivo que é dono daquela política reescreve, em
-- silêncio, tudo que outro arquivo tenha acrescentado. O bloco [0] existe em todos os
-- scripts novos por causa disso.
-- ============================================================================
