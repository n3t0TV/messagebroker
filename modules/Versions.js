const path = require('path');
const simpleGit = require('simple-git');
const BACKEND_PATH = path.join(__dirname, '..');
const backend = simpleGit(BACKEND_PATH);
const versions = { backend: null, frontend: null }
// Backend version is only fetched once

/**
 * 
 * @returns {Promise}
 */
function getBackendVersion() {
  return new Promise(resolve => {
    backend.branch().then(backendData => {
      for (let b in backendData.branches) {
        const branch = backendData.branches[b];
        if (branch.current) {
          versions.backend = branch;
          break;
        }
      }
      resolve(versions.backend);
    });
  });
};


async function getVersion() {
  return versions
}

module.exports = {
  backendVersion: getBackendVersion(),
  versions,
  getVersion
};