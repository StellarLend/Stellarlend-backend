import { describe, expect, it } from "vitest";

import { profileUpdateSchema } from "../src/validation/accountSchemas.js";
import { notificationPreferenceUpdateSchema } from "../src/validation/notificationPreferenceSchemas.js";

describe("profileUpdateSchema", () => {
  it("accepts a valid profile update payload", () => {
    const result = profileUpdateSchema.parse({
      displayName: "Alice Developer",
      bio: "Building decentralized lending tools.",
      website: "https://example.com",
      timezone: "America/New_York",
    });

    expect(result).toMatchObject({
      displayName: "Alice Developer",
      timezone: "America/New_York",
    });
  });

  it("rejects a display name that is too long", () => {
    expect(() => profileUpdateSchema.parse({ displayName: "a".repeat(51) })).toThrow();
  });

  it("rejects a bio that is too long", () => {
    expect(() => profileUpdateSchema.parse({ bio: "a".repeat(281) })).toThrow();
  });

  it("rejects an invalid website URL", () => {
    expect(() => profileUpdateSchema.parse({ website: "not-a-url" })).toThrow();
  });

  it("rejects an invalid timezone", () => {
    expect(() => profileUpdateSchema.parse({ timezone: "Mars/Olympus_Mons" })).toThrow();
  });

  it("rejects unknown profile fields", () => {
    expect(() =>
      profileUpdateSchema.parse({
        displayName: "Alice",
        role: "admin",
      }),
    ).toThrow();
  });
});

describe("notificationPreferenceUpdateSchema", () => {
  it("accepts a valid notification preference update payload", () => {
    const result = notificationPreferenceUpdateSchema.parse({
      eventType: "position.health_factor_warning",
      channel: "email",
      enabled: true,
    });

    expect(result).toMatchObject({
      eventType: "position.health_factor_warning",
      channel: "email",
      enabled: true,
    });
  });

  it("rejects unknown notification event types", () => {
    expect(() =>
      notificationPreferenceUpdateSchema.parse({
        eventType: "position.unknown_event",
        channel: "email",
        enabled: true,
      }),
    ).toThrow();
  });

  it("rejects unknown notification channels", () => {
    expect(() =>
      notificationPreferenceUpdateSchema.parse({
        eventType: "position.health_factor_warning",
        channel: "sms",
        enabled: true,
      }),
    ).toThrow();
  });

  it("rejects unknown notification preference fields", () => {
    expect(() =>
      notificationPreferenceUpdateSchema.parse({
        eventType: "position.health_factor_warning",
        channel: "email",
        enabled: true,
        phoneNumber: "+15555555555",
      }),
    ).toThrow();
  });
});
