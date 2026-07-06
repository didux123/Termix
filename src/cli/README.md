# Termix CLI

A command-line interface for [Termix](https://github.com/Termix-SSH/Termix), designed as a **thin
wrapper around the Termix HTTP API**: it reuses the API's authentication, authorization and
per-user scoping, and adds no server-side surface. Usable by humans, scripts and AI agents —
see [AGENTS.md](AGENTS.md) for the agent-facing guide.

## Install

```sh
cd src/cli
npm install
npm run build    # compiles to dist/
node dist/index.js --help
```

## Authentication

```sh
termix login     # prompts for URL, username, password (and TOTP if enabled)
```

`login` exchanges your password for a session token (~30 days) and stores `{url, token, username}`
in `~/.config/termix/config.json` (mode 0600). **The password itself is never stored** — the same
model as the Termix desktop app. When the token expires, run `termix login` again.

For scripts/CI/agents, environment variables override the config file:

| Variable                    | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `TERMIX_URL`                | Base URL of the instance.                                    |
| `TERMIX_TOKEN`              | Session JWT (full access).                                   |
| `TERMIX_API_KEY`            | API key (`tmx_…`) — read-only, non-encrypted endpoints only. |
| `TERMIX_INSECURE_TLS`       | `true` to accept self-signed certificates (test only).       |
| `TERMIX_REQUEST_TIMEOUT_MS` | Per-request timeout (default 60000).                         |

> Note: Termix API keys cannot decrypt user data (hosts, snippets, execution) — that requires a
> session token from `termix login`.

## Usage

```sh
termix hosts list
termix hosts get 3
termix hosts status
termix exec 3 "uptime"
termix snippets list
termix snippets run 7 --host 3
termix alerts
termix whoami
termix version
```

All output is JSON, except `exec`/`snippets run` which stream the remote stdout/stderr and exit
with the remote command's exit code (255 on CLI/API errors).

## Scope (v1)

Stateless Termix API endpoints only: hosts (read + status), command execution, snippets, alerts.
The session-based APIs (file manager, Docker, live metrics) are intentionally out of scope.

## Development

```sh
npm run type-check
npm test           # vitest
npm run build
```
