// Use the integrity hashes shipped with the pinned official Electron npm package.
// This avoids an extra network request for a fresh SHASUMS256.txt on every build.
module.exports = {
  ...require('./package.json').build,
  electronDownload: {mirrorOptions: {}, checksums: require('./node_modules/electron/checksums.json')}
};
