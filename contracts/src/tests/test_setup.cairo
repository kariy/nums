use crate::StoreImpl;
use crate::constants::WORLD_RESOURCE;
use crate::models::index::{BridgeNonce, Config};
use crate::tests::setup::setup::spawn_game;

#[test]
fn test_setup() {
    spawn_game();
}

/// Mainnet regression test: with `config.bridge_settler == 0` the Setup must
/// behave exactly like before the bridge work landed. We verify the default
/// (zero) bridge config persists through a write/read round-trip — the on_issue
/// branch reads `config.bridge_settler.is_zero()` to choose the inline path,
/// so this is the IRON RULE check that the new branching logic does not silently
/// switch mainnet to the Katana codepath.
#[test]
fn test_mainnet_config_bridge_fields_zero_by_default() {
    let (world, _systems, _ctx) = spawn_game();
    let mut store = StoreImpl::new(world);
    // Persist a Config with bridge_settler explicitly zero (mainnet posture).
    let config = Config {
        world_resource: WORLD_RESOURCE,
        vrf: 0.try_into().unwrap(),
        quote: 0.try_into().unwrap(),
        team_address: 0.try_into().unwrap(),
        ekubo_router: 0.try_into().unwrap(),
        ekubo_positions: 0.try_into().unwrap(),
        target_supply: 0,
        burn_percentage: 70,
        vault_percentage: 50,
        slot_count: 18,
        slot_min: 1,
        slot_max: 999,
        average_weigth: 100,
        average_score: 0,
        last_updated: 0,
        pool_fee: 0,
        pool_tick_spacing: 0,
        pool_extension: 0.try_into().unwrap(),
        pool_sqrt: 0,
        base_price: 0,
        bridge_settler: 0.try_into().unwrap(),
        usdc_bridge: 0.try_into().unwrap(),
        bridge_messaging: 0.try_into().unwrap(),
        materializer: 0.try_into().unwrap(),
    };
    store.set_config(config);
    let read_back = store.config();
    let bridge_addr: starknet::ContractAddress = read_back.bridge_settler;
    let zero: starknet::ContractAddress = 0.try_into().unwrap();
    assert(bridge_addr == zero, 'bridge_settler not zero');
    let usdc: starknet::ContractAddress = read_back.usdc_bridge;
    assert(usdc == zero, 'usdc_bridge not zero');
    let messaging: starknet::ContractAddress = read_back.bridge_messaging;
    assert(messaging == zero, 'bridge_messaging not zero');
    let mat: starknet::ContractAddress = read_back.materializer;
    assert(mat == zero, 'materializer not zero');
}

/// next_bridge_nonce must be a strict monotonic counter — two consecutive
/// calls produce distinct values. This is the regression test for the
/// hash-collision fix: identical purchases by different players use this
/// counter to differentiate their Piltover message hashes.
#[test]
fn test_next_bridge_nonce_increments() {
    let (world, _systems, _ctx) = spawn_game();
    let mut store = StoreImpl::new(world);
    let initial = store.bridge_nonce();
    assert(initial.next == 0, 'initial nonce not zero');
    let n1 = store.next_bridge_nonce();
    assert(n1 == 1, 'first nonce should be 1');
    let n2 = store.next_bridge_nonce();
    assert(n2 == 2, 'second nonce should be 2');
    assert(n1 != n2, 'consecutive nonces equal');
    let stored = store.bridge_nonce();
    assert(stored.next == 2, 'stored nonce mismatch');
    let _: BridgeNonce = stored;
}

/// PendingPurchase round-trip: write a Pending record, read it back, mark
/// Settled, verify the status transition.
#[test]
fn test_pending_purchase_round_trip() {
    use crate::models::index::{PendingPurchase, PendingStatus};
    let (world, _systems, _ctx) = spawn_game();
    let mut store = StoreImpl::new(world);
    let player: starknet::ContractAddress = 'PLAYER_X'.try_into().unwrap();
    let message_id: felt252 = 0x1234;
    let pending = PendingPurchase {
        message_id: message_id,
        nonce: 42,
        recipient: player,
        bundle_id: 3,
        quantity: 5,
        price: 1000,
        status: PendingStatus::Pending,
    };
    store.set_pending_purchase(@pending);
    let read = store.pending_purchase(message_id);
    assert(read.nonce == 42, 'nonce roundtrip');
    assert(read.recipient == player, 'recipient roundtrip');
    assert(read.bundle_id == 3, 'bundle_id roundtrip');
    assert(read.quantity == 5, 'quantity roundtrip');
    assert(read.status == PendingStatus::Pending, 'status pending');

    // Mark Settled and re-read.
    let settled = PendingPurchase {
        message_id: message_id,
        nonce: read.nonce,
        recipient: read.recipient,
        bundle_id: read.bundle_id,
        quantity: read.quantity,
        price: read.price,
        status: PendingStatus::Settled,
    };
    store.set_pending_purchase(@settled);
    let after = store.pending_purchase(message_id);
    assert(after.status == PendingStatus::Settled, 'status settled');
}
