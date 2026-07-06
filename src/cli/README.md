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
termix hosts create --ip 10.0.0.5 --username root --password secret --enable-terminal
termix hosts update 3 --folder prod
termix hosts delete 3
termix exec 3 "uptime"
termix snippets list
termix snippets create --name deploy --content "docker compose up -d"
termix snippets run 7 --host 3
termix credentials list
termix alerts
termix users list          # admin
termix whoami
termix version
```

Run `termix <group> --help` for the full option list. All output is JSON, except `exec`/`snippets
run` which stream the remote stdout/stderr. `exec` exits with the remote command's exit code;
`snippets run` exits 0 when the snippet produced no stderr output and 1 otherwise (the snippet API
does not expose the real exit code). Both exit 255 on CLI/API errors.

## Scope

Stateless Termix API endpoints: hosts (full CRUD + status), command execution, snippets (CRUD),
credentials (CRUD, metadata-only reads), alerts, users and audit logs. The session-based APIs
(file manager, Docker, live metrics) are intentionally out of scope — they need connection
lifecycles that don't fit a one-shot CLI.

`hosts update` reads the current host, applies your changes and writes it back; SSH secrets are
never returned by the API, so they are preserved untouched unless you pass a new `--password` /
`--key-file`.

## Development

```sh
npm run type-check
npm test           # vitest
npm run build
```
