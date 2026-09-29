-- Migração: confirmação de realização da vistoria agendada (Cronograma de Vistorias
-- e painéis da Elétrica, pedido do usuário 29/09/2026).
--
-- Contexto: até aqui o app só sabia inferir "sem relatório" comparando a data
-- planejada com hoje — não distinguia uma vistoria que passou da data e ninguém
-- confirmou (Pendente) de uma que o engenheiro já confirmou ter feito, mas ainda
-- não anexou relatório (Realizada). Esta coluna guarda essa confirmação, feita na
-- aba Elétrica da obra (buildEletricaPane/wireEletricaPane em mapa-obras.js) assim
-- que a data planejada já passou.
--
-- Coluna NULLABLE de propósito, mesmo padrão de excluido_em nesta tabela: NULL =
-- não confirmada (o app decide Agendada/Pendente comparando data_planejada com
-- hoje, como já fazia); preenchida = confirmada pelo engenheiro, vira Vistoriada/
-- Realizada independente de haver relatório. Agendamentos antigos, já vencidos,
-- nascem com esta coluna NULL e caem em "Pendente" até alguém confirmar — sem
-- migração retroativa (não há como inferir com segurança se a visita ocorreu).
--
-- RLS: nenhuma policy nova — a de UPDATE já existente (eletrica_vistorias_agendadas_update,
-- ver sql/create_eletrica_vistorias_agendadas.sql) libera eletrica/admin para
-- qualquer coluna da linha, esta incluída.
--
-- Uso: rode este arquivo inteiro no SQL Editor do Supabase (Dashboard > SQL Editor).

begin;

alter table eletrica_vistorias_agendadas add column if not exists realizada_em timestamptz;

commit;

-- Verificação pós-migração:
-- select id, id_obra, data_planejada, responsavel_nome, realizada_em from eletrica_vistorias_agendadas order by criado_em desc limit 20;
