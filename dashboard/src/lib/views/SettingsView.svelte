<script lang="ts">
  import { auth } from '../state/auth.svelte';
  import { healthStore } from '../state/health.svelte';
  import GlassPanel from '../components/ui/GlassPanel.svelte';
  import Button from '../components/ui/Button.svelte';

  let apiKey = $state(auth.apiKey);
  let accountSlug = $state(auth.accountSlug);
  let edgeUrl = $state(auth.edgeUrl);
  let backendUrl = $state(auth.backendUrl);

  let savedNotice = $state(false);
  let testSuccess = $state<boolean | null>(null);

  function handleSave() {
    auth.save(apiKey, accountSlug, edgeUrl, backendUrl);
    savedNotice = true;
    setTimeout(() => {
      savedNotice = false;
    }, 2500);
  }

  async function handleTest() {
    handleSave();
    await healthStore.refresh();
    testSuccess = healthStore.health.edge === 'healthy';
  }
</script>

<div class="space-y-6 max-w-3xl">
  <!-- Top Bar -->
  <div>
    <h1 class="font-display text-2xl sm:text-3xl text-white tracking-tight">Configurações & Conectividade</h1>
    <p class="text-sm text-white/50 font-body">Defina as chaves de autorização e os endpoints da borda Cloudflare e da origem Django.</p>
  </div>

  <GlassPanel class="space-y-5">
    <h2 class="font-display text-lg text-white">Credenciais e Endpoints</h2>

    <!-- API Key -->
    <div>
      <label for="settings-api-key" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Chave de API (Authorization Bearer)</label>
      <input
        id="settings-api-key"
        type="password"
        bind:value={apiKey}
        placeholder="ntf_live_..."
        class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-brand-green transition-colors"
      />
      <span class="text-[11px] text-white/40 mt-1 block">Chave de autorização multi-tenant para a borda e API origin</span>
    </div>

    <!-- Account Slug -->
    <div>
      <label for="settings-account-slug" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Slug da Conta / Tenant</label>
      <input
        id="settings-account-slug"
        type="text"
        bind:value={accountSlug}
        placeholder="supletivo-brasil"
        class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-brand-green transition-colors"
      />
    </div>

    <!-- Edge URL -->
    <div>
      <label for="settings-edge-url" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Endpoint do Cloudflare Edge Worker</label>
      <input
        id="settings-edge-url"
        type="text"
        bind:value={edgeUrl}
        placeholder="https://notify-edge.supletivo.net.br"
        class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-brand-green transition-colors"
      />
    </div>

    <!-- Backend URL -->
    <div>
      <label for="settings-backend-url" class="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5">Endpoint da Origem Django / API</label>
      <input
        id="settings-backend-url"
        type="text"
        bind:value={backendUrl}
        placeholder="https://notify.supletivo.net.br"
        class="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-brand-green transition-colors"
      />
    </div>

    <!-- Actions -->
    <div class="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center gap-3">
      <Button
        variant="primary"
        size="md"
        class="w-full sm:w-auto"
        onclick={handleSave}
      >
        Salvar Configurações
      </Button>

      <Button
        variant="secondary"
        size="md"
        class="w-full sm:w-auto"
        loading={healthStore.loading}
        onclick={handleTest}
      >
        Testar Conectividade
      </Button>

      {#if savedNotice}
        <span class="text-xs text-emerald-400 font-medium animate-in fade-in">
          Configurações salvas localmente!
        </span>
      {/if}

      {#if testSuccess !== null}
        <span class="text-xs font-medium {testSuccess ? 'text-emerald-400' : 'text-rose-400'}">
          {testSuccess ? 'Conexão validada com sucesso!' : 'Falha ao validar borda/origem.'}
        </span>
      {/if}
    </div>
  </GlassPanel>

  <!-- Info Panel -->
  <div class="p-4 rounded-2xl bg-white/5 border border-white/5 text-xs text-white/60 space-y-2">
    <div class="font-semibold text-white">Privacidade & Persistência Local</div>
    <p>Todas as credenciais e endpoints informados nesta tela permanecem exclusivamente gravados no armazenamento local (`localStorage`) do seu navegador. Nenhuma credencial é transmitida a terceiros fora dos endpoints configurados.</p>
  </div>
</div>
