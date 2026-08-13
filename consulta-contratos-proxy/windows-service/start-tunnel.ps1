# Mantem o tunel ngrok rodando, reiniciando sozinho se cair.
# Dominio fixo gratuito da conta ngrok (Dashboard > Setup & Installation).
param(
    [string]$Domain = 'babied-average-mulch.ngrok-free.dev'
)

$ErrorActionPreference = 'Continue'

while ($true) {
    ngrok http --url="https://$Domain" 3000
    Start-Sleep -Seconds 5
}
