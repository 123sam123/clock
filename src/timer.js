// Countdown timer engine. Pure ES module: no DOM, no scheduling — the caller
// drives it via tick() so a throttled background tab cannot make it drift.

export function createTimer({ durationMs, now = () => Date.now() } = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a positive number of milliseconds, got ${durationMs}`);
  }

  let status = 'idle';
  let accumulatedMs = 0; // elapsed before the current run segment
  let startedAt = null; // clock reading when the current run segment began
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
      accumulatedMs += Math.max(0, now() - startedAt);
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
