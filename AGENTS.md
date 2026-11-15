# Development rules

- Work only in this repository; parent sources/ is read-only reference material.
- Commit meaningful, tested milestones locally. Push only on explicit user request.
- Public repository: never commit local configuration, API tokens, household history,
  site identifiers, travel details, live forecasts or generated reports.
- Keep dependencies minimal. Run node --test before committing code changes.
- Advisory mode only: no device writes or automatic charging commands.
- Preserve uncertainty: missing/stale data is not zero; unknown plug state is not unplugged.
- Circuit constraints apply regardless of PV surplus or battery supply.

## Tests first for behavior changes

- For bug fixes, first add a regression test that reproduces the faulty behavior
  and verify that it fails for the intended reason. Then make the smallest fix.
- For new non-trivial behavior, write a small behavior-based test before the
  implementation: red, green, then simplify while tests remain green.
- Test observable behavior and important invariants, especially money, energy
  balance, missing data, time zones, device limits and immutable history.
  Do not mirror implementation details or chase a coverage percentage.
- Documentation-only and trivial presentation changes do not need invented tests.
  Hardware-dependent behavior needs an appropriate integration check when feasible;
  record what could not be checked instead of treating mocks as hardware evidence.
- Run affected tests while iterating and the full `node --test` suite before
  committing code. Record results and remaining limitations.

## Smallest complete solution

These project rules follow the approach described by
[Ponytail](https://github.com/dietrichgebert/ponytail); no plugin installation is
required to apply them.

- Read the affected code and find its callers before changing it. Include tests,
  configuration, reports and documentation in the scope when behavior changes.
- Reuse existing helpers and standard-library facilities. Add dependencies,
  abstractions or configuration only when the requested behavior needs them.
- Prefer clear, small changes. Avoid speculative features and unrelated refactors;
  fewer lines do not justify obscure code.
- Never simplify away validation, data-loss protection, security, accessibility,
  circuit constraints or hardware calibration requirements.
- Explain known shortcuts with `shortcut: <limit>, <when to revisit>` and report
  material unchecked behavior or risks when handing over a change.
- Before deployment, back up the installed version and persistent app data.
  Keep documentation aligned with the delivered behavior.
