// Drives the update flow with a fake ServiceWorkerRegistration: a real worker
// cannot be installed under jsdom, and the interesting part is the wiring —
// when an update counts as "ready", and what applying it asks the worker to do.

function fakeWorker(state) {
  const w = new EventTarget();
  w.state = state;
  w.postMessage = jest.fn();
  return w;
}

function setup({ controlled }) {
  const registration = new EventTarget();
  registration.waiting = null;
  registration.installing = null;
  registration.update = jest.fn().mockResolvedValue(undefined);

  const container = new EventTarget();
  container.controller = controlled ? {} : null;
  container.register = jest.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });

  let sw;
  jest.isolateModules(() => {
    sw = require("./serviceWorkerRegistration");
  });
  sw.register();
  window.dispatchEvent(new Event("load"));
  return { sw, registration, container };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test("a worker that finishes installing under a controlled page is an update", async () => {
  const { sw, registration } = setup({ controlled: true });
  await flush();

  const seen = [];
  sw.subscribeUpdate((v) => seen.push(v));
  expect(seen).toEqual([false]);

  const installing = fakeWorker("installing");
  registration.installing = installing;
  registration.dispatchEvent(new Event("updatefound"));

  installing.state = "installed";
  registration.waiting = installing;
  installing.dispatchEvent(new Event("statechange"));

  expect(seen).toEqual([false, true]);
});

test("the very first install is not reported as an update", async () => {
  const { sw, registration } = setup({ controlled: false });
  await flush();

  const seen = [];
  sw.subscribeUpdate((v) => seen.push(v));

  const installing = fakeWorker("installing");
  registration.installing = installing;
  registration.dispatchEvent(new Event("updatefound"));
  installing.state = "installed";
  registration.waiting = installing;
  installing.dispatchEvent(new Event("statechange"));

  expect(seen).toEqual([false]);
});

test("a worker already waiting at startup is reported", async () => {
  const waiting = fakeWorker("installed");
  const registration = new EventTarget();
  registration.waiting = waiting;
  registration.update = jest.fn().mockResolvedValue(undefined);
  const container = new EventTarget();
  container.controller = {};
  container.register = jest.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });

  let sw;
  jest.isolateModules(() => {
    sw = require("./serviceWorkerRegistration");
  });
  sw.register();
  window.dispatchEvent(new Event("load"));
  await flush();

  const seen = [];
  sw.subscribeUpdate((v) => seen.push(v));
  expect(seen).toEqual([true]);
});

test("checkForUpdate asks the browser to look, and reports readiness", async () => {
  const { sw, registration } = setup({ controlled: true });
  await flush();

  expect(await sw.checkForUpdate()).toBe(false);
  expect(registration.update).toHaveBeenCalled();
});

test("applyUpdate tells the waiting worker to take over", async () => {
  const { sw, registration } = setup({ controlled: true });
  await flush();

  const waiting = fakeWorker("installed");
  registration.waiting = waiting;

  jest.useFakeTimers();
  sw.applyUpdate();
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  jest.clearAllTimers(); // drops the reload fallback jsdom cannot perform
  jest.useRealTimers();
});
