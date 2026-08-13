# Mantem o consulta-contratos-proxy rodando nesta maquina, reiniciando
# sozinho se o processo cair (crash, atualizacao do Node, etc).
$ErrorActionPreference = 'Continue'
Set-Location -Path (Split-Path -Parent $PSScriptRoot)

while ($true) {
    node index.js
    Start-Sleep -Seconds 5
}
