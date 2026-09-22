import { convertToModelMessages, toUIMessageStream } from 'ai';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { AgentHolder } from './mutable';

export interface LocalTransportRequest {
  messages: UIMessage[];
  abortSignal?: AbortSignal;
}

export class LocalAgentTransport implements ChatTransport<UIMessage> {
  private readonly holder: AgentHolder;

  constructor(holder: AgentHolder) {
    this.holder = holder;
  }

  async sendMessages({
    messages,
    abortSignal,
  }: LocalTransportRequest): Promise<ReadableStream<UIMessageChunk>> {
    if (!this.holder.isReady) {
      throw new Error('Агент не собран: выберите модель и подключите провайдера');
    }

    const prompt = await convertToModelMessages(messages, { tools: this.holder.tools });
    const result = await this.holder.raw().stream({ prompt, abortSignal });

    return toUIMessageStream({ stream: result.stream, tools: this.holder.tools });
  }

  async reconnectToStream(): Promise<null> {
    return null;
  }
}
