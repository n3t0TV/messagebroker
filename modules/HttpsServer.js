/* global __dirname */
const colors = require('colors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const config = require('./config.js');


module.exports = function (app, port, insecurePort) {

    const sslpath = config.SSL_PATH ? config.SSL_PATH : path.join(__dirname, '..', 'utils', 'ssl');
    const privateKey = fs.readFileSync(path.join(sslpath, 'privkey.pem'), 'utf8');
    const certificate = fs.readFileSync(path.join(sslpath, 'cert.pem'), 'utf8');
    const chainBundle = fs.readFileSync(path.join(sslpath, 'chain.pem'), 'utf8');
    const credentials = {
        key: privateKey,
        cert: certificate,
        ca: chainBundle,
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



    const helmet = require('helmet');
    const ONE_YEAR = 31536000000;
    app.use(helmet.hsts({
        maxAge: ONE_YEAR,
        includeSubDomains: true,
        force: true
    }));
    const httpsServer = https.createServer(credentials, app);
    if (port) {
        httpsServer.listen(port);
        console.log('HTTPS iniciado en puerto '.green + port);
    }
    if(insecurePort){
        const httpServer = http.createServer(app);
        httpServer.listen(insecurePort);
    }
    return httpsServer;
}

