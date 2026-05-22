# interact-agent-claude

> Drive Claude Code agents on your home machine from your phone. Voice-first,
> push-to-talk, with multiple parallel agent sessions. Built so I can vibe-code
> from the beach.

This is a small self-hosted manager that runs next to your Claude Code install
and exposes a mobile-friendly web UI for spawning, watching, and talking to
Claude agents. Combined with a P2P tunnel from a tiny Oracle Cloud free-tier VM
into your home LAN, your phone gets a stable HTTPS endpoint that punches
through CGNAT / hotel Wi-Fi / your home router and lands you on a terminal that
already has `claude` logged in.

## Why

Working from a laptop on a beach / train / café / hotel bed is great until
the Wi-Fi is too flaky to actually compile anything. The fix: the heavy lifting
(builds, tests, the actual Claude session) lives on a beefy machine at home
that you trust. Your phone is just a microphone and a viewport. You speak a
prompt, Whisper transcribes it locally on the home box, Claude runs, your
phone shows the result. If the connection drops for thirty seconds, you come
back to the same session, mid-tool-call.

## Features

- **Multiple parallel agent instances.** Each one has its own working directory
  and either a raw PTY (real `claude` CLI in a terminal) or a structured SDK
  session with tool-approval prompts.
- **Push-to-talk voice input.** Holds-to-record, releases-to-send. Audio is
  streamed over WebSocket and transcribed locally with `faster-whisper` — no
  third-party speech API, no leaked prompts.
- **Mobile-first UI.** Big buttons, installable as a PWA, sane on iPhone /
  Android. ENTER / ESC / arrow / Ctrl-C buttons because mobile keyboards
  can't send those.
- **Live web preview.** Per-instance proxy so a `vite dev` running inside the
  container is reachable through the manager — handy for vibe-coding a UI
  from your phone.
- **Persisted instances.** Configs survive container restarts; you can
  relaunch a stopped session and pick up where you left off.

## Architecture

```
┌────────────┐    HTTPS / WSS    ┌──────────────────────┐    WireGuard      ┌─────────────────────┐
│  Phone     │ ────────────────► │  Oracle free-tier VM │ ────────────────► │  Home box           │
│  (browser) │                   │  (public IP, TLS)    │   reverse tunnel  │  Docker: this repo  │
└────────────┘                   └──────────────────────┘                   │  + claude CLI       │
                                                                            └─────────────────────┘
```

- The phone only ever talks to the Oracle VM over HTTPS. The Oracle box has a
  public IPv4, a Let's Encrypt cert, and a single job: forward `:443` into the
  tunnel.
- The home box dials *out* to the Oracle VM (WireGuard / Tailscale / SSH
  reverse tunnel — pick your flavor) so nothing has to be open on the home
  router. CGNAT-friendly.
- Inside the home box, this repo's `docker compose` stack exposes the manager
  on `:3456` (HTTP) and `:3457` (HTTPS, for the mic).
- The container mounts your real `~/.claude` so the agent inherits your
  logged-in session — you don't re-auth from the phone.

### Why Terraform + Oracle?

Oracle Cloud's always-free tier gives you an ARM VM with a real public IP for
$0/month. Terraforming it means the whole edge — VM, firewall rules, DNS
record, TLS cert renewal cron — is reproducible in one `terraform apply`. If
the VM ever gets nuked, you redeploy the edge in a few minutes and your home
box reconnects to it. Terraform lives in a sibling repo (link TBD).

## Stack

- **Backend**: Node 22 + TypeScript, Express, `ws`, `node-pty`, the
  [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
  `http-proxy` for the per-instance preview.
- **Speech-to-text**: `faster-whisper` running in-container, no network egress.
- **Frontend**: Vanilla JS + [xterm.js](https://xtermjs.org/) for the
  terminal panel. No framework, no build step on the FE side.
- **Runtime**: One Docker container, `docker compose up`.

## Quick start

Requirements: Docker, the `claude` CLI installed and logged in on the host.

```bash
# 1. Configure paths
cp .env.example .env
$EDITOR .env   # point CLAUDE_BINARY, CLAUDE_CONFIG, PROJECTS_ROOT at your host

# 2. Generate a TLS cert (needed for the mic on mobile browsers)
cd certs && openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=claude-manager" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"
cd ..

# 3. Build + run
./start.sh

# 4. Open in browser
#    Desktop:  http://localhost:3456
#    Phone:    https://<your-tunnel-host>:3457
```

To stop: `./stop.sh`.

## Environment variables

See `.env.example`. The important ones:

| Var | What it does |
| --- | --- |
| `MANAGER_PORT` | HTTP port for the UI. HTTPS is always `3457`. |
| `CLAUDE_BINARY` | Absolute path to the `claude` CLI on the host. |
| `CLAUDE_CONFIG` | Absolute path to `~/.claude` on the host. Mounted into the container so the agent reuses your login. |
| `PROJECTS_ROOT` | Host folder containing the projects you want agents to be able to `cd` into. |

## Repo layout

```
service/be/        Node + TS backend (WS server, instance manager, whisper bridge)
service/fe/        Static frontend (HTML/CSS/JS, no bundler)
docker/manager/    Dockerfile + entrypoint
certs/             TLS material (gitignored — see certs/README.md)
data/              Persisted instance configs (gitignored)
```

## Status

Personal project, sharp edges. Single-user; there is no auth on the manager
itself — it assumes the tunnel + TLS in front of it is the auth boundary.
Don't expose `:3456` to the public internet.

## License

MIT.
