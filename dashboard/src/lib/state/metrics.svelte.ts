import { api } from '../api';
import { auth } from './auth.svelte';
import type { MetricsSummary } from '../types';

export class MetricsStore {
  metrics = $state<MetricsSummary>({
    total_volume_24h: 12480,
    delivered_count_24h: 12293,
    failed_count_24h: 187,
    success_rate_percent: 98.5,
    whatsapp_volume_24h: 8930,
    email_volume_24h: 3550,
    queue_backlog: 14,
    last_updated: new Date().toISOString(),
  });
  loading = $state(false);

  whatsappRatio = $derived(
    this.metrics.total_volume_24h > 0
      ? Math.round((this.metrics.whatsapp_volume_24h / this.metrics.total_volume_24h) * 100)
      : 0
  );

  emailRatio = $derived(
    this.metrics.total_volume_24h > 0
      ? Math.round((this.metrics.email_volume_24h / this.metrics.total_volume_24h) * 100)
      : 0
  );

  async refresh() {
    this.loading = true;
    try {
      const data = await api.fetchMetrics(auth.backendUrl, auth.apiKey, auth.accountSlug);
      this.metrics = data;
    } catch (err) {
      console.warn('Could not refresh metrics live from backend, keeping state:', err);
    } finally {
      this.loading = false;
    }
  }
}

export const metricsStore = new MetricsStore();
