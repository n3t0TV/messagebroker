const config = require('./config.js')
config.DB.timezone = 'utc'
const Mysql = require('mysql')

class DBConnection {
  constructor (config) {
    this.config = config
  }

  /**
     * Connect to database
     */
  connect () {
    console.debug('Connectig MYSQL...')
    console.log(config)
    this.con = Mysql.createConnection(config.DB)
    this.end = this.con.end.bind(this.con)
    this.del = this.con._protocol._delegateError
    this.con._protocol._delegateError = (err, sequence) => {
      console.error(err)
      try {
        console.log(config.enviroment)
        if (err.fatal && config.enviroment !== 'development') {
          this.end(() => {
            this.con.destroy()
            this.connect()
          })
          return this.del.call(this, err, sequence)
        }
        return this.del.call(this, err, sequence)
      } catch (e) {
        console.error(e)
      }
    }
  }

  /**
     *  Call stored procedure
     * @param {string} SP Stored procedure
     * @param  {...(string|number))} params Paramters
     * @returns {(Promise<Array>||Promise<Mysql.MySqlError>)}
     */
  call (SP, ...params) {
    const promise = new Promise((resolve, reject) => {
      let query = `CALL ${SP}(`
      for (let p = 0; p < params.length; p++) {
        //query += `'${params[p]}'`
        query += '?'
        if (p < params.length - 1) {
          query += ','
        }
      }
      query += ');'
      this.con.query(query, params, (err, response) => {
        if (err) {
          return reject(err)
        }
        resolve(response[0])
      })
    })
    promise.catch(console.error)
    return promise
  }

  /**
     * Query;
     * @param  {Mysql.QueryFunction} params
     * @returns {Mysql.Query}
     */
  query (...params) {
    return this.con.query(...params)
  }
}

const connection = new DBConnection(config.DB)
connection.connect()
module.exports = connection