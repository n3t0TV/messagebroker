/**************************************************************************/
const HEARTBEAT_LIFETIME = 60000; //Tiempo de vida de heartbeat en milisegundos
require('colors');
const config = require('./config');
const path = require('path');
const fs = require('fs');
const vehicleMaster = require('./VehicleMaster');
const containerMaster = require('./ContainerMaster');
const communicationAnalitics = require('./CommunicationAnalitics');
const clientMaster = require('./ClientMaster');
const Aedes = require('aedes');
const ws = require('websocket-stream');
const uidsafe = require('uid-safe');
const { authenticateToken } = require('./APIAuthentication')
const bcrypt = require('bcryptjs');
const _ = require('lodash');
const { Console } = require('console');
const uid = require('uid-safe');
const { command } = require('yargs');
const MAC_REGEXP = /^([0-9a-fA-F][0-9a-fA-F]:){5}([0-9a-fA-F][0-9a-fA-F])$/;

const sslpath = config.SSL_PATH ? config.SSL_PATH : path.join(__dirname, '..', 'utils', 'ssl');
const tlsoptions = {
  key: fs.readFileSync(path.join(sslpath, 'privkey.pem'), 'utf8'),
  ca: fs.readFileSync(path.join(sslpath, 'chain.pem'), 'utf8'),
  cert: fs.readFileSync(path.join(sslpath, 'cert.pem'), 'utf8'),
  ciphers: [
    "ECDHE-RSA-AES256-SHA384",
    "DHE-RSA-AES256-SHA384",
    "ECDHE-RSA-AES256-SHA256",
    "DHE-RSA-AES256-SHA256",
    "ECDHE-RSA-AES128-SHA256",
    "DHE-RSA-AES128-SHA256",
    "HIGH",
    "!aNULL",
    "!eNULL",
    "!EXPORT",
    "!DES",
    "!RC4",
    "!MD5",
    "!PSK",
    "!SRP",
    "!CAMELLIA"
  ].join(':')
};
class VehicleBroker {
  constructor(mqttPort, httpsServer) {
    this.options = tlsoptions;
    this.mqttPort = mqttPort;
    this.httpsServer = httpsServer;
    this.initialize();
  }
  async initialize() {
    await vehicleMaster.ready();
    this.startPolling();
    this.startContainersPolling();
    this.initializeAedesBroker();
    this.initializeMQTTServer(this.mqttPort, this.options);
    if (this.httpsServer) this.initializeHTTPServer(this.httpsServer);
    this.vehicleConnection = {};
    this.heartbeatcache = {};
    this.clients = {};
    this.tempTokens = {};
  }

  async startPolling() {
    await this.loadingVehicles()
    this.interval = setInterval(async () => await this.loadingVehicles(), 120000);
  }

  async loadingVehicles() {
    await vehicleMaster.loadVehicles();
  }

  async startContainersPolling() {
    await this.loadingContainers();
    this.interval = setInterval(async () =>

    await this.loadingContainers()

    , 30000);
  }

  async loadingContainers() {
    await containerMaster.loadContainers().then((containersChanged) => {

      const containersChangedCount = Object.keys(containersChanged).length;
      const containersCount = Object.keys(containerMaster.containers).length;
      console.log("containersChanged length: ", containersChangedCount);
      if(containersChangedCount !== containersCount && containersChangedCount !== 0)
      {
        const keys = Object.keys(containersChanged);
        keys.forEach(
          value =>
          //console.log("VALUE: ", value)
          this.sendUpdateContainer(value)
          );
      }
    });
  }

  initializeAedesBroker() {
    this.aedes = Aedes();
    this.aedes.on('subscribe', this.onsubscribe.bind(this));
    this.aedes.on('clientDisconnect', this.onclientdisconnect.bind(this));
    this.aedes.on('unsubscribe', this.onUnSuscribe.bind(this));
    this.aedes.on('publish', this.onpublish.bind(this));
    this.aedes.on('clientReady', this.onclientready.bind(this));
    this.aedes.on('clientError', this.onclienterror.bind(this));
    this.aedes.authorizeSubscribe = this.onauthorizesubscribe.bind(this);
    this.aedes.authorizePublish = this.onauthorizepublish.bind(this);
    this.aedes.authenticate = this.onauthenticate.bind(this);
  }

  onUnSuscribe(subscriptions, client) {
    console.log(`MQTT client \x1b[32m ${(client ? client.id : client)} \x1b[0m unsubscribed to topics: ${subscriptions.join('\n')} from broker ${this.aedes.id}`)
  }

  onclienterror(client, error) {
    let clientType = 'Unknown'.red;
    let username = 'Unidentified'.red;

    if (this.clients[client.id]) {
      if (this.clients[client.id].type) {
        clientType = this.clients[client.id].type;
      }
      if (this.clients[client.id].username) {
        username = this.clients[client.id].username;
      }
    }

    switch (error.message) {
      case 'keep alive timeout':
        console.log('E '.red, 'ERROR:'.red, clientType, username, client.id, 'Keep alive timeout'.yellow);
        break;
      default:
        console.log('E '.red, 'ERROR:'.red, clientType, username, client.id, error.message);
        console.log(error);
        break
    }
  }

  auth_tempToken(client, username, password) {
    if (!this.tempTokens[password]) return false; // If there is not tempToken authentication fails;

    console.log('> '.cyan, 'TEMPORARY TOKEN AUTHENTICATION'.cyan, username, client.id.green);
    const clientData = {
      'client': client,
      'username': username,
      'type': this.tempTokens[password] || 'UNKNOWN TEMPORARY TOKEN'
    };
    delete this.tempTokens[password];
    this.clients[client.id] = clientData;
    console.log('✓ TEMP TOKEN AUTH'.green, clientData.type.green, username.toString(), client.id);

    //Temporary token doesn't publish to  client topic

    return true;
  }

  async auth_macQTT(client, username, password) {
    if (username.length !== 15 || isNaN(username) || !MAC_REGEXP.test(password)) return false;

    console.log('> '.cyan, 'VEHICLE MAC AUTHENTICATION'.cyan, username, password, client.id.green);
    if (!vehicleMaster.vehicles[username]) { // if doesn't exists preregister
      if (!await vehicleMaster.preregister(username, client.conn.remoteAddress))
        return false; // if vehicle is disabled authentication fails
    }
    const vehicle = vehicleMaster.vehicles[username];
    const cleanMac = password.replace(/:/g, '').toUpperCase();
    if (vehicle.macHash) {
      if (!bcrypt.compareSync(cleanMac, vehicleMaster.vehicles[username].macHash)) {
        console.log('× '.red, 'WRONG MAC ADDRESS'.red, username, client.id.yellow);
        return false
      }
    } else {
      await vehicleMaster.storeMac(username, cleanMac);
    }
    const clientData = {
      'id': username,
      'client': client,
      'username': username,
      'type': 'VEHICLE',
      'uid_physical': username
    };
    this.clients[client.id] = clientData;
    vehicleMaster.vehicles[clientData.uid_physical].mqttConnected = true;
    this.sendUpdate(clientData.uid_physical);
    console.log('✓ MAC AUTH'.green, clientData.type.green, username.toString(), client.id);

    this.publishClientData(clientData);

    return true;
  }

  async auth_token(client, username, password) {
    const response = await authenticateToken(password);
    if (!response) return false;
    if (!response.client_type) return false;
    console.log('> '.cyan, 'DATABASE TOKEN AUTHENTICATION'.cyan, username, password, client.id.green);
    const clientData = {
      'id': username,
      'client': client,
      'username': username,
      'type': response.client_type,
      'connected': true
    };
    if (response.client_type === 'VEHICLE') {
      clientData.uid_physical = username;
      if (!vehicleMaster.vehicles[clientData.uid_physical]) {
        await vehicleMaster.preregister(clientData.uid_physical, client.conn.remoteAddress);
      }
      vehicleMaster.vehicles[clientData.uid_physical].mqttConnected = true;
      this.sendUpdate(clientData.uid_physical);
    }
    this.clients[client.id] = clientData;
    response.client_type = response.client_type || 'UNKNOWN';
    console.log('✓ TOKEN AUTH'.green, response.client_type.green, username.toString(), client.id);

    this.publishClientData(clientData);


    return true;
  }

  publishClientData(clientData) {
    const cleanClientData = {};
    Object.assign(cleanClientData, clientData);
    cleanClientData.mqttId = clientData.client.id;
    delete cleanClientData.client;
    this.publish(`clients`, [cleanClientData]);
    this.publish(`clients/${clientData.type}`, [cleanClientData]);
    this.publish(`clients/${clientData.type}/${clientData.id}`, [cleanClientData]);
    clientMaster.updateClient(cleanClientData);
  }

  async onauthenticate(client, username, password, callback) {
    if (!username || !password) { // Si no hay datos de autenticación
      const error = new Error('Auth error');
      error.returnCode = 4; // MQTT 4. Connection refused, bad user name or password
      console.log('× '.red, 'UNAUTHORIZED INVALID'.red, username, client.id.yellow);
      return callback(error, null);
    }

    if (this.auth_tempToken(client, username, password.toString())) return callback(null, true);
    if (await this.auth_macQTT(client, username, password.toString())) return callback(null, true);
    if (await this.auth_token(client, username, password.toString())) return callback(null, true);

    //If all authentications fails

    const error = new Error('Auth error');
    error.returnCode = 5; // Connection refused, not authorized
    console.log('× '.red, 'UNAUTHORIZED'.red, username.toString(), client.id);
    return callback(error, null);
  }



  getTemptoken(clientType) {
    const securetoken = uidsafe.sync(24);
    this.tempTokens[securetoken] = clientType;
    // setTimeout(() => {
    //   if (this.tempTokens[securetoken]) {
    //     delete this.tempTokens[securetoken];
    //   }
    // }, 600000); // Sólo es válido durante 1 hr;

    return securetoken;
  }

  onclientready(client) {
    if (!this.clients[client.id]) {
      return;
    }
    switch (this.clients[client.id].type) {
      case 'VEHICLE':
        const uid_physical = this.clients[client.id].uid_physical;

        client.subscribe({ 'topic': 'status/' + uid_physical, 'qos': 2 }, () => {
          this.sendStatus(uid_physical);
        });
        client.subscribe({ 'topic': 'ota/' + uid_physical, 'qos': 2 }, () => { });
        client.subscribe({ 'topic': 'communication/' + uid_physical + '/teleop', 'qos': 2 }, () => { });
        client.subscribe({ 'topic': 'instruction/' + uid_physical, 'qos': 2 }, async () => {
          const macs = await vehicleMaster.containers(uid_physical);
          this.sendInstruction(uid_physical, {
            command: 'MU',
            update: true,
            macs
          });
        });
        break;
      case 'CONTAINER':
        try
        {
          const sku = this.clients[client.id].username;
          client.subscribe({ 'topic': `containercontrol/${sku}`, 'qos': 2 }, () => { });
          console.log("onclientready - CHANGING CONTAINER STATUS... ", sku);
          containerMaster.containers[sku].mqttConnected = true;
          client.publish(this.updateContainerPricePacket(containerMaster.containers[sku]), () => {
          });
          this.sendUpdateContainer(sku);
        }
        catch(e)
        {
          console.log("ERROR- CONTAINER TYPE", e);
        }

        break;
      case 'FRONTEND':

        break;
    }
  }
  onclientdisconnect(client) {
    if (!this.clients[client.id]) return;

    const clientData = this.clients[client.id];

    const cleanClientData = {};
    Object.assign(cleanClientData, clientData);
    cleanClientData.mqttId = clientData.client.id;
    delete cleanClientData.client;
    cleanClientData.connected = false;

    this.publish(`clients`, [cleanClientData]);
    this.publish(`clients/${clientData.type}`, [cleanClientData]);
    this.publish(`clients/${clientData.type}/${clientData.id}`, [cleanClientData]);
    clientMaster.remove(cleanClientData);

    console.log("ON DISCONNECT, CLIENT TYPE: ", clientData.type);
    //console.log("CLIENT DATA: ", clientData);
    switch (clientData.type) {


      case 'VEHICLE':
        const imei = this.clients[client.id].uid_physical;
        vehicleMaster.vehicles[imei].mqttConnected = false;
        this.sendUpdate(imei);
        break;

      case 'CONTAINER':
        console.log("CONTAINER TYPE DETECTED!!: ", clientData.type, " sku: ", cleanClientData.id);

        if(containerMaster.containers[cleanClientData.id])
        {
          containerMaster.containers[cleanClientData.id].mqttConnected = false;
          this.sendUpdateContainer(cleanClientData.id);
        }
        break;
    }
    const type = this.clients[client.id].type || 'UNDEFINED_TYPE';
    console.log('D '.red, type.red, this.clients[client.id].username, client.id);
    delete this.clients[client.id];

  }

  sendUpdate(imei) {
    if (!vehicleMaster.vehicles[imei]) {
      console.error(`Vehicle ${imei} not found`);
      return;
    }
    const list = [vehicleMaster.vehicles[imei].getData()];
    const packet = {
      'topic': 'vehicles/all/update',
      'payload': Buffer.from(JSON.stringify(list)),
      'qos': 1
    };
    this.aedes.publish(packet, () => {
      //   console.log('Vehicle ', imei, ' updated'.green);
    });
    const packet2 = {
      'topic': 'vehicles/' + imei + '/update',
      'payload': Buffer.from(JSON.stringify(vehicleMaster.vehicles[imei].getData())),
      'qos': 1
    };
    this.aedes.publish(packet2, () => {
      ///  console.log('Vehicle ', imei, ' updated'.green);
    });
  }

  async sendStatus(uid_physical) {
    return new Promise(async (resolve, reject) => {
      const response = await vehicleMaster.getConnection(uid_physical);
      if (Number(response.ID_ESTATUS) === -1) {
        console.log('× sendStatus :'.red + uid_physical.toString() + ': UNREGISERED'.red);
        resolve();
        return;
      }
      response.SOURCE = 'DATABASE';
      response.TIMESTAMP = + new Date();

      console.log('***SEND STATUS***',response.ID_ESTATUS);
      if(response.ID_ESTATUS===5)
        vehicleMaster.setTeleoperator(uid_physical,'none');
      else
        vehicleMaster.clearTeleoperator(uid_physical);
      //Add optional parameters here
      /*if(params!='' && params!=null && params!=='undefined')
      {
        for (const [key, value] of params.entries())
        {
          response[key]=value;
        }

      }*/
      console.log('> sendStatus :'.green, uid_physical, ': ', response.ID_ESTATUS);
      console.log(response);
      this.sendUpdate(uid_physical);
      this.aedes.publish({
        'topic': 'status/' + uid_physical,
        'payload': Buffer.from(JSON.stringify(response)),
        'qos': 2
      }, resolve);
    });
  }

  async sendStatusMonitor(uid_physical,idTeleop) {
    return new Promise(async (resolve, reject) => {
      const response = await vehicleMaster.getConnection(uid_physical);

      if (Number(response.ID_ESTATUS) === -1) {
        console.log('× sendStatus :'.red + uid_physical.toString() + ': UNREGISERED'.red);
        resolve();
        return;
      }

      console.log('***SEND STATUS MONITOR***',idTeleop,response.ID_ESTATUS);
      if(response.ID_ESTATUS===5)
        vehicleMaster.setTeleoperator(uid_physical,idTeleop);
      else
        vehicleMaster.clearTeleoperator(uid_physical);
      response.SOURCE = 'MONITOR';
      response.TIMESTAMP = + new Date();

      console.log('> sendStatus :'.green, uid_physical, ': ', response.ID_ESTATUS);
      console.log(response);
      this.sendUpdate(uid_physical);
      this.aedes.publish({
        'topic': 'status/' + uid_physical,
        'payload': Buffer.from(JSON.stringify(response)),
        'qos': 2
      }, resolve);
    });
  }

  async sendInstruction(uid_physical, data) {
    return new Promise(async (resolve, reject) => {
      console.log('> instruction :'.green, uid_physical, ': ', data);
      this.sendUpdate(uid_physical);
      this.aedes.publish({
        'topic': 'instruction/' + uid_physical,
        'payload': Buffer.from(JSON.stringify(data)),
        'qos': 2
      }, resolve);
    });
  }

  sendHalt(uid_physical) {
    return new Promise((resolve, reject) => {
      vehicleMaster.getConnection(uid_physical).then(response => {
        if (Number(response.ID_ESTATUS) === -1) {
          console.log('× sendStatus :'.red + uid_physical.toString() + ': UNREGISERED'.red);
          resolve();
          return;
        }
        response.SOURCE = 'HALT';
        response.TIMESTAMP = + new Date();
        response.ID_ESTATUS = 3; //Override status
        console.log('> sendHalt :'.green, uid_physical, ': ', response.ID_ESTATUS);
        this.aedes.publish({
          'topic': 'status/' + uid_physical,
          'payload': Buffer.from(JSON.stringify(response)),
          'qos': 2
        }, resolve);
      }).catch(err => {
        reject(err);
        console.log('× sendHalt :'.red + uid_physical.toString() + ': ', err);
      });
    });
  }
  initializeMQTTServer(port, options) {
    this.server = require('tls').createServer(options, this.aedes.handle);
    this.server.listen(port, () => console.log('Servidor MQTT en '.green, port));
    if (process.argv.slice(2)[0] === 'unsafe') {
      this.unsafeserver = require('net').createServer(this.aedes.handle); //Servidor sin TLS
      this.unsafeserver.listen(1883, () => console.log('Servidor MQTT inseguro en '.bgYellow.red, 1883));
    }
  }

  initializeHTTPServer(httpsServer) {
    this.websocket = ws.createServer({ server: httpsServer }, this.aedes.handle);
  }

  publish(topic, payload) {

    const jsonPayload = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      this.aedes.publish({
        'topic': topic,
        'payload': jsonPayload
      }, (err) => {
        if (err) {
          console.log('PUBLISH ERROR'.red, err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  onsubscribe(subscriptions, client) {
    for (const subscription of subscriptions) {
      const subtopics = subscription.topic.split('/');
      console.log("TOPIC: ", subscription.topic);
      switch (subtopics[0]) {
        case 'containers':
          if ((subtopics[1] === 'all' || subtopics[1] === '+') && (subtopics[2] === undefined || subtopics[2] === 'update')) {

            client.publish(this.allContainersPacket(), () => {
            });
          }
          else if(subtopics[2] === 'transaction')
          {
            containerMaster.getContainerTransactions(subtopics[1]).then((transactions) => {

              console.log("SKU: ", subtopics[1]);
              console.log("TRANSACTIONS: ", transactions);
              client.publish(this.allcontainersTransactionPacket(subtopics[1], transactions), () => {
              });
            });

          }

          if (subtopics[1] === 'all' || subtopics[1] === '+') {
            client.publish(this.allContainersPacket(), () => {
            });
          }

          break;
        case 'containercontrol':

        break;
        case 'heartbeat':
          for (let imei in this.heartbeatcache) {
            client.publish(this.heartbeatcache[imei].packet, () => { });
            client.publish(this.allVehiclesPacket('all'), () => { });
          }
          break;
        case 'vehicles':
          if (subtopics[1] === 'all' || subtopics[1] === '+') {
            client.publish(this.allVehiclesPacket('all'), () => { });
          } else if (subtopics[1] === 'available' || subtopics[1] === '+') {
            client.publish(this.allVehiclesPacket('available'), () => { });
          } else if (subtopics[1] === 'usertrip' || subtopics[1] === '+') {
            client.publish(this.allVehiclesPacket('usertrip'), () => { });
          } else if (subtopics[1] === 'delivery' || subtopics[1] === '+') {
            client.publish(this.allVehiclesPacket('delivery'), () => { });
          } else if (vehicleMaster.vehicles[subtopics[1]]) {
            const packet = {
              'topic': `vehicles/${subtopics[1]}/update`,
              'payload': Buffer.from(JSON.stringify(vehicleMaster.vehicles[subtopics[1]].getData())),
              'qos': 1
            };
            client.publish(packet, () => {
              console.log('Vehicle ', subtopics[1], ' updated'.green);
            });
          }

          break;
        case 'clients':
          const clientsPacket = {
            'topic': subscription.topic,
            'qos': '2'
          };

          if (!subtopics[1]) {
            clientsPacket.payload = Buffer.from(JSON.stringify(clientMaster.export()));
          } else if (!subtopics[2]) {
            clientsPacket.payload = Buffer.from(JSON.stringify(clientMaster.export(subtopics[1])));
          } else {
            clientsPacket.payload = Buffer.from(JSON.stringify([clientMaster.clients]));
          }
          client.publish(clientsPacket, () => { });
          break;
      }
    }
  }

  allVehiclesPacket(filter) {
    const packet = {
      'topic': 'vehicles/' + filter + '/update',
      'payload': Buffer.from(JSON.stringify(vehicleMaster.exportVehicles(filter))),
      'qos': '2'
    };
    return packet;
  }

  allContainersPacket() {
    const packet = {
      'topic': 'containers/all/update',
      'payload': Buffer.from(JSON.stringify(containerMaster.exportContainers())),
      'qos': '2'
    };
    return packet;
  }

  allcontainersTransactionPacket(containerSku, transactions) {
    const packet = {
      'topic': `containers/${containerSku}/transaction`,
      'payload': Buffer.from(JSON.stringify(transactions)),
      'qos': '2'
    };
    return packet;
  }

  updateContainerPricePacket(container)
  {

    let price = container.customPrice == 0 ? Number(container.productPrice) : Number(container.customPrice);
    //se manda valor default
    if(container.productPrice === null && container.customPrice === 0)
    {
      price = Number(0.01);
    }

    const packet = {
      'topic': `containercontrol/${container.sku}`,
      'payload': Buffer.from(JSON.stringify({
        command: "price",
        amount: price
      })),
      'qos': '2'
    };
    return packet;
  }

  onauthorizesubscribe(client, subscription, callback) {
    //console.log('****ON AUTHORIZED SUSCRIBED started***');
    if (!this.clients[client.id]) {
      try { client.close() } catch (e) { console.log(e) };
      return this.rejectSubscription(client, subscription, callback);
    }
    //SUPER can subscribe to everything
    if (this.clients[client.id].type === 'SUPER') return this.acceptSubscription(client, subscription, callback);


    const subtopics = subscription.topic.split('/');
    //console.log('****ON AUTHORIZED SUSCRIBED switch***',subtopics[0],subtopics[1]);
    switch (subtopics[0]) {
      // DE BACKEND A SCOOTER
      case 'status':
        this.checkSubscriptionClientType(client, subscription, callback, ['VEHICLE', 'CONTAINER'], subtopics[1] || '-');
        break;
      case 'instruction':
        this.checkSubscriptionClientType(client, subscription, callback, ['VEHICLE', 'CONTAINER'], subtopics[1] || '-');
        break;
      case 'ota':
        this.checkSubscriptionClientType(client, subscription, callback, ['VEHICLE', 'CONTAINER'], subtopics[1] || '-');
        break;
      case 'control':
        this.checkSubscriptionClientType(client, subscription, callback, ['VEHICLE', 'CONTAINER'], subtopics[1] || '-');
        break;
      case 'containercontrol':
        this.checkSubscriptionClientType(client, subscription, callback, ['VEHICLE', 'CONTAINER'], subtopics[1] || '-');
        break;
     
      // DE cliente A BACKEND
      case 'heartbeat':
        callback(null, subscription);
        break;
      case 'containers':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'CONTAINER']);
        break;
      case 'vehicles':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'CONTAINER']);
        break;
      case 'positioning':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER']);
        break;
      case 'sensor':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'VEHICLE']);
        break;
      case 'container_instruction':
        //console.log('****ON AUTHORIZED SUSCRIBED container_instruction***');
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'VEHICLE']);
        break;
      case 'communication':
        //console.log('****ON AUTHORIZED SUSCRIBED container_instruction***');
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'VEHICLE']);
        break;
      case 'network':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER']);
        break;
      case 'log':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER']);
        break;
      case 'response':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER']);
        break;
      case 'vending':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER']);
        break;
      case 'error':
        switch (subtopics[1]) {
          case 'server':
            this.checkSubscriptionClientType(client, subscription, callback, 'VEHICLE', subtopics[2] || '-');
            break;
          case 'vehicle':
            this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER']);
            break;
        }
        break;
      // DE BACKEND A BACKEND
      case 'latency':
        callback(null, subscription);
        break;
      case 'mqtt_debug':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'VEHICLE']);
        break;
      // GENERAL
      case 'clients':
        this.checkSubscriptionClientType(client, subscription, callback, ['FRONTEND', 'SERVER', 'VEHICLE', 'CONTAINER']);
        break;
      default:
        this.rejectSubscription(client, subscription, callback);
        break;
    }
  }

  checkSubscriptionClientType(client, subscription, callback, clientType, compareUsername) {
    if (!this.clients[client.id]) {
      try { client.close() } catch (e) { console.log(e) };
      return this.rejectSubscription(client, subscription, callback);
    }
    if (Array.isArray(clientType)) {
      let match = false;
      for (const ct of clientType) {
        if (this.clients[client.id].type === ct) {
          match = true;
          break;
        }
      }
      if (!match) {
        return this.rejectSubscription(client, subscription, callback); //Si no coincide ningun tipo
      }
    } else if (this.clients[client.id].type !== clientType) {
      return this.rejectSubscription(client, subscription, callback); //Si no coincide el tipo
    }


    if (compareUsername === undefined) {
      return this.acceptSubscription(client, subscription, callback); //Si no es necesario comparar el IMEI
    }
    if (compareUsername === this.clients[client.id].username) {
      return this.acceptSubscription(client, subscription, callback); //Si el IMEI coincide
    } else {
      return this.rejectSubscription(client, subscription, callback);
    }
  }

  acceptSubscription(client, subscription, callback) {
    this.clients[client.id].type = this.clients[client.id].type || '';
    console.log('S '.green, this.clients[client.id].type.green, this.clients[client.id].username, 'SUBSCRIPTION '.green + subscription.topic);
    callback(null, subscription);
  }

  rejectSubscription(client, subscription, callback) {

    /*  client.publish({
        'topic': subscription.topic,
        'qos': 2,
        'payload': JSON.stringify({ 'error': 'unauthorized' })
      });*/

    let type = '';
    if (this.clients[client.id]) {
      type = this.clients[client.id].type;
    }

    console.log('S '.red, client.id, type, 'UNAUTHORIZED TO SUBSCRIBE TO '.red + subscription.topic);


    callback(new Error('UNAUTHORIZED TO SUBSCRIBE'), null);


  }

  onpublish(packet, client) {
    const subtopics = packet.topic.split('/');
    const mainTopic = subtopics[0];


  //  console.log('***ON PUBLISH switch**',subtopics[0],subtopics[1]);
    switch (mainTopic) {
      case 'heartbeat':
        this.storeHeartbeat(packet);
        break;
      case 'containers':
        if (subtopics[3] === 'heartbeat') {
          console.log("CONTAINERS V1 HEARTBEAT");
          const chbdata = JSON.parse(packet.payload.toString());
          containerMaster.heartbeat(subtopics[1], chbdata, this.sendUpdateContainer.bind(this, subtopics[1]));
          this.sendUpdateContainer(subtopics[1]);

        }
        else if (subtopics[2] === 'sensor') {
         // console.log("CONTAINERS V2 HEARTBEAT");
          const chbdata = JSON.parse(packet.payload.toString());
        //  console.log("CHDATA: ", chbdata);
          containerMaster.heartbeat(subtopics[1], chbdata);
          this.sendUpdateContainer(subtopics[1]);
        }
        else if (subtopics[2] === 'card_tap') {

          console.log("CONTAINERS V2 - CARDTAP EVENT");
          if(containerMaster.containers[subtopics[1]].vehicleImei !== null && containerMaster.containers[subtopics[1]].vehicleImei !== undefined)
          {
            // ENVIAR NOTIFICACION AL ROBOT DE QUE HUBO UN TAP
            this.sendInstruction(containerMaster.containers[subtopics[1]].vehicleImei,
              {
                command: 'TAP',
            });
          }
          else
          {
            console.log(`Vehicle not assigned to container: ${ subtopics[1] }`);
          }
        }
      break;
      case 'connection':
        try {
          console.log(packet.payload.toString());
          const connectionPayload = JSON.parse(packet.payload.toString());
          vehicleMaster.setConnection(connectionPayload);
          this.sendUpdate(connectionPayload.IMEI);
        } catch (e) {
          console.log('CONNECTION ERROR:'.red, e);
        }
      break;
      case 'error':
        try {
          const vehicle = packet.topic;
          const reg = /[0-9]/g;
          const vehicleNumber = vehicle.match(reg).join('');
          const msg = packet.payload.toString();
          vehicleMaster.errorStatus(vehicleNumber, msg);
        } catch (e) {
          console.log('error', e)
        }
      break;
      case 'instruction':

      break;

      case 'communication':
        const vehicleImei = subtopics[1];
        console.log("payload", packet);
        let data = JSON.parse(packet.payload.toString());
        console.log("data: ", data);

        //insert in db
        const conversation = {
          "vehicleImei" : vehicleImei,
          "type" : subtopics[2],
          "text" : data.text,
          "tag" : null
        };

        communicationAnalitics.saveConversation(conversation).then((result) =>{
          console.log("CONVERSATION SAVED IN DB");
        });

        // if(subtopics[2] === 'teleop')
        // {
        //   const command = {
        //     text: data.text
        //   };

        //   const dpacket = {
        //     'topic': `communication/${vehicleImei}/teleop`,
        //     'payload': Buffer.from(JSON.stringify(command)),
        //     'qos': 2
        //   };
        //   this.aedes.publish(dpacket, () => { });
        // }

        if(subtopics[2] === 'container')
        {
          const containerSku = subtopics[1];

          //llenar con la info que se necesite (probablemente enviar audio)
          /*
          const commandToContainer = {};
          const vpacket = {
            'topic': `containercontrol/${containerSku}`,
            'payload': Buffer.from(JSON.stringify(commandToContainer)),
            'qos': 2
          };
          this.aedes.publish(vpacket, () => { });
          */
        }

      break;
      case 'container_instruction':
        try {
          //console.log('***ON PUBLISH container_instruction**');
          console.log("payload", packet);
          let data = JSON.parse(packet.payload.toString());
          console.log("data: ", data);

          let commandToContainer = null;
          let command = data.command;
          let containerNum = parseInt(data.id);

          //console.log('***Container instruction log!!!***',containerMaster.containers['100190'  ]);

          let containerFound = _.find(containerMaster.containers, function(container)
          {
            return container.num === containerNum && container.vehicleImei == subtopics[1];
          });

          if(containerFound)
          {
            console.log("containerFound: ", containerFound);
            console.log("command: ", command);
            switch(command)
            {
              case 'open':
                commandToContainer =   {
                  command: "open"
                };
              break;

              default:
                console.log(`Sorry, we are out of ${expr}.`);
            }

            if(commandToContainer !== null)
            {
              const vpacket = {
                'topic': `containercontrol/${containerFound.sku}`,
                'payload': Buffer.from(JSON.stringify(commandToContainer)),
                'qos': 2
              };
              this.aedes.publish(vpacket, () => { });
            }
          }
          else{
            console.log("container NOT Found: ", containerNum);
          }
        } catch (e) {
          console.error('container_instruction error:'.red, e)
        }
      break;

      case 'vehicles':
        switch (subtopics[2]) {
          case 'delivery':
            try {
              const deliveryData = JSON.parse(packet.payload);
              if (deliveryData.delivery.status === 'CLOSED') {
                if(vehicleMaster.vehicles[subtopics[1]] !== undefined)
                {
                  vehicleMaster.vehicles[subtopics[1]].delivery = null;
                }
              } else {
                if(vehicleMaster.vehicles[subtopics[1]] !== undefined)
                {
                  vehicleMaster.vehicles[subtopics[1]].delivery = deliveryData;
                }
              }
              const dlist = [deliveryData];
              const dpacket = {
                'topic': `vehicles/delivery/update`,
                'payload': Buffer.from(JSON.stringify(dlist)),
                'qos': 2
              };
              this.aedes.publish(dpacket, () => { });
            } catch (e) {
              console.error('Delivery error:'.red, e)
            }
          break;
          case 'videoMetrics':
            try {
              console.log('metrics');
              const metricsData = JSON.parse(packet.payload);
              const vmlist = [metricsData];
              const vpacket = {
                'topic': `vehicles/videoMetrics/update`,
                'payload': Buffer.from(JSON.stringify(vmlist)),
                'qos': 2
              };
              this.aedes.publish(vpacket, () => { });
            } catch (e) {
              console.error('Videometrics error:'.red, e)
            }
          break;

          default:
          //   console.log('> PUBLISH', subtopics);
        }
      break;
    }
  }

  storeHeartbeat(packet) {
    const data = JSON.parse(packet.payload.toString());
    const imei = data.imei;
    if (this.heartbeatcache[imei]) {
      clearTimeout(this.heartbeatcache[imei].timeout);
    }
    this.heartbeatcache[imei] = {};
    this.heartbeatcache[imei].packet = packet;
    this.heartbeatcache[imei].timeout = setTimeout(() => {
      delete this.heartbeatcache[imei];
    }, HEARTBEAT_LIFETIME);
  }

  onauthorizepublish(client, packet, callback) {

    //console.log('****ON AUTHORIZED PUBLISH started***');
    if (!this.clients[client.id]) {
      try { client.close() } catch (e) { console.log(e) };
      return callback(new Error('UNAUTHORIZED PUBLISH'));
    }
    const ip_address = client.conn.remoteAddress;
    let data;
    try {
      data = JSON.parse(packet.payload.toString());
    } catch (e) {
      console.error('JSON error', e);
      return callback(new Error('PUBLISH DATA ERROR'));
    }
    if (!data) {
      console.error('NO DATA');
      return callback(new Error('PUBLISH DATA ERROR'));
    }
    const subtopics = packet.topic.split('/');
    var imei;
    // console.log(subtopics);
    //console.log('****ON AUTHORIZED PUBLISH switch***',subtopics[0],subtopics[1]);
    switch (subtopics[0]) {
      case 'heartbeat':
        //       console.log(data);
        const uid_physical = data.UID_PHYSICAL || '-';
        const battery = data.BATTERY;
        const gps = {
          lat: data.GPS_LAT,
          lon: data.GPS_LON,
          alt: data.ALTITUD
        };
        const versions = {
          'brain': data.VERSION_BRAIN || 'NA',
          'firmware': data.VERSION_FIRMWARE || 'NA'
        };
        const flags = {
          MODULE_CONNECTED: data.MODULE_CONNECTED || 0,
          SIM: data.SIM || 0,
          GPS_FIXED: data.GPS_FIXED || 0,
          CAMERA_FRONT: data.CAMERA_FRONT || 0,
          CAMERA_BACK: data.CAMERA_BACK || 0,
          PERFORMANCE: data.PERFORMANCE || 0,
          VIDEO_CLIENT_CONNECTION: data.VIDEO_CLIENT_CONNECTION || 0,
          VIDEO_FRAME_SENT: data.VIDEO_FRAME_SENT || 0,
          SENSOR_CLIENT_CONNECTION: data.SENSOR_CLIENT_CONNECTION || 0,
          SENSOR_BUFFER_SENT: data.SENSOR_BUFFER_SENT || 0,
          CONTROL_CLIENT_CONNECTION: data.CONTROL_CLIENT_CONNECTION || 0,
          CONTROL_BUFFER_RECEIVED: data.CONTROL_BUFFER_RECEIVED || 0,
        }
        vehicleMaster.heartbeat(data, uid_physical, gps, data.RSSI, data.ERROR_BITRATE,
          data.BANDWIDTH, data.BATTERY, ip_address, versions, flags)
          .then(response => {
            console.log('❤ '.red + uid_physical.green);

            this.sendUpdate(uid_physical);
            packet.payload = Buffer.from(JSON.stringify(this.heartbeatRewrite(data, response)));
            return callback(null);
          }).catch(err => {
            console.log('💔 '.red + uid_physical.red + ': ', err);
            return callback(new Error(err));
          });
        break;
      case 'instruction':
        console.log('> '.cyan + ' ' + packet.topic.cyan, client.id, client.conn.remoteAddress, packet.payload.toString());
        packet.retain = false;
        return callback(null);
        break;
      case 'sensor':
        const clientuid_physical = this.clients[client.id].uid_physical;
        subtopics[1] = clientuid_physical;
        console.log(`${subtopics.join('/')}`.green);
        packet = {
          'topic': `${subtopics.join('/')}`,
          'payload': packet.payload,
          'qos': 0
        };

        try {
          this.aedes.publish(
            packet, (err) => {
              if (err) {
                console.log(`${subtopics.join('/')}`, 'PUBLISH ERROR'.red, err);
                //  reject(err);
              } else {
                // resolve();
              }
            });
        } catch (perr) {
          console.log(`${subtopics.join('/')}`, perr);
        }
      break;
      case 'container_instruction':

       console.log('****ON AUTHORIZED PUBLISH container_instruction***');
      
        imei = this.clients[client.id].uid_physical;
        subtopics[1] = imei;
        console.log(`${subtopics.join('/')}`.green);
        packet = {
          'topic': `${subtopics.join('/')}`,
          'payload': packet.payload,
          'qos': 0
        };

        try {
          this.aedes.publish(
            packet, (err) => {
              if (err) {
                console.log(`${subtopics.join('/')}`, 'PUBLISH ERROR'.red, err);
                //  reject(err);
              } else {
                // resolve();
              }
            });
          } catch (perr) {
            console.log(`${subtopics.join('/')}`, perr);
          }
      break;
      case 'communication':

        console.log('****ON AUTHORIZED PUBLISH communication***');
        console.log("SUBTOPICS:", subtopics);

        let topic = subtopics.join('/');
        if(subtopics[2] === 'robot')
        {
          imei = this.clients[client.id].uid_physical;
          subtopics[1] = imei;
          topic = subtopics.join('/');
        }
        console.log(`${topic}`.green);
        packet = {
          'topic': topic,
          'payload': packet.payload,
          'qos': 0
        };

        try {
          this.aedes.publish(
            packet, (err) => {
              if (err) {
                console.log(`${topic}`, 'PUBLISH ERROR'.red, err);
                //  reject(err);
              } else {
                // resolve();
              }
            });
          } catch (perr) {
            console.log(`${topic}`, perr);
          }
      break;
      case 'vending':
        try {
          const vendingMsg = JSON.parse(String(packet.payload));
          const vendingImei = subtopics[1];
          switch (vendingMsg.event) {
            case 'monitor':
              if (vendingMsg.active) {
                vehicleMaster.vehicles[vendingImei].monitor = vendingMsg.teleopId;
              } else {
                vehicleMaster.vehicles[vendingImei].monitor = null;
              }
              this.sendUpdate(vendingImei);
              break;
            case 'start':
            case 'end':
              vendingMsg.imei = vendingImei;
              const vendingPacket = {
                'topic': `vending/update`,
                'payload': Buffer.from(JSON.stringify([vendingMsg])),
                'qos': 0
              };
              this.aedes.publish(
                vendingPacket, (err) => {
                  if (err) console.log(`vending/update`, 'PUBLISH ERROR'.red, err);
                });
              break;
          }
        } catch (e) {
          console.error('Vending', e);
        }
        return callback(null);
        break;
      default:
        console.log(subtopics[0])
        return callback(null);
        break;
    }
  }

  heartbeatRewrite(data, response) {
    return {
      'id': response.UID_VEHICULO,
      'imei': data.UID_PHYSICAL,
      'battery': data.BATTERY || '0',
      'gps': {
        lat: data.GPS_LAT || '0',
        lon: data.GPS_LON || '0',
        alt: data.ALTITUD || '0'
      },
      'versions': {
        'brain': data.VERSION_BRAIN || '-',
        'firmware': data.VERSION_FIRMWARE || '-'
      },
      'rssi': data.RSSI || '0',
      'status': response.ID_ESTATUS,
      'timestamp': +new Date,
      'connection': vehicleMaster.connections[data.UID_PHYSICAL],
      'provider': data.PROVIDER || 'UNKNOWN'
    };
  }

  sendUpdateContainer(sku) {
    if (!containerMaster.containers[sku]) {
      console.error(`Container ${sku} not found`);
      return;
    }
    const list = [containerMaster.containers[sku].getData()];
    const packet = {
      'topic': 'containers/all/update',
      'payload': Buffer.from(JSON.stringify(list)),
      'qos': 1
    };
    this.aedes.publish(packet, () => {

    });
    const packet2 = {
      'topic': 'containers/' + sku + '/update',
      'payload': Buffer.from(JSON.stringify(containerMaster.containers[sku].getData())),
      'qos': 1
    };
    this.aedes.publish(packet2, () => {
    });
  }
  updateContainerQuantity(sku,quantity)
  {
    if(containerMaster.containers[sku]!==undefined)
    {
      containerMaster.containers[sku].quantity=quantity;
    }

  }
}

let vehicleBroker;

function initialize(mqttport, httpsServer) {
  vehicleBroker = new VehicleBroker(mqttport, httpsServer);
  return { vehicleBroker };
}

module.exports = initialize;
