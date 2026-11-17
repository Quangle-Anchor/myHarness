# Operations

## Rate limits

Each session may create at most 120 orders per hour. The limit is enforced at the gateway, not in this service.

## Release checklist

1. Run the smoke script against staging.
2. Confirm `SESSION_SECRET` is set; the fallback secret is for local development only.
3. Tag the release as `v<major>.<minor>.<patch>`.
