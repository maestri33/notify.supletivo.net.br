# AI & Engineering Guidelines — `notify.supletivo.net.br`

> **DIRETIVA MANDATÓRIA**: As diretrizes gerais do ecossistema estão centralizadas em **[`supletivo.net.br/AGENTS.md`](../supletivo.net.br/AGENTS.md)**.
> Todo agente que operar neste serviço deve seguir estritamente as regras de isolamento, soberania do usuário e padrões de engenharia.

---

## 🚨 1. REGRA INVIOLÁVEL DE TESTES DE DISPARO REAL

### ⛔ PROIBIÇÃO ABSOLUTA DE DADOS GENÉRICOS OU MOCKS
É **terminantemente proibido** utilizar números genéricos, fictícios ou de teste falso (ex.: `11999999999`, `5511999998888`, `test@example.com`, etc.) em scripts de teste, homologação, validação ponta a ponta ou chamadas de API manual.

### ✅ DESTINATÁRIO REAL OBRIGATÓRIO (VICTOR MAESTRI)
Todo e qualquer teste de envio real (E2E, homologação multicanal, verificação de entrega) **DEVE UTILIZAR OBRIGATORIAMENTE** os dados de contato particulares reais do Victor:
- **WhatsApp / Telefone Particular**: `+5543996648750` (formato E.164 ou `5543996648750`)
- **E-mail Particular**: `victormaestri@gmail.com`

---

## 📡 2. GARANTIA DE ENTREGA MULTICANAL

- **WhatsApp + E-mail Sempre Ativos**: Toda notificação voltada a usuários, promotores, coordenadores e leads deve garantir entrega simultânea multicanal (`whatsapp,email`), salvo quando o usuário expressamente não possuir um dos canais ou a regra de negócio for estritamente single-channel (ex.: OTP SMS/WhatsApp).
- **Tratamento de Falha e Fallback**:
  - E-mail: Cloudflare Email Sending (REST v4) como prioritário / Stalwart Mail Server (JMAP/SMTP) em alta disponibilidade.
  - WhatsApp: Evolution Go com auto-reconexão de sessão (`whatsmeow_*`) e watchdog de saúde.

---

## 🏛️ 3. ARQUITETURA E SEPARAÇÃO DE RESPONSABILIDADES

1. **Gateway Puro**: O `notify-server` é estritamente um despachante multicanal. Ele recebe a mensagem pronta, destinatário e mídia, realizando a entrega e registrando a auditoria em banco.
2. **Templates Pertencem ao Backend**: Todo o gerenciamento, interpolação de variáveis (`{nome}`, `{link}`, etc.), regras de negócio e catálogo de templates residem no `services/backend` (`backend.supletivo.net.br/notify/seed/templates.md`).
3. **TTS no Backend**: A síntese de voz (áudio para WhatsApp) é gerada pelo backend antes do envio e repassada via `media_url` para o notify.
4. **Shells HTML**: O notify provê apenas os wrappers HTML seguros (`supletivo.html`, `institucional.html`) onde o Markdown do backend é injetado.

---

## 👑 4. SOBERANIA DO USUÁRIO
Apenas o Victor aprova, homologa e valida entregas e modificações de infraestrutura.
