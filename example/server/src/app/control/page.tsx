"use client";

// RovControl rpc console (moved from the old homescreen). Calls travel
// browser -> robot over WebRTC data channels; the typed client.rpc.* methods
// are generated from the RovControl service. Served by the streamer node.

import { useState } from "react";
import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useSfu } from "@/gen/proto4webrtc_react";
import { toastError, toastSfuError } from "@/lib/toast";

export default function ControlPage() {
  const [light, setLight] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const { client, connectionState, onlineLabels } = useSfu(
    {},
    { onError: toastSfuError },
  );
  // The service is being served while the robot produces its responses channel.
  const online = onlineLabels.has("rov_control/responses");

  // SetLight is admin-only: a guest caller is rejected by the robot and the
  // rejection travels back as a thrown rpc error — toasted here.
  const sendLight = async (intensity: number) => {
    try {
      const res = await client?.rpc.setLight({ intensity });
      if (res) setLight(res.intensity);
    } catch (err) {
      toastError(err);
    }
  };
  const sendPing = async () => {
    try {
      const start = performance.now();
      await client?.rpc.ping({ stamp: Date.now() / 1000 });
      setPingMs(performance.now() - start);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">rov_control</Typography>
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
            <Typography variant="h6">Control (rpc)</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {pingMs !== null && (
                <Chip label={`rtt ${pingMs.toFixed(1)} ms`} size="small" />
              )}
              <Button size="small" variant="outlined" onClick={sendPing}>
                Ping
              </Button>
            </Stack>
          </Box>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
              Light {Math.round(light * 100)}%
            </Typography>
            <Slider
              value={light}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, v) => setLight(v as number)}
              onChangeCommitted={(_, v) => void sendLight(v as number)}
            />
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
