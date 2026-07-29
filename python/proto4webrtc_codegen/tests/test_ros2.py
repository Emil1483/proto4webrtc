"""Coverage for the ROS2 interface generator (proto4webrtc_codegen.ros2).

The mapping's value is that it either produces something faithful or refuses, so
most of this file pins down the refusals. The rest pins the two rules that are
easy to regress: a declaration-only media_stream message is not a msg, and a
message used only as an rpc payload is rendered into its .srv rather than a msg.
"""

import textwrap
from pathlib import Path

import pytest

from proto4webrtc_codegen.ros2 import Ros2GenError, generate_interfaces

EXAMPLE_PROTO = Path(__file__).resolve().parents[3] / "example" / "proto"


def write_proto(tmp_path: Path, body: str, name: str = "app/x.proto") -> Path:
    path = tmp_path / "proto" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(body))
    return tmp_path / "proto"


def gen(tmp_path: Path, body: str, **kwargs) -> Path:
    root = write_proto(tmp_path, body)
    out = tmp_path / "pkg"
    generate_interfaces(root, out, **kwargs)
    return out


# ---------------------------------------------------------------------------
# the example protos, end to end
# ---------------------------------------------------------------------------


def test_example_protos_generate_msgs_and_srvs(tmp_path):
    paths = generate_interfaces(EXAMPLE_PROTO, tmp_path)

    assert "msg/Thrusters.msg" in paths
    assert "srv/Ping.srv" in paths
    # Declaration-only media stream: RTP frames never travel as protobuf, so
    # there is nothing to put in a msg.
    assert not (tmp_path / "msg" / "CameraStream.msg").exists()
    # Payload-only rpc types are rendered into their .srv, not as msgs.
    assert not (tmp_path / "msg" / "PingRequest.msg").exists()
    # ...but a response that is also a field type elsewhere keeps its msg.
    assert (tmp_path / "msg" / "Mission.msg").exists()


def test_srv_splits_request_and_response(tmp_path):
    generate_interfaces(EXAMPLE_PROTO, tmp_path)

    request, response = (tmp_path / "srv" / "UpdateMission.srv").read_text().split("---")
    assert "string name" in request and "float32[] depths" in request
    assert "uint32 revision" in response and "revision" not in request


def test_bytes_and_enum_mapping(tmp_path):
    generate_interfaces(EXAMPLE_PROTO, tmp_path)

    pointcloud = (tmp_path / "msg" / "PointCloud.msg").read_text()
    assert "uint8[] data" in pointcloud  # bytes -> uint8[]
    assert "int32 XYZ_F32=1" in pointcloud  # enum -> constants + int32 field
    assert "int32 format" in pointcloud


def test_include_limits_the_target_set(tmp_path):
    paths = generate_interfaces(
        EXAMPLE_PROTO, tmp_path, include=["rov/streams/*.proto"]
    )

    assert "msg/Thrusters.msg" in paths
    assert not any(p.startswith("srv/") for p in paths)


def test_no_services_emits_messages_only(tmp_path):
    paths = generate_interfaces(EXAMPLE_PROTO, tmp_path, services=False)

    assert not (tmp_path / "srv").exists()
    assert all(p.startswith("msg/") for p in paths)


# ---------------------------------------------------------------------------
# incremental behavior: rosidl rebuilds are expensive
# ---------------------------------------------------------------------------


def test_unchanged_interfaces_are_not_rewritten(tmp_path):
    generate_interfaces(EXAMPLE_PROTO, tmp_path)
    target = tmp_path / "msg" / "Thrusters.msg"
    before = target.stat().st_mtime_ns

    generate_interfaces(EXAMPLE_PROTO, tmp_path)

    assert target.stat().st_mtime_ns == before


def test_stale_generated_interfaces_are_removed_but_handwritten_survive(tmp_path):
    generate_interfaces(EXAMPLE_PROTO, tmp_path)
    handwritten = tmp_path / "msg" / "HandWritten.msg"
    handwritten.write_text("float64 stamp\n")

    generate_interfaces(EXAMPLE_PROTO, tmp_path, include=["rov/rpc/*.proto"])

    assert not (tmp_path / "msg" / "Thrusters.msg").exists()  # no longer a target
    assert handwritten.exists()  # never ours to delete


# ---------------------------------------------------------------------------
# plain protos: the annotations are not required
# ---------------------------------------------------------------------------


def test_protos_without_the_proto4webrtc_options_work(tmp_path):
    out = gen(
        tmp_path,
        """
        syntax = "proto3";
        package app;
        message Status { double stamp = 1; }
        service Ctl { rpc Poke(Status) returns (Status); }
        """,
    )

    assert (out / "msg" / "Status.msg").exists()
    assert (out / "srv" / "Poke.srv").exists()


def test_nested_messages_flatten(tmp_path):
    out = gen(
        tmp_path,
        """
        syntax = "proto3";
        package app;
        message Mission {
          message Waypoint { double depth = 1; }
          repeated Waypoint waypoints = 1;
        }
        """,
    )

    assert (out / "msg" / "MissionWaypoint.msg").exists()
    assert "MissionWaypoint[] waypoints" in (out / "msg" / "Mission.msg").read_text()


# ---------------------------------------------------------------------------
# refusals
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body, expected",
    [
        (
            """
            syntax = "proto3";
            package app;
            message M { oneof kind { double a = 1; double b = 2; } }
            """,
            "oneof",
        ),
        (
            """
            syntax = "proto3";
            package app;
            message M { map<string, double> values = 1; }
            """,
            "map<>",
        ),
        (
            """
            syntax = "proto3";
            package app;
            message M { repeated bytes chunks = 1; }
            """,
            "repeated bytes",
        ),
        (
            """
            syntax = "proto3";
            package app;
            message M { double myField = 1; }
            """,
            "lower_snake_case",
        ),
        (
            """
            syntax = "proto3";
            package app;
            message M { double stamp = 1; }
            service S { rpc Watch(M) returns (stream M); }
            """,
            "streaming",
        ),
        # rosidl rules the generator enforces up front, so the failure names the
        # .proto to edit instead of appearing mid-`colcon build`.
        (
            """
            syntax = "proto3";
            package app;
            message M { double stamp = 1; bool class = 2; }
            """,
            "keyword",
        ),
        (
            """
            syntax = "proto3";
            package app;
            enum Mode { unspecified = 0; fast = 1; }
            message M { Mode mode = 1; }
            """,
            "UPPER_SNAKE_CASE",
        ),
        (
            """
            syntax = "proto3";
            package app;
            message my_message { double stamp = 1; }
            """,
            "CamelCase",
        ),
    ],
)
def test_unmappable_constructs_raise(tmp_path, body, expected):
    with pytest.raises(Ros2GenError, match=expected):
        gen(tmp_path, body)


def test_reference_outside_the_target_set_raises(tmp_path):
    root = tmp_path / "proto"
    write_proto(
        tmp_path,
        """
        syntax = "proto3";
        package app;
        message Inner { double depth = 1; }
        """,
        name="app/inner.proto",
    )
    write_proto(
        tmp_path,
        """
        syntax = "proto3";
        package app;
        import "app/inner.proto";
        message Outer { Inner inner = 1; }
        """,
        name="app/outer.proto",
    )

    with pytest.raises(Ros2GenError, match="not in the target set"):
        generate_interfaces(root, tmp_path / "pkg", include=["app/outer.proto"])


def test_colliding_names_raise_and_srv_prefix_service_resolves_them(tmp_path):
    body = """
        syntax = "proto3";
        package app;
        message Req { double stamp = 1; }
        message Res { bool ok = 1; }
        service A { rpc Start(Req) returns (Res); }
        service B { rpc Start(Req) returns (Res); }
        """

    with pytest.raises(Ros2GenError, match="duplicate interface srv/Start.srv"):
        gen(tmp_path, body)

    out = gen(tmp_path, body, srv_prefix_service=True)
    assert (out / "srv" / "AStart.srv").exists()
    assert (out / "srv" / "BStart.srv").exists()


def test_missing_proto_root_raises(tmp_path):
    with pytest.raises(Ros2GenError, match="proto root does not exist"):
        generate_interfaces(tmp_path / "nope", tmp_path / "pkg")


def test_no_matching_protos_raises(tmp_path):
    root = write_proto(
        tmp_path,
        """
        syntax = "proto3";
        package app;
        message M { double stamp = 1; }
        """,
    )

    with pytest.raises(Ros2GenError, match="no .proto files matched"):
        generate_interfaces(root, tmp_path / "pkg", include=["nothing/*.proto"])
