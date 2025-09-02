const BASE = `http://${import.meta.env.VITE_HOST_IP || '192.168.0.43'}:3001`;

export const api = {
  listServers: () => fetch(`${BASE}/api/servers`).then(r => r.json()),
  createServer: (payload) =>
    fetch(`${BASE}/api/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`Create failed ${r.status}`); return r.json(); }),
  createReplica: (id, payload) =>
    fetch(`${BASE}/api/replica/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`Replica failed ${r.status}`); return r.json(); }),
  createGroup: (id, payload) =>
    fetch(`${BASE}/api/groups/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`group failed ${r.status}`); return r.json(); }),    
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

           addreplsem: (payload) =>
    fetch(`${BASE}/api/project/1/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error(`create failed ${r.status}`); return r.json(); }),

      listGroups: () => fetch(`${BASE}/api/groups`).then(r => r.json()),

  
};