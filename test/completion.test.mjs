import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer } from '../src/timer.js';
import { watchCompletion, makeOnDone } from '../src/completion.js';

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

test('running to done fires the handler exactly once despite repeated ticks', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  let calls = 0;
  watchCompletion(timer, () => calls++);
  timer.start();
  clock.advance(1000);
  timer.tick();
  timer.tick();
  timer.tick();
  assert.equal(calls, 1);
});

test('each completion after a reset fires exactly once more', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  let calls = 0;
  watchCompletion(timer, () => calls++);
  timer.start();
  clock.advance(1000);
  timer.tick();
  timer.reset();
  timer.start();
  clock.advance(1000);
  timer.tick();
  timer.tick();
  assert.equal(calls, 2);
});

test('reset mid-run never fires', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  let calls = 0;
  watchCompletion(timer, () => calls++);
  timer.start();
  clock.advance(400);
  timer.reset();
  timer.tick();
  assert.equal(calls, 0);
});

test('a fresh subscription (page reload) never fires', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  let calls = 0;
  watchCompletion(timer, () => calls++);
  timer.tick();
  assert.equal(calls, 0);
});

test('subscribing to an already-done timer never fires', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  timer.start();
  clock.advance(1000);
  timer.tick();
  let calls = 0;
  watchCompletion(timer, () => calls++);
  timer.tick();
  timer.reset();
  assert.equal(calls, 0);
});

test('unsubscribing stops completion delivery', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  let calls = 0;
  const unsubscribe = watchCompletion(timer, () => calls++);
  unsubscribe();
  timer.start();
  clock.advance(1000);
  timer.tick();
  assert.equal(calls, 0);
});

test('makeOnDone calls playChime exactly once per completion and gates notifyDone', () => {
  const clock = makeClock();
  const timer = createTimer({ durationMs: 1000, now: clock.now });
  let chimes = 0;
  let notifications = 0;
  let enabled = false;
  watchCompletion(
    timer,
    makeOnDone({
      playChime: () => chimes++,
      notifyDone: () => notifications++,
      isEnabled: () => enabled,
    })
  );

  timer.start();
  clock.advance(1000);
  timer.tick();
  timer.tick();
  assert.equal(chimes, 1);
  assert.equal(notifications, 0);

  timer.reset();
  enabled = true;
  timer.start();
  clock.advance(1000);
  timer.tick();
  assert.equal(chimes, 2);
  assert.equal(notifications, 1);
});

test('makeOnDone defaults to notifications disabled', () => {
  let chimes = 0;
  let notifications = 0;
  const onDone = makeOnDone({
    playChime: () => chimes++,
    notifyDone: () => notifications++,
  });
  onDone();
  assert.equal(chimes, 1);
  assert.equal(notifications, 0);
});
