import React, { useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Typography, Table, TableHead, TableRow, TableCell, TableBody,
  TableContainer, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, CircularProgress, Alert
} from "@mui/material";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { api } from "../api";

const algoOptions = [
  { value: "round_robin", label: "Round Robin" },
  { value: "least_connections", label: "Least Connections" },
  { value: "source_ip_hash", label: "Source IP Hash" },
];

export default function Groups() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [dlgOpen, setDlgOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);
  const [form, setForm] = useState({ lb_algorithm: "round_robin", proxy_ip: "" });

  const handleOpen = (server) => {
    setSelectedServer(server);
    setForm({ lb_algorithm: "round_robin", proxy_ip: "" });
    setDlgOpen(true);
  };
  const handleClose = () => {
    setDlgOpen(false);
    setSelectedServer(null);
    setErr("");
  };
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const validate = useMemo(
    () => (data) => {
      if (!data.proxy_ip?.trim()) return "Proxy IP is required";
      // very light check; keep simple (IPv4 or hostname)
      if (!/^([a-zA-Z0-9\.\-]+)$/.test(data.proxy_ip.trim())) return "Proxy IP/host looks invalid";
      if (!algoOptions.find(a => a.value === data.lb_algorithm)) return "Select a valid LB algorithm";
      return "";
    },
    []
  );

  const submit = async () => {
    setErr("");
    const v = validate(form);
    if (v) { setErr(v); return; }
    if (!selectedServer) { setErr("No server selected"); return; }
    setSubmitting(true);
    try {
      const payload = {
        server_id: selectedServer.id,
        lb_algorithm: form.lb_algorithm,
        proxy_ip: form.proxy_ip.trim(),
      };
      await api.createGroup(payload);
      handleClose();
    } catch (e) {
      setErr(e.message || "Failed to create group");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await api.getServers();
        if (alive) setServers(data);
      } catch (e) {
        if (alive) setErr(e.message || "Failed to load servers");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>Groups</Typography>

      {err && !dlgOpen && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Server Name</TableCell>
              <TableCell>Memory (MiB)</TableCell>
              <TableCell>Cores</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>IP (ipconfig0)</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : servers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">No servers found.</TableCell>
              </TableRow>
            ) : (
              servers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.new_vm_name}</TableCell>
                  <TableCell>{s.vm_memory}</TableCell>
                  <TableCell>{s.vm_cores}</TableCell>
                  <TableCell>{s.provider || "-"}</TableCell>
                  <TableCell>{s.ipconfig0}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<AddCircleOutlineIcon />}
                      onClick={() => handleOpen(s)}
                    >
                      Create Group
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dlgOpen} onClose={submitting ? undefined : handleClose} fullWidth maxWidth="sm">
        <DialogTitle>
          Create Group {selectedServer ? `for ${selectedServer.new_vm_name}` : ""}
        </DialogTitle>
        <DialogContent dividers>
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          <TextField
            label="LB Algorithm"
            name="lb_algorithm"
            value={form.lb_algorithm}
            onChange={handleChange}
            select
            fullWidth
            margin="normal"
            required
          >
            {algoOptions.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Proxy IP / Host"
            name="proxy_ip"
            value={form.proxy_ip}
            onChange={handleChange}
            placeholder="e.g. 192.168.0.50"
            fullWidth
            margin="normal"
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={submitting}>
            {submitting ? <CircularProgress size={20} /> : "Create Group"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}