export const CORE_LAYERS = Object.freeze(['identity', 'intent', 'limits', 'risk']);

const RULE_LAYER = Object.freeze({
  AGENT_EXISTS: 'identity',
  AGENT_NOT_FROZEN: 'identity',
  POLICY_VERSION_CURRENT: 'identity',
  NONCE_UNIQUE: 'identity',
  TASK_MATCHES_CAPSULE: 'intent',
  CAPSULE_NOT_EXPIRED: 'intent',
  RECIPIENT_ALLOWLISTED: 'intent',
  CATEGORY_MATCHES: 'intent',
  AMOUNT_POSITIVE: 'limits',
  PER_TRANSACTION_LIMIT: 'limits',
  CUMULATIVE_BUDGET: 'limits',
  EVASION_SHIELD: 'risk',
  RISK_GOVERNOR: 'risk',
  FINAL_SETTLEMENT_REVALIDATION: 'wallet',
  OWNER_CONTROLLED_FREEZE: 'all',
});

export function coreLayerForRule(rule) {
  return RULE_LAYER[rule] ?? 'intent';
}

export function flowForDecision(decision) {
  if (decision === 'APPROVE') return 'approved';
  if (decision === 'HOLD' || decision === 'REQUIRE_APPROVAL') return 'pending';
  if (decision === 'INVALIDATE') return 'invalidated';
  if (decision === 'FREEZE') return 'frozen';
  if (decision === 'BLOCK') return 'blocked';
  return 'idle';
}

export function visualStateForRisk(riskState) {
  const value = String(riskState ?? 'NORMAL').toUpperCase();
  return ['NORMAL', 'CAUTION', 'RESTRICTED', 'QUARANTINED', 'FROZEN'].includes(value)
    ? value.toLowerCase()
    : 'normal';
}

export function createCoreVisualState(result = null, fallbackRiskState = 'NORMAL') {
  const decision = result?.decision ?? null;
  const flow = flowForDecision(decision);
  const failingLayer = decision === 'BLOCK'
    ? coreLayerForRule(result.ruleChecked)
    : decision === 'INVALIDATE' ? 'wallet'
      : decision === 'FREEZE' ? 'all' : 'none';
  const risk = visualStateForRisk(result?.riskState ?? fallbackRiskState);
  return {
    flow,
    risk,
    failingLayer,
    decisiveRule: result?.ruleChecked ?? 'AWAITING_TRANSACTION_INTENT',
    walletReachable: decision === 'APPROVE',
    walletGate: decision === 'INVALIDATE' || decision === 'FREEZE' ? 'closed' : flow === 'pending' ? 'open-unsettled' : 'open',
    rings: Object.fromEntries(CORE_LAYERS.map(layer => [layer,
      decision === 'FREEZE' ? 'locked'
        : failingLayer === layer ? 'failed'
          : ['APPROVE', 'HOLD', 'REQUIRE_APPROVAL', 'INVALIDATE'].includes(decision) ? 'passed' : 'idle',
    ])),
  };
}

export function createEvasionClusterModel(intents, result) {
  const ordered = [...(intents ?? [])].sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
  const total = ordered.reduce((sum, intent) => sum + Number(intent.amount || 0), 0);
  const first = ordered.at(0);
  const last = ordered.at(-1);
  const windowSeconds = first && last
    ? Math.round((new Date(last.requestedAt).getTime() - new Date(first.requestedAt).getTime()) / 1_000)
    : 0;
  return {
    intents: ordered.map(intent => ({ id: intent.id, amount: intent.amount, recipient: intent.recipient, requestedAt: intent.requestedAt })),
    total,
    windowSeconds,
    decisiveRule: result?.ruleChecked ?? 'EVASION_SHIELD',
    decision: result?.decision ?? 'BLOCK',
    fundsMoved: result?.fundsMoved ?? 0,
  };
}

export function createTwinReplayModel(results) {
  const legacy = results.legacy.attacks;
  const hardened = results.hardened.attacks;
  let legacyMoved = 0;
  let hardenedMoved = 0;
  const stages = legacy.map((left, index) => {
    const right = hardened[index];
    legacyMoved += left.fundsMoved;
    hardenedMoved += right.fundsMoved;
    return {
      index,
      name: left.name,
      legacy: { decision: left.finalDecision, bypassed: left.attackSucceeded, fundsMoved: left.fundsMoved, cumulativeMoved: legacyMoved },
      hardened: { decision: right.finalDecision, bypassed: right.attackSucceeded, fundsMoved: right.fundsMoved, cumulativeMoved: hardenedMoved },
      cumulativeLossPrevented: legacyMoved - hardenedMoved,
    };
  });
  return {
    stages,
    legacyBypassed: results.legacy.attacksSucceeded,
    hardenedBypassed: results.hardened.attacksSucceeded,
    totalAttacks: legacy.length,
    legacyMoved,
    hardenedMoved,
    lossPrevented: legacyMoved - hardenedMoved,
  };
}

export function createIncidentStages(ledger) {
  const definitions = [
    ['valid-payment', 'VALID PAYMENT', event => event.decision === 'APPROVE' && event.finalSettlementStatus === 'SETTLED'],
    ['policy-violation', 'FIRST POLICY VIOLATION', event => event.decision === 'BLOCK'],
    ['evasion-sequence', 'EVASION SEQUENCE', event => event.ruleChecked === 'EVASION_SHIELD'],
    ['risk-escalation', 'RISK ESCALATION', event => !['NORMAL', 'FROZEN'].includes(event.riskState)],
    ['owner-freeze', 'OWNER FREEZE', event => event.eventType === 'OWNER_ACTION' && event.decision === 'FREEZE'],
    ['pending-invalidation', 'PENDING INVALIDATION', event => event.decision === 'INVALIDATE'],
  ];
  return definitions.map(([id, label, predicate]) => {
    const index = ledger.findIndex(predicate);
    const event = index >= 0 ? ledger[index] : null;
    return { id, label, index, event, available: Boolean(event) };
  });
}
