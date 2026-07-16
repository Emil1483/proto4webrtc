"use client";

import { useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import {
  connectToSfu,
  type StreamsClient,
  type Thrusters,
} from "@/gen/proto4webrtc";

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

export default function Home() {
  const [state, setState] = useState<string>("new");
  const [values, setValues] = useState<number[]>([0, 0, 0, 0]);
  const [hz, setHz] = useState(0);
  const [robotOnline, setRobotOnline] = useState(false);
  const [light, setLight] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<StreamsClient | null>(null);

  const latestValues = useRef<number[]>([0, 0, 0, 0]);
  const msgTimes = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    let client: StreamsClient | null = null;

    // Stale (out-of-order) messages are dropped by subscribeToThrustersStream.
    const handleTelemetry = (msg: Thrusters) => {
      msgTimes.current.push(performance.now());
      latestValues.current = [msg.value0, msg.value1, msg.value2, msg.value3];
    };

    (async () => {
      client = await connectToSfu({ onConnectionState: setState });
      if (cancelled) {
        client.close();
        return;
      }
      clientRef.current = client;

      // Covers the robot whether it connected before or after this page.
      client.subscribeToCameraStream((track) => {
        if (videoRef.current) {
          videoRef.current.srcObject = new MediaStream([track]);
        }
        setRobotOnline(true);
      });
      client.subscribeToThrustersStream(handleTelemetry);
      client.onProducerClosed(() => {
        setRobotOnline(false);
        if (videoRef.current) videoRef.current.srcObject = null;
      });
    })().catch((err) => console.error("[sfu] setup failed:", err));

    // Render telemetry at animation rate, decoupled from the 100 Hz stream.
    let raf = 0;
    const tick = () => {
      setValues([...latestValues.current]);
      const now = performance.now();
      msgTimes.current = msgTimes.current.filter((t) => now - t < 1000);
      setHz(msgTimes.current.length);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clientRef.current = null;
      client?.close();
    };
  }, []);

  // Rpc calls travel browser -> robot over WebRTC data channels; the typed
  // client.rpc.* methods are generated from the RovControl service.
  const sendLight = async (intensity: number) => {
    try {
      const res = await clientRef.current?.rpc.setLight({ intensity });
      if (res) setLight(res.intensity);
      setRpcError(null);
    } catch (err) {
      setRpcError(err instanceof Error ? err.message : String(err));
    }
  };
  const sendPing = async () => {
    try {
      const start = performance.now();
      await clientRef.current?.rpc.ping({ stamp: Date.now() / 1000 });
      setPingMs(performance.now() - start);
      setRpcError(null);
    } catch (err) {
      setRpcError(err instanceof Error ? err.message : String(err));
    }
  };

  const color =
    state === "connected"
      ? "success"
      : state === "failed" || state === "disconnected"
        ? "error"
        : "warning";

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <Typography variant="h4">Robot Telemetry</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button component={NextLink} href="/pointcloud" size="small">
              Pointcloud
            </Button>
            <Chip label={`WebRTC: ${state}`} color={color} size="small" />
          </Stack>
        </Box>

        <Paper
          variant="outlined"
          sx={{ p: 1, bgcolor: "black", position: "relative" }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              borderRadius: 4,
              display: "block",
              opacity: robotOnline ? 1 : 0.3,
            }}
          />
          {!robotOnline && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Chip label="Robot offline" color="error" />
            </Box>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Thrusters</Typography>
            <Chip
              label={`${hz} Hz`}
              size="small"
              color={hz > 50 ? "success" : "default"}
            />
          </Box>
          <Stack spacing={1.5}>
            {values.slice(0, 4).map((v, i) => (
              <ThrusterBar key={i} index={i} value={v} />
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Control (rpc)</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {rpcError && <Chip label={rpcError} color="error" size="small" />}
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
