// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ICERestartCadence } = require("../src/rtc-restart.ts");

function fixture(t) {
  const clock = { time: 0 };
  const failures = [];
  const cadence = new ICERestartCadence(1000, error => failures.push(error), () => clock.time);
  t.after(() => cadence.close());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return { clock, failures, cadence };
}

test("selection cannot trigger another replacement until reliable data resumes", t => {
  const { clock, cadence } = fixture(t);
  clock.time = 1000;
  assert.equal(cadence.due(10, false), true);
  cadence.selected(10, false);
  clock.time = 5000;
  assert.equal(cadence.due(10, false), false);
  assert.equal(cadence.due(9, false), false);
  assert.equal(cadence.due(11, false), false);
  clock.time = 5999;
  assert.equal(cadence.due(12, false), false);
  clock.time = 6000;
  assert.equal(cadence.due(12, false), true);
});

test("a backpressured consumer can pause longer than the recovery budget", t => {
  const { cadence, failures } = fixture(t);
  cadence.selected(10, false);
  t.mock.timers.tick(60000);
  assert.deepEqual(failures, []);
  assert.equal(cadence.due(10, false), false);
  cadence.demand(true);
  t.mock.timers.tick(19999);
  assert.deepEqual(failures, []);
  t.mock.timers.tick(1);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /did not resume/);
});

test("ordinary renewal observations cannot extend an active stalled read", t => {
  const { cadence, failures } = fixture(t);
  cadence.demand(true);
  cadence.selected(10, false);
  for (const _ of [1, 2, 3]) {
    t.mock.timers.tick(5000);
    assert.equal(cadence.due(10, false), false);
    cadence.demand(true);
    assert.deepEqual(failures, []);
  }
  t.mock.timers.tick(5000);
  assert.equal(failures.length, 1);
});

test("resumed data cancels its timer and restores the restart cadence", t => {
  const { clock, cadence, failures } = fixture(t);
  cadence.demand(true);
  cadence.selected(10, false);
  clock.time = 12000;
  cadence.progress(11, false);
  t.mock.timers.tick(60000);
  assert.deepEqual(failures, []);
  assert.equal(cadence.due(11, false), false);
  clock.time = 13000;
  assert.equal(cadence.due(11, false), true);
});

test("completion and owner close remove recovery timers", t => {
  const { clock, cadence, failures } = fixture(t);
  cadence.demand(true);
  cadence.selected(10, false);
  cadence.progress(10, true);
  clock.time = 60000;
  assert.equal(cadence.due(10, true), false);
  t.mock.timers.tick(60000);
  assert.deepEqual(failures, []);
  cadence.selected(10, false);
  cadence.close();
  cadence.selected(10, false);
  cadence.demand(true);
  t.mock.timers.tick(60000);
  assert.deepEqual(failures, []);
});
