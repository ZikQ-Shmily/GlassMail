import assert from 'node:assert/strict';
import test from 'node:test';
import updates from '../electron/updates.cjs';

const project = 'https://github.com/ZikQ-Shmily/GlassMail';
const tag = 'v1.0.10';

function asset(name, overrides = {}) {
  return {name, state: 'uploaded', size: 100, browser_download_url: `${project}/releases/download/${tag}/${encodeURIComponent(name)}`, ...overrides};
}

function response(assets, overrides = {}) {
  return Response.json({tag_name: tag, draft: false, prerelease: false, assets, ...overrides});
}

function setup(fetchRelease, platform = 'darwin', arch = 'arm64', currentVersion = '1.0.9') {
  const opened = [];
  const service = updates.createUpdateService({currentVersion, platform, arch, fetchRelease, openExternal: async url => opened.push(url)});
  return {opened, service};
}

test('latest update selects the installer for each supported architecture', async () => {
  const intel = asset('GlassMail-1.0.10.dmg');
  const apple = asset('GlassMail-1.0.10-arm64.dmg');
  const windows = asset('GlassMail.Setup.1.0.10.exe');
  const zip = asset('GlassMail-1.0.10-arm64-mac.zip');
  for (const [platform, arch, expected] of [['darwin', 'arm64', apple], ['darwin', 'x64', intel], ['win32', 'x64', windows]]) {
    const {service, opened} = setup(async () => response([zip, intel, apple, windows]), platform, arch);
    assert.deepEqual(await service.checkUpdate(), {status: 'available', currentVersion: '1.0.9', latestVersion: '1.0.10'});
    await service.openUpdate('https://example.com/other-installer');
    assert.deepEqual(opened, [expected.browser_download_url]);
  }
});

test('update check does not offer downgrades or pre-releases', async () => {
  const {service, opened} = setup(async () => response([]), 'darwin', 'arm64', '1.1.0');
  assert.equal((await service.checkUpdate()).status, 'current');
  await assert.rejects(service.openUpdate(), /请先检查更新/);
  assert.deepEqual(opened, []);
  const prerelease = setup(async () => response([], {tag_name: 'v1.1.0-beta.1', prerelease: true}));
  await assert.rejects(prerelease.service.checkUpdate(), /无法读取/);
});

test('update check refuses unrelated links, incomplete uploads and the wrong architecture', async () => {
  const {service, opened} = setup(async () => response([
    asset('GlassMail-1.0.10.dmg'),
    asset('GlassMail-1.0.10-arm64.dmg', {browser_download_url: 'https://github.com/other/GlassMail/releases/download/v1.0.10/GlassMail-1.0.10-arm64.dmg'}),
    asset('GlassMail-1.0.10-arm64-mac.zip', {state: 'starter'}),
  ]));
  assert.equal((await service.checkUpdate()).status, 'unavailable');
  await assert.rejects(service.openUpdate(), /请先检查更新/);
  await service.openProject('https://example.com');
  assert.deepEqual(opened, [project]);
});

test('concurrent checks share a request and a failed retry preserves a verified installer', async () => {
  const installer = asset('GlassMail-1.0.10-arm64.dmg');
  let calls = 0;
  let finishRequest;
  const {service, opened} = setup(() => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finishRequest = resolve; });
    if (calls === 2) return Promise.resolve(new Response(null, {status: 429}));
    return Promise.resolve(response([]));
  });
  const first = service.checkUpdate();
  assert.equal(service.checkUpdate(), first);
  finishRequest(response([installer]));
  await first;
  assert.equal(calls, 1);
  await assert.rejects(service.checkUpdate(), /暂时限制/);
  await service.openUpdate();
  assert.deepEqual(opened, [installer.browser_download_url]);
  await service.checkUpdate();
  await assert.rejects(service.openUpdate(), /请先检查更新/);
});
