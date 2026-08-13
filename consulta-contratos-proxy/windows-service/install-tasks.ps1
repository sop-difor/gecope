# Cria duas Tarefas Agendadas do Windows que iniciam sozinhas quando voce
# faz login nesta maquina: o proxy consulta-contratos-proxy e o tunel ngrok.
# Rode este script UMA VEZ (PowerShell comum, nao precisa ser Administrador).
#
# Pre-requisitos antes de rodar:
#   1. Node.js instalado (para rodar o proxy)
#   2. ngrok instalado (Microsoft Store, winget ou download manual) e autenticado:
#        ngrok config add-authtoken SEU_TOKEN_AQUI
#   3. `npm install` ja executado dentro da pasta consulta-contratos-proxy
#   4. Playwright com o Chromium instalado:
#        npx playwright install chromium

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

$proxyAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$here\start-proxy.ps1`""

$tunnelAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$here\start-tunnel.ps1`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

Register-ScheduledTask -TaskName 'GECOPE-ConsultaContratosProxy' `
    -Action $proxyAction -Trigger $trigger `
    -Description 'Mantem o proxy de consulta de contratos (Ceara Transparente) rodando.' `
    -Force

Register-ScheduledTask -TaskName 'GECOPE-NgrokTunnel' `
    -Action $tunnelAction -Trigger $trigger `
    -Description 'Expoe o proxy de contratos publicamente via ngrok (dominio fixo).' `
    -Force

Write-Host ''
Write-Host 'Tarefas criadas. Para iniciar agora (sem precisar deslogar/logar de novo):'
Write-Host '  Start-ScheduledTask -TaskName GECOPE-ConsultaContratosProxy'
Write-Host '  Start-ScheduledTask -TaskName GECOPE-NgrokTunnel'
Write-Host ''
Write-Host 'A partir do proximo login nesta maquina, ambas iniciam sozinhas.'
