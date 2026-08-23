"""LLM helper — shared module for calling OpenAI/Gemini from agents.

Uses environment variables loaded by the backend's .env parser.
Never exposes keys in responses or logs.
"""

from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Any


def _get_gemini_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY")


def _get_openai_key() -> str | None:
    return os.environ.get("OPENAI_API_KEY")


def _get_azure_openai_key() -> str | None:
    return os.environ.get("AZURE_OPENAI_API_KEY")


def _get_azure_openai_endpoint() -> str | None:
    return os.environ.get("AZURE_OPENAI_ENDPOINT")


def call_llm(
    prompt: str,
    system: str = "",
    provider: str | None = None,
    model: str | None = None,
    timeout: float = 30.0,
) -> str | None:
    """Call an LLM and return the text response. Returns None on failure.

    Provider selection: tries gemini first (cheaper/faster), falls back to openai.
    """
    if provider is None:
        if _get_azure_openai_key() and _get_azure_openai_endpoint():
            provider = "azure"
        elif _get_gemini_key():
            provider = "gemini"
        elif _get_openai_key():
            provider = "openai"
        else:
            return None  # no LLM available

    if provider == "azure":
        return _call_azure_openai(prompt, system, model or os.environ.get("AZURE_OPENAI_MODEL", "gpt-5.5"), timeout)
    elif provider == "gemini":
        return _call_gemini(prompt, system, model or "gemini-2.5-flash", timeout)
    elif provider == "openai":
        return _call_openai(prompt, system, model or "gpt-4o-mini", timeout)
    return None


def _call_gemini(prompt: str, system: str, model: str, timeout: float) -> str | None:
    api_key = _get_gemini_key()
    if not api_key:
        return None

    contents = []
    if system:
        contents.append({"role": "user", "parts": [{"text": system}]})
        contents.append({"role": "model", "parts": [{"text": "Understood."}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    payload = json.dumps({"contents": contents}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
            return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return None


def _call_openai(prompt: str, system: str, model: str, timeout: float) -> str | None:
    api_key = _get_openai_key()
    if not api_key:
        return None

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = json.dumps({"model": model, "messages": messages}).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception:
        return None


def _call_azure_openai(prompt: str, system: str, model: str, timeout: float) -> str | None:
    """Call Azure OpenAI endpoint.

    Azure uses a different URL format and api-key header (not Bearer token).
    URL: {endpoint}/openai/deployments/{model}/chat/completions?api-version={version}
    """
    api_key = _get_azure_openai_key()
    endpoint = _get_azure_openai_endpoint()
    if not api_key or not endpoint:
        return None

    api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    url = f"{endpoint.rstrip('/')}/openai/deployments/{model}/chat/completions?api-version={api_version}"
    payload = json.dumps({"messages": messages}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        # Fall back to Gemini if Azure fails
        if _get_gemini_key():
            return _call_gemini(prompt, system, "gemini-2.5-flash", timeout)
        return None
