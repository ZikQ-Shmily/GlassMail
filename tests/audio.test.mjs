import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Load browser ESM without changing the Electron package's CommonJS configuration.
const source = await readFile(new URL('../src/audio.js',import.meta.url),'utf8');
const {playSound,stopSound,onSoundState} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const deferred = () => {let resolve,reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject};};

function environment(t) {
  const contexts = [], audios = [];
  let resumeGate = null, playGate = null;
  class FakeContext {
    constructor() {this.state='running';this.currentTime=10;this.destination={};this.oscillators=[];this.gains=[];this.closed=0;contexts.push(this);}
    resume() {return resumeGate?.promise || Promise.resolve();}
    close() {this.state='closed';this.closed++;this.onstatechange?.();return Promise.resolve();}
    createOscillator() {
      const oscillator = {frequency:{value:0},connect(){},disconnect(){this.disconnected=true;},start(time){this.started=time;},stop(time){if(time===undefined)this.stopped=true;else this.endsAt=time;},end(){this.onended?.();}};
      this.oscillators.push(oscillator);return oscillator;
    }
    createGain() {const gain={gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){this.disconnected=true;}};this.gains.push(gain);return gain;}
  }
  class FakeAudio {
    constructor(src) {this.src=src;this.currentTime=12;this.pauseCount=0;this.playing=false;audios.push(this);}
    play() {return (playGate?.promise || Promise.resolve()).then(() => {this.playing=true;});}
    pause() {this.pauseCount++;this.playing=false;}
    end() {this.onended?.();}
    fail() {this.onerror?.();}
  }
  const originalContext = globalThis.AudioContext, originalAudio = globalThis.Audio;
  globalThis.AudioContext=FakeContext;globalThis.Audio=FakeAudio;
  t.mock.timers.enable({apis:['setTimeout']});
  t.after(() => {stopSound();globalThis.AudioContext=originalContext;globalThis.Audio=originalAudio;});
  const states=[], unsubscribe=onSoundState(state=>states.push(state));
  t.after(unsubscribe);
  return {contexts,audios,states,resumeGate(gate){resumeGate=gate;},playGate(gate){playGate=gate;},state:()=>states.at(-1)};
}

test('内置音默认单次播放，结束后释放声音并通知空闲状态',async t=>{
  const env=environment(t);
  assert.deepEqual(env.state(),{playing:false,name:null,loop:false});
  await playSound('glass',65);
  assert.deepEqual(env.state(),{playing:true,name:'glass',loop:false});
  const context=env.contexts[0];
  assert.equal(context.oscillators.length,3);
  for (const oscillator of context.oscillators) oscillator.end();
  assert.deepEqual(env.state(),{playing:false,name:null,loop:false});
  assert.equal(context.closed,1);
  t.mock.timers.tick(10000);
  assert.equal(context.oscillators.length,3);
});

test('内置音完整播放后间隔 500ms 循环，停止取消后续播放',async t=>{
  const env=environment(t);
  await playSound('beacon',50,null,{loop:true});
  const context=env.contexts[0];
  assert.equal(context.oscillators.length,5);
  for (const oscillator of [...context.oscillators]) oscillator.end();
  t.mock.timers.tick(499);assert.equal(context.oscillators.length,5);
  t.mock.timers.tick(1);assert.equal(context.oscillators.length,10);
  for (const oscillator of context.oscillators.slice(5)) oscillator.end();
  stopSound();
  t.mock.timers.tick(5000);
  assert.equal(context.oscillators.length,10);
  assert.equal(context.closed,1);
  assert.equal(env.state().playing,false);
});

test('新的提醒取代旧循环；正在播放的旧节点立即停止且过期回调不重播',async t=>{
  const env=environment(t);
  await playSound('beacon',50,null,{loop:true});
  const old=env.contexts[0], staleEnd=old.oscillators.at(-1).onended;
  await playSound('chime',50,null,{loop:true});
  assert.equal(old.closed,1);
  assert.ok(old.oscillators.every(node=>node.stopped && node.disconnected));
  staleEnd();t.mock.timers.tick(5000);
  assert.equal(old.oscillators.length,5);
  assert.equal(env.contexts[1].oscillators.length,4);
  assert.deepEqual(env.state(),{playing:true,name:'chime',loop:true});
});

test('AudioContext.resume 等待期间停止或被替代，完成后不会恢复旧声音',async t=>{
  const env=environment(t), gate=deferred();env.resumeGate(gate);
  const pending=playSound('glass',65,null,{loop:true});
  assert.equal(env.state().playing,true);
  stopSound();
  env.resumeGate(null);
  await playSound('pulse');
  gate.resolve();await pending;
  assert.equal(env.contexts[0].oscillators.length,0);
  assert.equal(env.contexts[0].closed,1);
  assert.equal(env.contexts[1].oscillators.length,4);
  assert.equal(env.state().name,'pulse');
});

test('自定义音频使用原生循环，停止会暂停、复位且取消监听',async t=>{
  const env=environment(t);
  await playSound('custom',40,'data:audio/wav;base64,test',{loop:true});
  const audio=env.audios[0];
  assert.equal(audio.loop,true);assert.equal(audio.volume,.4);assert.equal(audio.playing,true);
  stopSound();
  assert.equal(audio.playing,false);assert.equal(audio.currentTime,0);
  assert.equal(audio.onended,null);assert.equal(audio.onerror,null);
  assert.deepEqual(env.state(),{playing:false,name:null,loop:false});
});

test('停止尚未完成的自定义 play，延迟完成不会复活声音或覆盖新提醒状态',async t=>{
  const env=environment(t), gate=deferred();env.playGate(gate);
  const pending=playSound('custom',40,'data:audio/wav;base64,test',{loop:true});
  stopSound();
  await playSound('chime');
  gate.resolve();await pending;
  assert.equal(env.audios[0].playing,false);assert.equal(env.audios[0].pauseCount,2);
  assert.equal(env.state().name,'chime');
});

test('自定义音频单次结束或后续错误会恢复空闲状态',async t=>{
  const env=environment(t);
  await playSound('custom',60,'data:audio/wav;base64,test');
  assert.equal(env.audios[0].loop,false);
  env.audios[0].end();assert.equal(env.state().playing,false);
  await playSound('custom',60,'data:audio/wav;base64,test',{loop:true});
  env.audios[1].fail();assert.equal(env.state().playing,false);
});

test('启动失败会释放资源并报告错误；取消引起的拒绝不会误报',async t=>{
  const env=environment(t), failure=Error('device unavailable'), gate=deferred();env.resumeGate(gate);
  const pending=playSound('glass',65,null,{loop:true});
  gate.reject(failure);await assert.rejects(pending,failure);
  assert.equal(env.contexts[0].closed,1);assert.equal(env.state().playing,false);
  const cancelled=deferred();env.playGate(cancelled);
  const play=playSound('custom',40,'data:audio/wav;base64,test',{loop:true});
  stopSound();cancelled.reject(Error('play aborted'));await assert.doesNotReject(play);
  assert.equal(env.state().playing,false);
});

test('外部关闭音频上下文会取消循环；取消订阅后不再发状态',async t=>{
  const env=environment(t), states=[], unsubscribe=onSoundState(state=>states.push(state));
  assert.equal(states.length,1);unsubscribe();
  await playSound('pulse',65,null,{loop:true});
  const context=env.contexts[0];
  for (const oscillator of [...context.oscillators]) oscillator.end();
  await context.close();
  t.mock.timers.tick(1000);
  assert.equal(context.oscillators.length,4);
  assert.equal(env.state().playing,false);assert.equal(states.length,1);
});
