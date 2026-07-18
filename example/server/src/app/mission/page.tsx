"use client";

// mission_status viewer — the configurator process's 1 Hz heartbeat.
// Because it comes from a different process than telemetry/camera, this page
// stays live when the streamer node is down (and vice versa).

import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useSfu } from "@/gen/proto4webrtc_react";

function Row({ name, value }: { name: string; value: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
      <Typography variant="body2" color="text.secondary">
        {name}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function MissionPage() {
  const { mission_status, connectionState } = useSfu({
    mission_status: { forceInOrder: true },
  });
  const msg = mission_status.latest;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">mission_status</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button component={NextLink} href="/" size="small">
              Home
            </Button>
            <Chip
              label={mission_status.online ? "online" : "offline"}
              color={mission_status.online ? "success" : "error"}
              size="small"
            />
            <Chip label={`WebRTC: ${connectionState}`} size="small" />
          </Stack>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Heartbeat</Typography>
            <Chip
              label={`${mission_status.hz} Hz`}
              size="small"
              color={mission_status.hz > 0 ? "success" : "default"}
            />
          </Box>
          {msg ? (
            <Stack spacing={1}>
              <Row name="mission" value={msg.mission?.name ?? "-"} />
              <Row name="revision" value={String(msg.mission?.revision ?? 0)} />
              <Row
                name="depths (m)"
                value={
                  msg.mission?.depths.length
                    ? msg.mission.depths.map((d) => d.toFixed(1)).join(", ")
                    : "-"
                }
              />
              <Row name="uptime" value={`${msg.uptime.toFixed(0)} s`} />
              <Row
                name="latency"
                value={`${(Date.now() / 1000 - msg.stamp).toFixed(2)} s`}
              />
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Waiting for the first heartbeat…
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
            Edit the mission on the <NextLink href="/configurator">configurator</NextLink> page —
            the revision here bumps within a second.
          </Typography>
        </Paper>
      </Stack>
    </Container>
  );
}
