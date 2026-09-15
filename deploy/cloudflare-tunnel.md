# Cloudflare Tunnel & Proxmox Zero-Trust Architecture

Este documento descreve a topologia híbrida de conectividade segura entre a Borda Serverless da Cloudflare e os nós de processamento pesado no Proxmox VE.

---

## 1. Topologia e Princípio "Zero Portas Abertas"

Nenhum serviço interno no Proxmox possui IP público ou portas expostas na WAN:

```
[ Usuário / Aluno / API Externa ]
               │
               ▼
   [ Cloudflare Edge Worker ] (notify.supletivo.net.br)
         │           │
         │ (Cache/D1/R2/Workers AI)
         │
         ▼ (Via Cloudflare Tunnel Privado / Zero Trust)
   ┌─────────────────────────────────────────────────┐
   │ Proxmox VE (Rede Local / Tailscale 10.0.1.0/24)  │
   │                                                 │
   │   [ cloudflared daemon ]                        │
   │        │                    │                   │
   │        ▼                    ▼                   │
   │   Evolution GO         Stalwart Mail            │
   │   (10.0.1.30:8080)     (10.0.1.20:8080)         │
   └─────────────────────────────────────────────────┘
```

---

## 2. Configuração do `cloudflared` no Proxmox

Arquivo de configuração `/etc/cloudflared/config.yml`:

```yaml
tunnel: notify-proxmox-tunnel
credentials-file: /etc/cloudflared/credentials.json

ingress:
  # Roteamento interno para Evolution GO (WhatsApp Engine)
  - hostname: evolution-internal.supletivo.net.br
    service: http://10.0.1.30:8080
    originRequest:
      noTLSVerify: true
      connectTimeout: 15s

  # Roteamento interno para Stalwart Mail Server (JMAP & Webhooks)
  - hostname: mail-internal.supletivo.net.br
    service: http://10.0.1.20:8080
    originRequest:
      noTLSVerify: true
      connectTimeout: 15s

  # Catch-all seguro (rejeita requisições não mapeadas)
  - service: http_status:404
```

---

## 3. Comandos de Ativação do Serviço no Proxmox VE

```bash
# 1. Instalar cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb

# 2. Criar túnel autenticado
cloudflared tunnel login
cloudflared tunnel create notify-proxmox-tunnel

# 3. Associar rotas de DNS privadas
cloudflared tunnel route dns notify-proxmox-tunnel evolution-internal.supletivo.net.br
cloudflared tunnel route dns notify-proxmox-tunnel mail-internal.supletivo.net.br

# 4. Instalar como systemd service e iniciar
cloudflared service install
systemctl enable --now cloudflared
```

---

## 4. Proteção com Cloudflare Zero Trust (Service Tokens)

Para comunicação entre Cloudflare Workers e os endpoints tunelados:
1. No Cloudflare Zero Trust Dashboard, crie uma **Access Application** para `*.supletivo.net.br`.
2. Gere um **Service Token** (`CF-Access-Client-Id` e `CF-Access-Client-Secret`).
3. O Worker adiciona esses cabeçalhos em cada requisição destinada ao Proxmox.
4. Qualquer requisição sem esses tokens é bloqueada na borda antes de alcançar o Proxmox.
