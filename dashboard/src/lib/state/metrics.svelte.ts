import { api } from '../api';
import { auth } from './auth.svelte';
import type { MetricsSummary } from '../types';

export class MetricsStore {
  metrics = $state<MetricsSummary>({
    total_volume_24h: 0,
    delivered_count_24h: 0,
    failed_count_24h: 0,
    success_rate_percent: 0,
    whatsapp_volume_24h: 0,
    email_volume_24h: 0,
    queue_backlog: 0,
    last_updated: '',
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
