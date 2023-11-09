
const PUBLIC_HTML_PATH = ['..', 'public_html'];
const express = require('express');
//const session = require('express-session');
const app = express();
const path = require('path');
const PUBLIC_HTML_ABSOLUTE_PATH = path.join(__dirname, ...PUBLIC_HTML_PATH);
const vehicleMaster = require('./VehicleMaster.js');
const { authenticateToken } = require('./APIAuthentication.js');
const { Console } = require('console');
let vehicleBroker;

app.use(express.static(PUBLIC_HTML_ABSOLUTE_PATH));



/*
const FileStore = require('session-file-store')(session);
const sessionMiddleware = session({
    name: 'TortoiseSession',
    secret: 'ff63dd8bee9ecfa7802',
    store: new FileStore,
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: true,
        httpOnly: true
    }
});*/

app.use(function (req, res, next) {
    if (req.secure) {
        next();
    } else {
        res.redirect('https://' + req.headers.host + req.url);
    }
});


app.use(function (err, req, res, next) {
    res.status(400).send('BAD REQUEST');
});

//app.use(sessionMiddleware);

app.use(express.json()); // to support JSON-encoded bodies
app.use(express.urlencoded({
    extended: true
}));

app.get('/heartbeat', (req, res) => {
    const uid_physical = req.query.UID_PHYSICAL || '-';
    const battery = req.query.BATTERY;
    const gps = {
        lat: req.query.GPS_LAT,
        lon: req.query.GPS_LON,
        alt: req.query.ALTITUD
    };
    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const versions = {
        'brain': req.query.VERSION_BRAIN || 'NA',
        'firmware': req.query.VERSION_FIRMWARE || 'NA'
    };
    vehicleMaster.heartbeat(req.query, uid_physical, gps, req.query.RSSI, req.query.ERROR_BITRATE,
        req.query.BANDWIDTH, req.query.BATTERY, ip_address, versions)
        .then(response => {
            console.log('❤ '.red + uid_physical.green);
            if (vehicleMaster.vehicles[uid_physical]) {
                vehicleMaster.vehicles[uid_physical].httpConnected = true;
            } else {
                console.log('💔 '.red + uid_physical.red + uid_physical, 'heartbeat but not in array'.red);
            }
            vehicleBroker.sendUpdate(uid_physical);
            vehicleBroker.publish('heartbeat', vehicleBroker.heartbeatRewrite(req.query, response));
            res.send(response);
        }).catch(err => {
            console.log('💔 '.red + uid_physical.red + ': ', err);
            res.send(err);
        });
});
app.get('/conexionVehiculo', (req, res) => {
    const uid_physical = req.query.UID_PHYSICAL || '-';
    vehicleMaster.getConnection(uid_physical)
        .then(response => {
            res.send(response);
            console.log('▶ '.blue + uid_physical.green);
            if (vehicleMaster.vehicles[uid_physical]) {
                vehicleMaster.vehicles[uid_physical].httpConnected = true;
            } else {
                console.log('Connection: '.red + uid_physical.red + uid_physical, 'conexionVehiculo but not in array'.red);
            }
            if (!vehicleBroker) {
                return;
            }

            vehicleBroker.sendUpdate(uid_physical);
            if (!vehicleBroker.heartbeatcache[uid_physical]) {
                const fakeheartbeat = vehicleBroker.heartbeatRewrite(req.query, response);
                vehicleBroker.publish('heartbeat', fakeheartbeat);
            }
        })
        .catch(err => {
            console.log(err);
            res.send(err);
            console.log('🛇 '.blue + uid_physical.toString().red + ': ' + err);
        });
});

app.get('/ssl/key/2TRLAHCA78AITTP0', (req, res) => {
    const file = `/etc/letsencrypt/live/local.tortops.com/privkey.pem`;
    res.download(file, 'key.pem');
});

app.get('/ssl/cert/2TRLAHCA78AITTP0', (req, res) => {
    const file = `/etc/letsencrypt/live/local.tortops.com/cert.pem`;
    res.download(file, 'cert.pem');
});

app.get('/ssl/chain/2TRLAHCA78AITTP0', (req, res) => {
    const file = `/etc/letsencrypt/live/local.tortops.com/cert.pem`;
    res.download(file, 'chain.pem');
});
/*
 API HTTP
 */
app.post('/api', (req, res) => {
    const data = req.body;
    const response = {};

    res.setHeader('Content-Type', 'application/json');
    authenticateToken(data.token).then(async authResponse => {
        if (!authResponse) { // Si no hay autorización
            response.error = 'UNAUTHORIZED';
            res.status(401).send(response);
            console.log('×httpAPI '.red, 'UNAUTHORIZED'.red, req.connection.remoteAddress);
            return;
        }
        switch (data.request) {
            case 'GET_FRONTEND_TOKEN':
                const token = vehicleBroker.getTemptoken('FRONTEND');
                response.token = token;
                res.send(response);
                break;
            case 'SEND_STATUS':
                vehicleBroker.sendStatus(data.IMEI).then(() => {
                    res.send(response);
                }).catch(() => {
                    response.error = 'SEND_STATUS_ERROR';
                    res.status(500).send(response);
                });
                break;
            case 'SEND_STATUS_MONITOR':
                vehicleBroker.sendStatusMonitor(data.IMEI,data.idTeleop).then(() => {
                    res.send(response);
                }).catch(() => {
                    response.error = 'SEND_STATUS_ERROR';
                    res.status(500).send(response);
                });
                break;
            case 'SEND_HALT':
                vehicleBroker.sendHalt(data.IMEI).then(() => {
                    res.send(response);
                }).catch(() => {
                    response.error = 'SEND_HALT_ERROR';
                    res.status(500).send(response);
                });
                break;
            case 'GET_VEHICLE_INFO':
                const imei = data.imei;
                if (!vehicleMaster.vehicles[imei]) {
                    response.error = 'VEHICLE NOT FOUND';
                    res.status(404).send(response);
                    console.log('×httpAPI '.red, 'VEHICLE_NOT_FOUND'.red, data.imei);
                    return;
                }
                const vehicleData = vehicleMaster.vehicles[imei].getData();
                vehicleData.connection = vehicleMaster.connections[imei] || { 'server': 1, 'IP': '187.188.112.95', 'doamin': 'cdmx.teleop.tortops.com' };
                res.send(vehicleData);
                break;
            case 'GET_VEHICLE_INFO_BY_ID':
                const id = data.id;
                let imeir = null;
                for (let physicalId in vehicleMaster.vehicles) {
                    if (Number(vehicleMaster.vehicles[physicalId].uid) === Number(id)) {
                        imeir = physicalId;
                        break;
                    }
                }
                if (!vehicleMaster.vehicles[imeir]) {
                    response.error = 'VEHICLE NOT FOUND';
                    res.status(404).send(response);
                    console.log('×httpAPI '.red, 'VEHICLE_NOT_FOUND'.red, data.imei);
                    return;
                }
                const vehicleData2 = vehicleMaster.vehicles[imeir].getData();
                vehicleData2.connection = vehicleMaster.connections[imeir] || { 'server': 1, 'IP': '187.188.112.95', 'doamin': 'cdmx.teleop.tortops.com' };
                res.send(vehicleData2);
                break;
            case 'SET_VEHICLE_CONNECTION':
                vehicleMaster.setConnection(data);
                vehicleBroker.sendHalt(data.IMEI).then(() => {
                    res.send(response);
                }).catch(() => {
                    response.error = 'SEND_HALT_ERROR';
                    res.status(500).send(response);
                });
                vehicleBroker.sendUpdate(uid_physical);
                break;
            case 'SET_REMOTEIT':
                console.log(data.imei, Object.keys(vehicleMaster.vehicles));
                if (await vehicleMaster.setRemoteIt(data)) {
                    response.result = 'success';
                    res.status(200).send(response);
                } else {
                    response.request = data;
                    response.error = 'VEHICLE_NOT_FOUND';
                    res.status(400).send(response);
                }
                break;
            case 'LIST_ALL':
                response.data = await vehicleMaster.listAll();
                response.result = 'success';
                res.status(200).send(response);
                break;
            case 'CHANGE_STATUS':
                response.data = await vehicleMaster.changeStatus(data.imei, data.status);
                response.result = 'success';
                vehicleBroker.sendUpdate(data.imei);
                vehicleBroker.sendStatus(data.imei);
                if (response.data.statusId == -1) {
                    vehicleMaster.delete(data.imei);
                }
                res.status(200).send(response);
                break;
            case 'MAC_AUTH_RESET':
                response.data = await vehicleMaster.macReset(data.imei);
                response.result = 'success';
                vehicleBroker.sendUpdate(data.imei);
                res.status(200).send(response);
                break;
            case 'SET_UI_SETUP':
                response.data = await vehicleMaster.setUiSetup(data.imei, data.uiSetup);
                response.result = 'success';
                vehicleBroker.sendUpdate(data.imei);
                res.status(200).send(response);
                break

            case 'UPDATE_QUANTITY':
                console.log('Updating quantity',data.sku);
                console.log('New quantity',data.quantity);
                vehicleBroker.updateContainerQuantity(data.sku,data.quantity);
                res.status(200).send(response);
                break;
            default:
                res.status(400).send(response);
                break;
        }
    }).catch(e => {
        response.error = 'UNAUTHORIZED';
        res.status(401).send(response);
        console.log('×httpAPI '.red, 'UNAUTHORIZED'.red, req.connection.remoteAddress, e);
        return;
    });
});

app.post('/error', async (req, res) => {
    const data = req.body;
    const response = {};
    res.setHeader('Content-Type', 'application/json');
    await vehicleMaster.errorStatus(data.mqttTopic, data.rawMsg)
        .then(res => {
            res.send(response);
        })
        .catch(err => {
            response.error = 'UNAUTHORIZED';
            res.status(401).send(response);
        })

});

function setVehicleBroker(broker) {
    vehicleBroker = broker;
};


module.exports = { app, setVehicleBroker };
