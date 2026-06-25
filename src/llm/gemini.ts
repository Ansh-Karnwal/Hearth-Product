import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../config";
import { TokenUsageRow } from "../data/schema";
import { DataStore } from "../data/store";

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
}

export interface GenerateResult {
  text: string;
  usage: UsageMetadata;
}

// Strips ```json fences models sometimes wrap structured output in, then
// re-serializes so callers always get clean, parseable JSON text.
function cleanJsonText(raw: string): string {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.stringify(JSON.parse(unfenced));
  } catch {
    return unfenced.trim();
  }
}

// Rough offline heuristic (~4 chars/token) so the stub still produces
// plausible, deterministic-for-the-same-input usage numbers.
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export default class Gemini {
  private client: GoogleGenAI | null;

  constructor(private store: DataStore, apiKey: string) {
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const { text, usage } = this.client
      ? await this.callGemini(prompt, options)
      : this.stubGenerate(prompt, options);

    await this.store.insert<TokenUsageRow>("token_usage", {
      user_id: options.userId ?? null,
      operation: options.operation,
      model: GEMINI_MODEL,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      request_id: options.requestId ?? null,
      created_at: new Date().toISOString(),
    });

    return { text, usage };
  }

  private async callGemini(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const response = await this.client!.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        ...(options.jsonSchema
          ? { responseMimeType: "application/json", responseSchema: options.jsonSchema }
          : {}),
      },
    });

    const rawText = response.text ?? "";
    const text = options.jsonSchema ? cleanJsonText(rawText) : rawText;

    const usage: UsageMetadata = {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    };

    return { text, usage };
  }

  private stubGenerate(prompt: string, options: GenerateOptions): GenerateResult {
    const text = options.jsonSchema
      ? JSON.stringify({ stub: true, operation: options.operation })
      : `[stub:${GEMINI_MODEL}] ${prompt}`;

    const promptTokens = estimateTokens(prompt);
    const completionTokens = estimateTokens(text);

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }
}
