import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupported,
  requestPermission,
  toggleNotify,
  notifyDone,
} from '../src/notify.js';

// Builds a fake Notification class: static permission, a requestPermission
// that resolves to `requestResult`, and a constructor that records instances.
function makeFakeNotification(permission, requestResult = permission) {
  const fake = class FakeNotification {
    static permission = permission;
    static requests = 0;
    static instances = [];
    static requestPermission() {
      fake.requests++;
      fake.permission = requestResult;
      return Promise.resolve(requestResult);
    }
    constructor(title, options) {
      this.title = title;
      this.options = options;
      fake.instances.push(this);
    }
  };
  return fake;
}

test('isSupported is false without a Notification API', () => {
  assert.equal(isSupported(undefined), false);
  assert.equal(isSupported(makeFakeNotification('default')), true);
});

test('requestPermission resolves unsupported without an API', async () => {
  assert.equal(await requestPermission(undefined), 'unsupported');
});

test('requestPermission short-circuits granted and denied without prompting', async () => {
  const granted = makeFakeNotification('granted');
  assert.equal(await requestPermission(granted), 'granted');
  assert.equal(granted.requests, 0);

  const denied = makeFakeNotification('denied');
  assert.equal(await requestPermission(denied), 'denied');
  assert.equal(denied.requests, 0);
});

test('requestPermission prompts once from default and returns the answer', async () => {
  const fake = makeFakeNotification('default', 'granted');
  assert.equal(await requestPermission(fake), 'granted');
  assert.equal(fake.requests, 1);
});

test('requestPermission supports callback-style browsers (older Safari)', async () => {
  class CallbackNotification {
    static permission = 'default';
    static requestPermission(callback) {
      callback('granted');
      return undefined;
    }
  }
  assert.equal(await requestPermission(CallbackNotification), 'granted');
});

test('requestPermission treats a throwing prompt as denied', async () => {
  class ThrowingNotification {
    static permission = 'default';
    static requestPermission() {
      throw new Error('nope');
    }
  }
  assert.equal(await requestPermission(ThrowingNotification), 'denied');
});

test('toggleNotify turns off without prompting', async () => {
  const fake = makeFakeNotification('granted');
  assert.equal(await toggleNotify(true, fake), false);
  assert.equal(fake.requests, 0);
});

test('toggleNotify enables only when permission ends up granted', async () => {
  assert.equal(await toggleNotify(false, makeFakeNotification('default', 'granted')), true);
  assert.equal(await toggleNotify(false, makeFakeNotification('granted')), true);
  assert.equal(await toggleNotify(false, makeFakeNotification('default', 'denied')), false);
  assert.equal(await toggleNotify(false, makeFakeNotification('denied')), false);
  assert.equal(await toggleNotify(false, undefined), false);
});

test('notifyDone with permission granted creates one Session complete notification', () => {
  const fake = makeFakeNotification('granted');
  const notification = notifyDone(fake);
  assert.ok(notification);
  assert.equal(fake.instances.length, 1);
  assert.equal(fake.instances[0].title, 'Session complete');
});

test('notifyDone is null without granted permission or an API', () => {
  const denied = makeFakeNotification('denied');
  assert.equal(notifyDone(denied), null);
  assert.equal(denied.instances.length, 0);

  const asking = makeFakeNotification('default');
  assert.equal(notifyDone(asking), null);
  assert.equal(asking.instances.length, 0);

  assert.equal(notifyDone(undefined), null);
});

test('notifyDone swallows a throwing constructor', () => {
  class ThrowingNotification {
    static permission = 'granted';
    constructor() {
      throw new Error('needs a service worker');
    }
  }
  assert.equal(notifyDone(ThrowingNotification), null);
});
