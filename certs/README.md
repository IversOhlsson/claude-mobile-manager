# TLS certs

HTTPS is required so a mobile browser will grant microphone access (voice
input). The backend looks for `cert.pem` and `key.pem` in this folder and
serves HTTPS on port `3457` if both exist.

Generate a self-signed pair for local / LAN use:

```bash
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=claude-manager" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"
```

For real remote access, put a proper cert here (Let's Encrypt via the
tunnel host, or a cert minted by your own CA). Anything in this folder
matching `*.pem` / `*.key` is gitignored.
