/**
 * JSON Schemas handed to the model with `strict: true`, kept next to the
 * prompts they constrain.
 *
 * OpenAI's strict structured-output mode requires `additionalProperties: false`
 * and every property to be listed in `required` at each object level. The
 * response is still parsed rather than trusted (see the server actions), since
 * a self-hosted or older endpoint may ignore the schema entirely.
 */

export const RECEIPT_EXTRACT_JSON_SCHEMA = {
  name: 'receipt_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      categoryId: { type: 'string' },
      date: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['amount', 'categoryId', 'date', 'title'],
    additionalProperties: false,
  },
}

export const CATEGORY_EXTRACT_JSON_SCHEMA = {
  name: 'category_response',
  strict: true,
  schema: {
    type: 'object',
    properties: { categoryId: { type: 'integer' } },
    required: ['categoryId'],
    additionalProperties: false,
  },
}
