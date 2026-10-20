const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.DATABASE_URL;
const usePostgres = Boolean(databaseUrl);

let pool = null;
let sqliteDb = null;

if (usePostgres) {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });
} else {
  sqliteDb = new sqlite3.Database(path.join(__dirname, 'data', 'shelter.db'), (err) => {
    if (err) {
      console.error('SQLite database connection error:', err.message);
      return;
    }
    console.log('Connected to local SQLite database.');
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

function sqliteQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function sqliteRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function initDatabase() {
  if (usePostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dogs (
        id SERIAL PRIMARY KEY,
        kennel_id TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS walk_logs (
        id SERIAL PRIMARY KEY,
        kennel_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        name TEXT NOT NULL,
        comment TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (kennel_id) REFERENCES dogs(kennel_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        box_id TEXT,
        details JSONB DEFAULT '{}'::jsonb,
        timestamp TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('PostgreSQL tables ready.');
    return;
  }

  sqliteDb.serialize(() => {
    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS dogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kennel_id TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL
      )
    `);

    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS walk_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kennel_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        name TEXT NOT NULL,
        comment TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kennel_id) REFERENCES dogs(kennel_id)
      )
    `);

    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        box_id TEXT,
        details TEXT DEFAULT '{}',
        timestamp TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  console.log('SQLite tables ready.');
}

async function ensureDog(kennelId, displayName) {
  if (usePostgres) {
    const existing = await pool.query('SELECT id FROM dogs WHERE kennel_id = $1', [kennelId]);

    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }

    const result = await pool.query(
      'INSERT INTO dogs (kennel_id, display_name) VALUES ($1, $2) RETURNING id',
      [kennelId, displayName]
    );

    return result.rows[0].id;
  }

  const existing = await sqliteGet('SELECT id FROM dogs WHERE kennel_id = ?', [kennelId]);
  if (existing) {
    return existing.id;
  }

  const result = await sqliteRun(
    'INSERT INTO dogs (kennel_id, display_name) VALUES (?, ?)',
    [kennelId, displayName]
  );

  return result.lastID;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Shelter API is running' });
});

app.get('/api/activity', async (req, res) => {
  try {
    if (usePostgres) {
      const result = await pool.query(
        'SELECT id, action, box_id AS "boxId", details, timestamp, created_at FROM activity_log ORDER BY created_at DESC'
      );

      const rows = result.rows.map((row) => ({
        ...row,
        details: row.details || {},
        boxId: row.boxId
      }));

      return res.json(rows);
    }

    const rows = await sqliteQuery(
      'SELECT id, action, box_id AS "boxId", details, timestamp, created_at FROM activity_log ORDER BY created_at DESC'
    );

    const normalizedRows = rows.map((row) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : {},
      boxId: row.boxId
    }));

    return res.json(normalizedRows);
  } catch (error) {
    console.error('Error loading activity log:', error);
    return res.status(500).json({ error: 'Failed to load activity log' });
  }
});

app.post('/api/activity', async (req, res) => {
  const { action, boxId, details, timestamp } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    const insertedTimestamp = timestamp || new Date().toISOString();
    const detailsJson = details ? JSON.stringify(details) : '{}';

    if (usePostgres) {
      await pool.query(
        'INSERT INTO activity_log (action, box_id, details, timestamp) VALUES ($1, $2, $3::jsonb, $4)',
        [action, boxId || null, detailsJson, insertedTimestamp]
      );
      return res.status(201).json({ ok: true });
    }

    await sqliteRun(
      'INSERT INTO activity_log (action, box_id, details, timestamp) VALUES (?, ?, ?, ?)',
      [action, boxId || null, detailsJson, insertedTimestamp]
    );

    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Error saving activity log:', error);
    return res.status(500).json({ error: 'Failed to save activity log' });
  }
});

app.get('/api/dogs', async (req, res) => {
  try {
    if (usePostgres) {
      const result = await pool.query(`
        SELECT d.kennel_id, d.display_name,
               l.timestamp, l.name, l.comment
        FROM dogs d
        LEFT JOIN walk_logs l
          ON l.id = (
            SELECT id
            FROM walk_logs
            WHERE kennel_id = d.kennel_id
            ORDER BY created_at DESC
            LIMIT 1
          )
        ORDER BY d.kennel_id ASC
      `);

      return res.json(result.rows);
    }

    const rows = await sqliteQuery(`
      SELECT d.kennel_id, d.display_name,
             l.timestamp, l.name, l.comment
      FROM dogs d
      LEFT JOIN walk_logs l
        ON l.id = (
          SELECT id
          FROM walk_logs
          WHERE kennel_id = d.kennel_id
          ORDER BY created_at DESC
          LIMIT 1
        )
      ORDER BY d.kennel_id ASC
    `);

    return res.json(rows);
  } catch (error) {
    console.error('Error loading dogs:', error);
    return res.status(500).json({ error: 'Failed to load dogs' });
  }
});

app.post('/api/dogs', async (req, res) => {
  const { kennel_id, display_name } = req.body || {};

  if (!kennel_id || !display_name) {
    return res.status(400).json({ error: 'kennel_id and display_name are required' });
  }

  try {
    await ensureDog(kennel_id, display_name);
    res.status(201).json({ ok: true, kennel_id, display_name });
  } catch (error) {
    console.error('Error creating dog:', error);
    res.status(500).json({ error: 'Failed to create dog' });
  }
});

app.post('/api/walks', async (req, res) => {
  const { kennel_id, name, comment } = req.body || {};

  if (!kennel_id || !name) {
    return res.status(400).json({ error: 'kennel_id and name are required' });
  }

  try {
    await ensureDog(kennel_id, kennel_id);

    const timestamp = new Date().toISOString();

    if (usePostgres) {
      const result = await pool.query(
        'INSERT INTO walk_logs (kennel_id, timestamp, name, comment) VALUES ($1, $2, $3, $4) RETURNING *',
        [kennel_id, timestamp, name, comment || '']
      );

      return res.status(201).json({
        ok: true,
        kennel_id,
        timestamp: result.rows[0].timestamp,
        name: result.rows[0].name,
        comment: result.rows[0].comment || ''
      });
    }

    const result = await sqliteRun(
      'INSERT INTO walk_logs (kennel_id, timestamp, name, comment) VALUES (?, ?, ?, ?)',
      [kennel_id, timestamp, name, comment || '']
    );

    const row = await sqliteGet('SELECT * FROM walk_logs WHERE id = ?', [result.lastID]);

    return res.status(201).json({
      ok: true,
      kennel_id: row.kennel_id,
      timestamp: row.timestamp,
      name: row.name,
      comment: row.comment || ''
    });
  } catch (error) {
    console.error('Error saving walk:', error);
    res.status(500).json({ error: 'Failed to save walk' });
  }
});

app.get('/api/walks/:kennel_id', async (req, res) => {
  const { kennel_id } = req.params;

  try {
    if (usePostgres) {
      const result = await pool.query(
        'SELECT * FROM walk_logs WHERE kennel_id = $1 ORDER BY created_at DESC',
        [kennel_id]
      );
      return res.json(result.rows);
    }

    const rows = await sqliteQuery(
      'SELECT * FROM walk_logs WHERE kennel_id = ? ORDER BY created_at DESC',
      [kennel_id]
    );
    return res.json(rows);
  } catch (error) {
    console.error('Error loading logs:', error);
    return res.status(500).json({ error: 'Failed to load logs' });
  }
});

app.delete('/api/walks/:kennel_id/last', async (req, res) => {
  const { kennel_id } = req.params;

  try {
    if (usePostgres) {
      const existing = await pool.query(
        'SELECT * FROM walk_logs WHERE kennel_id = $1 ORDER BY created_at DESC LIMIT 1',
        [kennel_id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'No walk log found for this kennel' });
      }

      const deleted = existing.rows[0];
      await pool.query('DELETE FROM walk_logs WHERE id = $1', [deleted.id]);
      return res.json({ ok: true, deleted });
    }

    const existing = await sqliteGet(
      'SELECT * FROM walk_logs WHERE kennel_id = ? ORDER BY created_at DESC LIMIT 1',
      [kennel_id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'No walk log found for this kennel' });
    }

    await sqliteRun('DELETE FROM walk_logs WHERE id = ?', [existing.id]);
    return res.json({ ok: true, deleted: existing });
  } catch (error) {
    console.error('Error deleting walk log:', error);
    return res.status(500).json({ error: 'Failed to delete walk log' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function startServer() {
  try {
    await initDatabase();
    app.listen(port, () => {
      console.log(`Shelter app running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

startServer();
