import React from 'react';
import { Tabs, Tab, Box } from '@mui/material';
import Servers from './Servers';
import Settings from './Settings';
import Groups from "./Groups";         // NEW


export default function App() {
  const [tab, setTab] = React.useState(0);
  return (
    <Box sx={{ p: 2 }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Servers" />
        <Tab label="Credentials" />
        <Tab label="Groups" />
      </Tabs>
      {tab === 0 && <Servers />}
      {tab === 1 && <Settings />}
    </Box>
  );
}