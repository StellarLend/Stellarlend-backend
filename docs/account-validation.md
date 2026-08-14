# Account Payload Validation

Account-related request bodies should use the schemas in `src/validation/`.
They are the single source of truth for profile updates and notification
preference updates.

`profileUpdateSchema` validates display name length, bio length, website URL
format, and IANA timezone names. `notificationPreferenceUpdateSchema` restricts
notification settings to known event types and channels.

Both schemas are strict. Unknown fields are rejected instead of silently
accepted, so route handlers and background workers fail consistently on
malformed account payloads.
