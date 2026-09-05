// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebTTYFileSystem, WebTTYFileSystemError } = require('../dist/index.js');

test('WebTTY filesystem errors preserve their public name and constructor identity', async () => {
  assert.equal(new WebTTYFileSystemError('read', 404, 'missing').name, 'WebTTYFileSystemError');
  const client = new WebTTYFileSystem({ url: 'https://files.example', fetch: async () => new Response('missing', { status: 404 }) });
  await assert.rejects(client.readBytes('/missing'), error => error instanceof WebTTYFileSystemError && error.name === 'WebTTYFileSystemError' && error.status === 404);
});

test('backend discovery failures preserve WebTTY error identity for reads and archives', async () => {
  const client = new WebTTYFileSystem({ url: 'https://files.example', fetch: async () => new Response('denied', { status: 401, statusText: 'Unauthorized' }) });
  for (const operation of [() => client.readBytes('/private'), () => client.archiveStream('/')]) {
    await assert.rejects(operation, error => error instanceof WebTTYFileSystemError && error.name === 'WebTTYFileSystemError' && error.status === 401 && error.message === 'Filesystem discovery failed with status 401: Unauthorized');
  }
});
