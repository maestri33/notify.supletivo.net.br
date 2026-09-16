<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'yellow' | 'secondary' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    class: className = '',
    onclick,
    children,
  }: Props = $props();

  const variantClasses = {
    primary: 'bg-brand-green hover:bg-emerald-600 text-white shadow-lg shadow-brand-green/20 border border-emerald-400/20',
    yellow: 'bg-brand-yellow hover:bg-amber-400 text-brand-ink font-semibold shadow-lg shadow-brand-yellow/20 border border-amber-300/30',
    secondary: 'bg-white/5 hover:bg-white/10 text-white/90 border border-white/10 hover:border-white/20',
    danger: 'bg-rose-600/80 hover:bg-rose-600 text-white border border-rose-400/30 shadow-lg shadow-rose-600/20',
  };

  const sizeClasses = {
    sm: 'h-9 px-3 text-xs rounded-full',
    md: 'h-12 px-6 text-sm rounded-full',
    lg: 'h-14 px-8 text-base rounded-full',
  };
</script>

<button
  {type}
  disabled={disabled || loading}
  class="btn-primary relative inline-flex items-center justify-center gap-2 font-body font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98] {variantClasses[variant]} {sizeClasses[size]} {className}"
  {onclick}
>
  {#if loading}
    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
    </svg>
  {/if}
  {@render children?.()}
</button>
