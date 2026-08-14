import { z } from "zod";

export const notificationEventTypeSchema = z.enum([
  "position.health_factor_warning",
  "position.liquidation_risk",
  "market.rate_change",
  "transaction.submitted",
  "transaction.confirmed",
]);

export const notificationChannelSchema = z.enum(["email", "in_app", "webhook"]);

export const notificationPreferenceUpdateSchema = z
  .object({
    eventType: notificationEventTypeSchema,
    channel: notificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict();

export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationPreferenceUpdateInput = z.infer<typeof notificationPreferenceUpdateSchema>;
