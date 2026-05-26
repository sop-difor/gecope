require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// 1. Configuração e Validação Crítica
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const EVO_API_URL = process.env.EVO_API_URL;
const EVO_API_KEY = process.env.EVO_API_KEY;
const EVO_INSTANCE = process.env.EVO_INSTANCE;

// Valida se TODAS as variáveis necessárias estão presentes
if (!SUPABASE_URL || !SUPABASE_KEY || !EVO_API_URL || !EVO_API_KEY || !EVO_INSTANCE) {
    console.error('ERRO CRÍTICO: Variáveis de ambiente faltando.');
    console.error(`- SUPABASE_URL: ${!!SUPABASE_URL}`);
    console.error(`- SUPABASE_KEY: ${!!SUPABASE_KEY}`);
    console.error(`- EVO_API_URL: ${!!EVO_API_URL}`);
    console.error(`- EVO_API_KEY: ${!!EVO_API_KEY}`);
    console.error(`- EVO_INSTANCE: ${!!EVO_INSTANCE}`);
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '2000', 10);

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
    console.log(`DEBUG: Enviando job ${job.id} para URL: ${url}`);

    const body = { number: job.number, text: job.text, delay: 500, linkPreview: false };
    
    const res = await fetch(url, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            'apikey': EVO_API_KEY 
        },
        body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => null);
    
    if (!res.ok) {
        const msg = data?.response?.message || data?.error || `Status HTTP ${res.status}`;
        throw new Error(String(msg));
    }
    return data;
}

async function processJob(job) {
    let result;
    let success = false;
    let lastError;

    // Tenta enviar até 3 vezes caso a rede falhe
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
            result = await sendToEvolution(job);
            success = true;
            break; // Se deu certo, sai do loop imediatamente
        } catch (err) {
            lastError = err;
            console.log(`Aviso: Tentativa ${tentativa} falhou para o job ${job.id}...`);
            if (tentativa < 3) await new Promise(r => setTimeout(r, 2000)); // Espera 2s
        }
    }

    // Se depois das 3 tentativas ele conseguiu:
    if (success) {
        await sb.from('whatsapp_jobs')
            .update({ status: 'success', finished_at: new Date().toISOString(), result })
            .eq('id', job.id);
        console.log(`Sucesso: Job ${job.id} enviado.`);
    } 
    // Se falhou todas as 3 vezes:
    else {
        console.error(`Erro definitivo ao processar job ${job.id}:`, lastError.message);
        await sb.from('whatsapp_jobs')
            .update({ status: 'failed', finished_at: new Date().toISOString(), result: { error: lastError.message } })
            .eq('id', job.id);
    }
}

async function mainLoop() {
    console.log("Worker iniciado e aguardando jobs...");
    while (true) {
        try {
            const job = await claimJob();
            if (job) {
                await processJob(job);
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
        } catch (error) {
            console.error("--- ERRO NO LOOP PRINCIPAL ---");
            console.error("Mensagem:", error.message);
            console.error("Causa real:", error.cause); // <-- ESTA É A LINHA MÁGICA
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

mainLoop().catch(err => { console.error('Worker fatal:', err); process.exit(1); });