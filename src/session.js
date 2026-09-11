// Session persistence: mirrors the engine's state into web storage so a
// reload — or closing and reopening the tab — lands where the session was.
// DOM-free and storage-injectable so it is testable in Node. Every storage
// access is guarded: localStorage can be absent, throw on access (cookies
// blocked), or throw on write (quota, private mode), and none of that may
// break the clock — the page simply runs without persistence.

import { createTimer } from './timer.js';

// localStorage rather than sessionStorage because the session must survive
// the tab closing. The key is namespaced: a local static server puts every
// project on one origin.
export const SESSION_KEY = 'clock.session';
const VERSION = 1;

// Accessing window.localStorage itself throws a SecurityError when storage
// is disabled, so the default is resolved lazily behind a try.
function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// Returns the stored record, or null when there is none or it cannot be
// read or parsed. Only the envelope is checked here (an object carrying the
// current version); the fields themselves are validated by createTimer, the
// single owner of the engine's invariants.
export function loadSession(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(SESSION_KEY));
    if (typeof parsed !== 'object' || parsed === null || parsed.version !== VERSION) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do: the next successful write or clear replaces it.
  }
}

function saveSession(record, storage) {
  if (!storage) return;
  try {
    storage.setItem(SESSION_KEY, JSON.stringify({ version: VERSION, ...record }));
  } catch {
    // Quota or private mode: the in-page timer keeps working unpersisted.
  }
}

// Mirrors every engine state change into storage. Idle is never stored —
// reset erases the record — so a fresh page and a reset page look the same.
// Ticks do not emit, so nothing is written per tick: remaining time derives
// from startedAt and the wall clock, and there is nothing to flush on unload.
export function persistTimer(timer, storage = defaultStorage()) {
  return timer.subscribe((state) => {
    if (state.status === 'idle') clearSession(storage);
    else saveSession(timer.serialize(), storage);
  });
}

// Builds the page's timer: restored from storage when a record for this
// duration exists and is intact, fresh otherwise. The returned timer is
// already mirrored into storage and already settled, so a running session
// that ran out while the page was closed comes back as done — wire completion
// effects after this call so that settle does not count as a completion.
export function createPersistedTimer({ durationMs, now = () => Date.now(), storage = defaultStorage() }) {
  let timer = null;
  const record = loadSession(storage);

  // The URL (or default) defines this page's session: a record for another
  // duration is not resumed, which also keeps Reset on the page's duration.
  // Idle is never written, so a record claiming it is stale.
  if (record && record.durationMs === durationMs && record.status !== 'idle') {
    // A startedAt in the future means the clock moved backwards while the
    // page was closed; re-basing it keeps the timer from stalling until the
    // clock catches up. Small in-session skews are clamped by the engine.
    if (record.status === 'running' && record.startedAt > now()) {
      record.startedAt = now();
    }
    try {
      timer = createTimer({ ...record, now });
    } catch (err) {
      // createTimer's RangeError is the verdict that the record is damaged;
      // anything else is a bug and must surface.
      if (!(err instanceof RangeError)) throw err;
    }
  }

  if (!timer) {
    clearSession(storage);
    timer = createTimer({ durationMs, now });
  }

  persistTimer(timer, storage);
  timer.tick();
  return timer;
}
