# Nums Cross-Chain Bridge — Test Coverage & Verification Gaps

Companion to `BRIDGE_ARCHITECTURE.md`. That doc describes how the bridge
*works*. This doc tracks what's actually been *verified* end-to-end vs
what's still bypassed, stubbed, or unimplemented. Update when coverage
changes.

Last updated: post-merge of `feat/katana-init-rollup` into `main`.

---

## TL;DR

The e2e harness exercises **~60-70%** of the production-meaningful
surface area of the bridge. The remaining gap is concentrated in:

1. The Ekubo swap-and-burn path (`burn_percentage > 0`)
2. Real forked-mainnet state (currently runs against fresh `sozo migrate`)
3. The `play.create` outcome (we observe `PurchaseSettled` but don't query the `Game` model)
4. Failure-recovery paths (admin_settle, replay, spoofed sender, reserve-empty)

The current state is "bridge plumbing demonstrably works end-to-end" — not
"bridge is production-ready."

---

## What's verified end-to-end

The `happy_path_paid_bundle_via_setup_issue` test exercises every step
below in a single ~10-minute run against a two-Katana topology
(`katana init rollup` chain spec on the appchain).

| # | Production step | Verified by |
|---|---|---|
| 1 | Player calls `Setup.issue(bundle_id, qty)` on appchain | direct invocation |
| 2 | `bundle.transferFrom(player, Setup, total_usdc)` pulls USDC | implicit (Setup.issue succeeds) |
| 3 | `BundleImpl::on_issue` branches: paid + `bridge_settler != 0` → BridgeComponent | implicit |
| 4 | `BridgeComponent.dispatch` runs sentinel checks | implicit (asserts pass) |
| 5 | `quote.transfer(usdc_bridge, total_usdc)` parks USDC | implicit |
| 6 | `next_bridge_nonce()` increments | implicit |
| 7 | `send_message_to_l1_syscall(Settler, payload)` succeeds | log: `MessageSent` event observed by polling service |
| 8 | `PendingPurchase{status: Pending}` written to Dojo store | implicit (later flips to Settled) |
| 9 | Test injects message hash via `messaging_test.add_messages_hashes_from_appchain` | replaces real saya-tee proof commit |
| 10 | `Settler.settle(payload)` consumes Piltover message | log: `Settler.settle ok` |
| 11 | `decode_settlement_payload` extracts all 11 fields | implicit (settle succeeds) |
| 12 | `vault.pay(player_id, vault_amount)` real `transferFrom` | `happy_path_paid_bundle` asserts +0.99 USDC |
| 13 | `quote.transfer(team_address, team_amount)` | `happy_path_paid_bundle` asserts +0.99 USDC |
| 14 | `send_message_to_appchain(Materializer, MATERIALIZE_SELECTOR, ...)` | log: outbound `MessageSent` |
| 15 | Katana auto-poll picks up `MessageSent` from settlement | log: `Converting event into L1HandlerTx` |
| 16 | L1Handler tx targets Materializer at the right selector | log: `L1Handler transaction added to the pool` |
| 17 | L1Handler tx executes successfully | receipt: `SUCCEEDED`, 4 events |
| 18 | `Materializer.materialize` asserts `from_address == bridge_settler` | implicit (didn't revert) |
| 19 | `Setup.materialize_pending` auth check (`caller == config.materializer`) passes | implicit |
| 20 | `PendingPurchase.status` flips `Pending → Settled` | implicit (only path that fires `PurchaseSettled`) |
| 21 | `play.create(...)` runs | implicit (no revert in L1Handler tx) |
| 22 | `PurchaseSettled` Dojo event emitted | observed by `purchase_was_settled` |

---

## What's tested with significant caveats vs production

### Caveat A: Settlement layer is NOT real mainnet (yet)

Default test mode is `NUMS_E2E_NO_FORK=1`. The settlement layer runs
fresh `Vault`, `Token` (NUMS), `Treasury`, `Faucet` (USDC stand-in)
deployed via `sozo migrate`, not forked Cartridge mainnet state.
Forking exists in `katana.rs` and was empirically intermittent during
the high-volume sozo migrate phase.

**What this means is NOT exercised:**
- Real Cartridge USDC isn't touched
- Real mainnet NUMS supply (~1.26M) isn't moved
- Real Vault depositors and `total_assets` aren't affected
- Real Treasury timelock flow isn't validated against
- Real Ekubo NUMS/USDC pool isn't queried

### Caveat B: Ekubo swap-and-burn path is NOT exercised

The e2e config sets `burn_percentage = 0` to take Settler's
test-driven short-circuit. So in production-shaped runs (`burn_pct = 70%`),
Settler would call:

```
quote.transfer(ekubo_router, burn_amount)
Router.swap(...)
Clearer.clear_minimum(NUMS, 0)
Clearer.clear(USDC)
nums.burn(balance_of(this))
```

**None of this runs in the e2e.** Five contract calls — the entire
deflationary mechanism — are untested at integration level. They are
exercised only in unit tests against mocked dispatchers.

### Caveat C: Piltover proof commitment is bypassed

Real production goes:
```
appchain state root → saya-tee SP1 proof → Piltover.update_state(...)
                                          with TEE attestation
```

The e2e replaces this with `messaging_test.add_messages_hashes_from_appchain(hashes)`
— a Piltover dev-feature back-door provided by the Piltover crate
specifically for testing.

**What's NOT exercised:**
- saya-tee daemon
- SP1 proof generation/verification
- Piltover's `program_info` / `fact_registry` validation
- AMD TEE registry attestation

What IS the same as production: everything past Piltover (Settler.settle
and onward).

### Caveat D: Test-driven contract additions are load-bearing in the test

These exist in compiled bytecode on both mainnet and the test build:
- `Settler.set_katana_setup`, `set_materializer`, `set_piltover_messaging` admin setters
- Deployer-grants in `Settler.dojo_init` and `Setup.dojo_init` (mirrors `Vault`'s "Extra rights for test purpose" pattern)
- `Settler.settle` `burn==0` short-circuit branch (~50 lines)
- `Materializer.set_bridge_settler`, `set_setup` setters

In production they are dead code (init args fill addresses correctly,
`burn_pct > 0`). In the test they are load-bearing. **The test does not
validate that the production-only paths work.**

---

## What's NOT tested at all (or only in unit tests)

| Scenario | E2E | Unit (`scarb test`) |
|---|---|---|
| `admin_settle` escape hatch | ❌ | ✅ `test_bridge.cairo` |
| Replay attack on `materialize` (same `message_id` twice) | ❌ | ✅ |
| `Materializer` from_address spoofing → revert | ❌ | ✅ |
| Hash collision regression (different players, identical bundle/qty) | ❌ | ✅ |
| Settler reserve insufficient → settle reverts cleanly | ❌ | ❌ |
| Multiple consecutive purchases by same player | ❌ | ✅ (nonce monotonicity) |
| Free bundle on Katana (`bundle.price == 0`) bypasses bridge | ❌ | ✅ |
| Merkledrop on Katana (free claim path) | ❌ | implicit |
| `wait_for_materialization` failure / timeout recovery | ❌ | N/A |
| Game model queryable on appchain after materialization | ❌ | N/A |
| Player can `Play.action()` against materialized game | ❌ | ✅ separate Play tests |
| `pack_multiplier` distortion across bundles with mismatched `base_price` | ❌ | ❌ |
| Concurrent purchases (race conditions) | ❌ | ❌ |

---

## Coverage by production-flow component

| Component | Approx coverage | Notes |
|---|---|---|
| Appchain `Setup.issue` → `BridgeComponent` → syscall | ~90% | Real Cairo blockifier, real Dojo macro behavior |
| Piltover proof commitment (saya-tee/SP1/TEE) | 0% | Bypassed via `messaging_test` flag |
| `Settler.settle`: payload decode, Piltover consume | ~95% | |
| `Settler.settle`: Ekubo swap + NUMS burn | 0% | Short-circuited |
| `Settler.settle`: vault.pay | ~95% | Against fresh Vault, not forked |
| `Settler.settle`: team transfer | ~95% | Against fresh Faucet, not real USDC |
| `Settler.settle`: reverse Piltover dispatch | ~95% | |
| Katana auto-polling + L1Handler synthesis | ~100% | Real Katana behavior, no mocking |
| Materializer L1Handler execution | ~80% | Happy path; spoofed-sender revert is unit-only |
| `Setup.materialize_pending` → `play.create` | ~80% | Happy path; replay/cancelled paths are unit-only |
| Game becomes playable | 0% | Not tested |

**Overall production-flow coverage: ~60-70%.**

---

## Closing the gaps — prioritized roadmap

In order of value-for-effort:

### #1 — Exercise the Ekubo swap-and-burn path

**Why it matters:** This is the actual deflationary mechanism. The whole
economic premise of the bridge is "USDC paid by appchain players burns
canonical NUMS via the mainnet pool." Without testing it, we don't know
that mechanism actually closes.

**Two implementations:**
- **Elegant** (depends on #2): use canonical mainnet NUMS at its real
  address + existing Ekubo NUMS/USDC pool. `katana_setStorageAt` gives
  the test account a NUMS balance. Fast, low new code.
- **Brute-force** (independent): deploy fresh Ekubo
  Core/Router/Clearer/Positions on a non-forked settlement Katana,
  seed a NUMS/USDC pool ourselves. ~3-4x more work; tick-math seeding
  is fiddly.

**Effort:** Elegant ~1 day after #2 lands. Brute-force ~3-4 days.

### #2 — Make forked-mainnet mode reliable

**Why it matters:** Validates against real Vault/USDC/Treasury state
and unlocks the elegant path for #1. Currently `NUMS_E2E_NO_FORK=1` is
the only working default because Cartridge mainnet RPC is intermittent
during high-volume `sozo migrate`.

**Approach:** retry logic in sozo migrate wrapper, or a different RPC
provider, or batched declare strategy.

**Effort:** ~1 day. Independent of all other items.

### #3 — Read `Game` model after materialization

**Why it matters:** Right now we observe `PurchaseSettled` but don't
verify the `Game` row was actually written with the right `multiplier`,
`supply`, `price`, `quantity`. A regression in `play.create` (or in
`Setup.materialize_pending`'s argument forwarding) would silently pass.

**Approach:** add `read_game(game_id)` to `harness.rs` using Dojo's
`get_models` JSON-RPC method or a direct storage read. Add post-materialization
asserts to `happy_path_paid_bundle_via_setup_issue`.

**Effort:** ~half a day. Independent.

### #4 — Add e2e replay/spoofing/cancellation scenarios

**Why it matters:** Failure paths are where bridges actually break in
production. Unit tests cover them in isolation but don't validate the
full Piltover round-trip behavior of (e.g.) a stuck `PendingPurchase`
that's later cancelled while a real Settler.settle race is in flight.

**Scenarios to add:**
- `admin_settle` then `Settler.settle` arrives later → reverse Materializer
  reverts harmlessly because `status != Pending`
- Replay: re-inject same `message_id` → fails on Piltover ref-count
- Spoofed sender on appchain → `Materializer.materialize` reverts
- Settler reserve insufficient → settle reverts; reserve top-up + retry succeeds

**Effort:** ~1-1.5 days. Independent of others (unless any scenario
wants the Ekubo path, in which case depends on #1).

---

## Parallelization

```
#2 Forking ───────────┐
                      └──→ #1 Ekubo (elegant path)
#3 Game model read ───→  (independent)
#4 Failure paths   ───→  (independent)
```

**Recommended sequencing** — three parallel lanes in round 1, then #1
sequentially:

```
Round 1 (3 parallel agents, ~1 day):
  Lane A: #2 forking reliability
  Lane B: #3 Game model read + assertions
  Lane C: #4 replay/spoofing/cancellation scenarios

Merge order: B → C → A (smallest to largest harness.rs surface)

Round 2 (~1 day):
  #1 elegant — uses canonical mainnet NUMS + existing Ekubo pool
```

Total: ~2 days to ship. Sequential alternative would be ~4-5 days.

**File conflict matrix** (for parallel-merge planning):

| File | #1 | #2 | #3 | #4 |
|---|---|---|---|---|
| `tests/e2e/src/katana.rs` | — | ✅ heavy | — | — |
| `tests/e2e/src/harness.rs` | ✅ heavy (Ekubo helpers) | minor | ✅ new query helpers | ✅ new injection helpers |
| `tests/e2e/tests/happy_path.rs` | maybe new test | — | additional asserts | ✅ new test fns |
| `dojo_e2esettlement.toml` | ✅ real Ekubo addresses | — | — | — |
| `dojo_e2eappchain.template.toml` | ✅ `burn_pct=70` | — | — | — |

The `harness.rs` overlap across #1, #3, #4 is the main conflict surface.
Each lane should add **new functions** rather than modify existing ones
to keep merges clean.

---

## When to consider this report stale

Update or supersede when:
- Coverage of any item in the gap table changes
- A new bridge feature is added (admin_settle improvements, multi-bundle
  flows, alt USDC, etc.) — add a row to "What's verified" or a row to
  "What's NOT tested"
- saya-tee or a real Piltover commit path becomes available — Caveat C
  collapses
- The four follow-up items land — sections shrink accordingly

The TL;DR percentage (currently ~60-70%) is the easiest invariant to
keep current.
