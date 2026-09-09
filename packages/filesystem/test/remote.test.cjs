// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RemoteFileSystem, FileSystemError } = require('../dist/index.js');

test('discovery failure cancels an unused upload stream', async () => {
  const state = { canceled: false };
  const stream = new ReadableStream({ cancel() { state.canceled = true; } });
  const files = new RemoteFileSystem({ url: 'https://files.example', fetch: async () => new Response('Unauthorized', { status: 401 }) });
  await assert.rejects(files.writeStream('/file', stream), (error) => error instanceof FileSystemError && error.status === 401);
  assert.equal(state.canceled, true);
});
