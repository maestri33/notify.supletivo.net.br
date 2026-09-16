<script lang="ts">
  interface Props {
    data: any;
    maxHeight?: string;
  }

  let { data, maxHeight = '300px' }: Props = $props();
  let copied = $state(false);

  const formattedJson = $derived.by(() => {
    try {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        return JSON.stringify(parsed, null, 2);
      }
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data || '');
    }
  });

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(formattedJson);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  }
</script>

<div class="relative group rounded-xl overflow-hidden border border-white/10 bg-black/40 font-mono text-xs">
  <div class="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5 text-white/50">
    <span>JSON Payload</span>
    <button
      type="button"
      onclick={copyToClipboard}
      class="px-2 py-0.5 rounded text-[11px] bg-white/10 hover:bg-white/20 text-white/80 transition-colors flex items-center gap-1 cursor-pointer"
    >
      {#if copied}
        <span class="text-emerald-400 font-medium">Copiado!</span>
      {:else}
        <span>Copiar</span>
      {/if}
    </button>
  </div>
  <pre
    class="p-4 overflow-x-auto text-emerald-300 font-mono leading-relaxed"
    style="max-height: {maxHeight};"
  >{formattedJson}</pre>
</div>
