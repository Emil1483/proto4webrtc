"""Regression coverage for the proto4webrtc/options.proto packaging collision.

driver.generate() must never write a proto4webrtc/ directory into a
consumer's out_dir: this pip package is itself importable as `proto4webrtc`
(proto4webrtc.runtime), and a per-project generated proto4webrtc/options_pb2.py
would be a second, colliding top-level package of the same name — whichever
lands first on sys.path shadows the other entirely. The bundled
proto4webrtc/options.proto must be resolved as an import only (via -I),
never generated, relying on options_pb2.py being bundled inside the real
proto4webrtc package instead (see python/proto4webrtc/options_pb2.py).
"""

from pathlib import Path

from proto4webrtc_codegen.driver import generate

EXAMPLE_PROTO = Path(__file__).resolve().parents[3] / "example" / "proto"


def test_generate_does_not_write_a_proto4webrtc_directory(tmp_path):
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    assert not (tmp_path / "proto4webrtc").exists()
    assert (tmp_path / "proto4webrtc_gen" / "producers.py").exists()
    assert (tmp_path / "rov" / "streams" / "thrusters_pb2.py").exists()


def test_generated_streams_module_imports_options_from_the_real_runtime_package(tmp_path):
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    source = (tmp_path / "rov" / "streams" / "thrusters_pb2.py").read_text()
    assert "from proto4webrtc import options_pb2" in source


def test_generated_data_producers_have_typed_send(tmp_path):
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    source = (tmp_path / "proto4webrtc_gen" / "producers.py").read_text()
    assert "def send(self, msg: Thrusters) -> bool | None:" in source


def test_generated_producers_include_rpc_service_base(tmp_path):
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    source = (tmp_path / "proto4webrtc_gen" / "producers.py").read_text()
    assert "class RovControlBase(RpcServiceBase):" in source
    assert '"SetLight": ("set_light", SetLightRequest, True)' in source
    assert '"Ping": ("ping", PingRequest, False)' in source
    assert "async def set_light(self, request: SetLightRequest)" in source
    assert "rov_control: RovControlBase" in source


def test_vendored_options_proto_in_the_root_is_not_generated(tmp_path):
    """`buf export` style vendoring puts proto4webrtc/options.proto in the
    proto root. It must stay import-only, not become a protoc target."""
    import shutil

    root = tmp_path / "protos"
    shutil.copytree(EXAMPLE_PROTO, root)
    vendored = root / "proto4webrtc"
    vendored.mkdir(parents=True, exist_ok=True)
    shutil.copy(
        Path(__file__).resolve().parents[3]
        / "proto"
        / "proto4webrtc"
        / "options.proto",
        vendored / "options.proto",
    )

    out = tmp_path / "out"
    generate(proto_dirs=[root], out_dir=out)

    assert not (out / "proto4webrtc").exists()
    assert (out / "rov" / "streams" / "thrusters_pb2.py").exists()


def test_generated_client_can_own_a_subset_of_the_streams(tmp_path):
    """Several producer processes off ONE bundle: each picks its labels with
    streams=[...] instead of each generating from its own proto subset."""
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    source = (tmp_path / "proto4webrtc_gen" / "producers.py").read_text()
    # the (attr, label, class) registry streams= resolves against
    assert '("thrusters", "telemetry", ThrustersProducer)' in source
    assert '("camera_stream", "camera", CameraStreamProducer)' in source
    assert "def __init__(self, signaling_url: str, *, streams=None," in source
    assert "selected = select_streams(streams, self._STREAMS)" in source
    # unselected streams become a loud placeholder, not a silent no-op
    assert (
        'self.thrusters = ThrustersProducer(self) if "thrusters" in selected '
        'else UnselectedStream("telemetry", "thrusters", "ThrustersProducer")'
    ) in source
    # ... and a media stream's track is only created when it is selected
    assert (
        'self._camera_stream_track = FrameTrack(kind="video", clock_rate=90000) '
        'if "camera_stream" in selected else None'
    ) in source


def test_generated_rpc_services_are_optional(tmp_path):
    """An rpc-only or stream-only process passes just what it serves."""
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    source = (tmp_path / "proto4webrtc_gen" / "producers.py").read_text()
    assert "rov_control: RovControlBase | None = None" in source
    assert "configurator: ConfiguratorBase | None = None" in source
    assert (
        "self._rpc_services = [s for s in (self.rov_control, self.greeter, "
        "self.configurator, ) if s is not None]"
    ) in source


def test_one_bundle_holds_every_stream_it_was_generated_from(tmp_path):
    """Without include=, the whole tree lands in one bundle; with include= only
    the matching protos do — either way the processes sharing that bundle split
    it with streams=."""
    generate(proto_dirs=[EXAMPLE_PROTO], out_dir=tmp_path)

    source = (tmp_path / "proto4webrtc_gen" / "producers.py").read_text()
    for label in ("telemetry", "camera", "pointcloud", "mission_status"):
        assert f'"{label}", ' in source or f'"{label}")' in source
