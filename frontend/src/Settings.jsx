import React, { useEffect, useState } from "react";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, Typography, CircularProgress, Alert, Stack
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api } from "./api";

export default function Settings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [launching, setLaunching] = useState(false);
  

  const [form, setForm] = useState({
    credential_name: "", api_user: "", api_token: "", api_url: "", api_token_id: ""
  });

  useEffect(() => {
    api.listCreds().then(setRows).finally(() => setLoading(false));
  }, []);

  const submit = async (e) => {
    e.preventDefault(); setErr("");
    setLaunching(true);
    try {
      const created = await api.addCred(form);
      setRows(s => [created, ...s]);
      setOpen(false);
      setForm({ credential_name: "", api_user: "", api_token: "", api_url: "", api_token_id: "" });
    } catch (er) {
      setErr(er.message || "Failed");
    }

    try {
      const created = await api.addcredsem(form);
      setRows(s => [created, ...s]);
      setOpen(false);
      setForm({ credential_name: "", api_user: "", api_token: "", api_url: "", api_token_id: "" });
    } catch (er) {
      setErr(er.message || "Failed");
    }
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Credentials</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add Credential</Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>API User</TableCell>
              <TableCell>API URL</TableCell><TableCell>Token ID</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} align="center"><CircularProgress /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center">No credentials.</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id}>
                <TableCell>{r.credential_name}</TableCell>
                <TableCell>{r.api_user}</TableCell>
                <TableCell>{r.api_url}</TableCell>
                <TableCell>{r.api_token_id}</TableCell>
                <TableCell>{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Proxmox Credential</DialogTitle>
        <form onSubmit={submit}>
          <DialogContent>
            <Stack spacing={2}>
              {err && <Alert severity="error">{err}</Alert>}
              <TextField label="Credential Name" value={form.credential_name} onChange={e => setForm({ ...form, credential_name: e.target.value })} required fullWidth />
              <TextField label="API User" value={form.api_user} onChange={e => setForm({ ...form, api_user: e.target.value })} required fullWidth />
              <TextField label="API URL" value={form.api_url} onChange={e => setForm({ ...form, api_url: e.target.value })} required fullWidth />
              <TextField label="API Token ID" value={form.api_token_id} onChange={e => setForm({ ...form, api_token_id: e.target.value })} required fullWidth />
              <TextField label="API Token" value={form.api_token} onChange={e => setForm({ ...form, api_token: e.target.value })} required fullWidth />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Add</Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
