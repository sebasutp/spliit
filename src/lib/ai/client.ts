import { env } from '@/lib/env'
import OpenAI from 'openai'

/**
 * The single place the AI provider is configured.
 *
 * Spliit talks to any endpoint that speaks the OpenAI Chat Completions API, so
 * pointing it at Google Gemini, Ollama, OpenRouter, Groq, a self-hosted
 * gateway, ... is a matter of environment variables. The provider-neutral
 * `AI_*` variables take precedence over the historical `OPENAI_*` ones, which
 * stay supported so existing deployments keep working unchanged.
 *
 * See "AI provider" in README.md and the `.env.example` block for examples.
 */

/** The configured endpoint, or `undefined` for the official OpenAI API. */
export function getAiBaseUrl(): string | undefined {
  return env.AI_BASE_URL ?? env.OPENAI_BASE_URL
}

/** The configured API key. A dummy value is fine for endpoints that ignore it. */
export function getAiApiKey(): string | undefined {
  return env.AI_API_KEY ?? env.OPENAI_API_KEY
}

/**
 * A short label for the configured provider, recorded on each receipt for
 * debugging. Returns `openai` when no custom endpoint is set.
 */
export function getAiProvider(): string {
  return getAiBaseUrl() ?? 'openai'
}

export function getReceiptExtractModel(): string {
  return (
    env.AI_MODEL_RECEIPT_EXTRACT ??
    env.OPENAI_MODEL_RECEIPT_EXTRACT ??
    'gpt-5-nano'
  )
}

/** The line-items model, falling back to the receipt-extract model. */
export function getReceiptItemsModel(): string {
  return (
    env.AI_MODEL_RECEIPT_ITEMS_EXTRACT ??
    env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT ??
    getReceiptExtractModel()
  )
}

export function getCategoryExtractModel(): string {
  return (
    env.AI_MODEL_CATEGORY_EXTRACT ??
    env.OPENAI_MODEL_CATEGORY_EXTRACT ??
    'gpt-5-nano'
  )
}

/**
 * Shared OpenAI-compatible client. The SDK also reads `OPENAI_API_KEY` from the
 * environment, but we pass the resolved value so the provider-neutral
 * `AI_API_KEY` works too.
 */
export const openai = new OpenAI({
  apiKey: getAiApiKey(),
  baseURL: getAiBaseUrl(),
})
