// Browser-notification wrapper. Every entry point is safe to call when the
// Notification API is missing, and the class is injectable so the logic is
// testable in Node without a DOM. Nothing here prompts on page load: only
// toggleNotify/requestPermission ask, and only from an explicit control.

export function isSupported(NotificationClass = globalThis.Notification) {
  return typeof NotificationClass === 'function';
}

export function requestPermission(NotificationClass = globalThis.Notification) {
  if (!isSupported(NotificationClass)) return Promise.resolve('unsupported');
  // 'granted' and 'denied' are final; asking again would either be a no-op or
  // a forbidden re-prompt, so short-circuit both.
  const current = NotificationClass.permission;
  if (current === 'granted' || current === 'denied') return Promise.resolve(current);
  return new Promise((resolve) => {
    try {
      // Modern browsers return a promise; older Safari only takes a callback.
      const result = NotificationClass.requestPermission((value) => resolve(value));
      if (result && typeof result.then === 'function') {
        result.then(resolve, () => resolve('denied'));
      }
    } catch {
      resolve('denied');
    }
  });
}

// State machine for the Notify control: pressing while on switches off without
// prompting; pressing while off prompts (at most once) and enables only when
// the browser answers 'granted'. Denied or unsupported stays off, silently.
export async function toggleNotify(enabled, NotificationClass = globalThis.Notification) {
  if (enabled) return false;
  return (await requestPermission(NotificationClass)) === 'granted';
}

export function notifyDone(NotificationClass = globalThis.Notification) {
  if (!isSupported(NotificationClass) || NotificationClass.permission !== 'granted') {
    return null;
  }
  try {
    // The tag coalesces duplicates when several tabs complete the same session.
    return new NotificationClass('Session complete', { tag: 'session-complete' });
  } catch {
    // Some platforms (e.g. Android Chrome) throw here and require a service
    // worker; a missed notification must not break the page.
    return null;
  }
}
