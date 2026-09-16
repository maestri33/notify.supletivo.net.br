<script lang="ts">
  interface Props {
    activeTab: string;
    onsettab: (tab: string) => void;
  }

  let { activeTab, onsettab }: Props = $props();

  const navItems = [
    {
      id: 'overview',
      label: 'Visão Geral',
      badge: 'Live',
      iconPath: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp (Evolution)',
      badge: '',
      iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    },
    {
      id: 'email',
      label: 'E-mail (Stalwart)',
      badge: '',
      iconPath: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    },
    {
      id: 'logs',
      label: 'Logs & Auditoria',
      badge: '',
      iconPath: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    },
    {
      id: 'send',
      label: 'Simulador de Disparo',
      badge: 'OTP',
      iconPath: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    },
    {
      id: 'settings',
      label: 'Configurações',
      badge: '',
      iconPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    },
  ];
</script>

<aside class="w-full lg:w-64 shrink-0">
  <div class="glass-panel p-3 rounded-2xl flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
    {#each navItems as item}
      {@const isActive = activeTab === item.id}
      <button
        type="button"
        onclick={() => onsettab(item.id)}
        class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer whitespace-nowrap {isActive ? 'bg-white/10 text-white font-semibold shadow-md shadow-black/20 border border-white/10' : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'}"
      >
        <div class="flex items-center gap-3">
          <svg class="w-4 h-4 {isActive ? 'text-brand-yellow' : 'text-white/40'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconPath} />
          </svg>
          <span>{item.label}</span>
        </div>

        {#if item.badge}
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full {item.badge === 'Live' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-brand-yellow/20 text-brand-yellow'}">
            {item.badge}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</aside>
