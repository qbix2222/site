import type { ToolLoopAgent, ToolSet } from 'ai';

export class AgentHolder {
  private current: ToolLoopAgent | null = null;
  private currentTools: ToolSet = {};

  get tools(): ToolSet {
    return this.currentTools;
  }

  get isReady(): boolean {
    return this.current !== null;
  }

  set(agent: ToolLoopAgent, tools: ToolSet): void {
    this.current = agent;
    this.currentTools = tools;
  }

  raw(): ToolLoopAgent {
    const agent = this.current;
    if (!agent) {
      throw new Error('Агент не собран: выберите модель и подключите провайдера');
    }

    return agent;
  }
}
