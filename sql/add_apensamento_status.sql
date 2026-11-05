-- ============================================================================
-- add_apensamento_status.sql — o apenso tem SEMPRE o status do principal (05/11/2026)
--
-- Pré-requisito: sql/add_apensamento_processos.sql já aplicado (colunas apensado_*, triggers
-- trg_processos_apensamento e trg_processos_desapensar_ao_excluir).
--
-- Decisão do usuário (05/11/2026): "o processo apensado deve ter o mesmo status do principal".
-- No SUITE o apenso tramita junto com o principal, mas as regras da `sincronizar-suite` e as
-- edições pela tela podiam deixá-los diferentes (ex.: principal AGUAR. REANÁLISE e apenso
-- AGUAR. ANÁLISE). A regra fica no banco para valer para TODOS os caminhos de escrita:
--
--   [A] trg_processos_apenso_status (BEFORE INSERT/UPDATE, no apenso): qualquer status gravado
--       num apenso é trocado pelo do principal — em silêncio, de propósito: a sincronização
--       grava `suite`/`suite_data_chegada` no mesmo UPDATE, e um erro aqui derrubaria esse
--       PATCH inteiro. Exceção: EXCLUÍDO passa (excluir um apenso continua possível).
--       Também é o que copia o status no momento de apensar.
--       Ordem: os BEFORE rodam por nome; "trg_processos_apensamento" vem antes de
--       "trg_processos_apenso_status", então a validação do vínculo roda primeiro.
--
--   [B] trg_processos_propagar_status (AFTER UPDATE OF status, no principal): quando o status do
--       principal muda, os apensos recebem o novo status. EXCLUÍDO não propaga — o principal
--       excluído desapensa os filhos (trg_processos_desapensar_ao_excluir).
--
-- Desapensar não mexe no status: o processo fica com o último status do principal até a
-- próxima mudança (manual ou da sincronização).
--
-- COMO APLICAR: SQL Editor do Supabase, um bloco de cada vez, na ordem.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [0] CONFIRME ANTES — SOMENTE LEITURA.
--     Devem aparecer trg_processos_apensamento e trg_processos_desapensar_ao_excluir, e NÃO
--     devem aparecer trg_processos_apenso_status nem trg_processos_propagar_status.
--     A segunda consulta lista os apensos com status diferente do principal (o que o bloco
--     [2] vai acertar).
-- ----------------------------------------------------------------------------
select tgname
from pg_trigger
where tgrelid = 'public.processos'::regclass and not tgisinternal
order by tgname;

select pr.processo as principal, pr.status as status_principal,
       a.processo as apenso, a.status as status_apenso
from public.processos a
join public.processos pr on pr.id = a.apensado_a
where a.status is distinct from pr.status
order by pr.processo, a.processo;


-- ----------------------------------------------------------------------------
-- [1] REGRAS. Cole do BEGIN ao COMMIT de uma vez só.
-- ----------------------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.processos_apenso_herdar_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
BEGIN
  IF NEW.apensado_a IS NULL THEN
    RETURN NEW;
  END IF;
  -- A propagação [B] já grava o status certo; não precisa consultar de novo.
  IF coalesce(current_setting('gecope.apenso_cascata', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF upper(coalesce(NEW.status, '')) IN ('EXCLUÍDO', 'EXCLUIDO') THEN
    RETURN NEW;
  END IF;

  SELECT p.status INTO v_status FROM public.processos p WHERE p.id = NEW.apensado_a;
  IF FOUND AND v_status IS NOT NULL
     AND upper(v_status) NOT IN ('EXCLUÍDO', 'EXCLUIDO')
     AND NEW.status IS DISTINCT FROM v_status THEN
    NEW.status := v_status;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_processos_apenso_status ON public.processos;
CREATE TRIGGER trg_processos_apenso_status
  BEFORE INSERT OR UPDATE ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.processos_apenso_herdar_status();

-- SECURITY DEFINER: quem muda o status do principal pode não ter permissão de UPDATE nos
-- apensos (RLS); a marca `gecope.apenso_cascata` avisa os outros triggers que é a cascata.
CREATE OR REPLACE FUNCTION public.processos_propagar_status_apensos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF upper(coalesce(NEW.status, '')) IN ('EXCLUÍDO', 'EXCLUIDO') THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('gecope.apenso_cascata', '1', true);
  UPDATE public.processos a
     SET status = NEW.status,
         atualizado_por = 'STATUS DO PRINCIPAL ' || coalesce(NEW.processo, ''),
         ultima_atualizacao = now()
   WHERE a.apensado_a = NEW.id
     AND a.status IS DISTINCT FROM NEW.status
     AND upper(coalesce(a.status, '')) NOT IN ('EXCLUÍDO', 'EXCLUIDO');
  PERFORM set_config('gecope.apenso_cascata', '', true);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_processos_propagar_status ON public.processos;
CREATE TRIGGER trg_processos_propagar_status
  AFTER UPDATE OF status ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.processos_propagar_status_apensos();

REVOKE ALL ON FUNCTION public.processos_apenso_herdar_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.processos_propagar_status_apensos() FROM PUBLIC, anon, authenticated;

COMMIT;


-- ----------------------------------------------------------------------------
-- [2] ACERTO DOS APENSOS QUE JÁ EXISTEM. Iguala o status ao do principal.
-- ----------------------------------------------------------------------------
BEGIN;

UPDATE public.processos a
   SET status = pr.status,
       atualizado_por = 'STATUS DO PRINCIPAL ' || coalesce(pr.processo, ''),
       ultima_atualizacao = now()
  FROM public.processos pr
 WHERE a.apensado_a = pr.id
   AND a.status IS DISTINCT FROM pr.status
   AND pr.status IS NOT NULL
   AND upper(pr.status) NOT IN ('EXCLUÍDO', 'EXCLUIDO')
   AND upper(coalesce(a.status, '')) NOT IN ('EXCLUÍDO', 'EXCLUIDO');

COMMIT;


-- ----------------------------------------------------------------------------
-- [3] CONFIRME DEPOIS — SOMENTE LEITURA. Deve voltar VAZIO.
-- ----------------------------------------------------------------------------
select pr.processo as principal, pr.status as status_principal,
       a.processo as apenso, a.status as status_apenso
from public.processos a
join public.processos pr on pr.id = a.apensado_a
where a.status is distinct from pr.status
  and upper(coalesce(a.status, '')) not in ('EXCLUÍDO', 'EXCLUIDO')
order by pr.processo, a.processo;
