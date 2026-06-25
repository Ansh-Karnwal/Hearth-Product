import { GEMINI_API_KEY, LLM_BACKEND, OPENAI_API_KEY } from "../config";
import { DataStore } from "../data/store";
import Gemini from "./gemini";
import OpenAiLlm from "./openai";
import { LlmClient } from "./types";

export function createLlm(store: DataStore): LlmClient {
  if (LLM_BACKEND === "openai") {
    return new OpenAiLlm(store, OPENAI_API_KEY);
  }

  if (LLM_BACKEND !== "gemini") {
    console.warn(`Unknown LLM_BACKEND "${LLM_BACKEND}", falling back to Gemini.`);
  }

  return new Gemini(store, GEMINI_API_KEY);
}

export type { GenerateOptions, GenerateResult, LlmClient, UsageMetadata } from "./types";
