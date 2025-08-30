import React, { useEffect, useState } from "react";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, Typography, CircularProgress, MenuItem, Select,
  FormControl, InputLabel, Alert, Stack
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api } from "./api";

const LB_ALGOS = [
  { value: "round_robin", label: "Round Robin" },
  { value: "least_connections", label: "Least Connections" },
  { value: "source_ip_hash", label: "Source IP Hash" },
];

export default function Groups() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create Group modal
  const [grpOpen, setGrpOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [parent, setParent] = useState(null);
  const [form, setForm] = useState({
    lb_algorithm: "round_robin",
    proxy_ip: "",
  });

  useEffect(() => {
    api.listGroups()
      .then(setServers)
      .finally(() => setLoading(false));
  }, []);

  const openGroup = (sv) => {
    setParent(sv);
    setForm({ lb_algorithm: "round_robin", proxy_ip: "" });
    setError("");
    setGrpOpen(true);
  };

  const validate = (data) => {
    if (!data.lb_algorithm) return "Please select an LB algorithm";
    if (!data.proxy_ip?.trim()) return "Please provide Proxy IP / Host";
    if (!/^([a-zA-Z0-9\.\-]+)$/.test(data.proxy_ip.trim()))
      return "Proxy IP/host looks invalid";
    return "";
  };

  const submitGroup = async (e) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      if (!parent?.id) throw new Error("No server selected");
      const v = validate(form); if (v) throw new Error(v);

      // Backend expects: { server_id, lb_algorithm, proxy_ip }
      await api.createGroup({
        server_id: parent.id,
        lb_algorithm: form.lb_algorithm,
        proxy_ip: form.proxy_ip.trim(),
      });

      setGrpOpen(false);
      setParent(null);
    } catch (err) {
      setError(err.message || "Create group failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Groups</Typography>
        {/* Page-level action not needed since creation is per-row; keep layout consistent */}
        <Box />
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
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : servers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">No servers.</TableCell>
              </TableRow>
            ) : (
              servers.map(sv => (
                <TableRow key={sv.id}>
                  <TableCell>{sv.new_vm_name}</TableCell>
                  <TableCell>{sv.provider}</TableCell>
                  <TableCell>{sv.ip || sv.ipconfig0 || "—"}</TableCell>
                  <TableCell>{sv.is_master}</TableCell>
                  <TableCell>{sv.created_at ? new Date(sv.created_at).toLocaleString() : "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={() => openGroup(sv)}
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

      {/* Create Group (per-row) */}
      <Dialog open={grpOpen} onClose={() => setGrpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Create Group {parent ? `for ${parent.new_vm_name}` : ""}
        </DialogTitle>
        <form onSubmit={submitGroup}>
          <DialogContent>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}

              <FormControl fullWidth>
                <InputLabel id="lb-algo">LB Algorithm</InputLabel>
                <Select
                  labelId="lb-algo"
                  label="LB Algorithm"
                  value={form.lb_algorithm}
                  onChange={(e) => setForm({ ...form, lb_algorithm: e.target.value })}
                  required
                >
                  {LB_ALGOS.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Proxy IP / Host"
                value={form.proxy_ip}
                onChange={(e) => setForm({ ...form, proxy_ip: e.target.value })}
                placeholder="e.g. 192.168.0.50"
                fullWidth
                required
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setGrpOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={creating}>
              {creating ? "Creating…" : "Create Group"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}