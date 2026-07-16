# Deploy (mediasoup)

## What runs
- **gui** — the Next.js server with **mediasoup embedded**. mediasoup is a
  library; its native `mediasoup-worker` runs as a subprocess inside this
  container. No separate mediasoup container.
- **coturn** (optional) — only if mediasoup's ICE-TCP fallback isn't enough on
  some client networks.

## Ports / firewall
Open in **ufw AND the Linode Cloud Firewall**:
- **TCP 3000** — app + signaling (or front with Caddy on 443).
- **UDP + TCP 40000–40100** — mediasoup RTC media/data (`MEDIASOUP_RTC_*`).
- If coturn: UDP+TCP **3478**, UDP **49160–49200**.

## Run
```bash
cp .env.example .env      # set TAG
docker compose up -d
docker compose logs -f gui   # expect "[sfu] router ready"
```

## Docker image caveat (important)
mediasoup ships a **prebuilt native worker** for **glibc** Linux (x64/arm64).
The server image must use a **glibc** Node base (`node:22-bookworm-slim`, not
`node:22-alpine`). On Alpine (musl) there's no prebuilt worker and `npm install`
must **build** it — add build deps: `python3 make g++ linux-headers`.

Recommended: build on a glibc base so `npm install mediasoup` just downloads the
prebuilt worker.

## Why host networking
mediasoup's RTC ports must be reachable and its ICE candidates must carry the
real public IP. Host networking gives clean UDP/TCP (no Docker NAT mangling) and
lets `MEDIASOUP_ANNOUNCED_IP` be advertised correctly. Same reasoning as the
previous werift deployment.

## coturn: still needed?
Usually no. mediasoup enables **ICE-TCP** on its announced port, which already
traverses most UDP-hostile networks (5G CGNAT, guest wifi) without a relay. Keep
coturn only if real clients still fail; then uncomment it in `compose.yml` and
set `TURN_*` env so clients receive relay candidates via `/api/ice-config`.

## Clients
Both clients speak mediasoup over `/api/sfu` (the old werift `/api/signaling`
route is gone):
- **Browser** — `mediasoup-client` (`Device.load`, recv transport, consumes
  only the producers each screen needs).
- **Robot** — `pymediasoup` + aiortc producer (`webrtc_streamer_node`); use
  `webrtc_prod.launch.py` to point it at this deployment.
