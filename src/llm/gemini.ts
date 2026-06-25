import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../config";
import { TokenUsageRow } from "../data/schema";
import { DataStore } from "../data/store";
import { debugLog } from "../debug";
import { GenerateOptions, GenerateResult, UsageMetadata } from "./types";

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
    debugLog("gemini:request", `operation=${options.operation} grounded=${!!options.grounded}`, {
      model: GEMINI_MODEL,
      prompt,
      system: options.system,
      jsonSchema: options.jsonSchema,
    });

    const response = await this.client!.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        ...(options.jsonSchema
          ? { responseMimeType: "application/json", responseSchema: options.jsonSchema }
          : {}),
        ...(options.grounded ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

    debugLog("gemini:raw-response", `operation=${options.operation}`, response);

    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    if (options.grounded && groundingMetadata) {
      debugLog("gemini:websearch", `operation=${options.operation}`, {
        queries: groundingMetadata.webSearchQueries,
        sources: groundingMetadata.groundingChunks?.map((chunk) => chunk.web),
      });
    }

    const rawText = response.text ?? "";
    const text = options.jsonSchema ? cleanJsonText(rawText) : rawText;
    if (text !== rawText) {
      debugLog("gemini:cleaned-text", `operation=${options.operation}`, { rawText, cleanedText: text });
    }

    const usage: UsageMetadata = {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    };

    return { text, usage };
  }

  private stubGenerate(prompt: string, options: GenerateOptions): GenerateResult {
    const text = this.stubText(prompt, options);
    debugLog("gemini:stub-response", `operation=${options.operation} (no GEMINI_API_KEY set)`, { prompt, text });

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

  private stubText(prompt: string, options: GenerateOptions): string {
    if (options.operation === "request_parse") {
      const request = /raw request:\s*"([^"]+)"/i.exec(prompt)?.[1] ?? prompt;
      const itemMatch = /\bbuy\s+me\s+(.+)$/i.exec(request.trim());
      const itemText = (itemMatch?.[1] ?? request).replace(/[?.!]+$/g, "").trim().toLowerCase();
      const quantityMatch = /^(\d+(?:\.\d+)?\s*(?:x|lb|lbs|oz|pack|packs|bunch|bunches|bag|bags)?)\s+(.+)$/i.exec(
        itemText
      );
      const itemName = (quantityMatch?.[2] ?? itemText).trim();
      const quantity = quantityMatch?.[1] ?? "1";
      return JSON.stringify({ itemName, quantity });
    }

    if (options.operation === "price_sweep") {
      const itemName = /item:\s*([^\n]+)/i.exec(prompt)?.[1]?.trim().toLowerCase() ?? "item";
      const unit = itemName.includes("celery") ? "bunch" : "each";
      const noClear = /ambiguous|tie|no clear|close call/i.test(itemName);
      const candidates = noClear
        ? [
            { store: "Trader Joe's", price: 2.0, unit },
            { store: "Star Market", price: 2.08, unit },
          ]
        : [
            { store: "Trader Joe's", price: 1.99, unit },
            { store: "Star Market", price: 2.49, unit },
            { store: "Whole Foods", price: 2.79, unit },
          ];
      return JSON.stringify({ candidates });
    }

    if (options.operation === "crowd_parse") {
      const reply = /reply:\s*"([^"]+)"/i.exec(prompt)?.[1] ?? prompt;
      const priceMatch = /\$?\s*(\d+(?:\.\d{1,2})?)/.exec(reply);
      const atStoreMatch = /\bat\s+([A-Za-z0-9 '&.-]+)/i.exec(reply);
      const storeMatch = /^([A-Za-z0-9 '&.-]+?)\s+(?:has|is|for|\$)/i.exec(reply);
      return JSON.stringify({
        store: (atStoreMatch?.[1] ?? storeMatch?.[1] ?? "Unknown store").trim(),
        price: priceMatch ? Number(priceMatch[1]) : null,
      });
    }

    if (options.operation === "growth_post") {
      const stat = /stat:\s*([\s\S]+)/i.exec(prompt)?.[1]?.trim() ?? prompt.trim();
      return `Hearth price watch: ${stat}`;
    }

    if (options.jsonSchema) {
      return JSON.stringify({ stub: true, operation: options.operation });
    }

    return `[stub:${GEMINI_MODEL}] ${prompt}`;
  }
}
