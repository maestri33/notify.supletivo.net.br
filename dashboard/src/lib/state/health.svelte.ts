import { api } from '../api';
import { auth } from './auth.svelte';
import type { ServiceHealth } from '../types';

export class HealthStore {
  health = $state<ServiceHealth>({
    edge: 'healthy',
    d1: 'connected',
    r2: 'connected',
    workers_ai: 'ready',
    evolution_go: 'connected',
    stalwart: 'connected',
    environment: 'production',
    checked_at: new Date().toISOString(),
  });
  loading = $state(false);

  async refresh() {
    this.loading = true;
    try {
      const res = await api.checkHealth(auth.edgeUrl, auth.backendUrl, auth.apiKey);
      this.health = res;
    } finally {
      this.loading = false;
    }
  }
}

export const healthStore = new HealthStore();
