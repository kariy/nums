use starknet::ContractAddress;
pub use crate::events::index::{PurchaseCancelled, PurchaseInitiated, PurchaseSettled};

#[generate_trait]
pub impl PurchaseInitiatedImpl of PurchaseInitiatedTrait {
    fn new(
        message_id: felt252, nonce: u64, recipient: ContractAddress, bundle_id: u32, quantity: u32,
    ) -> PurchaseInitiated {
        PurchaseInitiated {
            message_id: message_id,
            nonce: nonce,
            recipient: recipient,
            bundle_id: bundle_id,
            quantity: quantity,
            time: starknet::get_block_timestamp(),
        }
    }
}

#[generate_trait]
pub impl PurchaseSettledImpl of PurchaseSettledTrait {
    fn new(message_id: felt252, multiplier: u128, price: u256) -> PurchaseSettled {
        PurchaseSettled {
            message_id: message_id,
            multiplier: multiplier,
            price: price,
            time: starknet::get_block_timestamp(),
        }
    }
}

#[generate_trait]
pub impl PurchaseCancelledImpl of PurchaseCancelledTrait {
    fn new(message_id: felt252, multiplier_used: u128) -> PurchaseCancelled {
        PurchaseCancelled {
            message_id: message_id,
            multiplier_used: multiplier_used,
            time: starknet::get_block_timestamp(),
        }
    }
}
