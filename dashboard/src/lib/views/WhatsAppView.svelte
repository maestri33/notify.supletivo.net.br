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
  let connectModalOpen = $state(false);
  let connectLoading = $state(false);
  let newInstanceName = $state('principal');
  let newPhoneNumber = $state('+5543996648750');
  let returnedCode = $state<string | null>(null);

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

  async function handleConnect() {
    if (!newInstanceName.trim() || !newPhoneNumber.trim()) return;
    connectLoading = true;
    returnedCode = null;
    try {
      const res = await api.connectWhatsApp(auth.backendUrl, auth.apiKey, {
        instance_name: newInstanceName.trim(),
        phone_number: newPhoneNumber.trim().replace(/\D/g, ''),
        account_slug: auth.accountSlug,
      });
      if (res.success) {
        if (res.code) {
          returnedCode = res.code;
        } else {
          alert('Instância registrada no banco e fila de conexão iniciada!');
          connectModalOpen = false;
        }
        await loadInstances();
      } else {
        alert(`Erro ao conectar: ${res.error || 'Falha na conexão'}`);
      }
    } finally {
      connectLoading = false;
    }
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

    <div class="flex items-center gap-3">
      <Button
        variant="primary"
        size="sm"
        onclick={() => (connectModalOpen = true)}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span>Adicionar Instância</span>
      </Button>

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
  {#if instances.length === 0}
    <GlassPanel class="text-center py-12 space-y-3">
      <div class="p-3 rounded-full bg-white/5 inline-block text-white/40">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <div class="text-base font-display text-white">Nenhuma Instância Cadastrada</div>
      <p class="text-xs text-white/50 max-w-sm mx-auto font-body">
        Não há instâncias da Evolution GO configuradas para esta conta no banco de dados. Cadastre sua instância no backend para gerenciar o pool de disparos.
      </p>
    </GlassPanel>
  {:else}
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
  {/if}
</div>

<!-- QR Code & Pairing Modal -->
<Modal
  open={qrModalOpen}
  title={`Parear Instância: ${selectedInstance?.instance_name || ''}`}
  onclose={() => (qrModalOpen = false)}
>
  <div class="space-y-6 text-center">
    {#if selectedInstance?.qr_code_url}
      <div class="p-4 bg-white rounded-2xl inline-block shadow-2xl border border-white/20 mx-auto">
        <img
          src={selectedInstance.qr_code_url}
          alt="QR Code WhatsApp"
          class="w-48 h-48 mx-auto"
        />
      </div>
    {:else}
      <div class="p-8 rounded-2xl bg-white/5 border border-white/10 max-w-md mx-auto text-white/50 text-xs space-y-2">
        <svg class="w-10 h-10 mx-auto text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
        <p>Aguardando disponibilização do stream do QR Code pela Evolution GO...</p>
      </div>
    {/if}

    <div class="space-y-2">
      <div class="text-xs uppercase tracking-wider text-white/50 font-semibold">Instruções de Pareamento</div>
      <p class="text-sm text-white/80 max-w-md mx-auto font-body">
        Abra o WhatsApp no celular, vá em <strong>Configurações &gt; Dispositivos Conectados</strong> e aponte para o QR Code da instância ou use o pareamento de 8 dígitos.
      </p>
    </div>
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (qrModalOpen = false)}>
      Fechar
    </Button>
  {/snippet}
</Modal>

<!-- Modal Adicionar Instância -->
<Modal
  open={connectModalOpen}
  title="Conectar Nova Instância WhatsApp"
  onclose={() => (connectModalOpen = false)}
>
  <div class="space-y-4">
    <p class="text-xs text-white/60">
      Cadastre o identificador da instância e o número de telefone com DDD (E.164). O sistema registrará no pool da Evolution GO e gerará o código de pareamento numérico de 8 dígitos.
    </p>

    {#if returnedCode}
      <div class="p-6 rounded-2xl bg-brand-green/10 border border-brand-green/30 text-center space-y-3">
        <span class="text-xs font-semibold text-emerald-400 uppercase tracking-widest">Código de Pareamento de 8 Dígitos</span>
        <div class="font-display text-4xl text-white tracking-widest select-all">{returnedCode}</div>
        <p class="text-xs text-white/70">
          Abra o WhatsApp no celular &gt; <strong>Aparelhos Conectados</strong> &gt; <strong>Conectar com número de telefone</strong> e digite o código acima (expira em 120s).
        </p>
      </div>
    {:else}
      <div>
        <label for="new-instance-name" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Nome da Instância</label>
        <input
          id="new-instance-name"
          type="text"
          placeholder="ex: principal"
          bind:value={newInstanceName}
          class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-brand-green"
        />
      </div>

      <div>
        <label for="new-instance-phone" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Número de Telefone (com DDD)</label>
        <input
          id="new-instance-phone"
          type="text"
          placeholder="ex: +5543996648750"
          bind:value={newPhoneNumber}
          class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-brand-green"
        />
      </div>
    {/if}

    <div class="flex justify-end gap-3 pt-3">
      <Button variant="secondary" size="sm" onclick={() => (connectModalOpen = false)}>
        {returnedCode ? 'Concluir' : 'Cancelar'}
      </Button>
      {#if !returnedCode}
        <Button variant="primary" size="sm" loading={connectLoading} onclick={handleConnect}>
          <span>Gerar Pareamento</span>
        </Button>
      {/if}
    </div>
  </div>
</Modal>
