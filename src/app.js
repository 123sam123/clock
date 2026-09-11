// Visual state only — the countdown engine ships in a separate ticket and
// will replace this file's behaviour. State is expressed solely via
// aria-pressed; ids #start, #pause, #reset are load-bearing for that ticket.
const start = document.querySelector("#start");
const pause = document.querySelector("#pause");
const reset = document.querySelector("#reset");

start.addEventListener("click", () => {
  start.setAttribute("aria-pressed", "true");
  pause.setAttribute("aria-pressed", "false");
});

pause.addEventListener("click", () => {
  pause.setAttribute("aria-pressed", "true");
  start.setAttribute("aria-pressed", "false");
});

reset.addEventListener("click", () => {
  start.setAttribute("aria-pressed", "false");
  pause.setAttribute("aria-pressed", "false");
});
