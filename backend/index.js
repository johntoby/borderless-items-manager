const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const client = require('prom-client');

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const httpErrorsTotal = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP errors (4xx and 5xx)',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const activeConnections = new client.Gauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost' }));
app.use(express.json());

// Metrics middleware
app.use((req, res, next) => {
  if (req.path === '/metrics') return next();
  activeConnections.inc();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status: res.statusCode };
    end(labels);
    httpRequestsTotal.inc(labels);
    if (res.statusCode >= 400) httpErrorsTotal.inc(labels);
    activeConnections.dec();
  });
  next();
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function initDB(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS items (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('Database initialized');
      return;
    } catch (err) {
      console.error(`DB init attempt ${i + 1} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error('Could not connect to database after multiple retries');
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

app.post('/api/items', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name must be a non-empty string' });
  if (name.length > 200) return res.status(400).json({ error: 'name must be 200 characters or fewer' });
  try {
    const result = await pool.query(
      'INSERT INTO items (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.put('/api/items/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name must be a non-empty string' });
  if (name.length > 200) return res.status(400).json({ error: 'name must be 200 characters or fewer' });
  try {
    const result = await pool.query(
      'UPDATE items SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  initDB()
    .then(() => app.listen(PORT, () => console.log(`Backend running on port ${PORT}`)))
    .catch(console.error);
}

module.exports = app;
