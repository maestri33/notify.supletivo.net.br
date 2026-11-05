export class Agent<Env = any, State = any> {
  state: State = {} as State;
  env: Env;
  constructor(public ctx: any, env: Env) {
    this.env = env;
  }
  setState(updater: any) {
    if (typeof updater === 'function') {
      this.state = updater(this.state);
    } else {
      this.state = { ...this.state, ...updater };
    }
  }
}

export function callable() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor;
}

export async function routeAgentRequest(request: Request, env: any): Promise<Response | null> {
  return null;
}
