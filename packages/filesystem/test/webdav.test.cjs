// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebDAVFileSystem, resolveFileSystemURL, parseWebDAVMultiStatus } = require('../dist/index.js');

test('URL encoding preserves names and rejects traversal', () => {
  const name = '/ résum é #?% &.txt ';
  const result = resolveFileSystemURL('https://files.example', name);
  assert.equal(decodeURIComponent(result.pathname), '/fs' + name);
  assert.equal(result.search, '');
  assert.throws(() => resolveFileSystemURL('https://files.example', '../secret'));
  assert.throws(() => resolveFileSystemURL('https://files.example', '/a\\b'));
});

test('WebDAV backend streams ranges with cancellation and keeps header credentials off browser links', async () => {
  const controller = new AbortController();
  const backend = new WebDAVFileSystem({
    url: 'https://files.example',
    authToken: 'fixture-token',
    fetch: async (url, init) => {
      assert.equal(init.headers.get('Range'), 'bytes=4-');
      assert.equal(init.headers.get('Authorization'), 'Bearer fixture-token');
      assert.equal(init.signal, controller.signal);
      return new Response('tail', { status: 206 });
    },
  });
  const stream = await backend.readStream('/large.bin', { range: 'bytes=4-', signal: controller.signal });
  assert.equal(await new Response(stream).text(), 'tail');
  await assert.rejects(backend.downloadURL('/large.bin'), /readStream/);
});

test('browser downloads retain the encoded filename', async () => {
  const backend = new WebDAVFileSystem({ url: 'https://files.example', fsPath: '/fs' });
  assert.equal((await backend.downloadURL('/a#b?.txt')).href, 'https://files.example/fs/a%23b%3F.txt');
});

test('multistatus retains exact decoded paths', () => {
  const xml = '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/fs/%20a%23%3F%25%20</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>4</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
  assert.equal(parseWebDAVMultiStatus(xml)[0].path, '/ a#?% ');
});

test('ignored ranges fail with a bounded error body instead of appending a full file', async () => {
  let cancelled = false;
  let pulls = 0;
  const backend = new WebDAVFileSystem({
    url: 'https://files.example',
    fetch: async () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(65536).fill(120)); },
      cancel() { cancelled = true; },
    })),
  });
  await assert.rejects(backend.readStream('/large.bin', { range: 'bytes=100-' }), error => error.status === 200 && error.message.length < 4200);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 2);
});
