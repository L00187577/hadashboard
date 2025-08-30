const BASE = `http://${import.meta.env.VITE_HOST_IP || '192.168.0.43'}:3001`;

export const api = {
  listServers: () => fetch(`${BASE}/api/servers`).then(r => r.json()),
  createServer: (payload) =>
    fetch(`${BASE}/api/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`Create failed ${r.status}`); return r.json(); }),
  createReplica: (id, payload) =>
    fetch(`${BASE}/api/servers/${id}/replica/proxmox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`Replica failed ${r.status}`); return r.json(); }),
  listCreds: () => fetch(`${BASE}/api/proxmox_creds`).then(r => r.json()),
  addCred: (payload) =>
    fetch(`${BASE}/api/proxmox_creds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`Cred failed ${r.status}`); return r.json(); }),
   addcredsem: (payload) =>
    fetch(`${BASE}/api/project/1/environment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`Credsem failed ${r.status}`); return r.json(); }), 
     addserversem: (payload) =>
    fetch(`${BASE}/api/project/1/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`create failed ${r.status}`); return r.json(); }),
      async getServers() {
    const r = await fetch(`${BASE}/api/servers`, { credentials: "include" });
    if (!r.ok) throw new Error(`Failed to fetch servers: ${r.status}`);
    return r.json();
  },

  listGroups: () => fetch(`${BASE}/api/groups`).then(r => r.json()),

  async createGroup(payload) {
    // expected payload: { server_id, lb_algorithm, proxy_ip }
    const r = await fetch(`${BASE}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const msg = await r.text().catch(() => "");
      throw new Error(`Create group failed: ${r.status} ${msg}`);
    }
    return r.json();
  },     
};