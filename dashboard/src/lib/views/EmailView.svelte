<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { auth } from '../state/auth.svelte';
  import type { MailIdentity } from '../types';
  import GlassPanel from '../components/ui/GlassPanel.svelte';
  import StatusBadge from '../components/ui/StatusBadge.svelte';
  import Button from '../components/ui/Button.svelte';

  interface Props {
    onsettab: (tab: string) => void;
  }

  let { onsettab }: Props = $props();

  let identities = $state<MailIdentity[]>([]);
  let loading = $state(false);

  const templates = [
    { id: 'auth.otp', name: 'Código de Verificação OTP', subject: 'Seu código de acesso: {{ code }}', type: 'Transacional' },
    { id: 'users.welcome', name: 'Boas-vindas ao Aluno', subject: 'Bem-vindo ao Supletivo Brasil!', type: 'Onboarding' },
    { id: 'academic.grade', name: 'Liberação de Notas do Módulo', subject: 'Suas notas já estão disponíveis no portal', type: 'Acadêmico' },
    { id: 'finance.invoice', name: 'Aviso de Cobrança / PIX', subject: 'Boleto/PIX disponível para pagamento', type: 'Financeiro' },
  ];

  async function loadIdentities() {
    loading = true;
    try {
      identities = await api.fetchMailIdentities(auth.backendUrl, auth.apiKey, auth.accountSlug);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadIdentities();
  });
</script>

<div class="space-y-6">
  <!-- Top Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="font-display text-2xl sm:text-3xl text-white tracking-tight">E-mail Transacional (Stalwart)</h1>
      <p class="text-sm text-white/50 font-body">Identidades de envio, autenticação DKIM/SPF e templates de comunicação.</p>
    </div>

    <Button
      variant="yellow"
      size="sm"
      onclick={() => onsettab('send')}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
      <span>Testar Envio</span>
    </Button>
  </div>

  <!-- Mail Identities -->
  <div>
    <h2 class="font-display text-lg text-white mb-3">Identidades Autorizadas</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      {#each identities as iden}
        <GlassPanel class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="font-display text-base text-white">{iden.from_name}</h3>
              <div class="font-mono text-xs text-brand-yellow">{iden.from_email}</div>
            </div>
            <span class="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70 font-mono">SMTP/JMAP</span>
          </div>

          <div class="grid grid-cols-2 gap-3 p-3 rounded-xl bg-white/5 border border-white/5 text-xs">
            <div>
              <span class="text-white/50 block mb-1">DKIM Signature:</span>
              <StatusBadge status={iden.dkim_status} />
            </div>
            <div>
              <span class="text-white/50 block mb-1">SPF Record:</span>
              <StatusBadge status={iden.spf_status} />
            </div>
            <div class="col-span-2 pt-2 border-t border-white/5 flex justify-between font-mono text-white/60">
              <span>Host: {iden.smtp_host}:{iden.smtp_port}</span>
              <span class="text-emerald-400">TLS 1.3 Active</span>
            </div>
          </div>
        </GlassPanel>
      {/each}
    </div>
  </div>

  <!-- Templates -->
  <GlassPanel class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="font-display text-lg text-white">Templates Transacionais Cadastrados</h2>
        <p class="text-xs text-white/50">Modelos pré-autorizados para disparo via API</p>
      </div>
      <span class="text-xs font-mono text-white/60">{templates.length} ativos</span>
    </div>

    <div class="divide-y divide-white/5">
      {#each templates as t}
        <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-semibold text-sm text-white">{t.name}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/70">{t.type}</span>
            </div>
            <div class="text-xs text-white/40 font-mono mt-0.5">Assunto: {t.subject}</div>
          </div>
          <div class="font-mono text-xs text-white/50 bg-white/5 px-2 py-1 rounded">
            template_id: {t.id}
          </div>
        </div>
      {/each}
    </div>
  </GlassPanel>
</div>
