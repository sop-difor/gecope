-- ============================================================================
-- add_apensamento_processos.sql — apensamento de processos (05/11/2026)
--
-- O QUE FAZ
--   Um processo pode ser APENSADO a outro (o PRINCIPAL), como no SUITE. O vínculo mora
--   no próprio apenso: `processos.apensado_a` aponta para o `id` do principal. Um apenso
--   tem um único principal, então não precisa de tabela de vínculos.
--
--   Decisões do usuário (05/11/2026):
--     * só admin e gerente apensam/desapensam pelo navegador;
--     * o principal carrega o valor de tudo — o apenso deixa de somar (Financeiro,
--       contagens, metas, quebra por fiscal: isso é feito na aplicação, fase 2);
--     * na lista de Processos o apenso fica escondido dentro do principal (fase 2).
--
-- DE ONDE VEM O VÍNCULO
--   O SUITE registra o apensamento no histórico público dos DOIS processos, com o nome de
--   evento "Processo Apensado":
--     principal: "Apensado a este processo o NUP: 43022.010554/2026-17. "
--     apenso:    "Este processo foi apensado ao NUP: 43022.005252/2026-27. "
--   (conferido em 05/11/2026 no 43022.005252/2026-27 e nos seus dois apensos).
--   A `sincronizar-suite` já grava esses eventos em `historico_suite_eventos`, então o
--   bloco [3] preenche os apensamentos existentes só com o que já está no banco.
--
--   O evento de DESAPENSAMENTO do SUITE ainda não foi visto. Por isso o preenchimento só
--   CRIA vínculos, nunca desfaz; desapensar é manual (admin/gerente) até aparecer um caso.
--
-- REGRAS GARANTIDAS PELO BANCO (trigger `trg_processos_apensamento`)
--   * só admin/gerente alteram `apensado_a` (service_role — a sincronização — e o SQL
--     Editor, que não têm JWT de usuário, passam);
--   * não apensa a si mesmo;
--   * sem cadeia: o principal não pode ser apenso de outro, e um processo que tem apensos
--     não pode virar apenso;
--   * o principal não pode estar EXCLUÍDO;
--   * `apensado_em`/`apensado_por` são carimbados pelo banco para usuários do navegador
--     (o e-mail do JWT — não dá para forjar 'SUITE' pela tela).
--   E `trg_processos_desapensar_ao_excluir`: quando um principal é excluído (status
--   EXCLUÍDO, a exclusão é lógica), os apensos dele são desapensados.
--
-- COMO APLICAR: SQL Editor do Supabase, um bloco de cada vez, na ordem.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [0] CONFIRME ANTES — SOMENTE LEITURA.
--     (a) `id` de processos deve ser uuid.
--     (b) As colunas apensado_* NÃO devem existir ainda (se existirem, alguém já aplicou:
--         PARE e confira antes de rodar de novo).
--     (c) Os triggers de apensamento NÃO devem existir ainda.
-- ----------------------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'processos'
  and (column_name = 'id' or column_name like 'apensado%')
order by column_name;

select tgname
from pg_trigger
where tgrelid = 'public.processos'::regclass and not tgisinternal
order by tgname;


-- ----------------------------------------------------------------------------
-- [1] ESTRUTURA E REGRAS. Cole do BEGIN ao COMMIT de uma vez só.
-- ----------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS apensado_a   uuid REFERENCES public.processos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS apensado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS apensado_por text;

COMMENT ON COLUMN public.processos.apensado_a IS
  'id do processo PRINCIPAL ao qual este está apensado (NULL = não é apenso). Ver sql/add_apensamento_processos.sql.';
COMMENT ON COLUMN public.processos.apensado_por IS
  'Quem apensou: e-mail do usuário, ou SUITE quando detectado no histórico do SUITE.';

CREATE INDEX IF NOT EXISTS idx_processos_apensado_a
  ON public.processos(apensado_a) WHERE apensado_a IS NOT NULL;

CREATE OR REPLACE FUNCTION public.processos_validar_apensamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  v_cascata  boolean := coalesce(current_setting('gecope.apenso_cascata', true), '') = '1';
  v_usuario  boolean;
  v_princ    record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.apensado_a IS NOT DISTINCT FROM OLD.apensado_a THEN
    -- Vínculo não mudou: as colunas de carimbo também não podem mudar sozinhas.
    NEW.apensado_em  := OLD.apensado_em;
    NEW.apensado_por := OLD.apensado_por;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.apensado_a IS NULL THEN
    NEW.apensado_em := NULL; NEW.apensado_por := NULL;
    RETURN NEW;
  END IF;

  -- Usuário do navegador = qualquer JWT que não seja o da service_role. Sem JWT nenhum
  -- (SQL Editor, pg_cron) também passa, como a service_role.
  v_usuario := v_jwt_role NOT IN ('', 'service_role') AND NOT v_cascata;

  IF v_usuario AND coalesce(public.meu_papel(), '') NOT IN ('admin', 'gerente') THEN
    RAISE EXCEPTION 'Apenas administradores e gerentes podem apensar ou desapensar processos.';
  END IF;

  IF NEW.apensado_a IS NULL THEN
    NEW.apensado_em := NULL; NEW.apensado_por := NULL;
    RETURN NEW;
  END IF;

  IF NEW.apensado_a = NEW.id THEN
    RAISE EXCEPTION 'Um processo não pode ser apensado a ele mesmo.';
  END IF;

  SELECT p.id, p.processo, p.status, p.apensado_a INTO v_princ
    FROM public.processos p WHERE p.id = NEW.apensado_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processo principal não encontrado.';
  END IF;
  IF upper(coalesce(v_princ.status, '')) IN ('EXCLUÍDO', 'EXCLUIDO') THEN
    RAISE EXCEPTION 'O processo % foi excluído e não pode receber apensos.', v_princ.processo;
  END IF;
  IF v_princ.apensado_a IS NOT NULL THEN
    RAISE EXCEPTION 'O processo % já está apensado a outro. Apense ao principal dele.', v_princ.processo;
  END IF;
  IF EXISTS (SELECT 1 FROM public.processos f WHERE f.apensado_a = NEW.id) THEN
    RAISE EXCEPTION 'Este processo tem apensos e não pode ser apensado a outro. Desapense-os antes.';
  END IF;

  IF v_usuario THEN
    NEW.apensado_em  := now();
    NEW.apensado_por := lower(auth.jwt() ->> 'email');
  ELSE
    NEW.apensado_em  := coalesce(NEW.apensado_em, now());
    NEW.apensado_por := coalesce(nullif(NEW.apensado_por, ''), 'SISTEMA');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_processos_apensamento ON public.processos;
CREATE TRIGGER trg_processos_apensamento
  BEFORE INSERT OR UPDATE ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.processos_validar_apensamento();

-- Principal excluído (lógico) => desapensa os filhos. SECURITY DEFINER porque quem exclui
-- pode ter só a autorização `processos_gravar` (não é gerente); a marca de sessão
-- `gecope.apenso_cascata` diz ao trigger acima que é a cascata, não o usuário.
CREATE OR REPLACE FUNCTION public.processos_desapensar_ao_excluir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF upper(coalesce(NEW.status, '')) IN ('EXCLUÍDO', 'EXCLUIDO')
     AND upper(coalesce(OLD.status, '')) NOT IN ('EXCLUÍDO', 'EXCLUIDO') THEN
    PERFORM set_config('gecope.apenso_cascata', '1', true);
    UPDATE public.processos SET apensado_a = NULL WHERE apensado_a = NEW.id;
    PERFORM set_config('gecope.apenso_cascata', '', true);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_processos_desapensar_ao_excluir ON public.processos;
CREATE TRIGGER trg_processos_desapensar_ao_excluir
  AFTER UPDATE OF status ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.processos_desapensar_ao_excluir();

-- Funções de trigger não precisam ser chamáveis pela API.
REVOKE ALL ON FUNCTION public.processos_validar_apensamento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.processos_desapensar_ao_excluir() FROM PUBLIC, anon, authenticated;

COMMIT;


-- ----------------------------------------------------------------------------
-- [2] PRÉVIA DO PREENCHIMENTO — SOMENTE LEITURA. Mostra o que o bloco [3] faria.
--     `situacao` = 'vai apensar' é o que entra; o resto explica por que fica de fora.
--     Para cada apenso vale o evento MAIS RECENTE "Este processo foi apensado ao NUP: X".
--     O NUP é comparado só pelos dígitos (o GECOPE e o SUITE formatam diferente).
-- ----------------------------------------------------------------------------
with ev as (
  select h.processo_id as apenso_id,
         regexp_replace(substring(h.status from '(?i)apensado ao NUP:\s*([0-9./-]+)'), '\D', '', 'g') as nup_principal,
         h.data_evento,
         row_number() over (partition by h.processo_id order by h.data_evento desc) as rn
  from public.historico_suite_eventos h
  where h.nome = 'Processo Apensado'
    and h.status ilike 'Este processo foi apensado ao NUP:%'
),
vivos as (
  select p.id, p.processo, p.apensado_a,
         regexp_replace(coalesce(p.processo, ''), '\D', '', 'g') as dig,
         count(*) over (partition by regexp_replace(coalesce(p.processo, ''), '\D', '', 'g')) as qtd
  from public.processos p
  where upper(coalesce(p.status, '')) not in ('EXCLUÍDO', 'EXCLUIDO')
),
cand as (
  select ev.apenso_id, a.processo as apenso, ev.nup_principal, pr.id as principal_id,
         pr.processo as principal, pr.qtd, a.apensado_a as atual, ev.data_evento
  from ev
  join vivos a on a.id = ev.apenso_id
  left join vivos pr on pr.dig = ev.nup_principal
  where ev.rn = 1
)
select c.apenso, c.principal, c.nup_principal, c.data_evento,
       case
         when c.atual is not null                    then 'já apensado (mantido)'
         when c.principal_id is null                 then 'principal não cadastrado no GECOPE'
         when c.qtd > 1                              then 'NUP do principal duplicado no GECOPE'
         when c.principal_id = c.apenso_id           then 'aponta para si mesmo'
         when exists (select 1 from cand x where x.apenso_id = c.principal_id)
           or exists (select 1 from public.processos p where p.id = c.principal_id and p.apensado_a is not null)
                                                     then 'principal também é apenso (cadeia)'
         when exists (select 1 from cand x where x.principal_id = c.apenso_id)
           or exists (select 1 from public.processos p where p.apensado_a = c.apenso_id)
                                                     then 'apenso também é principal (cadeia)'
         else 'vai apensar'
       end as situacao
from cand c
order by situacao, c.principal, c.apenso;


-- ----------------------------------------------------------------------------
-- [3] PREENCHIMENTO. Mesma seleção do [2], só as linhas 'vai apensar'.
--     Roda como dono (SQL Editor): o trigger aceita `apensado_por = 'SUITE'` e a data do
--     evento do SUITE. Idempotente: não mexe em quem já tem vínculo.
-- ----------------------------------------------------------------------------
BEGIN;

with ev as (
  select h.processo_id as apenso_id,
         regexp_replace(substring(h.status from '(?i)apensado ao NUP:\s*([0-9./-]+)'), '\D', '', 'g') as nup_principal,
         h.data_evento,
         row_number() over (partition by h.processo_id order by h.data_evento desc) as rn
  from public.historico_suite_eventos h
  where h.nome = 'Processo Apensado'
    and h.status ilike 'Este processo foi apensado ao NUP:%'
),
vivos as (
  select p.id, p.apensado_a,
         regexp_replace(coalesce(p.processo, ''), '\D', '', 'g') as dig,
         count(*) over (partition by regexp_replace(coalesce(p.processo, ''), '\D', '', 'g')) as qtd
  from public.processos p
  where upper(coalesce(p.status, '')) not in ('EXCLUÍDO', 'EXCLUIDO')
),
cand as (
  select ev.apenso_id, pr.id as principal_id, ev.data_evento
  from ev
  join vivos a on a.id = ev.apenso_id and a.apensado_a is null
  join vivos pr on pr.dig = ev.nup_principal and pr.qtd = 1 and pr.apensado_a is null
  where ev.rn = 1 and pr.id <> ev.apenso_id
),
ok as (
  select c.* from cand c
  where not exists (select 1 from cand x where x.apenso_id = c.principal_id)
    and not exists (select 1 from cand x where x.principal_id = c.apenso_id)
    and not exists (select 1 from public.processos p where p.apensado_a = c.apenso_id)
)
update public.processos p
   set apensado_a = ok.principal_id,
       apensado_em = ok.data_evento,
       apensado_por = 'SUITE'
  from ok
 where p.id = ok.apenso_id;

COMMIT;


-- ----------------------------------------------------------------------------
-- [4] CONFIRME DEPOIS — SOMENTE LEITURA. Principais e seus apensos.
--     O 43022.005252/2026-27 deve aparecer com 43022.010554/2026-17 e 43022.011427/2026-35.
-- ----------------------------------------------------------------------------
select pr.processo as principal, a.processo as apenso, a.apensado_em, a.apensado_por
from public.processos a
join public.processos pr on pr.id = a.apensado_a
order by pr.processo, a.processo;
