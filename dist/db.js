"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MySQL = void 0;
const promise_1 = require("mysql2/promise");
class MySQL {
    constructor(credentials) {
        this.credentials = credentials;
        this.conn = (0, promise_1.createPool)(this.credentials);
    }
    /** A random method to simulate a step before to get the class methods */
    ensureConnection() {
        if (!(this === null || this === void 0 ? void 0 : this.conn))
            this.conn = (0, promise_1.createPool)(this.credentials);
    }
    /** For `SELECT` and `SHOW` */
    get queryRows() {
        this.ensureConnection();
        return this.conn.query.bind(this.conn);
    }
    /** For `SELECT` and `SHOW` with `rowAsArray` as `true` */
    get queryRowsAsArray() {
        this.ensureConnection();
        return this.conn.query.bind(this.conn);
    }
    /** For `INSERT`, `UPDATE`, etc. */
    get queryResult() {
        this.ensureConnection();
        return this.conn.query.bind(this.conn);
    }
    /** For multiple `INSERT`, `UPDATE`, etc. with `multipleStatements` as `true` */
    get queryResults() {
        this.ensureConnection();
        return this.conn.query.bind(this.conn);
    }
    /** For `SELECT` and `SHOW` */
    get executeRows() {
        this.ensureConnection();
        return this.conn.execute.bind(this.conn);
    }
    /** For `SELECT` and `SHOW` with `rowAsArray` as `true` */
    get executeRowsAsArray() {
        this.ensureConnection();
        return this.conn.execute.bind(this.conn);
    }
    /** For `INSERT`, `UPDATE`, etc. */
    get executeResult() {
        this.ensureConnection();
        return this.conn.execute.bind(this.conn);
    }
    /** For multiple `INSERT`, `UPDATE`, etc. with `multipleStatements` as `true` */
    get executeResults() {
        this.ensureConnection();
        return this.conn.execute.bind(this.conn);
    }
    /** Expose the Pool Connection */
    get connection() {
        return this.conn;
    }
}
exports.MySQL = MySQL;
