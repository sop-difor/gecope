-- ============================================================================
-- fix_restaurar_matricula_fiscal_reativado.sql — 07/10/2026.
--
-- PROBLEMA: o cadastro do fiscal EDILSON DE FREITAS QUEIROZ JUNIOR foi excluído e
-- reativado em 07/10/2026. 12 processos ficaram com `processos.fiscal` (nome) preenchido
-- e `processos.fiscal_matricula` vazio — o painel do Mapa de Obras avisa "N processo(s)
-- sem matrícula de fiscal gravada" e os deixa fora da lista de fiscais. A hipótese é que
-- a FK processos.fiscal_matricula -> app_users.matricula tem ON DELETE SET NULL e o
-- DELETE de app_users zerou a coluna (a reativação cria linha nova, não religa nada).
--
-- ORDEM: rode [1] e [2] (só leitura) e confira. Só rode [3] se [1] devolver EXATAMENTE
-- uma linha e [2] listar os 12 processos esperados.
-- ----------------------------------------------------------------------------
-- RESULTADO EM 07/10/2026: **[3] NÃO FOI APLICADO.** O usuário recadastrou o fiscal
-- nos 12 processos pela própria tela; conferido em consulta (matrícula 01001612, 12
-- processos, nenhum processo com nome de fiscal e sem matrícula). O nome gravado passou
-- a ter acento (JÚNIOR), então os filtros deste arquivo, escritos sem acento, não casam
-- mais. Fica no repositório pelo diagnóstico e pelo bloco [5] (regra da FK), que segue
-- pendente: a causa — exclusão do cadastro zerando processos.fiscal_matricula — não foi tratada.
-- ----------------------------------------------------------------------------
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [1] CADASTRO ATUAL DO FISCAL — SOMENTE LEITURA.
--     Deve voltar UMA linha, com matrícula preenchida. Zero linhas = o cadastro novo
--     está com outro nome; duas ou mais = duplicidade, NÃO siga para o [3].
-- ----------------------------------------------------------------------------
select id, email, full_name, matricula, role, gedop, created_at
from public.app_users
where upper(btrim(full_name)) = 'EDILSON DE FREITAS QUEIROZ JUNIOR';


-- ----------------------------------------------------------------------------
-- [2] PROCESSOS A RESTAURAR — SOMENTE LEITURA.
--     Os 12 do aviso. Se vier outro número, pare e me avise.
-- ----------------------------------------------------------------------------
select id, processo, fiscal, fiscal_matricula, status
from public.processos
where excluido_por is null
  and upper(btrim(fiscal)) = 'EDILSON DE FREITAS QUEIROZ JUNIOR'
  and nullif(btrim(fiscal_matricula), '') is null
order by processo;


-- ----------------------------------------------------------------------------
-- [3] CORREÇÃO. Uma transação; a matrícula vem do cadastro atual (nunca digitada à mão).
--     O DO aborta, sem gravar nada, se não houver exatamente um cadastro com matrícula
--     ou se o número de processos tocados não for 12.
-- ----------------------------------------------------------------------------
begin;

do $$
declare
  v_mat    text;
  v_cads   int;
  v_alvo   int;
  v_feitos int;
begin
  select count(*), max(matricula)
    into v_cads, v_mat
  from public.app_users
  where upper(btrim(full_name)) = 'EDILSON DE FREITAS QUEIROZ JUNIOR'
    and nullif(btrim(matricula), '') is not null;

  if v_cads <> 1 then
    raise exception 'Esperava 1 cadastro com matrícula, achei %. Nada foi gravado.', v_cads;
  end if;

  select count(*) into v_alvo
  from public.processos
  where excluido_por is null
    and upper(btrim(fiscal)) = 'EDILSON DE FREITAS QUEIROZ JUNIOR'
    and nullif(btrim(fiscal_matricula), '') is null;

  if v_alvo <> 12 then
    raise exception 'Esperava 12 processos, achei %. Nada foi gravado.', v_alvo;
  end if;

  update public.processos
     set fiscal_matricula = v_mat
   where excluido_por is null
     and upper(btrim(fiscal)) = 'EDILSON DE FREITAS QUEIROZ JUNIOR'
     and nullif(btrim(fiscal_matricula), '') is null;

  get diagnostics v_feitos = row_count;
  raise notice 'Matrícula % restaurada em % processos.', v_mat, v_feitos;
end $$;

commit;


-- ----------------------------------------------------------------------------
-- [4] CONFERÊNCIA — SOMENTE LEITURA. Deve voltar VAZIO.
-- ----------------------------------------------------------------------------
select fiscal, count(*) as processos
from public.processos
where excluido_por is null
  and nullif(btrim(fiscal), '') is not null
  and nullif(btrim(fiscal_matricula), '') is null
group by fiscal;


-- ----------------------------------------------------------------------------
-- [5] PREVENÇÃO — SOMENTE LEITURA, e só depois de confirmada a hipótese.
--     Mostra a regra de exclusão da FK. Se vier ON DELETE SET NULL, a próxima exclusão
--     de um fiscal repete o problema; a troca para RESTRICT (ou para barrar a exclusão
--     de quem tem processo) é decisão a tomar à parte, com o resultado desta consulta.
-- ----------------------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.processos'::regclass
  and contype = 'f'
  and pg_get_constraintdef(oid) ilike '%app_users%';
