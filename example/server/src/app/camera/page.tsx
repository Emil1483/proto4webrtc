"use client";

// Camera viewer (moved from the old homescreen). Consumes ONLY the "camera"
// media stream — VP8 over RTP into a <video> element via the typed client.

import { useEffect, useRef } from "react";
import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useSfu } from "@/gen/proto4webrtc_react";

export default function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { client, connectionState, onlineLabels } = useSfu({});
  const online = onlineLabels.has("camera");

  useEffect(() => {
    if (!client) return;
    // Covers the robot whether it connected before or after this page.
    const unsubMedia = client.subscribeToCameraStream((track) => {
      if (videoRef.current) {
        videoRef.current.srcObject = new MediaStream([track]);
      }
    });
    const unsubClosed = client.onProducerClosed((label) => {
      if (label === "camera" && videoRef.current)
        videoRef.current.srcObject = null;
    });
    return () => {
      unsubMedia();
      unsubClosed();
    };
  }, [client]);

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">camera</Typography>
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

        <Paper variant="outlined" sx={{ p: 1, bgcolor: "black", position: "relative" }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              borderRadius: 4,
              display: "block",
              opacity: online ? 1 : 0.3,
            }}
          />
          {!online && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Chip label="Camera offline" color="error" />
            </Box>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
