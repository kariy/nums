//! Minimal Piltover messaging interface used by both the mainnet Settler
//! and the Katana BridgeComponent.
//!
//! Mirrors `piltover::messaging::interface::IMessaging` from the Katana repo
//! (`katana/crates/contracts/contracts/piltover/src/messaging/interface.cairo`).
//! We only declare the methods Nums uses; the upstream trait can replace this
//! once Piltover is added as a workspace dependency.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMessaging<T> {
    /// Send a message from Starknet to the Appchain.
    /// Returns (message_hash, nonce).
    fn send_message_to_appchain(
        ref self: T, to_address: ContractAddress, selector: felt252, payload: Span<felt252>,
    ) -> (felt252, felt252);

    /// Consume a message that originated on the Appchain.
    /// Returns the message hash that was consumed.
    fn consume_message_from_appchain(
        ref self: T, from_address: ContractAddress, payload: Span<felt252>,
    ) -> felt252;

    /// Begin cancellation of a pending Starknet -> Appchain message. Reverts if no
    /// matching message exists. Returns the message hash.
    ///
    /// NOTE: this is intentionally NOT used by `Setup.admin_settle` because Piltover's
    /// cancellation primitive only applies to Starknet->Appchain messages, not the
    /// Appchain->Starknet direction the bridge actually uses. The dual-spend safety
    /// for the escape hatch comes from the `PendingPurchase.status` check inside
    /// `Setup.materialize_pending`. Declared here for completeness / future use.
    fn start_message_cancellation(
        ref self: T,
        to_address: ContractAddress,
        selector: felt252,
        payload: Span<felt252>,
        nonce: felt252,
    ) -> felt252;

    /// Finalize cancellation after the cancellation delay has elapsed.
    /// Returns the message hash.
    fn cancel_message(
        ref self: T,
        to_address: ContractAddress,
        selector: felt252,
        payload: Span<felt252>,
        nonce: felt252,
    ) -> felt252;
}
