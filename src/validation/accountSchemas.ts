import { z } from "zod";

const MAX_DISPLAY_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 280;
const MAX_WEBSITE_LENGTH = 2048;

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH).nullable().optional(),
    bio: z.string().max(MAX_BIO_LENGTH).nullable().optional(),
    website: z.string().url().max(MAX_WEBSITE_LENGTH).nullable().optional(),
    timezone: z
      .string()
      .refine(isIanaTimeZone, "Must be a valid IANA timezone")
      .nullable()
      .optional(),
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
