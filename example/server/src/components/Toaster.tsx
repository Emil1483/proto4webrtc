"use client";

// Client boundary for notistack's SnackbarProvider — it uses React context,
// so it can't be rendered directly from the server-side root layout. Every
// app error surfaces through here as a toast (see enqueueSnackbar calls in the
// pages and the client onError hook).

import { SnackbarProvider } from "notistack";

export default function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <SnackbarProvider
      maxSnack={3}
      preventDuplicate
      autoHideDuration={6000}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      {children}
    </SnackbarProvider>
  );
}
