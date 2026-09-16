<script lang="ts">
  import { onMount } from 'svelte';
  import { metricsStore } from '../state/metrics.svelte';
  import { healthStore } from '../state/health.svelte';
  import MetricCard from '../components/ui/MetricCard.svelte';
  import StatusBadge from '../components/ui/StatusBadge.svelte';
  import GlassPanel from '../components/ui/GlassPanel.svelte';
  import Button from '../components/ui/Button.svelte';

  interface Props {
    onsettab: (tab: string) => void;
  }

  let { onsettab }: Props = $props();

  onMount(() => {
    metricsStore.refresh();
    healthStore.refresh();
  });

  const m = $derived(metricsStore.metrics);
  const h = $derived(healthStore.health);
</script>

<div class="space-y-6">
  <!-- Top Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="font-display text-2xl sm:text-3xl text-white tracking-tight">Visão Geral da Borda</h1>
      <p class="text-sm text-white/50 font-body">Métricas de tráfego, taxa de entrega e saúde das sondas em tempo real.</p>
    </div>

    <div class="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        loading={metricsStore.loading}
        onclick={() => {
          metricsStore.refresh();
          healthStore.refresh();
        }}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>Atualizar</span>
      </Button>

      <Button
        variant="yellow"
        size="sm"
        onclick={() => onsettab('send')}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        <span>Simular Envio</span>
      </Button>
    </div>
  </div>

  <!-- Hero KPI Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <MetricCard
      title="Volume Total (24h)"
      value={m.total_volume_24h.toLocaleString('pt-BR')}
      subtitle="Total de notificações processadas"
      badge="Global"
      badgeVariant="info"
    />

    <MetricCard
      title="Entregues com Sucesso"
      value={m.delivered_count_24h.toLocaleString('pt-BR')}
      subtitle="Confirmação de recebimento"
      badge="OK"
      badgeVariant="success"
    />

    <MetricCard
      title="Falhas / Exceções"
      value={m.failed_count_24h.toLocaleString('pt-BR')}
      subtitle="Erros de socket, timeout ou rejeição"
      badge={m.failed_count_24h > 0 ? "Atenção" : "Zero"}
      badgeVariant={m.failed_count_24h > 0 ? "warning" : "success"}
    />

    <MetricCard
      title="Taxa de Sucesso"
      value={`${m.success_rate_percent.toFixed(1)}%`}
      subtitle="Meta SLA: 98.0%"
      badge={m.success_rate_percent >= 98 ? "No Alvo" : "Degradado"}
      badgeVariant={m.success_rate_percent >= 98 ? "success" : "warning"}
    />
  </div>

  <!-- Ratio Breakdown & Backlog -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Channel Breakdown -->
    <GlassPanel class="lg:col-span-2 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-display text-lg text-white">Distribuição por Canal</h3>
          <p class="text-xs text-white/50">Volume comparativo entre WhatsApp e E-mail transacional</p>
        </div>
        <div class="text-xs font-mono text-white/60">
          Backlog em fila: <span class="font-bold text-white">{m.queue_backlog}</span>
        </div>
      </div>

      <!-- Ratio Progress Bar -->
      <div class="space-y-2">
        <div class="h-4 w-full bg-white/5 rounded-full overflow-hidden flex border border-white/10 p-0.5">
          <div
            class="h-full bg-brand-green rounded-full transition-all duration-500 shadow-sm"
            style="width: {metricsStore.whatsappRatio}%"
            title="WhatsApp: {metricsStore.whatsappRatio}%"
          ></div>
          <div
            class="h-full bg-brand-yellow rounded-full transition-all duration-500 shadow-sm ml-0.5"
            style="width: {metricsStore.emailRatio}%"
            title="E-mail: {metricsStore.emailRatio}%"
          ></div>
        </div>

        <div class="flex items-center justify-between text-xs pt-1">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-brand-green"></span>
            <span class="text-white/80 font-medium">WhatsApp ({metricsStore.whatsappRatio}%)</span>
            <span class="text-white/40 font-mono">[{m.whatsapp_volume_24h.toLocaleString('pt-BR')} msgs]</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-brand-yellow"></span>
            <span class="text-brand-yellow font-medium">E-mail ({metricsStore.emailRatio}%)</span>
            <span class="text-white/40 font-mono">[{m.email_volume_24h.toLocaleString('pt-BR')} msgs]</span>
          </div>
        </div>
      </div>

      <!-- Fast-Track OTP callout -->
      <div class="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-brand-yellow/10 text-brand-yellow border border-brand-yellow/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div class="text-sm font-semibold text-white">Canal Prioritário Fast-Track (OTP)</div>
            <div class="text-xs text-white/50">Requisições transacionais de login com SLA estrito &lt; 3.0s e bypass de filas</div>
          </div>
        </div>
        <button
          type="button"
          onclick={() => onsettab('send')}
          class="text-xs text-brand-yellow hover:underline cursor-pointer font-medium"
        >
          Testar canal &rarr;
        </button>
      </div>
    </GlassPanel>

    <!-- Edge Probes Health -->
    <GlassPanel class="space-y-4">
      <div>
        <h3 class="font-display text-lg text-white">Sondas de Infraestrutura</h3>
        <p class="text-xs text-white/50">Checagem de conectividade de ponta a ponta</p>
      </div>

      <div class="space-y-2.5">
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <span class="text-xs text-white/80 font-medium">Cloudflare Edge Worker</span>
          <StatusBadge status={h.edge} />
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <span class="text-xs text-white/80 font-medium">Cloudflare D1 (Database)</span>
          <StatusBadge status={h.d1} />
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <span class="text-xs text-white/80 font-medium">Cloudflare R2 (Media/QR)</span>
          <StatusBadge status={h.r2} />
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <span class="text-xs text-white/80 font-medium">Workers AI (Intelligence)</span>
          <StatusBadge status={h.workers_ai} />
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <span class="text-xs text-white/80 font-medium">Evolution GO (WhatsApp)</span>
          <StatusBadge status={h.evolution_go} />
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <span class="text-xs text-white/80 font-medium">Stalwart Mail (SMTP/JMAP)</span>
          <StatusBadge status={h.stalwart} />
        </div>
      </div>
    </GlassPanel>
  </div>
</div>
