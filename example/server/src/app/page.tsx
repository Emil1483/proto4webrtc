"use client";

// Homescreen: one card per stream label and rpc service, grouped by the
// robot process that owns it. Liveness is per label (StreamState.online /
// onlineLabels), so the four producer processes show up independently — kill
// one node on the robot and only its group goes red. Subscribes to NOTHING:
// presence comes from the SFU's producer registry, no stream data reaches
// this page.

import NextLink from "next/link";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useSfu } from "@/gen/proto4webrtc_react";
import AuthControl from "@/components/AuthControl";

interface Entry {
  label: string; // stream label or rpc service channel base
  kind: "data" | "media" | "rpc";
  href: string;
  description: string;
}

// One group per robot process. The first three are nodes in one ament package
// (webrtc_streamer_pkg) sharing one generated bundle, each owning its labels via
// Proto4WebrtcProducer(streams=[...]) -- a runtime split, not a codegen one. The
// configurator is its own package with its own bundle (different protos).

// webrtc_streamer_pkg/telemetry_node.
const TELEMETRY_PROCESS: Entry[] = [
  { label: "telemetry", kind: "data", href: "/telemetry", description: "Thruster values, 100 Hz, unreliable" },
  { label: "pointcloud", kind: "data", href: "/pointcloud", description: "Packed float32 clouds, newest wins" },
];

// webrtc_streamer_pkg/camera_node.
const CAMERA_PROCESS: Entry[] = [
  { label: "camera", kind: "media", href: "/camera", description: "VP8 video over RTP" },
];

// webrtc_streamer_pkg/rpc_node -- rpc only, produces no stream.
const RPC_PROCESS: Entry[] = [
  { label: "rov_control", kind: "rpc", href: "/control", description: "RovControl: Ping, SetLight" },
  { label: "greeter", kind: "rpc", href: "/greeter", description: "Greeter: Greet, relayed to the ROS2 service /greet" },
];

// webrtc_configurator_pkg/webrtc_configurator_node.
const CONFIG_PROCESS: Entry[] = [
  { label: "mission_status", kind: "data", href: "/mission", description: "1 Hz heartbeat with the current mission" },
  { label: "configurator", kind: "rpc", href: "/configurator", description: "Configurator: GetMission, UpdateMission" },
];

function EntryCard({ entry, online }: { entry: Entry; online: boolean }) {
  return (
    <Card variant="outlined" sx={{ opacity: online ? 1 : 0.6 }}>
      <CardActionArea component={NextLink} href={entry.href}>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
            <Typography sx={{ fontFamily: "monospace" }}>{entry.label}</Typography>
            <Stack direction="row" spacing={1}>
              <Chip label={entry.kind} size="small" variant="outlined" />
              <Chip
                label={online ? "online" : "offline"}
                size="small"
                color={online ? "success" : "error"}
              />
            </Stack>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {entry.description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function Home() {
  // Empty options: nothing is subscribed, but per-label `online` and
  // `onlineLabels` still track the SFU's producer registry.
  const { telemetry, pointcloud, mission_status, connectionState, onlineLabels } =
    useSfu({});

  const streamOnline: Record<string, boolean> = {
    telemetry: telemetry.online,
    pointcloud: pointcloud.online,
    mission_status: mission_status.online,
    // Media labels ride in the producer's appData.
    camera: onlineLabels.has("camera"),
  };
  const isOnline = (e: Entry) =>
    e.kind === "rpc"
      ? // A service is being served while its responses channel is produced.
        onlineLabels.has(`${e.label}/responses`)
      : (streamOnline[e.label] ?? false);

  const groupUp = (entries: Entry[]) => entries.some(isOnline);

  const stateColor =
    connectionState === "connected"
      ? "success"
      : connectionState === "failed" || connectionState === "disconnected"
        ? "error"
        : "warning";

  const groups: { title: string; entries: Entry[] }[] = [
    { title: "telemetry_node (webrtc_streamer_pkg)", entries: TELEMETRY_PROCESS },
    { title: "camera_node (webrtc_streamer_pkg)", entries: CAMERA_PROCESS },
    { title: "rpc_node (webrtc_streamer_pkg)", entries: RPC_PROCESS },
    { title: "configurator_node (webrtc_configurator_pkg)", entries: CONFIG_PROCESS },
  ];

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">Robot</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Chip label={`WebRTC: ${connectionState}`} color={stateColor} size="small" />
            <AuthControl />
          </Box>
        </Box>

        {groups.map((group) => (
          <Box key={group.title}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <Typography variant="h6">{group.title}</Typography>
              <Chip
                label={groupUp(group.entries) ? "up" : "down"}
                size="small"
                color={groupUp(group.entries) ? "success" : "error"}
                variant="outlined"
              />
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              {group.entries.map((e) => (
                <EntryCard key={e.label} entry={e} online={isOnline(e)} />
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    </Container>
  );
}
