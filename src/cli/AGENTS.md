# Termix CLI — agent guide

`termix` drives a [Termix](https://github.com/Termix-SSH/Termix) instance (self-hosted SSH manager)
from the command line: list SSH hosts, check their status, and run commands on them over SSH.

## Setup

Two ways to authenticate:

```sh
# Interactive (humans): stores a session token (~30 days) in ~/.config/termix/config.json
termix login

# Non-interactive (agents/CI): set env vars — they override the config file
export TERMIX_URL=https://termix.example.com
export TERMIX_TOKEN=<jwt>          # full access (get one via `termix login`, or ask the user)
# or: export TERMIX_API_KEY=tmx_…  # read-only, non-encrypted endpoints only (alerts, version)
```

Check auth state with `termix whoami`. If a command fails with HTTP 401, the session expired —
ask the user to run `termix login` again.

## Commands

All commands print JSON on stdout, except `exec` and `snippets run` which stream the remote
command's stdout/stderr directly.

| Command                                           | Description                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `termix login [--url <url>] [--username <u>]`     | Interactive login (prompts on stderr; supports TOTP).                              |
| `termix logout`                                   | Delete the stored session.                                                         |
| `termix whoami`                                   | Current user, auth method, token expiry.                                           |
| `termix hosts list [--folder <f>]`                | List SSH hosts (`{count, hosts: [{id, name, ip, port, username, folder, tags}]}`). |
| `termix hosts get <hostId>`                       | One host's config. Secrets are never printed.                                      |
| `termix hosts status [hostId]`                    | Online/offline status (all hosts, or one).                                         |
| `termix exec <hostId> <command...>`               | Run a shell command on the host over SSH.                                          |
| `termix snippets list`                            | List saved command snippets.                                                       |
| `termix snippets run <snippetId> --host <hostId>` | Run a saved snippet on a host.                                                     |
| `termix alerts`                                   | Active Termix alerts.                                                              |
| `termix version`                                  | CLI version + server health/version.                                               |

## Running commands (`exec`)

```sh
termix exec 3 "df -h /"
termix exec 3 "systemctl is-active nginx" && echo "nginx up"
```

- Remote stdout → stdout, remote stderr → stderr.
- **The exit code is the remote command's exit code** (like `ssh`). 255 means a CLI/API error
  (bad auth, host not found, connection failure) — the message is on stderr.
- Commands run non-interactively in a fresh SSH session with a **30-second server-side timeout**:
  no TTY, no stdin, no long-running processes. For anything longer, run it detached
  (`nohup … &`, `systemd-run`, etc.) and poll.
- Quote the command as a single argument to avoid shell-splitting surprises.
- The host id comes from `termix hosts list`.

`snippets run` exits 0 when the snippet produced no stderr output, 1 otherwise (the snippet API
does not expose the real exit code).

## Notes

- Everything is scoped to the authenticated Termix user: their hosts, their snippets. Host SSH
  credentials stay server-side — the CLI never sees or needs them.
- Prefer `termix hosts status` before `exec` when a host might be down.
- Output of `hosts get`/`hosts list` is an allowlisted subset of fields; passwords and keys are
  never returned.
