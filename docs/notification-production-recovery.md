# Recuperação de notificações em produção — 09/10/2026

Este documento registra evidência técnica e pendências. Homologação pertence ao usuário. Testes locais não demonstram entrega real em produção.

## Evidência da instalação canônica

A instalação ativa é a VM Azure `vm-v7m-core`, em `/opt/v7m-platform`. Configurações Proxmox e endereços `10.0.1.*` encontrados nos defaults são legados. O backend chama o notify pela rede Docker; o domínio público também tem um Worker na borda e deve ser conferido separadamente.

A investigação coordenada encontrou notificações `lead.captured` com e-mail enviado e WhatsApp falho após três tentativas. A instância GO estava desconectada. Os logs do GO registraram `pq: too many clients already`. A frente de infraestrutura observou 197 conexões ociosas no banco `evogo_auth`, mesmo após elevar o limite global: portanto aumentar o limite não elimina a causa.

O comportamento coincide com o vazamento de pools em reconexões descrito no [issue oficial Evolution GO #118](https://github.com/evolution-foundation/evolution-go/issues/118). A coordenação aplicou `idle_session_timeout='5min'` apenas ao role/banco de autenticação do GO e reiniciou o GO uma vez. A contagem caiu para uma conexão ociosa após o reinício. Essa mitigação ainda precisa de observação contínua e de uma versão do fornecedor que elimine o vazamento.

## Essencial para operar

1. Receber uma mensagem já pronta do backend, com conta, destinatários e idempotência. O gateway não precisa de IA para entregar cobrança, OTP ou mudança de status.
2. Persistir a notificação antes do despacho e representar separadamente a aceitação, o envio e a entrega confirmada pelo fornecedor.
3. Ter conta remetente e identidade de cada canal configuradas. Um número de outra conta não é fallback implícito.
4. Usar a mesma credencial válida entre backend, borda e notify. O público não pode acessar históricos ou enviar usando a conta default sem autenticação.
5. Executar o worker e o watchdog persistido. Uma tabela de fila acessível não prova processamento nem sessão WhatsApp conectada.
6. Repetir apenas o canal com falha transitória e preservar os canais já enviados. Falha final precisa permanecer visível na notificação e na task.

## Correções locais preparadas

- Infisical desligado por default, sem endereço, projeto ou credencial fixa. A integração requer configuração explícita. Falhas têm cache de espera para não consultar o cofre a cada envio.
- IA de adaptação e transcrição de saída desligadas por default; mensagens essenciais seguem o conteúdo recebido. Novas contas não recebem URL ou chave de IA de ambiente legado.
- `NOTIFY_REQUIRE_AUTH=True` por default. Credenciais válidas consultam `ApiKey`, limitada à conta ativa. O modo legado sem chave exige configuração explícita de rede privada. MCP aplica a mesma exigência para consultar ou alterar dados.
- Pool WhatsApp limitado à conta tanto no despacho comum quanto no OTP. Configuração de outro tenant produz falha explícita.
- Conexões abertas pelas threads dos canais são fechadas ao terminar. `DB_CONN_MAX_AGE` tem default zero.
- Erros ao construir drivers ou executar canais viram `failed`, sem deixar `sending` órfão. Falha definitiva assíncrona levanta `DispatchFailedError`; a task não pode aparecer como bem-sucedida.
- OTP e pedidos síncronos retornam HTTP 503 quando algum canal solicitado não enviou; a resposta mostra `failed` ou `partial` e os estados por canal. Um UUID não representa envio bem-sucedido. Repetir a mesma chave conserva o canal já enviado.
- A borda usa a mesma chave de idempotência na origem e na Queue, inclusive após timeout. Falha síncrona não gera cache de sucesso nem fallback silencioso na Queue: OTP devolve 502 e demais pedidos síncronos 503.
- `delivery_ready` distingue entrega operacional da capacidade de aceitar/enfileirar. Exige observações recentes de WhatsApp, e-mail e fila. Histórico ausente ou antigo é indisponível.
- GO saudável exige `Connected=True` e `LoggedIn=True`. Watchdog não reconecta por default. Se a recuperação automática for explicitamente habilitada, usa uma tentativa persistida por interrupção; novas tentativas forçadas são operação manual.
- `ensure_notify_watchdog` instala a schedule de monitoração de forma idempotente, sem agendar canários ou fazer envios reais.

## Implantação coordenada

1. Guardar imagem anterior, configuração e backup do banco. Conferir diff concorrente do Dockerfile, mail e edge antes de integrar.
2. Provisionar uma `ApiKey` ativa na conta usada pelo backend, armazenando somente seu hash SHA-256. Configurar o segredo correspondente nos chamadores e na borda antes de exigir autenticação. Não registrar o segredo em logs ou neste documento.
3. Publicar imagem sem `.env` embutido; aplicar migration `accounts.0005`. Ela altera defaults e preserva valores das contas existentes, que precisam ser auditados separadamente.
4. Manter `INFISICAL_ENABLED=False`, `DB_CONN_MAX_AGE=0`, `AI_ADAPT_ENABLED=False`, `AI_TRANSCRIBE_OUTBOUND_ENABLED=False`, `WATCHDOG_AUTO_HEAL_ENABLED=False` e `CANARY_ENABLED=False` enquanto se estabiliza o incidente.
5. Executar `python manage.py ensure_notify_watchdog` na instalação canônica e confirmar processamento da schedule pelo qcluster.
6. Conferir autenticação de leitura pelo backend/edge, saúde recente, filas e falhas persistidas. Verificar também a rota pública, que não é o mesmo caminho usado pelo backend interno.
7. Recuperar a sessão WhatsApp e observar as conexões do banco durante pelo menos duas janelas do timeout. Não executar reconexões forçadas em loop.
8. Reconciliar falhas existentes com cuidado: notificação falha não autoriza reenviar canais `sent`, OTP expirado ou cobranças antigas. Usar IDs originais e estado de negócio atual; envio real é responsabilidade da coordenação.

## Critérios técnicos para declarar operação

- Conta autentica e rejeita chave ausente, inválida ou revogada no público.
- Worker executa o watchdog e `delivery_ready` reflete estado recente dos provedores.
- Sessão WhatsApp permanece conectada e as conexões SQL não crescem continuamente.
- Uma notificação operacional com os canais existentes registra aceite do fornecedor por canal; confirmação de entrega fica vinculada ao ID retornado.
- Falhas transitórias reaparecem apenas nos canais pendentes; falhas finais permanecem visíveis e não viram sucesso na fila.
- Cobrança e mudança de role/status são reconciliadas pelo backend sem duplicar pagamento nem suprimir a notificação essencial.

Estes critérios ainda exigem evidência de produção após a implantação e recuperação da sessão. Nenhuma notificação real foi enviada por esta frente durante os testes locais.

Verificação técnica local desta frente: 328 testes Python e 56 testes da borda passaram. Foram conferidos compileall, ausência de migration adicional pendente e diff do escopo sem erros de whitespace. Os cenários novos exercitam a API HTTP e o despacho reais com Evolution GO simulado indisponível, replays e entrega parcial, sem envios de rede.
