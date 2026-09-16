<script lang="ts">
  import { onMount } from 'svelte';
  import { logsStore } from '../state/logs.svelte';
  import type { NotificationRecord } from '../types';
  import GlassPanel from '../components/ui/GlassPanel.svelte';
  import StatusBadge from '../components/ui/StatusBadge.svelte';
  import Button from '../components/ui/Button.svelte';
  import Modal from '../components/ui/Modal.svelte';
  import JsonViewer from '../components/ui/JsonViewer.svelte';

  let inspectModalOpen = $state(false);
  let requeueLoading = $state(false);

  function openInspect(record: NotificationRecord) {
    logsStore.selectRecord(record);
    inspectModalOpen = true;
  }

  async function handleRequeue(id: string) {
    requeueLoading = true;
    try {
      await logsStore.requeue(id);
      alert('Notificação reenfileirada para reprocessamento imediato!');
    } catch {
      alert('Erro ao reenfileirar notificação.');
    } finally {
      requeueLoading = false;
    }
  }

  onMount(() => {
    logsStore.refresh();
  });
</script>

<div class="space-y-6">
  <!-- Top Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="font-display text-2xl sm:text-3xl text-white tracking-tight">Logs & Auditoria de Disparo</h1>
      <p class="text-sm text-white/50 font-body">Histórico completo de eventos, confirmações e idempotência da borda.</p>
    </div>

    <Button
      variant="secondary"
      size="sm"
      loading={logsStore.loading}
      onclick={() => logsStore.refresh()}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <span>Atualizar Tabela</span>
    </Button>
  </div>

  <!-- Filters & Search -->
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <!-- Search Query -->
    <div class="sm:col-span-1">
      <label for="logs-search-input" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Buscar</label>
      <div class="relative">
        <input
          id="logs-search-input"
          type="text"
          placeholder="Destinatário, ID, Idempotência..."
          bind:value={logsStore.searchQuery}
          class="w-full h-11 px-4 pl-10 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-brand-green transition-colors"
        />
        <svg class="w-4 h-4 text-white/40 absolute left-3.5 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
    </div>

    <!-- Channel Filter -->
    <div>
      <label for="logs-channel-select" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Canal</label>
      <select
        id="logs-channel-select"
        bind:value={logsStore.filterChannel}
        class="w-full h-11 px-3 rounded-xl bg-brand-ink border border-white/10 text-white text-sm focus:outline-none focus:border-brand-green"
      >
        <option value="all">Todos os Canais</option>
        <option value="whatsapp">WhatsApp (Evolution)</option>
        <option value="email">E-mail (Stalwart)</option>
      </select>
    </div>

    <!-- Status Filter -->
    <div>
      <label for="logs-status-select" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Status</label>
      <select
        id="logs-status-select"
        bind:value={logsStore.filterStatus}
        class="w-full h-11 px-3 rounded-xl bg-brand-ink border border-white/10 text-white text-sm focus:outline-none focus:border-brand-green"
      >
        <option value="all">Todos os Status</option>
        <option value="sent">Entregue (sent)</option>
        <option value="failed">Falha (failed)</option>
        <option value="queued">Na Fila (queued)</option>
        <option value="dispatched">Despachado (dispatched)</option>
      </select>
    </div>
  </div>

  <!-- Table View -->
  <GlassPanel class="p-0 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="bg-white/5 border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-white/50">
          <tr>
            <th class="py-3.5 px-4">Canal</th>
            <th class="py-3.5 px-4">Destinatário</th>
            <th class="py-3.5 px-4">ID & Idempotência</th>
            <th class="py-3.5 px-4">Status</th>
            <th class="py-3.5 px-4">Driver</th>
            <th class="py-3.5 px-4">Criado em</th>
            <th class="py-3.5 px-4 text-right">Ações</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5 font-body">
          {#if logsStore.filteredRecords.length === 0}
            <tr>
              <td colspan="7" class="py-12 text-center text-white/40">
                Nenhum registro encontrado para os filtros selecionados.
              </td>
            </tr>
          {/if}

          {#each logsStore.filteredRecords as rec}
            <tr class="hover:bg-white/[0.02] transition-colors">
              <!-- Channel -->
              <td class="py-3 px-4">
                <span class="inline-flex items-center gap-1.5 text-xs font-medium {rec.channel === 'whatsapp' ? 'text-emerald-400' : 'text-brand-yellow'}">
                  {#if rec.channel === 'whatsapp'}
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2z" />
                    </svg>
                    <span>WhatsApp</span>
                  {:else}
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>E-mail</span>
                  {/if}
                </span>
              </td>

              <!-- Recipient -->
              <td class="py-3 px-4 font-mono text-xs text-white">
                {rec.recipient}
              </td>

              <!-- ID / Key -->
              <td class="py-3 px-4 font-mono text-xs text-white/50">
                <div class="truncate max-w-[140px]" title={rec.id}>{rec.id}</div>
                {#if rec.idempotency_key}
                  <div class="text-[10px] text-brand-yellow truncate max-w-[140px]" title={rec.idempotency_key}>
                    key: {rec.idempotency_key}
                  </div>
                {/if}
              </td>

              <!-- Status -->
              <td class="py-3 px-4">
                <StatusBadge status={rec.status} />
              </td>

              <!-- Driver -->
              <td class="py-3 px-4 font-mono text-xs text-white/60">
                {rec.driver_used || 'Standard'}
              </td>

              <!-- Created At -->
              <td class="py-3 px-4 font-mono text-xs text-white/50">
                {new Date(rec.created_at).toLocaleString('pt-BR')}
              </td>

              <!-- Actions -->
              <td class="py-3 px-4 text-right">
                <div class="inline-flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onclick={() => openInspect(rec)}
                  >
                    JSON
                  </Button>

                  {#if rec.status === 'failed'}
                    <Button
                      variant="yellow"
                      size="sm"
                      loading={requeueLoading}
                      onclick={() => handleRequeue(rec.id)}
                    >
                      Reenfileirar
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </GlassPanel>
</div>

<!-- Modal Inspect JSON -->
<Modal
  open={inspectModalOpen}
  title={`Detalhes do Evento #${logsStore.selectedRecord?.id || ''}`}
  onclose={() => (inspectModalOpen = false)}
>
  {#if logsStore.selectedRecord}
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3 text-xs p-3 rounded-xl bg-white/5 border border-white/10 font-mono">
        <div>
          <span class="text-white/40 block">Destinatário:</span>
          <span class="text-white font-semibold">{logsStore.selectedRecord.recipient}</span>
        </div>
        <div>
          <span class="text-white/40 block">Status:</span>
          <span class="text-brand-yellow font-semibold">{logsStore.selectedRecord.status}</span>
        </div>
        <div>
          <span class="text-white/40 block">Canal:</span>
          <span class="text-white">{logsStore.selectedRecord.channel}</span>
        </div>
        <div>
          <span class="text-white/40 block">Driver Utilizado:</span>
          <span class="text-emerald-400">{logsStore.selectedRecord.driver_used || 'None'}</span>
        </div>
      </div>

      {#if logsStore.selectedRecord.error_message}
        <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono">
          <div class="font-bold mb-1">Mensagem de Erro:</div>
          <div>{logsStore.selectedRecord.error_message}</div>
        </div>
      {/if}

      <div>
        <div class="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">Payload Serializado</div>
        <JsonViewer data={logsStore.selectedRecord.payload_json} maxHeight="350px" />
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (inspectModalOpen = false)}>
      Fechar
    </Button>
  {/snippet}
</Modal>
