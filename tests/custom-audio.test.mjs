import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import audio from '../electron/custom-audio.cjs';

async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'glassmail-audio-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

test('FLAC import accepts the 100 MB boundary and rejects larger files', async t => {
  const dir = await workspace(t);
  const source = path.join(dir, 'test.FLAC');
  await writeFile(source, 'fLaC');
  await truncate(source, audio.maxSize);
  const sound = await audio.importSound(dir, source);
  assert.equal(sound.name, 'test.FLAC');
  assert.equal(sound.type, 'audio/flac');
  assert.equal((await stat(sound.path)).size, 100 * 1024 * 1024);
  assert.deepEqual(await audio.loadSound(dir, sound.file, sound.name), sound);

  await truncate(source, audio.maxSize + 1);
  await assert.rejects(audio.importSound(dir, source), /不能超过 100 MB/);
  assert.equal((await stat(sound.path)).size, audio.maxSize);
});

test('custom audio serves byte ranges and refuses unrelated URLs', async t => {
  const dir = await workspace(t);
  const source = path.join(dir, 'test.flac');
  await writeFile(source, 'fLaC012345');
  const sound = await audio.importSound(dir, source);

  const get = (range, method = 'GET', url = sound.url) =>
    audio.serveSound(new Request(url, {method, headers: range ? {Range: range} : {}}), sound);
  const full = await get();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/flac');
  assert.equal(await full.text(), 'fLaC012345');
  const head = await get(null, 'HEAD');
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  const range = await get('bytes=4-6');
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 4-6/10');
  assert.equal(await range.text(), '012');
  assert.equal(await (await get('bytes=-2')).text(), '45');
  assert.equal(await (await get('bytes=8-')).text(), '45');
  assert.equal((await get('bytes=10-')).status, 416);
  assert.equal((await get(null, 'GET', 'glassmail-audio://local/glassmail.json')).status, 404);
  assert.equal(await audio.loadSound(dir, '../test.flac', 'test'), null);
});

test('older custom audio migrates from a data URL to a persistent file', async t => {
  const dir = await workspace(t);
  const legacyPath = path.join(dir, 'custom-sound.txt');
  const bytes = Buffer.from('old-audio');
  await writeFile(legacyPath, `data:audio/ogg;base64,${bytes.toString('base64')}`);
  const sound = await audio.migrateLegacySound(dir, '旧音效.ogg');
  assert.equal(sound.name, '旧音效.ogg');
  assert.equal(sound.type, 'audio/ogg');
  assert.deepEqual(await readFile(sound.path), bytes);
  assert.deepEqual(await audio.loadSound(dir, sound.file, sound.name), sound);
});
