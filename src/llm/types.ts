export interface UsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateOptions {
  operation: string;
  userId?: number;
  requestId?: number;
  system?: string;
  jsonSchema?: object;
  grounded?: boolean;
}

export interface GenerateResult {
  text: string;
  usage: UsageMetadata;
}

export interface LlmClient {
  generate(prompt: string, options: GenerateOptions): Promise<GenerateResult>;
}
