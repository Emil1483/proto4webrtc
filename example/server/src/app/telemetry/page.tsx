"use client";

// Thruster telemetry viewer (moved from the old homescreen). Consumes ONLY
// the "telemetry" data stream; telemetry.latest/.hz update at animation
// rate, stale (out-of-order) messages are dropped by forceInOrder.

import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useSfu } from "@/gen/proto4webrtc_react";

const THRUSTER_COLORS = ["#42a5f5", "#66bb6a", "#ffa726", "#ef5350"];

function ThrusterBar({ index, value }: { index: number; value: number }) {
  const clamped = Math.max(-1, Math.min(1, value));
  const pct = ((clamped + 1) / 2) * 100; // 0..100, 50 = zero
  const color = THRUSTER_COLORS[index];
  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
        <Typography variant="caption">T{index}</Typography>
        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
          {value.toFixed(3)}
        </Typography>
      </Box>
      <Box
        sx={{
          position: "relative",
          height: 14,
          borderRadius: 1,
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: "1px",
            bgcolor: "divider",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            bgcolor: color,
            left: `${Math.min(50, pct)}%`,
            width: `${Math.abs(pct - 50)}%`,
          }}
        />
      </Box>
    </Box>
  );
}

export default function TelemetryPage() {
  const { telemetry, connectionState } = useSfu({
    telemetry: { forceInOrder: true },
  });
  const msg = telemetry.latest;
  const values = msg
    ? [msg.value0, msg.value1, msg.value2, msg.value3]
    : [0, 0, 0, 0];

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">telemetry</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button component={NextLink} href="/" size="small">
              Home
            </Button>
            <Chip
              label={telemetry.online ? "online" : "offline"}
              color={telemetry.online ? "success" : "error"}
              size="small"
            />
            <Chip label={`WebRTC: ${connectionState}`} size="small" />
          </Stack>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Thrusters</Typography>
            <Chip
              label={`${telemetry.hz} Hz`}
              size="small"
              color={telemetry.hz > 50 ? "success" : "default"}
            />
          </Box>
          <Stack spacing={1.5}>
            {values.slice(0, 4).map((v, i) => (
              <ThrusterBar key={i} index={i} value={v} />
            ))}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
