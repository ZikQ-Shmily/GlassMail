const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const scheme = 'glassmail-audio';
const maxSize = 100 * 1024 * 1024;
const types = {mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac'};
const extensions = Object.keys(types);
const sizeError = '音频文件不能超过 100 MB';

function describeSound(directory, file, name) {
  const extension = file.split('.').at(-1);
  return {
    file,
    name,
    path: path.join(directory, file),
    type: types[extension],
    url: `${scheme}://local/${file}`
  };
}

async function loadSound(directory, file, name) {
  if (typeof file !== 'string' || !/^custom-sound-[a-f0-9-]{36}\.(mp3|wav|ogg|flac)$/.test(file)) return null;
  const sound = describeSound(directory, file, name || '自定义音频');
  try {
    const stat = await fs.promises.stat(sound.path);
    return stat.isFile() && stat.size > 0 && stat.size <= maxSize ? sound : null;
  } catch {
    return null;
  }
}

async function importSound(directory, sourcePath) {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (!extensions.includes(extension)) throw Error('请选择 MP3、WAV、OGG 或 FLAC 文件');
  const source = await fs.promises.open(sourcePath, 'r');
  const sound = describeSound(directory, `custom-sound-${randomUUID()}.${extension}`, path.basename(sourcePath));
  try {
    const stat = await source.stat();
    if (!stat.isFile() || !stat.size) throw Error('请选择非空的音频文件');
    if (stat.size > maxSize) throw Error(sizeError);
    // Read at most one byte beyond the limit in case the source grows during copying.
    await pipeline(
      source.createReadStream({end: maxSize, autoClose: false}),
      fs.createWriteStream(sound.path, {flags: 'wx', mode: 0o600})
    );
    const saved = await fs.promises.stat(sound.path);
    if (saved.size > maxSize) throw Error(sizeError);
    if (!saved.size) throw Error('音频文件为空');
    return sound;
  } catch (error) {
    await removeSound(sound);
    throw error;
  } finally {
    await source.close();
  }
}

async function migrateLegacySound(directory, name) {
  const legacyPath = path.join(directory, 'custom-sound.txt');
  const stat = await fs.promises.stat(legacyPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  // Older versions stored at most 5 MiB as a data URL.
  if (!stat?.isFile() || stat.size > Math.ceil(5 * 1024 * 1024 / 3) * 4 + 64) return null;
  const legacy = await fs.promises.readFile(legacyPath, 'utf8');
  const match = /^data:(audio\/(?:mpeg|wav|ogg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(legacy);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
  const extension = extensions.find(ext => types[ext] === match[1]);
  const sound = describeSound(directory, `custom-sound-${randomUUID()}.${extension}`, name || '自定义音频');
  try {
    await fs.promises.writeFile(sound.path, bytes, {flag: 'wx', mode: 0o600});
    return sound;
  } catch (error) {
    await removeSound(sound);
    throw error;
  }
}

async function removeSound(sound) {
  if (sound) await fs.promises.rm(sound.path, {force: true}).catch(() => {});
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const length = Number(match[2]);
    return length > 0 ? {start: Math.max(0, size - length), end: size - 1} : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end ? {start, end} : null;
}

async function serveSound(request, sound) {
  // Only the current imported file is reachable. The request never supplies a disk path.
  if (!sound || request.url !== sound.url) return new Response(null, {status: 404});
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}});
  }
  const file = await fs.promises.open(sound.path, 'r').catch(() => null);
  if (!file) return new Response(null, {status: 404});
  let streaming = false;
  try {
    const stat = await file.stat();
    const size = stat.size;
    if (!stat.isFile() || !size || size > maxSize) return new Response(null, {status: 404});

    const headers = {'Content-Type': sound.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
    const requestedRange = request.headers.get('range');
    const range = requestedRange === null ? {start: 0, end: size - 1} : byteRange(requestedRange, size);
    if (!range) {
      headers['Content-Range'] = `bytes */${size}`;
      return new Response(null, {status: 416, headers});
    }
    headers['Content-Length'] = String(range.end - range.start + 1);
    const status = requestedRange === null ? 200 : 206;
    if (status === 206) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    if (request.method === 'HEAD') return new Response(null, {status, headers});

    const stream = file.createReadStream(range);
    streaming = true;
    return new Response(Readable.toWeb(stream, {
      strategy: {highWaterMark: stream.readableHighWaterMark, size: chunk => chunk.byteLength}
    }), {status, headers});
  } finally {
    if (!streaming) await file.close();
  }
}

module.exports = {scheme, extensions, maxSize, loadSound, importSound, migrateLegacySound, removeSound, serveSound};
