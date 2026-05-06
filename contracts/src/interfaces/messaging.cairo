use starknet::ContractAddress;

/// Minimal `IMessaging` interface mirroring `piltover/src/messaging/interface.cairo`.
/// We only declare the methods Nums uses on the Katana / Mainnet sides.
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
    /// matching message exists.
    /// Returns the message hash.
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

/// Convenience extension Setup uses for the `admin_settle` escape hatch. The deployment
/// must wire `bridge_messaging` to a contract that implements this method (for example
/// a Piltover messaging contract wrapped to expose a single-arg cancellation API). The
/// IRON RULE is that this call must succeed atomically with the on-chain status flip;
/// if it reverts the entire `admin_settle` reverts so the operator never thinks they
/// handled a stuck purchase while the mainnet message can still be consumed.
#[starknet::interface]
pub trait ICancellable<T> {
    fn start_cancellation(ref self: T, message_hash: felt252);
}

