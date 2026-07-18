"use client";

// Configurator rpc console — served by webrtc_configurator_node, NOT the
// streamer node. GetMission on load, UpdateMission from the form; a
// successful update shows up on the /mission heartbeat within a second.

import { useEffect, useState } from "react";
import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { useSfu } from "@/gen/proto4webrtc_react";
import type { Mission } from "@/gen/rov_config/mission_pb";

export default function ConfiguratorPage() {
  const { client, connectionState, onlineLabels } = useSfu({});
  const online = onlineLabels.has("configurator/responses");

  const [mission, setMission] = useState<Mission | null>(null);
  const [name, setName] = useState("");
  const [depths, setDepths] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the current mission once the service is reachable.
  useEffect(() => {
    if (!client || !online) return;
    client.rpc
      .getMission({})
      .then((m) => {
        setMission(m);
        setName(m.name);
        setDepths(m.depths.join(", "));
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, [client, online]);

  const update = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const parsed = depths
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      if (parsed.some(Number.isNaN)) throw new Error("depths must be numbers");
      const m = await client.rpc.updateMission({ name, depths: parsed });
      setMission(m);
      setError(null);
    } catch (err) {
      // Includes errors raised by the Python handler (travel back as rpc errors).
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">configurator</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button component={NextLink} href="/" size="small">
              Home
            </Button>
            <Chip
              label={online ? "online" : "offline"}
              color={online ? "success" : "error"}
              size="small"
            />
            <Chip label={`WebRTC: ${connectionState}`} size="small" />
          </Stack>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Mission</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {error && <Chip label={error} color="error" size="small" />}
              {mission && (
                <Chip label={`rev ${mission.revision}`} size="small" />
              )}
            </Stack>
          </Box>
          <Stack spacing={2}>
            <TextField
              label="Name"
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Waypoint depths (m, comma-separated)"
              size="small"
              value={depths}
              onChange={(e) => setDepths(e.target.value)}
            />
            <Box>
              <Button
                variant="contained"
                onClick={() => void update()}
                disabled={!online || busy}
              >
                Update mission
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Watch the change land on the{" "}
              <NextLink href="/mission">mission_status</NextLink> heartbeat.
              Try an empty name: the Python handler raises, and the error
              travels back as an rpc rejection.
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
