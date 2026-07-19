import { enqueueSnackbar } from "notistack";

/**
 * Toast an error. Every user-facing failure in this app funnels through here
 * so errors are shown with the toast library only — never inline chips or a
 * silent console.error.
 */
export function toastError(err: unknown, fallback = "Something went wrong") {
  const msg =
    err instanceof Error ? err.message : String(err ?? "") || fallback;
  enqueueSnackbar(msg || fallback, { variant: "error" });
}

/**
 * onError handler for useSfu()/connectToSfu(). Fires when a background
 * subscription is rejected — most commonly consuming a protected stream
 * (camera, pointcloud) while not logged in. Those throw asynchronously inside
 * the client, so this hook is the only place to catch them.
 */
export function toastSfuError(
  err: Error,
  info: { label?: string; kind?: string },
) {
  const what = info.label ?? info.kind ?? "stream";
  enqueueSnackbar(`${what}: ${err.message || "subscription failed"}`, {
    variant: "error",
  });
}
