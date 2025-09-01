require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const Joi = require('joi');
const bcrypt = require('bcrypt');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const app = express();
app.use(express.json());
const GEN_DIR = path.join(__dirname, 'generated', 'playbooks');
fs.mkdirSync(GEN_DIR, { recursive: true });

// static hosting so the client can download the yaml
app.use('/generated', express.static(path.join(__dirname, 'generated')));


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
    'SELECT id, credential_name, api_user, api_url, created_at FROM proxmox_creds ORDER BY id DESC'
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
    'SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, is_master, provider, created_at FROM servers ORDER BY id DESC'
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
      (new_vm_name, vm_memory, vm_cores, ci_user, ci_password, mysql_password, ipconfig0, is_master, provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    new_vm_name, vm_memory, vm_cores, ci_user,
    hashedCi, hashedDb, ipconfig0, is_master, provider
  ];

  try {
    const [result] = await pool.execute(sql, params);
    const [row] = await pool.query(
      `SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, is_master, provider, created_at
       FROM servers WHERE id=?`,
      [result.insertId]
    );
    res.status(201).json(row[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Server name must be unique' });
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }

    // === NEW: generate YAML from the form data ===
    const yamlText = buildProxmoxPlaybookYAML({
      
      new_vm_name,
      vm_memory,
      vm_cores,
      ci_user,
      ci_password, // plaintext required in YAML to pass to cloud-init
      ipconfig0,
      
    });

    const { publicUrl, filename } = savePlaybookYAML(new_vm_name, yamlText);

});

/** Replicas */

app.post('/api/replica/:id', async (req, res) => {
  const { error, value } = replicaSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const parentId = req.params.id;

  // Look up parent
  const [parents] = await pool.query(
    'SELECT id, new_vm_name, is_master, provider, ipconfig0 FROM servers WHERE id = ?',
    [parentId]
  );
  if (parents.length === 0) return res.status(404).json({ error: 'Parent server not found' });

  const parent = parents[0];
  const masterName =
    parent.is_master && parent.is_master.toLowerCase() !== 'master'
      ? parent.is_master
      : parent.new_vm_name;

  const provider = value.provider || parent.provider || 'proxmox';

  // Hash secrets for DB storage
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
  const hashedCi = await bcrypt.hash(value.ci_password, saltRounds);
  const hashedDb = await bcrypt.hash(value.mysql_password, saltRounds);

  // Extract IPs for YAML
  const masterip = parent.ipconfig0.split(',')[0].split('=')[1].split('/')[0];
  const replip = value.ipconfig0.split(',')[0].split('=')[1].split('/')[0];

  try {
    // Insert replica row
    const sql = `
      INSERT INTO servers
        (new_vm_name, vm_memory, vm_cores, ci_user, ci_password, mysql_password, ipconfig0, is_master, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      value.new_vm_name, value.vm_memory, value.vm_cores,
      value.ci_user, hashedCi, hashedDb, value.ipconfig0,
      masterName, provider
    ];
    const [result] = await pool.execute(sql, params);

    // Build YAML BEFORE responding (so we can report any errors)
    const yamlText = buildreplPlaybookYAML({
      new_vm_name: value.new_vm_name,
      vm_memory: value.vm_memory,
      vm_cores: value.vm_cores,
      ci_user: value.ci_user,
      ci_password: value.ci_password, // needs plaintext for cloud-init
      ipconfig0: value.ipconfig0,
      masterip,
      masterName,
      replip,
    });

    const { publicUrl, filename } = savePlaybookYAML(value.new_vm_name, yamlText);

    // Return the newly created server row + playbook info
    const [rows] = await pool.query(
      `SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, is_master, provider, created_at
       FROM servers WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({
      ...rows[0],
      playbook_url: publicUrl,
      playbook_path: filename,
    });

  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Server name must be unique' });
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});






/** Proxy endpoint (Semaphore API credentials) **/
app.post('/api/project/1/environment', async (req, res) => {
  try {
    const response = await fetch('http://192.168.0.43:3000/api/project/1/environment', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer vtdgwvof4ifaamne_prhtlwvnzv6brf4nrapw0u61ly=',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

/** Proxy endpoint (Semaphore API: create template) **/
app.post('/api/project/1/templates', async (req, res) => {
  try {
    const response = await fetch('http://192.168.0.43:3000/api/project/1/templates', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer vtdgwvof4ifaamne_prhtlwvnzv6brf4nrapw0u61ly=',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),   // expects your template JSON
    });

    const data = await response.json();



     if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const templateId = data.id;
    if (!templateId) {
      return res.status(500).json({ error: 'No template ID returned from Semaphore' });
    }

    // 2. Start task
    const runResp = await fetch('http://192.168.0.43:3000/api/project/1/tasks', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer vtdgwvof4ifaamne_prhtlwvnzv6brf4nrapw0u61ly=',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template_id: templateId, project_id: 1 }),
    });

    const runResult = await runResp.json();
    if (!runResp.ok) {
      return res.status(runResp.status).json(runResult);
    }

    const taskId = runResult.id;
    if (!taskId) {
      return res.status(500).json({ error: 'No task ID returned from Semaphore' });
    }

    // 3. Poll task until completion
    async function pollTask() {
      const taskResp = await fetch(`http://192.168.0.43:3000/api/project/1/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer vtdgwvof4ifaamne_prhtlwvnzv6brf4nrapw0u61ly=',
          'Content-Type': 'application/json',
        },
       
      });

      const taskData = await taskResp.json();
      const status = taskData.status;

      console.log(`[Poll] Task ${taskId} status: ${status}`);

      if (status === 'success' || status === 'error') {
        return taskData;
      }

      // wait 3 seconds before next poll
      await new Promise(r => setTimeout(r, 3000));
      return pollTask();
    }

    const finalTask = await pollTask();

    // 4. Return everything
    res.status(200).json({
      data,
      runResult,
      finalTask,
    });

  } catch (err) {
    console.error('[Proxy] templates-and-run error:', err);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

function buildProxmoxPlaybookYAML(data) {
  const play = [
    {
      name: 'Create VM from template in Proxmox',
      hosts: 'localhost',
      gather_facts: false,
      vars: {
        template_name: new YAML.Scalar('mysqla', { type: YAML.Scalar.QUOTE_DOUBLE }),
        new_vm_name: new YAML.Scalar(data.new_vm_name, { type: YAML.Scalar.QUOTE_DOUBLE }),
        vm_memory: Number(data.vm_memory),
        vm_cores: Number(data.vm_cores),
      },
      tasks: [
        {
          name: 'Clone VM from template',
          'community.general.proxmox_kvm': {
            api_user: "{{ lookup('env', 'PROXMOX_API_USER') }}",
            api_token_secret: "{{ lookup('env', 'PROXMOX_API_TOKEN') }}",
            api_token_id: "{{ lookup('env', 'PROXMOX_API_TOKEN_ID') }}",
            api_host: "{{ lookup('env', 'PROXMOX_API_URL') }}",
            node: data.node || 'pve',
            clone: "{{ template_name }}",
            name: "{{ new_vm_name }}",
            cores: "{{ vm_cores }}",
            memory: "{{ vm_memory }}",
            state: 'present',
            timeout: 300,
          },
        },
        {
          name: 'Set Cloud-Init network config',
          'community.general.proxmox_kvm': {
            api_user: "{{ lookup('env', 'PROXMOX_API_USER') }}",
            api_token_secret: "{{ lookup('env', 'PROXMOX_API_TOKEN') }}",
            api_token_id: "{{ lookup('env', 'PROXMOX_API_TOKEN_ID') }}",
            api_host: "{{ lookup('env', 'PROXMOX_API_URL') }}",
            node: data.node || 'pve',
            name: "{{ new_vm_name }}",
            cores: "{{ vm_cores }}",
            memory: "{{ vm_memory }}",
            ciuser: new YAML.Scalar(data.ci_user, { type: YAML.Scalar.QUOTE_DOUBLE }),
            cipassword: new YAML.Scalar(data.ci_password, { type: YAML.Scalar.QUOTE_DOUBLE }),
            ipconfig: {
              ipconfig0: new YAML.Scalar(data.ipconfig0, { type: YAML.Scalar.QUOTE_DOUBLE }),
            },
            update: true,
            update_unsafe: true,
            state: 'present',
          },
        },
        {
          name: 'Start the new VM',
          'community.general.proxmox_kvm': {
            api_user: "{{ lookup('env', 'PROXMOX_API_USER') }}",
            api_token_secret: "{{ lookup('env', 'PROXMOX_API_TOKEN') }}",
            api_token_id: "{{ lookup('env', 'PROXMOX_API_TOKEN_ID') }}",
            api_host: "{{ lookup('env', 'PROXMOX_API_URL') }}",
            node: data.node || 'pve',
            name: "{{ new_vm_name }}",
            state: 'started',
          },
        },
      ],
    },
  ];

  // Build as YAML document
  const doc = new YAML.Document(play);
  doc.contents.items?.forEach(item => {
    if (item.value && item.value.type === 'PLAIN') {
      item.value.type = 'QUOTE_DOUBLE'; // quote only values, not keys
    }
  });

  return String(doc);
}

function buildreplPlaybookYAML(data) {
  const q = (s) => new YAML.Scalar(String(s), { type: YAML.Scalar.QUOTE_DOUBLE });

  const plays = [
    // Play 0: Provision VM on Proxmox
    {
      name: 'Create VM from template in Proxmox',
      hosts: 'localhost',
      gather_facts: false,
      vars: {
        template_name: q('mysqlb'),
        new_vm_name: q(data.new_vm_name),
        vm_memory: Number(data.vm_memory),
        vm_cores: Number(data.vm_cores),
        mastip: q(data.masterip),
      },
      tasks: [
        {
          name: 'Clone VM from template',
          'community.general.proxmox_kvm': {
            api_user: q("{{ lookup('env', 'PROXMOX_API_USER') }}"),
            api_token_secret: q("{{ lookup('env', 'PROXMOX_API_TOKEN') }}"),
            api_token_id: q("{{ lookup('env', 'PROXMOX_API_TOKEN_ID') }}"),
            api_host: q("{{ lookup('env', 'PROXMOX_API_URL') }}"),
            node: q(data.node || 'pve'),
            clone: q("{{ template_name }}"),
            name: q("{{ new_vm_name }}"),
            cores: q("{{ vm_cores }}"),
            memory: q("{{ vm_memory }}"),
            state: q('present'),
            timeout: 300,
          },
        },
        {
          name: 'Set Cloud-Init network config',
          'community.general.proxmox_kvm': {
            api_user: q("{{ lookup('env', 'PROXMOX_API_USER') }}"),
            api_token_secret: q("{{ lookup('env', 'PROXMOX_API_TOKEN') }}"),
            api_token_id: q("{{ lookup('env', 'PROXMOX_API_TOKEN_ID') }}"),
            api_host: q("{{ lookup('env', 'PROXMOX_API_URL') }}"),
            node: q(data.node || 'pve'),
            name: q("{{ new_vm_name }}"),
            cores: q("{{ vm_cores }}"),
            memory: q("{{ vm_memory }}"),
            ciuser: q(data.ci_user),
            cipassword: q(data.ci_password),
            ipconfig: {
              ipconfig0: q(data.ipconfig0),
            },
            update: true,
            update_unsafe: true,
            state: q('present'),
          },
        },
        {
          name: 'Start the new VM',
          'community.general.proxmox_kvm': {
            api_user: q("{{ lookup('env', 'PROXMOX_API_USER') }}"),
            api_token_secret: q("{{ lookup('env', 'PROXMOX_API_TOKEN') }}"),
            api_token_id: q("{{ lookup('env', 'PROXMOX_API_TOKEN_ID') }}"),
            api_host: q("{{ lookup('env', 'PROXMOX_API_URL') }}"),
            node: q(data.node || 'pve'),
            name: q("{{ new_vm_name }}"),
            state: q('started'),
          },
        },
      ],
    },

    // Play 1: Add PRIMARY & REPLICA to in-memory inventory
    {
      name: 'Add PRIMARY and REPLICA to in-memory inventory',
      hosts: 'localhost',
      gather_facts: false,
      vars: {
        primary_host: q(data.masterip),
        primary_port: 3306,
        primary_root_user: q('root'),
        primary_root_password: q('hehehe'),
        replication_user: q('repl'),
        replication_password: q('hahaha'),

        replica_root_user: q('root'),
        replica_root_password: q('hehehe'),
        replica_server_id: 2,
        


      },
      tasks: [
        {
          name: 'Add the primary to the in-memory inventory',
          add_host: {
            name: q('mysqlp'),
            ansible_host: q(data.masterip),
            ansible_user: q('jery'),
            ansible_password: q('hehehe'),
            ansible_python_interpreter: '/usr/bin/python3',
          },
        },
        {
          name: 'Add the replica to the in-memory inventory',
          add_host: {
            name: q('mysqlr'),
            ansible_host: q(data.replip),
            ansible_user: q('jery'),
            ansible_password: q('hehehe'),
            ansible_python_interpreter: '/usr/bin/python3',
          },
        },
        {
          name: "Test SSH connectivity to primary",
          delegate_to: "mysqlp",
          "ansible.builtin.ping": {},
        },
        {
          name: "Test SSH connectivity to replica",
          delegate_to: "mysqlr",
          "ansible.builtin.ping": {},
        },
      ],
    },

    // Play 2: Phase 1 Prepare PRIMARY
    {
      name: 'Phase 1 Prepare PRIMARY (user + GTID dump)',
      hosts: 'mysqlp',
      gather_facts: true,
      become: true,
      vars: {
        primary_root_user: q('root'),
        primary_root_password: q('hehehe'),
        replication_user: q('repl'),
        replication_password: q('hahaha'),
      },
      tasks: [
        {
          name: 'Ensure replication user exists on PRIMARY',
          'community.mysql.mysql_user': {
            name: q('{{ replication_user }}'),
            password: q('{{ replication_password }}'),
            host: q('%'),
            priv: q('*.*:REPLICATION SLAVE,REPLICATION CLIENT'),
            login_user: q('{{ primary_root_user }}'),
            login_password: q('{{ primary_root_password }}'),
            state: q('present'),
          },
        },
      ],
    },

    // Play 3: Phase 2 Prepare REPLICA
    {
      name: 'Phase 2 Prepare REPLICA (config + start replication)',
      hosts: 'mysqlr',
      gather_facts: true,
      become: true,
      vars: {
        mycnf_path: q('/etc/mysql/conf.d/99-replica.cnf'),
        replica_server_id: 2,
        primary_host: q(data.masterip),
        primary_port: 3306,
        replication_user: q('repl'),
        replication_password: q('hahaha'),
        replica_root_user: q('root'),
        replica_root_password: q('hehehe'),
      },
      tasks: [
        {
          name: 'Ensure replica MySQL config for GTID/binlog/relay/read-only',
          'ansible.builtin.blockinfile': {
            path: q('{{ mycnf_path }}'),
            create: true,
            mode: q('0644'),
            block:
              '[mysqld]\n' +
              'server_id = {{ replica_server_id }}\n' +
              'log_bin = mysql-bin\n' +
              'binlog_format = ROW\n' +
              'gtid_mode = ON\n' +
              'enforce_gtid_consistency = ON\n' +
              'relay_log = relay-bin\n' +
              'read_only = ON\n' +
              'super_read_only = ON\n',
          },
          notify: q('Restart MySQL'),
        },
        { name: 'Flush handlers if config changed', 'ansible.builtin.meta': 'flush_handlers' },
        {
          name: 'Reset replica (clean state)',
          'community.mysql.mysql_replication': {
            mode: q('resetreplica'),
            login_user: q('{{ replica_root_user }}'),
            login_password: q('{{ replica_root_password }}'),
          },
        },
        {
          name: 'stop replica (clean state)',
          'community.mysql.mysql_replication': {
            mode: q('stopreplica'),
            login_user: q('{{ replica_root_user }}'),
            login_password: q('{{ replica_root_password }}'),
          },
        },
        {
          name: 'Configure replication with AUTO_POSITION (GTID)',
          'community.mysql.mysql_replication': {
            mode: q('changeprimary'),
            primary_host: q('{{ primary_host }}'),
            primary_port: q('{{ primary_port | default(3306) }}'),
            primary_user: q('{{ replication_user }}'),
            primary_password: q('{{ replication_password }}'),
            primary_auto_position: true,
            login_user: q('{{ replica_root_user }}'),
            login_password: q('{{ replica_root_password }}'),
          },
        },
        {
          name: 'Start replication',
          'community.mysql.mysql_replication': {
            mode: q('startreplica'),
            login_user: q('{{ replica_root_user }}'),
            login_password: q('{{ replica_root_password }}'),
          },
        },
        {
          name: 'Check replication status',
          'community.mysql.mysql_replication': {
            mode: q('getreplica'),
            login_user: q('{{ replica_root_user }}'),
            login_password: q('{{ replica_root_password }}'),
          },
          register: 'repl_status',
        },
        {
          name: 'Fail if replication threads not running',
          'ansible.builtin.fail': {
            msg:
              'Replication not healthy: IO={{ repl_status.replica_status.Slave_IO_Running | default(repl_status.replica_status.Replica_IO_Running) }}, ' +
              'SQL={{ repl_status.replica_status.Slave_SQL_Running | default(repl_status.replica_status.Replica_SQL_Running) }}',
          },
          when:
            "(repl_status.replica_status.Slave_IO_Running is defined and repl_status.replica_status.Slave_IO_Running != 'Yes') or " +
            "(repl_status.replica_status.Replica_IO_Running is defined and repl_status.replica_status.Replica_IO_Running != 'YES') or " +
            "(repl_status.replica_status.Slave_SQL_Running is defined and repl_status.replica_status.Slave_SQL_Running != 'Yes') or " +
            "(repl_status.replica_status.Replica_SQL_Running is defined and repl_status.replica_status.Replica_SQL_Running != 'YES')",
        },
      ],
      handlers: [
        {
          name: 'Restart MySQL',
          'ansible.builtin.service': { name: 'mysql', state: 'restarted' },
        },
      ],
    },
  ];

  const doc = new YAML.Document(plays);
  return String(doc);
}
function savePlaybookYAML(new_vm_name, yamlText) {
  const filename = `${new_vm_name}.yml`;
  const filePath = path.join(GEN_DIR, filename);
  fs.writeFileSync(filePath, yamlText, 'utf8');
  // public URL path (served by /generated static)
  const publicUrl = `/generated/playbooks/${filename}`;
  return { filePath, publicUrl, filename };
}


app.get('/api/groups', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, new_vm_name, vm_memory, vm_cores, ci_user, ipconfig0, 
              is_master, provider, created_at 
       FROM servers 
       WHERE is_master = 'master'
       ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching groups:", err);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

app.post('/api/groups', async (req, res) => {
  const { server_id, lb_algorithm, proxy_ip } = req.body || {};
  if (!server_id || !lb_algorithm || !proxy_ip) {
    return res.status(400).json({ error: "server_id, lb_algorithm, proxy_ip required" });
  }
  try {
    const [r] = await pool.execute(
      "INSERT INTO groups (server_id, lb_algorithm, proxy_ip) VALUES (?, ?, ?)",
      [server_id, lb_algorithm, proxy_ip]
    );
    const [row] = await pool.execute("SELECT * FROM groups WHERE id = ?", [r.insertId]);
    res.status(201).json(row[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ========= Start ========= */
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API listening on :${port}`));
