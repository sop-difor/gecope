-- Migração: NUP do processo SUITE em cada relatório de vistoria elétrica (aba
-- "Elétrica", pedido do usuário 29/09/2026).
--
-- Contexto: a partir de agora, ao inserir um relatório de vistoria, o engenheiro
-- precisa abrir um processo no SUITE (Sistema de Processos Administrativos do
-- Governo do Estado), anexar o relatório lá e encaminhar ao fiscal responsável
-- pela obra — o NUP desse processo fica registrado junto do relatório aqui.
-- Front-end: assets/js/mapa-obras.js (wireEletricaPane) passa a exigir o campo
-- antes de liberar o envio; a máscara e o link "Abrir no SUITE" seguem o mesmo
-- padrão já usado em modules/processos/processos.js.
--
-- Coluna NULLABLE de propósito: relatórios já enviados antes desta migração não
-- têm NUP e não há como preencher retroativamente. A obrigatoriedade é só de
-- formulário (front-end), não uma constraint de banco — mesma leitura que o
-- resto da tabela já faz (ver sql/create_eletrica_vistorias.sql).
--
-- Uso: rode este arquivo inteiro no SQL Editor do Supabase (Dashboard > SQL Editor).

begin;

alter table eletrica_vistorias add column if not exists nup_processo text;

commit;

-- Verificação pós-migração:
-- select id, id_obra, responsavel_nome, nup_processo, criado_em from eletrica_vistorias order by criado_em desc limit 20;
