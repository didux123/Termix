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
command's stdout/stderr directly. Run `termix <group> --help` for the full option list.

**Hosts**

| Command                                                                                    | Description                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `termix hosts list [--folder <f>]`                                                         | List SSH hosts (`{count, hosts: [...]}`).                    |
| `termix hosts get <hostId>`                                                                | One host's config. Secrets are never printed.                |
| `termix hosts status [hostId]`                                                             | Online/offline status (all hosts, or one).                   |
| `termix hosts create --ip <ip> --username <u> [--password <p> \| --key-file <path>] [...]` | Create a host.                                               |
| `termix hosts update <hostId> [--name <n>] [...]`                                          | Update a host (only the fields you pass; secrets preserved). |
| `termix hosts delete <hostId>`                                                             | Delete a host.                                               |

**Command execution**

| Command                                                                    | Description                               |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| `termix exec <hostId> <command...>`                                        | Run a shell command on the host over SSH. |
| `termix snippets list`                                                     | List saved snippets.                      |
| `termix snippets run <snippetId> --host <hostId>`                          | Run a saved snippet on a host.            |
| `termix snippets create --name <n> --content <c>`                          | Create a snippet.                         |
| `termix snippets update <snippetId> [...]` / `snippets delete <snippetId>` | Update / delete a snippet.                |

**Credentials, alerts, admin**

| Command                                                                  | Description                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `termix credentials list / get / create / update / delete`               | Manage saved SSH credentials (metadata only; secrets never printed). |
| `termix alerts [list]` / `alerts dismiss <id>` / `alerts undismiss <id>` | List and dismiss alerts.                                             |
| `termix users list`                                                      | List user accounts (admin; 403 otherwise).                           |
| `termix audit-logs [--limit <n>] [--action <a>]`                         | Audit-log entries (admin; 403 otherwise).                            |

**Session**

| Command                                       | Description                                           |
| --------------------------------------------- | ----------------------------------------------------- |
| `termix login [--url <url>] [--username <u>]` | Interactive login (prompts on stderr; supports TOTP). |
| `termix logout` / `termix whoami`             | Clear the session / show current user + token expiry. |
| `termix version`                              | CLI version + server health/version.                  |

For destructive commands (`hosts delete`, `credentials delete`, `snippets delete`), the caller is
responsible for confirmation — they act immediately with no prompt so they stay scriptable.

## Running commands (`exec`)

```sh
termix exec 3 "df -h /"
termix exec 3 "systemctl is-active nginx" && echo "nginx up"
```

- Remote stdout → stdout, remote stderr → stderr.
- **The exit code is the remote command's exit code** (like `ssh`). 255 means a CLI/API error
  (bad auth, host not found, connection failure) — the message is on stderr.
- Each call runs non-interactively in a **fresh** SSH session with a **30-second server-side
  timeout**: no TTY, no stdin, nothing persists between calls. Treat `exec` as short and synchronous.
- **Long-running / persistent work:** a plain `nohup … &` is unreliable — the process is tied to the
  exec session and usually does not survive it, and backgrounding a process that keeps the channel
  open can make the call hang until it times out (redirect all fds: `>/tmp/x.log 2>&1`). For a service
  that must outlive the call, detach at the OS level instead: `docker run -d …`, `systemd-run --unit …`,
  or a systemd unit — these are managed by the host, not the SSH session, and survive. Then poll with a
  separate `exec`.
- **Container images:** a `docker run` that has to pull a missing image can exceed the 30-second
  timeout — pre-pull, or rely on already-cached images.
- Polling tip: don't `pgrep`/`grep` for a string that also appears in your own command line (it matches
  itself). Check the real signal instead (a listening port, `docker ps`, an HTTP response).
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
