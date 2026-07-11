"""Unit coverage for proto4webrtc.runtime that doesn't need a real mediasoup server.

_connect_once's Device/transport wiring is thin glue over pymediasoup and is
exercised by hand against a real signaling server instead of faked here.
"""

import asyncio
import threading
import time

import numpy as np
import pytest

from proto4webrtc.runtime import (
    DataProducerBase,
    FrameTrack,
    MediaProducerBase,
    Proto4WebrtcClient,
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

    def __init__(self, loop):
        self._loop = loop


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

    async def produce(self, track, stopTracks, appData):
        self.produce_calls.append((track, stopTracks, appData))
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
