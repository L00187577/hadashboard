require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const Joi = require('joi');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(express.json());

/* ========= CORS (Express 5 safe) ========= */
const allowedOrigins = new Set([
  'http://localhost:5173',
  `http://${process.env.HOST_IP || '192.168.0.43'}:5173`,
]);
const corsOptions = {
  origin(origin, cb) {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};
// helpful log
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl} Origin=${req.headers.origin || '(none)'} `);
  next();
});
app.use('/api', cors(corsOptions));
app.options(/\/api\/.*/, cors(corsOptions));

/* ========= MySQL Pool ========= */
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/* ========= Schemas ========= */
const credSchema = Joi.object({
  credential_name: Joi.string().max(255).required(),
  api_user: Joi.string().max(255).required(),
  api_token: Joi.string().max(255).required(),
  api_url: Joi.string().max(255).required(),
  api_token_id: Joi.string().max(255).required(),
});

const serverSchema = Joi.object({
  new_vm_name: Joi.string().max(128).required(),
  vm_memory: Joi.number().integer().min(1).required(),
  vm_cores: Joi.number().integer().min(1).required(),
  ci_user: Joi.string().max(64).required(),
  ci_password: Joi.string().min(6).max(255).required(),
  mysql_password: Joi.string().min(6).max(255).required(),
  ipconfig0: Joi.string().max(255).required(),
  is_master: Joi.string().max(128).required(), // "master" or master name
  provider: Joi.string().valid('proxmox','azure').required(),
});

const replicaSchema = Joi.object({
  new_vm_name: Joi.string().max(128).required(),
  vm_memory: Joi.number().integer().min(1).required(),
  vm_cores: Joi.number().integer().min(1).required(),
  ci_user: Joi.string().max(64).required(),
  ci_password: Joi.string().min(6).max(255).required(),
  mysql_password: Joi.string().min(6).max(255).required(),
  ipconfig0: Joi.string().max(255).required(),
  provider: Joi.string().valid('proxmox','azure').optional(),
});

/* ========= Routes ========= */

/** Proxmox Credentials */
app.get('/api/proxmox_creds', async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, credential_name, api_user, api_url, api_token_id, created_at FROM proxmox_creds ORDER BY id DESC'
  );
  res.json(rows);
});

app.post('/api/proxmox_creds', async (req, res) => {
  const { error, value } = credSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { credential_name, api_user, api_token, api_url, api_token_id } = value;
  const sql = `
    INSERT INTO proxmox_creds (credential_name, api_user, api_token, api_url, api_token_id)
    VALUES (?, ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [credential_name, api_user, api_token, api_url, api_token_id]);
  const [row] = await pool.query(
    'SELECT id, credential_name, api_user, api_url, api_token_id, created_at FROM proxmox_creds WHERE id=?',
    [result.insertId]
  );
  res.status(201).json(row[0]);
});

/** Servers (masters) */
app.get('/api/servers', async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, is_master, provider, status, ip, created_at FROM servers ORDER BY id DESC'
  );
  res.json(rows);
});

app.post('/api/servers', async (req, res) => {
  const { error, value } = serverSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const {
    new_vm_name, vm_memory, vm_cores, ci_user,
    ci_password, mysql_password, ipconfig0,
    is_master, provider
  } = value;

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
  const hashedCi = await bcrypt.hash(ci_password, saltRounds);
  const hashedDb = await bcrypt.hash(mysql_password, saltRounds);

  const sql = `
    INSERT INTO servers
      (new_vm_name, vm_memory, vm_cores, ci_user, ci_password, mysql_password, ipconfig0, is_master, provider, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
  `;
  const params = [
    new_vm_name, vm_memory, vm_cores, ci_user,
    hashedCi, hashedDb, ipconfig0, is_master, provider
  ];

  try {
    const [result] = await pool.execute(sql, params);
    const [row] = await pool.query(
      `SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, is_master, provider, status, ip, created_at
       FROM servers WHERE id=?`,
      [result.insertId]
    );
    res.status(201).json(row[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Server name must be unique' });
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Replicas */
app.post('/api/servers/:id/replica', async (req, res) => {
  const { error, value } = replicaSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const [parents] = await pool.query(
    'SELECT id, new_vm_name, is_master, provider FROM servers WHERE id=?',
    [req.params.id]
  );
  if (parents.length === 0) return res.status(404).json({ error: 'Parent server not found' });
  const parent = parents[0];

  const masterName =
    parent.is_master && parent.is_master.toLowerCase() !== 'master'
      ? parent.is_master
      : parent.new_vm_name;

  const provider = value.provider || parent.provider || 'proxmox';
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
  const hashedCi = await bcrypt.hash(value.ci_password, saltRounds);
  const hashedDb = await bcrypt.hash(value.mysql_password, saltRounds);

  const sql = `
    INSERT INTO servers
      (new_vm_name, vm_memory, vm_cores, ci_user, ci_password, mysql_password, ipconfig0, is_master, provider, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
  `;
  const params = [
    value.new_vm_name, value.vm_memory, value.vm_cores,
    value.ci_user, hashedCi, hashedDb, value.ipconfig0,
    masterName, provider
  ];

  try {
    const [result] = await pool.execute(sql, params);
    const [row] = await pool.query(
      `SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, is_master, provider, status, ip, created_at
       FROM servers WHERE id=?`,
      [result.insertId]
    );
    res.status(201).json(row[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Server name must be unique' });
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Alias for convenience */
app.post('/api/servers/:id/replica/proxmox', (req, res, next) => {
  req.body.provider = req.body.provider || 'proxmox';
  app._router.handle(
    { ...req, url: `/api/servers/${req.params.id}/replica`, method: 'POST' },
    res,
    next
  );
});

/** Update status/ip */
app.patch('/api/servers/:id', async (req, res) => {
  const { status, ip } = req.body;
  if (!status && !ip) return res.status(400).json({ error: 'No fields to update' });
  const fields = [];
  const params = [];
  if (status) { fields.push('status=?'); params.push(status); }
  if (ip) { fields.push('ip=?'); params.push(ip); }
  params.push(req.params.id);
  await pool.execute(`UPDATE servers SET ${fields.join(', ')}, updated_at=NOW() WHERE id=?`, params);
  const [row] = await pool.query(
    'SELECT id, new_vm_name, provider, status, ip, created_at FROM servers WHERE id=?',
    [req.params.id]
  );
  res.json(row[0] || {});
});

/* ========= Start ========= */
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API listening on :${port}`));
