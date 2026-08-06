/**
 * Input sanitization helpers for free-text profile fields.
 *
 * Every persisted free-text field is Unicode-normalized (NFC) and stripped of
 * Unicode general-category C characters (controls, bidi/format overrides,
 * surrogates, private-use) so invisible characters cannot leak into storage or
 * cause downstream rendering/security issues.
 */

/**
 * NFC-normalize `input` and remove all Unicode category C characters
 * (Cc controls, Cf format/bidi overrides, Cs surrogates, Co private-use, Cn
 * unassigned). Legitimate text (emoji, accented Latin/CJK, etc.) is preserved.
 */
export function sanitiseString(input: string): string {
  const normalized = input.normalize("NFC");
  // \p{C} matches the Unicode general category C (controls / format /
  // surrogate / private-use / unassigned). Requires the `u` flag (ES2018+).
  return normalized.replace(/\p{C}/gu, "");
}

/**
 * Recursively apply {@link sanitiseString} to every string-valued field of
 * `record`, including nested objects and array elements. Non-string values
 * (numbers, booleans, null, undefined, Dates, etc.) are returned unchanged.
 */
export function sanitiseRecord<T>(record: T): T {
  return sanitiseValue(record) as T;
}

function sanitiseValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitiseString(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitiseValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = sanitiseValue(val);
    }
    return out;
  }
  return value;
}
