import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, formatRemaining } from '../src/timer.js';

const DURATION = 25 * 60 * 1000;

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    rewind: (ms) => {
      t -= ms;
    },
  };
}

test('starts idle with the full duration', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  assert.deepEqual(timer.getState(), {
    status: 'idle',
    remainingMs: DURATION,
    durationMs: DURATION,
  });
});

test('start then advancing 1000 ms yields durationMs - 1000 remaining', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  timer.start();
  clock.advance(1000);
  const state = timer.tick();
  assert.equal(state.status, 'running');
  assert.equal(state.remainingMs, DURATION - 1000);
});

test('pause freezes the remaining time', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  timer.start();
  clock.advance(2000);
  timer.pause();
  clock.advance(60_000);
  const state = timer.tick();
  assert.equal(state.status, 'paused');
  assert.equal(state.remainingMs, DURATION - 2000);
});

test('resume continues from the paused value', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  timer.start();
  clock.advance(2000);
  timer.pause();
  clock.advance(60_000);
  timer.start();
  clock.advance(1000);
  const state = timer.tick();
  assert.equal(state.status, 'running');
  assert.equal(state.remainingMs, DURATION - 3000);
});

test('reset returns to idle with the full duration', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  timer.start();
  clock.advance(5000);
  timer.reset();
  assert.deepEqual(timer.getState(), {
    status: 'idle',
    remainingMs: DURATION,
    durationMs: DURATION,
  });
});

test('reaching 0 sets done and remaining never goes negative', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  timer.start();
  clock.advance(DURATION + 5000);
  const state = timer.tick();
  assert.equal(state.status, 'done');
  assert.equal(state.remainingMs, 0);
});

test('completion notifies subscribers exactly once', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  const seen = [];
  timer.subscribe((state) => seen.push(state.status));
  timer.start();
  clock.advance(1000);
  timer.tick();
  timer.tick();
  timer.tick();
  assert.deepEqual(seen, ['running', 'done']);
});

test('start after done is a no-op until reset', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  timer.start();
  clock.advance(1000);
  timer.tick();
  timer.start();
  assert.equal(timer.getState().status, 'done');
  timer.reset();
  timer.start();
  clock.advance(400);
  assert.equal(timer.tick().remainingMs, 600);
});

test('pause and reset are no-ops in states they do not apply to', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  timer.pause();
  assert.equal(timer.getState().status, 'idle');
  timer.reset();
  assert.equal(timer.getState().status, 'idle');
});

test('a clock that moves backwards does not extend the remaining time', () => {
  const clock = makeClock(10_000);
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  timer.start();
  clock.rewind(5000);
  assert.equal(timer.tick().remainingMs, DURATION);
});

test('subscribe emits frozen snapshots and unsubscribe stops delivery', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  const seen = [];
  const unsubscribe = timer.subscribe((state) => seen.push(state));
  timer.start();
  assert.equal(seen.length, 1);
  assert.ok(Object.isFrozen(seen[0]));
  unsubscribe();
  timer.pause();
  assert.equal(seen.length, 1);
});

test('a throwing subscriber does not stop the others', (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  const seen = [];
  timer.subscribe(() => {
    throw new Error('boom');
  });
  timer.subscribe((state) => seen.push(state.status));
  timer.start();
  assert.deepEqual(seen, ['running']);
  assert.equal(errors.mock.callCount(), 1);
});

test('createTimer rejects a zero, negative, or missing duration', () => {
  assert.throws(() => createTimer({ durationMs: 0 }), RangeError);
  assert.throws(() => createTimer({ durationMs: -1 }), RangeError);
  assert.throws(() => createTimer(), RangeError);
});

test('formatRemaining rounds up and pads to MM:SS', () => {
  assert.equal(formatRemaining(1), '00:01');
  assert.equal(formatRemaining(0), '00:00');
  assert.equal(formatRemaining(999), '00:01');
  assert.equal(formatRemaining(1000), '00:01');
  assert.equal(formatRemaining(1001), '00:02');
  assert.equal(formatRemaining(59_999), '01:00');
  assert.equal(formatRemaining(1_500_000), '25:00');
  assert.equal(formatRemaining(3_599_999), '60:00');
});

test('serialize exposes the engine state and createTimer round-trips it', () => {
  const clock = makeClock(1000);
  const timer = createTimer({ durationMs: DURATION, now: clock.now });
  assert.deepEqual(timer.serialize(), {
    durationMs: DURATION,
    status: 'idle',
    accumulatedMs: 0,
    startedAt: null,
  });

  timer.start();
  clock.advance(2000);
  assert.deepEqual(timer.serialize(), {
    durationMs: DURATION,
    status: 'running',
    accumulatedMs: 0,
    startedAt: 1000,
  });

  timer.pause();
  assert.deepEqual(timer.serialize(), {
    durationMs: DURATION,
    status: 'paused',
    accumulatedMs: 2000,
    startedAt: null,
  });

  for (const status of ['idle', 'running', 'paused']) {
    const source = createTimer({ durationMs: DURATION, now: clock.now });
    if (status !== 'idle') source.start();
    if (status === 'paused') source.pause();
    const copy = createTimer({ ...source.serialize(), now: clock.now });
    assert.deepEqual(copy.serialize(), source.serialize());
    assert.deepEqual(copy.getState(), source.getState());
  }
});

test('a restored running timer counts the time that passed since startedAt', () => {
  const clock = makeClock(10_000);
  const timer = createTimer({
    durationMs: DURATION,
    now: clock.now,
    status: 'running',
    accumulatedMs: 2000,
    startedAt: 5000,
  });
  assert.equal(timer.tick().remainingMs, DURATION - 7000);
  clock.advance(1000);
  assert.equal(timer.tick().remainingMs, DURATION - 8000);
});

test('a restored running timer past its end becomes done on the first tick', () => {
  const clock = makeClock(DURATION + 100);
  const timer = createTimer({
    durationMs: DURATION,
    now: clock.now,
    status: 'running',
    accumulatedMs: 0,
    startedAt: 0,
  });
  const state = timer.tick();
  assert.equal(state.status, 'done');
  assert.equal(state.remainingMs, 0);
  assert.deepEqual(timer.serialize(), {
    durationMs: DURATION,
    status: 'done',
    accumulatedMs: DURATION,
    startedAt: null,
  });
});

test('a restored done timer round-trips and stays done until reset', () => {
  const clock = makeClock();
  const timer = createTimer({
    durationMs: 1000,
    now: clock.now,
    status: 'done',
    accumulatedMs: 1000,
  });
  assert.deepEqual(timer.getState(), { status: 'done', remainingMs: 0, durationMs: 1000 });
  timer.start();
  assert.equal(timer.getState().status, 'done');
  timer.reset();
  assert.deepEqual(timer.serialize(), {
    durationMs: 1000,
    status: 'idle',
    accumulatedMs: 0,
    startedAt: null,
  });
});

test('startedAt is dropped when the seeded status is not running', () => {
  const timer = createTimer({ durationMs: 1000, status: 'paused', accumulatedMs: 250, startedAt: 99 });
  assert.equal(timer.serialize().startedAt, null);
  assert.equal(timer.getState().remainingMs, 750);
});

test('createTimer rejects seeded state that breaks the engine invariants', () => {
  const seed = (extra) => () => createTimer({ durationMs: 1000, ...extra });
  assert.throws(seed({ status: 'sleeping' }), RangeError);
  assert.throws(seed({ status: 5 }), RangeError);
  assert.throws(seed({ status: 'paused', accumulatedMs: -1 }), RangeError);
  assert.throws(seed({ status: 'paused', accumulatedMs: 1001 }), RangeError);
  assert.throws(seed({ status: 'paused', accumulatedMs: '500' }), RangeError);
  assert.throws(seed({ status: 'paused', accumulatedMs: NaN }), RangeError);
  assert.throws(seed({ status: 'idle', accumulatedMs: 1 }), RangeError);
  assert.throws(seed({ status: 'done', accumulatedMs: 999 }), RangeError);
  assert.throws(seed({ status: 'running', accumulatedMs: 0 }), RangeError);
  assert.throws(seed({ status: 'running', accumulatedMs: 0, startedAt: '12' }), RangeError);
  assert.throws(seed({ status: 'running', accumulatedMs: 0, startedAt: Infinity }), RangeError);
});

test('pausing after expiry but before a tick clamps to the duration and round-trips', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  timer.start();
  clock.advance(1500);
  timer.pause();
  assert.deepEqual(timer.getState(), { status: 'paused', remainingMs: 0, durationMs: 1000 });
  const record = timer.serialize();
  assert.equal(record.accumulatedMs, 1000);
  const copy = createTimer({ ...record, now: clock.now });
  assert.equal(copy.getState().remainingMs, 0);
  copy.start();
  assert.equal(copy.tick().status, 'done');
});
