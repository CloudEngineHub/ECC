# Connector Diagnostics Gap Playbook

Candidate id: `bounded-event-summary`

This is a synthetic, read-only worked example for the existing
[search-first skill](../../../skills/search-first/SKILL.md). The five artifacts
record expected rubric decisions, not a connector execution or model benchmark.
The motivating [feedback](https://github.com/affaan-m/ECC/issues/3680) reports a
corrected workflow; exact ECC activation, version and causal contribution are
unknown. The fixture does not reconstruct the original connector or deployment.

## Worked Comparison

| Requirement | Inspected fixture evidence | Remaining work |
| --- | --- | --- |
| Connection failures | Reachability and last connection error | Reuse existing path |
| Permission denials | Access diagnostic details | Reuse existing path |
| Repeated throttling | Individual throttle events | Check retention and aggregate over the interval |
| Deployed settings | Read unavailable | Keep unknown; do not infer absence |

Accepted draft: “The inspected connector already exposes connection and access
diagnostics plus throttle events. The missing behavior in the inspected path is
an interval summary. Check event retention and query support, then reuse that
query or add a thin summary operation. A separate collector is justified only if
required data or collection timing cannot be supplied by the existing connector.”

Rejected draft: “Settings search failed, so install a new background monitor for
all three failure classes.” This duplicates observed capabilities and converts
an unknown into a negative finding.

## Evaluation Controls

- With sufficient retained events, prefer reuse or a bounded summary extension.
- If retained events lack the required interval, name that evidence and compare
  the smallest connector extension with a separate component's added lifecycle.
- If research is unavailable, preserve the uncertainty and next targeted read;
  do not claim the feature is missing or demand a new subsystem by default.
- Do not deploy components or change connector configuration in this example.

## Repository Validation

Run `node tests/docs/evaluator-rag-prototype.test.js`, Markdown lint on touched
docs, and `git diff --check`. Those checks validate repository documentation;
they do not execute the connector or establish the historical report's cause.
