/* 
 */
const mysqlJson = require('./Database');

function authenticateToken(token) {
    return new Promise((resolve, reject) => {

        mysqlJson.query("CALL API_AUTHENTICATE('" + token.toString().substr(0,32) + "');", (err, response) => {
            if (err) { // Error en la base de datos
                return reject(err);
            }
            if (!response[0][0] || !response[0]) //No hay datos
            {
                // Se retrasa la respuesta de forma aleatorea para evitar ataques en bruto
                // Un token de API solo puede estar mal en entornos de desarrollo.
                // Se debe considerar bloqueo de IP después de ciertos intentos.
                return setTimeout(() => resolve(false), 500 + Math.round(Math.random() * 1000));
            }
            resolve(response[0][0]);
        });
    });
};

module.exports = {authenticateToken}

