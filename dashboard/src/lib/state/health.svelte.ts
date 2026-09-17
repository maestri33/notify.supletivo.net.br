import { api } from '../api';
import { auth } from './auth.svelte';
import type { ServiceHealth } from '../types';

export class HealthStore {
  health = $state<ServiceHealth>({
    edge: 'offline',
    d1: 'offline',
    r2: 'not_bound',
    workers_ai: 'not_bound',
    evolution_go: 'unreachable',
    stalwart: 'unreachable',
    environment: 'production',
    checked_at: '',
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
