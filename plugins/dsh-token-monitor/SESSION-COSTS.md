# Session cost fallback wire contract

GET /api/token-monitor/session-costs is an authenticated, read-only view of the persistent usage ledger. It neither changes billing eligibility nor rewrites raw session identities, ledger records, projections, or global ledger totals.

## Normal row

A unique identity retains the existing shape: id and sessionId are the same normalized identity; cost, calls, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, totalTokens, and lastActivity are numbers. status may be absent or priced. Only finite positive normal amounts are returned. outputTokens already includes reasoning where supplied by the collector; this route does not add reasoning again.

## Explicit identity conflict

Removing a single session- prefix is a lookup convention, not proof that two raw identities describe the same event or share ownership. Multiple summaries under one normalized identity (including exact duplicates) or distinct metadata records under one normalized identity produce a conflict. Indexing the very same metadata object under multiple map keys is not a second record.

A conflict row has id, sessionId, status: conflict, cost: null, lastActivity, and a nonempty conflicts array. It has **no call or token counters**. Each evidence entry contains normalizedId, sorted rawSessionIds, and reasons from normalized-id-collision, duplicate-summary, metadata-id-collision. null means pending review, never zero. No winner is selected, no value-based deduplication is attempted, and ambiguous amounts are not summed.

Known compatible parent metadata is traversed with cycle protection. A collision suppresses the source row and every reachable dependent root, including synthetic child-only roots. Known cross-project edges are excluded; missing parents do not create inferred ownership. Independent conflict evidence at one root is merged. Unrelated rows and global ledger totals remain unchanged. A subsequent unambiguous snapshot can recover normally.

## Client display and compatibility

The matching client validates the real HTTP body before accepting a snapshot. Malformed rows reject the whole snapshot and retain the last successful cache, including existing conflict warnings. A valid empty snapshot clears the cache. Defensive duplicate identities are indexed as conflicts before zero-cost filtering. Conflict state overrides any projected amount at all three consumers: native cost badge, session statistics, and legacy-host bridge. The Chinese label is 会话标识冲突／金额待核对; localized text belongs to the detail locale. No trusted amount, zero, or counters are displayed for a conflict.

Host and client must be delivered as a matching package. An old client can discard an unfamiliar conflict row and show projection data; an old host can already have collapsed identities before transmission. The new client cannot reconstruct discarded evidence or guarantee dependent-root suppression from an old host. Normal-row compatibility is preserved, but mixed-version conflict safety is not an acceptance claim.

## Verification boundary

Host conflict and ledger tests cover raw-data preservation, dependent roots, aliases, duplicates, zero amounts, multiple conflicts, root collisions, cycles, order invariance, and recovery. Client tests cover HTTP validation/cache retention, defensive indexing, numeric/conflict/recovered transitions, localized display, statistics suppression, and legacy bridge cleanup. These checks do not replace testing the newly built package in the isolated desktop host or final human visual/interaction acceptance.
