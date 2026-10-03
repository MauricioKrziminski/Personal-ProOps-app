import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Exercise the runner itself. The transport alone is replaced so no test can connect or commit.
const harness = String.raw`
import json, runpy, sys, types
events = []
class Cursor:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, *args, **kwargs): events.append(["execute", sql])
    def fetchone(self): return [123]
class Connection:
    closed = False
    info = types.SimpleNamespace(transaction_status=2)
    def __setattr__(self, name, value):
        if name == "isolation_level": events.append(["isolation", value])
        object.__setattr__(self, name, value)
    def cursor(self): return Cursor()
    def add_notice_handler(self, handler): pass
    def rollback(self): events.append(["rollback"])
    def close(self): events.append(["close"]); self.closed = True
def connect(*args, **kwargs):
    events.append(["connect", kwargs.get("autocommit")])
    return Connection()
sys.modules["psycopg"] = types.SimpleNamespace(
    connect=connect,
    IsolationLevel=types.SimpleNamespace(REPEATABLE_READ="repeatable-read"),
    pq=types.SimpleNamespace(TransactionStatus=types.SimpleNamespace(INERROR=3)),
)
sys.argv = [sys.argv[1], *sys.argv[2:]]
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
finally:
    print("EVENTS=" + json.dumps(events))
`;

function run(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'proops-sql-isolation-'));
  const file = join(dir, 'fixture.sql');
  writeFileSync(file, 'select 42;');
  try {
    const result = spawnSync('python3', ['-c', harness, resolve('scripts/sql-test.py'), file, ...args], { encoding: 'utf8' });
    const eventsLine = result.stdout.split('\n').find((line) => line.startsWith('EVENTS='));
    return { ...result, events: JSON.parse(eventsLine?.slice(7) ?? '[]') as unknown[][] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('SQL preview tests start with repeatable read before the runner acquires its transaction id', () => {
  const result = run(['--repeatable-read']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events.slice(0, 3), [
    ['connect', false], ['isolation', 'repeatable-read'], ['execute', "set local timezone to 'America/Sao_Paulo'"],
  ]);
  assert.deepEqual(result.events.slice(-2), [['rollback'], ['close']]);
});

test('default SQL tests retain their existing isolation and always roll back', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.events.some(([event]) => event === 'isolation'));
  assert.deepEqual(result.events.slice(-2), [['rollback'], ['close']]);
});

test('unknown SQL runner flags fail before any connection', () => {
  const result = run(['--commit']);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.events, []);
});
