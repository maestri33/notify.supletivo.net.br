<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
  }

  let { class: className = '', children }: Props = $props();
</script>

<div class="glass-panel rounded-2xl p-6 relative overflow-hidden {className}">
  {@render children?.()}
</div>
