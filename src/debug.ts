// Single seam for verbose, opt-in tracing: LLM raw requests/responses (incl.
// web-search grounding) and every DataStore mutation route through here.
// Off by default — flip with DEBUG_MODE=true or the admin /debug command.

import { DEBUG_MODE } from "./config";

let debugEnabled = DEBUG_MODE;
let seq = 0;

export function isDebugMode(): boolean {
  return debugEnabled;
}

export function setDebugMode(enabled: boolean): void {
  debugEnabled = enabled;
}

export function debugLog(category: string, message: string, data?: unknown): void {
  if (!debugEnabled) return;
  seq += 1;
  console.log(`\n[DEBUG ${seq} ${new Date().toISOString()}] [${category}] ${message}`);
  if (data !== undefined) {
    console.dir(data, { depth: null, colors: true });
  }
}
