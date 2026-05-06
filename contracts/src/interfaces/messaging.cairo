//! Minimal Piltover messaging interface for the mainnet Settler.
//!
//! Mirrors `piltover::messaging::interface::IMessaging` from the Katana repo:
//! `katana/crates/contracts/contracts/piltover/src/messaging/interface.cairo`.
//!
//! Only the two methods Settler depends on are declared here so we don't need to
//! pull the full Piltover crate as a workspace dependency yet. If we later add
//! the dependency, this file can be deleted and callers can switch to the
//! upstream trait.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMessaging<T> {
    /// Sends a message to the Appchain from Starknet.
    /// Returns the (message_hash, nonce).
    fn send_message_to_appchain(
        ref self: T, to_address: ContractAddress, selector: felt252, payload: Span<felt252>,
    ) -> (felt252, felt252);

    /// Consumes a message received from a state update of the Appchain.
    /// Returns the hash of the consumed message.
    fn consume_message_from_appchain(
        ref self: T, from_address: ContractAddress, payload: Span<felt252>,
    ) -> felt252;
}
