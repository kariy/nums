#[starknet::component]
pub mod BridgeComponent {
    // Imports
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use dojo::world::WorldStorage;
    use openzeppelin::interfaces::token::erc20::{IERC20MixinDispatcher, IERC20MixinDispatcherTrait};
    use starknet::{ContractAddress, SyscallResultTrait};
    use crate::models::index::{PendingPurchase, PendingStatus};
    use crate::{StoreImpl, StoreTrait};

    // Errors

    pub mod errors {
        pub const BRIDGE_FREE_BUNDLE: felt252 = 'Bridge: free bundle';
        pub const BRIDGE_USDC_HOLDING_ZERO: felt252 = 'Bridge: usdc_bridge zero';
        pub const BRIDGE_USDC_HOLDING_SELF: felt252 = 'Bridge: usdc_bridge self';
        pub const BRIDGE_SETTLER_ZERO: felt252 = 'Bridge: bridge_settler zero';
    }

    // Storage

    #[storage]
    pub struct Storage {}

    // Events

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {}

    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>, +Drop<TContractState>,
    > of BridgeTrait<TContractState> {
        /// Build the SettlementRequest payload, transfer USDC to the holding contract,
        /// send a Piltover message to the mainnet Settler, and persist a PendingPurchase
        /// record so the Materializer can correlate the response.
        fn dispatch(
            ref self: ComponentState<TContractState>,
            world: WorldStorage,
            recipient: ContractAddress,
            bundle_id: u32,
            quantity: u32,
        ) {
            // [Setup] Store
            let mut store = StoreImpl::new(world);

            // [Check] Bundle is paid; this codepath must never run for free bundles.
            let bundle = store.bundle(bundle_id);
            assert(bundle.price != 0, errors::BRIDGE_FREE_BUNDLE);

            // [Check] Bridge configuration is non-zero and not pointed at this Setup
            // (sentinel guard against silent USDC loss on misconfig).
            let config = store.config();
            assert(config.bridge_settler.is_non_zero(), errors::BRIDGE_SETTLER_ZERO);
            let this = starknet::get_contract_address();
            assert(config.usdc_bridge.is_non_zero(), errors::BRIDGE_USDC_HOLDING_ZERO);
            assert(config.usdc_bridge != this, errors::BRIDGE_USDC_HOLDING_SELF);

            // [Compute] Total USDC owed to the bridge holding contract
            let total_usdc: u256 = bundle.price * quantity.into();

            // [Interaction] Park USDC in the holding contract for batched bridging.
            let quote = IERC20MixinDispatcher { contract_address: config.quote };
            quote.transfer(config.usdc_bridge, total_usdc);

            // [Effect] Increment the per-Setup bridge nonce. Read-modify-write so two
            // identical purchases by different players produce different message hashes.
            let nonce = store.next_bridge_nonce();

            // [Compute] Build SettlementRequest payload (matches plan §5).
            let mut payload: Array<felt252> = array![];
            payload.append(nonce.into());
            payload.append(recipient.into());
            payload.append(quantity.into());
            payload.append(bundle.price.low.into());
            payload.append(bundle.price.high.into());
            payload.append(config.base_price.low.into());
            payload.append(config.base_price.high.into());
            payload.append(config.burn_percentage.into());
            payload.append(config.vault_percentage.into());
            payload.append(config.target_supply.low.into());
            payload.append(config.target_supply.high.into());

            // [Interaction] Send the L2->L1 message. The syscall returns `()`; the
            // canonical message hash is computed off-chain by the proof system. We
            // compute the same poseidon hash here to use as our `message_id` so we
            // can correlate the mainnet response back to this PendingPurchase.
            // Formula matches piltover::messaging::hash::compute_message_hash_appc_to_sn.
            starknet::syscalls::send_message_to_l1_syscall(
                config.bridge_settler.into(), payload.span(),
            )
                .unwrap_syscall();
            let from_address: felt252 = this.into();
            let to_address: felt252 = config.bridge_settler.into();
            let mut hash_data: Array<felt252> = array![
                from_address, to_address, payload.len().into(),
            ];
            let mut i: u32 = 0;
            while i < payload.len() {
                hash_data.append(*payload.at(i));
                i += 1;
            }
            let message_id: felt252 = poseidon_hash_span(hash_data.span());

            // [Effect] Persist the pending purchase record keyed on message_id.
            let pending = PendingPurchase {
                message_id: message_id,
                nonce: nonce,
                recipient: recipient,
                bundle_id: bundle_id,
                quantity: quantity,
                price: bundle.price,
                status: PendingStatus::Pending,
            };
            store.set_pending_purchase(@pending);

            // [Event] Notify clients / indexers.
            store.purchase_initiated(message_id, nonce, recipient, bundle_id, quantity);
        }
    }
}
