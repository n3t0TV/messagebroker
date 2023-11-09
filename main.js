/* global __dirname, Buffer */
const colors = require('colors');
const Versions = require('./modules/Versions');
const argv = require('./modules/Arguments');

(async function () {
    const backendVersion = await Versions.backendVersion;
    const labelLines = backendVersion.label.match(/(.{1,19}\S)(?:\s+|$)|(.{20})", @"$1$2\r\n/g);
    console.info('*********************************'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, ' Tortoise vehicle server '.brightBlue, '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, '                 __      ', '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, "      .,-;-;-,. /'_\\     ", '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, '    _/_/_/_|_\\_\\) /      ', '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, "  '-<_,-.><_><,-./       ", '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, "     ( o )===( o )       ", '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, '      `-\´     `-\´        ', '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, '          2021           '.green, '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, ''.green, backendVersion.name.padEnd(24, ' ').gray, '***'.brightYellow.bgBrightGreen);
    console.info('***'.brightYellow.bgBrightGreen, ''.green, backendVersion.commit.padEnd(24, ' ').gray.underline, '***'.brightYellow.bgBrightGreen);
    for (const line of labelLines) {
        console.info('***'.brightYellow.bgBrightGreen, ''.green, line.padEnd(24, ' ').gray, '***'.brightYellow.bgBrightGreen);
    }
    console.info('*********************************'.brightYellow.bgBrightGreen);
})();


const HTTPS_PORT = argv.https || 443;
const HTTP_PORT = argv.http || 80;
const MQTT_PORT = argv.mqtt || 8883;

const { app, setVehicleBroker } = require('./modules/WebApp')
const httpsServer = require('./modules/HttpsServer.js')(app, HTTPS_PORT, HTTP_PORT);
const { vehicleBroker } = require('./modules/VehicleBroker')(MQTT_PORT, httpsServer);
setVehicleBroker(vehicleBroker);
