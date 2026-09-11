import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer } from '../src/timer.js';
import { watchCompletion } from '../src/completion.js';
import {
  SESSION_KEY,
  loadSession,
  clearSession,
  persistTimer,
  createPersistedTimer,
} from '../src/session.js';

const DURATION = 25 * 60 * 1000;

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

// Map-backed stand-in for localStorage exposing the three methods used.
function makeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

// A storage whose every method throws, as a disabled or full store does.
function makeBrokenStorage() {
  const boom = () => {
    throw new Error('storage unavailable');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const stored = (storage) => JSON.parse(storage.map.get(SESSION_KEY));

const seed = (storage, record) =>
  storage.setItem(SESSION_KEY, JSON.stringify({ version: 1, ...record }));

test('loadSession returns null when nothing is stored', () => {
  assert.equal(loadSession(makeStorage()), null);
});

test('loadSession returns null for unparsable or non-object JSON', () => {
  for (const raw of ['{not json', 'null', '1', '"str"', 'true']) {
    assert.equal(loadSession(makeStorage({ [SESSION_KEY]: raw })), null, raw);
  }
});

test('loadSession returns null for a missing or different version', () => {
  const noVersion = makeStorage({ [SESSION_KEY]: JSON.stringify({ durationMs: 1000 }) });
  assert.equal(loadSession(noVersion), null);
  const oldVersion = makeStorage({ [SESSION_KEY]: JSON.stringify({ version: 0, durationMs: 1000 }) });
  assert.equal(loadSession(oldVersion), null);
});

test('loadSession and clearSession tolerate a throwing or missing storage', () => {
  assert.equal(loadSession(makeBrokenStorage()), null);
  assert.equal(loadSession(undefined), null);
  assert.doesNotThrow(() => clearSession(makeBrokenStorage()));
  assert.doesNotThrow(() => clearSession(undefined));
});

test('persistTimer mirrors start, pause, done and reset into storage', () => {
  const clock = makeClock(1000);
  const storage = makeStorage();
  const timer = createTimer({ durationMs: 5000, now: clock.now });
  persistTimer(timer, storage);
  assert.equal(storage.map.has(SESSION_KEY), false, 'idle is never written');

  timer.start();
  assert.deepEqual(stored(storage), {
    version: 1,
    durationMs: 5000,
    status: 'running',
    accumulatedMs: 0,
    startedAt: 1000,
  });

  clock.advance(2000);
  timer.pause();
  assert.deepEqual(stored(storage), {
    version: 1,
    durationMs: 5000,
    status: 'paused',
    accumulatedMs: 2000,
    startedAt: null,
  });

  timer.start();
  clock.advance(3000);
  timer.tick();
  assert.deepEqual(stored(storage), {
    version: 1,
    durationMs: 5000,
    status: 'done',
    accumulatedMs: 5000,
    startedAt: null,
  });

  timer.reset();
  assert.equal(storage.map.has(SESSION_KEY), false, 'reset erases the record');
});

test('persistTimer returns an unsubscribe that stops mirroring', () => {
  const storage = makeStorage();
  const timer = createTimer({ durationMs: 5000, now: makeClock().now });
  const unsubscribe = persistTimer(timer, storage);
  unsubscribe();
  timer.start();
  assert.equal(storage.map.has(SESSION_KEY), false);
});

test('createPersistedTimer starts fresh when nothing is stored', () => {
  const storage = makeStorage();
  const timer = createPersistedTimer({ durationMs: DURATION, now: makeClock().now, storage });
  assert.deepEqual(timer.getState(), { status: 'idle', remainingMs: DURATION, durationMs: DURATION });
  assert.equal(storage.map.has(SESSION_KEY), false);
});

test('a restored running session accounts for the time that passed while closed', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: DURATION, status: 'running', accumulatedMs: 2000, startedAt: 10_000 });
  const clock = makeClock(15_000);
  const timer = createPersistedTimer({ durationMs: DURATION, now: clock.now, storage });
  const state = timer.getState();
  assert.equal(state.status, 'running');
  assert.equal(state.remainingMs, DURATION - 7000);
  clock.advance(1000);
  assert.equal(timer.tick().remainingMs, DURATION - 8000);
  assert.equal(stored(storage).status, 'running', 'the record is left as it was');
});

test('a restored paused session shows the same remaining time however long it was closed', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: DURATION, status: 'paused', accumulatedMs: 90_000, startedAt: null });
  const clock = makeClock(10_000_000_000);
  const timer = createPersistedTimer({ durationMs: DURATION, now: clock.now, storage });
  assert.deepEqual(timer.getState(), {
    status: 'paused',
    remainingMs: DURATION - 90_000,
    durationMs: DURATION,
  });
  clock.advance(60 * 60 * 1000);
  assert.equal(timer.tick().remainingMs, DURATION - 90_000);
  timer.start();
  clock.advance(1000);
  assert.equal(timer.tick().remainingMs, DURATION - 91_000);
});

test('a running session that ran out while closed restores as done at zero', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: 1000, status: 'running', accumulatedMs: 0, startedAt: 0 });
  const timer = createPersistedTimer({ durationMs: 1000, now: makeClock(5000).now, storage });
  assert.deepEqual(timer.getState(), { status: 'done', remainingMs: 0, durationMs: 1000 });
  assert.equal(stored(storage).status, 'done', 'the record is rewritten as done');
});

test('completion wired after restore does not fire for a session that ran out while closed', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: 1000, status: 'running', accumulatedMs: 0, startedAt: 0 });
  const timer = createPersistedTimer({ durationMs: 1000, now: makeClock(5000).now, storage });
  let calls = 0;
  watchCompletion(timer, () => calls++);
  timer.tick();
  timer.tick();
  assert.equal(calls, 0);
});

test('completion wired after restore still fires when a restored session runs out on this page', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: 1000, status: 'running', accumulatedMs: 0, startedAt: 0 });
  const clock = makeClock(400);
  const timer = createPersistedTimer({ durationMs: 1000, now: clock.now, storage });
  let calls = 0;
  watchCompletion(timer, () => calls++);
  assert.equal(timer.getState().status, 'running');
  clock.advance(600);
  timer.tick();
  timer.tick();
  assert.equal(calls, 1);
});

test('a restored done session shows zero and stays done until reset', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: 1000, status: 'done', accumulatedMs: 1000, startedAt: null });
  const timer = createPersistedTimer({ durationMs: 1000, now: makeClock().now, storage });
  assert.deepEqual(timer.getState(), { status: 'done', remainingMs: 0, durationMs: 1000 });
  timer.start();
  assert.equal(timer.getState().status, 'done');
  assert.equal(stored(storage).status, 'done');
});

test('reset erases the record and the next load starts fresh', () => {
  const storage = makeStorage();
  const clock = makeClock();
  const first = createPersistedTimer({ durationMs: DURATION, now: clock.now, storage });
  first.start();
  clock.advance(5000);
  assert.equal(stored(storage).status, 'running');
  first.reset();
  assert.equal(storage.map.has(SESSION_KEY), false);

  const second = createPersistedTimer({ durationMs: DURATION, now: clock.now, storage });
  assert.deepEqual(second.getState(), { status: 'idle', remainingMs: DURATION, durationMs: DURATION });
});

test('the restored timer keeps mirroring later changes', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: DURATION, status: 'running', accumulatedMs: 0, startedAt: 0 });
  const clock = makeClock(4000);
  const timer = createPersistedTimer({ durationMs: DURATION, now: clock.now, storage });
  timer.pause();
  assert.deepEqual(stored(storage), {
    version: 1,
    durationMs: DURATION,
    status: 'paused',
    accumulatedMs: 4000,
    startedAt: null,
  });
});

test('a startedAt in the future is re-based to now so the timer does not stall', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: DURATION, status: 'running', accumulatedMs: 3000, startedAt: 500_000 });
  const clock = makeClock(100_000);
  const timer = createPersistedTimer({ durationMs: DURATION, now: clock.now, storage });
  assert.equal(timer.getState().remainingMs, DURATION - 3000);
  clock.advance(1000);
  assert.equal(timer.tick().remainingMs, DURATION - 4000);
});

test('a record for a different duration is dropped and the URL duration wins', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: 60_000, status: 'running', accumulatedMs: 0, startedAt: 0 });
  const timer = createPersistedTimer({ durationMs: DURATION, now: makeClock(1000).now, storage });
  assert.deepEqual(timer.getState(), { status: 'idle', remainingMs: DURATION, durationMs: DURATION });
  assert.equal(storage.map.has(SESSION_KEY), false, 'the mismatched record is cleared');
});

test('damaged records start fresh and are cleared', () => {
  const damaged = [
    '{not json',
    'null',
    JSON.stringify({ durationMs: DURATION, status: 'paused', accumulatedMs: 1 }),
    JSON.stringify({ version: 2, durationMs: DURATION, status: 'paused', accumulatedMs: 1 }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'sleeping', accumulatedMs: 1 }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'idle', accumulatedMs: 0 }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'paused', accumulatedMs: -5 }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'paused', accumulatedMs: DURATION + 1 }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'paused', accumulatedMs: '10' }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'running', accumulatedMs: 0 }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'running', accumulatedMs: 0, startedAt: 'x' }),
    JSON.stringify({ version: 1, durationMs: DURATION, status: 'done', accumulatedMs: 10 }),
    JSON.stringify({ version: 1, durationMs: String(DURATION), status: 'paused', accumulatedMs: 10 }),
  ];
  for (const raw of damaged) {
    const storage = makeStorage({ [SESSION_KEY]: raw });
    const timer = createPersistedTimer({ durationMs: DURATION, now: makeClock(1000).now, storage });
    assert.deepEqual(
      timer.getState(),
      { status: 'idle', remainingMs: DURATION, durationMs: DURATION },
      raw
    );
    assert.equal(storage.map.has(SESSION_KEY), false, `cleared: ${raw}`);
  }
});

test('a storage that throws never breaks the timer', () => {
  const clock = makeClock();
  let timer;
  assert.doesNotThrow(() => {
    timer = createPersistedTimer({ durationMs: 1000, now: clock.now, storage: makeBrokenStorage() });
  });
  assert.doesNotThrow(() => timer.start());
  clock.advance(300);
  assert.doesNotThrow(() => timer.pause());
  assert.equal(timer.getState().remainingMs, 700);
  assert.doesNotThrow(() => timer.reset());
  assert.doesNotThrow(() => timer.start());
  clock.advance(1000);
  assert.equal(timer.tick().status, 'done');
});

test('a missing storage (no localStorage at all) never breaks the timer', () => {
  const clock = makeClock();
  const timer = createPersistedTimer({ durationMs: 1000, now: clock.now, storage: undefined });
  timer.start();
  clock.advance(250);
  timer.pause();
  assert.equal(timer.getState().remainingMs, 750);
  timer.reset();
  assert.equal(timer.getState().status, 'idle');
});

test('createPersistedTimer re-throws errors that are not a damaged record', () => {
  const storage = makeStorage();
  seed(storage, { durationMs: 1000, status: 'running', accumulatedMs: 0, startedAt: 0 });
  assert.throws(
    () => createPersistedTimer({ durationMs: 1000, now: 'not a function', storage }),
    TypeError
  );
});
