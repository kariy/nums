//! Mainnet Settler contract for the Nums Katana bridge.
//!
//! Owns a USDC reserve. A keeper drives `settle(payload)` after Piltover proves
//! a `SettlementRequest` from the Katana Setup. The Settler:
//!
//!   1. Consumes the message via Piltover (replay/forgery protection).
//!   2. Decodes the rich payload (price, percentages, target_supply) so amounts
//!      do NOT depend on local mainnet `Bundle` table symmetry.
//!   3. Runs the same swap+burn+vault.pay+team.transfer flow as
//!      `purchase.cairo:129-193`, but sources USDC from its own reserve.
//!   4. Computes `multiplier` via the shared `Rewarder::multiplier` formula.
//!   5. Sends a reverse Piltover message to `materializer` carrying
//!      `MaterializationResult` so Katana can finalize the pending purchase.
//!
//! Funding: `deposit_reserve` / `withdraw_reserve` — both `ADMIN_ROLE`-gated.
//!
//! After deploy, the operator MUST grant:
//!   * `Vault.PROVIDER_ROLE` to this contract (for `vault.pay`).
//!   * `Token` burn authorization equivalent (for `nums.burn`).
//! See `dojo_mainnet.toml` migration notes.

use starknet::ContractAddress;

#[inline]
pub fn NAME() -> ByteArray {
    "Settler"
}

#[starknet::interface]
pub trait ISettler<T> {
    fn settle(ref self: T, payload: Span<felt252>);
    fn deposit_reserve(ref self: T, amount: u256);
    fn withdraw_reserve(ref self: T, amount: u256);
}

const ADMIN_ROLE: felt252 = selector!("ADMIN_ROLE");

// TODO(lane B): replace with `crate::constants::MATERIALIZE_SELECTOR` once Lane B
// adds the constant. Defined locally here so Lane A compiles standalone — values
// MUST match (`selector!("materialize")`).
pub const MATERIALIZE_SELECTOR: felt252 = selector!("materialize");

/// Decoded payload of a `SettlementRequest` Piltover message.
///
/// Layout (matching plan §5):
///   [nonce, recipient, quantity,
///    price.low, price.high,
///    base_price.low, base_price.high,
///    burn_pct, vault_pct,
///    target_supply.low, target_supply.high]
#[derive(Copy, Drop, Serde)]
pub struct SettlementRequest {
    pub nonce: felt252,
    pub recipient: ContractAddress,
    pub quantity: u32,
    pub price: u256,
    pub base_price: u256,
    pub burn_percentage: u8,
    pub vault_percentage: u8,
    pub target_supply: u256,
}

#[inline]
fn felt_to_u128(value: felt252) -> u128 {
    value.try_into().expect('Settler: u128 overflow')
}

/// Pure decoder — extracted so it is unit-testable without deploying Settler.
pub fn decode_settlement_payload(payload: Span<felt252>) -> SettlementRequest {
    assert(payload.len() == 11, 'Settler: bad payload len');
    SettlementRequest {
        nonce: *payload.at(0),
        recipient: (*payload.at(1)).try_into().expect('bad recipient'),
        quantity: (*payload.at(2)).try_into().expect('bad quantity'),
        price: u256 { low: felt_to_u128(*payload.at(3)), high: felt_to_u128(*payload.at(4)) },
        base_price: u256 { low: felt_to_u128(*payload.at(5)), high: felt_to_u128(*payload.at(6)) },
        burn_percentage: (*payload.at(7)).try_into().expect('bad burn pct'),
        vault_percentage: (*payload.at(8)).try_into().expect('bad vault pct'),
        target_supply: u256 {
            low: felt_to_u128(*payload.at(9)), high: felt_to_u128(*payload.at(10)),
        },
    }
}

/// Pure encoder for `MaterializationResult` payload sent back to Katana.
/// Layout (matching plan §5):
///   [message_id, multiplier, supply.low, supply.high, price.low, price.high, quantity]
pub fn encode_materialization_payload(
    message_id: felt252, multiplier: u128, supply: u256, price: u256, quantity: u32,
) -> Array<felt252> {
    array![
        message_id, multiplier.into(), supply.low.into(), supply.high.into(), price.low.into(),
        price.high.into(), quantity.into(),
    ]
}

#[dojo::contract]
pub mod Settler {
    use core::num::traits::Zero;
    use dojo::world::WorldStorageTrait;
    use ekubo::components::clear::IClearDispatcherTrait;
    use ekubo::interfaces::erc20::IERC20Dispatcher;
    use ekubo::interfaces::router::{IRouterDispatcherTrait, RouteNode, TokenAmount};
    use ekubo::types::i129::i129;
    use ekubo::types::keys::PoolKey;
    use openzeppelin::access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin::interfaces::token::erc20::{IERC20MixinDispatcher, IERC20MixinDispatcherTrait};
    use openzeppelin::introspection::src5::SRC5Component;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use crate::constants::{MULTIPLIER_PRECISION, NAMESPACE};
    use crate::helpers::rewarder::Rewarder;
    use crate::interfaces::messaging::{IMessagingDispatcher, IMessagingDispatcherTrait};
    use crate::models::config::ConfigTrait;
    use crate::systems::token::{ITokenDispatcher, ITokenDispatcherTrait, NAME as TOKEN};
    use crate::systems::treasury::NAME as TREASURY;
    use crate::systems::vault::{IVaultDispatcher, IVaultDispatcherTrait, NAME as VAULT};
    use crate::{StoreImpl, StoreTrait};
    use super::{
        ADMIN_ROLE, ISettler, MATERIALIZE_SELECTOR, SettlementRequest, decode_settlement_payload,
        encode_materialization_payload,
    };

    // Components

    component!(path: AccessControlComponent, storage: accesscontrol, event: AccessControlEvent);
    #[abi(embed_v0)]
    impl AccessControlImpl =
        AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    // Storage

    #[storage]
    struct Storage {
        piltover_messaging: ContractAddress,
        katana_setup: ContractAddress,
        materializer: ContractAddress,
        #[substorage(v0)]
        accesscontrol: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    // Events

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Settled: Settled,
        ReserveDeposited: ReserveDeposited,
        ReserveWithdrawn: ReserveWithdrawn,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct Settled {
        #[key]
        message_id: felt252,
        recipient: ContractAddress,
        quantity: u32,
        multiplier: u128,
        burn_amount: u256,
        supply_per_game: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ReserveDeposited {
        #[key]
        from: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ReserveWithdrawn {
        #[key]
        to: ContractAddress,
        amount: u256,
    }

    // Constructor

    fn dojo_init(
        ref self: ContractState,
        piltover_messaging: ContractAddress,
        katana_setup: ContractAddress,
        materializer: ContractAddress,
    ) {
        // [Effect] Persist external dependency addresses
        self.piltover_messaging.write(piltover_messaging);
        self.katana_setup.write(katana_setup);
        self.materializer.write(materializer);

        // [Effect] Initialize access control — Treasury holds admin keys.
        self.accesscontrol.initializer();
        let world = self.world(@NAMESPACE());
        let treasury_address = world.dns_address(@TREASURY()).expect('Treasury not found!');
        self.accesscontrol._grant_role(DEFAULT_ADMIN_ROLE, treasury_address);
        self.accesscontrol._grant_role(ADMIN_ROLE, treasury_address);
    }

    // External

    #[abi(embed_v0)]
    impl SettlerImpl of ISettler<ContractState> {
        fn settle(ref self: ContractState, payload: Span<felt252>) {
            // [Setup] World and store
            let world = self.world(@NAMESPACE());
            let store = StoreImpl::new(world);

            // [Check] Decode the SettlementRequest payload (see plan §5).
            let SettlementRequest {
                nonce,
                recipient,
                quantity,
                price,
                base_price,
                burn_percentage,
                vault_percentage,
                target_supply,
            } = decode_settlement_payload(payload);
            let recipient_felt: felt252 = recipient.into();

            // [Interaction] Consume the Piltover message from Katana Setup.
            //  Reverts if no matching message exists or origin mismatches.
            let messaging = IMessagingDispatcher {
                contract_address: self.piltover_messaging.read(),
            };
            let message_id = messaging
                .consume_message_from_appchain(self.katana_setup.read(), payload);

            // [Setup] Common dispatchers
            let nums_address = world.dns_address(@TOKEN()).expect('Token not found!');
            let nums_asset = IERC20MixinDispatcher { contract_address: nums_address };
            let nums_supply = nums_asset.total_supply();
            let config = store.config();
            let quote = IERC20MixinDispatcher { contract_address: config.quote };
            let this = starknet::get_contract_address();

            // [Free-bundle short-circuit] If price is zero, skip swap+burn and
            // send a reverse message with MULTIPLIER_PRECISION.
            if price == 0_u256 {
                self
                    .send_materialization(
                        message_id, MULTIPLIER_PRECISION, nums_supply, price, quantity,
                    );

                // [Event]
                self
                    .emit(
                        Event::Settled(
                            Settled {
                                message_id,
                                recipient,
                                quantity,
                                multiplier: MULTIPLIER_PRECISION,
                                burn_amount: 0,
                                supply_per_game: nums_supply,
                            },
                        ),
                    );

                // Silence unused-variable lints on the price-zero branch
                let _ = nonce;
                let _ = vault_percentage;
                let _ = base_price;
                let _ = target_supply;
                return;
            }

            // [Compute] burn share, sourcing USDC from this contract's reserve.
            // Mirrors `purchase.cairo:131-136`.
            let pack_multiplier = price / base_price + 1;
            let amount = quantity.into()
                * pack_multiplier
                * base_price
                * burn_percentage.into()
                / 100_u256;

            // The mainnet `purchase.execute` flow operates on a "working budget"
            // of `total_usdc = price * quantity` that the player just deposited.
            // After the swap, vault.pay and team.transfer consume the residual
            // of THAT budget (not the entire contract balance). To mimic the
            // same accounting here we reserve `total_usdc` against the Settler's
            // ambient USDC balance and only sweep proceeds within that envelope.
            let total_usdc = price * quantity.into();

            // [Check] Reserve sufficient — must be able to cover the working
            // budget so the vault/team payouts don't drain the long-lived reserve.
            let reserve_balance_pre = quote.balance_of(this);
            assert(reserve_balance_pre >= total_usdc, 'Settler: reserve too low');
            // burn share is part of total_usdc by definition (burn_pct <= 100)
            assert(amount <= total_usdc, 'Settler: burn > total');

            // [Interaction] Transfer the burn share to Ekubo
            let router = store.ekubo_router();
            quote.transfer(router.contract_address, amount);

            // [Interaction] Swap Quote token for Nums
            let (token0, token1) = if quote.contract_address < nums_address {
                (quote.contract_address, nums_address)
            } else {
                (nums_address, quote.contract_address)
            };
            let pool_key = PoolKey {
                token0,
                token1,
                fee: config.pool_fee,
                tick_spacing: config.pool_tick_spacing,
                extension: config.pool_extension,
            };
            let route_node = RouteNode {
                pool_key, sqrt_ratio_limit: config.pool_sqrt, skip_ahead: 0,
            };
            let quote_address = quote.contract_address;
            let token_amount = TokenAmount {
                token: quote_address, amount: i129 { mag: amount.low, sign: false },
            };
            router.swap(route_node, token_amount);

            // [Interaction] Clear minimum
            let clearer = store.ekubo_clearer();
            clearer.clear_minimum(IERC20Dispatcher { contract_address: nums_address }, 0);
            clearer.clear(IERC20Dispatcher { contract_address: quote_address });

            // [Interaction] Burn the corresponding amount of Nums
            let burn_amount = nums_asset.balance_of(this);
            let nums_token = ITokenDispatcher { contract_address: nums_address };
            if burn_amount > 0 {
                nums_token.burn(burn_amount);
            }

            // [Compute] Working-budget residual after swap+clear.
            // Mirrors purchase.cairo's "balance after clear" but scoped to the
            // single settlement instead of the contract's whole balance.
            //   pre_send  = reserve_balance_pre
            //   post_send = pre_send - amount
            //   post_clear = post_send + clear_quote_returns
            //   working_residual = post_clear - (pre_send - total_usdc)
            //                    = current_balance - pre_send + total_usdc
            let post_clear_balance = quote.balance_of(this);
            // Defensive: should never underflow because amount <= total_usdc and
            // clear cannot return more than the burn share originally sent.
            let working_residual = if post_clear_balance + total_usdc >= reserve_balance_pre {
                post_clear_balance + total_usdc - reserve_balance_pre
            } else {
                0_u256
            };

            // [Interaction] Pay dividends to the vault — vault_pct % of residual.
            let vault_address = world.dns_address(@VAULT()).expect('Vault not found!');
            let vault = IVaultDispatcher { contract_address: vault_address };
            let vault_amount = working_residual * vault_percentage.into() / 100_u256;
            if vault_amount > 0 {
                quote.approve(spender: vault.contract_address, amount: vault_amount);
                vault.pay(recipient_felt, vault_amount);
            }

            // [Interaction] Transfer the remaining residual to the team.
            let team_address = config.team_address;
            let team_amount = working_residual - vault_amount;
            if team_amount > 0 {
                quote.transfer(team_address, team_amount);
            }

            // [Compute] Multiplier per game (matches purchase.cairo:195-206)
            let burn_per_game = if quantity > 0 {
                burn_amount / quantity.into()
            } else {
                0
            };
            let supply_per_game = nums_supply - burn_per_game;
            let (avg_num, avg_den) = config.average_score();
            let multiplier = Rewarder::multiplier(
                supply_per_game,
                target_supply,
                burn_per_game,
                avg_num.into(),
                avg_den.into(),
                config.slot_count.into(),
            );

            // [Interaction] Send the MaterializationResult back to Katana.
            self.send_materialization(message_id, multiplier, supply_per_game, price, quantity);

            // [Event]
            self
                .emit(
                    Event::Settled(
                        Settled {
                            message_id,
                            recipient,
                            quantity,
                            multiplier,
                            burn_amount,
                            supply_per_game,
                        },
                    ),
                );

            // Silence unused-variable warnings — nonce is implicitly bound to
            // the message_id via Piltover's hashing.
            let _ = nonce;
        }

        fn deposit_reserve(ref self: ContractState, amount: u256) {
            self.accesscontrol.assert_only_role(ADMIN_ROLE);
            let caller = get_caller_address();
            let world = self.world(@NAMESPACE());
            let store = StoreImpl::new(world);
            let quote = IERC20MixinDispatcher { contract_address: store.config().quote };
            let this = starknet::get_contract_address();
            quote.transfer_from(caller, this, amount);
            self.emit(Event::ReserveDeposited(ReserveDeposited { from: caller, amount }));
        }

        fn withdraw_reserve(ref self: ContractState, amount: u256) {
            self.accesscontrol.assert_only_role(ADMIN_ROLE);
            let caller = get_caller_address();
            let world = self.world(@NAMESPACE());
            let store = StoreImpl::new(world);
            let quote = IERC20MixinDispatcher { contract_address: store.config().quote };
            quote.transfer(caller, amount);
            self.emit(Event::ReserveWithdrawn(ReserveWithdrawn { to: caller, amount }));
        }
    }

    // Internal

    #[generate_trait]
    impl PrivateImpl of PrivateTrait {
        fn send_materialization(
            ref self: ContractState,
            message_id: felt252,
            multiplier: u128,
            supply: u256,
            price: u256,
            quantity: u32,
        ) {
            let messaging = IMessagingDispatcher {
                contract_address: self.piltover_messaging.read(),
            };
            let materializer = self.materializer.read();
            assert(materializer.is_non_zero(), 'Settler: no materializer');
            let payload = encode_materialization_payload(
                message_id, multiplier, supply, price, quantity,
            );
            messaging.send_message_to_appchain(materializer, MATERIALIZE_SELECTOR, payload.span());
        }
    }
}
