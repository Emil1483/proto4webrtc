# proto4webrtc-codegen

Generates typed [mediasoup](https://mediasoup.org/) **producer** code
(pymediasoup) from protobuf messages annotated with `proto4webrtc` options.
The generated code runs on the `proto4webrtc` pip package (the runtime),
which this distribution deliberately does not depend on — generate at build
time, ship only the runtime:

```sh
pip install proto4webrtc[compiler]   # runtime + this generator
python -m proto4webrtc_codegen --proto path/to/protos --out out/
```

Writes `proto4webrtc_gen/producers.py` under `--out` (plus an `__init__.py`
re-export). `proto4webrtc/options.proto` is bundled, so your proto root only
needs to import it.

Also installs the raw protoc plugin `protoc-gen-proto4webrtc_python`
(`--proto4webrtc_python_out`).

Full docs: https://github.com/Emil1483/proto4webrtc
