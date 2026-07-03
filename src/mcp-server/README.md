<div align="center">

<h1>Termix MCP Server</h1>

<p>Model Context Protocol server for Termix — drive your servers from an AI assistant</p>

<p>
  <img src="https://img.shields.io/badge/MCP-server-F39044?style=flat&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.12-F39044?style=flat&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/TypeScript-ESM-F39044?style=flat&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/Transport-stdio-F39044?style=flat&labelColor=1a1a1a" />
</p>

</div>

<br />

## Overview

The Termix MCP Server exposes a [Termix](https://github.com/Termix-SSH/Termix) instance to
[Model Context Protocol](https://modelcontextprotocol.io) clients such as Claude Code and Claude
Desktop. It lets an AI assistant list and manage your SSH hosts, run commands, browse and edit files
over SFTP, read live host metrics, and control Docker containers — all through Termix's existing API
and permission model.

It talks to Termix over HTTP with `axios` and is fully self-contained (its own `package.json` and
`node_modules`), so it runs alongside Termix or as a standalone package.

<br />

## Features

<table>
<tr>
<td width="50%" valign="top">

**Host management:**
List, inspect, create, update and delete SSH hosts. Secrets are never returned through the server.

</td>
<td width="50%" valign="top">

**Command execution:**
Run one-off shell commands or saved snippets on any host and get back stdout, stderr and exit code.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**File manager (SFTP):**
List, read, write, create, rename, move and delete files. Sessions are pooled per host and kept
alive transparently.

</td>
<td width="50%" valign="top">

**Monitoring & Docker:**
Live CPU / memory / disk / network metrics, alerts, audit logs, and Docker container list / start /
stop / logs.

</td>
</tr>
</table>

<br />

## Requirements

- Node.js ≥ 22.12
- A running Termix instance reachable over HTTP(S)
- Termix credentials: an API key and/or a username + password (see [Authentication](#authentication))

> **Note:** the `run_command` tool relies on the `POST /host/execute` endpoint. If your Termix build
> does not include it, use `execute_snippet` instead.

<br />

## Installation

```sh
cd src/mcp-server
npm install
npm run build      # compiles to dist/
```

<br />

## Configuration

Configuration is read from environment variables:

| Variable                    | Required  | Description                                                                                                |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `TERMIX_URL`                | yes       | Base URL of the instance (the nginx entrypoint, e.g. `https://termix.example.com`) — not an internal port. |
| `TERMIX_API_KEY`            | see below | API key (`tmx_…`) for read-only, non-encrypted endpoints.                                                  |
| `TERMIX_USERNAME`           | see below | Username for JWT login (required for encrypted-data operations).                                           |
| `TERMIX_PASSWORD`           | see below | Password for the above user.                                                                               |
| `TERMIX_TOTP_CODE`          | no        | Reserved; accounts with TOTP are not yet supported.                                                        |
| `TERMIX_INSECURE_TLS`       | no        | `true` to accept self-signed certificates (test only).                                                     |
| `TERMIX_REQUEST_TIMEOUT_MS` | no        | Per-request timeout (default `60000`).                                                                     |

At least one authentication method is required. To cover **every** tool (command execution,
host/credential access, file manager, metrics), configure `TERMIX_USERNAME` + `TERMIX_PASSWORD`.

<br />

## Authentication

Termix encrypts each user's sensitive data (host secrets, credentials) with a key derived from their
password and held in memory after login. Two consequences shape this server's hybrid auth:

- **API key** authenticates identity and is enough for read-only, non-encrypted endpoints (alerts,
  audit logs, user list).
- **Encrypted-data operations** (listing/reading hosts, credentials, running commands, file manager,
  metrics) require a **JWT obtained by logging in with a username + password**. The server logs in on
  demand — sending the `X-Electron-App: true` header so Termix returns the token — caches the JWT,
  refreshes it before expiry, and retries once on a `401`.

If only an API key is configured, encrypted-data tools are attempted with it and fail cleanly if the
account's data is locked.

> **TOTP:** accounts with TOTP enabled are not yet supported — use an account without TOTP, or an API
> key for the read-only subset.

> **Use a dedicated, least-privilege account.** The `TERMIX_PASSWORD` (and API key) live in plaintext
> in your MCP client's configuration. Create a Termix account scoped to only the hosts and permissions
> the assistant needs — not your admin account — so a leaked config file limits the blast radius.

<br />

## Registering with a client

```sh
claude mcp add termix -- node /absolute/path/to/src/mcp-server/dist/index.js
```

Or configure it directly in your client:

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

<br />

## Tools

| Tool                                          | Description                                     | Auth    |
| --------------------------------------------- | ----------------------------------------------- | ------- |
| `list_hosts`                                  | List SSH hosts (optional folder filter).        | login   |
| `get_host`                                    | Get one host's config (secrets stripped).       | login   |
| `get_host_metrics`                            | Live CPU/memory/disk/uptime/network for a host. | login   |
| `list_alerts`                                 | Active Termix alerts.                           | api key |
| `get_audit_logs`                              | Audit-log entries (admin only).                 | api key |
| `list_snippets`                               | Saved command snippets.                         | api key |
| `execute_snippet`                             | Run a saved snippet on a host. ⚠️               | login   |
| `run_command`                                 | Run a shell command on a host. ⚠️               | login   |
| `fm_list` / `fm_read`                         | List a directory / read a file (SFTP).          | login   |
| `fm_write` / `fm_create`                      | Write a file / create a file or folder. ⚠️      | login   |
| `fm_delete` / `fm_rename` / `fm_move`         | Delete / rename / move. ⚠️                      | login   |
| `create_host` / `update_host` / `delete_host` | Manage hosts. ⚠️(delete)                        | login   |
| `list_credentials`                            | SSH credential metadata (no secrets).           | login   |
| `docker_list` / `docker_logs`                 | List containers / read logs.                    | api key |
| `docker_start` / `docker_stop`                | Start / stop a container. ⚠️(stop)              | api key |
| `list_users`                                  | List user accounts (admin).                     | api key |

⚠️ = carries destructive/open-world annotations so clients can prompt for confirmation.
"login" = requires `TERMIX_USERNAME` + `TERMIX_PASSWORD`.

<br />

## Notes

- **Host-key trust:** command execution and metrics follow Termix's server-side behaviour, which
  auto-accepts unknown host keys on these non-interactive paths.
- **File-manager / Docker sessions** are pooled per host (lazy connect, keepalive, idle close,
  transparent reconnect) — invisible to the tools.
- **Logs** go to stderr; stdout is reserved for the MCP protocol.

<br />

## Development

```sh
npm run type-check
npm test           # vitest
npm run build
```

<br />

## Architecture

```
src/mcp-server/
├── src/
│   ├── index.ts            # stdio entrypoint (McpServer + StdioServerTransport)
│   ├── config.ts           # env configuration (zod)
│   ├── client/
│   │   ├── http.ts         # axios wrapper + auth attach + error mapping
│   │   ├── auth.ts         # hybrid API-key / JWT-login manager
│   │   ├── session-pool.ts # generic pooled SSH sessions
│   │   └── fm-session.ts   # file-manager session pool
│   ├── tools/              # monitoring, exec, files, docker, hosts
│   └── util/               # logger (stderr), result helpers
└── test/                   # vitest
```
