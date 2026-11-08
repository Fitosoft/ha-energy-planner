# Development rules

- Work only in this repository; parent sources/ is read-only reference material.
- Commit meaningful, tested milestones locally. Push only on explicit user request.
- Public repository: never commit local configuration, API tokens, household history,
  site identifiers, travel details, live forecasts or generated reports.
- Keep dependencies minimal. Run node --test before committing code changes.
- Advisory mode only: no device writes or automatic charging commands.
- Preserve uncertainty: missing/stale data is not zero; unknown plug state is not unplugged.
- Circuit constraints apply regardless of PV surplus or battery supply.
