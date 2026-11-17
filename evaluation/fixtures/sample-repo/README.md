# Parcel Tracker API

A small HTTP service that tracks parcel orders. It is the fixture workspace for agent evaluation.

- `src/server.js` wires routes and middleware.
- `src/auth/` issues and verifies session tokens.
- `src/orders/` stores and queries orders in memory.
- `docs/operations.md` describes rate limits and the release checklist.

The service listens on port 4317 by default (`PORT` overrides it).
