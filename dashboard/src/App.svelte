<script lang="ts">
  import { onMount } from 'svelte';
  import Navbar from './lib/components/layout/Navbar.svelte';
  import Sidebar from './lib/components/layout/Sidebar.svelte';
  import OverviewView from './lib/views/OverviewView.svelte';
  import WhatsAppView from './lib/views/WhatsAppView.svelte';
  import EmailView from './lib/views/EmailView.svelte';
  import LogsView from './lib/views/LogsView.svelte';
  import SimulatorView from './lib/views/SimulatorView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';

  let activeTab = $state('overview');

  function setTab(tab: string) {
    activeTab = tab;
    if (typeof window !== 'undefined') {
      window.location.hash = tab;
    }
  }

  function handleHashChange() {
    const hash = window.location.hash.replace('#', '');
    if (['overview', 'whatsapp', 'email', 'logs', 'send', 'settings'].includes(hash)) {
      activeTab = hash;
    }
  }

  onMount(() => {
    if (window.location.hash) {
      handleHashChange();
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  });
</script>

<div class="min-h-screen flex flex-col bg-brand-ink text-white font-body antialiased selection:bg-brand-green selection:text-white">
  <!-- Navbar -->
  <Navbar {activeTab} onsettab={setTab} />

  <!-- Main Container -->
  <div class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col lg:flex-row gap-6">
    <!-- Sidebar Navigation -->
    <Sidebar {activeTab} onsettab={setTab} />

    <!-- Content Area -->
    <main class="flex-1 min-w-0">
      {#if activeTab === 'overview'}
        <OverviewView onsettab={setTab} />
      {:else if activeTab === 'whatsapp'}
        <WhatsAppView />
      {:else if activeTab === 'email'}
        <EmailView onsettab={setTab} />
      {:else if activeTab === 'logs'}
        <LogsView />
      {:else if activeTab === 'send'}
        <SimulatorView />
      {:else if activeTab === 'settings'}
        <SettingsView />
      {/if}
    </main>
  </div>

  <!-- Footer -->
  <footer class="border-t border-white/5 py-4 text-center text-xs text-white/40 font-body">
    <div class="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
      <div>
        <span>Plataforma Supletivo Brasil &bull; </span>
        <span class="font-mono text-white/60">version.v7m.live</span>
      </div>
      <div class="font-mono text-[11px] text-white/30">
        Cloudflare Pages &bull; Svelte 5 Runes &bull; Architecture Zero-G
      </div>
    </div>
  </footer>
</div>
