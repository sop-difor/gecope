# Rodando o consulta-contratos-proxy sempre ligado na SOP

Objetivo: manter esta pasta (`consulta-contratos-proxy`) rodando continuamente numa
maquina da SOP, exposta publicamente por um dominio fixo do ngrok, para que o
Portal da Transparencia do GECOPE funcione de qualquer computador (dentro ou fora
da rede da SOP).

## Por que rodar numa maquina da SOP, e nao na nuvem?

O Cearah Transparente bloqueia (HTTP 403) requisicoes vindas de IPs de datacenter/nuvem
(Render, Railway, AWS, etc.). Rodando numa maquina da SOP, o trafego sai pelo IP
residencial/corporativo de voces, que ja e aceito pelo WAF do site.

## Passo a passo (uma vez, nesta maquina)

1. **Node.js**: confirme que `node --version` funciona no PowerShell.
2. **Dependencias do proxy**:
   ```
   cd consulta-contratos-proxy
   npm install
   npx playwright install chromium
   ```
3. **ngrok**: instale (Microsoft Store, `winget install ngrok.ngrok`, ou download
   manual em ngrok.com). Depois autentique com o token da sua conta
   (Dashboard > Your Authtoken):
   ```
   ngrok config add-authtoken SEU_TOKEN_AQUI
   ```
4. **Criar as tarefas agendadas** (iniciam sozinhas a cada login nesta maquina):
   ```
   cd consulta-contratos-proxy\windows-service
   .\install-tasks.ps1
   ```
5. **Iniciar agora**, sem precisar deslogar:
   ```
   Start-ScheduledTask -TaskName GECOPE-ConsultaContratosProxy
   Start-ScheduledTask -TaskName GECOPE-NgrokTunnel
   ```
6. **Verificar**:
   - `https://babied-average-mulch.ngrok-free.dev/health` deve responder `ok`.
   - Abrir o Portal da Transparencia do GECOPE e fazer uma consulta de teste.

## Observacoes

- O dominio `babied-average-mulch.ngrok-free.dev` e o dominio fixo gratuito
  atribuido a conta ngrok da SOP — nao muda entre reinicios.
- As tarefas so iniciam quando alguem faz login no Windows nesta maquina (nao no
  boot puro). Se quiser que sobreviva a reinicios sem login manual, e possivel
  configurar login automatico do Windows — nao fizemos isso por padrao.
- Se o proxy ou o tunel cairem por qualquer motivo, os scripts `start-proxy.ps1`
  e `start-tunnel.ps1` os reiniciam sozinhos (loop com `Start-Sleep`).
- Para checar se estao rodando: `Get-ScheduledTask -TaskName GECOPE-*` ou o
  Gerenciador de Tarefas do Windows (procure por `node.exe` e `ngrok.exe`).
