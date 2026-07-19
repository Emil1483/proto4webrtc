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

import { useSfu } from "@/gen/proto4webrtc_react";
import { toastSfuError } from "@/lib/toast";

export default function PointcloudPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Orbit camera. Yaw auto-spins until the user drags.
  const cam = useRef({ yaw: 0.6, pitch: 0.45, dist: 3.2, autoSpin: true });

  // Subscribes ONLY to "pointcloud"; pointcloud.latest/.hz update at
  // animation rate. Stale (out-of-order) clouds are dropped by forceInOrder.
  // pointcloud is a protected stream: not logged in => the consume is
  // rejected and onError toasts it.
  const { pointcloud, connectionState, robotOnline } = useSfu(
    { pointcloud: { forceInOrder: true } },
    { onError: toastSfuError },
  );
  const state = connectionState;
  const hz = pointcloud.hz;
  // .slice() gives a fresh, 4-byte-aligned buffer so the Float32Array view
  // over msg.data is always valid regardless of its source offset.
  const points = pointcloud.latest
    ? new Float32Array(pointcloud.latest.data.slice().buffer)
    : new Float32Array(0);
  const pointCount = robotOnline ? points.length / 3 : 0;

  // Redraw at animation rate (auto-spin moves even without new clouds).
  const pointsRef = useRef(points);
  pointsRef.current = robotOnline ? points : new Float32Array(0);
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - prev) / 1000;
      prev = now;

      const c = cam.current;
      if (c.autoSpin) c.yaw += 0.25 * dt;
      draw(canvasRef.current, pointsRef.current, c.yaw, c.pitch, c.dist);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
