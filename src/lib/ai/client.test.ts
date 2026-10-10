jest.mock('openai', () => ({
  __esModule: true,
  default: class {},
}))

jest.mock('../env', () => ({ env: {} }))

import { env } from '../env'
import {
  getAiApiKey,
  getAiBaseUrl,
  getAiProvider,
  getCategoryExtractModel,
  getReceiptExtractModel,
  getReceiptItemsModel,
} from './client'

// The mocked `env` is shared with the module under test, so mutating it here
// exercises the resolution exactly as a real deployment's environment would.
const mutableEnv = env as unknown as Record<string, string | undefined>

beforeEach(() => {
  for (const key of Object.keys(mutableEnv)) delete mutableEnv[key]
})

describe('AI provider configuration', () => {
  it('falls back to the historical OPENAI_* variables', () => {
    mutableEnv.OPENAI_API_KEY = 'sk-openai'
    mutableEnv.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    mutableEnv.OPENAI_MODEL_RECEIPT_EXTRACT = 'gpt-vision'
    mutableEnv.OPENAI_MODEL_CATEGORY_EXTRACT = 'gpt-text'

    expect(getAiApiKey()).toBe('sk-openai')
    expect(getAiBaseUrl()).toBe('https://api.openai.com/v1')
    expect(getAiProvider()).toBe('https://api.openai.com/v1')
    expect(getReceiptExtractModel()).toBe('gpt-vision')
    expect(getCategoryExtractModel()).toBe('gpt-text')
  })

  it('prefers the provider-neutral AI_* variables when both are set', () => {
    mutableEnv.OPENAI_API_KEY = 'sk-openai'
    mutableEnv.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    mutableEnv.OPENAI_MODEL_RECEIPT_EXTRACT = 'gpt-vision'
    mutableEnv.AI_API_KEY = 'gemini-key'
    mutableEnv.AI_BASE_URL =
      'https://generativelanguage.googleapis.com/v1beta/openai/'
    mutableEnv.AI_MODEL_RECEIPT_EXTRACT = 'gemini-2.5-flash'
    mutableEnv.AI_MODEL_CATEGORY_EXTRACT = 'gemini-2.5-flash-lite'

    expect(getAiApiKey()).toBe('gemini-key')
    expect(getAiBaseUrl()).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    )
    expect(getAiProvider()).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    )
    expect(getReceiptExtractModel()).toBe('gemini-2.5-flash')
    expect(getCategoryExtractModel()).toBe('gemini-2.5-flash-lite')
  })

  it('falls back to the receipt-extract model for the items model', () => {
    mutableEnv.AI_MODEL_RECEIPT_EXTRACT = 'vision-model'

    expect(getReceiptItemsModel()).toBe('vision-model')

    mutableEnv.AI_MODEL_RECEIPT_ITEMS_EXTRACT = 'items-model'
    expect(getReceiptItemsModel()).toBe('items-model')
  })

  it('reports a default provider label when no endpoint is configured', () => {
    expect(getAiBaseUrl()).toBeUndefined()
    expect(getAiProvider()).toBe('openai')
  })
})
