// supabase/functions/sincronizar-suite/index.ts
//
// ATENÇÃO: este arquivo é a versão REAL publicada no servidor, baixada em 22/09/2026.
// A versão que estava aqui antes era de 06/08/2026 e NÃO escrevia `historico_suite_eventos`
// — ela induziu a erro pelo menos duas análises anteriores (ver o aviso em
// docs/painel-fiscais/proposta-tempo-fiscal-suite.md, linhas ~207-209). Se for editar,
// baixe a versão publicada de novo antes: `supabase functions download sincronizar-suite`.
//
// Job central de sincronização com o SUITE. Roda 1x por rodada (disparado pelo pg_cron),
// consulta o SUITE para cada processo, aplica as regras de status e grava sigla + data de
// chegada + status na tabela `processos`, além do histórico completo de eventos em
// `historico_suite_eventos` (deduplicado por `chave_evento`).
//
// Processos ARQUIVADOS não são ignorados para sempre: são rechecados 1x/dia (campo
// `arquivado_check_em`) só para detectar se voltaram a tramitar no SUITE. Quando isso
// acontece, o status volta ao valor salvo em `status_pre_arquivamento`.
//
// -> 1 invocação de Edge Function por rodada (as consultas ao SUITE são fetch de saída = egress).
//
// Deploy:  supabase functions deploy sincronizar-suite --no-verify-jwt
// Secret:  SYNC_SECRET  (supabase secrets set SYNC_SECRET=...)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente.
//
// LIMITE CONHECIDO (revisão 22/09/2026, não corrigido por decisão): as regras de
// `decidirNovoStatus` só ENTRAM em AGUAR. ANÁLISE / AGUAR. REANÁLISE; não existe regra de
// saída. Um processo que entra em AGUAR. ANÁLISE e depois deixa a GECOPE mantém esse status
// indefinidamente, enquanto a coluna `suite` passa a mostrar a unidade nova (GEFOE, etc.).
// Ver docs/revisoes/2026-09-22-processos.md, seção "O que ficou de fora".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUITE_BASE =
  "https://suite.prod.papel-zero.suite.ce.gov.br/process/public-history"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
)

// ---------- helpers ----------

const extrairSigla = (status: string) => {
  if (!status) return "N/D"

  if (status.includes("/")) {
    const partes = status.split("/")
    return partes[partes.length - 1].trim().toUpperCase()
  }

  return status.toUpperCase()
}

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

  const bytes = new TextEncoder().encode(material)
  const digest = await crypto.subtle.digest("SHA-256", bytes)

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function normalizarNumero(valor: unknown) {
  const numero = String(valor ?? "").replace(/\D/g, "")
  return numero || null
}

// ---------- consulta SUITE ----------

async function consultarProcesso(numero: string) {
  const numero_limpo = normalizarNumero(numero)

  if (!numero_limpo) {
    return { sucesso: false }
  }

  try {
    const res = await fetch(`${SUITE_BASE}/${numero_limpo}`)

    if (!res.ok) {
      return { sucesso: false }
    }

    const json = await res.json()

    const historia = Array.isArray(json.history)
      ? json.history
      : []

    if (historia.length === 0) {
      return { sucesso: false }
    }

    historia.sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime(),
    )

    const recente = historia[0]

    const sigla = extrairSigla(recente.status)

    let dataChegadaReal = recente.date

    for (let i = 1; i < historia.length; i++) {
      if (extrairSigla(historia[i].status) === sigla) {
        dataChegadaReal = historia[i].date
      } else {
        break
      }
    }

    return {
      sucesso: true,
      sigla,
      data_chegada_unidade: dataChegadaReal,
      status_full: recente.status,
      historia,
    }
  } catch (_e) {
    return {
      sucesso: false,
    }
  }
}

// ---------- histórico SUITE ----------

async function salvarHistoricoSuite(
  processoId: string,
  nup: string,
  historia: any[],
) {
  if (!Array.isArray(historia) || historia.length === 0) {
    return 0
  }

  const chaves = await Promise.all(
    historia.map((evento: any) =>
      gerarChaveEvento(nup, evento),
    ),
  )

  const {
    data: existentes,
    error: erroExistentes,
  } = await supabase
    .from("historico_suite_eventos")
    .select("chave_evento")
    .eq("processo_id", processoId)

  if (erroExistentes) {
    console.error(
      `[HISTORICO] Erro ao consultar eventos existentes do processo ${nup}:`,
      erroExistentes.message,
    )

    return 0
  }

  const conjuntoExistentes = new Set(
    (existentes || []).map(
      (row: any) => row.chave_evento,
    ),
  )

  const novos = historia
    .map((evento: any, index: number) => ({
      evento,
      index,
    }))
    .filter(
      ({ index }) =>
        !conjuntoExistentes.has(chaves[index]),
    )
    .map(({ evento, index }) => ({
      processo_id: processoId,
      nup,

      ordem_evento: index,

      nome: evento?.name ?? null,

      status: evento?.status ?? null,

      unidade_sigla: extrairSigla(
        evento?.status ?? "",
      ),

      capacity:
        evento?.capacity === null ||
        evento?.capacity === undefined
          ? null
          : Number(evento.capacity),

      data_evento: evento?.date ?? null,

      permanency:
        evento?.permanency === null ||
        evento?.permanency === undefined
          ? null
          : Number(evento.permanency),

      dados_brutos: evento,

      chave_evento: chaves[index],

      sincronizado_em:
        new Date().toISOString(),
    }))

  if (novos.length === 0) {
    return 0
  }

  const { error } = await supabase
    .from("historico_suite_eventos")
    .insert(novos)

  if (error) {
    console.error(
      `[HISTORICO] Erro ao inserir ${novos.length} eventos do processo ${nup}:`,
      error.message,
    )

    return 0
  }

  return novos.length
}

// ---------- regras de negócio ----------

function decidirNovoStatus(
  proc: any,
  siglaSuite: string,
): string | null {
  const statusGecope = String(
    proc.status || "",
  )
    .toUpperCase()
    .trim()

  const analista = String(
    proc.analista || "",
  )
    .trim()
    .toUpperCase()

  const isAnalistaEspecial = analista
    ? ["N", "W", "H", "P", "F", "A"].includes(
        analista.charAt(0),
      )
    : false

  // Proteção:
  // processo criado nos últimos 3 minutos
  // não sofre mudança automática.
  if (proc.created_at) {
    const diff =
      Date.now() -
      new Date(proc.created_at).getTime()

    if (
      diff >= 0 &&
      diff < 3 * 60 * 1000
    ) {
      return null
    }
  }

  // Arquivamento — prioridade máxima.
  if (siglaSuite === "ARQUIVADO") {
    return "ARQUIVADO"
  }

  // Aprovação automática.
  if (
    statusGecope === "AGUAR. APROVAÇÃO" &&
    isAnalistaEspecial &&
    siglaSuite !== "DIFOR" &&
    siglaSuite !== "GECOPE" &&
    siglaSuite !== ""
  ) {
    return "APROVADO"
  }

  // Entrada para reanálise.
  if (
    (
      statusGecope === "REANÁLISE FISCAL" ||
      statusGecope ===
        "DEVOLVIDO P/ REANÁLISE FISCAL"
    ) &&
    isAnalistaEspecial &&
    siglaSuite === "GECOPE"
  ) {
    return "AGUAR. REANÁLISE"
  }

  // Entrada para análise.
  if (
    statusGecope === "ANÁLISE FISCAL" &&
    !isAnalistaEspecial &&
    siglaSuite === "GECOPE"
  ) {
    return "AGUAR. ANÁLISE"
  }

  // Aprovado que retorna à GECOPE.
  if (
    statusGecope === "APROVADO" &&
    siglaSuite === "GECOPE"
  ) {
    return "DILIGÊNCIA"
  }

  return null
}

// ---------- pool de concorrência ----------

async function emLotes<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
) {
  for (
    let i = 0;
    i < items.length;
    i += size
  ) {
    await Promise.all(
      items
        .slice(i, i + size)
        .map(fn),
    )
  }
}

// ---------- handler ----------

serve(async (req) => {
  // Autenticação por segredo compartilhado.
  const secret =
    req.headers.get("x-sync-secret")

  if (
    !secret ||
    secret !== Deno.env.get("SYNC_SECRET")
  ) {
    return new Response(
      JSON.stringify({
        erro: "não autorizado",
      }),
      {
        status: 401,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    )
  }

  const inicio = Date.now()

  // Carrega os processos.
  const {
    data: processos,
    error,
  } = await supabase
    .from("processos")
    .select(
      "id, processo, status, suite, analista, created_at, suite_data_chegada, status_pre_arquivamento, arquivado_check_em",
    )

  if (error) {
    return new Response(
      JSON.stringify({
        erro: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    )
  }

  const UM_DIA_MS =
    24 * 60 * 60 * 1000

  const agora = Date.now()

  // Processos arquivados são consultados
  // apenas uma vez por dia.
  const alvos = (
    processos || []
  ).filter((p) => {
    const isArquivado =
      String(p.status || "")
        .toUpperCase()
        .trim() === "ARQUIVADO"

    if (!isArquivado) {
      return true
    }

    if (!p.arquivado_check_em) {
      return true
    }

    return (
      agora -
        new Date(
          p.arquivado_check_em,
        ).getTime() >=
      UM_DIA_MS
    )
  })

  let atualizados = 0
  let semMudanca = 0
  let naoEncontrados = 0
  let reativados = 0
  let eventosGravados = 0

  // Processos que tiveram consulta SUITE
  // bem-sucedida nesta rodada e terão
  // tempo_suite recalculado.
  const processosParaAtualizarTempo =
    new Set<string>()

  // ---------- sincronização ----------

  await emLotes(
    alvos,
    6,
    async (p) => {
      const statusAtual =
        String(p.status || "")
          .toUpperCase()
          .trim()

      const eraArquivado =
        statusAtual === "ARQUIVADO"

      const info =
        await consultarProcesso(
          p.processo,
        )

      if (!info.sucesso) {
        naoEncontrados++

        // Para arquivados, registra a tentativa
        // para não consultar novamente a cada hora.
        if (eraArquivado) {
          await supabase
            .from("processos")
            .update({
              arquivado_check_em:
                new Date().toISOString(),
            })
            .eq("id", p.id)
        }

        return
      }

      // Só entra para atualização de tempo
      // depois de uma consulta SUITE bem-sucedida.
      processosParaAtualizarTempo.add(
        p.id,
      )

      // Grava o histórico completo uma única vez.
      eventosGravados +=
        await salvarHistoricoSuite(
          p.id,
          String(p.processo),
          info.historia || [],
        )

      const siglaSuite =
        String(info.sigla || "")
          .toUpperCase()
          .trim()

      const patch: Record<
        string,
        any
      > = {}

      // Atualiza a sigla atual.
      if (
        siglaSuite &&
        siglaSuite !==
          String(p.suite || "")
            .toUpperCase()
            .trim()
      ) {
        patch.suite = siglaSuite
      }

      // Atualiza a data de chegada.
      if (
        info.data_chegada_unidade &&
        info.data_chegada_unidade !==
          p.suite_data_chegada
      ) {
        patch.suite_data_chegada =
          info.data_chegada_unidade
      }

      // ---------- arquivamento ----------

      if (eraArquivado) {
        patch.arquivado_check_em =
          new Date().toISOString()

        if (
          siglaSuite !== "ARQUIVADO"
        ) {
          // Desarquivado no SUITE.
          patch.status =
            p.status_pre_arquivamento ||
            "EM ANÁLISE"

          patch.status_pre_arquivamento =
            null

          patch.atualizado_por =
            "AUTOMAÇÃO SUITE"

          patch.ultima_atualizacao =
            new Date().toISOString()

          reativados++
        }
      } else {
        // ---------- regras de status ----------

        const novo =
          decidirNovoStatus(
            p,
            siglaSuite,
          )

        if (
          novo &&
          novo !== statusAtual
        ) {
          patch.status = novo

          patch.atualizado_por =
            "AUTOMAÇÃO SUITE"

          patch.ultima_atualizacao =
            new Date().toISOString()

          if (
            novo === "ARQUIVADO"
          ) {
            patch.status_pre_arquivamento =
              p.status
          }
        }
      }

      // Nenhuma alteração nos campos
      // principais do processo.
      if (
        Object.keys(patch).length === 0
      ) {
        semMudanca++
        return
      }

      const {
        error: upErr,
      } = await supabase
        .from("processos")
        .update(patch)
        .eq("id", p.id)

      if (!upErr) {
        atualizados++
      } else {
        console.error(
          `[PROCESSO] Erro ao atualizar ${p.processo}:`,
          upErr.message,
        )
      }
    },
  )

  // ============================================================
  // ATUALIZAÇÃO DO TEMPO SUITE
  //
  // Usa a função PostgreSQL que já existe:
  //
  // atualizar_tempo_suite_processo(uuid)
  //
  // Não consulta o SUITE novamente.
  // ============================================================

  let temposAtualizados = 0
  let errosTempo = 0

  await emLotes(
    Array.from(
      processosParaAtualizarTempo,
    ),
    10,
    async (processoId) => {
      try {
        const {
          error,
        } = await supabase.rpc(
          "atualizar_tempo_suite_processo",
          {
            p_processo_id:
              processoId,
          },
        )

        if (error) {
          errosTempo++

          console.error(
            "[TEMPO SUITE] Erro ao atualizar tempo_suite:",
            processoId,
            error.message,
          )

          return
        }

        temposAtualizados++
      } catch (e) {
        errosTempo++

        console.error(
          "[TEMPO SUITE] Exceção ao atualizar tempo_suite:",
          processoId,
          e,
        )
      }
    },
  )

  // ---------- resumo ----------

  const resumo = {
    ok: true,

    total_processados:
      alvos.length,

    atualizados,

    reativados,

    sem_mudanca:
      semMudanca,

    nao_encontrados:
      naoEncontrados,

    eventos_historico_gravados:
      eventosGravados,

    tempos_atualizados:
      temposAtualizados,

    erros_tempo:
      errosTempo,

    duracao_ms:
      Date.now() - inicio,
  }

  console.log(
    "[sincronizar-suite]",
    JSON.stringify(resumo),
  )

  return new Response(
    JSON.stringify(resumo),
    {
      headers: {
        "Content-Type":
          "application/json",
      },
      status: 200,
    },
  )
})