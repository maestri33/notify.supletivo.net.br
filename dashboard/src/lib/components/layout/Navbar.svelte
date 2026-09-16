<script lang="ts">
  import { auth } from '../../state/auth.svelte';
  import { healthStore } from '../../state/health.svelte';
  import Button from '../ui/Button.svelte';

  interface Props {
    activeTab: string;
    onsettab: (tab: string) => void;
  }

  let { activeTab, onsettab }: Props = $props();

  const isEdgeHealthy = $derived(healthStore.health.edge === 'healthy');
</script>

<header class="sticky top-0 z-40 w-full border-b border-white/10 bg-brand-ink/80 backdrop-blur-xl">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
    <!-- Left: Brand -->
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-green to-emerald-400 p-0.5 shadow-lg shadow-brand-green/30 flex items-center justify-center">
        <div class="w-full h-full bg-brand-ink rounded-[10px] flex items-center justify-center">
          <svg class="w-5 h-5 text-brand-yellow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
      </div>
      <div>
        <div class="flex items-center gap-2">
          <span class="font-display tracking-tight text-white text-lg">NOTIFY</span>
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-yellow/10 border border-brand-yellow/30 text-brand-yellow uppercase tracking-wider">Edge</span>
        </div>
        <div class="text-[11px] text-white/50 font-body hidden sm:block">
          supletivo.net.br &bull; infraestrutura transacional
        </div>
      </div>
    </div>

    <!-- Right: Status, Account Slug & Actions -->
    <div class="flex items-center gap-3">
      <!-- Edge Health Pill -->
      <div class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/70">
        <span class="w-2 h-2 rounded-full {isEdgeHealthy ? 'bg-emerald-400' : 'bg-rose-500'}"></span>
        <span class="hidden md:inline font-mono">{auth.edgeUrl.replace('https://', '')}</span>
      </div>

      <!-- Account Badge -->
      <div class="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-blue/30 border border-blue-500/30 text-xs text-blue-300 font-mono">
        <span>acc:</span>
        <span class="font-semibold text-white">{auth.accountSlug}</span>
      </div>

      <!-- Refresh Health -->
      <button
        type="button"
        onclick={() => healthStore.refresh()}
        disabled={healthStore.loading}
        class="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer disabled:opacity-50"
        title="Atualizar sondas de saúde"
      >
        <svg class="w-4 h-4 {healthStore.loading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      <!-- Settings trigger -->
      <Button
        variant={activeTab === 'settings' ? 'primary' : 'secondary'}
        size="sm"
        onclick={() => onsettab('settings')}
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span class="hidden sm:inline">Configurar</span>
      </Button>
    </div>
  </div>
</header>
