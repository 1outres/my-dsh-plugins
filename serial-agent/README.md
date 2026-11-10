# dsh-serial-agent

A small agent that connects network device consoles to the DeepSeek Harness
remote plugin. It runs on a client PC that has USB serial cables, dials out to
the Harness Web server, and offers the local ports to the model. The Harness
then drives those ports with the same `remote_session_*` tools it uses for SSH.

The agent never listens on a network port. The connection goes from the agent
to the Harness, so the client PC needs no open port and no port forwarding.

Ports stay open in the agent when the WebSocket drops. The agent keeps reading
into a ring buffer, so console output survives a Harness restart. A port with
no subscriber closes after `orphanTimeout`.

## Install on NixOS

Add this flake as an input and import the NixOS module.

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    my-dsh-plugins.url = "github:1outres/my-dsh-plugins";
  };

  outputs = { nixpkgs, my-dsh-plugins, ... }: {
    nixosConfigurations.lab = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        my-dsh-plugins.nixosModules.dsh-serial-agent
        {
          services.dsh-serial-agent = {
            enable = true;
            settings = {
              server = "wss://dsh.example.net/remote-serial/agent";
              allow = [ "/dev/ttyUSB*" "/dev/ttyACM*" "/dev/serial/by-id/*" ];
            };
          };
        }
      ];
    };
  };
}
```

The module runs the agent as a systemd service with a dynamic user. The user is
in the `dialout` group, so it can open the ports. The identity lives in
`/var/lib/dsh-serial-agent/identity`, and systemd sets `STATE_DIRECTORY` so the
agent finds it without an explicit `identityFile`.

The default `deviceAllow` list permits `/dev/ttyUSB*` and `/dev/ttyACM*`.
Extend it when your adapter has another name.

## Install on macOS with nix-darwin

```nix
{
  inputs.my-dsh-plugins.url = "github:1outres/my-dsh-plugins";

  outputs = { nix-darwin, my-dsh-plugins, ... }: {
    darwinConfigurations.lab-mac = nix-darwin.lib.darwinSystem {
      modules = [
        my-dsh-plugins.darwinModules.dsh-serial-agent
        {
          services.dsh-serial-agent = {
            enable = true;
            logFile = "/Users/me/Library/Logs/dsh-serial-agent.log";
            settings.server = "wss://dsh.example.net/remote-serial/agent";
          };
        }
      ];
    };
  };
}
```

The module installs a user launchd agent. The default allow list covers the
common USB serial drivers on macOS. The default `logFile` is
`/tmp/dsh-serial-agent.log` because a launchd user agent cannot write to
`/var/log`. Set `logFile` to another path the user can write, such as
`/Users/me/Library/Logs/dsh-serial-agent.log`.

## Run without installing

```sh
nix run github:1outres/my-dsh-plugins#dsh-serial-agent -- pubkey
nix run github:1outres/my-dsh-plugins#dsh-serial-agent -- run --config ./agent.json
```

The package is also available as `packages.<system>.dsh-serial-agent` and from
`overlays.default`.

## Pair the agent

1. Run `dsh-serial-agent pubkey`. It creates the identity file when it is
   missing and prints three lines:

   ```
   publicKey: <base64 of the 32 public key bytes>
   fingerprint: SHA256:<unpadded base64>
   config: {"name":"lab-mac","publicKey":"<base64>"}
   ```

2. Paste the value after `config:` into the `serialAgents` list of the Harness
   `remote` plugin settings:

   ```json
   {
     "serialAgents": [
       { "name": "lab-mac", "publicKey": "<base64>" }
     ]
   }
   ```

3. Start the agent. The log shows the same fingerprint and the config line, so
   you can compare them with the card in the Web UI.

The name is the short host name, lowercased and reduced to `[a-z0-9-]`, at most
32 characters. Change the name in the plugin settings if two machines would
get the same name.

## Config file

```json
{
  "server": "wss://dsh.example.net/remote-serial/agent",
  "identityFile": "/var/lib/dsh-serial-agent/identity",
  "allow": ["/dev/ttyUSB*", "/dev/ttyACM*", "/dev/serial/by-id/*"],
  "bufferBytes": 1048576,
  "orphanTimeout": "1h",
  "logLevel": "info"
}
```

| Key             | Default            | Meaning                                                                |
| --------------- | ------------------ | ---------------------------------------------------------------------- |
| `server`        | required           | WebSocket URL of the Harness serial gateway. `ws` or `wss` only.       |
| `identityFile`  | OS state directory | Ed25519 identity. Linux uses `$STATE_DIRECTORY` when set.              |
| `allow`         | OS specific list   | `path.Match` patterns. Absolute paths only. An empty list is an error. |
| `bufferBytes`   | `1048576`          | Bytes kept per port. 4096 to 64 MiB.                                   |
| `orphanTimeout` | `"1h"`             | Time without a subscriber before the port closes. `"0s"` is never.     |
| `logLevel`      | `"info"`           | `debug`, `info`, `warn`, or `error`. Logs go to stderr.                |

Linux default `allow`: `/dev/ttyUSB*`, `/dev/ttyACM*`, `/dev/serial/by-id/*`.

macOS default `allow`: `/dev/cu.usbserial*`, `/dev/cu.usbmodem*`,
`/dev/cu.SLAB_USBtoUART*`, `/dev/cu.wchusbserial*`.

`run` also accepts `--server` and `--identity` to override the file.

The agent warns when `server` is `ws://` and the host is not a loopback
address. In that case the WebSocket is not encrypted, so put it on a trusted
network such as a WireGuard mesh.

## Security

- The agent only dials out. It has no listening socket.
- The allow list is applied before the device is opened. The path is cleaned,
  must be absolute, must match an allow pattern, and must resolve to a
  character device. The agent also refuses allow patterns that contain `..`.
- The private key is a PKCS#8 Ed25519 key in a `0600` file. The agent refuses
  to load a key that group or others can read. The signature covers the
  gateway nonce, so a captured frame cannot be replayed.
- Use `wss://` when the network is not trusted. The key authenticates the
  agent, and TLS protects the console traffic and the signature.
- A port stays open after the WebSocket closes, and it keeps reading into its
  ring buffer. If you do not want that, set `orphanTimeout` to a small value.
  `0s` means the port never closes by itself and it is a good idea only if you
  close ports with the tools.
- One agent key can serve several Harness sessions. The gateway decides which
  session may use a port. The agent trusts the gateway.

## Limits

- macOS reports no USB vendor and product ids. Ports are found by the allow
  patterns only.
- BREAK is sent with `TIOCSBRK` and `TIOCCBRK`. Some pseudo terminals refuse
  these ioctls and the request returns `io`.

## Troubleshooting

```sh
# Which ports match the allow list?
dsh-serial-agent ports --config /etc/dsh-serial-agent/config.json

# Is the identity readable and correct?
dsh-serial-agent pubkey --identity /var/lib/dsh-serial-agent/identity
```

- **Permission denied when opening a port**: add the user to the `dialout`
  group on Linux and log in again. The NixOS module does this for its own
  service user.
- **busy**: another program holds the device. The agent opens with exclusive
  access (`TIOCEXCL`), so close the terminal program and retry.
- **The gateway closes with 4403**: the public key is not in `serialAgents`.
  Run `pubkey` again and compare the value.
- **The gateway closes with 4401**: the signature or the protocol number did
  not match. Check that both sides use protocol version 1 and that the private
  key file is the one you paired.
- **No ports listed**: check `allow` and the `ports` command. On macOS use the
  `cu.*` names, not `tty.*`.

## Development

```sh
cd serial-agent
nix develop .. -c env CGO_ENABLED=0 go test ./...
nix develop .. -c env CGO_ENABLED=0 go vet ./...
nix develop .. -c gofmt -l ./cmd ./internal
```

The tests include an integration test with a fake gateway and a real pseudo
terminal. `nix build` runs the same tests in the build sandbox.

Build the binary directly:

```sh
nix shell nixpkgs#go --command env CGO_ENABLED=0 go build -o dsh-serial-agent ./cmd/dsh-serial-agent
```

Cross builds for `linux/amd64`, `linux/arm64`, `darwin/amd64`, and
`darwin/arm64` work with `CGO_ENABLED=0`.
