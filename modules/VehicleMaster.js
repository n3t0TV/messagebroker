/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
const db = require('./Database');
const LocalStorage = require('node-localstorage').LocalStorage;
//const {insertHeartbeat} = require('./influx/querys/heartbeatInflux');
const localStorage = new LocalStorage('./localStorage');
const db_error_message = '{"ID_ESTATUS": 100, "DESCRIPCION_ESTATUS": "UNABLE TO CONNECT TO BD"}';
const db_noresult_message = '{"ID_ESTATUS": 101, "DESCRIPCION_ESTATUS": "NO RESULTS TO DISPLAY"}';
const colors = require('colors');
const bcrypt = require('bcryptjs')

const get_sesion_teleops = (imei) => new Promise((resolve, reject) => {
    db.query(`CALL VEHICLE_TELEOPERATION_SESION(${imei})`, (err, rows) => {
        if (err) return reject(err);
        return resolve(rows);
    });
});


class VehicleMaster {
    constructor() {
        this.connections = {};
        if (localStorage.connections) {
            this.connections = JSON.parse(localStorage.connections);
        }
        this.vehicles = {};
        this.teleoperators={};
    }

    async ready() {
        await this.loadTeleoperators();
        await this.loadVehicles();

        console.log('Preload complete ', '✓'.green);
    }

    loadTeleoperators()
    {
      return new Promise((resolve, reject) => {
          db.query("CALL USER_LIST();", (err, response) => {
              if (err) {
                  return reject(err);
              }


              for (const row of response[0]) {
                  this.teleoperators[row.UID_TELEOPERADOR.toString()]={user_id:row.user_id,user_email:row.user_email,user_name:row.user_name,user_profile:row.user_profile};
              }
              console.log('**Teleoperators**',this.teleoperators);
              resolve(this.teleoperators);
          });
      });
    }

    loadVehicles() {
        return new Promise((resolve, reject) => {
            db.query("CALL VEHICLE_LIST();", (err, response) => {
                if (err) {
                    return reject(err);
                }
                for (const row of response[0]) {
                    this.loadVehicle(row);
                }
                resolve(this.vehicles);
            });
        });
    }

    loadVehicle(data) {


        if (!this.vehicles[data.IMEI]) {
            this.vehicles[data.IMEI] = new Vehicle(this, data);
            if (!this.connections[data.IMEI]) {
                this.connections[data.IMEI] = { 'server': 8, 'IP': '35.236.101.117', 'domain': 'gcloud.teleop.tortops.com' };
            }
            this.vehicles[data.IMEI].connection = this.connections[data.IMEI];
        } else {
            this.vehicles[data.IMEI].update(data);
        }
        //set teleop name
        if(data.UID_MONITOR_TELEOP!=null && data.UID_MONITOR_TELEOP!=0 && this.teleoperators[data.UID_MONITOR_TELEOP]!='undefined')
        {
          //valid teleop assigned!
          const teleop=this.teleoperators[data.UID_MONITOR_TELEOP].user_name;
          this.vehicles[data.IMEI].teleop=teleop;
        }
        else {
          this.vehicles[data.IMEI].teleop='none';
        }


        return this.vehicles[data.IMEI];
    }

    async listAll() {
        const result = await db.call("VEHICLE_GET_BY_IMEI", '%', 1);
        return result;
    }

    async changeStatus(imei, status) {
        const result = await db.call("VEHICLE_CHANGE_STATUS", imei, status);
        this.loadVehicle(result[0]);
        return result[0];
    }

    delete(imei) {
        delete this.vehicles[imei];
    }

    setTeleoperator(imei,teleopId)
    {

      console.log('---Teleop id assignment---',teleopId);
      if(teleopId=='none' || teleopId=='undefined' || teleopId==null)
      {
        this.vehicles[imei].teleop='none';
      }
      else {
          const teleopidStr=teleopId.toString();

          console.log('TeleopId: ',teleopidStr);
          console.log('Teleoperator data: ',this.teleoperators[teleopidStr]);
          if(this.teleoperators[teleopidStr]!=null && this.teleoperators[teleopidStr]!='undefined')
              this.vehicles[imei].teleop=this.teleoperators[teleopidStr].user_name;
        }
    }
    clearTeleoperator(imei)
    {
      if(this.vehicles[imei]!=null && this.vehicles[imei]!='undefined')
          this.vehicles[imei].teleop='none';
    }

    exportVehicles(filter) {
        const vehicleList = [];
        for (let imei in this.vehicles) {
            const vehicle = this.vehicles[imei];
            switch (filter) {
                case 'available':
                    if (+(vehicle.status) === 3) {
                        vehicleList.push(vehicle.getData());
                    }
                    break;
                case 'usertrip':
                    if (+(vehicle.status) === 2) {
                        vehicleList.push(vehicle.getData());
                    }
                    break;
                case 'unavailable':
                    if (+(vehicle.status) === 1) {
                        vehicleList.push(vehicle.getData());
                    }
                    break;
                case 'teleoperation':
                    if (+(vehicle.status) === 5) {
                        vehicleList.push(vehicle.getData());
                    }
                    break;
                case 'delivery':
                    if (vehicle.delivery) {
                        vehicleList.push(vehicle.delivery);
                    }
                    break;
                default:
                    vehicleList.push(vehicle.getData());
                    break;
            }

        }
        return vehicleList;
    }

    setConnection(data) {
        console.log('Set connection: ', data);
        this.connections[data.IMEI] = {
            'server': data.server, 'IP': data.IP, 'domain': data.domain
        };
        this.vehicles[data.IMEI].connection = {
            'server': data.server, 'IP': data.IP, 'domain': data.domain
        };
        localStorage.setItem('connections', JSON.stringify(this.connections));
    }

    async getConnection(uid_physical) {
        const response = await db.call('CONEXION_VEHICULO_MAC', uid_physical);
        if (!response) {
            throw Error(db_error_message); // Error en la base de datos
        }
        if (!response[0]) {
            throw Error(db_noresult_message); //No hay resultados
        }
        if (!this.connections[uid_physical]) {
            this.connections[uid_physical] = { 'server': 8, 'IP': '35.236.101.117', 'domain': 'gcloud.teleop.tortops.com' };
        }
        if (response[0].IP_SERVIDOR) {
            response[0].IP_SERVIDOR = this.connections[uid_physical].IP; //Se remplaza IP por sandbox
        }

        if (this.vehicles[uid_physical]) { //Protección para estabilidad, pero debería existir.
            this.vehicles[uid_physical].status = response[0].ID_ESTATUS;
            if (Number(this.vehicles[uid_physical].status) === 5) {
                this.vehicles[uid_physical].session = response[0].UID_SESION_TELEOPS;
                this.vehicles[uid_physical].teleop = response[0].UID_TELEOPERADOR;
            } else {
                this.vehicles[uid_physical].session = 'none';
                this.vehicles[uid_physical].teleop = 'none';
            }

        }
        response[0].URL_SERVIDOR = this.connections[uid_physical].domain;
        return response[0]; //Todo bien
    }
    async setRemoteIt(data) {
        if (!this.vehicles[data.imei]) {
            return false;
        }
        const uid = this.vehicles[data.imei].uid;
        const devicename = data.remoteit;
        const response = await db.call('VEHICLE_SET_REMOTEIT_DEVICENAME', uid, devicename.substr(0, 32));
        this.vehicles[data.imei].remoteIt = devicename;
        return true;
    }

    errorStatus(mqttTopic, rawMsg) {
        rawMsg = `'${rawMsg}'`;
        return new Promise((resolve, reject) => {
            db.query(`CALL ADD_ERROR_STATUS(${mqttTopic}, ${rawMsg});`, (err, response) => {
                if (err) return reject(db_error_message)
                return resolve(response);
            })
        })
    }

    async heartbeat(fulldata, uid_physical, gps, rssi, errorBitRate, bandwidth, battery, ip, versions, flags) {
        if (!ip) {
            ip = '127.0.0.1';
        }
        if (ip.substr(0, 7) === "::ffff:") {
            ip = ip.substr(7);
        }
        if (!flags) {
            flags = {
                MODULE_CONNECTED: 0,
                SIM: 0,
                GPS_FIXED: 0,
                CAMERA_FRONT: 0,
                CAMERA_BACK: 0,
                PERFORMANCE: 0,
                VIDEO_CLIENT_CONNECTION: 0,
                VIDEO_FRAME_SENT: 0,
                SENSOR_CLIENT_CONNECTION: 0,
                SENSOR_BUFFER_SENT: 0,
                CONTROL_CLIENT_CONNECTION: 0,
                CONTROL_BUFFER_RECEIVED: 0,
            }
        }
        if (uid_physical && uid_physical !== '-') {
            const sesion_id = await get_sesion_teleops(uid_physical).then((response) => {
                if (!response[0][0] || !response[0])
                    return -1
                if (response[0][0].ID_ESTATUS === 1)
                    return response[0][0].UID_SESION_TELEOPS;
                return -1
            }).catch((error) => console.log('💔 Heartbeat error: '.red, error));
            /*  insertHeartbeat(sesion_id, uid_physical, gps, rssi, errorBitRate, bandwidth, battery, ip, versions, flags).catch((error) => {
             console.log('💔 Heartbeat influx insert error '.red, uid_physical.yellow, error.Error);
             });*/
        }
        return new Promise((resolve, reject) => {
            errorBitRate = errorBitRate || 0;
            bandwidth = bandwidth || 0;
            if (!uid_physical || !gps || isNaN(battery) || isNaN(rssi) || isNaN(errorBitRate) || isNaN(bandwidth)) {
                return reject(db_noresult_message); //Información incompleta
            }
            db.query("CALL VEHICLE_HEARTBEAT_UPDATE('" +
                ip + "','" +
                uid_physical + "'," +
                gps.lat + "," +
                gps.lon + "," +
                gps.alt + "," +
                battery + "," +
                rssi + "," +
                errorBitRate + "," +
                bandwidth + ",'" +
                versions.brain + "','" +
                versions.firmware + "'," +
                flags.MODULE_CONNECTED + "," +
                flags.SIM + "," +
                flags.GPS_FIXED + "," +
                flags.CAMERA_FRONT + "," +
                flags.CAMERA_BACK + "," +
                flags.PERFORMANCE + "," +
                flags.VIDEO_CLIENT_CONNECTION + "," +
                flags.VIDEO_FRAME_SENT + "," +
                flags.SENSOR_CLIENT_CONNECTION + "," +
                flags.SENSOR_BUFFER_SENT + "," +
                flags.CONTROL_CLIENT_CONNECTION + "," +
                flags.CONTROL_BUFFER_RECEIVED +
                ");",
                (err, response) => {
                    if (err) {
                        return reject(db_error_message); // Error en la base de datos
                    }
                    if (!response[0][0] || !response[0]) {
                        return reject(db_noresult_message); //No hay resultados
                    }
                    if (!this.connections[uid_physical]) {
                        this.connections[uid_physical] = { 'server': 8, 'IP': '35.236.101.117', 'domain': 'gcloud.teleop.tortops.com' };
                    }
                    response[0][0].connection = this.connections[uid_physical];
                    if (!this.vehicles[uid_physical]) { //Si no existe se crea
                        this.vehicles[uid_physical] = new Vehicle(this, {
                            IMEI: uid_physical,
                            uid: response[0][0].UID_VEHICULO,
                            status: response[0][0].ID_ESTATUS,
                            battery: battery,
                            gps: gps
                        });
                    }
                    //                        Se actualiza
                    const updateData = {
                        'status': response[0][0].ID_ESTATUS,
                        'gps': gps,
                        'battery': battery,
                        'flags': flags,
                        'rssi': rssi,
                        'provider': fulldata.PROVIDER,
                        'brain_branch': fulldata.BRAIN_BRANCH,
                        'brain_commit': fulldata.BRAIN_COMMIT,
                        'running_source': fulldata.RUNNING_SOURCE,
                        'volume': fulldata.AUDIO_VOLUME,
                    };
                    if (fulldata.JOYSTICK) {
                        updateData.controller =
                        {
                            connected: !!fulldata.JOYSTICK.CONNECTED,
                            mac: fulldata.JOYSTICK.MAC
                        }
                    } else {
                        updateData.controller =
                        {
                            connected: false,
                            mac: ''
                        }
                    }
                    if (fulldata.SPEAKER) {
                        updateData.speaker =
                        {
                            connected: !!fulldata.SPEAKER.CONNECTED,
                            mac: fulldata.SPEAKER.MAC
                        }
                    } else {
                        updateData.speaker =
                        {
                            connected: false,
                            mac: ''
                        }
                    }
                    this.vehicles[uid_physical].updateFromHeartbeat(updateData);
                    this.vehicles[uid_physical].heartbeatTimestamp = +new Date();
                    return resolve(response[0][0]);
                });
        });
    }
    async storeMac(uid_physical, mac_address) {
        const macHash = bcrypt.hashSync(mac_address, 10);
        const macEnding = mac_address.substr(-4);
        const response = await db.call('VEHICLE_SET_MAC', uid_physical, macEnding, macHash);
        this.vehicles[uid_physical].update(response[0]);
        return this.vehicles[uid_physical];
    }

    async containers(uid_physical) {
        const vehicle = this.vehicles[uid_physical];
        const containers = await db.call('CONTAINER_GET_BY_VEHICLE', vehicle.uid);
        const macs = { '1': '', '2': '' }
        for (const row of containers) {
            macs[String(row.CONTAINER_NUM)] = (row.BT_MAC.match(/.{1,2}/g) || []).join(":").toUpperCase();
        }

        return macs;
    }

    async macReset(uid_physical) {
        const response = await db.call('VEHICLE_SET_MAC', uid_physical, null, null);
        this.vehicles[uid_physical].update(response[0]);
        return response[0];
    }

    async setUiSetup(uid_physical, ui_setup) {

        const response = await db.call('VEHICLE_SET_UI_SETUP', uid_physical, ui_setup);
        this.vehicles[uid_physical].update(response[0]);
        return response[0];
    }

    async preregister(uid_physical, ip_address) {
        const response = await db.call('VEHICLE_PREREGISTER', uid_physical, ip_address.replace('::ffff:', ''));
        if (response.ID_ESTATUS == -1) return false;
        this.vehicles[response.IMEI] = new Vehicle(this, response);
        if (this.connections[response.IMEI]) {
            this.vehicles[response.IMEI].connection = this.connections[response.IMEI];
        }
        return true;
    }
}

class Vehicle {
    constructor(vehicleMaster, data) {
        this.vehicleMaster = vehicleMaster;
        this.imei = data.IMEI;
        this.uid = data.uid;
        this.mqttConnected = false;
        this.httpConnected = false;
        this.flags = {
            MODULE_CONNECTED: 0,
            SIM: 0,
            GPS_FIXED: 0,
            CAMERA_FRONT: 0,
            CAMERA_BACK: 0,
            PERFORMANCE: 0,
            VIDEO_CLIENT_CONNECTION: 0,
            VIDEO_FRAME_SENT: 0,
            SENSOR_CLIENT_CONNECTION: 0,
            SENSOR_BUFFER_SENT: 0,
            CONTROL_CLIENT_CONNECTION: 0,
            CONTROL_BUFFER_RECEIVED: 0,
        };
        this.provider = 'INITIAL_UNKNOWN';
        this.delivery = null;
        this.session = 'none';
        this.teleop = 'none';
        this.monitor = null;
        this.volume = null;
        this.update(data);
    }

    update(data) {
        this.externalUid = data.externalUid;
        this.status = data.statusId;
        this.operator = data.UID_OPERADOR;
        this.battery = data.battery || 0;
        this.rssi = data.rssi;
        this.type = data.type;
        this.gps = {
            'lat': data.gps_lat || 0,
            'lon': data.gps_lon || 0,
            'alt': data.gps_alt || 0
        };
        this.city = data.city || '-';
        this.operatorId = data.operatorId || '-';
        this.operatorName = data.operatorName || '-';
        this.versions = {
            'brain': data.brainVersion || '-',
            'firmware': data.firmwareVersion || '-'
        };
        this.remoteIt = data.remoteItDeviceName;
        this.uiSetup = data.uiSetup;
        this.macEnding = data.macEnding;
        this.macHash = data.macHash;


        //console.log('teleop: ',this.teleop);
    }


    getData() {
        const obj = {
            'imei': this.imei,
            'uid': this.uid,
            'externalUid': this.externalUid,
            'status': this.status,
            'battery': this.battery,
            'gps': this.gps,
            'city': this.city,
            'operatorId': this.operatorId,
            'operatorName': this.operatorName,
            'versions': this.versions,
            'connected': this.connected,
            'connection': this.connection,
            'mqtt': this.mqttConnected,
            'http': this.httpConnected,
            'rssi': this.rssi,
            'flags': this.flags,
            'type': this.type,
            'heartbeatTimestamp': this.heartbeatTimestamp,
            'remoteIt': this.remoteIt || '',
            'brain_branch': this.brain_branch,
            'brain_commit': this.brain_commit,
            'running_source': !!this.running_source,
            'provider': this.provider,
            'uiSetup': this.uiSetup,
            'macEnding': this.macEnding,
            'monitor': this.monitor,
            'volume': this.volume,
            'controller': this.controller,
            'speaker': this.speaker,
            'teleop':this.teleop
        };
        //    console.log(obj);
        return obj;
    }

    set httpConnected(connected) {
        this._httpConnected = !!connected;
        clearTimeout(this.httpTimeout);
        if (connected) {
            //console.log('HTTP '.yellow, this.uid + ' : ' + this.imei, ' after ', (Date.now() - this.lastHttp) / 1000, 'seconds', new Date());
            this.lastHttp = Date.now();
            this.httpTimeout = setTimeout(() => {
                console.log('D '.red, this.uid + ' : ' + this.imei, ' last HTTP: '.yellow, (Date.now() - this.lastHttp) / 1000, 'seconds ago', new Date());
                this._httpConnected = false;
            }, 6500);
        }
    }

    get httpConnected() {
        return this._httpConnected;
    }

    get connected() {
        return this.mqttConnected || this.httpConnected;
    }

    updateFromHeartbeat(hbdata) {
        this.timestamp = +new Date();
        this.status = hbdata.status;
        this.battery = hbdata.battery || '0';
        this.gps = hbdata.gps;
        this.rssi = hbdata.rssi || '0';
        this.flags = hbdata.flags;
        this.brain_branch = hbdata.brain_branch;
        this.brain_commit = hbdata.brain_commit;
        this.running_source = hbdata.running_source;
        this.provider = hbdata.provider || 'HEARTBEAT_UNKNOWN';
        this.volume = hbdata.volume;
        this.controller = hbdata.controller;
        this.speaker = hbdata.speaker;
    }
}

const vehicleMaster = new VehicleMaster();
module.exports = vehicleMaster;
