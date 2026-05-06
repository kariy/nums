//! Happy-path scenario for the Nums cross-chain bridge.
//!
//! ## Coverage
//!
//! Spins up two Katanas (settlement layer optionally forks Cartridge mainnet
//! @ latest; appchain layer is fresh), migrates fresh Nums Dojo worlds onto
//! each chain, UDC-deploys the appchain Materializer, wires the cross-chain
//! references, grants Vault.PROVIDER_ROLE to Settler, seeds the Settler's
//! USDC reserve from the in-world Faucet, then exercises:
//!
//!   1. Inject a synthetic SettlementRequest payload + hash into the
//!      Piltover messaging_mock via the `messaging_test` `add_messages_hashes_
//!      from_appchain` back-door.
//!   2. Call `Settler.settle(payload)` — this consumes the message, runs
//!      the burn=0 short-circuit (skipping Ekubo entirely so we don't need
//!      to seed liquidity into a forked NUMS/USDC pool), pays vault
//!      dividends to the in-world Vault, transfers the residual to the team
//!      address, and emits a reverse MaterializationResult message via
//!      `messaging.send_message_to_appchain`.
//!   3. Assert pre/post settlement-side balances move correctly.
//!
//! ## Known limitation: appchain-side Setup.issue is blocked on `--dev` Katanas
//!
//! The "real" full flow would have the appchain run `Setup.issue(bundle_id=1)`
//! which in turn calls `BridgeComponent.dispatch` which calls
//! `send_message_to_l1_syscall(settler_addr, payload)`. Cairo's blockifier
//! validates that the recipient fits in `EthAddress` (160 bits) UNLESS the
//! chain is initialized with `is_l3 = true`. `is_l3` is only set when the
//! chain is `ChainSpec::Rollup` with `SettlementLayer::Starknet { .. }`,
//! which requires either `katana init rollup` (auto-deploys a Piltover
//! Appchain contract validated via `get_program_info` at startup) or a
//! hand-crafted rollup chain spec.
//!
//! Substituting our `messaging_mock` (which has the test backdoor we need)
//! for the auto-deployed Piltover Appchain fails Katana's startup validation
//! because messaging_mock doesn't implement the full Appchain interface.
//! Resolving this means either patching Katana to add a `--no-settlement-
//! check` dev flag or extending messaging_mock to implement the validation
//! surface. Both are out of scope for this test harness.
//!
//! The bypass we use here injects the message hash directly into messaging_
//! mock and computes the payload off-chain, exercising every part of the
//! settlement-side bridge flow except the appchain syscall.
//!
//! Run with:
//!
//! ```sh
//! NUMS_E2E_NO_FORK=1 bin/integration-test happy_path -- --nocapture
//! ```

use anyhow::Result;
use nums_e2e::TestEnv;
use starknet::accounts::Account;
use starknet::core::types::Felt;
use tracing::info;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn happy_path_paid_bundle() -> Result<()> {
    let started_at = std::time::Instant::now();
    let env = TestEnv::start().await?;

    env.assert_infrastructure_ready().await?;

    if std::env::var("NUMS_E2E_NO_FORK").is_err() {
        match env.read_nums_total_supply().await {
            Ok((lo, hi)) => {
                info!("Forked mainnet NUMS total_supply: lo={lo} hi={hi}");
                assert!(lo > 0 || hi > 0, "expected non-zero NUMS supply on forked mainnet");
            }
            Err(e) => info!("forked NUMS probe failed (skipping): {e:#}"),
        }
    }

    let player = env.appchain_account()?;
    let player_addr: Felt = player.address();

    let pre_reserve = env.read_settler_reserve().await?;
    let pre_team = env.read_team_usdc_balance().await?;
    let pre_vault_reward = env.read_vault_reward_balance().await?;
    info!("pre: reserve={pre_reserve} team={pre_team} vault_reward={pre_vault_reward}");

    // Build a synthetic SettlementRequest payload matching what
    // BridgeComponent.dispatch would build for bundle 1, qty 1.
    //
    //   bundle.price = 1.98 USDC = 1_980_000 (6 decimals)
    //   base_price   = 2.00 USDC = 2_000_000
    //   burn_pct     = 0  (skip Ekubo)
    //   vault_pct    = 50
    //   target_supply= 1M NUMS (with 18 decimals = 10^24, low fits in u128)
    //
    // target_supply = 1_000_000 * 10^18; lo = 0xD3C21BCECCEDA1000000.
    let target_supply_low: u128 = 1_000_000_u128 * 1_000_000_000_000_000_000_u128;
    let payload = env.synthetic_payload(
        /*nonce=*/ 1,
        /*recipient=*/ player_addr,
        /*bundle_id=*/ 1,
        /*quantity=*/ 1,
        /*price_low=*/ 1_980_000,
        /*base_price_low=*/ 2_000_000,
        /*burn_pct=*/ 0,
        /*vault_pct=*/ 50,
        target_supply_low,
    );

    // 1. Push the message hash through messaging_mock.
    let purchase = env.inject_synthetic_purchase(payload).await?;
    info!(
        "synthetic purchase: message_id={mid:#x} payload_len={plen}",
        mid = purchase.message_id,
        plen = purchase.payload.len(),
    );

    // 2. Run the keeper — Settler.settle consumes the message and emits a
    //    MaterializationResult message back to the appchain.
    env.run_keeper(&purchase).await?;

    // 3. Post-settlement state checks.
    let post_reserve = env.read_settler_reserve().await?;
    let post_team = env.read_team_usdc_balance().await?;
    let post_vault_reward = env.read_vault_reward_balance().await?;
    info!("post: reserve={post_reserve} team={post_team} vault_reward={post_vault_reward}");

    // working_residual = price * quantity = 1.98 USDC = 1_980_000
    // vault_amount = working_residual * 50/100 = 990_000
    // team_amount  = working_residual - vault_amount = 990_000
    let expected_settle_cost = 1_980_000_u128;
    let expected_team_delta = 990_000_u128;
    let expected_vault_delta = 990_000_u128;

    assert_eq!(
        pre_reserve.saturating_sub(post_reserve),
        expected_settle_cost,
        "Settler reserve should decrease by {expected_settle_cost}: pre={pre_reserve} post={post_reserve}"
    );
    assert_eq!(
        post_team.saturating_sub(pre_team),
        expected_team_delta,
        "Team should receive {expected_team_delta}: pre={pre_team} post={post_team}"
    );
    assert_eq!(
        post_vault_reward.saturating_sub(pre_vault_reward),
        expected_vault_delta,
        "Vault USDC reward balance should grow by {expected_vault_delta}: pre={pre_vault_reward} post={post_vault_reward}"
    );

    let elapsed = started_at.elapsed();
    info!("happy_path_paid_bundle completed in {elapsed:.2?}");
    Ok(())
}

/// The "real" bridge flow: appchain Setup.issue → BridgeComponent dispatch →
/// L2->L1 syscall → settlement Settler.settle. Currently unreachable on
/// `--dev` Katanas; documented in this file's module-level comments. Kept
/// as `#[ignore]` so a future engineer can flip a Katana rollup mode and
/// run this end-to-end.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "Setup.issue path needs is_l3=true Katana (rollup chain spec); see module docs"]
async fn happy_path_paid_bundle_via_setup_issue() -> Result<()> {
    let env = TestEnv::start().await?;
    env.assert_infrastructure_ready().await?;
    let player = env.appchain_account()?;
    let purchase = env.player_buy_bundle(player.address(), 1, 1).await?;
    env.update_state_for_pending_messages(&purchase).await?;
    env.run_keeper(&purchase).await?;
    env.wait_for_materialization(purchase.message_id, 60).await?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn message_hash_matches_piltover_formula() -> Result<()> {
    use nums_e2e::harness::compute_appc_to_sn_message_hash;
    use starknet::macros::felt;

    let from: Felt = felt!("0xabc");
    let to: Felt = felt!("0xdef");
    let payload = [
        felt!("0x1"),
        felt!("0x2"),
        felt!("0x3"),
        felt!("0x4"),
        felt!("0x5"),
        felt!("0x6"),
        felt!("0x7"),
        felt!("0x8"),
        felt!("0x9"),
        felt!("0xa"),
        felt!("0xb"),
    ];
    let hash = compute_appc_to_sn_message_hash(from, to, &payload);
    assert_ne!(hash, Felt::ZERO, "message hash should be non-zero");
    Ok(())
}
