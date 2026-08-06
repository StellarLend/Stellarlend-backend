# Input Sanitization (Free-Text Profile Fields)

Related issue: `StellarLend/stellarlend-backend#19`

## Why

Free-text profile fields (`displayName`, `bio`, `website`, ...) accepted from
clients can carry invisible Unicode control / format characters — zero-width
spaces (`U+200B`), bidi overrides (`U+202E` and friends), surrogates, or
private-use code points. These render inconsistently and can be abused for
spoofing or to slip data past naive filters. Sanitization must happen in one
shared place, **after** zod validation and **before** persistence.

## What

Module: `src/lib/security/inputSanitizer.ts`

- `sanitiseString(input)` — NFC-normalizes the input and removes every Unicode
  general-category **C** character (controls, format/bidi overrides, surrogates,
  private-use, unassigned). Legitimate text (emoji, accented Latin, CJK) is
  preserved.
- `sanitiseRecord(record)` — recursively applies `sanitiseString` to every
  string-valued field of an object or array; non-string values are left
  untouched.

## Where it is wired

`src/repositories/profileRepository.ts` → `upsertProfile()` runs `sanitiseRecord`
over the update payload before it reaches Prisma, so **every** profile write is
sanitized regardless of which route triggered it.

## Contract notes for reviewers / downstream consumers

- Sanitization is **non-destructive to visible characters**: only category C
  code points are dropped; emoji, accents, and mixed scripts survive.
- NFC normalization means canonically-equivalent sequences compare equal after
  sanitization.
- The helper is pure and has no I/O dependency, so it is safe to call on any
  free-text intake, not just profiles.
