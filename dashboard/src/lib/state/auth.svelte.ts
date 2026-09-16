const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const defaultEdgeUrl = isLocalhost ? 'http://localhost:8787' : 'https://notify-edge.supletivo.net.br';
const defaultBackendUrl = isLocalhost ? 'http://localhost:8000' : 'https://notify.supletivo.net.br';

export class AuthStore {
  apiKey = $state(typeof window !== 'undefined' ? localStorage.getItem('ntf_api_key') || '' : '');
  accountSlug = $state(typeof window !== 'undefined' ? localStorage.getItem('ntf_account_slug') || 'default' : 'default');
  edgeUrl = $state(typeof window !== 'undefined' ? localStorage.getItem('ntf_edge_url') || defaultEdgeUrl : defaultEdgeUrl);
  backendUrl = $state(typeof window !== 'undefined' ? localStorage.getItem('ntf_backend_url') || defaultBackendUrl : defaultBackendUrl);

  isAuthenticated = $derived(Boolean(this.apiKey.trim()));

  save(apiKey: string, accountSlug: string, edgeUrl: string, backendUrl: string) {
    this.apiKey = apiKey.trim();
    this.accountSlug = accountSlug.trim() || 'default';
    this.edgeUrl = edgeUrl.trim() || 'https://notify-edge.supletivo.net.br';
    this.backendUrl = backendUrl.trim() || 'https://notify.supletivo.net.br';

    if (typeof window !== 'undefined') {
      localStorage.setItem('ntf_api_key', this.apiKey);
      localStorage.setItem('ntf_account_slug', this.accountSlug);
      localStorage.setItem('ntf_edge_url', this.edgeUrl);
      localStorage.setItem('ntf_backend_url', this.backendUrl);
    }
  }
}

export const auth = new AuthStore();
