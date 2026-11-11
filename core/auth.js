// core/auth.js — autenticação (Supabase) e RBAC: cadastro, login, logout, papéis e permissões.
// Extraído de main.js (Fase 2 da reorganização modular).

/* --------------------------------------------------------------
   FUNES DE AUTENTICAO (SUPABASE)
-------------------------------------------------------------- */

/* --------------------------------------------------------------
   MENSAGENS DE AUTENTICAÇÃO EM PORTUGUÊS
   O Supabase Auth devolve as mensagens em inglês (ex.: "Password should contain at least
   one character of each: abc..., ABC..., 0123..., !@#..."), e elas iam direto para a tela.
   Aqui ficam as regras de senha mostradas ao usuário e a tradução dos erros. (11/11/2026)
-------------------------------------------------------------- */

const SENHA_TAMANHO_MINIMO = 8;
const REGRAS_SENHA = [
    { id: 'tamanho',   texto: `Ter pelo menos ${SENHA_TAMANHO_MINIMO} caracteres`, ok: s => s.length >= SENHA_TAMANHO_MINIMO },
    { id: 'minuscula', texto: 'Ter pelo menos uma letra minúscula (a-z)',          ok: s => /[a-z]/.test(s) },
    { id: 'maiuscula', texto: 'Ter pelo menos uma letra maiúscula (A-Z)',          ok: s => /[A-Z]/.test(s) },
    { id: 'numero',    texto: 'Ter pelo menos um número (0-9)',                    ok: s => /[0-9]/.test(s) },
    { id: 'simbolo',   texto: 'Ter pelo menos um símbolo, como ! @ # $ % & * ? -', ok: s => /[^A-Za-z0-9\s]/.test(s) }
];

// Lista as regras que a senha ainda não cumpre (vazia = senha aceita pelas regras do GECOPE).
function regrasSenhaPendentes(senha) {
    const s = String(senha || '');
    return REGRAS_SENHA.filter(r => !r.ok(s));
}

function _escHtmlAuth(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// HTML com o que falta na senha, para o SweetAlert. `pendentes` = saída de regrasSenhaPendentes.
function htmlRegrasSenha(pendentes, intro) {
    const itens = pendentes.map(r => `<li>${_escHtmlAuth(r.texto)}</li>`).join('');
    return `<div style="text-align:left">${intro || 'A senha escolhida não atende às regras de segurança. Ela precisa:'}` +
           `<ul style="margin:8px 0 8px 18px;padding:0">${itens}</ul>` +
           '<small style="color:#6b7280">Exemplo de senha válida: <b>Obra@2026</b> (não use este exemplo).</small></div>';
}

// Traduz um erro do Supabase Auth (ou de rede) para uma mensagem clara em português.
// Devolve { titulo, texto, html? }. `ctx.senha` permite dizer exatamente o que falta na senha.
function traduzirErroAuth(error, ctx = {}) {
    const msg = String((error && (error.message || error.msg || error.error_description)) || error || '');
    const code = String((error && (error.code || error.error_code)) || '');
    const m = msg.toLowerCase();

    // Senha fraca: falta tipo de caractere, tamanho ou aparece em vazamentos públicos.
    if (code === 'weak_password' || /password should|password must|weak password|pwned|leaked/.test(m)) {
        if (/pwned|leaked|compromised/.test(m) || (error?.reasons || []).includes('pwned')) {
            return {
                titulo: 'Senha insegura',
                texto: 'Essa senha já apareceu em vazamentos de dados na internet e não pode ser usada. Escolha outra senha, que você não use em outros sites.'
            };
        }
        let pendentes = ctx.senha != null ? regrasSenhaPendentes(ctx.senha) : [];
        if (!pendentes.length) {
            // Senha não informada aqui: monta a lista a partir do que o Supabase exigiu.
            const minLen = (m.match(/at least (\d+) characters/) || [])[1];
            if (minLen) pendentes.push({ texto: `Ter pelo menos ${minLen} caracteres` });
            if (/one character of each/.test(m)) pendentes.push(...REGRAS_SENHA.filter(r => r.id !== 'tamanho'));
            if (!pendentes.length) pendentes = REGRAS_SENHA.slice();
        }
        return {
            titulo: 'Senha fora do padrão',
            texto: 'A senha não atende às regras de segurança: ' + pendentes.map(r => r.texto.charAt(0).toLowerCase() + r.texto.slice(1)).join('; ') + '.',
            html: htmlRegrasSenha(pendentes)
        };
    }
    if (code === 'same_password' || /should be different from the old/.test(m)) {
        return { titulo: 'Senha repetida', texto: 'A nova senha precisa ser diferente da senha atual. Escolha outra.' };
    }
    if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already been registered|already exists/.test(m)) {
        return {
            titulo: 'E-mail já cadastrado',
            texto: 'Já existe uma conta com este e-mail. Volte para a tela de login e entre com sua matrícula e senha. Se não lembrar da senha, use "Esqueci minha senha".'
        };
    }
    if (code === 'email_address_invalid' || (code === 'validation_failed' && /email/.test(m)) || /invalid.*email|email.*invalid|unable to validate email/.test(m)) {
        return { titulo: 'E-mail inválido', texto: 'O e-mail informado não é válido. Confira se foi digitado corretamente (exemplo: nome.sobrenome@sop.ce.gov.br).' };
    }
    if (code === 'invalid_credentials' || /invalid login credentials/.test(m)) {
        return { titulo: 'Não foi possível entrar', texto: 'Matrícula/e-mail ou senha incorretos. Confira os dados e tente de novo. Se esqueceu a senha, use "Esqueci minha senha".' };
    }
    if (code === 'email_not_confirmed' || /email not confirmed/.test(m)) {
        return { titulo: 'E-mail não confirmado', texto: 'Seu e-mail ainda não foi confirmado. Abra a mensagem de confirmação enviada para sua caixa de entrada (veja também o spam) e tente de novo.' };
    }
    if (code === 'signup_disabled' || /signups not allowed|signup.*disabled/.test(m)) {
        return { titulo: 'Cadastro indisponível', texto: 'Novos cadastros estão temporariamente desativados. Procure o administrador do GECOPE.' };
    }
    if (/rate limit|too many requests|for security purposes, you can only request/.test(m) || /^over_.*rate_limit$/.test(code)) {
        return { titulo: 'Muitas tentativas', texto: 'Foram feitas muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' };
    }
    if (code === 'session_expired' || code === 'session_not_found' || /jwt expired|session.*(missing|expired|not found)/.test(m)) {
        return { titulo: 'Sessão expirada', texto: 'Sua sessão expirou. Entre novamente no sistema.' };
    }
    if (/failed to fetch|networkerror|network request failed|load failed/.test(m)) {
        return { titulo: 'Sem conexão', texto: 'Não foi possível falar com o servidor. Verifique sua conexão com a internet e tente novamente.' };
    }
    return {
        titulo: 'Algo deu errado',
        texto: 'Não foi possível concluir a operação agora. Tente novamente em instantes. Se o problema continuar, procure o administrador do GECOPE' +
               (msg ? ` e informe a mensagem técnica: "${msg}".` : '.')
    };
}

// Mostra o erro traduzido num SweetAlert (cai para alert() se o Swal não estiver carregado).
async function mostrarErroAuth(error, ctx = {}) {
    const t = traduzirErroAuth(error, ctx);
    if (window.Swal) {
        await Swal.fire({
            icon: 'warning',
            title: t.titulo,
            ...(t.html ? { html: t.html } : { text: t.texto }),
            confirmButtonColor: 'var(--sop-green)',
            confirmButtonText: 'Entendi'
        });
    } else {
        alert(`${t.titulo}\n\n${t.texto}`);
    }
}

// Cadastro reformulado: NOME, SOBRENOME, MATRICULA, SENHA
async function signUpRequest(nome, sobrenome, matricula, senha, telefone, email) {
    try {
        // Normaliza (trim/lowercase) antes de qualquer uso: o Supabase Auth sempre grava o
        // e-mail em minúsculas, então usar a mesma normalização aqui garante que auth.users
        // e app_users fiquem com o mesmo valor e possam ser correlacionados pelo e-mail.
        email = (email || '').trim().toLowerCase();

        // Sanitiza nome/sobrenome/matrícula na entrada: esses valores acabam renderizados via
        // innerHTML em várias telas (Atividades, comentários) e também interpolados em filtros
        // .or() do PostgREST — sem essa allowlist, um nome com HTML/vírgula/parêntese vira XSS
        // armazenado ou bypass do filtro por perfil "fiscal".
        nome = String(nome || '').trim().replace(/[^\p{L}\p{M}\s'.-]/gu, '').slice(0, 60);
        sobrenome = String(sobrenome || '').trim().replace(/[^\p{L}\p{M}\s'.-]/gu, '').slice(0, 60);
        matricula = String(matricula || '').trim().replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);

        if (!nome || !sobrenome || !matricula) {
            await Swal.fire({
                icon: 'warning',
                title: 'Confira seus dados',
                html: '<div style="text-align:left">Preencha todos os campos obrigatórios:<ul style="margin:8px 0 0 18px;padding:0">' +
                      '<li><b>Nome</b> e <b>Sobrenome</b>: apenas letras, espaços, apóstrofo, ponto ou hífen.</li>' +
                      '<li><b>Matrícula</b>: apenas números e letras, sem espaços.</li></ul></div>',
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Entendi'
            });
            return false;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            await Swal.fire({
                icon: 'warning',
                title: 'E-mail inválido',
                text: 'Informe um e-mail válido, de preferência o institucional (exemplo: nome.sobrenome@sop.ce.gov.br).',
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Entendi'
            });
            return false;
        }

        // Confere a senha antes de ir ao servidor, para explicar em português o que falta.
        const pendentesSenha = regrasSenhaPendentes(senha);
        if (pendentesSenha.length) {
            await Swal.fire({
                icon: 'warning',
                title: 'Senha fora do padrão',
                html: htmlRegrasSenha(pendentesSenha),
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Entendi'
            });
            return false;
        }

        // 0. Matrícula que já tem conta de login não cria outra (06/11/2026: o fiscal da
        //    matrícula 70023512 se cadastrou de novo com um Gmail; a conta nova ficou sem
        //    perfil, porque matrícula é UNIQUE em app_users, e ele seguiu sem acesso).
        //    Fiscal pré-cadastrado pelo admin, sem login, passa normalmente.
        //    Se a verificação falhar (rede, função fora do ar), segue o cadastro como antes.
        try {
            const v = await chamarLoginMatricula({ acao: 'verificar_cadastro', matricula });
            if (v.ok && v.jaTemConta) {
                await Swal.fire({
                    icon: 'info',
                    title: 'Matrícula já cadastrada',
                    html: `A matrícula <b>${matricula}</b> já tem uma conta no GECOPE.<br><br>` +
                          'Entre com a matrícula e sua senha. Se não lembrar da senha, use ' +
                          '<b>"Esqueci minha senha"</b> na tela de login.',
                    confirmButtonColor: 'var(--sop-green)',
                    confirmButtonText: 'Ir para o login'
                });
                const cReg = document.getElementById('container-register');
                const cLogin = document.getElementById('container-login');
                if (cReg && cLogin) { cReg.style.display = 'none'; cLogin.style.display = 'block'; }
                const campoMat = document.getElementById('landing-matricula');
                if (campoMat) campoMat.value = matricula;
                return false;
            }
            if (!v.ok && v.limite) {
                await Swal.fire({ icon: 'warning', title: 'Muitas tentativas', text: v.erro, confirmButtonColor: 'var(--sop-green)', confirmButtonText: 'Entendi' });
                return false;
            }
            if (!v.ok) console.warn('[SIGNUP] Verificação da matrícula falhou; seguindo o cadastro:', v.erro);
        } catch (errVerif) {
            console.warn('[SIGNUP] Não foi possível verificar a matrícula; seguindo o cadastro:', errVerif);
        }

        // 1. Criar usuário no Auth
        const options = {
            email: email,
            password: senha,
            options: { data: { full_name: `${nome} ${sobrenome}` } }
        };

        const { data, error } = await sbClient.auth.signUp(options);

        if (error) {
            console.error('[SIGNUP] Erro no Auth.signUp:', error);
            await mostrarErroAuth(error, { senha });
            return false;
        }

        const userId = data?.user?.id;

        // Rastreia se o perfil em app_users ficou de fato com o MESMO e-mail gravado em
        // auth.users (acima). Se essa gravação falhar silenciosamente (ex.: RLS bloqueando
        // o UPDATE/INSERT), o usuário tem uma conta de autenticação válida mas nenhum (ou um
        // desatualizado) perfil correspondente — ao ser "aprovado" pelo admin, o login
        // continuaria falhando, sem que ninguém percebesse a causa. Ver sql/fix_app_users_email_mismatch.sql
        // para o reparo de registros já afetados por essa falha no passado.
        let appUsersSynced = false;

        // 1b. Fiscal pré-cadastrado pelo admin (perfil com e-mail real, sem login) que se
        //     cadastra com outro e-mail: a RLS não deixa esta conta ver o perfil e o INSERT
        //     abaixo esbarra na matrícula UNIQUE. A RPC (sql/add_assumir_pre_cadastro.sql)
        //     passa o perfil para este e-mail, como 'pending', guardando o e-mail e o papel
        //     anteriores para o admin conferir. Sem sessão (confirmação de e-mail ligada) ou
        //     qualquer outra resposta, segue o caminho antigo.
        if (data?.session) {
            const { data: assumir, error: assumirErr } = await sbClient.rpc('app_users_assumir_pre_cadastro', {
                p_matricula: matricula, p_telefone: telefone || null
            });
            if (assumirErr) console.warn('[SIGNUP] app_users_assumir_pre_cadastro falhou:', assumirErr.message);
            else if (assumir === 'assumido') appUsersSynced = true;
        }

        if (!appUsersSynced) {
        // 2. Buscar se já existe um registro fantasma pela matrícula
        const { data: existingGhost, error: searchError } = await sbClient
            .from('app_users')
            .select('*')
            .eq('matricula', matricula)
            .maybeSingle();

        if (existingGhost) {
            // Tenta UPDATE no registro ghost existente
            const payload = {
                email: email,
                nome: nome,
                sobrenome: sobrenome,
                telefone_whatsapp: telefone || existingGhost.telefone_whatsapp,
                role: 'pending'
            };

            const { data: updated, error: updateError } = await sbClient.from('app_users').update(payload).eq('id', existingGhost.id).select();
            // Se UPDATE falhar por RLS (0 linhas afetadas) ou erro, insere novo registro com email real
            if (updateError || !updated || updated.length === 0) {
                console.warn('[SIGNUP] UPDATE do ghost falhou (RLS?), tentando INSERT com email real:', updateError?.message);
                const { error: insertFallbackError } = await sbClient.from('app_users').insert([{ ...payload, matricula }]);
                if (insertFallbackError) {
                    console.warn('[SIGNUP] INSERT fallback também falhou:', insertFallbackError.message);
                } else {
                    appUsersSynced = true;
                }
            } else {
                appUsersSynced = true;
            }
        } else {
            // Não existe, fazer INSERT de um novo
            const payload = {
                email: email,
                matricula: matricula,
                nome: nome,
                sobrenome: sobrenome,
                telefone_whatsapp: telefone,
                role: 'pending',
                created_at: new Date().toISOString()
            };
            // NÃO gravar payload.id: app_users.id é bigint (identity) e userId é o UUID do
            // Auth — o INSERT falharia com 22P02 e o perfil não seria criado. A correlação
            // entre auth.users e app_users é feita por e-mail (normalizado em minúsculas).

            const { error: insertError } = await sbClient.from('app_users').insert([payload]);
            if (insertError) {
                console.warn('[SIGNUP] Aviso ao inserir app_users (RLS):', insertError);
            } else {
                appUsersSynced = true;
            }
        }
        } // fim do if (!appUsersSynced)

        const { error: noteError } = await sbClient.from('app_notifications').insert([{ type: 'new_user_request', payload: JSON.stringify({ matricula, nome: `${nome} ${sobrenome}`, email: email }), created_at: new Date().toISOString(), read: false }]);
        if (noteError) {
            console.warn('[SIGNUP] Falha ao inserir notificação:', noteError);
        }

        if (!appUsersSynced) {
            // Não mascara o problema com a mensagem de sucesso: a conta de login (Auth) foi
            // criada, mas o perfil (app_users) não foi gravado/atualizado corretamente — se o
            // admin aprovar mesmo assim, o acesso continuará falhando por e-mail divergente.
            await Swal.fire({
                icon: 'warning',
                title: 'Cadastro incompleto',
                html: 'Sua conta de acesso foi criada, mas houve uma falha ao registrar seu perfil no sistema.<br><br>' +
                      'Entre em contato com o administrador do GECOPE informando sua matrícula ' +
                      `(<b>${_escHtmlAuth(matricula)}</b>) e o e-mail usado no cadastro (<b>${_escHtmlAuth(email)}</b>) ` +
                      'para que ele conclua seu cadastro manualmente.',
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Entendi'
            });
            return true;
        }

        await Swal.fire({
            icon: 'success',
            title: 'Solicitação enviada',
            html: `Seu pedido de acesso para a matrícula <b>${_escHtmlAuth(matricula)}</b> foi enviado.<br><br>` +
                  'Agora é só aguardar: o administrador do GECOPE vai analisar e liberar seu acesso. ' +
                  'Depois disso, entre com sua matrícula e a senha que você acabou de criar.',
            confirmButtonColor: 'var(--sop-green)',
            confirmButtonText: 'Ok'
        });
        return true;
    } catch (err) {
        console.error(err);
        await mostrarErroAuth(err, { senha });
        return false;
    }
}

async function signInWithEmail(email, password, opts = {}) {
    try {
        // Normaliza aqui também: garante que a busca do perfil em app_users (feita mais abaixo
        // por igualdade exata de string) bata mesmo que o usuário digite o e-mail com maiúsculas.
        email = (email || '').trim().toLowerCase();

        // Garantia: aguarda inicialização do cliente Supabase (se necessário)
        if (!sbClient) {
            const waitInit = new Promise(res => {
                const start = Date.now();
                const iv = setInterval(() => {
                    if (sbClient) { clearInterval(iv); res(true); }
                    else if (Date.now() - start > 5000) { clearInterval(iv); res(false); }
                }, 100);
            });
            const ok = await waitInit;
            if (!ok) {
                Swal.fire('Erro de Autenticação', 'Serviço de autenticação não iniciado. Recarregue a página.', 'error');
                return false;
            }
        }

        // opts.sessao: login por matrícula já autenticado no servidor (Edge Function
        // login-matricula); aqui só se instala a sessão e segue o mesmo pós-login.
        const { error } = opts.sessao
            ? await sbClient.auth.setSession(opts.sessao)
            : await sbClient.auth.signInWithPassword({ email, password });

        if (error) {
            console.error('[ERRO] Falha Auth:', error.message);
            if (!opts.silent) {
                document.getElementById('landing-feedback').style.display = 'block';
                document.getElementById('landing-feedback').textContent = traduzirErroAuth(error).texto;
            }
            return false;
        }

        // Busca perfil por email (app_users.id é bigserial, não UUID do Auth)
        const profile = await sbClient.from('app_users').select('*').eq('email', email).maybeSingle();
        const role = profile?.data?.role || 'pending';

        // Salva no sessionStorage
        sessionStorage.setItem('sop_user', email);
        sessionStorage.setItem('sop_role', role);

        // A lista de fiscais (app_users) só é consultada com sessão ativa: no boot de visitante
        // ela voltava vazia pelo RLS e nunca era refeita após o login. — 01/10/2026
        if (typeof garantirFiscaisCarregados === 'function') garantirFiscaisCarregados();
        window.dispatchEvent(new Event('gecope:login'));

        // Busca nome completo de forma robusta
        let finalName = '';
        if (profile.data) {
            if (profile.data.full_name && !/^\d+$/.test(profile.data.full_name)) {
                finalName = profile.data.full_name;
            } else if (profile.data.nome) {
                finalName = (profile.data.nome + (profile.data.sobrenome ? ' ' + profile.data.sobrenome : '')).toUpperCase();
            }
        }

        if (finalName) {
            sessionStorage.setItem('sop_user_name', finalName);
        } else {
            sessionStorage.removeItem('sop_user_name');
        }

        // Plano de permissões por papel (Fase 3): matrícula própria, usada em
        // modules/processos/processos.js pra filtrar "meus processos" pelo
        // vínculo estável (fiscal_matricula) em vez de comparar nome — já vem
        // no profile.data (select('*') acima), só faltava guardar.
        if (profile.data && profile.data.matricula) {
            sessionStorage.setItem('sop_matricula', String(profile.data.matricula));
        } else {
            sessionStorage.removeItem('sop_matricula');
        }

        // Plano de permissões por papel (Fase 5): autorizações especiais que o
        // Admin concedeu pra este usuário específico (sem mudar o papel dele).
        // Guarda só as chaves das permissões ATIVAS (revogado_em IS NULL) — o
        // resto do app checa com temAutorizacao('chave'), sem precisar saber
        // que isso vem de uma tabela à parte.
        try {
            const { data: autorizacoes } = await sbClient
                .from('autorizacoes_especiais')
                .select('permissao')
                .ilike('usuario_email', email)
                .is('revogado_em', null);
            sessionStorage.setItem('sop_autorizacoes', JSON.stringify((autorizacoes || []).map(a => a.permissao)));
        } catch (e) {
            console.warn('[WARN] Falha ao buscar autorizações especiais:', e);
            sessionStorage.setItem('sop_autorizacoes', '[]');
        }

        applyRoleToUI(role);

        // Esconde landing
        toggleLanding(false);

        // Sem o setTimeout de 500ms que havia aqui: signInWithPassword já resolveu e a sessão está
        // gravada; o atraso só empurrava a Início para depois.
        carregarDadosSupabase();
        verificarTrocaSenhaObrigatoria();
        return true;
    } catch (err) {
        console.error('[ERRO] Exceção em signInWithEmail:', err);
        if (!opts.silent) {
            document.getElementById('landing-feedback').style.display = 'block';
            document.getElementById('landing-feedback').textContent = traduzirErroAuth(err).texto;
        }
        return false;
    }
}

// Senha provisória (gerada pelo admin em Administração > Redefinir senha, Edge Function
// admin-redefinir-senha) marca user_metadata.trocar_senha = true. Enquanto a marca existir,
// esta janela não sai da frente: o usuário cria a senha nova ou sai do sistema. Roda depois
// do login e também quando a aba é recarregada já logada (fim do DOMContentLoaded abaixo).
let _trocaSenhaAberta = false;
async function verificarTrocaSenhaObrigatoria() {
    if (_trocaSenhaAberta || !sbClient) return;
    let user = null;
    try {
        const { data } = await sbClient.auth.getUser();
        user = data && data.user;
    } catch (_) { return; }
    if (!user || !(user.user_metadata && user.user_metadata.trocar_senha)) return;

    _trocaSenhaAberta = true;
    try {
        while (true) {
            const r = await Swal.fire({
                title: 'Crie sua nova senha',
                html: `
                    <div style="text-align:left;font-size:.9rem;color:#374151;margin-bottom:6px">Você entrou com uma senha provisória. Para continuar, crie uma senha nova. Ela precisa:
                        <ul style="margin:6px 0 0 18px;padding:0">${REGRAS_SENHA.map(r => `<li>${r.texto}</li>`).join('')}</ul></div>
                    <input id="nova-senha-1" type="password" class="swal2-input" style="color:#111827;background:#fff" placeholder="Nova senha" autocomplete="new-password">
                    <input id="nova-senha-2" type="password" class="swal2-input" style="color:#111827;background:#fff" placeholder="Repita a nova senha" autocomplete="new-password">`,
                icon: 'info',
                allowOutsideClick: false,
                allowEscapeKey: false,
                showCancelButton: true,
                confirmButtonText: 'Salvar nova senha',
                cancelButtonText: 'Sair',
                confirmButtonColor: 'var(--sop-green)',
                preConfirm: () => {
                    const s1 = document.getElementById('nova-senha-1').value;
                    const s2 = document.getElementById('nova-senha-2').value;
                    const faltam = regrasSenhaPendentes(s1);
                    if (faltam.length) { Swal.showValidationMessage('A senha ainda precisa: ' + faltam.map(f => f.texto.charAt(0).toLowerCase() + f.texto.slice(1)).join('; ') + '.'); return false; }
                    if (s1 !== s2) { Swal.showValidationMessage('As duas senhas digitadas não são iguais. Digite a mesma senha nos dois campos.'); return false; }
                    return s1;
                }
            });
            if (!r.isConfirmed) { await signOutUser(); return; }

            Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const { error } = await sbClient.auth.updateUser({ password: r.value, data: { trocar_senha: false } });
            if (!error) {
                await Swal.fire('Senha alterada', 'Sua nova senha já está valendo.', 'success');
                return;
            }
            console.error('[ERRO] Troca de senha obrigatória:', error.message);
            await mostrarErroAuth(error, { senha: r.value });
        }
    } finally {
        _trocaSenhaAberta = false;
    }
}

// Edge Function login-matricula (supabase/functions/login-matricula): login e recuperação de
// senha por matrícula sem o e-mail passar pelo navegador. Sempre responde JSON { ok, ... }.
async function chamarLoginMatricula(corpo) {
    const resp = await fetch(`${window.SUPABASE_URL}/functions/v1/login-matricula`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': window.SUPABASE_KEY,
            'Authorization': `Bearer ${window.SUPABASE_KEY}`
        },
        body: JSON.stringify(corpo)
    });
    let json = null;
    try { json = await resp.json(); } catch (_) { /* corpo não-JSON */ }
    if (!json) throw new Error(`login-matricula respondeu ${resp.status}`);
    return json;
}

async function signOutUser() {
    await sbClient.auth.signOut();
    sessionStorage.removeItem('sop_user');
    sessionStorage.removeItem('sop_role');
    sessionStorage.removeItem('sop_user_name');
    sessionStorage.removeItem('sop_matricula');
    sessionStorage.removeItem('sop_autorizacoes');
    // Exibe landing novamente
    toggleLanding(true);
    // Atualiza UI
    applyRoleToUI('guest');
}

// Tile de módulo (.home-action-card/.home-list-row) sem acesso pro papel atual: em vez
// de sumir (display:none, o que abria "buracos" no grid da Início), o tile continua
// visível com aparência de bloqueado e o clique mostra um aviso em vez de abrir o
// módulo. `locked` alterna entre os dois estados — chamada de novo a cada
// applyRoleToUI() (troca de papel/autorização), então precisa ser idempotente nos
// dois sentidos (travar de novo, ou destravar quem ganhou a autorização).
function setupLockedModuleCard(el, locked) {
    el.classList.toggle('locked-module', locked);
    if (locked) {
        el.setAttribute('aria-disabled', 'true');
        // guarda o onclick ORIGINAL (o inline do HTML) só da primeira vez que este tile
        // é travado — sem essa guarda, uma segunda chamada com locked=true sobrescreveria
        // el._onclickOriginal com o próprio handler de aviso, e destravar depois reabriria
        // o módulo pro aviso, não pro onclick de verdade.
        if (!el.dataset.onclickOriginalSet) {
            el._onclickOriginal = el.onclick;
            el.dataset.onclickOriginalSet = '1';
        }
        el.onclick = e => { e.preventDefault(); avisarModuloSemAcesso(el); };
        // O motivo do bloqueio substitui a descrição do tile (guardada para destravar depois).
        const desc = el.querySelector('.home-list-row-desc') || el.querySelector('.home-action-text p');
        if (desc) {
            if (desc.dataset.descOriginal === undefined) desc.dataset.descOriginal = desc.textContent;
            desc.textContent = motivoModuloBloqueado(el);
        }
        if (!el.querySelector('.locked-module-badge')) {
            const badge = document.createElement('span');
            badge.className = 'locked-module-badge';
            badge.title = 'Sem acesso';
            badge.setAttribute('aria-label', 'Sem acesso');
            badge.innerHTML = '<i class="bi bi-lock-fill"></i>';
            const alvo = el.querySelector('.home-action-text h3') || el.querySelector('.home-list-row-title');
            if (alvo) alvo.appendChild(badge);
        }
    } else {
        el.removeAttribute('aria-disabled');
        if (el.dataset.onclickOriginalSet) el.onclick = el._onclickOriginal || null;
        const badge = el.querySelector('.locked-module-badge');
        if (badge) badge.remove();
        const desc = el.querySelector('.home-list-row-desc') || el.querySelector('.home-action-text p');
        if (desc && desc.dataset.descOriginal !== undefined) desc.textContent = desc.dataset.descOriginal;
    }
}

// Por que o tile está bloqueado, em uma frase curta (vai no lugar da descrição):
// módulo que o administrador libera por pessoa (data-autorizacao), módulo só de admin,
// ou módulo que depende do perfil.
function motivoModuloBloqueado(el) {
    if (el.getAttribute('data-autorizacao')) return 'Liberado pelo administrador';
    if ((el.getAttribute('data-roles') || '') === 'admin') return 'Só para administradores';
    return 'Indisponível para o seu perfil';
}

// nome de exibição do módulo pro texto do aviso — lido do próprio título visível do
// tile (h3 do card grande, ou o title da linha), então nunca diverge do que a pessoa
// está vendo. Clona antes de ler o texto pra não incluir o badge "Sem acesso" nele
// mesmo (ele mora dentro do h3/title, ver setupLockedModuleCard acima).
function nomeDoModuloTile(el) {
    const alvo = el.querySelector('.home-action-text h3') || el.querySelector('.home-list-row-title');
    if (!alvo) return 'este módulo';
    const clone = alvo.cloneNode(true);
    const badge = clone.querySelector('.locked-module-badge');
    if (badge) badge.remove();
    return clone.textContent.trim() || 'este módulo';
}

// aviso de clique num tile bloqueado — toast do Bootstrap (mesma lib já carregada pro
// resto da Início); alert() só como rede de segurança se o toast não existir na
// página (ex.: markup não carregado ainda).
function avisarModuloSemAcesso(el) {
    const nome = nomeDoModuloTile(el);
    const toastEl = document.getElementById('toastModuloSemAcesso');
    const textoEl = document.getElementById('toastModuloSemAcessoTexto');
    if (toastEl && textoEl && window.bootstrap && bootstrap.Toast) {
        textoEl.textContent = `Você não tem acesso ao módulo "${nome}". Fale com um administrador se precisar dele.`;
        bootstrap.Toast.getOrCreateInstance(toastEl).show();
    } else {
        alert(`Você não tem acesso ao módulo "${nome}".`);
    }
}

function applyRoleToUI(rawRole) {
    const role = (rawRole || 'guest').toLowerCase();

    // Remove role classes
    document.body.classList.remove('role-admin', 'role-gerente', 'role-fiscal', 'role-externo', 'role-eletrica', 'role-pending', 'is-admin');
    document.body.classList.add(`role-${role}`);
    if (role === 'admin') document.body.classList.add('is-admin');

    // 1. Reset tabs and panes
    document.querySelectorAll('#dashboardTabs .nav-link').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('show', 'active'));

    // 2. Activate Home Tab by Default
    const homeTab = document.querySelector('[data-bs-target="#pane-home"]');
    const homePane = document.getElementById('pane-home');
    if (homeTab && homePane) {
        homeTab.classList.add('active');
        homePane.classList.add('show', 'active');
        setHeroContext('pane-home');
        updateHome();
    }

    // 1. Visibilidade de Abas e Tiles por Atributo data-roles
    // -> um card/linha SEM data-roles continua sempre visível pra todos os papéis (não
    //    entra neste querySelectorAll); a restrição desses fica só em showPane()/cada função.
    //    Já um card/linha COM data-roles (ex.: Financeiro, Curva ABC) precisa respeitar o
    //    atributo de verdade.
    // Tiles da Início (isCard) NUNCA mais somem por papel (pedido do usuário: sumir abria
    // "buracos" no grid da Início pra quem não tinha acesso a alguns módulos) — ficam
    // sempre visíveis e setupLockedModuleCard() cuida da aparência/clique de quem não tem
    // acesso. Abas de #dashboardTabs (não são card) continuam escondidas de verdade: são
    // uma barra de navegação linear, não um grid, então escondê-las não deixa buraco.
    document.querySelectorAll('[data-roles]').forEach(el => {
        const isCard = el.classList.contains('home-action-card') || el.classList.contains('home-list-row');
        const allowed = el.getAttribute('data-roles').split(',');
        // Fase 5: elemento com data-autorizacao="chave" também aparece pra quem
        // recebeu essa autorização especial, mesmo com papel fora de data-roles
        // (ex.: Fiscal com "financeiro" concedido individualmente vê o card).
        const autorizacaoExtra = el.getAttribute('data-autorizacao');
        const temExtra = autorizacaoExtra && typeof temAutorizacao === 'function' && temAutorizacao(autorizacaoExtra);
        const liberado = allowed.includes(role) || temExtra;
        if (isCard) {
            setupLockedModuleCard(el, !liberado);
        } else {
            el.style.setProperty('display', liberado ? 'block' : 'none', 'important');
        }
    });

    // 2b. Deep-link: permite abrir uma aba específica via ?pane=pane-xxx
    // (usado pelo botão "Processos" do módulo Atividades, em cronograma.html)
    const deepLinkPane = new URLSearchParams(window.location.search).get('pane');
    if (deepLinkPane && deepLinkPane !== 'pane-home' && document.getElementById(deepLinkPane)) {
        showPane(deepLinkPane);
    }

    // Caso especial: Selecionar a primeira aba visível se a atual sumir
    const activeTab = document.querySelector('.nav-link.active');
    if (activeTab && activeTab.closest('li').style.display === 'none') {
        const firstVisible = document.querySelector('#dashboardTabs li[style*="display: block"] .nav-link');
        if (firstVisible) showPane(firstVisible.getAttribute('data-bs-target').replace('#', ''));
    }

    // Se for Pending, bloqueia acesso e volta para landing
    if (role === 'pending') {
        alert("Sua solicitação de acesso ainda está pendente de aprovação.");
        signOutUser();
        return;
    }

    // 2. Elementos .admin-only
    document.querySelectorAll('.admin-only').forEach(el => {
        if (el.id !== 'btn-nova-comp-analitica') {
            el.style.display = (role === 'admin') ? '' : 'none';
        }
    });

    // 2b. Elementos .admin-gerente-only (ações de Orçamentos: Novo/Nova Versão/
    // Excluir) — hoje só existem pra Orçamentos, então checar a autorização
    // "orcamentos_gravar" aqui é seguro (Fase 5: libera pra quem recebeu essa
    // autorização especial, mesmo sendo Fiscal/Externo).
    document.querySelectorAll('.admin-gerente-only').forEach(el => {
        el.style.display = (role === 'admin' || role === 'gerente' || temAutorizacao('orcamentos_gravar')) ? '' : 'none';
    });

    // 3. Botões Específicos
    const btnNovaComp = document.getElementById('btn-nova-comp-analitica');
    if (btnNovaComp) {
        // now all authenticated roles can see the "nova composição analítica" link
        // guests and pending users will still have it hidden via their role string
        btnNovaComp.style.display = (role && role !== 'guest' && role !== 'pending') ? 'inline-block' : 'none';
    }

    // 4. Elementos Hide Fiscal
    if (role === 'fiscal') {
        document.querySelectorAll('.hide-fiscal').forEach(el => el.style.display = 'none');
    }

    // 4b. E7 (painel de desempenho dos fiscais): a quebra por distrito/fiscal dos KPIs
    // de Processos passou a ler de vw_painel_desempenho_fiscais, restrita a
    // admin/gerente — a interface não pode oferecer um clique que o banco vai negar.
    // Diferente de .hide-fiscal, aqui só o CLIQUE some (o número do card continua
    // visível e útil pra todo papel; é só a quebra nominal por trás dele que é
    // admin/gerente). `externo` entra na mesma restrição pelo mesmo motivo — nunca
    // teria acesso à view (sugestão do rev-seguranca na revisão da E7).
    if (role === 'fiscal' || role === 'externo') {
        document.querySelectorAll('.fiscal-no-breakdown').forEach(el => {
            el.style.cursor = 'default';
            el.removeAttribute('title');
            el.onclick = null;
            // O atalho "Por fiscal" da faixa de Processos não tem número para mostrar sem a quebra: some.
            if (el.classList.contains('proc-strip-dist')) el.style.display = 'none';
        });
    }

    // 5. Atualiza contadores e Admin Dashboard
    if (role === 'admin') {
        fetchPendingCount();
        startNotificationsPoll();
    } else {
        const badgeEl = document.getElementById('pending-badge'); if (badgeEl) badgeEl.textContent = '';
        stopNotificationsPoll();
    }

    // 6. Atualiza Header (Sair / Nome Usuário)
    const userInfoHeader = document.getElementById('user-info-header');
    if (userInfoHeader) {
        if (role === 'guest') {
            userInfoHeader.style.setProperty('display', 'none', 'important');
        } else {
            userInfoHeader.style.setProperty('display', 'flex', 'important');
            const nameEl = document.getElementById('header-user-name');
            const roleEl = document.getElementById('header-user-role');
            if (nameEl) nameEl.textContent = (sessionStorage.getItem('sop_user_name') || 'Usuário').toUpperCase();
            if (roleEl) roleEl.textContent = role;
        }
    }

    // Aplicar regras de RBAC nos painéis
    if (typeof applyRBACToPainels === 'function') {
        applyRBACToPainels();
    }
}

// --- FUNES DE CONTROLE DE RBAC (ROLE-BASED ACCESS CONTROL) ---
/**
 * Retorna o papel atual do usuário logado
 */
function getCurrentUserRole() {
    return (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
}

/**
 * Retorna o email do usuário logado
 */
function getCurrentUserEmail() {
    return sessionStorage.getItem('sop_user') || '';
}

/**
 * Busca a role atual do usuário no servidor (tabela app_users)
 * e atualiza localStorage + UI se houver alteração.
 */
async function refreshUserRole() {
    try {
        const email = getCurrentUserEmail();
        if (!email) return;
        const { data, error } = await sbClient.from('app_users').select('role').eq('email', email).single();
        if (error) {
            console.warn('[WARN] refreshUserRole: erro ao buscar role', error.message || error);
            return;
        }
        const newRole = (data?.role || 'guest').toLowerCase();
        const curRole = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
        if (newRole !== curRole) {
            sessionStorage.setItem('sop_role', newRole);
            console.log('[INFO] Role atualizada de', curRole, 'para', newRole);
            applyRoleToUI(newRole);
        }
    } catch (err) {
        console.error('[ERRO] refreshUserRole:', err);
    }
}

/**
 * Plano de permissões por papel (Fase 5): verifica se o usuário logado tem
 * uma autorização especial concedida pelo Admin (tela de Administração), sem
 * precisar mudar o papel dele. Lista fechada de chaves — ver
 * sql/autorizacoes_especiais.sql para a lista completa e o que cada uma libera.
 * @param {string} chave - ex: 'processos_gravar', 'composicoes_editar_terceiros'
 */
function temAutorizacao(chave) {
    try {
        const lista = JSON.parse(sessionStorage.getItem('sop_autorizacoes') || '[]');
        return Array.isArray(lista) && lista.includes(chave);
    } catch {
        return false;
    }
}

/**
 * Verifica se o usuario é proprietário de uma composição/orçamento
 * @param {Object} item - O item (composição ou orçamento)
 * @returns {boolean} - True se o usuário é o dono
 */
function isItemOwner(item) {
    // Mesma regra do banco: as políticas/trigger de composicoes_biblioteca (UPDATE pelo dono e DELETE)
    // comparam `criador_email` com o e-mail do JWT — nada além disso vale. Antes a tela adivinhava o
    // dono pelo NOME no histórico de versões e mostrava lápis/lixeira que o banco recusava (a
    // exclusão chegava a mostrar "Excluído com sucesso!" sem apagar nada).
    const userEmail = getCurrentUserEmail().trim().toLowerCase();
    const criador = String(item.criador_email || '').trim().toLowerCase();
    return !!userEmail && !!criador && userEmail === criador;
}

/**
 * Verifica se o usuário pode editar uma composição
 * Regra: Admin e Gerente podem editar todas. Fiscal/Externo/Elétrica podem editar apenas as próprias
 */
function canEditComposition(item) {
    const role = getCurrentUserRole();
    if (role === 'admin' || role === 'gerente') return true;
    if (temAutorizacao('composicoes_editar_terceiros')) return true;
    if (['fiscal', 'externo', 'eletrica'].includes(role)) {
        return isItemOwner(item);
    }
    return false;
}

/**
 * Verifica se o usuário pode deletar uma composição
 * Regra: Admin e Gerente podem deletar todas. Fiscal/Externo/Elétrica podem deletar apenas as próprias
 * (ou qualquer uma, se tiverem a autorização especial "composicoes_editar_terceiros")
 */
function canDeleteComposition(item) {
    const role = getCurrentUserRole();
    if (role === 'admin' || role === 'gerente') return true;
    if (temAutorizacao('composicoes_editar_terceiros')) return true;
    if (['fiscal', 'externo', 'eletrica'].includes(role)) {
        return isItemOwner(item);
    }
    return false;
}

/**
 * Verifica se o usuário pode ver ações em processos (botões de ação)
 * Regra: Admin e Gerente. Fiscal/Externo também, se tiverem a autorização
 * especial "processos_gravar" (concedida individualmente em Administração).
 *
 * Isto é quem ABRE o modal (o botão do olho); quem GRAVA é podeGravarProcessos(). As duas
 * regras coincidem desde 22/09/2026, então esta delega — em vez de repetir a expressão, que
 * foi como a mesma regra acabou em quatro cópias divergentes até aquela revisão.
 *
 * Elas já estiveram separadas: entre 18/09 e 22/09/2026 o banco recusava a gravação de quem
 * tinha a autorização especial, e quem a tinha abria o modal em LEITURA. Se um dia voltarem a
 * divergir, é aqui que se separa de novo — ver um processo não precisa depender de poder
 * gravá-lo.
 */
function canSeeProcessActions() {
    return podeGravarProcessos();
}

/**
 * Verifica se o usuário pode marcar processo como prioritário
 * Regra: Apenas Admin e Gerente. Fiscal e Externo não podem
 */
function canMarkProcessAsPriority() {
    const role = getCurrentUserRole();
    // apenas administrador pode alterar prioridades
    return role === 'admin';
}

/**
 * Verifica se o usuário pode marcar data como meta
 * Regra: apenas Admin pode (
 */
function canMarkDateAsMeta() {
    const role = getCurrentUserRole();
    // gerentes não têm essa permissão
    return role === 'admin';
}

/**
 * Verifica se o usuário pode excluir um processo (exclusão lógica: status = 'EXCLUÍDO').
 *
 * Regra: a mesma de podeGravarProcessos(), porque é a mesma política `processos_update` do
 * banco que autoriza as duas coisas — a exclusão é um UPDATE de status, não um DELETE. Leia o
 * comentário daquela função antes de mexer aqui: ele explica de que a regra depende no banco.
 *
 * Duas versões desta função erraram no mesmo ponto em 22/09/2026, em direções opostas — a
 * primeira citando `sql/rls_processos_composicoes_orcamentos.sql`, já substituído, e a segunda
 * `sql/autorizacoes_especiais.sql`, cuja definição o banco deixou de refletir em 18/09. A lição é
 * a mesma: o arquivo de migração diz o que foi PEDIDO ao banco, não o que ele responde hoje.
 * Quem decide é `pg_policies`.
 *
 * ATENÇÃO: se esta regra mudar, a política do banco precisa mudar junto. Antes de 22/09/2026 as
 * duas discordavam — o HTML marcava o botão como `.admin-only` enquanto o banco aceitava
 * gerente — e o JS ainda reabilitava o botão para todos, o que dava erro de banco na cara do
 * usuário em vez de simplesmente esconder a ação.
 */
function podeExcluirProcesso() {
    return podeGravarProcessos();
}

/**
 * Espelho, no navegador, da política `processos_update` que está VIVA no banco. Editar e
 * excluir são a mesma autorização lá (a exclusão é um UPDATE), então `podeEditarProcesso()` e
 * `podeExcluirProcesso()` leem daqui, para não poderem divergir entre si nem do banco.
 *
 * REGRA ESPERADA NO BANCO (`sql/autorizacoes_especiais.sql`, Fase 5):
 *     USING (public.pode_gravar_processos())
 *     -- = meu_papel() IN ('admin','gerente') OR tenho_autorizacao('processos_gravar')
 *
 * **DEPENDE DE `sql/restaurar_pode_gravar_processos.sql` TER SIDO APLICADO.** Entre 18/09 e
 * 22/09/2026 esta função NÃO pôde incluir a autorização especial, porque o banco não a
 * aceitava: `sql/_aplicados/fix_processos_rw_authenticated_leftover.sql`, aplicado em
 * 18/09/2026 durante a correção de egress, recriou `processos_insert` e `processos_update` a
 * partir da definição ANTERIOR à Fase 5 e apagou o ramo da autorização sem que ninguém
 * notasse — o script mirava outra coisa (uma política órfã) e levou estas duas junto.
 * `processos_select` escapou, e por isso a autorização irmã `processos_ver_todos` nunca
 * parou de funcionar.
 *
 * Decisão de 22/09/2026: restaurar a intenção da Fase 5. A linha abaixo e a política do banco
 * são UM PAR — se um dia a política for alterada de novo, esta função muda no mesmo dia, nas
 * duas direções: mais larga que o banco dá erro na cara do usuário, mais estreita esconde um
 * poder que ele tem.
 *
 * **Confira em `pg_policies`, não no arquivo de migração.** Foi por confiar no arquivo que
 * esta função errou duas vezes em 22/09/2026, uma para cada lado. Arquivo do `sql/` diz o que
 * foi PEDIDO ao banco em alguma data; só o banco diz o que vale hoje.
 */
function podeGravarProcessos() {
    return ['admin', 'gerente'].includes(getCurrentUserRole())
        || temAutorizacao('processos_gravar');
}

/**
 * Verifica se o usuário pode editar um processo (o "SALVAR ALTERAÇÕES" do modal de detalhes).
 *
 * Mesma regra de podeExcluirProcesso() — é a mesma política `processos_update` que autoriza as
 * duas coisas, então as duas funções andam juntas e ambas leem de podeGravarProcessos():
 * admin, gerente ou a autorização especial. Antes de 22/09/2026 a tela era MAIS rígida que o
 * banco: abria o modal com
 * todos os campos desabilitados para o gerente, embora o banco o autorizasse a gravar. O próprio
 * SQL já supunha isso — o comentário do trigger `processos_restringir_prioridade_meta` fala em
 * não "quebrar o Salvar do Gerente".
 *
 * Duas exceções continuam só-admin, e são impostas pelo banco naquele trigger — a tela precisa
 * espelhá-las para não oferecer um campo cuja gravação o banco vai recusar:
 *   - prioridade  → canMarkProcessAsPriority() (o trigger recusa qualquer mudança em
 *                   `prioritario` vinda de não-admin, mesmo junto com outras colunas);
 *   - meta manual → canMarkDateAsMeta() (o trigger recusa quando `data_compromisso_fiscal` é a
 *                   ÚNICA coluna alterada; quando ela muda por efeito colateral de uma troca de
 *                   status, passa).
 */
function podeEditarProcesso() {
    return podeGravarProcessos();
}

// --- WIRING DO OVERLAY DE LOGIN/CADASTRO (extraído de main.js) ---
/* --------------------------------------------------------------
   OVERLAY DE BOAS-VINDAS / LOGIN (TELA INICIAL)
-------------------------------------------------------------- */

/* HTML do overlay será injetado dinamicamente para não alterar a ordem do arquivo
   (mas já podemos defini-lo aqui para facilitar alteração futura). */

// Overlay de login agora está no HTML estático (logo após <body>).
// Aqui apenas registramos os event listeners.
document.addEventListener('DOMContentLoaded', () => {

    // Toggle Logic
    const containerLogin = document.getElementById('container-login');
    const containerReg = document.getElementById('container-register');

    const btnShowReg = document.getElementById('btn-show-register');
    const btnShowLogin = document.getElementById('btn-show-login');

    if (btnShowReg) {
        btnShowReg.addEventListener('click', (e) => {
            e.preventDefault();
            containerLogin.style.display = 'none';
            containerReg.style.display = 'block';
        });
    }

    if (btnShowLogin) {
        btnShowLogin.addEventListener('click', (e) => {
            e.preventDefault();
            containerReg.style.display = 'none';
            containerLogin.style.display = 'block';
        });
    }

    // Handle Login
    document.getElementById('landingLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const loginInput = document.getElementById('landing-matricula').value.trim();
        const password = document.getElementById('landing-password').value;

        if (loginInput.includes('@')) {
            // Entrada já é um email
            await signInWithEmail(loginInput, password);
        } else {
            // Entrada é matrícula: o servidor (Edge Function login-matricula) descobre o e-mail,
            // autentica e devolve só a sessão. Antes o navegador chamava, sem login, a RPC
            // app_users_lookup_by_matricula, que entregava nome e e-mail de qualquer matrícula
            // (revisão de segurança de 04/11/2026).
            const feedback = document.getElementById('landing-feedback');
            feedback.style.display = 'none';
            try {
                const r = await chamarLoginMatricula({ acao: 'login', matricula: loginInput, senha: password });
                if (r.ok) {
                    await signInWithEmail(r.email, null, {
                        sessao: { access_token: r.access_token, refresh_token: r.refresh_token }
                    });
                } else {
                    feedback.style.display = 'block';
                    feedback.textContent = r.erro || 'Matrícula ou senha inválidas.';
                }
            } catch (err) {
                console.error('[ERRO] login-matricula:', err);
                feedback.style.display = 'block';
                feedback.textContent = 'Não foi possível entrar agora. Tente novamente em instantes.';
            }
        }
    });

    // Toggle Password Visibility
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    const inputPassword = document.getElementById('landing-password');
    if (btnTogglePassword && inputPassword) {
        btnTogglePassword.addEventListener('click', () => {
            const type = inputPassword.getAttribute('type') === 'password' ? 'text' : 'password';
            inputPassword.setAttribute('type', type);
            const icon = btnTogglePassword.querySelector('i');
            if (icon) {
                icon.className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
            }
        });
    }

    // Handle Forgot Password
    const btnEsqueci = document.getElementById('btn-esqueci-senha');
    if (btnEsqueci) {
        btnEsqueci.addEventListener('click', async (e) => {
            e.preventDefault();
            const prefilledMatricula = document.getElementById('landing-matricula').value.trim();

            const { value: matricula } = await Swal.fire({
                title: 'Recuperar Senha',
                text: 'Informe sua matrícula cadastrada no sistema:',
                input: 'text',
                inputValue: prefilledMatricula,
                inputPlaceholder: 'Ex: 12345678',
                showCancelButton: true,
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Confirmar',
                cancelButtonText: 'Cancelar',
                inputValidator: (value) => {
                    if (!value) {
                        return 'Você precisa digitar sua matrícula!';
                    }
                }
            });

            if (matricula) {
                Swal.fire({
                    title: 'Consultando...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    // O servidor (login-matricula) registra o pedido para o admin com o nome real e
                    // responde igual exista ou não a matrícula: a tela não revela de quem ela é
                    // (revisão de segurança de 04/11/2026).
                    const r = await chamarLoginMatricula({ acao: 'recuperar', matricula: matricula.trim() });
                    if (!r.ok) {
                        Swal.fire('Não foi possível enviar', r.erro || 'Tente novamente em instantes.', 'warning');
                        return;
                    }

                    // Número em config.js (ADMIN_WHATSAPP). Antes ficava fixo aqui um número de 8
                    // dígitos que não existe no WhatsApp, e a mensagem nunca chegava.
                    const foneAdmin = String(window.ADMIN_WHATSAPP || '').replace(/\D/g, '');
                    const temWhatsapp = /^55\d{11}$/.test(foneAdmin);
                    const adminMessage = `Olá! Esqueci minha senha do GECOPE. Poderia redefini-la para mim? Minha matrícula é *${matricula.trim()}*.`;
                    const whatsappLink = `https://api.whatsapp.com/send?phone=${foneAdmin}&text=${encodeURIComponent(adminMessage)}`;

                    Swal.fire({
                        title: 'Solicitação registrada',
                        html: 'Se a matrícula estiver cadastrada, o administrador do GECOPE foi avisado e vai redefinir sua senha.'
                            + (temWhatsapp ? '<br><br>Você também pode acelerar o processo enviando uma mensagem direta ao administrador pelo WhatsApp.' : ''),
                        icon: 'success',
                        showConfirmButton: temWhatsapp,
                        showCancelButton: true,
                        confirmButtonColor: '#25D366',
                        confirmButtonText: '<i class="bi bi-whatsapp me-1"></i> Chamar no WhatsApp',
                        cancelButtonText: 'Fechar'
                    }).then((result) => {
                        if (temWhatsapp && result.isConfirmed) {
                            window.open(whatsappLink, '_blank');
                        }
                    });
                } catch (err) {
                    console.error(err);
                    { const t = traduzirErroAuth(err); Swal.fire(t.titulo, 'Não foi possível registrar seu pedido de nova senha. ' + t.texto, 'error'); }
                }
            }
        });
    }

    // Handle Register
    document.getElementById('landingRegisterForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('reg-nome').value.trim();
        const sobrenome = document.getElementById('reg-sobrenome').value.trim();
        const matricula = document.getElementById('reg-matricula').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const senha = document.getElementById('reg-senha').value;
        const elTel = document.getElementById('reg-telefone');
        const telefone = (elTel && elTel.value) ? elTel.value.replace(/\D/g, '') : null;

        const success = await signUpRequest(nome, sobrenome, matricula, senha, telefone, email);

        if (success) {
            // Retorna ao login apenas se o cadastro foi realizado com sucesso
            containerReg.style.display = 'none';
            containerLogin.style.display = 'block';
            document.getElementById('landingRegisterForm').reset();
        }
    });
    // Listeners de Abas
    // (PERFORMANCE: o listener dedicado que existia aqui chamava carregarComposicoes()
    // sem checar a flag de cache _composicoesCarregadas, disparando uma consulta completa
    // ao Supabase toda vez que a aba era reaberta — mesmo já tendo dados em memória. A
    // função showPane() já cuida do carregamento com cache (linha ~3196), então essa
    // chamada duplicada foi removida; showPane() é o único caminho que abre essa aba.)

    // Inicialização
    // Só com sessão restaurada (aba recarregada já logada); visitante não consulta app_users
    // e quem faz login dispara a carga no próprio login (acima).
    if (sessionStorage.getItem('sop_user') && typeof garantirFiscaisCarregados === 'function') garantirFiscaisCarregados();
    // Aba recarregada já logada: a troca obrigatória de senha continua valendo.
    if (sessionStorage.getItem('sop_user')) verificarTrocaSenhaObrigatoria();

    // Garantir que o modal de cadastro esteja no final do body para evitar problemas de visibilidade
    try {
        const modalCadastroEl = document.getElementById('modalCadastro');
        if (modalCadastroEl && modalCadastroEl.parentElement !== document.body) {
            document.body.appendChild(modalCadastroEl);
            console.log('[INIT] modalCadastro movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalCadastro:', e); }

    // Idem para o modal do checklist de documentação do aditivo (evita ficar preso
    // dentro de outro modal ainda fechado, com display:none, e nunca aparecer)
    try {
        const modalChecklistEl = document.getElementById('modalChecklistAditivo');
        if (modalChecklistEl && modalChecklistEl.parentElement !== document.body) {
            document.body.appendChild(modalChecklistEl);
            console.log('[INIT] modalChecklistAditivo movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalChecklistAditivo:', e); }

    // Idem para o modal de justificativa do alerta de retorno
    try {
        const modalAlertaEl = document.getElementById('modalAlertaRetorno');
        if (modalAlertaEl && modalAlertaEl.parentElement !== document.body) {
            document.body.appendChild(modalAlertaEl);
            console.log('[INIT] modalAlertaRetorno movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalAlertaRetorno:', e); }
});
