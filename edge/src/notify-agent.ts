/**
 * Cloudflare Agents SDK: NotifyAgent
 * 
 * Agente com estado persistente em SQLite (Durable Objects), sincronização
 * reativa, RPC chamável e integração com TypeSafe AI (System One - Jev).
 */

import { Agent, callable } from 'agents';
import { triageWithJev, TriageResult } from './typesafe-triage';

export type NotifyAgentState = {
  accountSlug: string;
  totalProcessed: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastTriageSummary?: string;
  lastTriageDepartment?: string;
  lastTriageLegalRisk?: boolean;
  lastActive: string;
};

export class NotifyAgent extends Agent<any, NotifyAgentState> {
  initialState: NotifyAgentState = {
    accountSlug: 'supletivo',
    totalProcessed: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    lastActive: new Date().toISOString(),
  };

  /**
   * RPC Callable: Retorna as métricas e estado do agente em tempo real.
   */
  @callable()
  getMetrics(): NotifyAgentState {
    return this.state;
  }

  /**
   * RPC Callable: Registra resultado de entrega e atualiza contadores persistentes.
   */
  @callable()
  recordDelivery(success: boolean) {
    const current = this.state;
    this.setState({
      ...current,
      totalProcessed: current.totalProcessed + 1,
      successfulDeliveries: success ? current.successfulDeliveries + 1 : current.successfulDeliveries,
      failedDeliveries: !success ? current.failedDeliveries + 1 : current.failedDeliveries,
      lastActive: new Date().toISOString(),
    });
    return this.state;
  }

  /**
   * RPC Callable: Executa triagem de mensagem de aluno via TypeSafe AI (System One Jev)
   * e persiste o resultado no estado do agente.
   */
  @callable()
  async triageMessage(messageText: string): Promise<TriageResult> {
    const apiKey = this.env.TYPESAFE_API_KEY;
    const apiUrl = this.env.TYPESAFE_API_URL;

    const triage = await triageWithJev(messageText, apiKey, apiUrl);

    this.setState({
      ...this.state,
      lastTriageDepartment: triage.department,
      lastTriageLegalRisk: triage.legal_risk,
      lastTriageSummary: `[${triage.department.toUpperCase()}] Urgência ${triage.urgency_level}`,
      lastActive: new Date().toISOString(),
    });

    return triage;
  }

  /**
   * Ciclo de vida: executado quando o estado do agente é atualizado.
   */
  onStateUpdate(state: NotifyAgentState, source: any) {
    // Observabilidade em tempo real
    console.log(`[NotifyAgent:${state.accountSlug}] Estado atualizado por ${source}: total=${state.totalProcessed}`);
  }
}
