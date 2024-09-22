const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`,
  ssl: {
    rejectUnauthorized: true,
    ca: Buffer.from(process.env.DB_SSL_CERT, 'base64').toString()
  }
});

module.exports = { pool };
