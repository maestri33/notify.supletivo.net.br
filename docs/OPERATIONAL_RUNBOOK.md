# 📖 Manual Operacional e Runbook de Contingência — Notify Gateway

> **Visão Geral**: O Notify é uma plataforma de mensageria multicanal (WhatsApp e E-mail) **genérica e multi-tenant**, projetada para atender qualquer produto ou plataforma (ex: Supletivo, E-commerce, Plataformas Educacionais, CRMs, Finanças).

---

## 🏗️ 1. Arquitetura dos Ambientes e Provedores WhatsApp

| Ambiente | Provedor WhatsApp | Endereço / Porta | Função e Comportamento |
| :--- | :--- | :--- | :--- |
| **PRODUÇÃO** | **Evolution Go** | Cluster de Produção (Go / whatsmeow) | Motor oficial de alta performance, baixa latência e concorrência massiva. Utiliza o driver `EvolutionGoDriver` (`whatsapp/evolution_go.py`). |
| **TESTES / DEV** | **Evolution API (Node)** | `http://192.168.80.1:8085` | Ambiente de bancada local para testes, homologação e depuração sem afetar os números de produção. |

---

## 🏢 2. Multi-Tenancy: Como Adicionar uma Nova Plataforma Parceira

O Notify não é restrito a uma única empresa. Cada nova aplicação opera como um **Tenant Isolado**.

### Passo a Passo para Provisionar uma Nova Plataforma:

Execute a chamada administrativa para criar a conta e credenciais automaticamente:

```bash
POST https://notify.v7m.live/v1/admin/apps
Headers:
  Authorization: Bearer <MASTER_ADMIN_KEY>
  Content-Type: application/json

Payload:
{
  "slug": "plataforma-exemplo",
  "name": "Plataforma Exemplo SaaS",
  "phone_number": "5543999998888",
  "instance_name": "instancia-exemplo-go",
  "email_domain": "exemplo.com.br",
  "webhook_url": "https://api.exemplo.com.br/webhooks/notify"
}
```

### O que o Provisionamento Faz Automaticamente:
1. **Cria o Tenant (`Account`)**: Com isolamento completo de banco e métricas.
2. **Gera a Chave de API (`ApiKey`)**: A plataforma chamadora recebe seu token Bearer próprio.
3. **Instância de WhatsApp (`WhatsAppNumber`)**: Vincula a instância dedicada na Evolution Go. Uma conta **nunca** tem permissão de disparar pelo número de outro tenant.
4. **Identidade de E-mail (`MailIdentity`)**: Configura remetente (`contato@exemplo.com.br`), logotipo e cores do template.

---

## 🚨 3. Guia de Manipulação em Caso de Falha Total (Disaster Recovery)

### Cenário 1: A Borda Cloudflare Caiu (ou Domínio `notify.v7m.live` Indisponível)
* **O que acontece**: Chamadas externas na URL pública não chegam.
* **Como contornar**:
  Suas aplicações internas podem chavear o tráfego para a origem backend direta via rede interna/VPN:
  ```bash
  POST http://<IP_DO_BACKEND>:8000/v1/send
  Headers:
    Authorization: Bearer <API_KEY_DO_TENANT>
    Content-Type: application/json
  ```
  O backend processará e despachará normalmente sem depender da Cloudflare.

---

### Cenário 2: O Backend Central Caiu
* **O que acontece**:
  * Envios síncronos / OTP: Recebem HTTP 502/503 imediatamente na borda para permitir que a aplicação tente um canal alternativo (ex: SMS).
  * Envios comuns (assíncronos): **Não são perdidos**. A borda da Cloudflare retém todas as mensagens na Cloudflare Queue (`notify-events`) com retenção de até 4 dias.
* **Como recuperar**:
  Acesse o servidor e reinicie os containers do núcleo:
  ```bash
  docker compose restart notify-web notify-worker
  ```
  Assim que o backend responder, a Cloudflare Queue drena automaticamente e entrega todas as mensagens acumuladas.

---

### Cenário 3: Uma Instância de WhatsApp Desconectou na Evolution Go
* **O que acontece**: As mensagens para aquele tenant falham com erro `WhatsAppSessionDown` e são registradas no banco como `failed`.
* **Como reconectar**:
  1. Acesse o Dashboard em `https://notify.v7m.live/dashboard/` (ou pelo IP local).
  2. Localize a instância do Tenant.
  3. Solicite novo QR Code e escaneie pelo aplicativo do WhatsApp no aparelho do tenant.
  4. O watchdog automático verifica a saúde a cada 60s e reativa o status para `open`.

---

### Cenário 4: Testes Locais sem Afetar a Produção
Para rodar testes de integração contra a Evolution Node local (192.168.80.1:8085):
```bash
curl -X POST http://192.168.80.1:8085/message/sendText/default \
  -H "apikey: <LOCAL_DEV_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5543996648750",
    "text": "[TESTE DE BANCADA] Validando instância local de desenvolvimento"
  }'
```
