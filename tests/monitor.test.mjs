import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {Monitor}=createRequire(import.meta.url)('../electron/monitor.cjs');
function setup({count=4,cursor,validity='v1',failUid,largeUid}={}) {
 const account={id:'a',enabled:true}, state={accounts:[account],cursors:cursor?{a:cursor}:{}};
 const received=[], box={count,validity,failUid,largeUid,gate:null}, clients=[];
 const monitor=new Monitor({getState:()=>state,password:()=> 'test-password',persist:()=>{},publish:()=>{},onMail:(mail,historical)=>received.push({mail,historical}),
  createClient:()=>{
   const client={mailbox:{uidValidity:box.validity,uidNext:box.count+1},on:()=>{},connect:async()=>{},close:()=>{},getMailboxLock:async()=>({release:()=>{}}),
    search:async query=>Array.from({length:box.count},(_,i)=>i+1).filter(uid=>!query.uid||uid>=Number(query.uid.split(':')[0])),
    fetchOne:async(uid,query)=>{if(box.gate)await box.gate;if(uid===box.failUid)throw Error('network failed');return query.source?{source:Buffer.from(`Subject: test\r\n\r\nbody ${uid}`)}:{uid,envelope:{from:[{name:'Sender',address:'alert@example.com'}],subject:`test ${uid}`},internalDate:new Date(),size:uid===box.largeUid?6*1024*1024:100};}};
   clients.push(client);return client;
  }});
 return {monitor,account,state,received,box,clients};
}
test('首次连接只载入 30 封历史邮件，不触发新邮件语义；重连不重复',async()=>{
 const s=setup({count:50});await s.monitor.sync();assert.equal(s.received.length,30);assert.ok(s.received.every(m=>m.historical));assert.equal(s.state.cursors.a.uid,50);
 await s.monitor.sync();assert.equal(s.received.length,30);
 s.box.count=52;await s.monitor.sync();assert.deepEqual(s.received.slice(-2).map(m=>m.historical),[false,false]);assert.equal(s.state.cursors.a.uid,52);
});
test('单轮上限 100 封，剩余新邮件在下一轮继续，无丢失',async()=>{
 const s=setup({count:205,cursor:{validity:'v1',uid:3}});await s.monitor.sync();assert.equal(s.received.length,100);assert.equal(s.state.cursors.a.uid,103);
 await s.monitor.sync();assert.equal(s.received.length,200);assert.equal(s.state.cursors.a.uid,203);
 await s.monitor.sync();assert.equal(s.received.length,202);assert.equal(s.state.cursors.a.uid,205);assert.equal(new Set(s.received.map(x=>x.mail.id)).size,202);
});
test('下载失败后保留已完成游标，恢复连接时不重报、不跳过',async()=>{
 const s=setup({count:6,cursor:{validity:'v1',uid:2},failUid:5});await s.monitor.sync();assert.equal(s.state.cursors.a.uid,4);assert.equal(s.monitor.status.a.state,'error');
 s.box.failUid=null;await s.monitor.sync();assert.deepEqual(s.received.map(x=>Number(x.mail.id.split(':').at(-1))),[3,4,5,6]);assert.equal(s.state.cursors.a.uid,6);
});
test('UIDVALIDITY 变化重新建立历史基线，超大邮件跳过正文',async()=>{
 const s=setup({count:4,cursor:{validity:'old',uid:99},largeUid:3});await s.monitor.sync();assert.ok(s.received.every(x=>x.historical));assert.equal(s.state.cursors.a.validity,'v1');assert.equal(s.received[2].mail.bodySkipped,true);assert.equal(s.received[2].mail.body,'');
});
test('删除或编辑邮箱使正在执行的旧连接失效',async()=>{
 const s=setup({cursor:{validity:'v1',uid:0}});let release;s.box.gate=new Promise(r=>release=r);const task=s.monitor.sync();
 await new Promise(r=>setTimeout(r,10));s.monitor.invalidate('a');release();await task;assert.equal(s.received.length,0);assert.equal(s.state.cursors.a.uid,0);
});
test('建立首次基线期间到达的新邮件在下一轮报警，不混入历史数据',async()=>{
 const s=setup({count:4});const factory=s.monitor.createClient;
 s.monitor.createClient=(...args)=>{const client=factory(...args);const search=client.search;client.search=async q=>{if(q.all)s.box.count=5;return search(q);};return client;};
 await s.monitor.sync();assert.equal(s.received.length,4);assert.equal(s.state.cursors.a.uid,4);
 await s.monitor.sync();assert.equal(s.received.length,5);assert.equal(s.received.at(-1).historical,false);assert.equal(s.state.cursors.a.uid,5);
});
