// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const test = require('node:test');
const {WebDAVFileSystem, RemoteFileSystem} = require('../dist/index.js');
const id = 'upload-test-identity-0001';
const sha256 = createHash('sha256').update('abc').digest('hex');
const options = {id,sha256,sizeBytes:'3',expectedRevision:null};
const wire = {id,path:'file',state:'committed',status:201,size_bytes:'3',sha256,revision:`"sha256-${sha256}"`,started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:00:01Z'};
const reply = value => new Response(JSON.stringify(value),{headers:{'Upload-Protocol':'durable-v1'}});

test('verified upload uses explicit guarded protocol and validates its binding',async()=>{
 let calls=0;
 const files=new WebDAVFileSystem({url:'https://files.example',fetch:async(url,init)=>{
  calls++;
  assert.equal(init.method,'PATCH');
  assert.equal(init.headers.get('File-System-Action'),'put');
  assert.equal(init.headers.get('If-None-Match'),'*');
  assert.equal(init.headers.get('Upload-Id'),id);
  assert.equal(init.headers.get('Upload-Length'),'3');
  assert.equal(init.headers.get('Content-Digest'),`sha-256=:${Buffer.from(sha256,'hex').toString('base64')}:`);
  return reply(wire);
 }});
 const receipt=await files.upload('/file','abc',options);
 assert.equal(receipt.state,'committed');
 assert.equal(receipt.sha256,sha256);
 assert.equal(calls,1);
});

test('old owners and malformed receipts never trigger a downgrade or retry',async()=>{
 for(const response of [()=>new Response('old owner',{status:501}),()=>new Response(JSON.stringify(wire)),()=>reply({...wire,id:'different-identity-0001'}),()=>reply({...wire,path:'other'}),()=>reply({...wire,sha256:'0'.repeat(64)})]) {
  let calls=0;
  const files=new WebDAVFileSystem({url:'https://files.example',fetch:async()=>{calls++;return response();}});
  await assert.rejects(files.upload('/file','abc',options));
  assert.equal(calls,1);
 }
});

test('missing receipt is a read failure and never retransmits content',async()=>{
 const methods=[];
 const files=new WebDAVFileSystem({url:'https://files.example',fetch:async(url,init)=>{
  methods.push(init.method);assert.equal(url.searchParams.get('upload-receipt'),id);
  return new Response('not found',{status:404});
 }});
 await assert.rejects(files.getUploadReceipt('/file',id),error=>error.status===404);
 assert.deepEqual(methods,['GET']);
});

test('uncertain outcomes remain explicit and oversized receipts are cancelled',async()=>{
 const files=new WebDAVFileSystem({url:'https://files.example',fetch:async()=>reply({...wire,state:'uncertain',status:503,revision:undefined})});
 assert.equal((await files.getUploadReceipt('/file',id)).state,'uncertain');
 let cancelled=false;
 const large=new WebDAVFileSystem({url:'https://files.example',fetch:async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(20000));},cancel(){cancelled=true;}}),{headers:{'Upload-Protocol':'durable-v1'}})});
 await assert.rejects(large.getUploadReceipt('/file',id),/too large/);
 assert.equal(cancelled,true);
});

test('transport discovery removes mutation headers and keeps the actual request intact',async()=>{
 const files=new RemoteFileSystem({url:'https://files.example',fetch:async(input,init)=>{
  const request=new Request(input,init);
  if(request.url.endsWith('/.rstream/files/v1')) {
   assert.equal(request.method,'GET');
   for(const header of ['Upload-Id','Upload-Length','Content-Digest','File-System-Action','If-None-Match']) assert.equal(request.headers.has(header),false);
   return Response.json({version:1,backend:'webdav'});
  }
  assert.equal(request.method,'PATCH');assert.equal(request.headers.get('Upload-Id'),id);
  return reply(wire);
 }});
 assert.equal((await files.upload('/file','abc',options)).state,'committed');
});
