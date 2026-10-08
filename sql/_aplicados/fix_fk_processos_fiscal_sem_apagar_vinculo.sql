-- ============================================================================
-- fix_fk_processos_fiscal_sem_apagar_vinculo.sql — 07/10/2026.
--
-- PROBLEMA (confirmado em 07/10/2026): a FK `processos_fiscal_matricula_fkey` foi criada
-- com ON DELETE SET NULL. Excluir o cadastro de um fiscal em Administração zera
-- `processos.fiscal_matricula` de TODOS os processos dele, em silêncio. O nome em
-- `processos.fiscal` fica, então a tela de Processos parece normal, mas o Mapa de Obras
-- tira os processos da lista de fiscais ("N processos sem matrícula de fiscal gravada").
-- Aconteceu com EDILSON DE FREITAS QUEIROZ JÚNIOR (12 processos).
--
-- CORREÇÃO: trocar ON DELETE SET NULL por ON DELETE RESTRICT. Excluir quem ainda tem
-- processo passa a ser RECUSADO pelo banco (erro 23503) em vez de apagar o vínculo. Quem
-- não tem processo continua podendo ser excluído. ON UPDATE CASCADE fica como está
-- (trocar a matrícula em app_users continua propagando).
--
-- EFEITO NA TELA: excluirUsuario() (modules/administracao/admin.js) já confere os
-- processos antes e explica o bloqueio; este script é a trava do lado do banco.
-- "Excluir e recriar" um fiscal deixa de funcionar enquanto ele tiver processos — para
-- mudar papel/dados, use a edição; para trocar de pessoa, passe os processos antes.
--
-- APLICADO em 07/10/2026 pelo usuário: [1] mostrou SET NULL, [2] sem erro, [3] mostrou RESTRICT.
--
-- ORDEM: rode [1] (só leitura) e confira; depois [2]; depois [3] (só leitura).
-- ============================================================================


-- [1] ANTES — SOMENTE LEITURA. Deve mostrar ON DELETE SET NULL.
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.processos'::regclass
  and conname = 'processos_fiscal_matricula_fkey';


-- [2] CORREÇÃO. Uma transação; se a constraint não existir com esse nome, aborta.
--     Reaproveita as linhas atuais: todas as matrículas gravadas já existem em
--     app_users (a FK antiga garantia), então a validação passa.
begin;

alter table public.processos
  drop constraint processos_fiscal_matricula_fkey;

alter table public.processos
  add constraint processos_fiscal_matricula_fkey
  foreign key (fiscal_matricula) references public.app_users (matricula)
  on update cascade
  on delete restrict;

commit;


-- [3] DEPOIS — SOMENTE LEITURA. Deve mostrar ON DELETE RESTRICT.
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.processos'::regclass
  and conname = 'processos_fiscal_matricula_fkey';
