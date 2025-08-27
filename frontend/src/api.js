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
};