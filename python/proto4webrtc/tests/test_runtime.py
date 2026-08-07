"""Unit coverage for proto4webrtc.runtime that doesn't need a real mediasoup server.

_connect_once's Device/transport wiring is thin glue over pymediasoup and is
exercised by hand against a real signaling server instead of faked here.
"""

import asyncio
import threading
import time

import numpy as np
import pytest
from pymediasoup.rtp_parameters import RtpCapabilities, RtpCodecCapability

from proto4webrtc.runtime import (
    DataProducerBase,
    FrameTrack,
    MediaProducerBase,
    Proto4WebrtcClient,
    UnselectedStream,
    select_streams,
)


class FakeDataChannel:
    def __init__(self, ready_state="open"):
        self.readyState = ready_state
        self.bufferedAmount = 0
        self.sent = []

    def send(self, payload):
        self.sent.append(payload)


class FakeMessage:
    def __init__(self, payload=b"hello"):
        self._payload = payload

    def SerializeToString(self):
        return self._payload


class DummyClient:
    """Just enough of Proto4WebrtcClient for DataProducerBase.send()."""

    def __init__(self, loop, send_rtp_capabilities=None):
        self._loop = loop
        self._send_rtp_capabilities = send_rtp_capabilities


def test_send_before_attach_is_a_safe_no_op():
    dp = DataProducerBase(DummyClient(loop=None))
    assert dp.send(FakeMessage()) is False


def test_send_now_open_channel():
    client = DummyClient(loop=None)
    dp = DataProducerBase(client)
    dp._dp = FakeDataChannel()
    assert dp._send_now(FakeMessage(b"payload")) is True
    assert dp._dp.sent == [b"payload"]


def test_send_now_closed_channel_returns_false():
    client = DummyClient(loop=None)
    dp = DataProducerBase(client)
    dp._dp = FakeDataChannel(ready_state="closed")
    assert dp._send_now(FakeMessage()) is False


def test_detach_clears_dp():
    client = DummyClient(loop=None)
    dp = DataProducerBase(client)
    dp._dp = FakeDataChannel()
    dp._detach()
    assert dp._dp is None
    assert dp.send(FakeMessage()) is False


class DropIfBuffered(DataProducerBase):
    LABEL = "x"

    def _check_backpressure(self, dp, payload):
        return dp.bufferedAmount <= 2 * len(payload)


def test_backpressure_drop():
    client = DummyClient(loop=None)
    dp = DropIfBuffered(client)
    dp._dp = FakeDataChannel()
    dp._dp.bufferedAmount = 100
    assert dp._send_now(FakeMessage(b"tiny")) is False
    assert dp._dp.sent == []

    dp._dp.bufferedAmount = 0
    assert dp._send_now(FakeMessage(b"tiny")) is True


def test_send_from_background_thread_dispatches_via_call_soon_threadsafe():
    loop = asyncio.new_event_loop()
    loop_thread = threading.Thread(target=loop.run_forever, daemon=True)
    loop_thread.start()
    try:
        client = DummyClient(loop=loop)
        dp = DataProducerBase(client)
        dp._dp = FakeDataChannel()

        # Called from this (non-loop) thread: dispatched, no synchronous result.
        result = dp.send(FakeMessage(b"payload"))
        assert result is None

        # Give the loop thread a moment to run the dispatched call.
        deadline = time.monotonic() + 2
        while not dp._dp.sent and time.monotonic() < deadline:
            time.sleep(0.01)
        assert dp._dp.sent == [b"payload"]
    finally:
        loop.call_soon_threadsafe(loop.stop)
        loop_thread.join(timeout=2)
        loop.close()


class FakeProducer:
    def __init__(self):
        self.closed = False


class FakeTransport:
    def __init__(self):
        self.produce_calls = []
        self.produce_kwargs = []

    async def produce(self, track, stopTracks, appData, **kwargs):
        self.produce_calls.append((track, stopTracks, appData))
        self.produce_kwargs.append(kwargs)
        return FakeProducer()


@pytest.mark.asyncio
async def test_media_producer_attach_wires_track_with_label():
    track = FrameTrack(kind="video")
    mp = MediaProducerBase(DummyClient(loop=None), track)
    mp.LABEL = "camera"
    transport = FakeTransport()

    await mp._attach(transport)

    assert transport.produce_calls == [(track, False, {"label": "camera"})]
    assert mp._producer is not None

    mp._detach()
    assert mp._producer is None


def _video_caps(*mime_types):
    """A pymediasoup RtpCapabilities carrying one video codec per mime type."""
    return RtpCapabilities(
        codecs=[
            RtpCodecCapability(
                kind="video",
                mimeType=mime,
                clockRate=90000,
                preferredPayloadType=96 + i,
                parameters=(
                    {"packetization-mode": 1, "profile-level-id": "42e01f"}
                    if mime == "video/H264"
                    else {}
                ),
            )
            for i, mime in enumerate(mime_types)
        ]
    )


@pytest.mark.asyncio
async def test_media_producer_pins_the_declared_codec():
    class H264Stream(MediaProducerBase):
        LABEL = "camera"
        KIND = "video"
        VIDEO_CODEC = "H264"

    caps = _video_caps("video/VP8", "video/H264")
    mp = H264Stream(DummyClient(loop=None, send_rtp_capabilities=caps), FrameTrack())
    transport = FakeTransport()

    await mp._attach(transport)

    # The capability handed to produce() is the negotiated one, parameters
    # included -- pymediasoup's reduceCodecs() matches H264 strictly.
    codec = transport.produce_kwargs[0]["codec"]
    assert codec.mimeType == "video/H264"
    assert codec.parameters["profile-level-id"] == "42e01f"


@pytest.mark.asyncio
async def test_media_producer_without_a_declared_codec_leaves_the_choice_open():
    mp = MediaProducerBase(
        DummyClient(loop=None, send_rtp_capabilities=_video_caps("video/VP8")),
        FrameTrack(),
    )
    mp.LABEL = "camera"

    await mp._attach(FakeTransport())

    assert mp._producer is not None


def test_media_producer_rejects_a_codec_aiortc_cannot_encode():
    class Vp9Stream(MediaProducerBase):
        LABEL = "camera"
        KIND = "video"
        VIDEO_CODEC = "VP9"

    mp = Vp9Stream(
        DummyClient(loop=None, send_rtp_capabilities=_video_caps("video/VP9")),
        FrameTrack(),
    )

    with pytest.raises(RuntimeError, match="cannot encode"):
        mp._codec()


def test_media_producer_reports_a_codec_the_sfu_does_not_offer():
    class H264Stream(MediaProducerBase):
        LABEL = "camera"
        KIND = "video"
        VIDEO_CODEC = "H264"

    mp = H264Stream(
        DummyClient(loop=None, send_rtp_capabilities=_video_caps("video/VP8")),
        FrameTrack(),
    )

    with pytest.raises(RuntimeError, match="video/VP8"):
        mp._codec()


def test_frame_track_survives_stop():
    # aiortc's RTCRtpSender.stop()s its track on every pc.close(); an ended
    # track can never be produced again, so the camera would never come back
    # after a reconnect.
    track = FrameTrack(kind="video")
    track.stop()
    assert track.readyState == "live"
    frame = object()
    track.push(frame)
    assert track._queue.get_nowait() is frame


def test_frame_track_push_is_drop_oldest():
    track = FrameTrack(kind="video")
    frame_a, frame_b = object(), object()
    track.push(frame_a)
    track.push(frame_b)  # queue maxsize=1: frame_a is dropped
    assert track._queue.qsize() == 1
    assert track._queue.get_nowait() is frame_b


@pytest.mark.asyncio
async def test_frame_track_recv_stamps_pts_and_time_base():
    track = FrameTrack(kind="video", clock_rate=90000)
    ndarray_frame = np.zeros((2, 2, 3), dtype=np.uint8)
    track.push(ndarray_frame)  # numpy ndarray -> av.VideoFrame conversion
    frame = await track.recv()
    assert frame.pts == 0  # first frame: start == now
    assert frame.time_base.denominator == 90000


@pytest.mark.asyncio
async def test_rpc_matches_response_to_request_id():
    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send(self, raw):
            self.sent.append(raw)

    client = Proto4WebrtcClient("ws://unused")
    client._loop = asyncio.get_running_loop()
    client._ws = FakeWebSocket()

    rpc_task = asyncio.ensure_future(client.rpc("getRtpCapabilities"))
    await asyncio.sleep(0)  # let rpc() send and register the pending future
    assert len(client._pending) == 1
    request_id = next(iter(client._pending))

    fut = client._pending.pop(request_id)
    fut.set_result({"codecs": []})

    result = await rpc_task
    assert result == {"codecs": []}


@pytest.mark.asyncio
async def test_reader_dispatches_error_response_as_exception():
    async def fake_messages():
        yield '{"id": 1, "ok": false, "error": "boom"}'

    client = Proto4WebrtcClient("ws://unused")
    client._loop = asyncio.get_running_loop()
    fut = client._loop.create_future()
    client._pending[1] = fut

    await client._reader(fake_messages())

    with pytest.raises(RuntimeError, match="boom"):
        fut.result()


# --- rpc services -----------------------------------------------------------

import logging

from proto4webrtc.runtime import RpcServiceBase
from proto4webrtc.rpc_pb2 import RpcRequest, RpcResponse
from proto4webrtc.options_pb2 import (  # any small message
    ROLE_ADMIN,
    ROLE_GUEST,
    ROLE_ROBOT,
    DataStreamOptions,
)


class EchoService(RpcServiceBase):
    LABEL = "svc"
    _METHODS = {"Echo": ("echo", DataStreamOptions)}

    async def echo(self, request):
        return DataStreamOptions(label=request.label + "!")


class FailingService(EchoService):
    async def echo(self, request):
        raise ValueError("nope")


def _request(method="Echo", label="hi"):
    payload = DataStreamOptions(label=label).SerializeToString()
    return RpcRequest(
        client_id="c1", id=7, method=method, payload=payload
    ).SerializeToString()


@pytest.mark.asyncio
async def test_rpc_service_dispatches_and_responds():
    svc = EchoService()
    svc._response_dp = FakeDataChannel()

    await svc._handle_request(_request(), logging.getLogger("test"))

    assert len(svc._response_dp.sent) == 1
    res = RpcResponse.FromString(svc._response_dp.sent[0])
    assert (res.client_id, res.id, res.error) == ("c1", 7, "")
    assert DataStreamOptions.FromString(res.payload).label == "hi!"


@pytest.mark.asyncio
async def test_rpc_service_unknown_method_is_an_error_response():
    svc = EchoService()
    svc._response_dp = FakeDataChannel()

    await svc._handle_request(_request(method="Nope"), logging.getLogger("test"))

    res = RpcResponse.FromString(svc._response_dp.sent[0])
    assert "unknown method" in res.error
    assert res.payload == b""


@pytest.mark.asyncio
async def test_rpc_service_handler_exception_is_an_error_response():
    svc = FailingService()
    svc._response_dp = FakeDataChannel()

    await svc._handle_request(_request(), logging.getLogger("test"))

    res = RpcResponse.FromString(svc._response_dp.sent[0])
    assert res.error == "nope"


class ProtectedService(EchoService):
    # 3-tuple form: protected method (see options.proto's proto4webrtc.protected)
    _METHODS = {"Echo": ("echo", DataStreamOptions, True)}


@pytest.mark.asyncio
async def test_protected_method_rejects_guest_callers():
    svc = ProtectedService()
    svc._response_dp = FakeDataChannel()

    await svc._handle_request(_request(), logging.getLogger("test"), role=ROLE_GUEST)

    res = RpcResponse.FromString(svc._response_dp.sent[0])
    assert "permission denied" in res.error
    assert res.payload == b""


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [ROLE_ADMIN, ROLE_ROBOT])
async def test_protected_method_allows_admin_and_robot(role):
    svc = ProtectedService()
    svc._response_dp = FakeDataChannel()

    await svc._handle_request(_request(), logging.getLogger("test"), role=role)

    res = RpcResponse.FromString(svc._response_dp.sent[0])
    assert res.error == ""


@pytest.mark.asyncio
async def test_unprotected_method_allows_guests_and_legacy_2_tuple_entries():
    svc = EchoService()  # 2-tuple _METHODS: pre-auth generated code
    svc._response_dp = FakeDataChannel()

    await svc._handle_request(_request(), logging.getLogger("test"), role=ROLE_GUEST)

    res = RpcResponse.FromString(svc._response_dp.sent[0])
    assert res.error == ""


@pytest.mark.asyncio
async def test_rpc_service_without_channel_swallows_response():
    svc = EchoService()  # _response_dp is None (not connected yet)
    await svc._handle_request(_request(), logging.getLogger("test"))


def test_reader_events_reach_handlers():
    async def fake_messages():
        yield '{"event": "newDataProducer", "label": "svc/requests", "dataProducerId": "d1"}'

    client = Proto4WebrtcClient("ws://unused")
    seen = []
    client._event_handlers.append(seen.append)

    asyncio.run(client._reader(fake_messages()))

    assert seen == [
        {"event": "newDataProducer", "label": "svc/requests", "dataProducerId": "d1"}
    ]


# --- stream selection (several producer processes, one generated bundle) ----

class FakeProducerA:
    LABEL = "telemetry"


class FakeProducerB:
    LABEL = "camera"


REGISTRY = (
    ("thrusters", "telemetry", FakeProducerA),
    ("camera_stream", "camera", FakeProducerB),
)


def test_select_streams_none_selects_everything():
    assert select_streams(None, REGISTRY) == {"thrusters", "camera_stream"}


def test_select_streams_by_producer_class():
    assert select_streams([FakeProducerA], REGISTRY) == {"thrusters"}


def test_select_streams_by_label():
    """Labels let the split come from config (e.g. a ROS2 parameter)."""
    assert select_streams(["camera"], REGISTRY) == {"camera_stream"}


def test_select_streams_empty_selects_nothing():
    """An rpc-only process owns no data/media label."""
    assert select_streams([], REGISTRY) == set()


def test_select_streams_rejects_unknown_selectors():
    with pytest.raises(ValueError, match="unknown stream"):
        select_streams(["telemetri"], REGISTRY)


def test_unselected_stream_fails_loudly_instead_of_dropping():
    stream = UnselectedStream("camera", "camera_stream", "CameraStreamProducer")
    with pytest.raises(RuntimeError, match="not produced by this client"):
        stream.push(object())
    with pytest.raises(RuntimeError, match="streams=\\[CameraStreamProducer\\]"):
        stream.send(FakeMessage())
