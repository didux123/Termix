import type { Command } from "commander";
import { resolveConfig } from "../core/config.js";
import { TermixClient } from "../core/http.js";
import { printJson, run } from "../core/output.js";

/**
 * Non-secret host fields safe to print. An allowlist (vs deleting known secret
 * keys) guarantees that any future secret field added by the backend cannot
 * leak by default. Note: list/get responses carry secrets encrypted, but the
 * CLI still never prints them.
 */
const SAFE_HOST_FIELDS = [
  "id",
  "name",
  "ip",
  "port",
  "username",
  "connectionType",
  "authType",
  "folder",
  "tags",
  "pin",
  "credentialId",
  "enableTerminal",
  "enableTunnel",
  "enableFileManager",
  "enableDocker",
  "createdAt",
  "updatedAt",
] as const;

function sanitiseHost(host: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SAFE_HOST_FIELDS) {
    if (key in host) out[key] = host[key];
  }
  return out;
}

/** Compact summary used by `hosts list`. */
function summariseHost(host: Record<string, unknown>): Record<string, unknown> {
  return {
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    username: host.username,
    authType: host.authType,
    folder: host.folder ?? null,
    tags: host.tags,
  };
}

export function registerHostCommands(program: Command): void {
  const hosts = program
    .command("hosts")
    .description("Inspect the SSH hosts configured in Termix.");

  hosts
    .command("list")
    .description("List hosts (id, name, ip, port, username, folder, tags).")
    .option("--folder <folder>", "Only hosts in this folder")
    .action(async (opts: { folder?: string }) =>
      run(async () => {
        const client = new TermixClient(resolveConfig());
        const all = await client.request<Array<Record<string, unknown>>>({
          method: "GET",
          path: "/host/db/host",
        });
        let summaries = all.map(summariseHost);
        if (opts.folder) {
          summaries = summaries.filter((h) => h.folder === opts.folder);
        }
        printJson({ count: summaries.length, hosts: summaries });
      }),
    );

  hosts
    .command("get <hostId>")
    .description("Show one host's configuration (secrets are never printed).")
    .action(async (hostId: string) =>
      run(async () => {
        const client = new TermixClient(resolveConfig());
        const host = await client.request<Record<string, unknown>>({
          method: "GET",
          path: `/host/db/host/${parseId(hostId)}`,
        });
        printJson(sanitiseHost(host));
      }),
    );

  hosts
    .command("status [hostId]")
    .description("Online/offline status for all hosts, or a single host by id.")
    .action(async (hostId?: string) =>
      run(async () => {
        const client = new TermixClient(resolveConfig());
        const path = hostId ? `/status/${parseId(hostId)}` : "/status";
        const status = await client.request({ method: "GET", path });
        printJson(status);
      }),
    );
}

export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid id: "${value}" (expected a positive integer).`);
  }
  return id;
}
