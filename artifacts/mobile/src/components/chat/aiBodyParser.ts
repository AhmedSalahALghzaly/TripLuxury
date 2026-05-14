// Parser for the concierge's AI replies.
//
// The mobile chat surfaces dedicated PAIRING and NUTRITION cards whenever the
// AI emits the canonical lines taught by `buildSystemPrompt` in
// `artifacts/api-server/src/routes/chat.ts`. The regexes below MUST stay in
// sync with the example lines in that prompt — see
// `aiBodyParser.test.ts` for the verbatim example coverage that fails loudly
// if either side drifts.

export interface PairingHit {
  label: string;
  note?: string;
}

export interface NutritionHit {
  label: string;
  value: string;
}

export interface ParsedAiBody {
  text: string;
  pairings: PairingHit[];
  nutrition: NutritionHit[];
}

export const PAIRING_LINE_RE =
  /(?:^|\n)\s*(?:🍷|🥂|🍾|🍶|🍸)?\s*(?:Pairing|Wine|Drink|Pair with|اقتران|مزاوجة|يقترن مع|مشروب)\s*[:：—-]\s*([^\n]+)/giu;

export const NUTRITION_LINE_RE =
  /(?:^|\n)\s*(?:🔥|⚡|🥗)?\s*(Calories|Kcal|Protein|Carbs|Fat|Fiber|Sodium|السعرات|البروتين|الكربوهيدرات|الدهون|الألياف|الصوديوم)\s*[:：—-]\s*([^\n]+)/giu;

export function parseAiBody(body: string): ParsedAiBody {
  const pairings: PairingHit[] = [];
  const nutrition: NutritionHit[] = [];
  let text = body;

  text = text.replace(PAIRING_LINE_RE, (_match, p1: string) => {
    const raw = p1.trim().replace(/^[—–-]\s*/, '');
    // Split on first " — " / " - " / " | " for an optional tasting note.
    const parts = raw.split(/\s+[—–|-]\s+/);
    pairings.push({
      label: parts[0].trim(),
      note: parts.length > 1 ? parts.slice(1).join(' — ').trim() : undefined,
    });
    return '';
  });

  text = text.replace(NUTRITION_LINE_RE, (_match, label: string, value: string) => {
    nutrition.push({ label: label.trim(), value: value.trim() });
    return '';
  });

  // Tidy up doubled blank lines left by stripped matches.
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return { text, pairings, nutrition };
}
