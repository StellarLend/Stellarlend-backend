# Error Telemetry

Server-side Sentry reporting is optional. Leave `SENTRY_DSN` unset in local
development and CI to disable outbound error reporting.

When `SENTRY_DSN` is configured, unhandled server errors are reported with only
the HTTP method, route, and request id. Full headers and cookies are not sent.
The `beforeSend` scrubber redacts email addresses, common wallet address
formats, authorization data, cookies, passwords, secrets, and token-like fields
before an event leaves the process.

If the Sentry client fails while capturing an error, the original API error
response is still returned to the caller.
