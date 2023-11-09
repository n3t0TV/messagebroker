const LocalStorage = require('node-localstorage').LocalStorage;
const localStorage = new LocalStorage('./localStorage');

class ClientMaster {
    constructor() {
        this.clients = {};
        this.clientsByType = {};
    }

    updateClient(clientData) {
        this.clients[clientData.id] = clientData;
        if (!this.clientsByType[clientData.type]) this.clientsByType[clientData.type] = {};
        this.clientsByType[clientData.type][clientData.id] = clientData;
    }

    remove(clientData) {
        delete this.clients[clientData.id];
        if (!this.clientsByType[clientData.type]) return;
        delete this.clientsByType[clientData.type][clientData.id];
    }

    export(clientType) {
        const list = [];
        if (!clientType) {
            for (let id in this.clients) {
                const client = this.clients[id];
                list.push(client);
            }
        } else {
            for (let id in this.clientsByType[clientType]) {
                const client = this.clientsByType[clientType][id];
                list.push(client);
            }
        }
        return list;
    }
}

const clientMaster = new ClientMaster();
module.exports = clientMaster;