// See LICENSE file in the project root for license information.

const assert = require('node:assert/strict');
const {createHash,randomUUID} = require('node:crypto');
const {mkdtemp,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {once} = require('node:events');
const test = require('node:test');
const {RemoteFileSystem} = require('../../dist/index.js');

async function server(root) {
 const binary=process.env.RSTREAM_FILES_E2E_SERVER;
 assert.ok(binary,'Set RSTREAM_FILES_E2E_SERVER to the real Go test server binary');
 const child=spawn(binary,['-root',root,'-mode','webtty','-backend','webdav','-rtc-only=false'],{stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 const lines=createInterface({input:child.stdout});
 let url;
 try {
  const [line]=await once(lines,'line',{signal:AbortSignal.timeout(15000)});
  url=JSON.parse(line).url;
 } catch(error) { child.kill('SIGTERM');await exited;throw new Error(`${error.message}: ${errors}`); }
 return {url,async stop(){child.kill('SIGTERM');await exited;lines.close();}};
}

test('real Go owner: streamed upload, restart recovery, conflicts and removal', {timeout:45000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'rstream-upload-e2e-'));
 let owner=await server(root);
 try {
  const contents=Buffer.alloc(512*1024,37);
  const sha256=createHash('sha256').update(contents).digest('hex');
  const id=randomUUID();
  const options={id,sizeBytes:String(contents.length),sha256,expectedRevision:null};
  const files=new RemoteFileSystem({url:()=>owner.url});
  let offset=0;
  const stream=new ReadableStream({pull(controller){if(offset===contents.length){controller.close();return;}controller.enqueue(contents.subarray(offset,offset+32768));offset+=32768;}});
  const uploaded=await files.upload('/verified.bin',stream,options);
  assert.equal(uploaded.state,'committed');
  assert.equal((await files.stat('/verified.bin')).revision,uploaded.revision);
  const downloaded=await files.readStream('/verified.bin',{expectedRevision:uploaded.revision});
  assert.equal(createHash('sha256').update(Buffer.from(await new Response(downloaded).arrayBuffer())).digest('hex'),sha256);
  await owner.stop();owner=await server(root);
  const recovered=await files.getUploadReceipt('/verified.bin',id);
  assert.deepEqual(recovered,uploaded);
  const stale=await files.upload('/verified.bin',contents,{...options,id:randomUUID()});
  assert.equal(stale.state,'rejected');assert.equal(stale.status,412);
  await assert.rejects(files.upload('/verified.bin','changed',{...options,sizeBytes:'7',sha256:createHash('sha256').update('changed').digest('hex')}),error=>error.status===409);
  await assert.rejects(files.removeIfRevision('/verified.bin','"stale"'),error=>error.status===412);
  await files.removeIfRevision('/verified.bin',uploaded.revision);
  assert.deepEqual(await files.getUploadReceipt('/verified.bin',id),uploaded);
  assert.deepEqual(await files.upload('/verified.bin',contents,options),uploaded);
  assert.equal(await files.exists('/verified.bin'),false,'an identical retry recreated the removed file');
 } finally {await owner.stop();await rm(root,{recursive:true,force:true});}
});
