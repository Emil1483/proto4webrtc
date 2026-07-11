"""Shared identifier naming used by extraction (validation) and rendering."""

import re

_BOUNDARY_1 = re.compile(r"(.)([A-Z][a-z]+)")
_BOUNDARY_2 = re.compile(r"([a-z0-9])([A-Z])")


def to_snake_case(name: str) -> str:
    """CamelCase message name -> snake_case attribute name, e.g. CameraStream -> camera_stream."""
    s1 = _BOUNDARY_1.sub(r"\1_\2", name)
    return _BOUNDARY_2.sub(r"\1_\2", s1).lower()
