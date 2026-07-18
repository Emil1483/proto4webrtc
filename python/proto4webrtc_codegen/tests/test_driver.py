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
    assert '"SetLight": ("set_light", SetLightRequest)' in source
    assert "async def set_light(self, request: SetLightRequest)" in source
    assert "rov_control: RovControlBase" in source
