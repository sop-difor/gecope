# Deploy do whatsapp-proxy + Evolution API

Passos manuais para colocar o stack no ar numa VM (ex.: Oracle Cloud Always Free).

## 1. Provisionar a VM

Criar uma instância gratuita (Oracle Cloud Always Free recomendado — VM ARM Ampere,
gratuita para sempre). Instalar Docker e o plugin Docker Compose:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# reabrir a sessão SSH para o grupo fazer efeito
```

Liberar no firewall/security group da VM (e no `iptables`/`ufw` do próprio SO, se
aplicável) as portas **80** e **443** (usadas pelo Caddy para emitir e servir o
certificado TLS). A Evolution API e o proxy web NÃO precisam de porta nenhuma liberada
externamente — só o Caddy fala com a internet.

## 2. Apontar o domínio

Criar um registro DNS tipo A apontando um (sub)domínio (ex.: `whatsapp.seudominio.com`)
para o IP público da VM. O Caddy só consegue emitir o certificado Let's Encrypt depois
que esse DNS estiver propagado.

## 3. Configurar o `.env`

Dentro de `server/whatsapp-proxy/` na VM:

```bash
cp .env.example .env
```

Preencher no `.env`:
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase > Project Settings > API > service_role (nunca a
  anon key aqui)
- `SUPABASE_ANON_KEY` — a mesma anon key pública já usada em `config.js` do front-end
- `EVO_API_KEY` — gere uma chave nova, forte e aleatória (nunca reutilize a chave antiga
  que já ficou exposta no front-end)
- `DOMAIN` — o domínio configurado no passo 2

`SUPABASE_URL` e `EVO_INSTANCE` já vêm preenchidos com os valores corretos do projeto.

## 4. Subir o stack

```bash
cd server/whatsapp-proxy
docker compose up -d --build
docker compose logs -f
```

Aguardar até `whatsapp-proxy-web` reportar healthcheck OK (`docker compose ps` deve
mostrar `healthy`) e o Caddy conseguir emitir o certificado (aparece nos logs do serviço
`caddy`).

## 5. Confirmar

```bash
curl https://SEU_DOMINIO/health
# deve responder "ok"
```

## 6. Parear o WhatsApp

Direto pelo painel do GECOPE (aba de configuração de WhatsApp, tela de status/QR code,
endpoint `GET /api/whatsapp/instance/qrcode`, admin-only) — escaneie o QR exibido ali.
Isso vale tanto para o pareamento inicial quanto para qualquer reconexão futura; não é
mais necessário acessar a VM diretamente para isso.

## 7. Confirmar persistência de sessão

Depois de parear:

```bash
docker compose restart evolution-api
```

Aguardar o container voltar e checar o status no painel do GECOPE — se pedir QR code de
novo, os volumes (`evolution_instances`/`evolution_store`) não estão persistindo
corretamente para a versão da imagem usada; ajustar os paths no `docker-compose.yml`
conforme a documentação da versão fixada da `atendai/evolution-api`.
