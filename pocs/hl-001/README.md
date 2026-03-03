# HL-001 PoC: Mailbox.process() Delivery State Before ISM Verification

## What This Proves

In Hyperlane's `Mailbox.process()`, the execution order is:

1. **Set `deliveries[id]`** → `delivered()` returns `true`
2. **Call `ism.verify()`** → ISM executes (CommitmentReadIsm calls `ica.revealAndExecute()`)
3. **Call `recipient.handle()`** → actual message delivery

During step 2, any external call made by the ISM can observe that `delivered(msgId) == true` while `handle()` has NOT been called on the recipient. This is an invariant violation: the message is "delivered" but never actually handled yet.

## Why It Matters

With `CommitmentReadIsm`, step 2 executes **attacker-controlled calls** via `OwnableMulticall.revealAndExecute(calls, salt)`. An attacker can craft calls that:

- Query `mailbox.delivered(msgId)` and get `true`
- Interact with protocols that check delivery status
- Exploit the inconsistent state where delivery is confirmed but the recipient hasn't processed the message

## Running

```bash
cd poc-hl-001
forge test -vvv
```

Expected output: `test_deliveredBeforeHandle` passes, proving:
- `ism.deliveredDuringVerify() == true` (delivered was true during verify)
- `ism.handleCalledDuringVerify() == false` (handle hadn't been called yet)

## Architecture

Uses minimal mocks (no mainnet fork needed):
- `MockMailbox` — reproduces exact `process()` ordering from Hyperlane
- `MaliciousIsm` — simulates CommitmentReadIsm's external call behavior, records state observations
- `VictimRecipient` — tracks whether `handle()` was called
