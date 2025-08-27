import React, { useEffect, useState } from "react";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, Typography, CircularProgress, MenuItem, Select,
  FormControl, InputLabel, Alert, Stack
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api } from "./api";

export default function Servers() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  // Create Server modal
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [provider, setProvider] = useState("proxmox");
  const [error, setError] = useState("");

  const blankProxmox = {
    new_vm_name: "", vm_memory: "", vm_cores: "",
    ci_user: "", ci_password: "", mysql_password: "",
    ipconfig0: "", is_master: "master", provider: "proxmox"
  };
  const [pxForm, setPxForm] = useState(blankProxmox);

  // Replica modal
  const [repOpen, setRepOpen] = useState(false);
  const [repCreating, setRepCreating] = useState(false);
  const [repError, setRepError] = useState("");
  const [parent, setParent] = useState(null);
  const [repForm, setRepForm] = useState({
    new_vm_name: "", vm_memory: "", vm_cores: "",
    ci_user: "", ci_password: "", mysql_password: "",
    ipconfig0: "", provider: "proxmox"
  });

  useEffect(() => {
    api.listServers()
      .then(setServers)
      .finally(() => setLoading(false));
  }, []);

  const validatePX = (data) => {
    const req = ["new_vm_name","vm_memory","vm_cores","ci_user","ci_password","mysql_password","ipconfig0"];
    for (const k of req) if (!data[k]) return `Please provide: ${k}`;
    if (+data.vm_memory <= 0) return "vm_memory must be > 0";
    if (+data.vm_cores <= 0) return "vm_cores must be > 0";
    if (!/ip=\d+\.\d+\.\d+\.\d+\/\d+,\s*gw=\d+\.\d+\.\d+\.\d+/i.test(data.ipconfig0))
      return "ipconfig0 must look like: ip=192.168.0.39/24,gw=192.168.0.1";
    return "";
  };

  const submitCreate = async (e) => {
  e.preventDefault();
  setError("");
  setCreating(true);
  setLaunching(true);

  try {
    if (provider !== "proxmox") throw new Error("Azure form not implemented yet");

    const v = validatePX(pxForm);
    if (v) throw new Error(v);

    // 1) Save the server row first
    const created = await api.createServer(pxForm);
    setServers((s) => [created, ...s]);

    // 2) Ask backend to create a Semaphore template + run + poll until finished
    const payload = {
      project_id: 1,
      inventory_id: 1,
      repository_id: 1,
      environment_id: 2,
      name: pxForm.new_vm_name,
      playbook:
        "/root/jery/new/ha-platform-full/backend/generated/playbooks/" +
        pxForm.new_vm_name +
        ".yml",
      app: "ansible",
    };

    const result = await api.addserversem(payload); // waits for 200 OK

    // 3) Decide what to do based on finalTask
    if (result?.finalTask?.status === "success") {
      // success → close dialog and reset form
      setPxForm(blankProxmox);
      setOpen(false);
    } else {
      // failure → keep dialog open and show message
      const status = result?.finalTask?.status || "unknown";
      setError(`Deployment failed (status: ${status}). Check Semaphore logs.`);
    }
  } catch (err) {
    setError(err.message || "Create failed");
  } finally {
    setCreating(false);
    setLaunching(false);
  }
};

  const openReplica = (sv) => {
    setParent(sv);
    setRepForm({
      new_vm_name: `${sv.new_vm_name}-r`,
      vm_memory: sv.vm_memory,
      vm_cores: sv.vm_cores,
      ci_user: sv.ci_user,
      ci_password: "",
      mysql_password: "",
      ipconfig0: sv.ipconfig0,
      provider: "proxmox"
    });
    setRepError("");
    setRepOpen(true);
  };

  const submitReplica = async (e) => {
    e.preventDefault();
    setRepError("");
    setRepCreating(true);
    try {
      const v = validatePX(repForm); if (v) throw new Error(v);
      const created = await api.createReplica(parent.id, repForm);
      setServers(s => [created, ...s]);
      setRepOpen(false);
    } catch (err) {
      setRepError(err.message || "Replica create failed");
    } finally {
      setRepCreating(false);
    }
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Servers</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Create Server
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>IP / ipconfig0</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress /></TableCell></TableRow>
            ) : servers.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">No servers.</TableCell></TableRow>
            ) : (
              servers.map(sv => (
                <TableRow key={sv.id}>
                  <TableCell>{sv.new_vm_name}</TableCell>
                  <TableCell>{sv.provider}</TableCell>
                  <TableCell>{sv.ip || sv.ipconfig0 || "—"}</TableCell>
                  <TableCell>{sv.is_master}</TableCell>
                  <TableCell>{sv.created_at ? new Date(sv.created_at).toLocaleString() : "—"}</TableCell>
                  <TableCell>
                    {sv.is_master === 'master' && (
                      <Button size="small" variant="outlined" onClick={() => openReplica(sv)}>
                        Add Replica
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Server */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Server</DialogTitle>
        <form onSubmit={submitCreate}>
          <DialogContent>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <FormControl fullWidth>
                <InputLabel id="prov">Provider</InputLabel>
                <Select labelId="prov" label="Provider" value={provider} onChange={e => setProvider(e.target.value)}>
                  <MenuItem value="proxmox">Proxmox</MenuItem>
                  <MenuItem value="azure" disabled>Azure (soon)</MenuItem>
                </Select>
              </FormControl>

              {/* Proxmox form */}
              <TextField label="new_vm_name" name="new_vm_name" value={pxForm.new_vm_name}
                onChange={e => setPxForm({ ...pxForm, new_vm_name: e.target.value })} required fullWidth />
              <TextField label="vm_memory (MiB)" name="vm_memory" type="number" value={pxForm.vm_memory}
                onChange={e => setPxForm({ ...pxForm, vm_memory: e.target.value })} required fullWidth />
              <TextField label="vm_cores" name="vm_cores" type="number" value={pxForm.vm_cores}
                onChange={e => setPxForm({ ...pxForm, vm_cores: e.target.value })} required fullWidth />
              <TextField label="ci_user" name="ci_user" value={pxForm.ci_user}
                onChange={e => setPxForm({ ...pxForm, ci_user: e.target.value })} required fullWidth />
              <TextField label="ci_password" name="ci_password" type="password" value={pxForm.ci_password}
                onChange={e => setPxForm({ ...pxForm, ci_password: e.target.value })} required fullWidth />
              <TextField label="mysql_password" name="mysql_password" type="password" value={pxForm.mysql_password}
                onChange={e => setPxForm({ ...pxForm, mysql_password: e.target.value })} required fullWidth />
              <TextField
                label="ipconfig0 (ip=192.168.0.39/24,gw=192.168.0.1)"
                name="ipconfig0" value={pxForm.ipconfig0}
                onChange={e => setPxForm({ ...pxForm, ipconfig0: e.target.value })} required fullWidth
              />
            </Stack>

            {launching && (
      <Box display="flex" alignItems="center" mt={2}>
        <CircularProgress size={28} />
        <Typography ml={2}>Deploying VM... please wait</Typography>
      </Box>
    )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Add Replica */}
      <Dialog open={repOpen} onClose={() => setRepOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Replica {parent ? `for ${parent.new_vm_name}` : ""}</DialogTitle>
        <form onSubmit={submitReplica}>
          <DialogContent>
            <Stack spacing={2}>
              {repError && <Alert severity="error">{repError}</Alert>}
              <TextField label="new_vm_name" value={repForm.new_vm_name}
                onChange={e => setRepForm({ ...repForm, new_vm_name: e.target.value })} required fullWidth />
              <TextField label="vm_memory (MiB)" type="number" value={repForm.vm_memory}
                onChange={e => setRepForm({ ...repForm, vm_memory: e.target.value })} required fullWidth />
              <TextField label="vm_cores" type="number" value={repForm.vm_cores}
                onChange={e => setRepForm({ ...repForm, vm_cores: e.target.value })} required fullWidth />
              <TextField label="ci_user" value={repForm.ci_user}
                onChange={e => setRepForm({ ...repForm, ci_user: e.target.value })} required fullWidth />
              <TextField label="ci_password" type="password" value={repForm.ci_password}
                onChange={e => setRepForm({ ...repForm, ci_password: e.target.value })} required fullWidth />
              <TextField label="mysql_password" type="password" value={repForm.mysql_password}
                onChange={e => setRepForm({ ...repForm, mysql_password: e.target.value })} required fullWidth />
              <TextField
                label="ipconfig0 (ip=192.168.0.39/24,gw=192.168.0.1)"
                value={repForm.ipconfig0}
                onChange={e => setRepForm({ ...repForm, ipconfig0: e.target.value })} required fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRepOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={repCreating}>
              {repCreating ? "Creating…" : "Create Replica"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
