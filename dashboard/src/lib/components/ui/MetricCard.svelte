<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    value: string | number;
    subtitle?: string;
    badge?: string;
    badgeVariant?: 'success' | 'warning' | 'error' | 'info';
    icon?: Snippet;
  }

  let {
    title,
    value,
    subtitle,
    badge,
    badgeVariant = 'info',
    icon,
  }: Props = $props();

  const badgeVariants = {
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    warning: 'bg-brand-yellow/10 text-brand-yellow border border-brand-yellow/20',
    error: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    info: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  };
</script>

<div class="glass-panel p-6 rounded-2xl relative overflow-hidden transition-all duration-300 hover:border-white/20 hover:scale-[1.01]">
  <div class="flex items-center justify-between gap-4 mb-3">
    <span class="text-xs uppercase tracking-wider font-semibold text-white/50">{title}</span>
    {#if icon}
      <div class="p-2 rounded-xl bg-white/5 text-white/70">
        {@render icon()}
      </div>
    {/if}
  </div>

  <div class="flex items-baseline gap-3 mb-1">
    <div class="font-display text-3xl sm:text-4xl text-white tracking-tight">
      {value}
    </div>
    {#if badge}
      <span class="text-xs px-2 py-0.5 rounded-full font-medium {badgeVariants[badgeVariant]}">
        {badge}
      </span>
    {/if}
  </div>

  {#if subtitle}
    <p class="text-xs text-white/40 mt-1 font-body">{subtitle}</p>
  {/if}
</div>
