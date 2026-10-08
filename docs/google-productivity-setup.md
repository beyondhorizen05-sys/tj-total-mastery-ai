# Google productivity connectors

TJ can read Google Calendar events and important Gmail message metadata after you authorize each connector. It cannot access either account until its own OAuth credentials are configured and **Test Connection** succeeds. Credentials are stored in TJ's encrypted vault; only configured field names appear in connector status.

## Google setup

1. In a Google Cloud project you control, enable the **Google Calendar API** and **Gmail API**, configure an OAuth consent screen, and create an OAuth client.
2. Grant offline access and get a refresh token for each read-only scope:
   - Calendar: `https://www.googleapis.com/auth/calendar.events.readonly`
   - Gmail: `https://www.googleapis.com/auth/gmail.readonly`
3. In TJ's Connectors page, configure `google_calendar` and `gmail` separately with that client's `client_id`, `client_secret`, and the corresponding `refresh_token`.
4. Run **Test Connection** for each. TJ marks a connector **CONNECTED** only after a real API read succeeds. A missing field, expired or revoked token, disabled API, or missing scope is reported as an error.

Google may require OAuth app verification for Gmail's restricted read scope before general distribution. For now the app needs a refresh token generated through your own authorized OAuth client; it does not contain a built-in Google consent flow.

## Weekday summary

The explicit endpoint `POST /api/v1/automations/weekday-summary` with body `{"timezone":"Asia/Dubai","enabled":true}` creates a workflow and weekday 08:00 schedule in that IANA timezone. Omit `enabled` or set it to `false` to save it disabled. The response contains the workflow and automation IDs. The normal Automations API can trigger a test run and list execution history.

The briefing reads **only** connectors marked CONNECTED, plus local active TJ tasks. It reports disconnected or failed sources and still returns the available parts. No AI model credits are needed. In TJ's `local-only` privacy mode, network connector workflow actions are blocked even if configured; select a network-permitting privacy mode before enabling this automation.

Transient Google read failures (HTTP 429 or 5xx) receive one short retry. OAuth rejection and other permanent failures are reported as unavailable without retrying. The schedule starts a workflow run and stores its briefing in local run history; it does not send a push notification or email. TJ must be running at the scheduled time for this in-process schedule to fire.

API references: [Calendar events.list](https://developers.google.com/calendar/api/v3/reference/events/list), [Gmail messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Google OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server).
