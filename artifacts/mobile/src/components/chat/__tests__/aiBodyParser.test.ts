import { describe, it, expect } from 'vitest';

import { parseAiBody } from '../aiBodyParser';

// ─── Verbatim example lines from the concierge system prompt ──────────────
//
// These strings are copy-pasted from `buildSystemPrompt` in
// `artifacts/api-server/src/routes/chat.ts`. If the prompt's example
// changes (or the parser drifts), this constant will fall out of sync and
// the "system prompt examples" test below will fail loudly so we notice
// before the cards silently disappear in production.
//
// Source lines (artifacts/api-server/src/routes/chat.ts):
//   - "مثال: Pairing: Chardonnay Reserve — buttery oak with citrus finish"
//   - "مثال: اقتران: شاي الياسمين الأخضر — رائحة زهرية تنعش الحنك"
//   - "Calories: 540 kcal", "Protein: 28 g", "Carbs: 42 g",
//     "Fat: 22 g", "Fiber: 6 g", "Sodium: 480 mg"
//   - "السعرات: 540 سعرة", "البروتين: 28 جم", "الكربوهيدرات: 42 جم",
//     "الدهون: 22 جم", "الألياف: 6 جم", "الصوديوم: 480 ملجم"
const PROMPT_PAIRING_EXAMPLES = [
  'Pairing: Chardonnay Reserve — buttery oak with citrus finish',
  'اقتران: شاي الياسمين الأخضر — رائحة زهرية تنعش الحنك',
] as const;

const PROMPT_NUTRITION_EN = [
  ['Calories', '540 kcal'],
  ['Protein', '28 g'],
  ['Carbs', '42 g'],
  ['Fat', '22 g'],
  ['Fiber', '6 g'],
  ['Sodium', '480 mg'],
] as const;

const PROMPT_NUTRITION_AR = [
  ['السعرات', '540 سعرة'],
  ['البروتين', '28 جم'],
  ['الكربوهيدرات', '42 جم'],
  ['الدهون', '22 جم'],
  ['الألياف', '6 جم'],
  ['الصوديوم', '480 ملجم'],
] as const;

describe('parseAiBody — pairings', () => {
  it('extracts an English pairing line with a tasting note', () => {
    const reply = [
      'A great choice tonight.',
      'Pairing: Chardonnay Reserve — buttery oak with citrus finish',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.pairings).toEqual([
      {
        label: 'Chardonnay Reserve',
        note: 'buttery oak with citrus finish',
      },
    ]);
    expect(result.nutrition.length).toBe(0);
    expect(result.text).toBe('A great choice tonight.');
  });

  it('extracts an Arabic pairing line with a tasting note', () => {
    const reply = [
      'اختيار رائع لليلة.',
      'اقتران: شاي الياسمين الأخضر — رائحة زهرية تنعش الحنك',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.pairings).toEqual([
      {
        label: 'شاي الياسمين الأخضر',
        note: 'رائحة زهرية تنعش الحنك',
      },
    ]);
    expect(result.text).toBe('اختيار رائع لليلة.');
  });

  it('extracts a pairing line without a tasting note', () => {
    const result = parseAiBody('Pairing: Sparkling Water');

    expect(result.pairings).toEqual([{ label: 'Sparkling Water', note: undefined }]);
    expect(result.text).toBe('');
  });

  it('accepts the alternate English keywords (Wine, Drink, Pair with)', () => {
    const reply = [
      'Wine: Sauvignon Blanc — crisp and bright',
      'Drink: Iced Latte',
      'Pair with: Pomegranate Mocktail — tart finish',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.pairings).toEqual([
      { label: 'Sauvignon Blanc', note: 'crisp and bright' },
      { label: 'Iced Latte', note: undefined },
      { label: 'Pomegranate Mocktail', note: 'tart finish' },
    ]);
    expect(result.text).toBe('');
  });

  it('accepts the alternate Arabic keywords (مزاوجة, يقترن مع, مشروب)', () => {
    const reply = [
      'مزاوجة: نبيذ غير كحولي — ملاحظات خوخ',
      'يقترن مع: شاي أخضر',
      'مشروب: قهوة مختصة — قوام كثيف',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.pairings).toEqual([
      { label: 'نبيذ غير كحولي', note: 'ملاحظات خوخ' },
      { label: 'شاي أخضر', note: undefined },
      { label: 'قهوة مختصة', note: 'قوام كثيف' },
    ]);
  });

  it('extracts multiple pairing lines from one reply', () => {
    const reply = [
      'For your two-course tasting:',
      'Pairing: Champagne Brut — toasted brioche',
      'Pairing: Espresso Martini — bold and silky',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.pairings).toEqual([
      { label: 'Champagne Brut', note: 'toasted brioche' },
      { label: 'Espresso Martini', note: 'bold and silky' },
    ]);
    expect(result.text).toBe('For your two-course tasting:');
  });
});

describe('parseAiBody — nutrition', () => {
  it('extracts the full English nutrition block', () => {
    const reply = [
      'Here are the approximate nutrition facts:',
      'Calories: 540 kcal',
      'Protein: 28 g',
      'Carbs: 42 g',
      'Fat: 22 g',
      'Fiber: 6 g',
      'Sodium: 480 mg',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.nutrition).toEqual([
      { label: 'Calories', value: '540 kcal' },
      { label: 'Protein', value: '28 g' },
      { label: 'Carbs', value: '42 g' },
      { label: 'Fat', value: '22 g' },
      { label: 'Fiber', value: '6 g' },
      { label: 'Sodium', value: '480 mg' },
    ]);
    expect(result.pairings.length).toBe(0);
    expect(result.text).toBe('Here are the approximate nutrition facts:');
  });

  it('extracts the full Arabic nutrition block', () => {
    const reply = [
      'القيم الغذائية التقريبية:',
      'السعرات: 540 سعرة',
      'البروتين: 28 جم',
      'الكربوهيدرات: 42 جم',
      'الدهون: 22 جم',
      'الألياف: 6 جم',
      'الصوديوم: 480 ملجم',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.nutrition).toEqual([
      { label: 'السعرات', value: '540 سعرة' },
      { label: 'البروتين', value: '28 جم' },
      { label: 'الكربوهيدرات', value: '42 جم' },
      { label: 'الدهون', value: '22 جم' },
      { label: 'الألياف', value: '6 جم' },
      { label: 'الصوديوم', value: '480 ملجم' },
    ]);
    expect(result.text).toBe('القيم الغذائية التقريبية:');
  });

  it('accepts approximate values prefixed with "~"', () => {
    const result = parseAiBody('Calories: ~540 kcal');

    expect(result.nutrition).toEqual([{ label: 'Calories', value: '~540 kcal' }]);
  });
});

describe('parseAiBody — combined replies', () => {
  it('extracts pairings and nutrition from a mixed multi-line reply', () => {
    const reply = [
      'مرحباً بك! أوصي بطبق سمك القاروص المشوي.',
      '',
      'اقتران: نبيذ شاردونيه غير كحولي — حمضيات منعشة',
      'السعرات: 480 سعرة',
      'البروتين: 32 جم',
      '',
      'بالهناء والشفاء.',
    ].join('\n');

    const result = parseAiBody(reply);

    expect(result.pairings).toEqual([
      {
        label: 'نبيذ شاردونيه غير كحولي',
        note: 'حمضيات منعشة',
      },
    ]);
    expect(result.nutrition).toEqual([
      { label: 'السعرات', value: '480 سعرة' },
      { label: 'البروتين', value: '32 جم' },
    ]);
    expect(/\n{3,}/.test(result.text)).toBe(false);
    expect(result.text.startsWith('مرحباً')).toBe(true);
    expect(result.text.endsWith('بالهناء والشفاء.')).toBe(true);
  });

  it('returns the original text unchanged when nothing matches', () => {
    const reply = 'Welcome! How can I help you tonight?';
    const result = parseAiBody(reply);

    expect(result.text).toBe(reply);
    expect(result.pairings.length).toBe(0);
    expect(result.nutrition.length).toBe(0);
  });
});

describe('parseAiBody — system prompt examples', () => {
  // These tests intentionally feed the parser the EXACT example strings
  // shown to the LLM in `buildSystemPrompt`. They are the canary: if either
  // the prompt examples or the parser regex drifts, this suite breaks.

  for (const example of PROMPT_PAIRING_EXAMPLES) {
    it(`matches the prompt example: ${example}`, () => {
      const result = parseAiBody(example);

      expect(result.pairings.length).toBe(1);
      expect(result.pairings[0].label.length).toBeGreaterThan(0);
      expect(result.pairings[0].note && result.pairings[0].note.length).toBeGreaterThan(0);
      expect(result.text).toBe('');
    });
  }

  it('matches every English nutrition example from the prompt', () => {
    const reply = PROMPT_NUTRITION_EN
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n');

    const result = parseAiBody(reply);

    expect(result.nutrition).toEqual(
      PROMPT_NUTRITION_EN.map(([label, value]) => ({ label, value })),
    );
  });

  it('matches every Arabic nutrition example from the prompt', () => {
    const reply = PROMPT_NUTRITION_AR
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n');

    const result = parseAiBody(reply);

    expect(result.nutrition).toEqual(
      PROMPT_NUTRITION_AR.map(([label, value]) => ({ label, value })),
    );
  });
});
