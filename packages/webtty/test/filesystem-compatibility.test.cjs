// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebTTYFileSystem, WebTTYFileSystemError } = require('../dist/index.js');

test('WebTTY filesystem errors preserve their public name and constructor identity', async () => {
  assert.equal(new WebTTYFileSystemError('read', 404, 'missing').name, 'WebTTYFileSystemError');
  const client = new WebTTYFileSystem({ url: 'https://files.example', fetch: async () => new Response('missing', { status: 404 }) });
  await assert.rejects(client.readBytes('/missing'), error => error instanceof WebTTYFileSystemError && error.name === 'WebTTYFileSystemError' && error.status === 404);
});
