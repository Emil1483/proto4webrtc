"use client";

// Pointcloud viewer. Consumes ONLY the robot's "pointcloud" data producer —
// no video, no telemetry — demonstrating selective subscribe: the server never
// sends this page the streams it doesn't ask for.
//
// Wire format: rov.streams.PointCloud (see proto4webrtc.ts), points packed as
// float32 x,y,z per point. Rendered on a 2D canvas with a small hand-rolled
// orbit camera (drag to rotate, wheel to zoom) — no 3D library.

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
  type PointCloud,
  type StreamsClient,
} from "@/gen/proto4webrtc";

export default function PointcloudPage() {
  const [state, setState] = useState<string>("new");
  const [hz, setHz] = useState(0);
  const [pointCount, setPointCount] = useState(0);
  const [robotOnline, setRobotOnline] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const points = useRef<Float32Array>(new Float32Array(0));
  const msgTimes = useRef<number[]>([]);
  // Orbit camera. Yaw auto-spins until the user drags.
  const cam = useRef({ yaw: 0.6, pitch: 0.45, dist: 3.2, autoSpin: true });

  useEffect(() => {
    let cancelled = false;
    let client: StreamsClient | null = null;

    // Stale (out-of-order) clouds are dropped by subscribeToPointCloudStream.
    const handleCloud = (msg: PointCloud) => {
      setRobotOnline(true);
      msgTimes.current.push(performance.now());
      // .slice() gives a fresh, 4-byte-aligned buffer so the Float32Array
      // view over msg.data is always valid regardless of its source offset.
      points.current = new Float32Array(msg.data.slice().buffer);
    };

    (async () => {
      client = await connectToSfu({ onConnectionState: setState });
      if (cancelled) {
        client.close();
        return;
      }

      // Covers the robot whether it connected before or after this page.
      client.subscribeToPointCloudStream(handleCloud);
      client.onProducerClosed(() => {
        setRobotOnline(false);
        points.current = new Float32Array(0);
      });
    })().catch((err) => console.error("[sfu] setup failed:", err));

    // Render at animation rate, decoupled from the cloud arrival rate.
    let raf = 0;
    let prev = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - prev) / 1000;
      prev = now;

      const c = cam.current;
      if (c.autoSpin) c.yaw += 0.25 * dt;
      draw(canvasRef.current, points.current, c.yaw, c.pitch, c.dist);

      setPointCount(points.current.length / 3);
      msgTimes.current = msgTimes.current.filter((t) => now - t < 1000);
      setHz(msgTimes.current.length);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      client?.close();
    };
  }, []);

  // Drag to orbit, wheel to zoom.
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    cam.current.autoSpin = false;
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    cam.current.yaw += (e.clientX - last.current.x) * 0.01;
    cam.current.pitch = Math.max(
      -1.4,
      Math.min(1.4, cam.current.pitch + (e.clientY - last.current.y) * 0.01),
    );
    last.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onWheel = (e: React.WheelEvent) => {
    cam.current.dist = Math.max(
      1.2,
      Math.min(10, cam.current.dist * Math.exp(e.deltaY * 0.001)),
    );
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
          <Typography variant="h4">Pointcloud</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button component={NextLink} href="/" size="small">
              Telemetry
            </Button>
            <Chip label={`WebRTC: ${state}`} color={color} size="small" />
          </Stack>
        </Box>

        <Paper
          variant="outlined"
          sx={{ p: 1, bgcolor: "black", position: "relative" }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            style={{
              width: "100%",
              height: 520,
              display: "block",
              borderRadius: 4,
              cursor: "grab",
              touchAction: "none",
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
                pointerEvents: "none",
              }}
            >
              <Chip label="Robot offline" color="error" />
            </Box>
          )}
          <Stack
            direction="row"
            spacing={1}
            sx={{ position: "absolute", top: 16, left: 16 }}
          >
            <Chip label={`${pointCount} pts`} size="small" />
            <Chip
              label={`${hz} Hz`}
              size="small"
              color={hz > 5 ? "success" : "default"}
            />
          </Stack>
        </Paper>

        <Typography variant="caption" color="text.secondary">
          Drag to orbit, scroll to zoom. This page consumes only the robot&apos;s
          &quot;pointcloud&quot; data producer — the server never sends it video
          or telemetry.
        </Typography>
      </Stack>
    </Container>
  );
}

// Perspective-project the cloud onto the canvas. Points are colored by height
// (z): deep blue low, warm orange high.
function draw(
  canvas: HTMLCanvasElement | null,
  pts: Float32Array,
  yaw: number,
  pitch: number,
  dist: number,
) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.offsetWidth * dpr);
  const h = Math.round(canvas.offsetHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = 0.9 * Math.min(w, h); // focal length in pixels

  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    // Yaw about the z (up) axis, then pitch about the x axis.
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    const y2 = y1 * cp - z * sp;
    const z2 = y1 * sp + z * cp;
    const depth = dist + y2;
    if (depth < 0.2) continue; // behind the camera
    const sx = w / 2 + (x1 * f) / depth;
    const sYc = h / 2 - (z2 * f) / depth;
    if (sx < 0 || sx >= w || sYc < 0 || sYc >= h) continue;

    // Height → hue: -0.6 (deep, blue 220°) .. 0.6 (high, orange 30°).
    const hNorm = Math.max(0, Math.min(1, (z + 0.6) / 1.2));
    const size = Math.max(1, (2.6 * dpr) / depth);
    ctx.fillStyle = `hsl(${220 - 190 * hNorm} 90% ${45 + 25 * hNorm}%)`;
    ctx.fillRect(sx, sYc, size, size);
  }
}
