-- Script: fix_composicoes_criador_email.sql
-- Objetivo: consertar os dados antigos de composicoes_biblioteca que a revisão da aba
-- Composições (20/10/2026) mostrou estarem incompatíveis com o RLS atual.
--
-- Problema: as 81 composições não-SOP foram criadas pelo "Criador Analítico" ANTES de o RLS exigir
-- `criador_email`, e esse caminho nunca gravava o campo. Resultado, com as políticas vivas
-- (composicoes_update/composicoes_delete + trigger trg_composicoes_pode_atualizar), que comparam
-- `criador_email` com o e-mail do JWT:
--   * o dono NÃO consegue editar a própria composição (erro "Você só pode editar... que você mesmo criou");
--   * o dono NÃO consegue excluir (o DELETE afeta 0 linhas, sem erro).
-- Além disso, 80 linhas ficaram com fonte = 'PRPRIA' (acento perdido no código-fonte) em vez de 'PRÓPRIA'.
-- (O INSERT de novas composições é corrigido no front-end — modules/composicoes/composicoes.js.)
--
-- O que faz:
--   1. preenche criador_email / criador_nome / criador_role das composições não-SOP, a partir do nome
--      gravado em `usuario` (mapa explícito abaixo, conferido contra app_users em 20/10/2026);
--   2. troca fonte 'PRPRIA' por 'PRÓPRIA'.
-- Não toca nas composições da SOP (usuario = 'SOP'): só admin/gerente editam essas.
--
-- Sobre o trigger: o UPDATE roda no SQL Editor (sem JWT), onde meu_papel() é nulo e o trigger
-- trg_composicoes_pode_atualizar recusaria a mudança. Por isso ele é desligado e religado DENTRO
-- da mesma transação — se qualquer passo falhar, tudo é revertido e o trigger volta ao normal.
--
-- Idempotente: só mexe em linhas com criador_email nulo / fonte = 'PRPRIA'; pode rodar de novo.
--
-- ANTES DE APLICAR (opcional, só leitura) — conferir quem será preenchido:
--   select usuario, historico_versoes->0->>'autor' autor_v1, count(*)
--     from public.composicoes_biblioteca
--    where usuario <> 'SOP' and criador_email is null group by 1, 2 order by 1;
-- Se aparecer um nome que não está no mapa abaixo, o script ABORTA (bloco de conferência no fim)
-- e nada é gravado — acrescente o nome ao mapa e rode de novo.

BEGIN;

ALTER TABLE public.composicoes_biblioteca DISABLE TRIGGER trg_composicoes_pode_atualizar;

-- Mapa inline (sem tabela temporária: o SQL Editor do Supabase não a manteve entre os comandos e
-- deu "relation _map_criadores does not exist"). `usuario` aqui já com espaços normalizados — a
-- comparação abaixo também normaliza: há uma linha gravada como 'FRANCISCO  TALES', com dois espaços.
UPDATE public.composicoes_biblioteca c
   SET criador_email = lower(u.email),
       criador_nome  = COALESCE(c.criador_nome, u.full_name),
       criador_role  = COALESCE(c.criador_role, u.role)
  FROM (VALUES
          ('FRANCISCO TALES',                           'francisco.tales@sop.ce.gov.br'),
          ('FRANCISCO TALES GOMES PEREIRA',             'francisco.tales@sop.ce.gov.br'),
          ('JOSÉ LEONÉZIO',                             'jose.vasconcelos@sop.ce.gov.br'),
          ('JOSÉ LEONÉZIO LOPES DE VASCONCELOS FILHO',  'jose.vasconcelos@sop.ce.gov.br'),
          ('NILDENO ARAGÃO',                            'nildeno.aragao@sop.ce.gov.br'),
          ('TATHIANE ANDRADE',                          'tathiane.andrade@sop.ce.gov.br')
       ) AS m(usuario, email)
  JOIN public.app_users u ON lower(u.email) = lower(m.email)
 WHERE c.usuario <> 'SOP'
   AND c.criador_email IS NULL
   AND regexp_replace(trim(c.usuario), '\s+', ' ', 'g') = m.usuario;

-- 'PR' || Ó (chr(211)) || 'PRIA' — sem depender da codificação do editor.
UPDATE public.composicoes_biblioteca
   SET fonte = 'PR' || chr(211) || 'PRIA'
 WHERE fonte = 'PRPRIA';

ALTER TABLE public.composicoes_biblioteca ENABLE TRIGGER trg_composicoes_pode_atualizar;

-- Conferência: aborta (e reverte tudo) se sobrou composição não-SOP sem dono ou com a fonte corrompida,
-- ou se o trigger não ficou ativo.
DO $$
DECLARE
  v_sem_dono int;
  v_fonte    int;
  v_trigger  char;
BEGIN
  SELECT count(*) INTO v_sem_dono FROM public.composicoes_biblioteca
   WHERE usuario <> 'SOP' AND criador_email IS NULL;
  SELECT count(*) INTO v_fonte FROM public.composicoes_biblioteca WHERE fonte = 'PRPRIA';
  SELECT tgenabled INTO v_trigger FROM pg_trigger
   WHERE tgrelid = 'public.composicoes_biblioteca'::regclass AND tgname = 'trg_composicoes_pode_atualizar';

  IF v_sem_dono > 0 THEN
    RAISE EXCEPTION 'Ainda há % composição(ões) não-SOP sem criador_email — acrescente o nome ao mapa e rode de novo.', v_sem_dono;
  END IF;
  IF v_fonte > 0 THEN
    RAISE EXCEPTION 'Ainda há % linha(s) com fonte = PRPRIA.', v_fonte;
  END IF;
  IF v_trigger IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'O trigger trg_composicoes_pode_atualizar não ficou habilitado (tgenabled = %).', v_trigger;
  END IF;
END $$;

COMMIT;

-- Depois de aplicar, conferir (esperado: 4 e-mails, 81 linhas no total, nenhuma sem dono):
--   select criador_email, count(*) from public.composicoes_biblioteca
--    where usuario <> 'SOP' group by 1 order by 2 desc;
