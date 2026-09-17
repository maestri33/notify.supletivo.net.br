# 📋 Gateway de Notificações (`services/notify`) — Handoff Técnico

> **Última Atualização:** 17 de Setembro de 2026  
> **Status:** Em Validação com o Usuário / Homologação de Inbound Email

---

## 🎯 1. Escopo das Alterações Recentes

### 1.1. Arquitetura Agentic Inbox & Cloudflare Email Routing (Issue #6)
- **Inbound Agentic Worker (`edge/src/email-handler.ts`)**:
  - Event handler nativo `email()` integrado ao ciclo do Cloudflare Email Routing.
  - Parsing de envelopes RFC 2822 / MIME com `postal-mime` (remetente, assunto, texto limpo, HTML e anexos).
  - Triagem por IA na borda com Workers AI (`@cf/meta/llama-3-8b-instruct`), classificando intenções (`duvida_matricula`, `envio_documentos`, `comprovante_pagamento`, `suporte`, `spam`).
  - Extração automática de entidades (CPF, telefone, nome do aluno) e geração de minuta imediata de resposta.
  - Armazenamento de anexos recebidos no Cloudflare R2 com URLs protegidas.
- **Persistência de Sessão e Threads no Cloudflare D1 (`edge/migrations/0002_email_inbox.sql`)**:
  - Tabelas `email_threads` e `inbound_emails` para controle de contexto multi-turn entre remetente e IA.
- **Outbox Transacional Resiliente (`mail/cloudflare_sending.py`)**:
  - Cliente assíncrono para o Cloudflare Email Sending REST API (v4). Blindagem de reputação contra filtros anti-spam de Gmail e Outlook para mensagens críticas (OTP/Boas-vindas), mantendo o Stalwart como fallback.

### 1.2. Separação Estrita de Responsabilidades (Templates & TTS no Backend)
- **Eliminação de Templates no Notify:**
  - O Notify Server opera como gateway puro de despacho e entrega multicanal (WhatsApp via Evolution Go, E-mail via Stalwart JMAP/SMTP e Webhooks).
  - Todo o gerenciamento e renderização de templates pertence exclusivamente ao `services/backend`.
- **Eliminação de Síntese de TTS no Notify:**
  - O Notify recebe diretamente o áudio pronto através do payload (`media_url`, `media_type="audio"`).

### 1.3. Evolution Go 0.7.2 & Persistência de Sessão
- **Diagnóstico da Licença (`503 LICENSE_REQUIRED`):**
  - A licença do Evolution Go reside na tabela `runtime_configs` do banco `evogo_users` (`instance_id`, `api_key`, `tier`, `customer_id`).
- **Sessões WhatsApp (`whatsmeow_*`):**
  - Residem no banco `evogo_auth`.
  - A reconexão sem novo QR code é executada via `POST /instance/connect` ou rotina de auto-heal do watchdog (`notify/watchdog.py`).
- **Configuração de Ambiente no Docker Compose:**
  - `NOTIFY_DATABASE_URL` isolada de `DATABASE_URL` (para evitar conflito com instâncias de banco remotas/Neon durante desenvolvimento).

---

## 🛠️ 2. Arquivos Modificados / Criados

- `docker-compose.yml`:
  - `notify-web` e `notify-worker` utilizam `NOTIFY_DATABASE_URL: ${NOTIFY_DATABASE_URL:-postgresql://notify:v7m-local-password@postgres:5432/notify}`.
  - `backend-web` e workers utilizam `BACKEND_DATABASE_URL: ${BACKEND_DATABASE_URL:-postgresql://backend:v7m-local-password@postgres:5432/backend}`.
  - `evolution-go` com `POSTGRES_AUTH_DB` e `POSTGRES_USERS_DB` desacoplados de `DATABASE_URL` (garantindo carregamento da licença ativa `0105590c-...` e sessões `whatsmeow_*` do Postgres local).
- `services/notify/notify/watchdog.py`:
  - Watchdog ativo monitorando `evolution-go`, `mailcow`/`stalwart`, `omnirouter` e `queue`.

---

## 🧪 3. Validação Executada
 
 - **Suíte Vitest Edge Worker:** 28 testes aprovados (100% green), incluindo validação do `email-handler.spec.ts` com inferência mockada de IA.
 - **Suíte Pytest Notify:** 304 testes aprovados (0 falhas), incluindo os novos testes unitários assíncronos do `test_cloudflare_email_sending.py`.
 - **Saúde dos Containers:** `v7m-notify-web`, `v7m-notify-worker` e `v7m-evolution-go` em execução e saudáveis (`healthy`).
 - **Watchdog Tick:** Todos os 4 serviços com status `ok: True` (`evolution-go`, `mailcow`/`stalwart`, `omnirouter`, `queue`).
 - **Instâncias WhatsApp:** Sessões ativas e reconectadas (`ieadpg`, `victor-maestri` em status `open`).
 - **Envios Multicanal:** Envios de e-mail via Stalwart JMAP/SMTP processados com status `sent` e Message-IDs registrados no banco.
 - **Endpoint `POST /notify`:** Claim & dispatch operando com resposta síncrona/assíncrona e isolamento de templates no backend.
