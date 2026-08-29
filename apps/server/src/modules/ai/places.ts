/**
 * Known crops and mandis, used only to resolve words the farmer actually said
 * into real coordinates. Nothing here fills in a value that was not spoken —
 * a missing crop or destination still produces a follow-up question (ADR-014).
 */
interface CropWords {
  name: string;
  words: string[];
}

/** English plus the Marathi/Hindi words a farmer actually uses. */
export const KNOWN_CROPS: CropWords[] = [
  { name: 'Onion', words: ['onion', 'कांदा', 'कांदे', 'प्याज'] },
  { name: 'Tomato', words: ['tomato', 'टोमॅटो', 'टमाटर'] },
  { name: 'Potato', words: ['potato', 'बटाटा', 'बटाटे', 'आलू'] },
  { name: 'Grapes', words: ['grape', 'grapes', 'द्राक्ष', 'अंगूर'] },
  { name: 'Pomegranate', words: ['pomegranate', 'डाळिंब', 'अनार'] },
  { name: 'Banana', words: ['banana', 'केळी', 'केला'] },
];

export interface KnownMandi {
  name: string;
  lat: number;
  lng: number;
  aliases: string[];
}

export const KNOWN_MANDIS: KnownMandi[] = [
  { name: 'Lasalgaon Mandi', lat: 20.1417, lng: 74.2389, aliases: ['lasalgaon', 'लासलगाव'] },
  { name: 'Pune Market Yard', lat: 18.4805, lng: 73.8683, aliases: ['pune', 'market yard', 'पुणे'] },
  { name: 'Vashi APMC', lat: 19.0662, lng: 73.0021, aliases: ['vashi', 'apmc', 'वाशी'] },
  { name: 'Ahmednagar Mandi', lat: 19.0948, lng: 74.748, aliases: ['ahmednagar', 'nagar', 'अहमदनगर'] },
  { name: 'Solapur Mandi', lat: 17.6599, lng: 75.9064, aliases: ['solapur', 'सोलापूर'] },
];

/** Returns the crop only if one of its names appears in the utterance. */
export function findCrop(text: string): string | null {
  const lower = normaliseDigits(text).toLowerCase();
  return KNOWN_CROPS.find((crop) => crop.words.some((word) => lower.includes(word)))?.name ?? null;
}

/** Devanagari digits so "५००" reads as 500. */
export function normaliseDigits(text: string): string {
  return text.replace(/[\u0966-\u096F]/g, (d) =>
    String(d.charCodeAt(0) - 0x0966),
  );
}

/** Returns the mandi only if its name or a known alias appears in the utterance. */
export function findMandi(text: string): KnownMandi | null {
  const lower = normaliseDigits(text).toLowerCase();
  return (
    KNOWN_MANDIS.find(
      (mandi) =>
        lower.includes(mandi.name.toLowerCase()) ||
        mandi.aliases.some((alias) => lower.includes(alias)),
    ) ?? null
  );
}

/** Quintals and tonnes are how farmers actually speak about weight. */
export function findQuantityKg(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(kg|kilo|किलो|quintal|क्विंटल|ton|tonne|टन)/i.exec(
    normaliseDigits(text),
  );
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('quintal') || unit === 'क्विंटल') return value * 100;
  if (unit.startsWith('ton') || unit === 'टन') return value * 1000;
  return value;
}
