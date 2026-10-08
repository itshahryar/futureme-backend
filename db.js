const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Initialize database schema
const initDB = async () => {
  try {
    const client = await pool.connect();
    console.log('Connected to Neon PostgreSQL database.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        "firstName" VARCHAR(255) NOT NULL,
        "lastName" VARCHAR(255) DEFAULT '',
        email VARCHAR(255) UNIQUE NOT NULL,
        "passwordHash" VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'ADMIN')),
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "firstName" VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastName" VARCHAR(255) DEFAULT '';
      ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
    `);

    console.log('Database table "users" is verified and ready.');
    client.release();
  } catch (err) {
    console.error('Neon DB initialization error:', err.message);
  }
};

module.exports = {
  pool,
  initDB,
  query: (text, params) => pool.query(text, params),
};
