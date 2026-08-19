require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVO_API_URL = process.env.EVO_API_URL;
const EVO_API_KEY = process.env.EVO_API_KEY;
const EVO_INSTANCE = process.env.EVO_INSTANCE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !EVO_API_URL || !EVO_API_KEY || !EVO_INSTANCE) {
    console.error('ERRO CRÍTICO: Variáveis de ambiente faltando.');
    console.error(`- SUPABASE_URL: ${!!SUPABASE_URL}`);
    console.error(`- SUPABASE_SERVICE_ROLE_KEY: ${!!SUPABASE_SERVICE_ROLE_KEY}`);
    console.error(`- EVO_API_URL: ${!!EVO_API_URL}`);
    console.error(`- EVO_API_KEY: ${!!EVO_API_KEY}`);
    console.error(`- EVO_INSTANCE: ${!!EVO_INSTANCE}`);
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '2000', 10);
const STALE_PROCESSING_MS = parseInt(process.env.STALE_PROCESSING_MS || '300000', 10); // 5 min

let shuttingDown = false;
process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT', () => { shuttingDown = true; });

// Se o worker morrer no meio de um job (ex.: container reiniciado), o job fica preso em
// 'processing' para sempre — devolve para 'pending' qualquer job travado há mais de
// STALE_PROCESSING_MS antes de tentar reivindicar um novo.
async function reclaimStaleJobs() {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    const { data, error } = await sb
        .from('whatsapp_jobs')
        .update({ status: 'pending' })
        .eq('status', 'processing')
        .lt('started_at', staleBefore)
        .select('id');

    if (error) {
        console.error('[reclaim] erro ao recuperar jobs travados:', error.message);
        return;
    }
    if (data && data.length > 0) {
        console.log(`[reclaim] ${data.length} job(s) travado(s) em 'processing' devolvido(s) para 'pending'.`);
    }
}

// Cobre o caso em que o cliente cria o log ('processando') mas a requisição para
// /api/whatsapp/send nunca chega a completar (rede caiu, timeout) — nenhum whatsapp_jobs é
// criado, então reclaimStaleJobs() nunca vê esse registro, e como whatsapp_logs.UPDATE é
// admin-only (RLS), o cliente também não consegue mais marcar a falha ele mesmo. Sem esta
// varredura, esses logs ficariam presos em 'processando' para sempre (é a mesma classe de
// bug já limpa uma vez, manualmente, em auditoria de 2026-08).
async function reclaimOrphanLogs() {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    const { data: staleLogs, error: staleError } = await sb
        .from('whatsapp_logs')
        .select('id')
        .eq('status', 'processando')
        .lt('created_at', staleBefore);

    if (staleError) {
        console.error('[reclaim-logs] erro ao buscar logs travados:', staleError.message);
        return;
    }
    if (!staleLogs || staleLogs.length === 0) return;

    const staleIds = staleLogs.map(l => l.id);
    const { data: linkedJobs, error: jobsError } = await sb
        .from('whatsapp_jobs')
        .select('log_id')
        .in('log_id', staleIds);

    if (jobsError) {
        console.error('[reclaim-logs] erro ao checar jobs vinculados:', jobsError.message);
        return;
    }

    const linkedIds = new Set((linkedJobs || []).map(j => j.log_id));
    const orphanIds = staleIds.filter(id => !linkedIds.has(id));
    if (orphanIds.length === 0) return;

    const { error: updateError } = await sb
        .from('whatsapp_logs')
        .update({ status: 'falha', erro_detalhe: 'Requisição de envio nunca chegou ao servidor (falha de rede no cliente) — encerrado pela varredura periódica.' })
        .in('id', orphanIds);

    if (updateError) {
        console.error('[reclaim-logs] erro ao marcar logs órfãos como falha:', updateError.message);
        return;
    }
    console.log(`[reclaim-logs] ${orphanIds.length} log(s) órfão(s) (sem job correspondente) encerrado(s) como 'falha'.`);
}

async function claimJob() {
    const { data: jobs, error } = await sb
        .from('whatsapp_jobs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

    if (error) throw error;
    if (!jobs || jobs.length === 0) return null;
    const job = jobs[0];

    const { data: updated, error: updErr } = await sb
        .from('whatsapp_jobs')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select()
        .single();

    if (updErr || !updated) return null;
    return updated;
}

async function sendToEvolution(job) {
    const url = `${EVO_API_URL}/message/sendText/${EVO_INSTANCE}`;
    const body = { number: job.number, text: job.text, delay: 500, linkPreview: false };

    // Sem timeout, se a Evolution API aceitar a conexão e nunca responder, o worker fica
    // preso indefinidamente neste job — o loop principal para de rodar `reclaimStaleJobs`
    // e de pegar jobs novos, travando a fila inteira até um restart manual.
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': EVO_API_KEY
        },
        body: JSON.stringify(body),
        timeout: 15000
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const msg = data?.response?.message || data?.error || `Status HTTP ${res.status}`;
        throw new Error(String(msg));
    }
    return data;
}

// Grava o status final em whatsapp_jobs com algumas retentativas curtas. Se esta escrita
// falhar silenciosamente (o supabase-js não lança exceção em erro, só retorna {error}), o
// job fica preso em 'processing' para sempre mesmo tendo sido enviado com sucesso — o
// `reclaimStaleJobs` eventualmente o devolve para 'pending' e ele é REENVIADO, duplicando
// a mensagem no WhatsApp do destinatário. As retentativas cobrem falhas transitórias de
// rede; se mesmo assim falhar, loga com destaque para investigação manual.
async function finalizeJobStatus(jobId, fields) {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
        const { error } = await sb.from('whatsapp_jobs').update(fields).eq('id', jobId);
        if (!error) return true;
        console.error(`[finalize] tentativa ${tentativa} falhou ao gravar status final do job ${jobId}:`, error.message);
        if (tentativa < 3) await new Promise(r => setTimeout(r, 1000));
    }
    console.error(`[finalize] FALHA DEFINITIVA ao gravar status final do job ${jobId} — ele pode ser reenviado por engano quando reclamado como travado.`);
    return false;
}

// Grava o resultado final em whatsapp_logs (quando o job tem log_id) — é o worker, não o
// navegador, quem decide o resultado definitivo, o que sobrevive a aba fechada, queda de
// conexão, etc.
async function updateLinkedLog(job, success, result, lastError) {
    if (!job.log_id) return;

    const update = success
        ? { status: 'sucesso', erro_detalhe: `ID:${result?.key?.id || result?.id || ''}` }
        : { status: 'falha', erro_detalhe: `Erro: ${lastError?.message || 'Desconhecido'}` };

    const { error } = await sb.from('whatsapp_logs').update(update).eq('id', job.log_id);
    if (error) {
        console.error(`[log] falha ao atualizar whatsapp_logs.id=${job.log_id}:`, error.message);
    }
}

async function processJob(job) {
    let result;
    let success = false;
    let lastError;
    let attempts = job.attempts || 0;

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
        attempts += 1;
        await sb.from('whatsapp_jobs').update({ attempts }).eq('id', job.id);

        try {
            result = await sendToEvolution(job);
            success = true;
            break;
        } catch (err) {
            lastError = err;
            console.log(`Aviso: Tentativa ${tentativa} falhou para o job ${job.id}...`);
            if (tentativa < 3) await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (success) {
        await finalizeJobStatus(job.id, { status: 'success', finished_at: new Date().toISOString(), result });
        console.log(`Sucesso: Job ${job.id} enviado.`);
    } else {
        console.error(`Erro definitivo ao processar job ${job.id}:`, lastError.message);
        await finalizeJobStatus(job.id, { status: 'failed', finished_at: new Date().toISOString(), result: { error: lastError.message } });
    }

    await updateLinkedLog(job, success, result, lastError);
}

// reclaimOrphanLogs faz um scan de tabela (sem índice por status+created_at dedicado) — não
// vale rodar a cada volta do loop (a cada ~POLL_INTERVAL, inclusive quando há fila cheia).
// Uma vez por minuto já cobre bem o cenário raro que ela existe para pegar.
const ORPHAN_SWEEP_INTERVAL_MS = 60000;
let lastOrphanSweep = 0;

async function mainLoop() {
    console.log('Worker iniciado e aguardando jobs...');
    while (!shuttingDown) {
        try {
            await reclaimStaleJobs();
            if (Date.now() - lastOrphanSweep >= ORPHAN_SWEEP_INTERVAL_MS) {
                lastOrphanSweep = Date.now();
                await reclaimOrphanLogs();
            }
            const job = await claimJob();
            if (job) {
                await processJob(job);
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
        } catch (error) {
            console.error('--- ERRO NO LOOP PRINCIPAL ---');
            console.error('Mensagem:', error.message);
            console.error('Causa real:', error.cause);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    console.log('Worker encerrado (shutdown gracioso).');
    process.exit(0);
}

mainLoop().catch(err => { console.error('Worker fatal:', err); process.exit(1); });
