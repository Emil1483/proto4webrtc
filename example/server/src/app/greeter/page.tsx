"use client";

// Greeter rpc console. The interesting part is where the call is answered: the
// streamer node produces the "greeter" channels, but its handler only forwards
// the call to the ROS2 service /greet, which publisher_pkg's
// greet_service_node serves. Both ends of that hop are generated from the same
// proto/rov/rpc/greeter.proto -- the WebRTC rpc by proto4webrtc_codegen, the
// ROS2 service (my_interfaces/srv/Greet) by proto4webrtc_codegen.ros2.
//
// So a failure has two distinct shapes, both visible here: the "greeter" label
// offline means the streamer is down, while an rpc error saying /greet is not
// available means the streamer is up but the service node isn't.

import { useState } from "react";
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
import { toastError, toastSfuError } from "@/lib/toast";

export default function GreeterPage() {
  const [name, setName] = useState("browser");
  const [greeting, setGreeting] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const { client, connectionState, onlineLabels } = useSfu(
    {},
    { onError: toastSfuError },
  );
  // The service is being served while the robot produces its responses channel.
  const online = onlineLabels.has("greeter/responses");

  const sendGreet = async () => {
    try {
      const res = await client?.rpc.greet({ name });
      if (res) {
        setGreeting(res.message);
        setCount(res.count);
      }
    } catch (err) {
      // Includes the relay's own failures: /greet unavailable, or no answer
      // within the streamer's 5 s timeout.
      toastError(err);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h4">greeter</Typography>
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
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Greet (rpc, relayed to a ROS2 service)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            browser → streamer node → ROS2 service <code>/greet</code> →
            greet_service_node
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              label="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button variant="outlined" onClick={() => void sendGreet()}>
              Greet
            </Button>
            {count !== null && (
              <Chip label={`served ${count}`} size="small" />
            )}
          </Stack>
          {greeting && (
            <Typography sx={{ mt: 2, fontFamily: "monospace" }}>{greeting}</Typography>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
