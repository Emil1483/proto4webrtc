"use client";

import React, { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import LockOpenIcon from "@mui/icons-material/LockOpen";

import { useAuth } from "@/contexts/AuthContext";
import { toastError } from "@/lib/toast";

export default function AuthControl() {
  const { authenticated, authConfigured, loading, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Nothing to show until /api/me resolves, or when the server has no auth
  // configured (every browser is an admin-equivalent robot then).
  if (loading || !authConfigured) return null;

  const closeDialog = () => {
    setOpen(false);
    setPassword("");
  };

  const handleLogin = async () => {
    setBusy(true);
    try {
      await login(password); // reloads on success
    } catch (e) {
      toastError(e); // e.g. wrong password
      setBusy(false);
    }
  };

  if (authenticated) {
    return (
      <Button
        color="inherit"
        startIcon={<LogoutIcon />}
        onClick={() => logout()}
        title="Log out — protected streams will be hidden"
      >
        Logout
      </Button>
    );
  }

  return (
    <>
      <Button color="inherit" startIcon={<LoginIcon />} onClick={() => setOpen(true)}>
        Login
      </Button>
      <Dialog open={open} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>
          <LockOpenIcon sx={{ verticalAlign: "middle", mr: 1 }} fontSize="small" />
          Log in
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Non-protected streams are open to everyone. Log in to view protected
            streams (camera, pointcloud) and call protected rpc methods.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) handleLogin();
            }}
            disabled={busy}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleLogin}
            variant="contained"
            disabled={busy || password === ""}
          >
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
