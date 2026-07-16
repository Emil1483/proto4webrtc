"use client";

import { useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import {
  connectToSfu,
  consumeData,
  consumeVideo,
  type ProducerList,
  type SfuConnection,
} from "@/lib/sfuClient";
import { CameraStream, ThrustersStream, type Thrusters } from "@/gen/proto4webrtc";

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
  const videoRef = useRef<HTMLVideoElement>(null);

  const latestValues = useRef<number[]>([0, 0, 0, 0]);
  const lastT = useRef<number>(-Infinity);
  const msgTimes = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    let conn: SfuConnection | null = null;

    const handleTelemetry = (msg: Thrusters) => {
      msgTimes.current.push(performance.now());
      if (msg.stamp > lastT.current) {
        lastT.current = msg.stamp;
        latestValues.current = [msg.value0, msg.value1, msg.value2, msg.value3];
      }
    };

    const onVideo = async (producerId: string) => {
      const consumer = await consumeVideo(conn!, producerId);
      if (videoRef.current) {
        videoRef.current.srcObject = new MediaStream([consumer.track]);
      }
      setRobotOnline(true);
    };

    const onTelemetry = async (dataProducerId: string) => {
      const dc = await consumeData(conn!, dataProducerId);
      ThrustersStream.attach(dc, handleTelemetry);
    };

    (async () => {
      conn = await connectToSfu(setState);
      if (cancelled) return;

      // Server pushes availability events; consume what this screen needs.
      conn.signaling.onEvent = (msg) => {
        if (msg.event === "newProducer" && msg.kind === CameraStream.kind) {
          void onVideo(msg.producerId as string);
        } else if (msg.event === "newDataProducer") {
          if (msg.label === ThrustersStream.label) void onTelemetry(msg.dataProducerId as string);
        } else if (msg.event === "producerClosed") {
          setRobotOnline(false);
          lastT.current = -Infinity;
          if (videoRef.current) videoRef.current.srcObject = null;
        }
      };

      // Consume anything already being produced (robot connected first).
      const existing = await conn.signaling.request<ProducerList>("getProducers");
      for (const pr of existing.producers) {
        if (pr.kind === CameraStream.kind) await onVideo(pr.producerId);
      }
      for (const dp of existing.dataProducers) {
        if (dp.label === ThrustersStream.label) await onTelemetry(dp.dataProducerId);
      }
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
      conn?.recvTransport.close();
      conn?.signaling.close();
    };
  }, []);

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
      </Stack>
    </Container>
  );
}
