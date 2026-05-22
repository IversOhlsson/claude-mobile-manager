# claude-mobile-manager

> Drive Claude Code agents on your home machine from your phone. Voice-first,
> multi-session, built so I can vibe-code from the beach.

A self-hosted manager that runs next to your `claude` install and exposes a
mobile web UI for spawning and talking to agents. Pair it with a [Nebula](https://github.com/slackhq/nebula)
overlay terminating on an Oracle Cloud free-tier VM and your phone gets a
stable HTTPS endpoint that punches through CGNAT and lands on a terminal
that already has `claude` logged in.

## Features

- **Parallel agent sessions** — raw PTY (real `claude` CLI) or structured SDK
  mode with tool-approval prompts. Each session has its own working dir.
- **Push-to-talk voice** — hold to record, release to send. Transcribed
  locally with `faster-whisper`; no third-party speech API.
- **Mobile-first UI** — installable PWA, big buttons, ENTER/ESC/arrow keys
  exposed for mobile keyboards.
- **Live per-instance web preview** — proxy a `vite dev` running in the
  container straight to your phone.
- **Persisted instances** — configs survive restarts; relaunch a stopped
  session.

## Architecture

```
┌────────┐  HTTPS  ┌──────────────────────┐   Nebula overlay   ┌──────────────────┐
│ Phone  │ ──────► │ Oracle free-tier VM  │ ─────────────────► │ Home box         │
│        │         │ (lighthouse + TLS)   │                    │ Docker: this app │
└────────┘         └──────────────────────┘                    └──────────────────┘
```

Phone → Oracle VM over HTTPS. Both home box and phone are Nebula nodes; the
Oracle VM is the lighthouse with the public IP. Nothing has to be open on the
home router — both ends dial *out* to the lighthouse and Nebula brokers a
direct P2P tunnel between them (CGNAT-friendly).

The Oracle VM is provisioned with Terraform so the whole edge — VM, firewall,
DNS, TLS cert renewal — is one `terraform apply`. (Terraform lives in a
sibling repo, link TBD.)

## Stack

Node 22 + TypeScript backend (Express, `ws`, `node-pty`,
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
`http-proxy`). `faster-whisper` for STT, in-container. Vanilla JS frontend
with [xterm.js](https://xtermjs.org/). One Docker container.

## Quick start

Requires Docker and the `claude` CLI logged in on the host.

```bash
cp .env.example .env
$EDITOR .env   # CLAUDE_BINARY, CLAUDE_CONFIG, PROJECTS_ROOT

# TLS cert (needed for the mic on mobile browsers)
cd certs && openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=claude-manager" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"
cd ..

./start.sh   # http://localhost:3456  ·  https://<host>:3457
```

## Status

Single-user, no auth on the manager itself — the tunnel + TLS in front of
it is the auth boundary. Don't expose `:3456` to the public internet.

MIT.
