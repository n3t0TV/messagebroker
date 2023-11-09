const path = require('path');
const CONFIG_PATH = path.join(__dirname, '..','..', 'teleopsconfig');
const LOCAL_PATH = path.join(CONFIG_PATH, 'local.json');
const MANAGED_PATH = path.join(CONFIG_PATH, 'managed.json');
const fs = require('fs');


const config = {};
if (fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(LOCAL_PATH)) {
        Object.assign(config, JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8')));
    }
    if (fs.existsSync(MANAGED_PATH)) {
        Object.assign(config, JSON.parse(fs.readFileSync(MANAGED_PATH, 'utf8')));
    }
}
console.log("Configuración cargada:".green);
console.log(config);
module.exports = config;
