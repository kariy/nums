# Nums cross-chain bridge — end-to-end integration test

Rust-based test harness that brings up a TWO-Katana topology (settlement +
appchain), forks Cartridge mainnet at the latest block for the settlement
layer (optional), and exercises the full settlement-side `Settler.settle`
loop:

  message hash injection → consume_message_from_appchain → vault.pay
                        → team.transfer → MaterializationResult message

The contracts under test live in `contracts/src/...` —
`settler.cairo`, `setup.cairo`, `components/bridge.cairo`,
`systems/materializer.cairo`, and `interfaces/messaging.cairo`. Three
small, test-driven additions to that contract code are documented in the
"Test-driven contract changes" section below.

## Branch status: `feat/katana-init-rollup`

This branch is **exploratory / WIP** — it is **not** merged to `main`. It
proves that the 160-bit `EthAddress` blocker (documented in v1's known
gap) is solvable by replacing `katana --dev` with a proper rollup chain
spec via `katana init rollup`.

What works on this branch:
- `katana init rollup` produces a chain spec with `is_l3 = true`, allowing
  `send_message_to_l1_syscall` to target a 251-bit Starknet address.
- The auto-deployed Piltover Appchain core contract is upgraded in-place
  to a class compiled with the `messaging_test` feature, preserving its
  `program_info`/`fact_registry` storage but adding the
  `add_messages_hashes_from_appchain` test backdoor.
- Both worlds (settlement + appchain) deploy via parallel `sozo migrate`.
- `Setup.issue → BridgeComponent.dispatch → send_message_to_l1_syscall`
  runs end-to-end; the harness extracts a real `message_id`, `nonce`, and
  the 11-felt `SettlementRequest` payload from the appchain.

Remaining unblock (TODO before this branch can land):
- `Settler.settle` reverts at `quote.transfer(team_address, team_amount)`
  with `ERC20: transfer to 0`, even though debug assertions confirm
  `team_address` is non-zero in the same frame. Suspected cause: an
  `IERC20MixinDispatcher` arg-serialization mismatch when called from
  inside the `if amount == 0` short-circuit branch, OR a Dojo macro
  side-effect on the Settler class. Needs a fresh pair of eyes — a
  `panic!` with raw felts at the call site is the next debugging step.

---

## Prerequisites

Run `bin/integration-test-setup` once before the first test run. It will:

1. Confirm `katana` is on `$PATH` (or at `~/.cargo/bin/katana`).
2. Confirm `sozo` is on `$PATH` (or at `~/Projects/dojoengine/dojo/target/
   release/sozo`).
3. Build the Piltover `messaging_mock` Cairo contract from
   `~/Projects/dojoengine/katana/crates/contracts/contracts/piltover` with
   `scarb build --features messaging_test`. The `messaging_test` Cairo
   feature flag enables the `add_messages_hashes_from_appchain` backdoor,
   which is the manual stand-in for `update_state()` in this harness.
4. Copy the resulting class JSON into `tests/e2e/artifacts/`.

`scarb` (`asdf` 2.13.1) is also required.

Override locations via env vars:

| Env var          | Default                                                    |
| ---------------- | ---------------------------------------------------------- |
| `KATANA_BIN`     | `katana` on `$PATH` then `~/.cargo/bin/katana`             |
| `SOZO_BIN`       | `sozo` on `$PATH` then `~/Projects/dojoengine/dojo/target/release/sozo` |
| `KATANA_REPO`    | `~/Projects/dojoengine/katana`                             |
| `DOJO_REPO`      | `~/Projects/dojoengine/dojo`                               |
| `RUST_LOG`       | `info,nums_e2e=info` (set to `debug` for more)             |
| `NUMS_E2E_NO_FORK` | (unset) — set to `1` to disable forking entirely         |

---

## Running

```sh
# Recommended: skip forking. ~5 minutes wall-clock.
NUMS_E2E_NO_FORK=1 bin/integration-test happy_path

# With forking. May fail intermittently due to Cartridge RPC rate limits
# during the high-volume sozo migrate phase.
bin/integration-test happy_path
```

Equivalent direct invocation:

```sh
NUMS_E2E_NO_FORK=1 cargo test --manifest-path tests/e2e/Cargo.toml --release -- --nocapture
```

The harness creates two ephemeral Katana data dirs under `$TMPDIR`. Both
processes are killed and their dirs removed on test exit (including panics)
via `Drop` impls on the `KatanaNode` wrapper.

---

## Architecture

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│  Settlement Katana              │         │  Appchain Katana                 │
│  port 5071  --dev               │         │  port 5072  --dev                │
│  (optionally forks mainnet)     │         │  chain id "NUMS_APPCHAIN"        │
│                                 │         │                                  │
│  Fresh Nums world (sozo)        │         │  Fresh Nums world (sozo)         │
│   - Settler                     │         │   - Setup, Play, Token,          │
│   - Vault, Token, Treasury      │         │     Vault, Faucet, Treasury,     │
│   - Faucet (mock USDC)          │         │     Collection                   │
│                                 │         │                                  │
│  messaging_mock (Piltover)      │ ───────▶│  Materializer (UDC)              │
│  with messaging_test feature    │   auto  │  --messaging polling picks up    │
│                                 │   poll  │  MessageSent and synthesizes an  │
│  Settler.settle path:           │         │  L1Handler tx targeting          │
│    consume_message_from_appchain│         │  Materializer.materialize        │
│    → vault.pay (PROVIDER_ROLE)  │         │                                  │
│    → quote.transfer to team     │         │                                  │
│    → send_message_to_appchain   │         │                                  │
│                                 │         │                                  │
│  Test injects message hashes    │         │                                  │
│  via add_messages_hashes_       │         │                                  │
│  from_appchain (the manual      │         │                                  │
│  Piltover update_state stand-in)│         │                                  │
└─────────────────────────────────┘         └──────────────────────────────────┘
```

Two directions, two delivery mechanisms:

- **Appchain → Settlement** — Manual (`add_messages_hashes_from_appchain`).
  Bypasses the SP1 / TEE-attestation requirement of real Piltover
  `update_state`.

- **Settlement → Appchain** — Automatic. Katana's built-in `--messaging`
  service polls `MessageSent` events on the messaging_mock and synthesizes
  an `L1HandlerTransaction` for the appchain.

---

## Test-driven contract changes

Three minimal additions were made to merged contract code to enable
end-to-end testing without rewriting the Dojo-imposed deployment-order
constraints. All are documented in source with `Test-driven` comments and
do not change production behavior. They are:

1. **`Settler.set_katana_setup` / `set_materializer` / `set_piltover_messaging`**
   — admin-gated setters mirroring the role pattern Vault.cairo uses.
   Required because Settler/Setup/Materializer have a 3-way circular
   dependency that can't be resolved at deploy time without pre-computed
   addresses (which would themselves require a substantial harness
   investment). Production deploys use the `dojo_init` args and never
   call these setters.

2. **`Settler.dojo_init` and `Setup.dojo_init` extra DEFAULT_ADMIN_ROLE
   grant to deployer** — mirrors `Vault.dojo_init`'s "Extra rights for test
   purpose" pattern. Production deploys are unaffected because the deployer
   is the Treasury-controlled account anyway.

3. **`Settler.settle` `burn_percentage == 0` short-circuit** — when the
   computed burn share is zero, Settler skips the Ekubo router/clearer
   round-trip entirely so the e2e harness doesn't need to seed NUMS/USDC
   liquidity into a forked Ekubo pool. Production keeps `burn_percentage > 0`
   and so this branch is dead code there.

4. **`Materializer.set_bridge_settler` / `set_setup`** — admin-gated
   setters for the plain Starknet contract (no AccessControl available).
   Stores the deployer in `admin` storage at construction. Same rationale
   as #1.

---

## Status

```
✅ Both Katana nodes start and stay healthy.
✅ Piltover messaging_mock deploys with messaging_test backdoor.
✅ Appchain Katana boots with --messaging pointed at messaging_mock.
✅ Drop cleanup kills both nodes and removes temp dirs (even on panic).

✅ Fresh Nums Dojo worlds migrated on both chains in parallel via sozo.
✅ Materializer UDC-deployed onto the appchain.
✅ Settler/Setup/Materializer cross-chain references wired via setters.
✅ Vault.PROVIDER_ROLE granted to Settler from a dev-owned admin account.
✅ Settler USDC reserve seeded from in-world Faucet (mock USDC).
✅ Vault seeded with NUMS shares so vault.pay's rewardable.pay doesn't
   trip 'Rewardable: vault is empty'.

✅ End-to-end Settler.settle runs and produces correct deltas:
     Settler reserve  ↓ price * quantity = 1.98 USDC
     Vault reward USDC ↑ vault_pct % of residual = 0.99 USDC
     Team USDC         ↑ (residual - vault_amount) = 0.99 USDC

✅ Wall-clock test time: ~4–5 minutes (no fork). Sozo migrate is the
   bottleneck — 109 txs at ~2s each per world.

✅ Message-hash formula round-trips with the Cairo implementation.
```

The "happy path" test is `happy_path_paid_bundle` and runs by default.

---

## Known limitations

### Appchain `Setup.issue` path is blocked on `--dev` Katanas

The "real" full flow would have the appchain run `Setup.issue(bundle_id=1)`
which in turn calls `BridgeComponent.dispatch` which calls
`send_message_to_l1_syscall(settler_addr, payload)`. Cairo's blockifier
validates that the recipient fits in `EthAddress` (160 bits) UNLESS the
chain is initialized with `is_l3 = true`. `is_l3` is only set when the
chain is `ChainSpec::Rollup` with `SettlementLayer::Starknet { .. }`,
which requires either `katana init rollup` (auto-deploys a Piltover
Appchain contract validated via `get_program_info` at startup) or a
hand-crafted rollup chain spec.

Substituting our `messaging_mock` (which has the test backdoor we need)
for the auto-deployed Piltover Appchain fails Katana's startup validation
because messaging_mock doesn't implement the full Appchain interface
(`get_program_info`, `get_facts_registry`).

The harness sidesteps this by injecting the SettlementRequest payload's
hash directly into messaging_mock and computing the payload off-chain,
exercising every part of the **settlement-side** bridge flow except the
appchain syscall. The full flow is preserved as
`happy_path_paid_bundle_via_setup_issue` (marked `#[ignore]`); resolving
this means either:

- Patching Katana to add a `--no-settlement-check` dev flag.
- Extending messaging_mock to implement the Appchain validation surface.
- Vendoring a hand-crafted rollup chain spec that points at messaging_mock.

All three are out of scope for the harness.

### Materialization assertion not exercised

After `Settler.settle` emits its reverse `MaterializationResult` message,
Katana's `--messaging` polling synthesises an `L1HandlerTransaction`
calling `Materializer.materialize`, which calls
`Setup.materialize_pending`. That path runs successfully end-to-end **if
a `PendingPurchase` row already exists** on the appchain. Our synthetic-
payload bypass doesn't create that row, so a `wait_for_materialization`
assertion would fail with "Already settled" or zero-recipient errors at
the `Play.create` step.

If the `is_l3=true` Katana mode becomes available, the Setup.issue path
will create the row naturally and the materialization assertion comes for
free.

### Forked-mainnet sozo migrate is intermittent

Running with forking (NUMS_E2E_NO_FORK unset) hits
`error sending request for url (http://127.0.0.1:5071/)` partway through
the settlement-world migration's "Deploy the world" step. The settlement
Katana doesn't crash (the appchain's parallel migrate completes fine), so
the failure mode appears to be the Cartridge mainnet RPC's storage-proof
window not keeping up with the high-volume declare-class load that sozo
runs. The mainnet contracts that the test reads are forked-state-isolated
(Faucet/Token/Vault are fresh, not forked), so forking adds no value for
this test scenario — defer fixing until a test relies on forked state.

---

## Debugging failures

- **Both Katanas fail to start:** check `$TMPDIR` isn't out of space.
- **`messaging_mock missing add_messages_hashes_from_appchain`:** rerun
  `bin/integration-test-setup`.
- **`error sending request for url`** during settlement migrate: see
  "Forked-mainnet sozo migrate is intermittent" above. Use
  `NUMS_E2E_NO_FORK=1`.
- **`Rewardable: vault is empty`:** `seed_vault_shares` is failing or
  was skipped — check the harness `start()` ordering.
- **`Out of range ...`** in `player_buy_bundle`: see the
  Setup.issue limitation above. Use `inject_synthetic_purchase` instead.

---

## File layout

```
tests/e2e/
├── Cargo.toml
├── README.md
├── artifacts/
│   ├── messaging_mock.contract_class.json         (gitignored, generated)
│   └── messaging_mock.compiled_contract_class.json
├── src/
│   ├── lib.rs                # public re-exports
│   ├── constants.rs          # ports, RPC URL, mainnet contract addresses
│   ├── katana.rs             # KatanaNode child-process wrapper + Drop
│   ├── messaging.rs          # messaging_mock declare/deploy + back-door call
│   ├── sozo.rs               # sozo binary resolution + sozo build/migrate + manifest parser
│   └── harness.rs            # TestEnv, PurchaseHandle, all scenario primitives
└── tests/
    └── happy_path.rs         # happy_path_paid_bundle (passes), the #[ignore]'d
                              # happy_path_paid_bundle_via_setup_issue, and the
                              # message_hash regression.

dojo_e2eappchain.toml         # appchain world profile, paired with [profile.e2eappchain] in Scarb.toml
dojo_e2esettlement.toml       # settlement world profile, paired with [profile.e2esettlement]
manifest_e2eappchain.json     # produced by `sozo migrate --profile e2eappchain` (gitignored)
manifest_e2esettlement.json   # ditto
```

The crate is intentionally NOT a member of `Scarb.toml`'s workspace; the
top-level workspace is Scarb / Cairo, not Cargo. `cargo test` resolves it
by manifest path.
