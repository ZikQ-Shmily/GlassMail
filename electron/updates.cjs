const projectUrl = 'https://github.com/ZikQ-Shmily/GlassMail';
const releasesUrl = 'https://api.github.com/repos/ZikQ-Shmily/GlassMail/releases/latest';

function versionParts(version) {
  const pattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
  return typeof version === 'string' ? pattern.exec(version)?.slice(1).map(Number) : undefined;
}

function isNewer(candidate, current) {
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

function installerNames(platform, arch, version) {
  if (platform === 'win32' && arch === 'x64') {
    // GitHub release uploads can convert spaces in electron-builder's filename to dots.
    return [`GlassMail.Setup.${version}.exe`, `GlassMail Setup ${version}.exe`];
  }
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    const suffix = arch === 'arm64' ? '-arm64' : '';
    return [`GlassMail-${version}${suffix}.dmg`, `GlassMail-${version}${suffix}-mac.zip`];
  }
  return [];
}

async function queryRelease(fetchRelease) {
  let response;
  try {
    response = await fetchRelease(releasesUrl, {
      headers: {Accept: 'application/vnd.github+json'},
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw Error('无法连接 GitHub，请检查网络后重试');
  }
  if (response.status === 403 || response.status === 429) {
    throw Error('GitHub 暂时限制了更新检查，请稍后重试');
  }
  if (!response.ok) throw Error('暂时无法获取更新信息，请稍后重试');
  try {
    return await response.json();
  } catch {
    throw Error('无法读取 GitHub 发布信息，请稍后重试');
  }
}

function createUpdateService({currentVersion, platform, arch, fetchRelease, openExternal}) {
  let pendingCheck;
  let downloadUrl;

  async function check() {
    const current = versionParts(currentVersion);
    if (!current || !installerNames(platform, arch, currentVersion).length) {
      return {status: 'unavailable', currentVersion};
    }
    const release = await queryRelease(fetchRelease);
    const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
    const latestVersion = tag.slice(1);
    const latest = tag.startsWith('v') && versionParts(latestVersion);
    if (release?.draft !== false || release?.prerelease !== false || !latest || !Array.isArray(release.assets)) {
      throw Error('无法读取 GitHub 发布信息，请稍后重试');
    }
    if (!isNewer(latest, current)) return {status: 'current', currentVersion, latestVersion};

    for (const name of installerNames(platform, arch, latestVersion)) {
      const url = `${projectUrl}/releases/download/${tag}/${encodeURIComponent(name)}`;
      const asset = release.assets.find(item => item?.name === name && item.state === 'uploaded'
        && item.size > 0 && item.browser_download_url === url);
      if (asset) {
        return {status: 'available', currentVersion, latestVersion, downloadUrl: url};
      }
    }
    return {status: 'unavailable', currentVersion, latestVersion};
  }

  function checkUpdate() {
    if (!pendingCheck) {
      pendingCheck = check().then(({downloadUrl: url, ...result}) => {
        downloadUrl = url;
        return result;
      }).finally(() => { pendingCheck = undefined; });
    }
    return pendingCheck;
  }

  async function openUpdate() {
    if (!downloadUrl) throw Error('请先检查更新，确认有可下载的安装包');
    try {
      await openExternal(downloadUrl);
    } catch {
      throw Error('无法打开下载链接，请稍后重试');
    }
  }

  async function openProject() {
    try {
      await openExternal(projectUrl);
    } catch {
      throw Error('无法打开 GitHub 项目主页');
    }
  }

  return {checkUpdate, openUpdate, openProject};
}

module.exports = {createUpdateService};
