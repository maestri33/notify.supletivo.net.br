# Issue #001: Pós-Morte — Falha na Entrega de Notificações WhatsApp via Evolution GO (Erro 405, Sessão JID e Triagem)

**Data do Incidente:** 06/11/2026  
**Severidade:** Crítica (P1 - Bloqueio de envio de OTP e notificações transacionais)  
**Status:** Resolvido e Homologado em Produção  
**Impacto:** Usuários e Alunos temporariamente impossibilitados de receber códigos OTP via WhatsApp.

---

## 1. Resumo Executivo
No dia 06/11/2026, as notificações transacionais via WhatsApp (incluindo OTP de autenticação do `app.supletivo.net.br` e mensagens do `notify.supletivo.net.br`) deixaram de ser entregues, culminando em timeouts (503) e falhas operacionais.

Após investigação detalhada no ambiente de produção (`vm-v7m-core` na Azure), identificamos e solucionamos quatro causas raízes concorrentes. O sistema foi 100% restaurado e testado com sucesso para o número institucional do mantenedor.

---

## 2. Causas Raízes Técnicas

### 2.1. Handshake do WhatsApp rejeitado com Erro 405 (Client Outdated)
* **Mecanismo:** A imagem oficial `evoapicloud/evolution-go:latest` (e a tag `0.7.2-beta`) foi compilada com uma versão estática da biblioteca Go `whatsmeow` datada de junho de 2026 (`client version: 2.3000.1042386815`).
* **Trigger:** Os servidores do WhatsApp subiram a exigência de versão para `2.3000.1053420930+` e passaram a fechar o socket do WebSocket com o evento `*events.ClientOutdated` (HTTP 405).
* **Consequência:** A conexão caía imediatamente com EOF. Nenhuma instância conseguia gerar QR code (`400 no QR code available`) nem parear (`500 websocket disconnected`), pendurando qualquer requisição de envio do notify com timeout 503.

### 2.2. Dessincronização de Estado: `instances.jid` vazio vs. `whatsmeow_device`
* **Mecanismo:** No banco PostgreSQL (`evogo_auth`), a tabela `whatsmeow_device` continha as chaves de criptografia e o JID do dispositivo do mantenedor (`554284321915:2@s.whatsapp.net`).
* **Trigger:** Na tabela `instances` (`evogo_users`), o campo `jid` da instância ativa constava como vazio (`""`).
* **Consequência:** Ao inicializar, o Evolution GO não associava a instância ao dispositivo existente gravado no banco, assumindo que era uma sessão virgem ("Creating new device"). O celular do mantenedor acusava "Conectado", mas o servidor da aplicação não assumia o canal.

### 2.3. Case Sensitivity no Dashboard HTMX (`notify/dashboard.py`)
* **Mecanismo:** O endpoint `/dashboard/app/<slug>/whatsapp/qr` buscava a imagem do QR code com:
  ```python
  imagem = str((inner or {}).get("qrcode") or (inner or {}).get("QRCode") or "")
  ```
* **Trigger:** A Evolution GO devolve o payload JSON em PascalCase estrito: `"Qrcode"`.
* **Consequência:** A chave vinha sempre nula, o dashboard nunca renderizava a imagem do QR Code e caía em um loop infinito de 4s exibindo a mensagem "Instância desconectada. Gerando QR Code...".

### 2.4. Estouro de Limite Varchar no Webhook Inbound (`DataError`)
* **Mecanismo:** No recebimento de mensagens e confirmações de entrega, o motor de triagem cognitiva Jev (TypeSafe System One) classificava o evento com `triage_source = "typesafe_systemone"` (18 caracteres).
* **Trigger:** O modelo Django `InboundEvent` definia `triage_source = models.CharField(max_length=16)`.
* **Consequência:** Toda mensagem recebida causava `django.db.utils.DataError: value too long for type character varying(16)`, travando o processamento do webhook com HTTP 500 no `notify-web`.

---

## 3. Ações Corretivas Executadas em Produção

1. **Compilação e Deploy da Imagem Corrigida (`v7m/evolution-go:pr230`):**
   * Puxamos a correção do PR #230 do repositório `evolution-foundation/evolution-go`, que atualiza dinamicamente o `store.BaseClientPayload.UserAgent.AppVersion` durante o handshake do WebSocket.
   * Compilamos a imagem `v7m/evolution-go:pr230` diretamente na VM de produção (`vm-v7m-core`) e atualizamos o Docker Compose.
2. **Reconciliação do Banco de Dados da Evolution:**
   * Vinculamos `instances.jid = '554284321915:2@s.whatsapp.net'` no banco `evogo_users`. O serviço reatou a sessão ativa sem demandar novo pareamento.
3. **Correção do Parser de QR Code:**
   * Ajustado `notify/dashboard.py` para mapear `"Qrcode"`, `"QRCode"` e `"qrcode"`.
4. **Adequação do Esquema do Banco de Dados:**
   * Alterados os campos `triage_source` e `urgency_level` para `varchar(32)` com migração `0009` no `notify` e comando executado no PostgreSQL de produção.
5. **Teste End-to-End Realizado:**
   * Disparado teste oficial de OTP para o número `43996648750`.
   * Código `490525` recebido no WhatsApp em menos de 1 segundo (recibo `3EB02C5D7BE6F299EFB6CF`).
   * Validação de login efetuada no endpoint `POST /api/v1/clients/auth/login`, emitindo tokens JWT válidos com perfil administrativo e de aluno.

---

## 4. Medidas Preventivas Obrigatórias (Para Não Repetir o Problema)

1. **Travamento de Imagem da Evolution:**
   * NUNCA utilizar a tag `:latest` da Evolution GO. Sempre utilizar tags fixas ou a imagem homologada `v7m/evolution-go:pr230`.
2. **Healthcheck e Monitoramento Proativo de Handshake:**
   * Configurar probe periódica no endpoint `/instance/status`. Se `Connected == false` ou `LoggedIn == false` por mais de 5 minutos com instância provisionada, disparar alerta prioritário.
3. **Auditoria de Esquema Pydantic vs Modelos Django:**
   * Todos os enums e identificadores de fontes de triagem TypeSafe devem ser testados contra os limites de caracteres dos modelos de banco de dados (`max_length`).
4. **Isolamento de Credenciais de Sessão:**
   * Ao manipular instâncias via API (`/instance/create` ou `/instance/delete`), garantir que o vínculo do `jid` da sessão persistida seja checado antes de forçar novo pareamento desnecessário.
