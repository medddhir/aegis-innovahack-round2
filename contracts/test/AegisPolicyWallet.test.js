const { assert } = require('chai');
const { ethers, network } = require('hardhat');

const TASK = ethers.id('CLOUD-CAPACITY-07');
const WRONG_TASK = ethers.id('UNRELATED-MARKETING-09');
let nonceSequence = 0;

async function latestTimestamp() {
  return Number((await ethers.provider.getBlock('latest')).timestamp);
}

async function advance(seconds) {
  await network.provider.send('evm_increaseTime', [seconds]);
  await network.provider.send('evm_mine');
}

async function deployFixture(options = {}) {
  const [owner, agent, recipient, recipientTwo, attacker] = await ethers.getSigners();
  const now = await latestTimestamp();
  const config = {
    perTransactionLimit: 2_500n,
    totalTaskBudget: 10_000n,
    dailyCumulativeLimit: 5_000n,
    expiryOffset: 86_400,
    settlementDelay: 30n,
    walletFunding: 50_000n,
    ...options,
  };
  const Token = await ethers.getContractFactory('MockINRToken', owner);
  const token = await Token.deploy(1_000_000n);
  await token.waitForDeployment();
  const Wallet = await ethers.getContractFactory('AegisPolicyWallet', owner);
  const wallet = await Wallet.deploy(
    await token.getAddress(),
    agent.address,
    TASK,
    config.perTransactionLimit,
    config.totalTaskBudget,
    config.dailyCumulativeLimit,
    now + config.expiryOffset,
    config.settlementDelay,
    [recipient.address, recipientTwo.address],
  );
  await wallet.waitForDeployment();
  await (await token.transfer(await wallet.getAddress(), config.walletFunding)).wait();
  return { owner, agent, recipient, recipientTwo, attacker, token, wallet, config };
}

function errorData(error) {
  return error?.data ?? error?.error?.data ?? error?.info?.error?.data ?? error?.cause?.data;
}

async function expectCustomError(action, contract, expectedName) {
  try {
    const pending = await action();
    if (pending?.wait) await pending.wait();
    assert.fail(`Expected ${expectedName}`);
  } catch (error) {
    const data = errorData(error);
    let parsed = null;
    if (data) {
      try { parsed = contract.interface.parseError(data); } catch { /* expose original below */ }
    }
    assert.equal(parsed?.name, expectedName, `Expected ${expectedName}; received ${error.shortMessage ?? error.message}`);
    return parsed;
  }
}

function parseEvent(contract, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === name) return parsed;
    } catch { /* log from token */ }
  }
  return null;
}

async function request(fixture, overrides = {}) {
  const signer = overrides.signer ?? fixture.agent;
  const recipient = overrides.recipient ?? fixture.recipient.address;
  const amount = overrides.amount ?? 1_200n;
  const taskHash = overrides.taskHash ?? TASK;
  const nonce = overrides.nonce ?? ethers.id(`AUTO-NONCE-${++nonceSequence}`);
  const version = overrides.version ?? await fixture.wallet.policyVersion();
  const tx = await fixture.wallet.connect(signer).requestIntent(recipient, amount, taskHash, nonce, version);
  const receipt = await tx.wait();
  const event = parseEvent(fixture.wallet, receipt, 'IntentRequested');
  assert.ok(event, 'IntentRequested event missing');
  return { tx, receipt, event, intentId: event.args.intentId, nonce, amount, recipient, version };
}

describe('AegisPolicyWallet — local Mock INR enforcement', function () {
  it('1. only the authorised agent may request', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => request(fixture, { signer: fixture.attacker }), fixture.wallet, 'UnauthorizedAgent');
  });

  it('2. owner does not accidentally use the agent-only request path', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => request(fixture, { signer: fixture.owner }), fixture.wallet, 'UnauthorizedAgent');
  });

  it('3. valid allowlisted payment enters pending state', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { nonce: ethers.id('PENDING-VALID') });
    const intent = await fixture.wallet.getIntent(pending.intentId);
    assert.equal(intent.status, 1n);
    assert.equal(intent.amount, 1_200n);
    assert.equal(await fixture.wallet.currentReserved(), 1_200n);
  });

  it('4. payment cannot execute before settlement delay', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { nonce: ethers.id('TOO-EARLY') });
    await expectCustomError(() => fixture.wallet.executeIntent(pending.intentId), fixture.wallet, 'SettlementDelayActive');
  });

  it('5. valid payment executes after final delay revalidation', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { nonce: ethers.id('EXECUTE-VALID') });
    await advance(31);
    await (await fixture.wallet.executeIntent(pending.intentId)).wait();
    assert.equal((await fixture.wallet.getIntent(pending.intentId)).status, 2n);
    assert.equal(await fixture.token.balanceOf(fixture.recipient.address), 1_200n);
    assert.equal(await fixture.wallet.totalSpent(), 1_200n);
  });

  it('6. unknown recipient is rejected', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => request(fixture, { recipient: fixture.attacker.address }), fixture.wallet, 'RecipientNotApproved');
  });

  it('7. oversized payment is rejected', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => request(fixture, { amount: 8_500n }), fixture.wallet, 'PerTransactionLimitExceeded');
  });

  it('8. wrong task hash is rejected', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => request(fixture, { taskHash: WRONG_TASK }), fixture.wallet, 'TaskMismatch');
  });

  it('9. expired policy is rejected', async function () {
    const fixture = await deployFixture({ expiryOffset: 60 });
    await advance(61);
    await expectCustomError(() => request(fixture), fixture.wallet, 'PolicyExpired');
  });

  it('10. total task budget is enforced', async function () {
    const fixture = await deployFixture({ dailyCumulativeLimit: 0n });
    for (let index = 0; index < 4; index += 1) {
      await request(fixture, { amount: 2_500n, nonce: ethers.id(`TOTAL-${index}`) });
    }
    await expectCustomError(() => request(fixture, { amount: 1n, nonce: ethers.id('TOTAL-OVER') }), fixture.wallet, 'TotalBudgetExceeded');
  });

  it('11. daily cumulative limit includes reservations', async function () {
    const fixture = await deployFixture();
    await request(fixture, { amount: 2_500n, nonce: ethers.id('DAILY-1') });
    await request(fixture, { amount: 2_500n, nonce: ethers.id('DAILY-2') });
    await expectCustomError(() => request(fixture, { amount: 1n, nonce: ethers.id('DAILY-OVER') }), fixture.wallet, 'DailyLimitExceeded');
  });

  it('12. pending amount is reserved and owner cancellation releases it', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { amount: 1_500n, nonce: ethers.id('RESERVE-CANCEL') });
    assert.equal(await fixture.wallet.currentReserved(), 1_500n);
    await (await fixture.wallet.cancelIntent(pending.intentId)).wait();
    assert.equal(await fixture.wallet.currentReserved(), 0n);
    assert.equal((await fixture.wallet.getIntent(pending.intentId)).status, 3n);
  });

  it('13. multiple pending requests cannot over-reserve the budget', async function () {
    const fixture = await deployFixture({ perTransactionLimit: 2_000n, totalTaskBudget: 3_000n, dailyCumulativeLimit: 3_000n });
    await request(fixture, { amount: 2_000n, nonce: ethers.id('MULTI-1') });
    await expectCustomError(() => request(fixture, { amount: 1_500n, nonce: ethers.id('MULTI-2') }), fixture.wallet, 'TotalBudgetExceeded');
  });

  it('14. duplicate nonce is rejected even if the amount changes', async function () {
    const fixture = await deployFixture();
    const nonce = ethers.id('DUPLICATE-FOREVER');
    await request(fixture, { amount: 1_000n, nonce });
    await expectCustomError(() => request(fixture, { amount: 900n, nonce }), fixture.wallet, 'NonceAlreadyUsed');
  });

  it('15. agent cannot change policy', async function () {
    const fixture = await deployFixture();
    const expiry = await latestTimestamp() + 90_000;
    await expectCustomError(
      () => fixture.wallet.connect(fixture.agent).updatePolicy(fixture.agent.address, TASK, 2_500, 10_000, 5_000, expiry, 30),
      fixture.wallet,
      'UnauthorizedOwner',
    );
  });

  it('16. agent cannot add a recipient', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => fixture.wallet.connect(fixture.agent).approveRecipient(fixture.attacker.address), fixture.wallet, 'UnauthorizedOwner');
  });

  it('17. agent cannot freeze financial authority', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => fixture.wallet.connect(fixture.agent).freeze(), fixture.wallet, 'UnauthorizedOwner');
  });

  it('18. agent cannot restore financial authority', async function () {
    const fixture = await deployFixture();
    await (await fixture.wallet.freeze()).wait();
    await expectCustomError(() => fixture.wallet.connect(fixture.agent).restore(), fixture.wallet, 'UnauthorizedOwner');
  });

  it('19. owner freeze increments policy version', async function () {
    const fixture = await deployFixture();
    assert.equal(await fixture.wallet.policyVersion(), 1n);
    await (await fixture.wallet.freeze()).wait();
    assert.equal(await fixture.wallet.policyVersion(), 2n);
    assert.equal(await fixture.wallet.frozen(), true);
  });

  it('20. freeze blocks all new requests', async function () {
    const fixture = await deployFixture();
    await (await fixture.wallet.freeze()).wait();
    await expectCustomError(() => request(fixture, { version: 2n }), fixture.wallet, 'WalletIsFrozen');
  });

  it('21. freeze prevents execution of an existing pending intent', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { nonce: ethers.id('FREEZE-PENDING') });
    await (await fixture.wallet.freeze()).wait();
    await advance(31);
    await expectCustomError(() => fixture.wallet.executeIntent(pending.intentId), fixture.wallet, 'WalletIsFrozen');
    assert.equal(await fixture.token.balanceOf(fixture.recipient.address), 0n);
  });

  it('22. restore never revives the old pending intent', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { nonce: ethers.id('RESTORE-OLD') });
    await (await fixture.wallet.freeze()).wait();
    await (await fixture.wallet.restore()).wait();
    await advance(31);
    await expectCustomError(() => fixture.wallet.executeIntent(pending.intentId), fixture.wallet, 'StalePolicyVersion');
  });

  it('23. fresh intent works under the restored policy version', async function () {
    const fixture = await deployFixture();
    const stale = await request(fixture, { nonce: ethers.id('STALE-BEFORE-RESTORE') });
    await (await fixture.wallet.freeze()).wait();
    await (await fixture.wallet.restore()).wait();
    await (await fixture.wallet.cancelIntent(stale.intentId)).wait();
    const fresh = await request(fixture, { nonce: ethers.id('FRESH-AFTER-RESTORE'), version: 3n });
    await advance(31);
    await (await fixture.wallet.executeIntent(fresh.intentId)).wait();
    assert.equal(await fixture.token.balanceOf(fixture.recipient.address), 1_200n);
  });

  it('24. removed recipient cannot receive pending settlement', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { nonce: ethers.id('REMOVED-RECIPIENT') });
    await (await fixture.wallet.removeRecipient(fixture.recipient.address)).wait();
    await advance(31);
    await expectCustomError(() => fixture.wallet.executeIntent(pending.intentId), fixture.wallet, 'StalePolicyVersion');
    assert.equal(await fixture.token.balanceOf(fixture.recipient.address), 0n);
  });

  it('25. contract balance accounting remains exact', async function () {
    const fixture = await deployFixture();
    const before = await fixture.token.balanceOf(await fixture.wallet.getAddress());
    const pending = await request(fixture, { amount: 2_000n, nonce: ethers.id('WALLET-ACCOUNTING') });
    await advance(31);
    await (await fixture.wallet.executeIntent(pending.intentId)).wait();
    assert.equal(await fixture.token.balanceOf(await fixture.wallet.getAddress()), before - 2_000n);
    assert.equal(await fixture.wallet.currentReserved(), 0n);
  });

  it('26. test token supply and transfer accounting remain exact', async function () {
    const fixture = await deployFixture();
    assert.equal(await fixture.token.totalSupply(), 1_000_000n);
    const aggregate = (await fixture.token.balanceOf(fixture.owner.address))
      + (await fixture.token.balanceOf(await fixture.wallet.getAddress()))
      + (await fixture.token.balanceOf(fixture.recipient.address));
    assert.equal(aggregate, 1_000_000n);
  });

  it('27. events include expected intent and policy-version evidence', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { amount: 1_500n, nonce: ethers.id('EVENT-EVIDENCE') });
    assert.equal(pending.event.args.amount, 1_500n);
    assert.equal(pending.event.args.policyVersion, 1n);
    const freezeReceipt = await (await fixture.wallet.freeze()).wait();
    const freezeEvent = parseEvent(fixture.wallet, freezeReceipt, 'WalletFrozen');
    assert.equal(freezeEvent.args.policyVersion, 2n);
  });

  it('28. controlled-time repeated request remains deterministic', async function () {
    const fixture = await deployFixture();
    const snapshot = await network.provider.send('evm_snapshot');
    const first = await request(fixture, { amount: 1_234n, nonce: ethers.id('DETERMINISTIC') });
    await network.provider.send('evm_revert', [snapshot]);
    const second = await request(fixture, { amount: 1_234n, nonce: ethers.id('DETERMINISTIC') });
    assert.equal(first.intentId, second.intentId);
    assert.equal(first.event.args.policyVersion, second.event.args.policyVersion);
  });

  it('29. insufficient wallet test-token balance rejects reservation', async function () {
    const fixture = await deployFixture({ walletFunding: 1_000n });
    await expectCustomError(() => request(fixture, { amount: 1_200n }), fixture.wallet, 'InsufficientTestFunds');
  });

  it('30. zero-address recipient cannot be approved', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => fixture.wallet.approveRecipient(ethers.ZeroAddress), fixture.wallet, 'ZeroAddress');
  });

  it('31. stale reservation can be explicitly cancelled without affecting current version', async function () {
    const fixture = await deployFixture();
    const pending = await request(fixture, { amount: 1_800n, nonce: ethers.id('STALE-CANCEL') });
    await (await fixture.wallet.freeze()).wait();
    assert.equal(await fixture.wallet.currentReserved(), 0n);
    assert.equal(await fixture.wallet.reservedByVersion(1), 1_800n);
    await (await fixture.wallet.cancelIntent(pending.intentId)).wait();
    assert.equal(await fixture.wallet.reservedByVersion(1), 0n);
  });

  it('32. agent cannot transfer wallet ownership', async function () {
    const fixture = await deployFixture();
    await expectCustomError(() => fixture.wallet.connect(fixture.agent).transferOwnership(fixture.agent.address), fixture.wallet, 'UnauthorizedOwner');
  });

  it('33. duplicate nonce remains unusable through freeze and restore', async function () {
    const fixture = await deployFixture();
    const nonce = ethers.id('NONCE-ACROSS-VERSIONS');
    await request(fixture, { nonce });
    await (await fixture.wallet.freeze()).wait();
    await expectCustomError(() => request(fixture, { nonce, version: 2n }), fixture.wallet, 'WalletIsFrozen');
    await (await fixture.wallet.restore()).wait();
    await expectCustomError(() => request(fixture, { nonce, version: 3n }), fixture.wallet, 'NonceAlreadyUsed');
  });
});
