import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlockAudio, playChime } from '../src/chime.js';

class FakeParam {
  constructor() {
    this.events = [];
  }
  setValueAtTime(value, time) {
    this.events.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value, time) {
    this.events.push({ kind: 'ramp', value, time });
  }
}

class FakeOscillator {
  constructor() {
    this.type = null;
    this.frequency = { value: 0 };
    this.startedAt = null;
    this.stoppedAt = null;
    this.connectedTo = null;
  }
  connect(node) {
    this.connectedTo = node;
  }
  start(time) {
    this.startedAt = time;
  }
  stop(time) {
    this.stoppedAt = time;
  }
}

class FakeGain {
  constructor() {
    this.gain = new FakeParam();
    this.connectedTo = null;
  }
  connect(node) {
    this.connectedTo = node;
  }
}

class FakeAudioContext {
  constructor({ state = 'running', currentTime = 10 } = {}) {
    this.state = state;
    this.currentTime = currentTime;
    this.destination = { node: 'destination' };
    this.oscillators = [];
    this.gains = [];
    this.resumes = 0;
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
}

// Runs first: once unlockAudio has created the shared module context, the
// missing-API branch can no longer be observed.
test('unlockAudio returns null when the Web Audio API is missing', () => {
  assert.equal(unlockAudio(undefined), null);
});

test('unlockAudio creates one context, reuses it, and resumes when suspended', () => {
  let constructed = 0;
  class CountingContext extends FakeAudioContext {
    constructor() {
      super({ state: 'suspended' });
      constructed++;
    }
  }
  const first = unlockAudio(CountingContext);
  const second = unlockAudio(CountingContext);
  assert.equal(first, second);
  assert.equal(constructed, 1);
  assert.ok(first.resumes >= 1);
  assert.equal(first.state, 'running');
});

test('playChime skips silently without a running context', () => {
  assert.equal(playChime(null), false);
  const suspended = new FakeAudioContext({ state: 'suspended' });
  assert.equal(playChime(suspended), false);
  assert.equal(suspended.oscillators.length, 0);
});

test('playChime schedules two ascending sine tones 160 ms apart', () => {
  const ctx = new FakeAudioContext({ currentTime: 10 });
  assert.equal(playChime(ctx), true);
  assert.equal(ctx.oscillators.length, 2);
  assert.deepEqual(
    ctx.oscillators.map((osc) => osc.frequency.value),
    [880, 1320]
  );
  for (const osc of ctx.oscillators) assert.equal(osc.type, 'sine');
  // 120 ms tones with a 40 ms gap: starts at t and t + 0.16.
  assert.deepEqual(
    ctx.oscillators.map((osc) => osc.startedAt),
    [10, 10.16]
  );
  assert.deepEqual(
    ctx.oscillators.map((osc) => osc.stoppedAt),
    [10.12, 10.28]
  );
});

test('playChime routes each tone through a gain capped at 0.2 so it cannot clip', () => {
  const ctx = new FakeAudioContext();
  playChime(ctx);
  assert.equal(ctx.gains.length, 2);
  for (const [i, gain] of ctx.gains.entries()) {
    assert.equal(ctx.oscillators[i].connectedTo, gain);
    assert.equal(gain.connectedTo, ctx.destination);
    const peak = Math.max(...gain.gain.events.map((event) => event.value));
    assert.equal(peak, 0.2);
    // The envelope ends at zero: the release ramp is the last event.
    const last = gain.gain.events.at(-1);
    assert.equal(last.kind, 'ramp');
    assert.equal(last.value, 0);
  }
});
