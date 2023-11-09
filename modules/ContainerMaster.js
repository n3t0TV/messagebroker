const db = require('./Database');

const HEARTBEAT_TIMEOUT = 30000;
var moment = require('moment-timezone');
const _ = require('lodash');

class CotnainerMaster {
    constructor() {
        this.containers = {};
    }

    getContainerTransactions(containerSku)
    {
        let today = moment().tz("America/Mexico_City").format('YYYY-MM-DD');
        return new Promise((resolve, reject) => {
            db.query(`CALL GET_TRANSACTIONS_BY_SKU_AND_DATE("${containerSku}", "${today}" , "${today}");`, (err, response) => {
                if (err) {
                    return reject(err);
                }
                const result = Object.values(JSON.parse(JSON.stringify(response[0])));
                resolve(result);
            });
        });
    }

    loadContainers() {
        return new Promise((resolve, reject) => {
            db.query("CALL CONTAINER_LIST_V2();", (err, response) => {
                if (err) {
                    return reject(err);
                }
                var containersChangedList = {};
                for (const row of response[0]) {
                    const containerChanged = this.loadContainer(row);
                    if(containerChanged !== null)
                    {
                        containersChangedList[row.SKU] = containerChanged;
                    }
                }
                resolve(containersChangedList);
            });
        });
    }

    loadContainer(data) {
        if (!this.containers[data.SKU]) {
            this.containers[data.SKU] = new Container();
        }
        
        const containerChanged = this.containers[data.SKU].loadData(data);
        if(containerChanged)
        {
            return this.containers[data.SKU];
        }
        else
        {
            return null;
        }
    }

    exportContainers() {
        const exportArray = [];
        for (const sku of Object.keys(this.containers)) {
            exportArray.push(this.containers[sku].getData());
        }
        return exportArray;
    }
    heartbeat(sku, hbdata, disconnectCallback) {
        if (!this.containers[sku]) {
            console.warn(`Container ${sku} is not registered`, hbdata);
            return false;
        }
        this.containers[sku].updateFromHeartBeat(hbdata, disconnectCallback);
    }
}


class Container {
    constructor() {
        this.lock =             false;
        this.mqttConnected =    false;
        this.connected =        false;
        this.checkout =         false;
        this.charging =         false;
        this.battery =          0;
        this.readerConnected =  false;
        this.readerEnabled =    false;
        this.readerTestMode =   false;
    }

    loadData(containerData) {
        //compare data to send update if is different
        const oldData = this.formatObjectContainerToCompare(this);
        const newData = this.formatObjectContainerToCompare(containerData);
        if(!_.isEqual(oldData, newData))
        {
            this.sku =              containerData.SKU;
            this.btMac =            containerData.BT_MAC;
            this.phone =            containerData.PHONE_ID;
            this.num =              containerData.CONTAINER_NUM;
            this.operator =         containerData.idOperador;
            this.environment =      containerData.environment;
    
            this.operatorName =     containerData.operator_name;
            this.operatorId =       containerData.operator_id;
            
            this.vehicleId =        containerData.UID_VEHICULO;
            this.vehicleImei =      containerData.vehicle_imei;
            this.vehicleCity =      containerData.vehicle_city;
            
            this.productId =        containerData.product_id;
            this.productName =      containerData.product_name;
            this.productPrice =     containerData.product_price;
            this.customPrice =      containerData.custom_price;
            this.quantity =         containerData.Quantity;
    
            this.environment =      containerData.environment;
            this.serial =           containerData.serial;
            this.remoteId =         containerData.remote_id;
            this.version =          containerData.version;
            this.containerVersion = containerData.container_version;
            this.provider =         containerData.provider;
            return true;
        }
        return false;
    }

    formatObjectContainerToCompare(data){
        data = {
            sku :               data.hasOwnProperty('sku') ? data.sku : data.SKU,
            btMac :             data.hasOwnProperty('btMac') ? data.btMac : data.BT_MAC,
            phone :             data.hasOwnProperty('phone') ? data.phone : data.PHONE_ID,
            num :               data.hasOwnProperty('num') ? data.num : data.CONTAINER_NUM,
            operator :          data.hasOwnProperty('operator') ? data.operator : data.idOperador,
    
            operatorName :      data.hasOwnProperty('operatorName') ? data.operatorName : data.operator_name,
            operatorId :        data.hasOwnProperty('operatorId') ? data.operatorId : data.operator_id,
            
            vehicleId :         this.hasOwnProperty('vehicleId') ? data.vehicleId : data.UID_VEHICULO,
            vehicleImei :       this.hasOwnProperty('vehicleImei') ? data.vehicleImei : data.vehicle_imei,
            vehicleCity :       this.hasOwnProperty('vehicleCity') ? data.vehicleCity : data.vehicle_city,
            
            productId :         data.hasOwnProperty('productId') ? data.productId : data.product_id,
            productName :       data.hasOwnProperty('productName') ? data.productName : data.product_name,
            productPrice :      data.hasOwnProperty('productPrice') ? data.productPrice : data.product_price,
            customPrice :       data.hasOwnProperty('customPrice') ? data.customPrice : data.custom_price,
            quantity :          data.hasOwnProperty('quantity') ? data.quantity : data.Quantity,
    
            environment :       data.environment,
            serial :            data.serial,
            remoteId :          data.hasOwnProperty('remoteId') ? data.remoteId : data.remote_id,
            //version :           data.version,
            
            containerVersion :  data.hasOwnProperty('containerVersion') ? data.containerVersion : data.container_version,
            provider :          data.hasOwnProperty('provider') ? data.provider : 'UNKNOW',
        };

        data.vehicleId =    data.vehicleId === undefined ? null : null;
        data.vehicleImei =  data.vehicleImei === undefined ? null : null;
        data.vehicleCity =  data.vehicleCity === undefined ? null : null;
        return data;
    }

    set mqttConnected(val) {
        this._mqttConnected = val;
        this.connected = val;
        clearTimeout(this.hearbeatTimeout);
    }

    get mqttConnected() {
        return this._mqttConnected;
    }


    disconnectionTimeout(callback) {
        //if (this._mqttConnected) return false;
        console.log("disconnectionTimeout EXECUTED");

        clearTimeout(this.hearbeatTimeout);
        this.hearbeatTimeout = setTimeout(() => {
            console.log("hearbeatTimeout EXECUTED");
            this.connected = false;
            if(callback)
            {
                callback();
            }
        }, HEARTBEAT_TIMEOUT);
    }

    updateFromHeartBeat(hbdata, disconnectCallback) {
        //heartbeat for containers v1
        if(!hbdata.hasOwnProperty('sensors'))
        {
            this.version =              hbdata.version;
            this.battery =              hbdata.batteryLvl;
            this.charging =             hbdata.isCharging;
            this.readerConnected  =     hbdata.isReaderConnected == 1 ? true: false;
            this.lid =                  false;
            this.connected =            true;
            this.disconnectionTimeout(disconnectCallback);
        }
        else //heartbeat for containers v2
        {
            this.version =          hbdata.version;
            this.battery =          hbdata.sensors.battery;
            this.lid =              hbdata.sensors.lid;
            this.provider =         hbdata.provider;
            this.readerConnected =  hbdata.sensors.hasOwnProperty('payment_reader_connected') ? hbdata.sensors.payment_reader_connected : false;
            this.readerEnabled =    hbdata.sensors.hasOwnProperty('payment_reader_enabled') ? hbdata.sensors.payment_reader_enabled : false;
            this.readerTestMode =   hbdata.sensors.hasOwnProperty('payment_reader_test_mode') ? hbdata.sensors.payment_reader_test_mode : false;
        }
    }

    getData() {

        const exportData = {

            sku:            this.sku,
            mac:            this.btMac,
            phone:          this.phone,
            vehicle:        this.vehicle,

            num:            this.num,
            operator:       this.operator,

            vehicleId:      this.vehicleId,
            vehicleImei:    this.vehicleImei,
            num:            this.num,
            operatorId:     this.operatorId,
            operatorName:   this.operatorName,
            environment:    this.environment,
            serial:         this.serial,
            remoteId:       this.remoteId,
            mqttConnected:  this.mqttConnected,
            connected:      this.connected,
            version:        this.version,
            checkout:       this.checkout,
            battery:        this.battery,
            charging:       this.charging,

            productId:      this.productId,
            quantity:       this.quantity,
            version:        this.version,
            customPrice:    this.customPrice,
            productName:    this.productName,
            productPrice:   this.productPrice,
            operatorName:   this.operatorName,
            operatorId:     this.operatorId,
            vehicleCity:    this.vehicleCity,
            productId:      this.productId,
            productName:    this.productName,
            productPrice:   this.productPrice,
            quantity:       this.quantity,
            customPrice:    this.customPrice,
            vehicleCity:    this.vehicleCity,
            lastHeartbeat:  moment().tz("America/Mexico_City").format(),
            containerVersion: this.containerVersion,
            lid:            this.lid,

            readerConnected: this.readerConnected,
            readerEnabled:   this.readerEnabled,
            readerTestMode:  this.readerTestMode,
            provider:        this.provider
        }
        return exportData;
    }
}

const containerMaster = new CotnainerMaster();
module.exports = containerMaster;