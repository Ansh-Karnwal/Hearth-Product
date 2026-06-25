"""Token-metered Gemini wrapper. Every Gemini call MUST go through here so
that every call writes a token_usage row — this is the monetization
backbone. No other module may call google-genai directly.
"""
import json
from datetime import datetime, timezone
from typing import Any, Optional

from hearth import config
from hearth.data.store import DataStore


class Gemini:
    def __init__(self, store: DataStore, api_key: Optional[str] = config.GEMINI_API_KEY):
        self.store = store
        self.api_key = api_key
        self._client = None
        if api_key:
            from google import genai

            self._client = genai.Client(api_key=api_key)

    def generate(
        self,
        prompt: str,
        *,
        operation: str,
        user_id: Optional[int] = None,
        request_id: Optional[int] = None,
        system: Optional[str] = None,
        json_schema: Optional[dict] = None,
    ) -> tuple[Any, dict]:
        """Generate text (or parsed JSON if json_schema is given).

        Returns (text_or_parsed_json, usage_dict) and always logs a
        token_usage row, regardless of which branch below runs.
        """
        if self._client is None:
            text, usage = self._stub_generate(prompt, json_schema=json_schema)
        else:
            text, usage = self._real_generate(prompt, system=system, json_schema=json_schema)

        self.store.insert(
            "token_usage",
            {
                "user_id": user_id,
                "operation": operation,
                "model": config.GEMINI_MODEL,
                "prompt_tokens": usage["prompt_tokens"],
                "completion_tokens": usage["completion_tokens"],
                "total_tokens": usage["total_tokens"],
                "request_id": request_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return text, usage

    def _real_generate(
        self, prompt: str, *, system: Optional[str], json_schema: Optional[dict]
    ) -> tuple[Any, dict]:
        from google.genai import types

        config_kwargs: dict[str, Any] = {}
        if system:
            config_kwargs["system_instruction"] = system
        if json_schema:
            config_kwargs["response_mime_type"] = "application/json"
            config_kwargs["response_json_schema"] = json_schema

        response = self._client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs) if config_kwargs else None,
        )

        usage_meta = response.usage_metadata
        usage = {
            "prompt_tokens": usage_meta.prompt_token_count or 0,
            "completion_tokens": usage_meta.candidates_token_count or 0,
            "total_tokens": usage_meta.total_token_count or 0,
        }

        text = response.text
        if json_schema:
            return json.loads(text), usage
        return text, usage

    def _stub_generate(
        self, prompt: str, *, json_schema: Optional[dict]
    ) -> tuple[Any, dict]:
        """Deterministic offline fallback used when GEMINI_API_KEY is unset,
        so the metering path is always testable without network access.
        """
        prompt_tokens = max(1, len(prompt) // 4)
        completion_text = f"[stub response to]: {prompt}"
        completion_tokens = max(1, len(completion_text) // 4)
        usage = {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }

        if json_schema:
            return self._stub_json(json_schema), usage
        return completion_text, usage

    @staticmethod
    def _stub_json(json_schema: dict) -> dict:
        _STUB_VALUES = {"string": "stub", "number": 0, "integer": 0, "boolean": False}
        result = {}
        for name, prop in json_schema.get("properties", {}).items():
            result[name] = _STUB_VALUES.get(prop.get("type"), None)
        return result
