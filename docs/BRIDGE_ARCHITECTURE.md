# Nums Cross-Chain Bridge Architecture

Players play Nums on a Katana appchain so that turns are cheap and instant, but value capture (NUMS supply burn, USDC vault payouts, team treasury) lives on Starknet mainnet where the canonical NUMS token, the Ekubo NUMS/USDC pool, and the Vault all already exist. Each paid pack purchase therefore turns into a Piltover message round-trip: Katana parks the player's USDC and asks mainnet to do the economic work; mainnet executes the same swap+burn+vault.pay flow that the inline `purchase.execute` path uses, then sends a reverse Piltover message that unlocks the actual `Play.create(...)` call on Katana.

The four contracts that together implement this round-trip are:

- **Setup** (Katana) — receives the `issue` call, owns the `BridgeComponent`, persists `PendingPurchase` records, and is the only contract authorised to call `Play.create`.
- **Settler** (mainnet) — consumes the appchain message, sources USDC from its own reserve, replays the swap+burn+vault flow, and sends the reverse message.
- **Materializer** (Katana, plain Starknet contract) — owns the `#[l1_handler]` entry point and is the single authorised caller of `Setup.materialize_pending`.
- **BridgeComponent** (embedded in Setup) — does the actual `send_message_to_l1_syscall` and `PendingPurchase` bookkeeping.

The rest of this document walks the deployed topology, the happy-path call graph, and the divergent flows.

---

## 1. Component map

What this shows: every deployed contract and which contracts call which, grouped by chain. The Piltover "messaging plane" in the middle is the only allowed cross-chain edge — no contract on either side directly references an address on the other chain except through a Piltover send/consume call.

```mermaid
graph TB
  subgraph Katana["Katana appchain"]
    direction TB
    K_Player[Player EOA]
    K_Setup[Setup<br/>dojo::contract]
    K_Bridge[BridgeComponent<br/>embedded in Setup]
    K_Purchase[PurchaseComponent<br/>embedded in Setup]
    K_Bundle[BundleComponent<br/>embedded in Setup]
    K_Materializer[Materializer<br/>plain starknet::contract]
    K_Play[Play]
    K_Token[NUMS Token<br/>fresh appchain mint]
    K_Vault[Vault<br/>stub / unused]
    K_Faucet[Faucet<br/>USDC stand-in]
    K_USDCBridge[USDC holding contract<br/>config.usdc_bridge]
    K_Piltover[Piltover messaging<br/>config.bridge_messaging]
  end

  subgraph Bridge["Piltover messaging plane (cross-chain)"]
    P_AppToSn[(Appchain to SN<br/>SettlementRequest payload<br/>11 felts)]
    P_SnToApp[(SN to Appchain<br/>MaterializationResult payload<br/>7 felts<br/>selector!('materialize'))]
  end

  subgraph Mainnet["Starknet mainnet"]
    direction TB
    M_Settler[Settler<br/>dojo::contract]
    M_Setup[Setup<br/>existing, no bridge_settler]
    M_Purchase[PurchaseComponent<br/>existing inline path]
    M_Vault[Vault]
    M_Token[NUMS Token<br/>canonical]
    M_USDC[USDC]
    M_Treasury[Treasury<br/>ADMIN_ROLE holder]
    M_Ekubo[Ekubo Router + Clearer]
    M_Pool[Ekubo NUMS/USDC pool<br/>+ Positions extension]
    M_Team[Team address<br/>config.team_address]
    M_Piltover[Piltover messaging<br/>core contract]
  end

  K_Player -->|issue bundle_id, qty| K_Setup
  K_Setup --> K_Bundle
  K_Bundle -->|on_issue callback| K_Setup
  K_Setup -->|bundle.price 0 OR no bridge_settler| K_Purchase
  K_Setup -->|paid bundle and bridge_settler set| K_Bridge
  K_Bundle -->|transferFrom player| K_Faucet
  K_Bridge -->|transfer total_usdc| K_Faucet
  K_Faucet -->|park USDC| K_USDCBridge
  K_Bridge -->|send_message_to_l1_syscall| K_Piltover
  K_Bridge -->|set_pending_purchase| K_Setup

  K_Piltover --> P_AppToSn
  P_AppToSn --> M_Piltover

  M_Settler -->|consume_message_from_appchain| M_Piltover
  M_Settler -->|transfer burn_amount| M_USDC
  M_USDC -->|swap quote in| M_Ekubo
  M_Ekubo -->|clear_minimum NUMS| M_Settler
  M_Settler -->|burn| M_Token
  M_Settler -->|approve then pay| M_Vault
  M_Vault -->|transferFrom| M_USDC
  M_Settler -->|transfer remainder| M_Team
  M_Treasury -->|deposit_reserve / withdraw_reserve / setters| M_Settler
  M_Settler -->|send_message_to_appchain<br/>selector!('materialize')| M_Piltover

  M_Piltover --> P_SnToApp
  P_SnToApp --> K_Piltover
  K_Piltover -->|l1_handler tx| K_Materializer
  K_Materializer -->|materialize_pending| K_Setup
  K_Setup -->|create| K_Play

  M_Setup -.purchase.execute inline.- M_Purchase
  M_Purchase -.swap+burn+pay synchronously.- M_Ekubo
```

Notes on the diagram:

- **`K_Vault`** is drawn dashed-lightly because the appchain Vault is intentionally unused for paid bundles — value moves through the mainnet Vault instead.
- **Treasury** holds `ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` on the mainnet Settler (granted in `Settler.dojo_init` lines 209-213). The deployer account is also granted these roles for test-driven post-deploy setters.
- The appchain `usdc_bridge` is just a holding address; in production it is the same canonical USDC bridge; in tests it is a separate stand-in. The bridge does **not** atomically settle USDC across chains — settlement of the actual stablecoin is out of scope of this contract bundle and assumed to happen via the existing Cartridge USDC bridge.

---

## 2. Happy-path purchase to game-ready

What this shows: every contract call from the moment a player calls `Setup.issue(bundle_id, qty, ...)` on Katana to the moment `Play.create` runs and the player can play. Selectors are inlined where they aid traceability. Three coloured stages: **appchain reservation** (synchronous in the player's tx), **mainnet settlement** (later, driven by a keeper), **appchain materialization** (later still, driven by Katana's L1Handler dispatcher).

```mermaid
sequenceDiagram
    autonumber
    actor Player as Player EOA (Katana)
    participant K_Setup as Setup (Katana)
    participant K_Bundle as BundleComponent
    participant K_Faucet as Faucet (USDC stand-in)
    participant K_USDCBridge as USDC holding
    participant K_Bridge as BridgeComponent
    participant K_Piltover as Piltover (Katana)
    participant K_Store as Dojo Store (Katana)
    participant Sequencer as Katana sequencer / saya-tee
    participant M_Piltover as Piltover (mainnet)
    participant Keeper as Keeper EOA (mainnet)
    participant M_Settler as Settler (mainnet)
    participant M_Store as Dojo Store (mainnet)
    participant M_USDC as USDC (mainnet)
    participant M_Ekubo as Ekubo Router/Clearer
    participant M_NUMS as NUMS Token (mainnet)
    participant M_Vault as Vault (mainnet)
    participant M_Team as Team address
    participant Dispatcher as Katana L1Handler dispatcher
    participant K_Materializer as Materializer (Katana)
    participant K_Play as Play (Katana)

    rect rgb(232, 244, 255)
      Note over Player,K_Store: STAGE 1 - Appchain reservation (one synchronous tx)

      Player->>K_Setup: issue(recipient, bundle_id, qty, ...)
      K_Setup->>K_Bundle: bundle.issue(...)
      K_Bundle->>K_Faucet: transferFrom(player, Setup, total_usdc)
      K_Bundle->>K_Setup: BundleImpl::on_issue(recipient, bundle_id, qty)
      K_Setup->>K_Store: store.bundle(bundle_id) and store.config()
      Note over K_Setup: branch: bundle.price != 0<br/>AND config.bridge_settler != 0<br/>=> bridge path

      K_Setup->>K_Bridge: bridge.dispatch(world, recipient, bundle_id, qty)
      K_Bridge->>K_Bridge: assert usdc_bridge != 0 and != self
      K_Bridge->>K_Faucet: transfer(usdc_bridge, total_usdc)
      K_Faucet->>K_USDCBridge: balance += total_usdc
      K_Bridge->>K_Store: next_bridge_nonce() -> nonce
      Note over K_Bridge: build 11-felt SettlementRequest payload<br/>[nonce, recipient, qty,<br/> price.lo, price.hi,<br/> base_price.lo, base_price.hi,<br/> burn_pct, vault_pct,<br/> target_supply.lo, target_supply.hi]
      K_Bridge->>K_Piltover: send_message_to_l1_syscall(<br/>  bridge_settler, payload)
      Note over K_Bridge: locally compute message_id =<br/>poseidon(from, to, len, payload...)<br/>(matches piltover<br/>compute_message_hash_appc_to_sn)
      K_Bridge->>K_Store: set_pending_purchase{<br/>message_id, nonce, recipient,<br/>bundle_id, qty, price,<br/>status: Pending}
      K_Bridge-->>K_Setup: emit PurchaseInitiated(message_id, nonce, ...)
      K_Setup-->>Player: tx returns - NO game created yet
    end

    Note over Sequencer,M_Piltover: ASYNC: Katana state-root commit (~minutes)<br/>Production: saya-tee posts root to Piltover<br/>Tests: messaging_mock.add_messages_hashes_from_appchain
    Sequencer->>M_Piltover: state root + outgoing messages

    rect rgb(255, 244, 224)
      Note over Keeper,M_Team: STAGE 2 - Mainnet settlement (anyone can drive)

      Keeper->>M_Settler: settle(payload: Span<felt252>)
      M_Settler->>M_Settler: decode_settlement_payload(payload)<br/>(asserts len == 11)
      M_Settler->>M_Piltover: consume_message_from_appchain(<br/>  katana_setup, payload)<br/>(reverts if no match)
      M_Piltover-->>M_Settler: message_id (canonical hash)
      M_Settler->>M_Store: store.config() (avg_score, slot_count, team_address)
      M_Settler->>M_NUMS: total_supply()
      M_Settler->>M_USDC: balance_of(this) -> reserve_balance_pre

      Note over M_Settler: amount = qty * pack_mult * base_price<br/>          * burn_pct / 100<br/>(plan-mirror of purchase.cairo:131-136)<br/>plus assertions amount <= total_usdc<br/>and reserve_balance_pre >= total_usdc

      M_Settler->>M_USDC: transfer(EkuboRouter, amount)<br/>(selector!("transfer"))
      M_Settler->>M_Ekubo: router.swap(route_node, token_amount)
      M_Settler->>M_Ekubo: clearer.clear_minimum(NUMS, 0)
      M_Ekubo-->>M_Settler: NUMS proceeds
      M_Settler->>M_Ekubo: clearer.clear(USDC)
      M_Ekubo-->>M_Settler: USDC residual
      M_Settler->>M_NUMS: balance_of(this) -> burn_amount
      M_Settler->>M_NUMS: burn(burn_amount)<br/>(selector!("burn"))

      Note over M_Settler: working_residual = current_balance<br/>  - reserve_balance_pre + total_usdc<br/>(scopes payouts to this settlement<br/>not the whole reserve)
      M_Settler->>M_USDC: approve(Vault, vault_amount)
      M_Settler->>M_Vault: pay(player_id, vault_amount)<br/>(requires PROVIDER_ROLE)
      M_Vault->>M_USDC: transfer_from(Settler, Vault, vault_amount)
      M_Settler->>M_USDC: transfer(team_address, team_amount)<br/>(working_residual - vault_amount)

      M_Settler->>M_Settler: multiplier = Rewarder::multiplier(<br/>  supply_per_game, target_supply,<br/>  burn_per_game, avg_num, avg_den,<br/>  slot_count)
      Note over M_Settler: send_materialization(<br/>  message_id, multiplier,<br/>  supply, price, qty)
      M_Settler->>M_Piltover: send_message_to_appchain(<br/>  materializer,<br/>  selector!("materialize"),<br/>  [message_id, multiplier,<br/>   supply.lo, supply.hi,<br/>   price.lo, price.hi, qty])
      M_Settler-->>Keeper: emit Settled(message_id, recipient, qty, ...)
    end

    Note over M_Piltover,Dispatcher: ASYNC: Piltover delivers SN->Appchain message<br/>Katana sequencer creates an L1Handler tx
    M_Piltover->>Dispatcher: deliver(materializer, materialize, payload)

    rect rgb(232, 255, 232)
      Note over Dispatcher,K_Play: STAGE 3 - Appchain materialization

      Dispatcher->>K_Materializer: l1_handler materialize(<br/>  from_address,<br/>  message_id, multiplier,<br/>  supply_lo, supply_hi,<br/>  price_lo, price_hi, qty)
      K_Materializer->>K_Materializer: assert from_address ==<br/>self.bridge_settler
      K_Materializer->>K_Setup: materialize_pending(<br/>  message_id, multiplier,<br/>  supply, price, qty)
      K_Setup->>K_Setup: assert caller == config.materializer
      K_Setup->>K_Store: pending = pending_purchase(message_id)
      K_Setup->>K_Setup: assert pending.status == Pending
      K_Setup->>K_Store: pending.status = Settled<br/>set_pending_purchase
      K_Setup->>K_Store: purchase_settled(message_id,<br/>  multiplier, price)
      K_Setup->>K_Play: create(pending.recipient,<br/>  multiplier, supply, price, qty)
      K_Play-->>Player: games are now playable
    end
```

Key things to notice:

- The player's transaction (Stage 1) **commits no economic state on mainnet**; it only parks USDC on the appchain and writes a `PendingPurchase` row. If mainnet never executes Stage 2, the appchain admin can use `admin_settle` (see Section 3) to refund the player with games minted at fallback multiplier.
- `consume_message_from_appchain` (step 24) is the replay/forgery gate. The Settler does not trust `payload` until Piltover has matched it against an unconsumed appchain message.
- The appchain `BridgeComponent` re-derives `message_id` locally with the same poseidon formula Piltover uses, so `Settled.message_id` (mainnet event) and `PendingPurchase.message_id` (appchain row) are guaranteed to match without coordination.

---

## 3. Alternate paths

### 3a. Free bundle on Katana (no bridge)

What this shows: when `bundle.price == 0`, `BundleImpl::on_issue` short-circuits to the inline `purchase.execute` path even on the appchain. No Piltover round-trip, games created in the same transaction.

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant K_Setup as Setup (Katana)
    participant K_Bundle as BundleComponent
    participant K_Purchase as PurchaseComponent
    participant K_Store as Dojo Store
    participant K_Play as Play

    Player->>K_Setup: issue(recipient, free_bundle_id, qty, ...)
    K_Setup->>K_Bundle: bundle.issue(...)
    K_Bundle->>K_Setup: BundleImpl::on_issue(recipient, bundle_id, qty)
    K_Setup->>K_Store: bundle.price == 0 -> inline branch
    K_Setup->>K_Purchase: purchase.execute(world, recipient, bundle_id, qty)
    K_Purchase-->>K_Setup: (recipient, MULTIPLIER_PRECISION,<br/>nums_supply, 0, qty)
    K_Setup->>K_Play: create(recipient, MULTIPLIER_PRECISION,<br/>supply, 0, qty)
    K_Play-->>Player: games playable (synchronously)
```

The same path is taken on mainnet for **any** bundle when `config.bridge_settler == 0` — see Section 3c.

### 3b. Admin escape hatch: `Setup.admin_settle`

What this shows: when the mainnet Settler is permanently broken (or the keeper never runs), an admin can mark a `PendingPurchase` as `Cancelled` on the appchain and mint fallback games at `MULTIPLIER_PRECISION`. The mainnet message remains consumable; if it ever later settles, the reverse Materialization message will revert at the `status == Pending` check.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Admin (ADMIN_ROLE)
    participant K_Setup as Setup (Katana)
    participant K_Store as Dojo Store
    participant K_Play as Play
    participant M_Piltover as Piltover (mainnet)
    participant M_Settler as Settler (mainnet)

    Admin->>K_Setup: admin_settle(message_id)
    K_Setup->>K_Setup: assert ADMIN_ROLE
    K_Setup->>K_Store: pending = pending_purchase(message_id)
    K_Setup->>K_Setup: assert pending.status == Pending
    K_Setup->>K_Store: pending.status = Cancelled<br/>set_pending_purchase
    K_Setup->>K_Store: purchase_cancelled(message_id, MULTIPLIER_PRECISION)
    K_Setup->>K_Play: create(recipient,<br/>  MULTIPLIER_PRECISION,<br/>  config.target_supply,<br/>  pending.price, pending.quantity)
    Note over K_Setup: Piltover cancellation is intentionally NOT called<br/>(only works for SN->Appchain; bridge uses Appchain->SN)<br/>Dual-spend protection comes from the Cancelled<br/>status check inside materialize_pending

    Note over M_Settler: Later (optional): keeper still runs settle(...)
    M_Settler->>M_Piltover: consume_message_from_appchain(...)<br/>SUCCEEDS (message was never consumed)
    M_Settler->>M_Piltover: send_message_to_appchain(<br/>  materializer, materialize, ...)
    Note over M_Piltover: Eventually delivered to Materializer,<br/>which calls Setup.materialize_pending,<br/>which REVERTS on assert pending.status == Pending<br/>=> player keeps the fallback games, mainnet<br/>economic side-effects (burn / vault / team transfer)<br/>still happen against the Settler reserve
```

### 3c. Mainnet inline path (no bridge)

What this shows: on mainnet, `config.bridge_settler == 0`, so `BundleImpl::on_issue` always takes the inline branch — exactly the same behaviour as today. Single transaction, no Piltover.

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant M_Setup as Setup (mainnet)
    participant M_Bundle as BundleComponent
    participant M_USDC as USDC
    participant M_Purchase as PurchaseComponent
    participant M_Ekubo as Ekubo Router/Clearer
    participant M_NUMS as NUMS Token
    participant M_Vault as Vault
    participant M_Team as Team
    participant M_Play as Play

    Player->>M_Setup: issue(recipient, bundle_id, qty, ...)
    M_Setup->>M_Bundle: bundle.issue(...)
    M_Bundle->>M_USDC: transferFrom(player, Setup, total_usdc)
    M_Bundle->>M_Setup: on_issue(recipient, bundle_id, qty)
    Note over M_Setup: config.bridge_settler == 0 -> inline branch
    M_Setup->>M_Purchase: purchase.execute(...)
    M_Purchase->>M_USDC: transfer(EkuboRouter, burn_amount)
    M_Purchase->>M_Ekubo: swap + clear_minimum NUMS + clear USDC
    M_Purchase->>M_NUMS: burn(balance_of(this))
    M_Purchase->>M_USDC: approve(Vault, vault_amount)
    M_Purchase->>M_Vault: pay(player_id, vault_amount)
    M_Vault->>M_USDC: transfer_from(Setup, Vault, vault_amount)
    M_Purchase->>M_USDC: transfer(team_address, remainder)
    M_Purchase-->>M_Setup: (recipient, multiplier, supply, price, qty)
    M_Setup->>M_Play: create(recipient, multiplier, supply, price, qty)
    M_Play-->>Player: games playable (synchronously)
```

---

## 4. Cross-chain invariants

| # | Invariant | Source |
|---|-----------|--------|
| 1 | `message_id` correlates request and response. Computed locally by `BridgeComponent` as `poseidon_hash_span(from, to, len, payload...)`, matching `piltover::messaging::hash::compute_message_hash_appc_to_sn`. The same hash is returned by `consume_message_from_appchain` on mainnet and echoed back as the first felt of the Materialization payload. | `bridge.cairo:91-105`, `settler.cairo:251-252`, `materializer.cairo:48-71` |
| 2 | Per-Setup monotonic `nonce` ensures payload uniqueness — two identical purchases by different players produce different message hashes (otherwise Piltover's ref-count would collapse them). | `store.cairo:149-157` (`next_bridge_nonce`), used at `bridge.cairo:70-74` |
| 3 | `PendingStatus` transitions: `Pending -> Settled` (via `Materializer -> Setup.materialize_pending`) or `Pending -> Cancelled` (via `Setup.admin_settle`). No other transitions exist, so a `PendingPurchase` is consumed exactly once. | `setup.cairo:548-580` and `setup.cairo:582-620` |
| 4 | Replay protection has three independent layers: (a) Piltover ref-count on the consumed message; (b) per-sender Piltover nonce in the SN->Appchain direction blocking duplicate Materialization deliveries; (c) `assert pending.status == Pending` inside `materialize_pending`. Any one layer suffices. | `bridge.cairo:91-94`, `materializer.cairo:48-71`, `setup.cairo:567` |
| 5 | Settler decouples economic args from local `Bundle` table symmetry: `price`, `base_price`, `burn_pct`, `vault_pct`, `target_supply` all come from the **payload**, while only stable per-config knobs (`avg_score`, `slot_count`, `team_address`, Ekubo pool params, `quote` address) come from mainnet `Config`. This means the appchain can register new bundle IDs without a coordinated mainnet config update. | `settler.cairo:79-93` (decoder), `settler.cairo:228-490` (settle) |
| 6 | `usdc_bridge` sentinel guards: `BridgeComponent.dispatch` reverts if `usdc_bridge == 0` or `usdc_bridge == self`, so a misconfigured Setup cannot silently drain USDC into itself. | `bridge.cairo:55-60` |
| 7 | `from_address` check in the L1 handler: `Materializer.materialize` reverts if `from_address != self.bridge_settler`, so mainnet messages from any other contract cannot trigger `Play.create`. | `materializer.cairo:62-65` |
| 8 | Settler uses a **working budget** of `total_usdc = price * qty` reserved against its long-lived reserve, then computes `working_residual = current_balance - reserve_balance_pre + total_usdc` so vault.pay and team.transfer only consume that envelope. This is the moral equivalent of `purchase.cairo:171-193`'s "balance after clear" but scoped per-settlement. | `settler.cairo:366-450` |
| 9 | Settler has two short-circuits that bypass the Ekubo path: `price == 0` (free bundle that somehow took the bridge route) and `amount == 0` (zero burn percentage, used in the e2e test harness). Both still send the reverse Materialization message. | `settler.cairo:264-291`, `settler.cairo:311-364` |
| 10 | After deploy, the operator must grant the Settler `Vault.PROVIDER_ROLE` and `Token.burn` authorisation on mainnet — these are external prerequisites not enforced by the Settler itself. | `settler.cairo:17-20` (header doc) |

---

## 5. Cross-chain config matrix and the "transfer to 0" trap

Per invariant #5, Settler reads economic values from the **payload**, not from its own mainnet `Config`. This means appchain-side config values *propagate* to mainnet behaviour through the SettlementRequest payload. Most cross-chain bugs come from a mismatch between what the appchain puts in the payload and what the mainnet side can support.

### Which fields flow through the payload (appchain → Settler)

| Payload field | Source on appchain | What Settler does with it |
|---|---|---|
| `nonce` | `BridgeNonce` (per-Setup counter) | Hash-uniqueness only — not economic |
| `recipient` | `Setup.issue` arg | `recipient_felt` for `vault.pay(player_id, ...)` |
| `quantity` | `Setup.issue` arg | `total_usdc = price × quantity` |
| `price` | `bundle.price` (registered on appchain) | `total_usdc`, `pack_multiplier` |
| `base_price` | appchain `config.base_price` (= `entry_price` in dojo_init) | `pack_multiplier = price / base_price + 1` |
| `burn_percentage` | appchain `config.burn_percentage` | **Branch decision**: `amount = qty × pack_mult × base_price × burn_pct / 100`; `amount == 0` → short-circuit, `> 0` → Ekubo swap |
| `vault_percentage` | appchain `config.vault_percentage` | Splits residual: `vault_amount = working_residual × vault_pct / 100` |
| `target_supply` | appchain `config.target_supply` | `Rewarder::multiplier(...)` |

### Which fields Settler reads from its OWN (mainnet) Config

| mainnet Config field | What it controls |
|---|---|
| `quote` | The USDC contract address Settler `transfer`s to |
| `team_address` | Where residual USDC goes after burn + vault.pay |
| `ekubo_router` / `pool_*` | Used **only** when `burn_percentage > 0` |
| `ekubo_positions` | Used by Treasury.collect_fees, not Settler |
| `average_score` / `average_weigth` / `slot_count` | Multiplier formula (slow-moving, fine to read locally) |

### The branch invariant (where the bug lurks)

`Settler.settle` decides between two paths based on the **payload's** `burn_percentage`:

| Branch | Condition | What it calls |
|---|---|---|
| **burn==0 short-circuit** | `amount == 0` (i.e. `burn_pct == 0`) | `vault.pay` + `quote.transfer(team_address, ...)` only |
| **Normal Ekubo path** | `amount > 0` | `quote.transfer(ekubo_router, ...)` → `Router.swap` → `Clearer.clear_*` → `Token.burn` → `vault.pay` → `quote.transfer(team_address, ...)` |

**The Ekubo path requires the mainnet Config's `ekubo_router` to be a real contract.** If the appchain payload says `burn_pct = 70%` and the mainnet `ekubo_router == 0x0`, Settler enters the Ekubo branch and the very first call in it is `quote.transfer(0x0, amount)` — which the Faucet/USDC's ERC-20 component reverts with `ERC20: transfer to 0`.

The recipient that's "0" is the **Ekubo router**, not the team. This is counterintuitive because `transfer to 0` reads like "the team_address is missing".

### Case study: the May 2026 e2e bug

The full-flow e2e test on `feat/katana-init-rollup` failed with `ERC20: transfer to 0` inside `Settler.settle`. Three iterations of debug:

1. **Hypothesis 1** (wrong): `team_address` is somehow zero in Settler's frame. Added `assert(team_address.is_non_zero())` right before the team transfer in the burn==0 branch. Test reran and produced the same revert reason — but the assert *didn't fire*, meaning team_address was fine.

2. **Hypothesis 2** (wrong): `IERC20MixinDispatcher.transfer` has a calldata-serialization quirk for contract-to-contract calls. Wrote `contracts/src/tests/test_transfer_isolation.cairo` to validate the dispatcher in isolation (both EOA→Faucet and contract→Faucet via the dispatcher). Both tests passed. Dispatcher ruled out.

3. **Hypothesis 3** (correct): the team transfer was *never reached*. Replaced the assert with a `panic!()` that always fires with raw values. Test reran — the panic also didn't fire. That meant Settler wasn't even entering the burn==0 branch. With `burn_percentage` coming from the payload (= appchain config = 70%), Settler went through the normal Ekubo branch and reverted at the very first `quote.transfer(ekubo_router, ...)` because the settlement-side `ekubo_router == 0x0`.

The bug was a **two-config mismatch**: appchain `dojo_e2eappchain.template.toml` had `burn_percentage = 70%` (production-shaped), but settlement `dojo_e2esettlement.toml` had `ekubo_router = 0x0` (no Ekubo deployed in this test). Fixed by setting both to `burn_percentage = 0` so the payload propagates 0 and Settler takes the short-circuit.

### Diagnostic playbook for any future "settle reverts" bug

When `Settler.settle` reverts and you don't know where:

1. **Don't trust the revert reason at face value.** "ERC20: transfer to 0" can mean any one of: team transfer, Ekubo router transfer, or a vault.pay-internal `transferFrom`. The selector tells you `transfer` vs `transfer_from` but not *which* `transfer` site.
2. **Confirm which branch is taken.** Add a `panic!('BRANCH burn_zero')` or `panic!('BRANCH ekubo')` at the top of each branch in `Settler.settle`. Run once. The unfired panic identifies the live branch.
3. **Dump the payload values Settler actually decoded.** Add a `panic!('PAYLOAD nonce={} burn_pct={} ...', ...)` right after `decode_settlement_payload`. Compare against what `BridgeComponent.dispatch` claims it sent.
4. **Run `contracts/src/tests/test_transfer_isolation.cairo`.** ~10 seconds. Rules out dispatcher / ERC20 component issues independent of the bridge.
5. **Read the mainnet Config out of the world.** Verify `ekubo_router`, `team_address`, `quote`, `vault_percentage` etc. all match what `dojo_*.toml` says. Don't assume sozo migrate ran the values you intended.

### Production deploy checklist (cross-chain config consistency)

When changing any payload-propagated field on the appchain:

- [ ] `burn_percentage` on appchain — does mainnet have `ekubo_router`, `pool_extension`, `pool_fee`, `pool_tick_spacing`, `pool_sqrt` all set to a valid Ekubo deployment with NUMS/USDC liquidity?
- [ ] `vault_percentage` on appchain — does mainnet `Vault` have non-zero `total_supply` (i.e. someone has deposited)? Otherwise `RewardableComponent::pay` reverts with `Rewardable: vault is empty`.
- [ ] `target_supply` on appchain — does this match mainnet's actual NUMS supply growth path? A wildly-off `target_supply` distorts `Rewarder::multiplier`.
- [ ] `base_price` and `bundle.price` — must be consistent between the two worlds, otherwise pack_multiplier math drifts and burn amounts go wrong.
- [ ] After any change, run the e2e harness end-to-end at least once before promoting.

---

## 6. File pointers

- Mainnet Settler: `contracts/src/systems/settler.cairo`
- Appchain Setup: `contracts/src/systems/setup.cairo`
- BridgeComponent: `contracts/src/components/bridge.cairo`
- PurchaseComponent (inline path): `contracts/src/components/purchase.cairo`
- Materializer (l1_handler): `contracts/src/systems/materializer.cairo`
- Vault.pay: `contracts/src/systems/vault.cairo:287-301`
- NUMS burn: `contracts/src/systems/token.cairo:125-128`
- Piltover IMessaging: `contracts/src/interfaces/messaging.cairo`
- Models (Config, PendingPurchase, BridgeNonce, PendingStatus): `contracts/src/models/index.cairo`
- Store accessors: `contracts/src/store.cairo:131-213`
- Constants (`MATERIALIZE_SELECTOR`, `MULTIPLIER_PRECISION`): `contracts/src/constants.cairo:70-74`
- Mainnet init args: `dojo_mainnet.toml`
- Appchain init args: `dojo_katana.toml`
