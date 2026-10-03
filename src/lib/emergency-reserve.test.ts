import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmergencyReserveInput, createEmergencyReserveSaveController,
  decodeEmergencyReserveState, getEmergencyReserveSummary,
} from './emergency-reserve.ts';

const workspace = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const asset = '33333333-3333-4333-8333-333333333333';
const fingerprint = '0123456789abcdef0123456789abcdef';
const uuid = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
function dto(): any {
  return {
    workspace_id: workspace, workspace_name: 'Pessoal', as_of: '2026-10-03',
    config: { base_mode: 'observed', manual_monthly_cents: null, target_months: 6, edit_revision: 7 },
    sources: [{ kind: 'account', id: account, name: 'Conta', eligible: true, archived: false,
      available_cents: '10000', other_allocated_cents: '1000', allocated_cents: '8000',
      liquidity_confirmed: true, effective_cents: '8000', valuation_date: null }],
    months: [
      { month: '2026-07-01', expense_count: 2, essential_cents: '1000', unclassified_count: 0, unclassified_cents: '0', fingerprint, reviewed: true },
      { month: '2026-08-01', expense_count: 0, essential_cents: '0', unclassified_count: 0, unclassified_cents: '0', fingerprint, reviewed: true },
      { month: '2026-09-01', expense_count: 1, essential_cents: '1001', unclassified_count: 0, unclassified_cents: '0', fingerprint, reviewed: true },
    ], unassigned_goals_cents: '0',
  };
}
function draft(): any {
  return { baseMode: 'manual', manualMonthlyCents: 12345, targetMonths: 6,
    allocations: [{ kind: 'account', id: account, amountCents: 8500, liquidityConfirmed: true }],
    reviewedMonths: ['2026-09-01', '2026-07-01'], acknowledgeUnassignedGoals: false };
}
function input(): any {
  return { workspace_id: workspace, expected_revision: 7, base_mode: 'manual', manual_monthly_cents: 12345,
    target_months: 6, unassigned_goals_ack_cents: 0,
    allocations: [{ kind: 'account', id: account, amount_cents: 8500, liquidity_confirmed: true }],
    reviewed_months: [{ month: '2026-07-01', fingerprint }, { month: '2026-09-01', fingerprint }] };
}

// Catches permissive DTO decoding and precision loss before the UI sees a balance.
test('decodes only the closed DTO, preserving signed and maximum safe cents', () => {
  const raw = dto(); raw.sources[0].available_cents = '-12'; raw.sources[0].effective_cents = '0';
  raw.unassigned_goals_cents = '9007199254740991';
  const state = decodeEmergencyReserveState(raw);
  assert.equal(state.sources[0].available_cents, -12);
  assert.equal(state.unassigned_goals_cents, 9007199254740991);
  assert.equal(state.months[2].essential_cents, 1001);
  assert.notEqual(state.sources[0], raw.sources[0]);
});

const malformed: [string, (raw: any) => void][] = [
  ['unknown top field', r => { r.surprise = 1; }],
  ['unknown nested field', r => { r.sources[0].workspace_id = workspace; }],
  ['invalid workspace UUID', r => { r.workspace_id = 'another-workspace'; }],
  ['invalid source UUID', r => { r.sources[0].id = 'source'; }],
  ['wrong variant UUID', r => { r.sources[0].id = '22222222-2222-4222-1222-222222222222'; }],
  ['impossible as of', r => { r.as_of = '2026-02-30'; }],
  ['invalid valuation date', r => { r.sources[0].valuation_date = '2026-13-01'; }],
  ['numeric DTO cents', r => { r.sources[0].available_cents = 10000; }],
  ['unsafe cents', r => { r.sources[0].available_cents = '9007199254740992'; }],
  ['decimal cents', r => { r.sources[0].allocated_cents = '1.2'; }],
  ['negative allocation', r => { r.sources[0].allocated_cents = '-1'; }],
  ['duplicate source', r => { r.sources.push({ ...r.sources[0] }); }],
  ['effective exceeds plan', r => { r.sources[0].effective_cents = '8001'; }],
  ['unconfirmed source counted', r => { r.sources[0].liquidity_confirmed = false; }],
  ['archived source counted', r => { r.sources[0].archived = true; }],
  ['ineligible source counted', r => { r.sources[0].eligible = false; }],
  ['effective exceeds available', r => { r.sources[0].available_cents = '7000'; }],
  ['source total overflow', r => { r.sources[0].allocated_cents = '9007199254740991'; }],
  ['aggregate planned overflow', r => { r.sources[0].other_allocated_cents = '0'; r.sources[0].allocated_cents = '9007199254740991'; r.sources[0].effective_cents = '0'; r.sources.push({ ...r.sources[0], id: asset }); }],
  ['missing civil month', r => { r.months.pop(); }],
  ['repeated civil month', r => { r.months[1].month = '2026-07-01'; }],
  ['current open month', r => { r.months[2].month = '2026-10-01'; }],
  ['nonfirst day', r => { r.months[2].month = '2026-09-02'; }],
  ['invalid fingerprint', r => { r.months[0].fingerprint = 'not-md5'; }],
  ['fractional count', r => { r.months[0].expense_count = 1.5; }],
  ['excess unknown count', r => { r.months[0].unclassified_count = 3; }],
  ['reviewed unclassified month', r => { r.months[0].unclassified_count = 1; }],
  ['zero expense with essential', r => { r.months[0].expense_count = 0; }],
  ['zero unclassified with money', r => { r.months[0].unclassified_cents = '1'; }],
  ['unknown mode', r => { r.config.base_mode = 'automatic'; }],
  ['manual missing base', r => { r.config.base_mode = 'manual'; }],
  ['observed carries manual base', r => { r.config.manual_monthly_cents = '1'; }],
  ['zero target', r => { r.config.target_months = 0; }],
  ['excess target', r => { r.config.target_months = 61; }],
  ['negative revision', r => { r.config.edit_revision = -1; }],
];
for (const [name, change] of malformed) test(`rejects malformed state: ${name}`, () => {
  const raw = dto(); change(raw); assert.throws(() => decodeEmergencyReserveState(raw));
});

test('civil months cross years without timezone shifting', () => {
  const raw = dto(); raw.as_of = '2027-01-01';
  raw.months.forEach((m: any, i: number) => { m.month = ['2026-10-01', '2026-11-01', '2026-12-01'][i]; });
  assert.equal(decodeEmergencyReserveState(raw).months[0].month, '2026-10-01');
});

// Catches total cash being substituted for identified effective backing and floor averaging.
test('observed summary uses ceil essential mean with a reviewed zero month', () => {
  const summary = getEmergencyReserveSummary(decodeEmergencyReserveState(dto()));
  assert.deepEqual(summary, { baseStatus: 'observed', monthlyCents: 667, reservedCents: 8000,
    plannedCents: 8000, unbackedCents: 0, targetCents: 4002, missingCents: 0, coverageMonths: 8000 / 667 });
});

test('manual summary preserves cents, target and the partial backing gap', () => {
  const raw = dto(); raw.config = { base_mode: 'manual', manual_monthly_cents: '12345', target_months: 6, edit_revision: 0 };
  raw.sources[0].available_cents = '3000'; raw.sources[0].effective_cents = '2666';
  assert.deepEqual(getEmergencyReserveSummary(decodeEmergencyReserveState(raw)), {
    baseStatus: 'manual', monthlyCents: 12345, reservedCents: 2666, plannedCents: 8000,
    unbackedCents: 5334, targetCents: 74070, missingCents: 71404, coverageMonths: 2666 / 12345,
  });
});
for (const status of ['not_configured', 'unreviewed', 'incomplete_classification', 'zero_base']) test(`summary explicitly reports ${status} with no invented coverage`, () => {
  const raw = dto();
  if (status === 'not_configured') raw.config = null;
  if (status === 'unreviewed') raw.months.forEach((m: any) => { m.reviewed = false; m.essential_cents = '0'; m.expense_count = 0; });
  if (status === 'incomplete_classification') { raw.months[0].reviewed = false; raw.months[0].unclassified_count = 1; raw.months[0].unclassified_cents = '300'; }
  if (status === 'zero_base') raw.months.forEach((m: any) => { m.essential_cents = '0'; });
  const summary = getEmergencyReserveSummary(decodeEmergencyReserveState(raw));
  assert.equal(summary.baseStatus, status);
  for (const field of ['monthlyCents', 'targetCents', 'missingCents', 'coverageMonths']) assert.equal(summary[field], null);
  assert.equal(summary.reservedCents, 8000);
});
test('reclassification invalidates previously usable observed base', () => {
  const raw = dto(); raw.months[0].fingerprint = 'fedcba9876543210fedcba9876543210'; raw.months[0].reviewed = false;
  assert.equal(getEmergencyReserveSummary(decodeEmergencyReserveState(raw)).baseStatus, 'unreviewed');
});
test('summary guards target multiplication and computes huge sum without money floats', () => {
  const raw = dto(); raw.config = { base_mode: 'manual', manual_monthly_cents: '9007199254740991', target_months: 2, edit_revision: 1 };
  assert.throws(() => getEmergencyReserveSummary(decodeEmergencyReserveState(raw)));
  raw.config = { base_mode: 'observed', manual_monthly_cents: null, target_months: 1, edit_revision: 1 };
  raw.months.forEach((m: any) => { m.expense_count = 1; m.essential_cents = '9007199254740991'; });
  assert.equal(getEmergencyReserveSummary(decodeEmergencyReserveState(raw)).monthlyCents, 9007199254740991);
});

// Catches stale/foreign sources, oversubscription and invented month acknowledgments.
test('builder closes and sorts the command using the snapshot revision and fingerprints', () => {
  const raw = dto(); raw.unassigned_goals_cents = '500';
  raw.sources.push({ ...raw.sources[0], kind: 'asset', id: asset, allocated_cents: '0', effective_cents: '0', other_allocated_cents: '0' });
  const d = draft(); d.acknowledgeUnassignedGoals = true;
  d.allocations.unshift({ kind: 'asset', id: asset, amountCents: 200, liquidityConfirmed: true });
  assert.deepEqual(buildEmergencyReserveInput(decodeEmergencyReserveState(raw), d), {
    ...input(), unassigned_goals_ack_cents: 500,
    allocations: [{ kind: 'account', id: account, amount_cents: 8500, liquidity_confirmed: true }, { kind: 'asset', id: asset, amount_cents: 200, liquidity_confirmed: true }],
  });
});
test('builder permits removing all links and observed mode discards hidden manual input', () => {
  const raw = dto(); raw.config = null;
  const d = draft(); d.baseMode = 'observed'; d.manualMonthlyCents = 0; d.allocations = []; d.reviewedMonths = [];
  assert.deepEqual(buildEmergencyReserveInput(decodeEmergencyReserveState(raw), d), {
    workspace_id: workspace, expected_revision: null, base_mode: 'observed', manual_monthly_cents: null,
    target_months: 6, unassigned_goals_ack_cents: 0, allocations: [], reviewed_months: [],
  });
});
for (const [name, change] of [
  ['oversubscribed source', (d: any) => { d.allocations[0].amountCents = 9001; }],
  ['foreign source', (d: any) => { d.allocations[0].id = asset; }],
  ['duplicate source', (d: any) => { d.allocations.push({ ...d.allocations[0] }); }],
  ['zero allocation', (d: any) => { d.allocations[0].amountCents = 0; }],
  ['unsafe allocation', (d: any) => { d.allocations[0].amountCents = 9007199254740992; }],
  ['unconfirmed liquidity', (d: any) => { d.allocations[0].liquidityConfirmed = false; }],
  ['unknown review', (d: any) => { d.reviewedMonths.push('2026-06-01'); }],
  ['duplicate review', (d: any) => { d.reviewedMonths.push('2026-07-01'); }],
  ['zero manual base', (d: any) => { d.manualMonthlyCents = 0; }],
  ['target overflow', (d: any) => { d.manualMonthlyCents = 9007199254740991; }],
  ['fractional months', (d: any) => { d.targetMonths = 2.5; }],
] as [string, (d: any) => void][]) test(`builder refuses ${name}`, () => {
  const d = draft(); change(d); assert.throws(() => buildEmergencyReserveInput(decodeEmergencyReserveState(dto()), d));
});
test('builder requires acknowledgement for unidentified legacy goal funds', () => {
  const raw = dto(); raw.unassigned_goals_cents = '1';
  assert.throws(() => buildEmergencyReserveInput(decodeEmergencyReserveState(raw), draft()));
});
test('builder refuses inactive sources and months still awaiting classification', () => {
  for (const field of ['archived', 'eligible']) {
    const raw = dto(); raw.sources[0][field] = field === 'archived'; raw.sources[0].effective_cents = '0';
    assert.throws(() => buildEmergencyReserveInput(decodeEmergencyReserveState(raw), draft()));
  }
  const raw = dto(); raw.months[0].unclassified_count = 1; raw.months[0].reviewed = false;
  assert.throws(() => buildEmergencyReserveInput(decodeEmergencyReserveState(raw), draft()));
});

// Uses the real state machine; only injected dispatch is the network boundary.
test('double submit shares one promise and immutable payload until a matching receipt confirms it', async () => {
  const calls: any[] = []; const published: any[] = [];
  let resolve!: (value: unknown) => void;
  const controller = createEmergencyReserveSaveController((command: any, id: string) => {
    calls.push({ command, id }); return new Promise(r => { resolve = r; });
  }, () => uuid(1), (pending: any) => published.push(pending));
  const original = input(); const first = controller.submit(original); const second = controller.submit(input());
  assert.equal(first, second); assert.equal(calls.length, 1);
  original.allocations[0].amount_cents = 1;
  assert.equal(calls[0].command.allocations[0].amount_cents, 8500);
  assert.ok(Object.isFrozen(calls[0].command)); assert.ok(Object.isFrozen(calls[0].command.allocations[0]));
  await assert.rejects(controller.submit(original), /tentativa|confirma/i);
  resolve({ workspace_id: workspace, edit_revision: 8 });
  assert.deepEqual(await first, { workspace_id: workspace, edit_revision: 8 });
  assert.equal(published.at(-1), null);
});
test('lost response keeps intent and UUID; later SQL refusal cannot release unknown commit', async () => {
  const calls: any[] = []; const published: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async (command: any, id: string) => {
    calls.push({ command, id });
    if (calls.length === 1) throw new Error('response lost');
    if (calls.length === 2) throw { code: '22023', message: 'refused' };
    return { workspace_id: workspace, edit_revision: command.expected_revision === null ? 1 : command.expected_revision + 1 };
  }, () => uuid(++sequence), (pending: any) => published.push(pending));
  await assert.rejects(controller.submit(input()), /response lost/);
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
  assert.equal(calls.length, 2); assert.notEqual(published.at(-1), null);
  await controller.submit(input());
  assert.equal(calls[0].id, calls[2].id); assert.deepEqual(calls[0].command, input());
  await controller.submit({ ...input(), expected_revision: 8 });
  assert.notEqual(calls[3].id, calls[0].id);
});
for (const code of ['22023', '23514', '42501', 'P0001']) test(`initial definitive ${code} refusal frees corrected intent`, async () => {
  const calls: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async (command: any, id: string) => {
    calls.push({ command, id }); if (calls.length === 1) throw { code };
    return { workspace_id: workspace, edit_revision: 8 };
  }, () => uuid(++sequence));
  await assert.rejects(controller.submit(input()));
  await controller.submit({ ...input(), target_months: 9 });
  assert.notEqual(calls[0].id, calls[1].id);
});
for (const result of [null, { workspace_id: asset, edit_revision: 8 }, { workspace_id: workspace, edit_revision: 7 }, { workspace_id: workspace, edit_revision: 8, extra: true }]) test(`malformed receipt ${JSON.stringify(result)} keeps request frozen`, async () => {
  const calls: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async (command: any, id: string) => {
    calls.push({ command, id }); return calls.length === 1 ? result : { workspace_id: workspace, edit_revision: 8 };
  }, () => uuid(++sequence));
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }));
  await controller.submit(input()); assert.equal(calls[0].id, calls[1].id);
});
test('first configuration expects revision one and equivalent key ordering replays same intent', async () => {
  const calls: any[] = [];
  const controller = createEmergencyReserveSaveController(async (command: any, id: string) => {
    calls.push({ command, id }); if (calls.length === 1) throw new Error('lost');
    return { workspace_id: workspace, edit_revision: 1 };
  }, () => uuid(1));
  const command = { ...input(), expected_revision: null };
  await assert.rejects(controller.submit(command));
  const reordered = Object.fromEntries(Object.entries(command).reverse());
  assert.deepEqual(await controller.submit(reordered), { workspace_id: workspace, edit_revision: 1 });
  assert.equal(calls[0].id, calls[1].id);
});

test('builder refuses revisions whose next confirmation would be unsafe', () => {
  const raw = dto(); raw.config.edit_revision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => buildEmergencyReserveInput(decodeEmergencyReserveState(raw), draft()));
});
test('controller does not trust malformed SQLSTATE prefixes as definite rollback', async () => {
  const calls: any[] = [];
  const controller = createEmergencyReserveSaveController(async (command: any, id: string) => {
    calls.push({ command, id }); throw { code: '22', message: 'incomplete transport error' };
  }, () => uuid(1));
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
  assert.equal(calls.length, 1);
});
test('manual mode remains usable without a reviewed history or any identified backing', () => {
  const raw = dto(); raw.sources = [];
  raw.config = { base_mode: 'manual', manual_monthly_cents: '5000', target_months: 3, edit_revision: 1 };
  raw.months.forEach((m: any) => { m.expense_count = 0; m.essential_cents = '0'; m.reviewed = false; });
  assert.deepEqual(getEmergencyReserveSummary(decodeEmergencyReserveState(raw)), {
    baseStatus: 'manual', monthlyCents: 5000, reservedCents: 0, plannedCents: 0, unbackedCents: 0,
    targetCents: 15000, missingCents: 15000, coverageMonths: 0,
  });
});
test('archive or liquidity loss retains the plan but contributes zero coverage', () => {
  for (const field of ['archived', 'liquidity_confirmed']) {
    const raw = dto(); raw.sources[0][field] = field === 'archived'; raw.sources[0].effective_cents = '0';
    const summary = getEmergencyReserveSummary(decodeEmergencyReserveState(raw));
    assert.equal(summary.plannedCents, 8000); assert.equal(summary.unbackedCents, 8000);
    assert.equal(summary.reservedCents, 0); assert.equal(summary.missingCents, 4002); assert.equal(summary.coverageMonths, 0);
  }
});
test('equivalent allocation and review ordering retries the frozen canonical command', async () => {
  const command = input(); command.allocations.push({ kind: 'asset', id: asset, amount_cents: 100, liquidity_confirmed: true });
  const calls: any[] = [];
  const controller = createEmergencyReserveSaveController(async (payload: any, id: string) => {
    calls.push({ payload, id }); if (calls.length === 1) throw new Error('lost');
    return { workspace_id: workspace, edit_revision: 8 };
  }, () => uuid(1));
  await assert.rejects(controller.submit(command));
  command.allocations.reverse(); command.reviewed_months.reverse();
  await controller.submit(command);
  assert.equal(calls[0].payload, calls[1].payload);
  assert.deepEqual(calls[0].payload.allocations.map((a: any) => a.kind), ['account', 'asset']);
  assert.deepEqual(calls[0].payload.reviewed_months.map((m: any) => m.month), ['2026-07-01', '2026-09-01']);
});
test('invalid command or request identity never reaches dispatch', async () => {
  let calls = 0;
  const controller = createEmergencyReserveSaveController(async () => { calls++; return {}; }, () => 'invalid-id');
  await assert.rejects(controller.submit(input()));
  const goodIdentity = createEmergencyReserveSaveController(async () => { calls++; return {}; }, () => uuid(1));
  await assert.rejects(goodIdentity.submit({ ...input(), unknown: true }));
  await assert.rejects(goodIdentity.submit({ ...input(), allocations: [{ ...input().allocations[0], liquidity_confirmed: false }] }));
  assert.equal(calls, 0);
});

// Keeps malformed read errors at the query boundary, before a render derives summary.
test('decoder rejects a manual base whose target cannot be represented safely', () => {
  const raw = dto();
  raw.config = { base_mode: 'manual', manual_monthly_cents: '9007199254740991', target_months: 2, edit_revision: 1 };
  assert.throws(() => decodeEmergencyReserveState(raw));
});
test('decoder rejects a reviewed observed base whose target overflows', () => {
  const raw = dto(); raw.config.target_months = 2;
  raw.months.forEach((m: any) => { m.expense_count = 1; m.essential_cents = '9007199254740991'; });
  assert.throws(() => decodeEmergencyReserveState(raw));
});
for (const effective of ['2000', '2667', '3000']) test(`decoder rejects ${effective} cents instead of the exact prorated 2666 cents`, () => {
  const raw = dto(); raw.sources[0].available_cents = '3000'; raw.sources[0].effective_cents = effective;
  assert.throws(() => decodeEmergencyReserveState(raw));
});
test('decoder requires full effective allocation when a liquid eligible source has full backing', () => {
  const raw = dto(); raw.sources[0].effective_cents = '7999';
  assert.throws(() => decodeEmergencyReserveState(raw));
});
test('decoder computes prorated backing with integer arithmetic near the safe maximum', () => {
  const raw = dto();
  raw.sources[0].available_cents = '9007199254740990';
  raw.sources[0].allocated_cents = '4503599627370495';
  raw.sources[0].other_allocated_cents = '4503599627370496';
  raw.sources[0].effective_cents = '4503599627370494';
  const state = decodeEmergencyReserveState(raw);
  assert.equal(getEmergencyReserveSummary(state).reservedCents, 4503599627370494);
  raw.sources[0].effective_cents = '4503599627370495';
  assert.throws(() => decodeEmergencyReserveState(raw));
});
test('zero allocation and lost eligibility have exact zero effective backing', () => {
  const raw = dto(); raw.sources[0].allocated_cents = '0'; raw.sources[0].other_allocated_cents = '0'; raw.sources[0].effective_cents = '0';
  assert.equal(getEmergencyReserveSummary(decodeEmergencyReserveState(raw)).reservedCents, 0);
  raw.sources[0].effective_cents = '1'; assert.throws(() => decodeEmergencyReserveState(raw));
});

// Known transaction rollbacks allow a corrected draft; unknown commits never do.
for (const code of ['40001', '40P01']) test(`initial ${code} rollback releases the draft and request identity`, async () => {
  const calls: any[] = []; const published: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async (command: any, requestId: string) => {
    calls.push({ command, requestId });
    if (calls.length === 1) throw { code, message: 'transaction rolled back' };
    return { workspace_id: workspace, edit_revision: command.expected_revision + 1 };
  }, () => uuid(++sequence), (pending: any) => published.push(pending));
  await assert.rejects(controller.submit(input()));
  assert.equal(published.at(-1), null, 'known rollback must release the editor');
  const corrected = { ...input(), expected_revision: 8, target_months: 9 };
  assert.deepEqual(await controller.submit(corrected), { workspace_id: workspace, edit_revision: 9 });
  assert.notEqual(calls[0].requestId, calls[1].requestId);
  assert.equal(calls[1].command.target_months, 9);
});
for (const code of ['40001', '40P01']) test(`a ${code} rollback after response loss retains the original attempt until receipt`, async () => {
  const calls: any[] = []; const published: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async (command: any, requestId: string) => {
    calls.push({ command, requestId });
    if (calls.length === 1) throw new Error('response lost');
    if (calls.length === 2) throw { code, message: 'retry transaction rolled back' };
    return { workspace_id: workspace, edit_revision: 8 };
  }, () => uuid(++sequence), (pending: any) => published.push(pending));
  await assert.rejects(controller.submit(input()), /response lost/);
  await assert.rejects(controller.submit(input()));
  assert.notEqual(published.at(-1), null, 'a retry rollback cannot disprove an earlier commit');
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
  assert.equal(calls.length, 2);
  assert.deepEqual(await controller.submit(input()), { workspace_id: workspace, edit_revision: 8 });
  assert.equal(calls[0].requestId, calls[2].requestId);
  assert.equal(calls[0].command, calls[2].command);
  assert.ok(Object.isFrozen(calls[2].command.allocations[0]));
  assert.equal(published.at(-1), null);
});
for (const code of ['40003', '40000', '40ZZZ', '40001extra']) test(`unproven ${code} refusal never releases an unknown commit`, async () => {
  let calls = 0;
  const controller = createEmergencyReserveSaveController(async () => { calls++; throw { code }; }, () => uuid(1));
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
  assert.equal(calls, 1);
});

for (const code of ['40001', 'PT409']) test(`sealed-first ${code} CAS refusal disproves this request commit even after an earlier transport timeout`, async () => {
  const calls: any[] = []; const published: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async (command: any, requestId: string) => {
    calls.push({ command, requestId });
    if (calls.length === 1) throw new Error('response lost');
    if (calls.length === 2) throw { code, message: 'Reserva alterada; confira novamente' };
    return { workspace_id: workspace, edit_revision: command.expected_revision + 1 };
  }, () => uuid(++sequence), (pending: any) => published.push(pending));
  await assert.rejects(controller.submit(input()), /response lost/);
  await assert.rejects(controller.submit(input()));
  assert.equal(published.at(-1), null, 'the command checked the sealed receipt under its lock before CAS');
  const corrected = { ...input(), expected_revision: 8 };
  await controller.submit(corrected);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.notEqual(calls[1].requestId, calls[2].requestId);
});

test('terminal resolution frees an unknown intent after sources change without a reserve revision', async () => {
  let sequence = 0; const calls: any[] = []; const published: any[] = [];
  const controller = createEmergencyReserveSaveController(async (command: any, requestId: string) => {
    calls.push({ mode: 'save', command, requestId });
    if (calls.length === 1) throw new Error('response lost');
    if (calls.length === 2) throw { code: '22023', message: 'Metas sem origem mudaram; confira novamente' };
    return { workspace_id: workspace, edit_revision: 8 };
  }, () => uuid(++sequence), value => published.push(value), async (command: any, requestId: string) => {
    calls.push({ mode: 'resolve', command, requestId });
    return { workspace_id: workspace, cancelled: true };
  });
  await assert.rejects(controller.submit(input()), /response lost/);
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
  await assert.rejects(controller.resolve(), { name: 'EmergencyReserveAttemptCancelledError' });
  assert.equal(calls[2].requestId, calls[0].requestId);
  assert.equal(calls[2].command, calls[0].command);
  assert.equal(published.at(-1), null);
  await controller.submit({ ...input(), target_months: 9, unassigned_goals_ack_cents: 100 });
  assert.notEqual(calls[3].requestId, calls[0].requestId);
});

test('resolution recovers a successful sealed receipt without repeating the write', async () => {
  const calls: any[] = []; const published: any[] = [];
  const controller = createEmergencyReserveSaveController(async (command: any, requestId: string) => {
    calls.push({ command, requestId }); throw new Error('response lost');
  }, () => uuid(1), value => published.push(value), async (command: any, requestId: string) => {
    calls.push({ command, requestId }); return { workspace_id: workspace, edit_revision: 8 };
  });
  await assert.rejects(controller.submit(input()));
  assert.deepEqual(await controller.resolve(), { workspace_id: workspace, edit_revision: 8 });
  assert.equal(calls[1].requestId, calls[0].requestId);
  assert.equal(calls[1].command, calls[0].command);
  assert.equal(published.at(-1), null);
});

test('resolution lost response retains the intent and shares one in-flight operation', async () => {
  const calls: any[] = []; let sequence = 0; let finish!: (result: any) => void;
  const controller = createEmergencyReserveSaveController(async () => { throw new Error('response lost'); },
    () => uuid(++sequence), undefined, (command: any, requestId: string) => {
      calls.push({ command, requestId });
      if (calls.length === 1) return Promise.reject(new Error('resolution response lost'));
      return new Promise(resolve => { finish = resolve; });
    });
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.resolve(), /resolution response lost/);
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
  const first = controller.resolve(); const second = controller.resolve();
  assert.equal(first, second);
  assert.equal(controller.submit(input()), first, 'save cannot race with its terminal resolution');
  assert.equal(calls[0].requestId, calls[1].requestId); assert.equal(sequence, 1);
  finish({ workspace_id: workspace, cancelled: true });
  await assert.rejects(first, { name: 'EmergencyReserveAttemptCancelledError' });
});

for (const receipt of [null, { workspace_id: asset, cancelled: true },
  { workspace_id: workspace, cancelled: false }, { workspace_id: workspace, cancelled: true, edit_revision: 8 },
  { workspace_id: workspace, cancelled: true, extra: 1 }]) test(`unproven cancellation ${JSON.stringify(receipt)} cannot release the intent`, async () => {
  const controller = createEmergencyReserveSaveController(async () => { throw new Error('response lost'); },
    () => uuid(1), undefined, async () => receipt);
  await assert.rejects(controller.submit(input()));
  await assert.rejects(controller.resolve());
  await assert.rejects(controller.submit({ ...input(), target_months: 9 }), /tentativa|confirma/i);
});

test('a delayed save returning its sealed cancellation releases the request rather than inventing success', async () => {
  const published: any[] = []; let sequence = 0;
  const controller = createEmergencyReserveSaveController(async command => sequence === 1
    ? { workspace_id: workspace, cancelled: true }
    : { workspace_id: workspace, edit_revision: (command.expected_revision ?? 0) + 1 },
  () => uuid(++sequence), value => published.push(value));
  await assert.rejects(controller.submit(input()), { name: 'EmergencyReserveAttemptCancelledError' });
  assert.equal(published.at(-1), null);
  assert.equal((await controller.submit({ ...input(), target_months: 9 })).edit_revision, 8);
});
