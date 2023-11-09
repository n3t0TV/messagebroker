const db = require('./Database');
var moment = require('moment-timezone');
const _ = require('lodash');

class CommunicationAnalitics {
    constructor() {
        this.containers = {};
    }

    async saveConversation(data)
    {
        let today = moment().tz("America/Mexico_City").format('YYYY-MM-DD h:mm:ss.SSS');
        console.log("saveConversation", data);
        console.log("timestamp", today);
        return new Promise((resolve, reject) => {
            db.query(`CALL ADD_CONVERSATION("${data.vehicleImei}", "${data.type}" , "${data.text}" , "${data.tag}" , "${today}");`, (err, response) => {
                if (err) {
                    console.log("ERROR: ", err);
                    return reject(err);
                }
                resolve(response);
            });
        });
    }
}

const communicationAnalitics = new CommunicationAnalitics();
module.exports = communicationAnalitics;