// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { saveDownload, canSaveDownload } = require('../dist/download.js');

function mockWindow(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
}

test('download chooses a disk destination before starting network work and streams beyond 4 GiB', async (t) => {
  const events = [];
  const state = { produced: 0, written: 0, peakPending: 0, progress: 0 };
  const size = 4 * 1024 * 1024 * 1024 + 65536;
  const chunk = new Uint8Array(65536);
  mockWindow(t, { showSaveFilePicker: async ({ suggestedName }) => {
    assert.equal(suggestedName, 'large.bin');
    events.push('picker');
    return { createWritable: async () => new WritableStream({
      async write(bytes) {
        await Promise.resolve();
        state.written += bytes.byteLength;
        state.peakPending = Math.max(state.peakPending, state.produced - state.written);
      },
      close() { events.push('closed'); },
    }) };
  } });
  assert.equal(canSaveDownload(), true);
  const download = saveDownload('large.bin', async () => {
    events.push('network');
    return new ReadableStream({ pull(controller) {
      if (state.produced === size) return controller.close();
      state.produced += chunk.byteLength;
      controller.enqueue(chunk);
    } });
  }, { onProgress: (bytes) => { state.progress = bytes; } });
  assert.deepEqual(events, ['picker']);
  await download;
  assert.deepEqual(events, ['picker', 'network', 'closed']);
  assert.equal(state.written, size);
  assert.equal(state.progress, size);
  assert.ok(state.peakPending <= 4 * chunk.byteLength, `unbounded pipeline: ${state.peakPending}`);
});

test('cancelling the picker never starts a transfer', async (t) => {
  const error = new DOMException('Cancelled', 'AbortError');
  mockWindow(t, { showSaveFilePicker: async () => { throw error; } });
  await assert.rejects(saveDownload('file', async () => { assert.fail('network started'); }), error);
});

test('source failure and cancellation abort the destination', async (t) => {
  const failures = [];
  mockWindow(t, { showSaveFilePicker: async () => ({ createWritable: async () => new WritableStream({ abort(error) { failures.push(error); } }) }) });
  const error = new Error('source unavailable');
  await assert.rejects(saveDownload('file', async () => { throw error; }), error);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(saveDownload('file', async () => { assert.fail('network started'); }, { signal: abort.signal }), { name: 'AbortError' });
  assert.deepEqual(failures, [error, abort.signal.reason]);
});
