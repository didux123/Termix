# Termix MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
a [Termix](https://github.com/Termix-SSH/Termix) instance to MCP clients such as
Claude Code and Claude Desktop. It talks to the Termix HTTP API over `axios` and
is fully self-contained (its own `package.json` / `node_modules`), so it can run
alongside Termix or be extracted into a standalone package.

## Requirements

- Node.js ≥ 22.12
- A running Termix instance reachable over HTTP(S)
- Termix credentials: an API key and/or a username + password (see
  [Authentication](#authentication))

## Install & build

```sh
cd src/mcp-server
npm install
npm run build      # compiles to dist/
```

## Configuration

Configuration is read from environment variables:

| Variable | Required | Description |
|---|---|---|
| `TERMIX_URL` | yes | Base URL of the instance (the nginx entrypoint, e.g. `https://termix.example.com`) — not an internal port. |
| `TERMIX_API_KEY` | see below | API key (`tmx_…`) for read-only, non-encrypted endpoints. |
| `TERMIX_USERNAME` | see below | Username for JWT login (required for encrypted-data operations). |
| `TERMIX_PASSWORD` | see below | Password for the above user. |
| `TERMIX_TOTP_CODE` | no | Reserved; accounts with TOTP are not yet supported. |
| `TERMIX_INSECURE_TLS` | no | `true` to accept self-signed certificates (test only). |
| `TERMIX_REQUEST_TIMEOUT_MS` | no | Per-request timeout (default `60000`). |

At least one authentication method is required. To cover **every** tool
(command execution, host/credential access, file manager, metrics), configure
`TERMIX_USERNAME` + `TERMIX_PASSWORD` — see below.

## Authentication

Termix encrypts each user's sensitive data (host secrets, credentials) with a
key derived from their password and held in memory after login. Two consequences
shape this server's hybrid auth:

- **API key** authenticates identity and is enough for read-only,
  non-encrypted endpoints (alerts, audit logs, user list).
- **Encrypted-data operations** (listing/reading hosts, credentials, running
  commands, file manager, metrics) require a **JWT obtained by logging in with a
  username + password**. The server logs in on demand — sending the
  `X-Electron-App: true` header so Termix returns the token — caches the JWT,
  refreshes it before expiry, and retries once on a `401`.

If only an API key is configured, encrypted-data tools are attempted with it and
will fail cleanly if the account's data is locked.

> **TOTP:** accounts with TOTP enabled are not yet supported — use an account
> without TOTP, or an API key for the read-only subset.

## Registering with a client

```sh
claude mcp add termix -- node /absolute/path/to/src/mcp-server/dist/index.js
```

Provide the environment variables in your client's MCP configuration, e.g.:

```json
{
  "mcpServers": {
    "termix": {
      "command": "node",
      "args": ["/absolute/path/to/src/mcp-server/dist/index.js"],
      "env": {
        "TERMIX_URL": "https://termix.example.com",
        "TERMIX_USERNAME": "you",
        "TERMIX_PASSWORD": "your-password"
      }
    }
  }
}
```

## Tools

| Tool | Description | Auth |
|---|---|---|
| `list_hosts` | List SSH hosts (optional folder filter). | login |
| `get_host` | Get one host's config (secrets stripped). | login |
| `get_host_metrics` | Live CPU/memory/disk/uptime/network for a host. | login |
| `list_alerts` | Active Termix alerts. | api key |
| `get_audit_logs` | Audit-log entries (admin only). | api key |
| `list_snippets` | Saved command snippets. | api key |
| `execute_snippet` | Run a saved snippet on a host. ⚠️ | login |
| `run_command` | Run a shell command on a host. ⚠️ | login |
| `fm_list` / `fm_read` | List a directory / read a file (SFTP). | login |
| `fm_write` / `fm_create` | Write a file / create a file or folder. ⚠️ | login |
| `fm_delete` / `fm_rename` / `fm_move` | Delete / rename / move. ⚠️ | login |
| `create_host` / `update_host` / `delete_host` | Manage hosts. ⚠️(delete) | login |
| `list_credentials` | SSH credential metadata (no secrets). | login |
| `docker_list` / `docker_logs` | List containers / read logs. | api key |
| `docker_start` / `docker_stop` | Start / stop a container. ⚠️(stop) | api key |
| `list_users` | List user accounts (admin). | api key |

⚠️ = carries destructive/open-world annotations so clients can prompt for
confirmation. "login" = requires `TERMIX_USERNAME` + `TERMIX_PASSWORD`.

## Notes

- **`run_command`** uses the `POST /host/execute` backend endpoint added in this
  fork. Against an unpatched Termix, use `execute_snippet` instead.
- **Host-key trust:** command execution and metrics follow Termix's server-side
  behaviour, which auto-accepts unknown host keys on these non-interactive
  paths.
- **File-manager / Docker sessions** are pooled per host (lazy connect,
  keepalive, idle close, transparent reconnect) — invisible to the tools.

## Development

```sh
npm run type-check
npm test           # vitest
npm run build
```
