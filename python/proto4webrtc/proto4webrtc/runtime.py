"""Runtime shared by every generated proto4webrtc producer client.

Generated code (``proto4webrtc_gen/producers.py``) only supplies the
project-specific bits: per-stream produce kwargs / backpressure policy, and
the aggregate ``Proto4WebrtcProducer`` wiring streams to attributes. Signaling
(websocket JSON-RPC), device/transport lifecycle, the reconnect loop, and the
thread-safe send/push dispatch all live here so fixes ship via a pip upgrade
instead of a regen.
"""

from __future__ import annotations

import asyncio
import fractions
import json
import logging
import time
import traceback

import websockets
from aiortc import MediaStreamTrack
from av import VideoFrame
from pymediasoup import AiortcHandler, Device
from pymediasoup.models.transport import DtlsParameters, IceCandidate, IceParameters
from pymediasoup.rtp_parameters import RtpCapabilities
from pymediasoup.sctp_parameters import SctpParameters, SctpStreamParameters

from proto4webrtc.options_pb2 import ROLE_ADMIN, ROLE_ROBOT
from proto4webrtc.rpc_pb2 import RpcRequest, RpcResponse

try:
    import numpy as np
except ImportError:  # pragma: no cover - numpy is a hard dependency, kept soft here
    np = None

_CLOCK_RATE_BY_KIND = {"video": 90000, "audio": 48000}


def _dump(model):
    """Serialize a pymediasoup pydantic model to a JSON-ready dict (camelCase)."""
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json", by_alias=True, exclude_none=True)
    if hasattr(model, "json"):
        return json.loads(model.json(by_alias=True, exclude_none=True))
    return model


class FrameTrack(MediaStreamTrack):
    """Generic aiortc track fed by push(); drop-oldest queue of depth 1.

    Created once (in the generated client's __init__, before any connection
    exists) and reused across reconnects, so push() is always safe to call.
    """

    def __init__(self, kind: str = "video", clock_rate: int | None = None):
        super().__init__()
        self.kind = kind
        self._clock_rate = clock_rate or _CLOCK_RATE_BY_KIND.get(kind, 90000)
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        self._start: float | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def push(self, frame) -> None:
        """Accept an av.VideoFrame/AudioFrame, or a numpy ndarray (rgb24)."""
        if np is not None and isinstance(frame, np.ndarray):
            frame = VideoFrame.from_ndarray(frame, format="rgb24")

        loop = self._loop
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if loop is None or running is loop:
            self._push_now(frame)
        else:
            loop.call_soon_threadsafe(self._push_now, frame)

    def _push_now(self, frame) -> None:
        if self._queue.full():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        self._queue.put_nowait(frame)

    def stop(self) -> None:
        # aiortc's RTCRtpSender stops its track when the RTP task exits (i.e.
        # on every pc.close()), ignoring mediasoup's stopTracks=False. An
        # ended track can never be produced again -- transport.produce()
        # raises InvalidStateError("track ended") -- so a robot would come
        # back on its data streams but never on its camera. This track
        # outlives connections: refuse to be ended.
        pass

    async def recv(self):
        frame = await self._queue.get()
        if self._start is None:
            self._start = time.monotonic()
        frame.pts = int((time.monotonic() - self._start) * self._clock_rate)
        frame.time_base = fractions.Fraction(1, self._clock_rate)
        return frame


class DataProducerBase:
    """One persistent object per data stream, for the client's whole lifetime.

    Constructed before any connection exists (self._dp is None); _attach()
    opens the data channel on a fresh transport after each (re)connect,
    _detach() clears it. send() is therefore a safe no-op until connected.
    """

    LABEL: str
    # Admin-only stream: rides to the SFU in appData so it can deny guests.
    PROTECTED: bool = False

    def __init__(self, client: "Proto4WebrtcClient"):
        self._client = client
        self._dp = None

    def _produce_kwargs(self) -> dict:
        return {}

    def _check_backpressure(self, dp, payload: bytes) -> bool:
        return True

    async def _attach(self, transport) -> None:
        app_data = {"protected": True} if self.PROTECTED else {}
        self._dp = await transport.produceData(
            label=self.LABEL, appData=app_data, **self._produce_kwargs()
        )

    def _detach(self) -> None:
        self._dp = None

    def send(self, msg) -> bool | None:
        """Encode and send one message.

        Returns False if dropped, True if handed to the channel, or None when
        called from a thread other than the client's event loop (dispatched
        via call_soon_threadsafe; the real result can't be observed synchronously).
        """
        loop = self._client._loop
        if loop is None:
            return False
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            return self._send_now(msg)
        loop.call_soon_threadsafe(self._send_now, msg)
        return None

    def _send_now(self, msg) -> bool:
        dp = self._dp
        if dp is None or dp.readyState != "open":
            return False
        payload = msg.SerializeToString()
        if not self._check_backpressure(dp, payload):
            return False
        dp.send(payload)
        return True


class MediaProducerBase:
    """One persistent object per media stream, wrapping a FrameTrack."""

    LABEL: str
    KIND: str
    # Admin-only stream: rides to the SFU in appData so it can deny guests.
    PROTECTED: bool = False

    def __init__(self, client: "Proto4WebrtcClient", track: FrameTrack):
        self._client = client
        self._track = track
        self._producer = None

    async def _attach(self, transport) -> None:
        app_data = {"label": self.LABEL}
        if self.PROTECTED:
            app_data["protected"] = True
        self._producer = await transport.produce(
            track=self._track, stopTracks=False, appData=app_data
        )

    def _detach(self) -> None:
        self._producer = None

    def push(self, frame) -> None:
        self._track.push(frame)


class UnselectedStream:
    """Stands in for a stream this client was not asked to produce.

    The generated aggregate client keeps one attribute per declared stream so
    the bundle can be shared by several processes (see select_streams); the
    ones left out of ``streams=`` get this instead of a live producer, so
    touching them fails loudly rather than silently going nowhere.
    """

    def __init__(self, label: str, attr: str, class_name: str):
        self.LABEL = label
        self._attr = attr
        self._class_name = class_name

    def _fail(self):
        raise RuntimeError(
            f"stream {self.LABEL!r} is not produced by this client: pass "
            f"streams=[{self._class_name}] (or streams=[{self.LABEL!r}]) to "
            f"Proto4WebrtcProducer to let this process own it, or use the "
            f"client that does. Attribute: .{self._attr}"
        )

    def send(self, msg):
        self._fail()

    def push(self, frame):
        self._fail()


def select_streams(selectors, registry) -> set[str]:
    """Resolve a ``streams=`` selection to the set of attribute names to produce.

    registry: the generated client's ``_STREAMS`` — a sequence of
        ``(attr, label, producer_class)`` for every declared stream.
    selectors: None produces every declared stream (one process owning the
        whole bundle). Otherwise an iterable of producer classes (e.g.
        ``ThrustersProducer``) or wire labels (``"telemetry"``), so several
        processes can share one generated bundle and split the labels between
        them. An empty iterable selects nothing (e.g. an rpc-only process).
    """
    by_class = {cls: attr for attr, _, cls in registry}
    by_label = {label: attr for attr, label, _ in registry}
    if selectors is None:
        return set(by_class.values())

    selected: set[str] = set()
    for sel in selectors:
        attr = by_class.get(sel) if isinstance(sel, type) else by_label.get(sel)
        if attr is None:
            known = ", ".join(sorted(by_label))
            raise ValueError(
                f"unknown stream {sel!r} in streams=; declared labels: {known}"
            )
        selected.add(attr)
    return selected


class RpcServiceBase:
    """Base for generated RPC service classes; the robot subclasses those.

    Wire model — two data channels per service, both reliable+ordered:
      - "<LABEL>/requests":  one per connected browser, consumed here
      - "<LABEL>/responses": produced here, shared; clients filter by client_id

    Generated subclasses fill LABEL, _METHODS and one async method stub per
    rpc; the implementation overrides those stubs. Handlers run on the
    client's event loop — offload blocking work with asyncio.to_thread().
    """

    LABEL: str
    # wire method name -> (python method attr, request message class[, protected])
    # The 2-tuple form (pre-auth generated code) means not protected.
    _METHODS: dict
    # Roles allowed to call a protected method. ROLE_ROBOT is the default/no-auth
    # role and always allowed (the robot's own in-process calls).
    _PRIVILEGED_ROLES = (ROLE_ADMIN, ROLE_ROBOT)

    def __init__(self):
        self._response_dp = None

    @property
    def _request_label(self) -> str:
        return f"{self.LABEL}/requests"

    async def _attach(self, transport) -> None:
        self._response_dp = await transport.produceData(
            label=f"{self.LABEL}/responses"
        )

    def _detach(self) -> None:
        self._response_dp = None

    def _send_ready(self, request_channel_id: str) -> None:
        """Announce on the shared response channel that this service has
        consumed the request channel with the given SFU dataProducerId, so the
        producing browser knows it is safe to send. Carries no id/payload."""
        dp = self._response_dp
        if dp is not None and dp.readyState == "open":
            dp.send(RpcResponse(ready_request_id=request_channel_id).SerializeToString())

    async def _handle_request(self, data: bytes, logger, role: int = ROLE_ROBOT) -> None:
        try:
            req = RpcRequest.FromString(bytes(data))
        except Exception:
            logger.warning(f"{self.LABEL}: undecodable rpc request dropped")
            return
        resp = RpcResponse(client_id=req.client_id, id=req.id)
        try:
            entry = self._METHODS.get(req.method)
            if entry is None:
                raise ValueError(f"unknown method: {req.method}")
            attr, request_cls = entry[0], entry[1]
            protected = entry[2] if len(entry) > 2 else False
            # `role` is the Role the SFU stamped into the caller's requests
            # channel (from the role the host resolved) — not client-supplied.
            if protected and role not in self._PRIVILEGED_ROLES:
                raise PermissionError(f"permission denied: {req.method} is protected")
            result = await getattr(self, attr)(request_cls.FromString(req.payload))
            resp.payload = result.SerializeToString()
        except Exception as exc:  # any handler failure -> error response
            resp.error = str(exc) or type(exc).__name__
            logger.warning(f"{self.LABEL}.{req.method} failed: {resp.error}")
        dp = self._response_dp
        if dp is not None and dp.readyState == "open":
            dp.send(resp.SerializeToString())


class Proto4WebrtcClient:
    """Base class for the generated Proto4WebrtcProducer.

    Subclass __init__ must call super().__init__(...) and then populate
    self._tracks, self._data_producers, self._media_producers before
    run_forever() is called.
    """

    RECONNECT_DELAY_S = 3.0
    # How long a transport may sit in "disconnected" before we give up on it
    # and cycle the whole connection. ICE often recovers on its own from a
    # brief network blip, so don't tear down on the first hiccup.
    DISCONNECT_GRACE_S = 10.0
    # websocket keepalive: without this a half-open TCP connection (server
    # killed, NAT entry evicted) can hang the reader indefinitely.
    PING_INTERVAL_S = 20.0
    PING_TIMEOUT_S = 20.0

    def __init__(
        self,
        signaling_url: str,
        reconnect_delay: float = RECONNECT_DELAY_S,
        logger=None,
        token: str | None = None,
    ):
        self.signaling_url = signaling_url
        # Signaling auth token (JWT with role "robot"), sent as an
        # "Authorization: Bearer <token>" header on the websocket handshake.
        # Required to produce streams when the SFU host enforces auth; None
        # connects with no header (no-auth SFUs treat every peer as robot).
        self.token = token
        self.reconnect_delay = reconnect_delay
        self._logger = logger or logging.getLogger("proto4webrtc")

        self._tracks: list[FrameTrack] = []
        self._data_producers: list[DataProducerBase] = []
        self._media_producers: list[MediaProducerBase] = []
        self._rpc_services: list[RpcServiceBase] = []

        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws = None
        self._pending: dict[int, asyncio.Future] = {}
        self._event_handlers: list = []
        self._next_id = 1
        self._stop_event: asyncio.Event | None = None
        # Set when a transport dies while the signaling socket is still up, so
        # _connect_once() stops waiting on the reader and cycles the connection.
        self._conn_lost: asyncio.Event | None = None

    # --- lifecycle ---------------------------------------------------------

    def run_forever(self) -> None:
        """Block the calling thread running the connect/reconnect loop."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        for track in self._tracks:
            track._loop = self._loop
        try:
            self._loop.run_until_complete(self._run())
        except KeyboardInterrupt:
            pass

    def stop(self) -> None:
        """Thread-safe: ask run_forever() to return after the current connection closes."""
        loop = self._loop
        if loop is not None:
            loop.call_soon_threadsafe(self._request_stop)

    def _request_stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()

    async def _run(self) -> None:
        self._stop_event = asyncio.Event()
        while not self._stop_event.is_set():
            try:
                await self._connect_once()
            except (OSError, websockets.WebSocketException) as exc:
                self._logger.warning(f"signaling connection failed: {exc}")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # Anything else (a mediasoup/aiortc error, a failed rpc during
                # setup) used to escape run_forever() and kill the process.
                # Log it and reconnect instead -- a robot that stops streaming
                # because the SFU restarted mid-handshake is the worst outcome.
                # .error, not .exception: the logger may be a ROS2
                # RcutilsLogger, which has no exception(). Format the traceback
                # in ourselves so a crash is still diagnosable.
                self._logger.error(
                    f"connection attempt failed: {exc!r}\n"
                    + "".join(traceback.format_exception(exc))
                )
            if not self._stop_event.is_set():
                self._logger.info(f"reconnecting in {self.reconnect_delay}s")
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(), timeout=self.reconnect_delay
                    )
                except asyncio.TimeoutError:
                    pass

    # --- signaling RPC -------------------------------------------------------

    async def rpc(self, action: str, params: dict | None = None):
        assert self._ws is not None
        request_id = self._next_id
        self._next_id += 1
        future: asyncio.Future = self._loop.create_future()
        self._pending[request_id] = future
        await self._ws.send(json.dumps({"id": request_id, "action": action, **(params or {})}))
        return await future

    async def _reader(self, ws) -> None:
        async for raw in ws:
            msg = json.loads(raw)
            mid = msg.get("id")
            if mid is not None and mid in self._pending:
                fut = self._pending.pop(mid)
                if msg.get("ok"):
                    fut.set_result(msg.get("data"))
                else:
                    fut.set_exception(RuntimeError(msg.get("error", "rpc error")))
            elif msg.get("event"):
                # server events; rpc services watch for browsers' request channels
                for handler in list(self._event_handlers):
                    handler(msg)

    async def _warn_if_not_robot(self) -> None:
        """Log loudly if the signaling host resolved a role other than ROBOT.

        A robot needs ROLE_ROBOT to produce streams and serve rpc; landing as
        GUEST/ADMIN means the connection was accepted but every produce/rpc
        will be denied — usually a token that doesn't match the server's
        ROBOT_TOKEN (or a server that requires one when none was sent).
        Best-effort: older SFUs without the `whoami` action are ignored."""
        try:
            who = await self.rpc("whoami")
        except Exception:
            return  # SFU predates whoami; nothing to check
        role = who.get("role") if isinstance(who, dict) else None
        if role is not None and role != ROLE_ROBOT:
            self._logger.error(
                f"signaling connection resolved role {role}, not ROBOT "
                f"({ROLE_ROBOT}): the server accepted this peer but will deny "
                "producing streams and serving rpc. Check that the robot's "
                "token matches the server's ROBOT_TOKEN (or that a token is "
                "supplied if the server requires one)."
            )

    # --- asyncio / mediasoup -------------------------------------------------

    def _watch_transport(self, transport, name: str) -> None:
        """Log transport state and trip _conn_lost when it stops working.

        The signaling socket can stay perfectly healthy while the media
        transport dies (ICE consent failure, DTLS teardown, the SFU closing the
        transport), so transport death has to drive the reconnect loop too --
        otherwise the client sits forever on a connection that sends nothing.
        """
        grace: asyncio.TimerHandle | None = None

        def lose(reason: str) -> None:
            if self._conn_lost is not None and not self._conn_lost.is_set():
                self._logger.warning(
                    f"{name} transport {reason}: dropping connection to reconnect"
                )
                self._conn_lost.set()

        @transport.on("connectionstatechange")
        async def on_conn_state(state):
            nonlocal grace
            self._logger.info(f"{name} transport state: {state}")
            if grace is not None:
                grace.cancel()
                grace = None
            if state in ("failed", "closed"):
                lose(state)
            elif state == "disconnected":
                grace = self._loop.call_later(
                    self.DISCONNECT_GRACE_S,
                    lambda: lose(f"disconnected for {self.DISCONNECT_GRACE_S}s"),
                )

    async def _connect_once(self) -> None:
        self._pending = {}
        self._conn_lost = asyncio.Event()
        transport = None
        recv_transport = None
        rpc_event_handler = None

        # Send the token as an Authorization header (not a ?token= query
        # param): the host application reads it off the upgrade request,
        # verifies it, and resolves the peer's role. None connects with no
        # header (no-auth SFUs, which treat every peer as robot).
        headers = (
            {"Authorization": f"Bearer {self.token}"} if self.token else None
        )
        async with websockets.connect(
            self.signaling_url,
            additional_headers=headers,
            ping_interval=self.PING_INTERVAL_S,
            ping_timeout=self.PING_TIMEOUT_S,
        ) as ws:
            self._ws = ws
            reader_task = asyncio.ensure_future(self._reader(ws))
            try:
                router_caps = await self.rpc("getRtpCapabilities")
                await self._warn_if_not_robot()
                device = Device(
                    handlerFactory=AiortcHandler.createFactory(
                        tracks=self._tracks, loop=self._loop
                    )
                )
                await device.load(RtpCapabilities(**router_caps))

                params = await self.rpc("createTransport", {"direction": "send"})
                transport = device.createSendTransport(
                    id=params["id"],
                    iceParameters=IceParameters(**params["iceParameters"]),
                    iceCandidates=[IceCandidate(**c) for c in params["iceCandidates"]],
                    dtlsParameters=DtlsParameters(**params["dtlsParameters"]),
                    sctpParameters=(
                        SctpParameters(**params["sctpParameters"])
                        if params.get("sctpParameters")
                        else None
                    ),
                )

                self._watch_transport(transport, "send")

                @transport.on("connect")
                async def on_connect(dtlsParameters):
                    await self.rpc(
                        "connectTransport",
                        {
                            "transportId": transport.id,
                            "dtlsParameters": _dump(dtlsParameters),
                        },
                    )

                @transport.on("produce")
                async def on_produce(kind, rtpParameters, appData):
                    res = await self.rpc(
                        "produce",
                        {
                            "transportId": transport.id,
                            "kind": kind,
                            "rtpParameters": _dump(rtpParameters),
                            "appData": appData or {},
                        },
                    )
                    return res["id"]

                @transport.on("producedata")
                async def on_producedata(sctpStreamParameters, label, protocol, appData):
                    res = await self.rpc(
                        "produceData",
                        {
                            "transportId": transport.id,
                            "sctpStreamParameters": _dump(sctpStreamParameters),
                            "label": label,
                            "protocol": protocol,
                            "appData": appData or {},
                        },
                    )
                    return res["id"]

                for dp in self._data_producers:
                    await dp._attach(transport)
                for mp in self._media_producers:
                    await mp._attach(transport)
                for svc in self._rpc_services:
                    await svc._attach(transport)
                if self._rpc_services:
                    recv_transport, rpc_event_handler = await self._serve_rpc(
                        device
                    )
                produced = [
                    p.LABEL
                    for p in (*self._data_producers, *self._media_producers)
                ] + [f"{s.LABEL}/rpc" for s in self._rpc_services]
                self._logger.info(f"producing: {', '.join(produced) or '(nothing)'}")

                # Whichever comes first: the socket closing, a transport dying,
                # or stop() being called.
                lost_task = asyncio.ensure_future(self._conn_lost.wait())
                stop_task = asyncio.ensure_future(self._stop_event.wait())
                try:
                    await asyncio.wait(
                        [reader_task, lost_task, stop_task],
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                finally:
                    lost_task.cancel()
                    stop_task.cancel()
                if reader_task.done() and not reader_task.cancelled():
                    reader_task.result()  # surface a reader crash to _run()
            finally:
                # Marks the connection dead before teardown, so the "closed"
                # states our own transport.close() emits don't log as failures.
                self._conn_lost.set()
                reader_task.cancel()
                self._ws = None
                for fut in self._pending.values():
                    if not fut.done():
                        fut.set_exception(ConnectionError("signaling connection closed"))
                self._pending = {}
                for dp in self._data_producers:
                    dp._detach()
                for mp in self._media_producers:
                    mp._detach()
                for svc in self._rpc_services:
                    svc._detach()
                if rpc_event_handler is not None:
                    self._event_handlers.remove(rpc_event_handler)
                for t in (transport, recv_transport):
                    if t is None:
                        continue
                    try:
                        await t.close()
                    except Exception as exc:  # never let cleanup break the loop
                        self._logger.warning(f"transport close failed: {exc}")

    async def _serve_rpc(self, device):
        """Consume every browser's "<label>/requests" channel (current and
        future) on a receive transport, dispatching into the rpc services."""
        params = await self.rpc("createTransport", {"direction": "recv"})
        recv_transport = device.createRecvTransport(
            id=params["id"],
            iceParameters=IceParameters(**params["iceParameters"]),
            iceCandidates=[IceCandidate(**c) for c in params["iceCandidates"]],
            dtlsParameters=DtlsParameters(**params["dtlsParameters"]),
            sctpParameters=(
                SctpParameters(**params["sctpParameters"])
                if params.get("sctpParameters")
                else None
            ),
        )

        self._watch_transport(recv_transport, "recv")

        @recv_transport.on("connect")
        async def on_connect(dtlsParameters):
            await self.rpc(
                "connectTransport",
                {
                    "transportId": recv_transport.id,
                    "dtlsParameters": _dump(dtlsParameters),
                },
            )

        by_label = {svc._request_label: svc for svc in self._rpc_services}
        seen: set[str] = set()

        async def consume(
            data_producer_id: str, svc: RpcServiceBase, role: int
        ) -> None:
            if data_producer_id in seen:
                return
            seen.add(data_producer_id)
            try:
                p = await self.rpc(
                    "consumeData",
                    {
                        "transportId": recv_transport.id,
                        "dataProducerId": data_producer_id,
                    },
                )
                consumer = await recv_transport.consumeData(
                    id=p["id"],
                    dataProducerId=p["dataProducerId"],
                    sctpStreamParameters=SctpStreamParameters(
                        **p["sctpStreamParameters"]
                    ),
                    label=p.get("label"),
                    protocol=p.get("protocol"),
                )
            except Exception as exc:
                seen.discard(data_producer_id)  # let a reconnect/retry re-consume
                self._logger.warning(f"rpc consumeData failed: {exc}")
                return
            # A request arriving proves the channel is flowing; used to stop
            # the readiness beacon early.
            got_request = asyncio.Event()

            def on_message(data):
                got_request.set()
                asyncio.ensure_future(
                    svc._handle_request(data, self._logger, role)
                )

            consumer.on("message", on_message)
            # Tell the producing browser its channel is consumed so its first
            # send doesn't race ahead of this consumer and get dropped. Resent
            # a few times to survive the browser's own response-channel
            # consumer still coming up; stops as soon as a request lands.
            asyncio.ensure_future(
                self._beacon_ready(svc, data_producer_id, got_request)
            )

        # The SFU stamps the caller's Role (an int; see proto4webrtc.Role) into
        # its requests channel's appData. Absent (no-auth SFU, or a peer the
        # host left as robot) means ROLE_ROBOT — full access.
        def role_of(app_data) -> int:
            role = (app_data or {}).get("role")
            return role if isinstance(role, int) and not isinstance(role, bool) else ROLE_ROBOT

        def on_event(msg: dict) -> None:
            if msg.get("event") != "newDataProducer":
                return
            svc = by_label.get(msg.get("label"))
            if svc is not None:
                asyncio.ensure_future(
                    consume(msg["dataProducerId"], svc, role_of(msg.get("appData")))
                )

        self._event_handlers.append(on_event)

        existing = await self.rpc("getProducers")
        for dp in existing.get("dataProducers", []):
            svc = by_label.get(dp.get("label"))
            if svc is not None:
                await consume(dp["dataProducerId"], svc, role_of(dp.get("appData")))

        return recv_transport, on_event

    async def _beacon_ready(self, svc, channel_id: str, got_request) -> None:
        """Send readiness beacons for a just-consumed request channel until the
        browser starts sending (or a small budget is exhausted). Cheap: a
        handful of tiny envelopes on the shared response channel."""
        for _ in range(5):
            svc._send_ready(channel_id)
            try:
                await asyncio.wait_for(got_request.wait(), timeout=0.3)
                return  # the browser is clearly sending now
            except asyncio.TimeoutError:
                continue
