<script lang="ts">
  import { api } from '../api';
  import { auth } from '../state/auth.svelte';
  import type { ChannelType, SendResult } from '../types';
  import GlassPanel from '../components/ui/GlassPanel.svelte';
  import Button from '../components/ui/Button.svelte';
  import JsonViewer from '../components/ui/JsonViewer.svelte';

  let channel = $state<ChannelType>('whatsapp');
  let recipient = $state('5511999998888');
  let subject = $state('Código de Confirmação');
  let content = $state('Seu código de acesso único é: 849201. Válido por 5 minutos.');
  let isOtp = $state(true);
  let caller = $state('users.auth.otp');
  let idempotencyKey = $state(crypto.randomUUID());
  let enqueue = $state(false);

  let loading = $state(false);
  let lastResult = $state<SendResult | null>(null);
  let latencyMs = $state<number | null>(null);

  function generateNewKey() {
    idempotencyKey = crypto.randomUUID();
  }

  async function handleSend() {
    loading = true;
    lastResult = null;
    const startTime = performance.now();

    try {
      const payload = {
        channel,
        recipient: recipient.trim(),
        content: content.trim(),
        subject: channel === 'email' ? subject.trim() : undefined,
        caller: isOtp ? 'users.auth.otp' : caller.trim() || undefined,
        idempotency_key: idempotencyKey.trim() || undefined,
        enqueue: enqueue && !isOtp,
      };

      const res = await api.sendNotification(auth.edgeUrl, auth.apiKey, auth.accountSlug, payload);
      latencyMs = Math.round(performance.now() - startTime);
      lastResult = res;
    } catch (err: any) {
      latencyMs = Math.round(performance.now() - startTime);
      lastResult = {
        ok: false,
        success: false,
        status: 'failed',
        error: err?.message || 'Falha de comunicação',
      };
    } finally {
      loading = false;
    }
  }
</script>

<div class="space-y-6">
  <!-- Top Bar -->
  <div>
    <h1 class="font-display text-2xl sm:text-3xl text-white tracking-tight">Simulador de Disparo Transacional</h1>
    <p class="text-sm text-white/50 font-body">Envio direto para a borda Cloudflare Worker com validação de regras de OTP e filas.</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Form Panel -->
    <GlassPanel class="space-y-5">
      <h2 class="font-display text-lg text-white">Configurar Disparo</h2>

      <!-- Channel Selector -->
      <div>
        <span class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Canal de Envio</span>
        <div class="grid grid-cols-3 gap-2">
          <button
            type="button"
            onclick={() => {
              channel = 'whatsapp';
              if (recipient.includes('@')) recipient = '5511999998888';
            }}
            class="py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer {channel === 'whatsapp' ? 'bg-brand-green/20 border-brand-green text-emerald-300' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}"
          >
            WhatsApp
          </button>
          <button
            type="button"
            onclick={() => {
              channel = 'email';
              if (!recipient.includes('@')) recipient = 'aluno@exemplo.com.br';
            }}
            class="py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer {channel === 'email' ? 'bg-brand-yellow/20 border-brand-yellow text-brand-yellow' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}"
          >
            E-mail
          </button>
          <button
            type="button"
            onclick={() => (channel = 'all')}
            class="py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer {channel === 'all' ? 'bg-brand-blue/30 border-blue-400 text-blue-300' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}"
          >
            Ambos (Omni)
          </button>
        </div>
      </div>

      <!-- Recipient -->
      <div>
        <label for="sim-recipient-input" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Destinatário</label>
        <input
          id="sim-recipient-input"
          type="text"
          bind:value={recipient}
          placeholder={channel === 'whatsapp' ? '5511999998888' : 'usuario@email.com'}
          class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-brand-green transition-colors"
        />
      </div>

      <!-- Subject if email -->
      {#if channel === 'email' || channel === 'all'}
        <div>
          <label for="sim-subject-input" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Assunto</label>
          <input
            id="sim-subject-input"
            type="text"
            bind:value={subject}
            class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-green transition-colors"
          />
        </div>
      {/if}

      <!-- Message Content -->
      <div>
        <label for="sim-content-input" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Corpo da Mensagem</label>
        <textarea
          id="sim-content-input"
          bind:value={content}
          rows="3"
          class="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-green transition-colors"
        ></textarea>
      </div>

      <!-- Fast-Track OTP Switch -->
      <div class="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold text-white flex items-center gap-2">
            <span>Fast-Track OTP</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-yellow/20 text-brand-yellow">SLA &lt; 3.0s</span>
          </div>
          <div class="text-xs text-white/50">Força `caller: "users.auth.otp"` e desativa enfileiramento lento</div>
        </div>
        <input
          type="checkbox"
          bind:checked={isOtp}
          class="w-5 h-5 rounded text-brand-green accent-brand-green cursor-pointer"
        />
      </div>

      <!-- Async Queue Switch (only if not OTP) -->
      {#if !isOtp}
        <div class="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-white">Cloudflare Queue (Assíncrono)</div>
            <div class="text-xs text-white/50">Despacha para `NOTIFY_QUEUE` na borda</div>
          </div>
          <input
            type="checkbox"
            bind:checked={enqueue}
            class="w-5 h-5 rounded text-brand-green accent-brand-green cursor-pointer"
          />
        </div>
      {/if}

      <!-- Idempotency Key -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label for="sim-idempotency-input" class="text-xs font-semibold text-white/50 uppercase tracking-wider">Chave de Idempotência</label>
          <button
            type="button"
            onclick={generateNewKey}
            class="text-xs text-brand-yellow hover:underline cursor-pointer"
          >
            Novo UUID
          </button>
        </div>
        <input
          id="sim-idempotency-input"
          type="text"
          bind:value={idempotencyKey}
          class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-brand-green transition-colors"
        />
      </div>

      <!-- Submit Button -->
      <Button
        variant="primary"
        size="md"
        class="w-full"
        loading={loading}
        onclick={handleSend}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        <span>Despachar Notificação</span>
      </Button>
    </GlassPanel>

    <!-- Response & Telemetry Panel -->
    <GlassPanel class="space-y-4 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-display text-lg text-white">Telemetria de Resposta</h2>
          {#if latencyMs !== null}
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-xs font-mono {latencyMs < 3000 ? 'text-emerald-400' : 'text-brand-yellow'}">
              <span>latência:</span>
              <span class="font-bold">{latencyMs} ms</span>
            </div>
          {/if}
        </div>

        {#if lastResult}
          <div class="space-y-4">
            <!-- Outcome Alert -->
            <div class="p-4 rounded-xl border {lastResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'}">
              <div class="font-display text-base mb-1">
                {lastResult.success ? 'Notificação Aceita / Despachada com Sucesso' : 'Falha no Processamento'}
              </div>
              <div class="text-xs font-mono">
                Status: {lastResult.status} {#if lastResult.id}| ID: {lastResult.id}{/if}
              </div>
            </div>

            <!-- JSON telemetry details -->
            <div>
              <div class="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">Payload de Retorno da Borda</div>
              <JsonViewer data={lastResult} maxHeight="300px" />
            </div>
          </div>
        {:else}
          <div class="h-64 flex flex-col items-center justify-center text-white/30 space-y-3">
            <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span class="text-xs">Configure o formulário ao lado e clique em Despachar.</span>
          </div>
        {/if}
      </div>

      <!-- Quick Info -->
      <div class="p-3 rounded-xl bg-white/5 border border-white/5 text-[11px] text-white/50 space-y-1">
        <div><strong>Destino da Borda:</strong> {auth.edgeUrl}/v1/send</div>
        <div><strong>Idempotência:</strong> TTL de 60s para OTPs; replay seguro sem duplicação de SMS/WhatsApp.</div>
      </div>
    </GlassPanel>
  </div>
</div>
