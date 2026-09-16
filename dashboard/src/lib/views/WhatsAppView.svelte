<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { auth } from '../state/auth.svelte';
  import type { WhatsAppInstance } from '../types';
  import GlassPanel from '../components/ui/GlassPanel.svelte';
  import StatusBadge from '../components/ui/StatusBadge.svelte';
  import Button from '../components/ui/Button.svelte';
  import Modal from '../components/ui/Modal.svelte';

  let instances = $state<WhatsAppInstance[]>([]);
  let loading = $state(false);
  let selectedInstance = $state<WhatsAppInstance | null>(null);
  let qrModalOpen = $state(false);
  let pairingCode = $state('8391-2401');

  async function loadInstances() {
    loading = true;
    try {
      instances = await api.fetchWhatsAppInstances(auth.backendUrl, auth.apiKey, auth.accountSlug);
    } finally {
      loading = false;
    }
  }

  function openQrModal(inst: WhatsAppInstance) {
    selectedInstance = inst;
    qrModalOpen = true;
  }

  onMount(() => {
    loadInstances();
  });
</script>

<div class="space-y-6">
  <!-- Top Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="font-display text-2xl sm:text-3xl text-white tracking-tight">Instâncias WhatsApp (Evolution GO)</h1>
      <p class="text-sm text-white/50 font-body">Gerenciamento do pool de instâncias para despacho e canal de OTP.</p>
    </div>

    <Button
      variant="secondary"
      size="sm"
      loading={loading}
      onclick={loadInstances}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <span>Sincronizar Instâncias</span>
    </Button>
  </div>

  <!-- Multi-instance status & Circuit Breaker info -->
  <div class="p-4 rounded-2xl bg-brand-blue/20 border border-blue-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="p-2 rounded-xl bg-blue-500/20 text-blue-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <div>
        <div class="text-sm font-semibold text-white">Pool com Fallback Imediato & Circuit Breaker</div>
        <div class="text-xs text-blue-200/70">Instâncias desconectadas são automaticamente ignoradas no envio de OTP via `CascadeDriver` com timeout rígido de 3.0s.</div>
      </div>
    </div>
  </div>

  <!-- Instances Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each instances as inst}
      <GlassPanel class="flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-start justify-between gap-2 mb-3">
            <div>
              <h3 class="font-display text-lg text-white tracking-tight">{inst.instance_name}</h3>
              <div class="text-xs font-mono text-white/50">{inst.phone}</div>
            </div>
            <StatusBadge status={inst.status} />
          </div>

          <div class="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1.5 text-xs">
            <div class="flex justify-between text-white/60">
              <span>Driver:</span>
              <span class="font-mono text-white">EvolutionGoDriver</span>
            </div>
            <div class="flex justify-between text-white/60">
              <span>Atualizado em:</span>
              <span class="font-mono text-white/80">{new Date(inst.updated_at).toLocaleTimeString('pt-BR')}</span>
            </div>
          </div>
        </div>

        <div class="pt-2 flex gap-2">
          {#if inst.status === 'open'}
            <Button
              variant="secondary"
              size="sm"
              class="w-full"
              onclick={() => alert(`Instância ${inst.instance_name} está conectada e operando normalmente.`)}
            >
              <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Conectado</span>
            </Button>
          {:else}
            <Button
              variant="yellow"
              size="sm"
              class="w-full"
              onclick={() => openQrModal(inst)}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              <span>Conectar WhatsApp</span>
            </Button>
          {/if}
        </div>
      </GlassPanel>
    {/each}
  </div>
</div>

<!-- QR Code & Pairing Modal -->
<Modal
  open={qrModalOpen}
  title={`Parear Instância: ${selectedInstance?.instance_name || ''}`}
  onclose={() => (qrModalOpen = false)}
>
  <div class="space-y-6 text-center">
    <div class="p-6 bg-white rounded-2xl inline-block shadow-2xl border border-white/20 mx-auto">
      <!-- Simulated SVG QR Code -->
      <svg class="w-48 h-48 mx-auto" viewBox="0 0 100 100" fill="none">
        <rect width="100" height="100" fill="#ffffff" />
        <!-- Top-left position probe -->
        <rect x="10" y="10" width="28" height="28" fill="#0b1220" rx="4" />
        <rect x="15" y="15" width="18" height="18" fill="#ffffff" rx="2" />
        <rect x="19" y="19" width="10" height="10" fill="#00734d" rx="1" />
        <!-- Top-right position probe -->
        <rect x="62" y="10" width="28" height="28" fill="#0b1220" rx="4" />
        <rect x="67" y="15" width="18" height="18" fill="#ffffff" rx="2" />
        <rect x="71" y="19" width="10" height="10" fill="#00734d" rx="1" />
        <!-- Bottom-left position probe -->
        <rect x="10" y="62" width="28" height="28" fill="#0b1220" rx="4" />
        <rect x="15" y="67" width="18" height="18" fill="#ffffff" rx="2" />
        <rect x="19" y="71" width="10" height="10" fill="#00734d" rx="1" />
        <!-- Decorative matrix pixels -->
        <rect x="42" y="12" width="6" height="6" fill="#0b1220" />
        <rect x="50" y="12" width="6" height="6" fill="#00734d" />
        <rect x="42" y="24" width="6" height="6" fill="#0b1220" />
        <rect x="42" y="36" width="6" height="6" fill="#ffc400" />
        <rect x="52" y="36" width="6" height="6" fill="#0b1220" />
        <rect x="64" y="44" width="6" height="6" fill="#00734d" />
        <rect x="74" y="44" width="6" height="6" fill="#0b1220" />
        <rect x="44" y="52" width="6" height="6" fill="#0b1220" />
        <rect x="56" y="60" width="6" height="6" fill="#00734d" />
        <rect x="44" y="74" width="6" height="6" fill="#ffc400" />
        <rect x="64" y="74" width="6" height="6" fill="#0b1220" />
        <rect x="80" y="74" width="6" height="6" fill="#00734d" />
      </svg>
    </div>

    <div class="space-y-2">
      <div class="text-xs uppercase tracking-wider text-white/50 font-semibold">Instruções de Conexão</div>
      <p class="text-sm text-white/80 max-w-md mx-auto">
        1. Abra o WhatsApp no aparelho celular.<br/>
        2. Toque em <strong>Configurações &gt; Dispositivos Conectados</strong>.<br/>
        3. Aponte a câmera para o QR Code acima.
      </p>
    </div>

    <!-- Pairing Code Alternative -->
    <div class="p-4 rounded-xl bg-white/5 border border-white/10 max-w-md mx-auto">
      <div class="text-xs text-white/60 mb-1">Ou conecte com código de pareamento numérico:</div>
      <div class="font-mono font-display text-2xl text-brand-yellow tracking-widest">{pairingCode}</div>
    </div>
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (qrModalOpen = false)}>
      Fechar
    </Button>
  {/snippet}
</Modal>
