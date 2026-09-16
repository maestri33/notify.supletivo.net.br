<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  interface Props {
    title: string;
    open: boolean;
    onclose: () => void;
    children?: Snippet;
    footer?: Snippet;
  }

  let { title, open, onclose, children, footer }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      onclose();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-in fade-in"
      onclick={onclose}
      aria-hidden="true"
    ></div>

    <!-- Modal Container -->
    <div
      class="relative w-full max-w-2xl glass-panel bg-brand-ink/95 border border-white/15 rounded-3xl shadow-2xl p-6 sm:p-8 z-10 my-auto text-white animate-in zoom-in-95 duration-200"
      role="dialog"
      aria-modal="true"
    >
      <!-- Header -->
      <div class="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
        <h3 class="font-display text-xl text-white tracking-tight">{title}</h3>
        <button
          type="button"
          onclick={onclose}
          class="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="max-h-[70vh] overflow-y-auto pr-1">
        {@render children?.()}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="mt-6 pt-4 border-t border-white/10 flex justify-end gap-3">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
