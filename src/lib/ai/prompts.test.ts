import {
  buildCategoryExtractSystemPrompt,
  buildReceiptExtractPrompt,
  buildReceiptItemsPrompt,
} from './prompts'

const CATEGORIES = ['"General/General" (ID: 0)', '"Transport/Taxi" (ID: 4)']

describe('AI prompts', () => {
  it('lists the categories in the receipt-extract prompt', () => {
    const prompt = buildReceiptExtractPrompt(CATEGORIES)

    expect(prompt).toContain(CATEGORIES[0])
    expect(prompt).toContain(CATEGORIES[1])
    expect(prompt).toContain('Read the total amount')
    expect(prompt).toContain('Guess a title')
  })

  it('lists the categories and item/charge rules in the items prompt', () => {
    const prompt = buildReceiptItemsPrompt(CATEGORIES)

    expect(prompt).toContain(CATEGORIES[0])
    expect(prompt).toContain(CATEGORIES[1])
    expect(prompt).toContain('List every purchased line item')
    expect(prompt).toContain(
      'A normal purchased item must never be listed as a charge',
    )
  })

  it('includes the categories and the fallback in the category prompt', () => {
    const prompt = buildCategoryExtractSystemPrompt(CATEGORIES, CATEGORIES[0])

    expect(prompt).toContain(`Categories: ${CATEGORIES.join(',')}`)
    expect(prompt).toContain(`default to ${CATEGORIES[0]}`)
  })
})
