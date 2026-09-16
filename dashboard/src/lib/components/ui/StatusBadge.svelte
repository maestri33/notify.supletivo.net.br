<script lang="ts">
  interface Props {
    status: string;
    class?: string;
  }

  let { status, class: className = '' }: Props = $props();

  function getStatusConfig(s: string) {
    const norm = s.toLowerCase();
    switch (norm) {
      case 'sent':
      case 'delivered':
      case 'open':
      case 'connected':
      case 'healthy':
      case 'ready':
      case 'valid':
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
          dot: 'bg-emerald-400',
          label: s,
        };
      case 'queued':
      case 'dispatched':
      case 'pending':
      case 'connecting':
      case 'pareando':
      case 'warning':
      case 'degraded':
        return {
          bg: 'bg-brand-yellow/10 border-brand-yellow/20 text-brand-yellow',
          dot: 'bg-brand-yellow animate-pulse',
          label: s,
        };
      case 'failed':
      case 'error':
      case 'close':
      case 'down':
      case 'offline':
      case 'missing':
      case 'unreachable':
        return {
          bg: 'bg-rose-500/10 border-rose-500/20 text-rose-400',
          dot: 'bg-rose-400',
          label: s,
        };
      default:
        return {
          bg: 'bg-white/5 border-white/10 text-white/60',
          dot: 'bg-white/40',
          label: s,
        };
    }
  }

  const config = $derived(getStatusConfig(status));
</script>

<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border {config.bg} {className}">
  <span class="w-1.5 h-1.5 rounded-full {config.dot}"></span>
  <span class="capitalize">{config.label}</span>
</span>
