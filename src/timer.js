// Countdown timer engine. Pure ES module: no DOM, no scheduling — the caller
// drives it via tick() so a throttled background tab cannot make it drift.

const STATUSES = ['idle', 'running', 'paused', 'done'];

// status, accumulatedMs and startedAt are accepted so a serialize()d record
// round-trips: createTimer({ ...timer.serialize(), now }) rebuilds a timer.
// They are validated here — this is the one place engine state is checked, so
// callers restoring stored data rely on the RangeError rather than re-checking.
export function createTimer({
  durationMs,
  now = () => Date.now(),
  status = 'idle',
  accumulatedMs = 0, // elapsed before the current run segment
  startedAt = null, // clock reading when the current run segment began
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a positive number of milliseconds, got ${durationMs}`);
  }
  if (!STATUSES.includes(status)) {
    throw new RangeError(`status must be one of ${STATUSES.join(', ')}, got ${status}`);
  }
  if (!Number.isFinite(accumulatedMs) || accumulatedMs < 0 || accumulatedMs > durationMs) {
    throw new RangeError(`accumulatedMs must be between 0 and durationMs, got ${accumulatedMs}`);
  }
  if (status === 'idle' && accumulatedMs !== 0) {
    throw new RangeError(`an idle timer cannot have elapsed time, got ${accumulatedMs}`);
  }
  if (status === 'done' && accumulatedMs !== durationMs) {
    throw new RangeError(`a done timer must have elapsed its full duration, got ${accumulatedMs}`);
  }
  if (status === 'running') {
    if (!Number.isFinite(startedAt)) {
      throw new RangeError(`a running timer needs a numeric startedAt, got ${startedAt}`);
    }
  } else {
    startedAt = null;
  }

  const listeners = [];

  // Math.max clamps a clock that moved backwards (system time change) so the
  // current segment contributes 0 instead of extending the remaining time.
  const elapsedMs = () =>
    accumulatedMs + (status === 'running' ? Math.max(0, now() - startedAt) : 0);

  const snapshot = () =>
    Object.freeze({
      status,
      remainingMs: Math.max(0, durationMs - elapsedMs()),
      durationMs,
    });

  const emit = () => {
    const state = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (err) {
        console.error('timer subscriber threw', err);
      }
    }
  };

  return {
    start() {
      if (status !== 'idle' && status !== 'paused') return;
      startedAt = now();
      status = 'running';
      emit();
    },

    pause() {
      if (status !== 'running') return;
      // Math.min keeps a pause that lands after expiry but before the next
      // tick() inside the duration, so the paused state always serializes.
      accumulatedMs = Math.min(durationMs, accumulatedMs + Math.max(0, now() - startedAt));
      startedAt = null;
      status = 'paused';
      emit();
    },

    reset() {
      status = 'idle';
      accumulatedMs = 0;
      startedAt = null;
      emit();
    },

    tick() {
      if (status === 'running' && durationMs - elapsedMs() <= 0) {
        accumulatedMs = durationMs;
        startedAt = null;
        status = 'done';
        emit();
      }
      return snapshot();
    },

    getState: snapshot,

    // The engine's own state rather than the derived snapshot, in the shape
    // createTimer accepts, so a persisted timer can be rebuilt exactly.
    serialize() {
      return { durationMs, status, accumulatedMs, startedAt };
    },

    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
  };
}

// Rounds up to the next whole second so 1 ms left reads "00:01" and only a
// true 0 reads "00:00". Minutes are not wrapped at 60.
export function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
