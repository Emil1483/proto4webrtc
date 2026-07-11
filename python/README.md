# proto4webrtc (Python)

Generates typed [mediasoup](https://mediasoup.org/) **producer** code
(pymediasoup) from protobuf messages annotated with `proto4webrtc` options.
The TypeScript **consumer** counterpart is the npm package
`protoc-gen-proto4webrtc-ts`.

```sh
pip install proto4webrtc
python -m proto4webrtc_codegen --proto path/to/protos --out out/
```

```python
from proto4webrtc_gen import Telemetry, TelemetryProducer

producer = await TelemetryProducer.create(send_transport)
producer.send(Telemetry(stamp=time.time(), value0=0.4))
```

Also installs the raw protoc plugin `protoc-gen-proto4webrtc_python`
(`--proto4webrtc_python_out`).

Full docs: https://github.com/Emil1483/proto4webrtc
