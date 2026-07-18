# Example

End-to-end demo: a simulated underwater robot streaming to a Next.js GUI
over proto4webrtc, with **two producer processes** behind one SFU. Both run
in the same ROS2 container — the split is per process, not per machine.

## Layout

- [`proto/`](proto) — the stream declarations, split by owning process:
  - `rov/streams` + `rov/rpc` — telemetry, camera, pointcloud, RovControl
    rpc; owned by `webrtc_streamer_pkg`
  - `rov_config` — mission_status heartbeat + Configurator rpc; owned by
    `webrtc_configurator_pkg` (top-level package on purpose — both
    packages' generated code shares one `sys.path`, and two regular Python
    packages both named `rov` would shadow each other)
- [`robot/ros2_ws`](robot) — the ROS2 workspace with both producers:
  - `webrtc_streamer_pkg` — bridges topics to the SFU; its `setup.py`
    generates with `include=['rov/streams/*.proto', 'rov/rpc/*.proto']`
  - `webrtc_configurator_pkg` — mission_status + Configurator rpc; generates
    with `include=['rov_config/*.proto']` and
    `gen_package='rov_config_gen'` (its own wrapper-package name, same
    shadowing reason)
- [`server/`](server) — Next.js app: embeds the SFU (`/api/sfu`) and the GUI
- [`deploy/`](deploy) — server deployment notes

Each process generates from its own proto subset, so no label is produced
twice — see "Multiple robot producers" in the repo root README.

## Run

```sh
# Server (SFU + GUI) on the dev machine
cd server && npm install && npm run dev

# Robot container (both producer nodes), signaling to localhost:3000
cd robot/ros2_ws && docker compose up --build
# or inside the workspace: ros2 launch robot_bringup webrtc.launch.py
```

## GUI

The homescreen lists every stream label and rpc service, grouped by owning
process, each with a live online/offline chip (per-label producer presence —
kill one node and only its group goes down). Clicking a card opens its page:

- `/telemetry` — thruster bars, 100 Hz data stream
- `/camera` — VP8 video
- `/pointcloud` — 3D cloud viewer, selective subscribe
- `/control` — RovControl rpc (Ping, SetLight) → streamer node
- `/mission` — the configurator's 1 Hz heartbeat stream
- `/configurator` — Configurator rpc (GetMission/UpdateMission); updates
  show up on `/mission` within a second
