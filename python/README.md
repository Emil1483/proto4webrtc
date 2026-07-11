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
from proto4webrtc_gen import Proto4WebrtcProducer, Telemetry

client = Proto4WebrtcProducer(signaling_url="ws://localhost:3000/api/sfu")
client.run_forever()  # blocking: connects, reconnects on drop, until stop()

client.telemetry.send(Telemetry(stamp=time.time(), value0=0.4))
```

`Proto4WebrtcProducer` owns the whole client — signaling, device/transport
setup, and the reconnect loop. `send()`/`push()` are safe to call from any
thread, anytime (a no-op before the first connection).

Also installs the raw protoc plugin `protoc-gen-proto4webrtc_python`
(`--proto4webrtc_python_out`).

Full docs: https://github.com/Emil1483/proto4webrtc
