# Example

End-to-end demo: a simulated underwater robot streaming to a Next.js GUI
over proto4webrtc, with **two producer processes** behind one SFU. Both run
in the same ROS2 container — the split is per process, not per machine.

## Layout

- [`proto/`](proto) — the declarations, split by owning process:
  - `rov/streams` + `rov/rpc` — telemetry, camera, pointcloud, RovControl and
    Greeter rpc; owned by `webrtc_streamer_pkg`
  - `rov_config` — mission_status heartbeat + Configurator rpc; owned by
    `webrtc_configurator_pkg` (top-level package on purpose — both
    packages' generated code shares one `sys.path`, and two regular Python
    packages both named `rov` would shadow each other)
  - `rov/topics` — `Greeting`, a ROS2-only message with no proto4webrtc
    annotation at all: nothing produces it over WebRTC, it just becomes
    `my_interfaces/msg/Greeting`
- [`robot/`](robot) — the ROS2 workspace with both producers:
  - `my_interfaces` — every `.msg`/`.srv` in the workspace, generated from
    `proto/` by `proto4webrtc_codegen.ros2` at CMake configure time (so
    `colcon build` regenerates; `msg/` and `srv/` are gitignored)
  - `webrtc_streamer_pkg` — bridges topics to the SFU; its `setup.py`
    generates with `include=['rov/streams/*.proto', 'rov/rpc/*.proto']`
  - `publisher_pkg` — `greeter_node` publishes `/greetings`;
    `greet_service_node` serves the ROS2 service `/greet` that the streamer
    relays browser Greeter rpcs to
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
# One env file for the whole example (server + robot secrets).
cp .env.example .env   # then fill in AUTH_PASSWORD, ROBOT_TOKEN

# Server (SFU + GUI) on the dev machine
cd server && npm install && npm run dev

# Robot container (both producer nodes), signaling to localhost:3000
cd robot && docker compose up --build
# or inside the workspace: ros2 launch robot_bringup all_nodes.launch.py
# (webrtc.launch.py starts only the two producers — no sensors, and no
#  greet_service_node, so /greeter's Greet rejects with "/greet is not
#  available")
```

`example/.env` is auto-sourced inside the devcontainer (every terminal, so
`npm run dev` and the ROS nodes inherit it); the robot's docker compose reads
it via `env_file`. The example **enforces auth** — the server rejects every
signaling connection until `AUTH_PASSWORD` and `ROBOT_TOKEN` are set (it fails
loud rather than silently allowing everyone). See
[Authentication](#authentication).

## GUI

The homescreen lists every stream label and rpc service, grouped by owning
process, each with a live online/offline chip (per-label producer presence —
kill one node and only its group goes down). Clicking a card opens its page:

- `/telemetry` — thruster bars, 100 Hz data stream
- `/camera` — VP8 video
- `/pointcloud` — 3D cloud viewer, selective subscribe
- `/control` — RovControl rpc (Ping, SetLight) → streamer node
- `/greeter` — Greeter rpc (Greet), relayed by the streamer node to the ROS2
  service `/greet` → `greet_service_node`
- `/mission` — the configurator's 1 Hz heartbeat stream
- `/configurator` — Configurator rpc (GetMission/UpdateMission); updates
  show up on `/mission` within a second

## ROS2 interfaces from the same protos

`my_interfaces` holds no hand-written interface files. Its `CMakeLists.txt`
runs `python -m proto4webrtc_codegen.ros2 --proto ../../../proto --out .` at
CMake **configure** time, so every `colcon build` regenerates `msg/` and `srv/`
from `proto/`, and `CMAKE_CONFIGURE_DEPENDS` on the protos makes a proto edit
trigger the reconfigure. Both are gitignored; committing them would just be a
second copy of the contract.

So one proto edit reaches three places: `my_interfaces` (ROS2 types), the
producer packages' `proto4webrtc_gen` (WebRTC), and the GUI's `src/gen`. That is
why `thruster_node` publishes a `stamp` field instead of a `std_msgs/Header` —
`my_interfaces/msg/Thrusters` is generated from `rov/streams/thrusters.proto`,
so the ROS message and the protobuf message are field-for-field identical and
`webrtc_streamer_node.on_thrusters` is a plain copy.

**The relayed rpc.** `/greeter` in the GUI shows an rpc served by a node that
knows nothing about WebRTC:

```
browser  --Greeter.Greet (WebRTC data channel)-->  webrtc_streamer_node
                                                        |
                              my_interfaces/srv/Greet    | ROS2 service /greet
                                                        v
                                                  greet_service_node
```

Both hops come from the same `proto/rov/rpc/greeter.proto`: the WebRTC rpc from
`proto4webrtc_codegen`, `my_interfaces/srv/Greet` from
`proto4webrtc_codegen.ros2`. The streamer's handler (`Greeter` in
`webrtc_streamer_node.py`) only forwards, and raises when the service is
unavailable or slow — the browser sees that as an rpc error. Kill
`greet_service_node` and `/greeter` stays *online* (the streamer still produces
the channel) but every Greet rejects; kill the streamer and the label itself
goes offline.

## Authentication

Shows how a host app plugs auth into proto4webrtc: **the SFU never verifies
tokens — it enforces a `Role` this app resolves** (`server/src/lib/
proto4webrtc/auth.ts`, wired into `/api/sfu`). The library itself runs without
auth; this example opts in and, unlike the library, **fails loud** when its
auth env vars are missing.

Two kinds of peer, told apart on the WS upgrade (the browser `WebSocket` API
can't set headers, so they differ):

- **robot** → `Authorization: Bearer $ROBOT_TOKEN` header → `Role.ROBOT`
  (may produce streams). The ROS nodes read the token from `ROBOT_TOKEN`; the
  Python runtime sends it as the header.
- **browser** → a shared-password login (`Login` button on the homepage) sets
  an HttpOnly session cookie, sent automatically on the handshake. Logged in →
  `Role.ADMIN` (sees the protected `camera` + `pointcloud` streams and may call
  protected rpc methods); not logged in → `Role.GUEST` (denied them — the
  server returns a "permission denied" error; nothing is gated client-side).

Env vars (single `example/.env`): `AUTH_PASSWORD` (login), `ROBOT_TOKEN`
(shared robot secret, read by both server and robot), `AUTH_SECRET` (optional
cookie-signing key, derived from the password if unset). Issuing the
cookie/token — the login page and shared secret here — is the application's
job; swap in your own IdP or session store by editing `auth.ts`.
