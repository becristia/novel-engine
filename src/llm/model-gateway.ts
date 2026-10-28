import type { z } from 'zod';

export interface ModelRequest {
  prompt: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResult<T> {
  value: T;
  modelId: string;
  usage: ModelUsage | null;
  finishReason?: string;
  providerResponseId?: string;
}

export interface StructuredModelRequest<T> extends ModelRequest {
  schema: z.ZodType<T>;
}

export interface ModelGateway {
  generateText(request: ModelRequest): Promise<ModelResult<string>>;
  generateObject<T>(request: StructuredModelRequest<T>): Promise<ModelResult<T>>;
}
