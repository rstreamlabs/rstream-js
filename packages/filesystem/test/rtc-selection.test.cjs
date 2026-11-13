// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const nodeTest = require("node:test");
const test = (name, body) => nodeTest(name, { timeout: 2000 }, body);
function owner(t) {
  const controller = new AbortController();
  t.after(() => controller.abort(new Error("test owner ended")));
  return controller;
}
const {
  selectedICEPair,
  waitForICESelection,
} = require("../src/rtc-selection.ts");

function report(pair, changes) {
  return new Map([
    ["transport", { type: "transport", selectedCandidatePairId: pair, selectedCandidatePairChanges: changes }],
  ]);
}

test("selected pair uses standard transport or Firefox selection, not nomination", async (t) => {
  const signal = owner(t).signal;
  for (const [stats, expected] of [
    [report("selected"), "selected"],
    [
      new Map([
        ["pair", { type: "candidate-pair", selected: true, id: "firefox" }],
      ]),
      "firefox",
    ],
    [
      new Map([
        [
          "pair",
          {
            type: "candidate-pair",
            nominated: true,
            state: "succeeded",
            id: "unselected",
          },
        ],
      ]),
      undefined,
    ],
    [
      new Map([
        ["malformed", { type: "transport", selectedCandidatePairId: 12 }],
        ["empty", null],
      ]),
      undefined,
    ],
  ]) {
    assert.equal(
      (await selectedICEPair({ getStats: async () => stats }, signal))?.id,
      expected,
    );
    assert.equal(getEventListeners(signal, "abort").length, 0);
  }
});

test("connected with the previous pair does not complete a restart", async (t) => {
  const state = { pair: "old", calls: 0, active: 0, peak: 0 };
  const controller = owner(t);
  const peer = {
    connectionState: "connected",
    getStats: async (t) => {
      state.calls++;
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      await delay(1);
      state.active--;
      return report(state.pair);
    },
  };
  const result = { complete: false };
  const waiting = waitForICESelection(peer, { id: "old" }, controller.signal).then(
    () => {
      result.complete = true;
    },
  );
  await delay(70);
  assert.equal(result.complete, false);
  state.pair = "new";
  await waiting;
  assert.equal(state.peak, 1);
  assert.ok(
    state.calls >= 2 && state.calls <= 5,
    `unexpected observation count: ${state.calls}`,
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("already selected new pair completes without a timer or extra observation", async (t) => {
  const state = { calls: 0 };
  const controller = owner(t);
  await waitForICESelection(
    {
      connectionState: "connected",
      getStats: async (t) => {
        state.calls++;
        return report("new");
      },
    },
    { id: "old" },
    controller.signal,
  );
  assert.equal(state.calls, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("cancellation stops observation and removes its pending timer/listener", async (t) => {
  const controller = owner(t);
  const state = { calls: 0 };
  const peer = {
    connectionState: "connected",
    getStats: async (t) => {
      state.calls++;
      return report("old");
    },
  };
  const reason = new Error("transfer canceled");
  const waiting = waitForICESelection(peer, { id: "old" }, controller.signal);
  await delay(10);
  controller.abort(reason);
  await assert.rejects(waiting, (error) => error === reason);
  const stopped = state.calls;
  await delay(70);
  assert.equal(state.calls, stopped);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("cancellation interrupts native statistics that never resolve", async (t) => {
  const controller = owner(t);
  const waiting = selectedICEPair(
    { getStats: () => new Promise(() => {}) },
    controller.signal,
  );
  await Promise.resolve();
  const reason = new Error("owner closed");
  controller.abort(reason);
  await assert.rejects(waiting, (error) => error === reason);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("an aborted owner performs no native calls", async (t) => {
  const controller = owner(t);
  controller.abort(new Error("already closed"));
  await assert.rejects(
    async () =>
      selectedICEPair(
        {
          getStats: () => {
            assert.fail("native call after cancellation");
          },
        },
        controller.signal,
      ),
    /already closed/,
  );
});

test("provider failure and closed peers fail explicitly", async (t) => {
  const controller = owner(t);
  const failure = new Error("statistics unavailable");
  await assert.rejects(
    selectedICEPair(
      {
        getStats: () => {
          throw failure;
        },
      },
      controller.signal,
    ),
    (error) => error === failure,
  );
  await assert.rejects(
    waitForICESelection(
      {
        connectionState: "closed",
        getStats: () => assert.fail("closed peer queried"),
      },
      { id: "old" },
      controller.signal,
    ),
    /peer closed/,
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});


test("reselection of the same pair is recognized by its selection counter", async (t) => {
  const controller = owner(t);
  const state = { changes: 2 };
  const peer = { connectionState: "connected", getStats: async () => report("same", state.changes) };
  const previous = await selectedICEPair(peer, controller.signal);
  const result = { complete: false };
  const waiting = waitForICESelection(peer, previous, controller.signal).then(() => { result.complete = true; });
  await delay(60);
  assert.equal(result.complete, false);
  state.changes = 3;
  await waiting;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("a stable pair without proof of reselection remains bounded by its owner", async (t) => {
  const controller = owner(t);
  const waiting = waitForICESelection({ connectionState: "connected", getStats: async () => report("same") }, { id: "same" }, controller.signal);
  await delay(60);
  const reason = new Error("negotiation budget ended");
  controller.abort(reason);
  await assert.rejects(waiting, error => error === reason);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
