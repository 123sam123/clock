// DOM-free wiring between the timer engine and the completion side effects,
// kept out of app.js so the exactly-once guarantee is testable in Node.

// Calls onDone only on a transition into 'done'. prev starts from the current
// state, so subscribing to a fresh (reloaded) or already-done timer never
// fires, and reset or repeated ticks cannot fire twice for one completion.
export function watchCompletion(timer, onDone) {
  let prev = timer.getState().status;
  return timer.subscribe((state) => {
    const was = prev;
    prev = state.status;
    if (state.status === 'done' && was !== 'done') onDone(state);
  });
}

// Composes the completion side effects. isEnabled is read at completion time
// so the Notify toggle can change while a session is running.
export function makeOnDone({ playChime, notifyDone, isEnabled = () => false }) {
  return () => {
    playChime();
    if (isEnabled()) notifyDone();
  };
}
