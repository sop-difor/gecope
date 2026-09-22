// supabase/functions/backfill-historico-suite/index.ts
//
// ARQUIVO MORTO — guardado só como registro. Baixado do servidor em 22/09/2026 para ser
// arquivado ANTES de a função ser removida do Supabase (revisão 22/09/2026).
// NÃO republique esta função sem antes reler o motivo abaixo.
//
// O QUE ELA FAZIA: recebia UM NUP no corpo da requisição, consultava o SUITE e gravava o
// histórico completo daquele processo em `historico_suite_eventos`. Ferramenta manual de
// reparo unitário.
//
// POR QUE FOI REMOVIDA: a `sincronizar-suite` publicada faz exatamente isso, para TODOS os
// processos, a cada rodada — ela pede o histórico completo e insere tudo que ainda não
// existe (ver `salvarHistoricoSuite` lá). As duas calculam `chave_evento` de forma
// idêntica (mesmos campos, mesma ordem, SHA-256), então nunca duplicaram nada entre si e
// uma cobre a outra integralmente. Esta aqui era um subconjunto manual da outra.
//
// SE PRECISAR DO COMPORTAMENTO DE NOVO: não republique. A `sincronizar-suite` já regrava o
// histórico do processo na rodada seguinte. Só volte a isto se precisar forçar UM processo
// fora do ciclo normal.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUITE_BASE =
  "https://suite.prod.papel-zero.suite.ce.gov.br/process/public-history"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
)

// ============================================================
// EXTRAI A SIGLA DA UNIDADE A PARTIR DO STATUS DO SUITE
// ============================================================

function extrairSigla(status: string) {
  if (!status) return "N/D"

  if (status.includes("/")) {
    const partes = status.split("/")
    return partes[partes.length - 1].trim().toUpperCase()
  }

  return status.trim().toUpperCase()
}


// ============================================================
// NORMALIZA O NUP PARA CONSULTA NO SUITE
// Exemplo:
// 22001.104599/2025-49
// ↓
// 22001104599202549
// ============================================================

function normalizarNup(nup: unknown) {
  const numero = String(nup ?? "").replace(/\D/g, "")
  return numero || null
}


// ============================================================
// GERA CHAVE ÚNICA DETERMINÍSTICA PARA O EVENTO
// ============================================================

async function gerarChaveEvento(nup: string, evento: any) {

  const material = JSON.stringify({
    nup,
    name: evento?.name ?? null,
    status: evento?.status ?? null,
    date: evento?.date ?? null,
    capacity: evento?.capacity ?? null,
    permanency: evento?.permanency ?? null,
    external_system_abbreviation:
      evento?.external_system_abbreviation ?? null,
  })

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  )

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}


// ============================================================
// CONSULTA UM ÚNICO PROCESSO NO SUITE
// ============================================================

async function consultarSuite(nup: string) {

  const numero = normalizarNup(nup)

  if (!numero) {
    return {
      ok: false,
      erro: "NUP inválido.",
      history: [],
    }
  }

  const url = `${SUITE_BASE}/${numero}`

  try {

    const response = await fetch(url)

    const texto = await response.text()

    if (!response.ok) {

      return {
        ok: false,
        status_http: response.status,
        erro: `SUITE retornou HTTP ${response.status}`,
        resposta: texto.substring(0, 1000),
        history: [],
      }
    }

    let json: any

    try {
      json = JSON.parse(texto)
    } catch {

      return {
        ok: false,
        status_http: response.status,
        erro: "Resposta do SUITE não é JSON válido.",
        resposta: texto.substring(0, 1000),
        history: [],
      }
    }

    const history = Array.isArray(json?.history)
      ? json.history
      : []

    history.sort(
      (a: any, b: any) =>
        new Date(a?.date).getTime() -
        new Date(b?.date).getTime(),
    )

    return {
      ok: true,
      status_http: response.status,
      history,
    }

  } catch (error) {

    return {
      ok: false,
      erro: error instanceof Error
        ? error.message
        : String(error),
      history: [],
    }
  }
}


// ============================================================
// LOCALIZA O PROCESSO NO BANCO
// ============================================================

async function localizarProcesso(nup: string) {

  const { data, error } = await supabase
    .from("processos")
    .select("id, processo")
    .eq("processo", nup)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erro ao localizar processo: ${error.message}`,
    )
  }

  return data
}


// ============================================================
// SALVA OS EVENTOS NO BANCO
// ============================================================

async function salvarHistorico(
  processoId: string,
  nup: string,
  history: any[],
) {

  if (!Array.isArray(history) || history.length === 0) {
    return {
      encontrados: 0,
      inseridos: 0,
      existentes: 0,
    }
  }

  // ----------------------------------------------------------
  // GERA AS CHAVES DOS EVENTOS
  // ----------------------------------------------------------

  const eventosPreparados = []

  for (let index = 0; index < history.length; index++) {

    const evento = history[index]

    const chave = await gerarChaveEvento(
      nup,
      evento,
    )

    eventosPreparados.push({
      processo_id: processoId,
      nup,
      ordem_evento: index,

      nome: evento?.name ?? null,

      status: evento?.status ?? null,

      unidade_sigla:
        extrairSigla(evento?.status ?? ""),

      capacity:
        evento?.capacity === null ||
        evento?.capacity === undefined
          ? null
          : Number(evento.capacity),

      data_evento:
        evento?.date ?? null,

      permanency:
        evento?.permanency === null ||
        evento?.permanency === undefined
          ? null
          : Number(evento.permanency),

      dados_brutos: evento,

      chave_evento: chave,

      sincronizado_em:
        new Date().toISOString(),
    })
  }


  // ----------------------------------------------------------
  // VERIFICA QUAIS EVENTOS JÁ EXISTEM
  // ----------------------------------------------------------

  const chaves = eventosPreparados.map(
    (evento) => evento.chave_evento,
  )

  const { data: existentes, error } =
    await supabase
      .from("historico_suite_eventos")
      .select("chave_evento")
      .in("chave_evento", chaves)

  if (error) {

    throw new Error(
      `Erro ao verificar eventos existentes: ${error.message}`,
    )
  }


  const conjuntoExistentes = new Set(
    (existentes || []).map(
      (row: any) => row.chave_evento,
    ),
  )


  // ----------------------------------------------------------
  // SEPARA NOVOS DE EXISTENTES
  // ----------------------------------------------------------

  const novos = eventosPreparados.filter(
    (evento) =>
      !conjuntoExistentes.has(
        evento.chave_evento,
      ),
  )


  // ----------------------------------------------------------
  // INSERE SOMENTE OS NOVOS
  // ----------------------------------------------------------

  if (novos.length > 0) {

    const { error: erroInsert } =
      await supabase
        .from("historico_suite_eventos")
        .insert(novos)

    if (erroInsert) {

      throw new Error(
        `Erro ao inserir histórico: ${erroInsert.message}`,
      )
    }
  }


  return {
    encontrados: eventosPreparados.length,
    inseridos: novos.length,
    existentes: eventosPreparados.length - novos.length,
  }
}


// ============================================================
// HANDLER
// ============================================================

serve(async (req) => {

  // ==========================================================
  // AUTENTICAÇÃO
  // ==========================================================

  const secret = req.headers.get(
    "x-sync-secret",
  )

  const expectedSecret =
    Deno.env.get("SYNC_SECRET")

  if (
    !secret ||
    !expectedSecret ||
    secret !== expectedSecret
  ) {

    return new Response(
      JSON.stringify({
        ok: false,
        erro: "não autorizado",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }


  // ==========================================================
  // BODY
  // ==========================================================

  let body: any = {}

  try {

    body = await req.json()

  } catch {

    body = {}

  }


  // ==========================================================
  // NUP
  // ==========================================================

  const nup = String(
    body?.nup ?? "",
  ).trim()


  if (!nup) {

    return new Response(
      JSON.stringify({
        ok: false,
        erro:
          "Informe o NUP no body. Exemplo: 22001.104599/2025-49",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }


  // ==========================================================
  // LOCALIZA PROCESSO
  // ==========================================================

  let processo

  try {

    processo = await localizarProcesso(nup)

  } catch (error) {

    return new Response(
      JSON.stringify({
        ok: false,
        erro: error instanceof Error
          ? error.message
          : String(error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }


  if (!processo) {

    return new Response(
      JSON.stringify({
        ok: false,
        erro:
          `Processo ${nup} não encontrado na tabela processos.`,
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }


  // ==========================================================
  // CONSULTA SUITE
  // ==========================================================

  const consulta = await consultarSuite(nup)


  if (!consulta.ok) {

    return new Response(
      JSON.stringify({
        ok: false,
        nup,
        processo_id: processo.id,
        status_http:
          consulta.status_http ?? null,
        erro:
          consulta.erro ??
          "Falha ao consultar SUITE.",
        resposta:
          consulta.resposta ?? null,
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }


  // ==========================================================
  // SALVA HISTÓRICO
  // ==========================================================

  let resultadoGravacao

  try {

    resultadoGravacao =
      await salvarHistorico(
        processo.id,
        nup,
        consulta.history,
      )

  } catch (error) {

    return new Response(
      JSON.stringify({
        ok: false,
        nup,
        processo_id: processo.id,
        erro:
          error instanceof Error
            ? error.message
            : String(error),
        eventos_encontrados:
          consulta.history.length,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }


  // ==========================================================
  // MONTA RESUMO DOS EVENTOS
  // ==========================================================

  const eventos = consulta.history.map(
    (evento: any, index: number) => ({
      ordem: index,

      data:
        evento?.date ?? null,

      nome:
        evento?.name ?? null,

      status:
        evento?.status ?? null,

      unidade:
        extrairSigla(
          evento?.status ?? "",
        ),

      permanency:
        evento?.permanency ?? null,

      capacity:
        evento?.capacity ?? null,
    }),
  )


  // ==========================================================
  // RESPOSTA
  // ==========================================================

  return new Response(
    JSON.stringify(
      {
        ok: true,

        nup,

        processo_id:
          processo.id,

        status_http:
          consulta.status_http,

        total_eventos:
          consulta.history.length,

        eventos_novos:
          resultadoGravacao.inseridos,

        eventos_ja_existentes:
          resultadoGravacao.existentes,

        eventos,

        observacao:
          "Consulta exclusiva do NUP. Nenhum campo da tabela processos foi alterado.",
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
})