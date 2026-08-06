// supabase/functions/sincronizar-suite/index.ts
//
// Job central de sincronização com o SUITE. Roda 1x por rodada (disparado pelo pg_cron),
// consulta o SUITE internamente para cada processo ativo, aplica as regras de negócio do
// StatusSync e grava sigla + data de chegada + status na tabela `processos`.
//
// Processos ARQUIVADOS não são ignorados para sempre: são rechecados 1x/dia (campo
// `arquivado_check_em`) só para detectar se voltaram a tramitar no SUITE. Quando isso
// acontece, o status volta ao valor salvo em `status_pre_arquivamento` (o que o processo
// tinha antes de ser arquivado) — ver bloco `eraArquivado` no handler.
//
// -> 1 invocação de Edge Function por rodada (as consultas ao SUITE são fetch de saída = egress).
//
// Deploy sugerido:  supabase functions deploy sincronizar-suite --no-verify-jwt
// Secret necessário: SYNC_SECRET  (supabase secrets set SYNC_SECRET=...)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUITE_BASE = "https://suite.prod.papel-zero.suite.ce.gov.br/process/public-history"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

// ---------- helpers ----------
const extrairSigla = (status: string) => {
  if (!status) return 'N/D';
  if (status.includes('/')) {
    const partes = status.split('/');
    return partes[partes.length - 1].trim().toUpperCase();
  }
  return status.toUpperCase();
};

// Consulta UM processo no SUITE (mesma lógica da sua consultar-suite)
async function consultarProcesso(numero: string) {
  const numero_limpo = String(numero).replace(/\D/g, '')
  try {
    const res = await fetch(`${SUITE_BASE}/${numero_limpo}`)
    if (!res.ok) return { sucesso: false }
    const json = await res.json()
    const historia = json.history || []
    if (!Array.isArray(historia) || historia.length === 0) return { sucesso: false }

    historia.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const recente = historia[0]
    const sigla = extrairSigla(recente.status)

    let dataChegadaReal = recente.date
    for (let i = 1; i < historia.length; i++) {
      if (extrairSigla(historia[i].status) === sigla) dataChegadaReal = historia[i].date
      else break
    }
    return { sucesso: true, sigla, data_chegada_unidade: dataChegadaReal, status_full: recente.status }
  } catch (_e) {
    return { sucesso: false }
  }
}

// Regras de negócio — porte FIEL do window.StatusSync.verificarEAtualizarStatus
function decidirNovoStatus(proc: any, siglaSuite: string): string | null {
  const statusGecope = String(proc.status || '').toUpperCase().trim()
  const analista = String(proc.analista || '').trim().toUpperCase()
  const isAnalistaEspecial = analista ? ["N", "W", "H", "P", "F", "A"].includes(analista.charAt(0)) : false

  // Proteção: processo criado nos últimos 3 minutos não sofre mudança automática
  if (proc.created_at) {
    const diff = Date.now() - new Date(proc.created_at).getTime()
    if (diff >= 0 && diff < 3 * 60 * 1000) return null
  }

  // REGRA 2: Arquivamento (prioridade máxima)
  if (siglaSuite === 'ARQUIVADO') return 'ARQUIVADO'
  // REGRA 1: Aprovação automática
  if (statusGecope === 'AGUAR. APROVAÇÃO' && isAnalistaEspecial &&
      siglaSuite !== 'DIFOR' && siglaSuite !== 'GECOPE' && siglaSuite !== '') return 'APROVADO'
  // REGRA 3: Entrada para reanálise
  if ((statusGecope === 'REANÁLISE FISCAL' || statusGecope === 'DEVOLVIDO P/ REANÁLISE FISCAL') &&
      isAnalistaEspecial && siglaSuite === 'GECOPE') return 'AGUAR. REANÁLISE'
  // REGRA 4: Entrada para análise
  if (statusGecope === 'ANÁLISE FISCAL' && !isAnalistaEspecial && siglaSuite === 'GECOPE') return 'AGUAR. ANÁLISE'
  // REGRA 5: Aprovado que retorna à GECOPE -> diligência
  if (statusGecope === 'APROVADO' && siglaSuite === 'GECOPE') return 'DILIGÊNCIA'

  return null
}

// Pool de concorrência (no máx. `size` fetches simultâneos ao SUITE)
async function emLotes<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

// ---------- handler ----------
serve(async (req) => {
  // Autenticação por segredo compartilhado (a função grava com service_role)
  const secret = req.headers.get('x-sync-secret')
  if (!secret || secret !== Deno.env.get('SYNC_SECRET')) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), { status: 401 })
  }

  const inicio = Date.now()

  // Carrega todos os processos. Os arquivados não são pulados por completo: são
  // checados no SUITE com frequência reduzida (1x/dia) só para detectar reativação.
  const { data: processos, error } = await supabase
    .from('processos')
    .select('id, processo, status, suite, analista, created_at, suite_data_chegada, status_pre_arquivamento, arquivado_check_em')

  if (error) {
    return new Response(JSON.stringify({ erro: error.message }), { status: 500 })
  }

  const UM_DIA_MS = 24 * 60 * 60 * 1000
  const agora = Date.now()

  const alvos = (processos || []).filter((p) => {
    const isArquivado = String(p.status || '').toUpperCase().trim() === 'ARQUIVADO'
    if (!isArquivado) return true
    // Arquivado: só entra na rodada se nunca foi checado, ou já passou 1 dia da última checagem
    if (!p.arquivado_check_em) return true
    return (agora - new Date(p.arquivado_check_em).getTime()) >= UM_DIA_MS
  })

  let atualizados = 0, semMudanca = 0, naoEncontrados = 0, reativados = 0

  await emLotes(alvos, 6, async (p) => {
    const statusAtual = String(p.status || '').toUpperCase().trim()
    const eraArquivado = statusAtual === 'ARQUIVADO'

    const info = await consultarProcesso(p.processo)
    if (!info.sucesso) {
      naoEncontrados++
      // Mesmo sem sucesso, marca a tentativa para não martelar o SUITE a cada rodada
      if (eraArquivado) {
        await supabase.from('processos').update({ arquivado_check_em: new Date().toISOString() }).eq('id', p.id)
      }
      return
    }

    const siglaSuite = String(info.sigla || '').toUpperCase().trim()
    const patch: Record<string, any> = {}

    // Sempre reflete sigla + data de chegada (é o que o painel exibe para todo processo)
    if (siglaSuite && siglaSuite !== String(p.suite || '').toUpperCase().trim()) {
      patch.suite = siglaSuite
    }
    if (info.data_chegada_unidade && info.data_chegada_unidade !== p.suite_data_chegada) {
      patch.suite_data_chegada = info.data_chegada_unidade
    }

    if (eraArquivado) {
      patch.arquivado_check_em = new Date().toISOString()

      if (siglaSuite !== 'ARQUIVADO') {
        // Desarquivado no SUITE -> volta pro status que o processo tinha antes de arquivar
        patch.status = p.status_pre_arquivamento || 'EM ANÁLISE'
        patch.status_pre_arquivamento = null
        patch.atualizado_por = 'AUTOMAÇÃO SUITE'
        patch.ultima_atualizacao = new Date().toISOString()
        reativados++
      }
    } else {
      // Regra de negócio: eventual mudança de status
      const novo = decidirNovoStatus(p, siglaSuite)
      if (novo && novo !== statusAtual) {
        patch.status = novo
        patch.atualizado_por = 'AUTOMAÇÃO SUITE'
        patch.ultima_atualizacao = new Date().toISOString()
        // Guarda de onde veio, para poder restaurar se for desarquivado depois
        if (novo === 'ARQUIVADO') {
          patch.status_pre_arquivamento = p.status
        }
      }
    }

    if (Object.keys(patch).length === 0) { semMudanca++; return }

    const { error: upErr } = await supabase.from('processos').update(patch).eq('id', p.id)
    if (!upErr) atualizados++
  })

  const resumo = {
    ok: true,
    total_processados: alvos.length,
    atualizados,
    reativados,
    sem_mudanca: semMudanca,
    nao_encontrados: naoEncontrados,
    duracao_ms: Date.now() - inicio,
  }
  console.log('[sincronizar-suite]', JSON.stringify(resumo))
  return new Response(JSON.stringify(resumo), {
    headers: { 'Content-Type': 'application/json' }, status: 200,
  })
})
