-- Corrige a troca da comissão da obra 04882022SOP23.
-- A carga de 09/09/2026 foi acrescentada sem remover o lote anterior.
begin;

do $$
declare
  obra_id bigint;
  data_vigente date;
begin
  select ce.id_obra
    into obra_id
    from public.contratos_edificacao ce
   where ce.codigo_obra = '04882022SOP23'
   limit 1;

  if obra_id is null then
    raise exception 'Obra 04882022SOP23 não encontrada';
  end if;

  select max(cf.atualizado_em::date)
    into data_vigente
    from public.comissao_fiscalizacao cf
   where cf.id_obra = obra_id;

  if data_vigente is null then
    raise exception 'Comissão não encontrada para a obra 04882022SOP23';
  end if;

  delete from public.comissao_fiscalizacao cf
   where cf.id_obra = obra_id
    and cf.atualizado_em::date < data_vigente;

  update public.processos p
     set fiscal = atual.nome,
         fiscal_matricula = atual.matricula,
         ultima_atualizacao = now()
    from lateral (
      select coalesce(cf.nome_completo, cf.nome_referencia) as nome,
             cf.matricula
        from public.comissao_fiscalizacao cf
       where cf.id_obra = obra_id
       order by case
          when upper(cf.tipo) like '%PRESIDENTE%' then 6
          when upper(cf.tipo) like '%FISCAL%' then 5
          when upper(cf.tipo) like '%SUPLENTE%' then 1
          else 0
       end desc,
      cf.atualizado_em desc
       limit 1
    ) atual
   where p.codigo_obra = '04882022SOP23'
     and p.excluido_por is null;
end $$;

commit;