import { api } from '../api';
import { auth } from './auth.svelte';
import type { NotificationRecord, ChannelType, NotificationStatus } from '../types';

export class LogsStore {
  records = $state<NotificationRecord[]>([]);
  loading = $state(false);
  filterChannel = $state<string>('all');
  filterStatus = $state<string>('all');
  searchQuery = $state<string>('');
  selectedRecord = $state<NotificationRecord | null>(null);

  filteredRecords = $derived.by(() => {
    return this.records.filter((rec) => {
      if (this.filterChannel !== 'all' && rec.channel !== this.filterChannel) {
        return false;
      }
      if (this.filterStatus !== 'all' && rec.status !== this.filterStatus) {
        return false;
      }
      if (this.searchQuery.trim()) {
        const q = this.searchQuery.toLowerCase().trim();
        const matchRecip = rec.recipient.toLowerCase().includes(q);
        const matchId = rec.id.toLowerCase().includes(q);
        const matchKey = (rec.idempotency_key || '').toLowerCase().includes(q);
        const matchSubject = (rec.subject || '').toLowerCase().includes(q);
        return matchRecip || matchId || matchKey || matchSubject;
      }
      return true;
    });
  });

  async refresh() {
    this.loading = true;
    try {
      const data = await api.fetchNotifications(
        auth.backendUrl,
        auth.apiKey,
        auth.accountSlug,
        this.filterChannel as ChannelType,
        this.filterStatus as NotificationStatus,
        this.searchQuery
      );
      this.records = data;
    } catch (err) {
      console.warn('Could not load notifications from backend, keeping fallback/current state:', err);
    } finally {
      this.loading = false;
    }
  }

  selectRecord(record: NotificationRecord | null) {
    this.selectedRecord = record;
  }

  async requeue(id: string) {
    const success = await api.requeueNotification(auth.backendUrl, auth.apiKey, id);
    if (success) {
      await this.refresh();
    }
    return success;
  }
}

export const logsStore = new LogsStore();
