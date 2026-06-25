import OpenAI from "openai";
import { OPENAI_MODEL } from "../config";
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

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function outputTextFrom(response: any): string {
  if (typeof response.output_text === "string") return response.output_text;

  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}

export default class OpenAiLlm {
  private client: OpenAI | null;

  constructor(private store: DataStore, apiKey: string) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const { text, usage } = this.client
      ? await this.callOpenAi(prompt, options)
      : this.stubGenerate(prompt, options);

    await this.store.insert<TokenUsageRow>("token_usage", {
      user_id: options.userId ?? null,
      operation: options.operation,
      model: OPENAI_MODEL,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      request_id: options.requestId ?? null,
      created_at: new Date().toISOString(),
    });

    return { text, usage };
  }

  private async callOpenAi(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const input = [
      ...(options.system ? [{ role: "system", content: options.system }] : []),
      { role: "user", content: prompt },
    ];

    debugLog("openai:request", `operation=${options.operation} grounded=${!!options.grounded}`, {
      model: OPENAI_MODEL,
      input,
      jsonSchema: options.jsonSchema,
    });

    const response = await this.client!.responses.create({
      model: OPENAI_MODEL,
      input,
      max_output_tokens: options.jsonSchema ? 500 : 800,
      ...(options.grounded
        ? {
            tools: [{ type: "web_search", search_context_size: "low" }],
            tool_choice: "auto",
          }
        : {}),
      ...(options.jsonSchema
        ? {
            text: {
              format: {
                type: "json_schema",
                name: `${options.operation}_response`,
                schema: options.jsonSchema,
                strict: false,
              },
            },
          }
        : {}),
    } as any);

    debugLog("openai:raw-response", `operation=${options.operation}`, response);

    if (options.grounded) {
      const searchCalls = (response.output ?? []).filter(
        (item: { type?: string }) => item.type === "web_search_call"
      );
      if (searchCalls.length > 0) {
        debugLog("openai:websearch", `operation=${options.operation}`, searchCalls);
      }
    }

    const rawText = outputTextFrom(response);
    const text = options.jsonSchema ? cleanJsonText(rawText) : rawText;
    if (text !== rawText) {
      debugLog("openai:cleaned-text", `operation=${options.operation}`, { rawText, cleanedText: text });
    }

    const usage: UsageMetadata = {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return { text, usage };
  }

  private stubGenerate(prompt: string, options: GenerateOptions): GenerateResult {
    const text = this.stubText(prompt, options);
    debugLog("openai:stub-response", `operation=${options.operation} (no OPENAI_API_KEY set)`, { prompt, text });
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
      if (noClear) {
        return JSON.stringify({
          candidates: [
            { store: "Trader Joe's", price: 2.0, unit },
            { store: "Star Market", price: 2.08, unit },
          ],
        });
      }

      return JSON.stringify({
        candidates: [
          { store: "Trader Joe's", price: 1.99, unit },
          { store: "Star Market", price: 2.49, unit },
          { store: "Whole Foods", price: 2.79, unit },
        ],
      });
    }

    if (options.operation === "crowd_parse") {
      const reply = /reply:\s*"([^"]+)"/i.exec(prompt)?.[1] ?? prompt;
      const priceMatch = /\$?\s*(\d+(?:\.\d{1,2})?)/.exec(reply);
      const storeMatch = /^([A-Za-z0-9 '&.-]+?)\s+(?:has|is|for|\$)/i.exec(reply);
      return JSON.stringify({
        store: (storeMatch?.[1] ?? "Unknown store").trim(),
        price: priceMatch ? Number(priceMatch[1]) : null,
      });
    }

    if (options.operation === "growth_post") {
      const stat = /stat:\s*([\s\S]+)/i.exec(prompt)?.[1]?.trim() ?? prompt.trim();
      return `Hearth price watch: ${stat}`;
    }

    if (options.operation === "purchase_highlight") {
      const item = /Item:\s*([^\n]+)/i.exec(prompt)?.[1]?.trim() ?? "something";
      return `One of my customers just grabbed ${item}. Good times.`;
    }

    if (options.jsonSchema) {
      return JSON.stringify({ stub: true, operation: options.operation });
    }

    return `[stub:${OPENAI_MODEL}] ${prompt}`;
  }
}
