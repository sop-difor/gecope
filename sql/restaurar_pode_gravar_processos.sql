-- ============================================================================
-- restaurar_pode_gravar_processos.sql — OPCIONAL, aguardando decisão.
--
-- Este script NÃO corrige um defeito: ele restaura uma intenção que se perdeu. Só deve ser
-- aplicado se a resposta à pergunta abaixo for "sim".
--
--     A caixa "Processos: gravar/editar/excluir (igual Gerente)" da tela de Administração
--     deve voltar a valer de verdade?
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
-- CONSEQUÊNCIA HOJE: a autorização `processos_gravar` não grava nada em `processos` desde
-- 18/09/2026, embora a caixa continue sendo oferecida em Administração. Quem a recebe
-- enxerga o processo e abre o modal, mas não vê SALVAR nem EXCLUIR — porque
-- `podeGravarProcessos()` em core/auth.js foi alinhada ao banco REAL, não à intenção da
-- Fase 5.
--
-- SE VOCÊ APLICAR ESTE SCRIPT, faça a mudança do navegador NO MESMO DIA, senão a tela fica
-- mais rígida que o banco (o problema inverso, que foi o que esta revisão corrigiu):
--
--     core/auth.js, função podeGravarProcessos():
--       return ['admin', 'gerente'].includes(getCurrentUserRole())
--              || temAutorizacao('processos_gravar');
--
--     ...e o comentário dela, que hoje explica por que a autorização NÃO vale.
--
-- SE VOCÊ NÃO APLICAR, a alternativa honesta é tirar a caixa `processos_gravar` da tela de
-- Administração (index.html) — hoje ela promete "igual Gerente" e não entrega.
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
