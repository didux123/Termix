import type { TermixClient } from "./http.js";
import { SshSessionPool } from "./session-pool.js";

/**
 * File-manager session pool. Connect needs the host's ip/port/username in
 * addition to the host id (Termix resolves and decrypts the secret material
 * server-side from the host id).
 */
export class FileManagerSessionPool extends SshSessionPool {
  constructor(client: TermixClient) {
    super(client, {
      label: "file-manager",
      sessionPrefix: "mcp-fm",
      connectPath: "/ssh/file_manager/ssh/connect",
      keepalivePath: "/ssh/file_manager/ssh/keepalive",
      disconnectPath: "/ssh/file_manager/ssh/disconnect",
      buildConnectExtra: async (hostId, c) => {
        const host = await c.request<{
          ip: string;
          port: number;
          username: string;
        }>({
          method: "GET",
          path: `/host/db/host/${hostId}`,
          requiresData: true,
        });
        return { ip: host.ip, port: host.port, username: host.username };
      },
    });
  }
}
