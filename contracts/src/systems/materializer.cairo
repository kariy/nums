#[inline]
pub fn NAME() -> ByteArray {
    "Materializer"
}

/// Minimal Setup interface re-declared here to avoid pulling the entire Setup
/// dispatcher (which depends on the Dojo macros). We only need the one method
/// the Materializer calls.
#[starknet::interface]
pub trait ISetupMaterialize<T> {
    fn materialize_pending(
        ref self: T,
        message_id: felt252,
        multiplier: u128,
        supply: u256,
        price: u256,
        quantity: u32,
    );
}

/// Plain Starknet contract (NOT a Dojo contract). Owns the `#[l1_handler]` entry
/// point and is the single authorized caller of `Setup.materialize_pending`.
#[starknet::contract]
pub mod Materializer {
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::{ISetupMaterializeDispatcher, ISetupMaterializeDispatcherTrait};

    #[storage]
    struct Storage {
        bridge_settler: ContractAddress,
        setup: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, bridge_settler: ContractAddress, setup: ContractAddress,
    ) {
        self.bridge_settler.write(bridge_settler);
        self.setup.write(setup);
    }

    #[l1_handler]
    fn materialize(
        ref self: ContractState,
        from_address: felt252,
        message_id: felt252,
        multiplier: u128,
        supply_lo: u128,
        supply_hi: u128,
        price_lo: u128,
        price_hi: u128,
        quantity: u32,
    ) {
        // [Check] Only messages originating from the configured mainnet Settler are
        // honored. Piltover's per-sender nonce in the SN -> Appchain direction
        // additionally provides replay protection across the message boundary.
        let expected: felt252 = self.bridge_settler.read().into();
        assert(from_address == expected, 'Invalid sender');

        let supply = u256 { low: supply_lo, high: supply_hi };
        let price = u256 { low: price_lo, high: price_hi };

        let mut setup = ISetupMaterializeDispatcher { contract_address: self.setup.read() };
        setup.materialize_pending(message_id, multiplier, supply, price, quantity);
    }

    #[generate_trait]
    pub impl ViewImpl of ViewTrait {
        fn bridge_settler(self: @ContractState) -> ContractAddress {
            self.bridge_settler.read()
        }
        fn setup(self: @ContractState) -> ContractAddress {
            self.setup.read()
        }
    }
}
