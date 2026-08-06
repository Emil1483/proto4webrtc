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
 * onConnectError handler for useSfu(). Fires on every failed connect attempt
 * — once a second while the SFU is down (a dev server restart, say) — so only
 * the first one is toasted; the reconnecting chip carries the rest.
 */
export function toastConnectError(err: Error, attempt: number) {
  if (attempt > 1) return;
  enqueueSnackbar(`SFU unreachable: ${err.message}`, { variant: "error" });
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
