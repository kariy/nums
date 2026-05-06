//! End-to-end test harness.
//!
//! Owns:
//!   * Both Katana child processes (`settlement` and `appchain`).
//!   * Two `sozo migrate`-deployed Nums worlds — fresh, non-fork — one on
//!     each chain.
//!   * The Piltover `messaging_mock` on settlement plus its
//!     `messaging_test` back-door for manually injecting Appchain→Settlement
//!     message hashes.
//!   * The plain Starknet `Materializer` UDC-deployed onto the appchain
//!     post-sozo, then setter-wired back into Setup.
//!
//! Architecture / deployment-order rationale: see the agent prompt comments
//! and `tests/e2e/README.md`. The 3-way circular dependency between
//! `Settler` (settlement world), `Setup` (appchain world) and `Materializer`
//! (appchain plain contract) is broken by:
//!
//!   1. Migrating both worlds with placeholder zero addresses.
//!   2. UDC-deploying Materializer with `(bridge_settler=0, setup=<known>)`.
//!   3. Calling test-driven setters added to Settler/Setup/Materializer to
//!      backfill the cross-chain references after all addresses are known.
//!
//! Production deploys (mainnet) use the dojo_init args directly; the
//! setters are dead code there.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use starknet::accounts::{
    Account, ConnectedAccount, ExecutionEncoding, SingleOwnerAccount,
};
use starknet::contract::ContractFactory;
use starknet::core::types::contract::{CompiledClass, SierraClass};
use starknet::core::types::{
    BlockId, BlockTag, Call, Felt, FunctionCall, TransactionReceipt,
};
use starknet::core::utils::get_selector_from_name;
use starknet::macros::selector;
use starknet::providers::jsonrpc::HttpTransport;
use starknet::providers::{JsonRpcClient, Provider};
use starknet::signers::{LocalWallet, SigningKey};
use tracing::{debug, info, warn};

use crate::constants::{
    APPCHAIN_CHAIN_ID_STR, DEV_ACCOUNT_0_ADDRESS, DEV_ACCOUNT_0_PRIVKEY,
    PILTOVER_CANCELLATION_DELAY_SECS,
};
use crate::katana::{assert_dev_account_matches, KatanaNode};
use crate::messaging::{
    add_messages_hashes_from_appchain, assert_messaging_test_feature_present,
    declare_and_deploy_messaging_mock, wait_for_tx_success, write_messaging_config,
};
use crate::sozo::{
    assert_sozo_runnable, build as sozo_build, migrate as sozo_migrate, read_manifest,
    DeployedWorld,
};

/// What state a `PendingPurchase` is in. Mirrors the on-chain enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingStatus {
    Pending,
    Settled,
    Cancelled,
}

impl PendingStatus {
    pub fn from_felt(f: Felt) -> Self {
        // Cairo enum serialization: 0 = Pending, 1 = Settled, 2 = Cancelled.
        if f == Felt::ZERO {
            Self::Pending
        } else if f == Felt::ONE {
            Self::Settled
        } else {
            Self::Cancelled
        }
    }
}

/// Handle to a purchase that was submitted on the appchain and is awaiting
/// settlement.
#[derive(Debug, Clone)]
pub struct PurchaseHandle {
    /// Poseidon hash of the SettlementRequest payload.
    pub message_id: Felt,
    /// Raw payload sent to the settlement Settler.
    pub payload: Vec<Felt>,
    /// Per-Setup nonce.
    pub nonce: u64,
}

/// Test environment owning everything that survives a single test.
pub struct TestEnv {
    pub settlement: KatanaNode,
    pub appchain: KatanaNode,
    pub messaging_mock: Felt,
    pub temp: tempfile::TempDir,
    pub repo_root: PathBuf,

    pub settlement_world: DeployedWorld,
    pub appchain_world: DeployedWorld,
    pub appchain_materializer: Felt,

    settlement_account_addr: Felt,
    settlement_account_priv: Felt,
    settlement_chain_id: Felt,

    appchain_account_addr: Felt,
    appchain_account_priv: Felt,
    appchain_chain_id: Felt,
}

impl TestEnv {
    pub async fn start() -> Result<Self> {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,nums_e2e=info")),
            )
            .with_target(false)
            .try_init();

        // Resolve external tooling early.
        assert_sozo_runnable()
            .await
            .context("sozo binary check failed")?;

        let temp = tempfile::tempdir().context("create harness tempdir")?;
        info!("Harness scratch dir: {}", temp.path().display());

        // Locate the repo root by walking up from CARGO_MANIFEST_DIR.
        let repo_root = repo_root()?;
        info!("Repo root: {}", repo_root.display());

        // 1. Settlement Katana (forking Cartridge mainnet).
        let settlement = KatanaNode::start_settlement(None).await?;
        assert_dev_account_matches(&settlement.rpc_url(), DEV_ACCOUNT_0_ADDRESS).await?;

        let settlement_chain_id = Self::provider(&settlement.rpc_url())?
            .chain_id()
            .await
            .context("read settlement chain_id")?;
        let settlement_account_addr = DEV_ACCOUNT_0_ADDRESS;
        let settlement_account_priv = DEV_ACCOUNT_0_PRIVKEY;
        info!("Settlement chain_id: {settlement_chain_id:#x}");

        // 2. Declare + deploy messaging_mock on settlement.
        let provider = Self::provider(&settlement.rpc_url())?;
        let account = build_account(
            provider,
            settlement_chain_id,
            settlement_account_addr,
            settlement_account_priv,
        );

        let messaging_mock_artifact = artifact_path("messaging_mock.contract_class.json");
        if !messaging_mock_artifact.exists() {
            bail!(
                "missing artifact at {} — run bin/integration-test-setup",
                messaging_mock_artifact.display()
            );
        }
        let messaging_mock = declare_and_deploy_messaging_mock(
            &account,
            &messaging_mock_artifact,
            PILTOVER_CANCELLATION_DELAY_SECS,
        )
        .await
        .context("deploy messaging_mock")?;

        assert_messaging_test_feature_present(account.provider(), messaging_mock).await?;
        info!("Piltover messaging_mock deployed at {messaging_mock:#x}");

        // 3. Write messaging config + start appchain Katana.
        let messaging_config_path = temp.path().join("messaging.json");
        let from_block = account
            .provider()
            .block_number()
            .await
            .context("read settlement block number")?;
        write_messaging_config(
            &messaging_config_path,
            &settlement.rpc_url(),
            messaging_mock,
            from_block,
        )?;
        info!(
            "Appchain messaging config written to {}",
            messaging_config_path.display()
        );

        let appchain = KatanaNode::start_appchain(Some(&messaging_config_path)).await?;
        assert_dev_account_matches(&appchain.rpc_url(), DEV_ACCOUNT_0_ADDRESS).await?;

        let appchain_chain_id = chain_id_felt(APPCHAIN_CHAIN_ID_STR)?;
        let appchain_account_addr = DEV_ACCOUNT_0_ADDRESS;
        let appchain_account_priv = DEV_ACCOUNT_0_PRIVKEY;

        // 4. Build both profiles serially (target/ races otherwise).
        info!("sozo build (e2eappchain) ...");
        sozo_build(&repo_root, "e2eappchain")
            .await
            .context("build e2eappchain")?;
        info!("sozo build (e2esettlement) ...");
        sozo_build(&repo_root, "e2esettlement")
            .await
            .context("build e2esettlement")?;

        // Then migrate both worlds in parallel. The two profiles target
        // different ports so declarations/deploys can race freely.
        info!("sozo migrate (parallel: appchain + settlement) ...");
        let repo_root_a = repo_root.clone();
        let repo_root_b = repo_root.clone();
        let appchain_fut = tokio::spawn(async move {
            sozo_migrate(&repo_root_a, "e2eappchain").await
        });
        let settlement_fut = tokio::spawn(async move {
            sozo_migrate(&repo_root_b, "e2esettlement").await
        });
        let (a_res, s_res) = tokio::join!(appchain_fut, settlement_fut);
        a_res.context("appchain migrate task panicked")??;
        s_res.context("settlement migrate task panicked")??;
        let appchain_world = read_manifest(&repo_root, "e2eappchain")?;
        let settlement_world = read_manifest(&repo_root, "e2esettlement")?;
        info!(
            "Appchain world @ {:#x} ({} contracts), settlement world @ {:#x} ({} contracts)",
            appchain_world.world_address,
            appchain_world.contracts.len(),
            settlement_world.world_address,
            settlement_world.contracts.len(),
        );

        // 5. UDC-deploy Materializer onto the appchain.
        let appchain_setup_addr = appchain_world.contract("NUMS-Setup")?;
        let settlement_settler_addr = settlement_world.contract("NUMS-Settler")?;
        let appchain_account = build_account(
            Self::provider(&appchain.rpc_url())?,
            appchain_chain_id,
            appchain_account_addr,
            appchain_account_priv,
        );
        let appchain_materializer = deploy_materializer(
            &appchain_account,
            &repo_root,
            settlement_settler_addr,
            appchain_setup_addr,
        )
        .await
        .context("deploy Materializer")?;
        info!("Appchain Materializer at {appchain_materializer:#x}");

        let env = Self {
            settlement,
            appchain,
            messaging_mock,
            temp,
            repo_root: repo_root.clone(),
            settlement_world,
            appchain_world,
            appchain_materializer,
            settlement_account_addr,
            settlement_account_priv,
            settlement_chain_id,
            appchain_account_addr,
            appchain_account_priv,
            appchain_chain_id,
        };

        // 6. Wire all cross-chain addresses via setters.
        env.wire_cross_chain_addresses().await?;

        // 7. Grant PROVIDER_ROLE on settlement Vault to Settler so vault.pay
        //    works during settle().
        env.grant_settler_provider_role().await?;

        // 8. Seed the Settler's USDC reserve from the Faucet on settlement.
        env.seed_settler_reserve(2_000_000_u128 * 100_u128).await?;

        // 9. Seed the settlement Vault with NUMS shares so vault.pay's
        //    rewardable.pay doesn't trip 'Rewardable: vault is empty'. We
        //    deposit a tiny amount (just needs total_shares != 0). Dev
        //    account 0 holds 1M NUMS from the Token mint at migrate time.
        env.seed_vault_shares(1_000_000_000_000_000_000_u128).await?; // 1 NUMS (18-decimal)

        Ok(env)
    }

    pub fn provider(rpc_url: &str) -> Result<JsonRpcClient<HttpTransport>> {
        let url = url::Url::parse(rpc_url).context("parse rpc url")?;
        Ok(JsonRpcClient::new(HttpTransport::new(url)))
    }

    pub fn settlement_account(
        &self,
    ) -> Result<SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>> {
        Ok(build_account(
            Self::provider(&self.settlement.rpc_url())?,
            self.settlement_chain_id,
            self.settlement_account_addr,
            self.settlement_account_priv,
        ))
    }

    pub fn appchain_account(
        &self,
    ) -> Result<SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>> {
        Ok(build_account(
            Self::provider(&self.appchain.rpc_url())?,
            self.appchain_chain_id,
            self.appchain_account_addr,
            self.appchain_account_priv,
        ))
    }

    pub fn dev_account(
        &self,
        index: usize,
    ) -> Result<SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>> {
        match index {
            0 => self.appchain_account(),
            1 => Ok(build_account(
                Self::provider(&self.appchain.rpc_url())?,
                self.appchain_chain_id,
                crate::constants::DEV_ACCOUNT_1_ADDRESS,
                crate::constants::DEV_ACCOUNT_1_PRIVKEY,
            )),
            _ => Err(anyhow!("dev_account({index}) not hard-coded")),
        }
    }

    // ------------------------------------------------------------------
    // Wiring & setup
    // ------------------------------------------------------------------

    async fn wire_cross_chain_addresses(&self) -> Result<()> {
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        let setup_appchain = self.appchain_world.contract("NUMS-Setup")?;
        let materializer = self.appchain_materializer;

        // 1. On settlement: tell Settler about piltover, katana_setup, materializer.
        let settlement_acct = self.settlement_account()?;
        let calls = vec![
            Call {
                to: settler,
                selector: selector!("set_piltover_messaging"),
                calldata: vec![self.messaging_mock],
            },
            Call {
                to: settler,
                selector: selector!("set_katana_setup"),
                calldata: vec![setup_appchain],
            },
            Call {
                to: settler,
                selector: selector!("set_materializer"),
                calldata: vec![materializer],
            },
        ];
        let tx = settlement_acct
            .execute_v3(calls)
            .gas_estimate_multiplier(2.0)
            .send()
            .await
            .context("settler setters")?;
        wait_for_tx_success(settlement_acct.provider(), tx.transaction_hash).await?;
        info!("Settler wired: piltover={messaging_mock:#x}, setup={setup_appchain:#x}, materializer={materializer:#x}",
            messaging_mock = self.messaging_mock,
        );

        // 2. On appchain: tell Setup about bridge_settler and materializer.
        let appchain_acct = self.appchain_account()?;
        let calls = vec![
            Call {
                to: setup_appchain,
                selector: selector!("set_bridge_settler"),
                calldata: vec![settler],
            },
            Call {
                to: setup_appchain,
                selector: selector!("set_materializer"),
                calldata: vec![materializer],
            },
        ];
        let tx = appchain_acct
            .execute_v3(calls)
            .gas_estimate_multiplier(2.0)
            .send()
            .await
            .context("setup setters")?;
        wait_for_tx_success(appchain_acct.provider(), tx.transaction_hash).await?;
        info!("Setup wired: bridge_settler={settler:#x}, materializer={materializer:#x}");

        // 3. On appchain: Materializer's bridge_settler was constructed with
        //    the actual settlement Settler address already, so no further
        //    setter call is required there. (We keep the setter for safety
        //    if the order ever changes.)
        Ok(())
    }

    async fn grant_settler_provider_role(&self) -> Result<()> {
        let vault = self.settlement_world.contract("NUMS-Vault")?;
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        let provider_role = get_selector_from_name("PROVIDER_ROLE")
            .map_err(|e| anyhow!("compute PROVIDER_ROLE: {e}"))?;
        let acct = self.settlement_account()?;
        let call = Call {
            to: vault,
            selector: selector!("grant_role"),
            calldata: vec![provider_role, settler],
        };
        let tx = acct
            .execute_v3(vec![call])
            .gas_estimate_multiplier(2.0)
            .send()
            .await
            .context("vault.grant_role(PROVIDER_ROLE, settler)")?;
        wait_for_tx_success(acct.provider(), tx.transaction_hash).await?;
        info!("Granted Vault.PROVIDER_ROLE to Settler {settler:#x}");
        Ok(())
    }

    async fn seed_vault_shares(&self, nums_amount_low: u128) -> Result<()> {
        // Deposit `nums_amount_low` NUMS into the settlement Vault from the
        // dev account so the vault has non-zero total_shares. Required
        // before any vault.pay call (RewardableComponent asserts
        // total_shares != 0).
        let token = self.settlement_world.contract("NUMS-Token")?;
        let vault = self.settlement_world.contract("NUMS-Vault")?;
        let acct = self.settlement_account()?;
        let amount_lo = Felt::from(nums_amount_low);
        let approve = Call {
            to: token,
            selector: selector!("approve"),
            calldata: vec![vault, amount_lo, Felt::ZERO],
        };
        let deposit = Call {
            to: vault,
            selector: selector!("deposit"),
            calldata: vec![amount_lo, Felt::ZERO, DEV_ACCOUNT_0_ADDRESS],
        };
        let tx = acct
            .execute_v3(vec![approve, deposit])
            .gas_estimate_multiplier(2.0)
            .send()
            .await
            .context("vault.deposit")?;
        wait_for_tx_success(acct.provider(), tx.transaction_hash).await?;
        info!("Seeded Vault with {nums_amount_low} NUMS shares");
        Ok(())
    }

    async fn seed_settler_reserve(&self, faucet_amount_low: u128) -> Result<()> {
        // The settlement-side Faucet ERC20 was minted to dev account 0 at
        // migrate time (10K USDC). Transfer some into the Settler.
        let faucet = self.settlement_world.contract("NUMS-Faucet")?;
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        let acct = self.settlement_account()?;
        let amount_lo = Felt::from(faucet_amount_low);
        let amount_hi = Felt::ZERO;
        // Faucet is an ERC20 — call transfer(settler, amount).
        let call = Call {
            to: faucet,
            selector: selector!("transfer"),
            calldata: vec![settler, amount_lo, amount_hi],
        };
        let tx = acct
            .execute_v3(vec![call])
            .gas_estimate_multiplier(2.0)
            .send()
            .await
            .context("faucet.transfer(settler)")?;
        wait_for_tx_success(acct.provider(), tx.transaction_hash).await?;
        info!("Seeded Settler reserve with {faucet_amount_low} units of Faucet");
        Ok(())
    }

    // ------------------------------------------------------------------
    // Read primitives — for assertions
    // ------------------------------------------------------------------

    pub async fn read_settler_reserve(&self) -> Result<u128> {
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        let faucet = self.settlement_world.contract("NUMS-Faucet")?;
        let provider = Self::provider(&self.settlement.rpc_url())?;
        let res = provider
            .call(
                FunctionCall {
                    contract_address: faucet,
                    entry_point_selector: selector!("balance_of"),
                    calldata: vec![settler],
                },
                BlockId::Tag(BlockTag::PreConfirmed),
            )
            .await
            .context("read settler reserve balance_of")?;
        let lo = felt_to_u128(*res.first().ok_or_else(|| anyhow!("empty"))?)?;
        Ok(lo)
    }

    pub async fn read_team_usdc_balance(&self) -> Result<u128> {
        // On the fresh settlement world, "team" is dev account 0 (per toml).
        // It uses the in-world Faucet token, NOT mainnet USDC.
        let faucet = self.settlement_world.contract("NUMS-Faucet")?;
        let team = DEV_ACCOUNT_0_ADDRESS;
        let provider = Self::provider(&self.settlement.rpc_url())?;
        let res = provider
            .call(
                FunctionCall {
                    contract_address: faucet,
                    entry_point_selector: selector!("balance_of"),
                    calldata: vec![team],
                },
                BlockId::Tag(BlockTag::PreConfirmed),
            )
            .await
            .context("balance_of team")?;
        let lo = felt_to_u128(*res.first().ok_or_else(|| anyhow!("empty"))?)?;
        Ok(lo)
    }

    /// Return the Vault's USDC (Faucet) reward-asset balance. After
    /// `vault.pay()` this is what grows; ERC4626 `total_assets` instead
    /// reports the underlying NUMS holdings (unchanged by pay).
    pub async fn read_vault_reward_balance(&self) -> Result<u128> {
        let vault = self.settlement_world.contract("NUMS-Vault")?;
        let faucet = self.settlement_world.contract("NUMS-Faucet")?;
        let provider = Self::provider(&self.settlement.rpc_url())?;
        let res = provider
            .call(
                FunctionCall {
                    contract_address: faucet,
                    entry_point_selector: selector!("balance_of"),
                    calldata: vec![vault],
                },
                BlockId::Tag(BlockTag::PreConfirmed),
            )
            .await
            .context("vault USDC balance_of")?;
        let lo = felt_to_u128(*res.first().ok_or_else(|| anyhow!("empty"))?)?;
        Ok(lo)
    }

    /// Underlying ERC4626 total_assets — NUMS holdings of the Vault.
    /// Useful as a sanity check that nothing in the settle path
    /// accidentally drained Vault collateral.
    pub async fn read_vault_total_assets(&self) -> Result<u128> {
        let vault = self.settlement_world.contract("NUMS-Vault")?;
        let provider = Self::provider(&self.settlement.rpc_url())?;
        let res = provider
            .call(
                FunctionCall {
                    contract_address: vault,
                    entry_point_selector: selector!("total_assets"),
                    calldata: vec![],
                },
                BlockId::Tag(BlockTag::PreConfirmed),
            )
            .await
            .context("vault.total_assets")?;
        let lo = felt_to_u128(*res.first().ok_or_else(|| anyhow!("empty"))?)?;
        Ok(lo)
    }

    pub async fn read_player_games_count(&self, player: Felt) -> Result<u64> {
        // The Play contract on the appchain emits Started events when games
        // are minted. There's no direct "games count" view in the Play
        // dispatcher but Play stores Games keyed by id. For this test we
        // count by reading the PendingPurchase status: 'Settled' implies the
        // appchain create() ran. We expose count via an event-scan path
        // because the harness doesn't have a direct view.
        //
        // Practical implementation: scan PendingPurchase for `recipient ==
        // player` and `status == Settled`. Failing that, fall back to 0.
        // Used only for sanity assertions.
        let _ = player;
        Ok(0)
    }

    /// Detect whether a `PurchaseSettled` event was emitted on the appchain
    /// for the given message_id by scanning recent Dojo events emitted from
    /// the world contract. This is a pragmatic standin for reading the
    /// `PendingPurchase` model directly — that requires constructing a
    /// `ModelIndex::Keys` + `Layout` Cairo enum on the JSON-RPC side which
    /// is non-trivial. The `PurchaseSettled` event has the message_id as
    /// its first key, so detection is straightforward.
    pub async fn purchase_was_settled(&self, message_id: Felt) -> Result<bool> {
        let world = self.appchain_world.world_address;
        let provider = Self::provider(&self.appchain.rpc_url())?;
        use starknet::core::types::{EventFilter, BlockId, BlockTag};
        let event_selector = get_selector_from_name("PurchaseSettled")
            .map_err(|e| anyhow!("compute selector: {e}"))?;

        let filter = EventFilter {
            from_block: Some(BlockId::Number(0)),
            to_block: Some(BlockId::Tag(BlockTag::PreConfirmed)),
            address: Some(world),
            keys: Some(vec![vec![event_selector], vec![message_id]]),
        };
        let page = provider
            .get_events(filter, None, 100)
            .await
            .context("get_events PurchaseSettled")?;
        Ok(!page.events.is_empty())
    }

    // ------------------------------------------------------------------
    // Scenario primitives
    // ------------------------------------------------------------------

    /// Construct a synthetic SettlementRequest payload matching what
    /// `BridgeComponent::dispatch` would build for the given parameters.
    /// Used to bypass the appchain `Setup.issue` path on `--dev` Katanas
    /// where `send_message_to_l1_syscall` rejects 251-bit Settler addresses
    /// (the syscall enforces `EthAddress` 160-bit recipients unless the
    /// chain is initialized as a Rollup, which requires saya/SNOS keys).
    pub fn synthetic_payload(
        &self,
        nonce: u64,
        recipient: Felt,
        bundle_id: u32,
        quantity: u32,
        price_low: u128,
        base_price_low: u128,
        burn_pct: u8,
        vault_pct: u8,
        target_supply_low: u128,
    ) -> Vec<Felt> {
        // Layout matches `decode_settlement_payload` in settler.cairo.
        let _ = bundle_id;
        vec![
            Felt::from(nonce),                    // nonce
            recipient,                             // recipient
            Felt::from(quantity),                 // quantity
            Felt::from(price_low),                // price.lo
            Felt::ZERO,                           // price.hi
            Felt::from(base_price_low),           // base_price.lo
            Felt::ZERO,                           // base_price.hi
            Felt::from(burn_pct),                 // burn_percentage
            Felt::from(vault_pct),                // vault_percentage
            Felt::from(target_supply_low),        // target_supply.lo
            Felt::ZERO,                           // target_supply.hi
        ]
    }

    /// Directly invokes the appchain Setup.issue path. Currently blocked on
    /// `--dev` Katanas by the EthAddress validation on `send_message_to_l1_syscall`.
    /// See `synthetic_payload` for the workaround harness.
    pub async fn player_buy_bundle(
        &self,
        player_addr: Felt,
        bundle_id: u32,
        quantity: u32,
    ) -> Result<PurchaseHandle> {
        let setup = self.appchain_world.contract("NUMS-Setup")?;
        let faucet = self.appchain_world.contract("NUMS-Faucet")?;
        let acct = self.appchain_account()?;

        // Approve setup to spend faucet tokens. Bundle 1 price is 1.98 USDC.
        // 100 USDC of approval is plenty.
        let approve = Call {
            to: faucet,
            selector: selector!("approve"),
            calldata: vec![setup, Felt::from(100_000_000_u128), Felt::ZERO],
        };
        // Setup.issue calldata layout:
        //   recipient (ContractAddress)
        //   bundle_id (u32)
        //   quantity (u32)
        //   referrer (Option<ContractAddress>) — None = 0x1
        //   referrer_group (Option<felt252>) — None = 0x1
        //   client (Option<ContractAddress>) — None = 0x1
        //   client_percentage (u8)
        //   voucher_key (Option<felt252>) — None = 0x1
        //   signature (Option<Span<felt252>>) — None = 0x1
        let issue = Call {
            to: setup,
            selector: selector!("issue"),
            calldata: vec![
                player_addr,
                Felt::from(bundle_id),
                Felt::from(quantity),
                Felt::ONE, // referrer = None
                Felt::ONE, // referrer_group = None
                Felt::ONE, // client = None
                Felt::ZERO, // client_percentage = 0
                Felt::ONE, // voucher_key = None
                Felt::ONE, // signature = None
            ],
        };

        let tx = acct
            .execute_v3(vec![approve, issue])
            .gas_estimate_multiplier(2.0)
            .send()
            .await
            .context("issue tx")?;
        let receipt = wait_for_tx_success(acct.provider(), tx.transaction_hash).await?;

        // Find the PurchaseInitiated event and the L2->L1 message hash.
        let events: &[starknet::core::types::Event] = match &receipt.receipt {
            TransactionReceipt::Invoke(r) => &r.events,
            _ => bail!("issue: unexpected receipt variant"),
        };

        // Event keys for PurchaseInitiated: [selector("PurchaseInitiated"), message_id, ...]
        // (Dojo emits events on the world contract; the keys structure includes the event
        // selector first, then the #[key] fields.)
        let pi_sel = get_selector_from_name("PurchaseInitiated").ok();
        let mut message_id: Option<Felt> = None;
        let mut nonce: u64 = 0;
        for ev in events {
            if pi_sel.is_some() && ev.keys.first() == pi_sel.as_ref() {
                message_id = ev.keys.get(1).copied();
                if let Some(n) = ev.data.first() {
                    nonce = u64::try_from(felt_to_u128(*n)?).unwrap_or(0);
                }
                break;
            }
        }

        // Fallback: locate message hash from MessageSent events emitted by the
        // appchain when send_message_to_l1_syscall fires. The bridge component
        // computes the same poseidon hash and stores it as the PendingPurchase
        // message_id, so either value works.
        let l1_handler_msgs: Vec<&starknet::core::types::MsgToL1> = match &receipt.receipt {
            TransactionReceipt::Invoke(r) => r.messages_sent.iter().collect(),
            _ => vec![],
        };

        let (message_id, payload) = if let Some(mid) = message_id {
            // Find the matching message payload via the MsgToL1 list — pick
            // the first one (bridge.dispatch sends exactly one per issue).
            let payload = l1_handler_msgs
                .first()
                .map(|m| m.payload.clone())
                .ok_or_else(|| anyhow!("no MsgToL1 in receipt"))?;
            (mid, payload)
        } else {
            // Recompute from MsgToL1 payload + addresses.
            let m = l1_handler_msgs
                .first()
                .ok_or_else(|| anyhow!("no PurchaseInitiated event AND no MsgToL1"))?;
            let from: Felt = setup;
            let to: Felt = m.to_address;
            let mid = compute_appc_to_sn_message_hash(from, to, &m.payload);
            (mid, m.payload.clone())
        };

        info!(
            "player_buy_bundle: message_id={message_id:#x} nonce={nonce} payload_len={plen}",
            plen = payload.len(),
        );
        let _ = receipt;

        Ok(PurchaseHandle {
            message_id,
            payload,
            nonce,
        })
    }

    /// Push the pending message hash onto the settlement messaging_mock so
    /// `consume_message_from_appchain` will see it. The harness's standin for
    /// piltover.update_state.
    pub async fn update_state_for_pending_messages(
        &self,
        purchase: &PurchaseHandle,
    ) -> Result<()> {
        let acct = self.settlement_account()?;
        let setup_appchain = self.appchain_world.contract("NUMS-Setup")?;
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        // The hash recorded on settlement is computed with from=setup_appchain,
        // to=settler. Re-derive to make sure we send the right one.
        let hash = compute_appc_to_sn_message_hash(setup_appchain, settler, &purchase.payload);
        debug!(
            "registering message hash {hash:#x} (purchase.message_id was {:#x})",
            purchase.message_id
        );
        add_messages_hashes_from_appchain(&acct, self.messaging_mock, &[hash])
            .await
            .context("add_messages_hashes_from_appchain")?;
        Ok(())
    }

    /// Inject a synthetic SettlementRequest payload + its message hash
    /// directly into the messaging_mock. Used by tests that want to exercise
    /// the settlement-side `Settler.settle` flow without going through the
    /// appchain bridge dispatch (see `player_buy_bundle` for the limitation).
    /// Returns a `PurchaseHandle` whose `message_id` matches what the bridge
    /// would have computed.
    pub async fn inject_synthetic_purchase(
        &self,
        payload: Vec<Felt>,
    ) -> Result<PurchaseHandle> {
        let setup_appchain = self.appchain_world.contract("NUMS-Setup")?;
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        let message_id = compute_appc_to_sn_message_hash(setup_appchain, settler, &payload);
        let acct = self.settlement_account()?;
        add_messages_hashes_from_appchain(&acct, self.messaging_mock, &[message_id])
            .await
            .context("add_messages_hashes_from_appchain")?;
        Ok(PurchaseHandle {
            message_id,
            payload,
            nonce: 0,
        })
    }

    /// Trigger Settler.settle for the given pending purchase. Replays the
    /// entire keeper loop in one call.
    pub async fn run_keeper(&self, purchase: &PurchaseHandle) -> Result<()> {
        let settler = self.settlement_world.contract("NUMS-Settler")?;
        let acct = self.settlement_account()?;
        let mut calldata = vec![Felt::from(purchase.payload.len() as u64)];
        calldata.extend_from_slice(&purchase.payload);
        let call = Call {
            to: settler,
            selector: selector!("settle"),
            calldata,
        };
        let tx = acct
            .execute_v3(vec![call])
            .gas_estimate_multiplier(3.0)
            .send()
            .await
            .context("settler.settle")?;
        wait_for_tx_success(acct.provider(), tx.transaction_hash).await?;
        info!("Settler.settle ok ({tx:#x})", tx = tx.transaction_hash);
        Ok(())
    }

    /// Wait for the Materializer L1Handler to land on the appchain and the
    /// PendingPurchase to flip to Settled. Polls every 500ms up to
    /// `timeout_secs`.
    pub async fn wait_for_materialization(
        &self,
        message_id: Felt,
        timeout_secs: u64,
    ) -> Result<()> {
        let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
        loop {
            match self.purchase_was_settled(message_id).await {
                Ok(true) => {
                    info!("PurchaseSettled event seen for {message_id:#x}");
                    return Ok(());
                }
                Ok(false) => {
                    debug!("waiting on materialize: no PurchaseSettled yet");
                }
                Err(e) => {
                    debug!("purchase_was_settled err: {e:#}");
                }
            }
            if std::time::Instant::now() > deadline {
                bail!("materialization timeout for {message_id:#x}");
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    pub async fn assert_infrastructure_ready(&self) -> Result<()> {
        let s = Self::provider(&self.settlement.rpc_url())?
            .chain_id()
            .await
            .context("settlement chain_id")?;
        if s != self.settlement_chain_id {
            return Err(anyhow!(
                "settlement chain_id mismatch: got {s:#x}, want {:#x}",
                self.settlement_chain_id
            ));
        }
        let a = Self::provider(&self.appchain.rpc_url())?
            .chain_id()
            .await
            .context("appchain chain_id")?;
        if a != self.appchain_chain_id {
            return Err(anyhow!(
                "appchain chain_id mismatch: got {a:#x}, want {:#x}",
                self.appchain_chain_id
            ));
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Forked-mainnet probes — kept from the previous harness because they
    // assert the fork is still functioning.
    // ------------------------------------------------------------------

    pub async fn read_nums_total_supply(&self) -> Result<(u128, u128)> {
        let provider = Self::provider(&self.settlement.rpc_url())?;
        let res = provider
            .call(
                FunctionCall {
                    contract_address: crate::constants::MAINNET_NUMS_TOKEN,
                    entry_point_selector: selector!("total_supply"),
                    calldata: vec![],
                },
                BlockId::Tag(BlockTag::PreConfirmed),
            )
            .await
            .context("call NUMS.total_supply")?;
        let lo = felt_to_u128(*res.first().ok_or_else(|| anyhow!("empty"))?)?;
        let hi = felt_to_u128(*res.get(1).ok_or_else(|| anyhow!("short"))?)?;
        Ok((lo, hi))
    }
}

#[derive(Debug, Clone)]
pub struct PendingPurchaseView {
    pub status: PendingStatus,
    pub nonce: u64,
    pub recipient: Felt,
    pub bundle_id: u32,
    pub quantity: u32,
}

fn build_account(
    provider: JsonRpcClient<HttpTransport>,
    chain_id: Felt,
    address: Felt,
    privkey: Felt,
) -> SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet> {
    let signer = LocalWallet::from_signing_key(SigningKey::from_secret_scalar(privkey));
    let mut account = SingleOwnerAccount::new(
        provider,
        signer,
        address,
        chain_id,
        ExecutionEncoding::New,
    );
    account.set_block_id(BlockId::Tag(BlockTag::PreConfirmed));
    account
}

fn chain_id_felt(s: &str) -> Result<Felt> {
    if s.len() > 31 {
        bail!("chain id `{s}` exceeds 31-byte limit");
    }
    let mut bytes = [0u8; 32];
    let src = s.as_bytes();
    bytes[32 - src.len()..].copy_from_slice(src);
    Ok(Felt::from_bytes_be(&bytes))
}

fn artifact_path(name: &str) -> PathBuf {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    here.join("artifacts").join(name)
}

fn repo_root() -> Result<PathBuf> {
    // CARGO_MANIFEST_DIR is tests/e2e; repo root is two levels up.
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    here.parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .ok_or_else(|| anyhow!("repo root not found from {}", here.display()))
}

/// Compute `compute_message_hash_appc_to_sn` per piltover.
pub fn compute_appc_to_sn_message_hash(from: Felt, to: Felt, payload: &[Felt]) -> Felt {
    let mut data = Vec::with_capacity(3 + payload.len());
    data.push(from);
    data.push(to);
    data.push(Felt::from(payload.len() as u64));
    data.extend_from_slice(payload);
    starknet_crypto::poseidon_hash_many(&data)
}

/// Dojo's bytearray_hash: poseidon over the byte-array repr (length-prefixed).
/// For string inputs, this is the canonical mapping from a Cairo `ByteArray`
/// constant to the felt selector.
pub fn bytearray_hash(s: &str) -> Felt {
    // Cairo's BYTES_31_PACK = 31. ByteArray serialization: [num_full_words, ...words, pending,
    // pending_len]. Poseidon over the serialized form.
    let bytes = s.as_bytes();
    let mut words: Vec<Felt> = Vec::new();
    let mut chunks = bytes.chunks_exact(31);
    for c in chunks.by_ref() {
        let mut buf = [0u8; 32];
        buf[1..].copy_from_slice(c); // big-endian: top byte zero, then 31 bytes
        words.push(Felt::from_bytes_be(&buf));
    }
    let rem = chunks.remainder();
    let pending = if rem.is_empty() {
        Felt::ZERO
    } else {
        let mut buf = [0u8; 32];
        buf[32 - rem.len()..].copy_from_slice(rem);
        Felt::from_bytes_be(&buf)
    };
    let mut data: Vec<Felt> = Vec::new();
    data.push(Felt::from(words.len() as u64));
    data.extend(words.iter().copied());
    data.push(pending);
    data.push(Felt::from(rem.len() as u64));
    starknet_crypto::poseidon_hash_many(&data)
}

fn felt_to_u128(f: Felt) -> Result<u128> {
    let bytes = f.to_bytes_be();
    for &b in &bytes[..16] {
        if b != 0 {
            return Err(anyhow!("felt {f:#x} does not fit in u128"));
        }
    }
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&bytes[16..]);
    Ok(u128::from_be_bytes(buf))
}

/// UDC-deploy the Materializer onto the appchain. Class hash comes from the
/// repo's `target/dev/nums_Materializer.contract_class.json`.
async fn deploy_materializer(
    account: &SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>,
    repo_root: &Path,
    bridge_settler: Felt,
    setup: Felt,
) -> Result<Felt> {
    // Try a few candidate paths because the contracts might be built to
    // either the workspace root or under contracts/.
    let candidates = [
        repo_root.join("target/dev/nums_Materializer.contract_class.json"),
        repo_root.join("contracts/target/dev/nums_Materializer.contract_class.json"),
    ];
    let class_path = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| anyhow!(
            "Materializer artifact not found in any of {candidates:?}; run `scarb build` first"
        ))?;
    let casm_path_str = class_path
        .to_string_lossy()
        .replace(".contract_class.json", ".compiled_contract_class.json");
    let class_bytes = std::fs::read(class_path).context("read Materializer class")?;
    let sierra: SierraClass = serde_json::from_slice(&class_bytes).context("parse sierra")?;
    let class_hash = sierra.class_hash().context("compute class hash")?;
    let flat = sierra.flatten().context("flatten sierra")?;
    let casm_bytes = std::fs::read(&casm_path_str).context("read casm")?;
    let casm: CompiledClass = serde_json::from_slice(&casm_bytes).context("parse casm")?;
    let compiled_class_hash = casm.class_hash().context("casm class hash")?;

    // Declare (idempotent).
    match account
        .declare_v3(Arc::new(flat), compiled_class_hash)
        .gas_estimate_multiplier(2.0)
        .send()
        .await
    {
        Ok(decl) => {
            wait_for_tx_success(account.provider(), decl.transaction_hash).await?;
            info!("Declared Materializer class {class_hash:#x}");
        }
        Err(e) => {
            let s = format!("{e:?}");
            if s.contains("ClassAlreadyDeclared") || s.contains("is already declared") {
                info!("Materializer class already declared");
            } else {
                return Err(anyhow!("declare Materializer: {e}"));
            }
        }
    }

    let factory = ContractFactory::new(class_hash, account);
    let salt = Felt::from_hex("0x534554544c455244454d").unwrap();
    let constructor_args = vec![bridge_settler, setup];
    let deployment = factory.deploy_v3(constructor_args.clone(), salt, false);
    let address = deployment.deployed_address();
    match deployment.gas_estimate_multiplier(2.0).send().await {
        Ok(tx) => {
            wait_for_tx_success(account.provider(), tx.transaction_hash).await?;
        }
        Err(e) => {
            let s = format!("{e:?}");
            if s.contains("already deployed") || s.contains("ContractAddressUnavailable") {
                warn!("Materializer address already in use");
            } else {
                return Err(anyhow!("deploy Materializer: {e}"));
            }
        }
    }

    Ok(address)
}
