const SEARCH_WEAK_SYMBOL_PATTERN = /[-_・.'!?]/gu;
const BRACKET_SYMBOL_PATTERN = /[()[\]{}]/gu;
const WHITESPACE_PATTERN = /\s+/gu;

const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const HANGUL_JUNGSEONG_COUNT = 21;
const HANGUL_JONGSEONG_COUNT = 28;
const HANGUL_COMPATIBILITY_INITIALS_PATTERN = /^[ㄱ-ㅎ]+$/u;
const HANGUL_INITIALS = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ"
] as const;

export type AliasSearchFields = {
  normalizedAlias: string;
  chosungAlias: string;
};

export const MIN_CHOSUNG_SEARCH_LENGTH = 2;

export function normalizeSearchText(input: string): string {
  return normalizeSearchComparableText(input, "NFKC");
}

export function extractHangulChosung(input: string): string {
  let chosung = "";

  for (const char of input.normalize("NFC")) {
    const codePoint = char.codePointAt(0);

    if (
      codePoint === undefined ||
      codePoint < HANGUL_SYLLABLE_START ||
      codePoint > HANGUL_SYLLABLE_END
    ) {
      continue;
    }

    const syllableIndex = codePoint - HANGUL_SYLLABLE_START;
    const initialIndex = Math.floor(
      syllableIndex / (HANGUL_JUNGSEONG_COUNT * HANGUL_JONGSEONG_COUNT)
    );

    chosung += HANGUL_INITIALS[initialIndex];
  }

  return chosung;
}

export function buildAliasSearchFields(alias: string): AliasSearchFields {
  return {
    normalizedAlias: normalizeSearchText(alias),
    chosungAlias: extractHangulChosung(alias)
  };
}

export function normalizeChosungQuery(input: string): string {
  // Keep NFC here: NFKC rewrites Hangul compatibility jamo such as "ㅍㅅ",
  // which must stay byte-compatible with stored chosung_alias values.
  return normalizeSearchComparableText(input, "NFC");
}

function normalizeSearchComparableText(
  input: string,
  normalizationForm: "NFC" | "NFKC"
): string {
  return input
    .trim()
    .normalize(normalizationForm)
    .toLowerCase()
    .replace(BRACKET_SYMBOL_PATTERN, "")
    .replace(SEARCH_WEAK_SYMBOL_PATTERN, "")
    .replace(WHITESPACE_PATTERN, "");
}

export function canUseHangulChosungSearch(chosung: string): boolean {
  return (
    chosung.length >= MIN_CHOSUNG_SEARCH_LENGTH &&
    HANGUL_COMPATIBILITY_INITIALS_PATTERN.test(chosung)
  );
}
