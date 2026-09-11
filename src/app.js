// Page wiring: drives the engine with a tick interval and reacts to `done`
// with the chime and, when the user opted in, a browser notification.

import { createTimer, formatRemaining } from './timer.js';
import { unlockAudio, playChime } from './chime.js';
import { toggleNotify, notifyDone } from './notify.js';
import { watchCompletion, makeOnDone } from './completion.js';

const DEFAULT_MS = 25 * 60 * 1000;

// `?s=<seconds>` overrides the duration for manual testing. createTimer throws
// on a non-positive duration, so anything invalid falls back to the default.
const seconds = Number(new URLSearchParams(window.location.search).get('s'));
const durationMs =
  Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_MS;

const timer = createTimer({ durationMs });

const display = document.getElementById('display');
const startButton = document.getElementById('start');
const pauseButton = document.getElementById('pause');
const resetButton = document.getElementById('reset');
const notifyButton = document.getElementById('notify');

const render = (state) => {
  display.textContent = formatRemaining(state.remainingMs);
};

// Nothing persists: the toggle starts from the browser's permission state on
// each load, so it can only begin as `Notify on` when already granted.
let notifyEnabled =
  typeof Notification !== 'undefined' && Notification.permission === 'granted';
let notifyPending = false;

const renderNotify = () => {
  notifyButton.textContent = notifyEnabled ? 'Notify on' : 'Notify off';
  notifyButton.setAttribute('aria-pressed', String(notifyEnabled));
};

notifyButton.addEventListener('click', async () => {
  if (notifyPending) return; // the permission prompt is still open
  notifyPending = true;
  try {
    notifyEnabled = await toggleNotify(notifyEnabled);
  } finally {
    notifyPending = false;
  }
  renderNotify();
});

startButton.addEventListener('click', () => {
  // The click is the user gesture autoplay policy needs; unlock audio here so
  // the chime's context is running by the time the session completes.
  unlockAudio();
  timer.start();
});
pauseButton.addEventListener('click', () => timer.pause());
resetButton.addEventListener('click', () => timer.reset());

timer.subscribe(render);
watchCompletion(
  timer,
  makeOnDone({ playChime, notifyDone, isEnabled: () => notifyEnabled })
);

setInterval(() => render(timer.tick()), 250);

// Hidden tabs throttle intervals (Chrome can hold them for up to a minute), so
// tick as soon as the tab is visible or focused again to complete promptly.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render(timer.tick());
});
window.addEventListener('focus', () => render(timer.tick()));

render(timer.getState());
renderNotify();
