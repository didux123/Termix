import { Client } from "ssh2";
import { and, eq } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { applyAgentAuth } from "./terminal-auth-helpers.js";

/**
 * Resolved SSH authentication material for a single host, after decrypting the
 * host record and (optionally) its linked shared credential.
 */
export interface HostAuth {
  ip: string;
  port: number;
  username: string;
  authType?: string | null;
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  terminalConfig?: Record<string, unknown> | string | undefined;
}

/**
 * Result of running a single non-interactive command over SSH. Unlike the
 * legacy snippet-execution response, `success` reflects the real process exit
 * code (0 = success) and stderr is reported separately from stdout.
 */
export interface CommandResult {
  success: boolean;
  output: string;
  stderr: string;
  exitCode: number | null;
  /** True when stdout and/or stderr were truncated at MAX_OUTPUT_BYTES. */
  truncated: boolean;
}

/**
 * Upper bound on captured stdout+stderr for a single command. Prevents an
 * authenticated user from exhausting backend memory with an unbounded producer
 * (e.g. `yes`). Anything past this is dropped and `truncated` is set.
 */
const MAX_OUTPUT_BYTES = 5_000_000;

/**
 * Resolve and decrypt the SSH auth material for a host owned by `userId`.
 * Returns null when the host does not exist or is not owned by the user.
 *
 * When the host references a shared credential (`credentialId`), the credential
 * values take precedence over any inline host secrets, mirroring the behaviour
 * of the interactive terminal and snippet-execution paths.
 */
export async function resolveHostAuth(
  hostId: number,
  userId: string,
): Promise<HostAuth | null> {
  const hostResult = await SimpleDBOps.select(
    db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId))),
    "ssh_data",
    userId,
  );

  if (hostResult.length === 0) {
    return null;
  }

  const host = hostResult[0];

  let password = host.password as string | null | undefined;
  let privateKey = host.key as string | null | undefined;
  let passphrase = host.keyPassword as string | null | undefined;
  let authType = host.authType as string | null | undefined;

  if (host.credentialId) {
    const credResult = await SimpleDBOps.select(
      db
        .select()
        .from(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, host.credentialId as number),
            eq(sshCredentials.userId, userId),
          ),
        ),
      "ssh_credentials",
      userId,
    );

    if (credResult.length > 0) {
      const cred = credResult[0];
      authType = (cred.authType || authType) as string;
      password = (cred.password || undefined) as string | undefined;
      privateKey = (cred.privateKey || cred.key || undefined) as
        | string
        | undefined;
      passphrase = (cred.keyPassword || undefined) as string | undefined;
    }
  }

  return {
    ip: host.ip as string,
    port: host.port as number,
    username: host.username as string,
    authType,
    password,
    privateKey,
    passphrase,
    terminalConfig: host.terminalConfig as
      | Record<string, unknown>
      | string
      | undefined,
  };
}

/**
 * Run a single command on a host over a fresh SSH connection and resolve with
 * its stdout, stderr and exit code. The connection is always closed before the
 * promise settles. Rejects on connection/auth failure or timeout.
 *
 * The ssh2 configuration (algorithms, keepalive, locale env) is intentionally
 * identical to the interactive terminal and snippet paths so that behaviour is
 * consistent across every execution surface.
 */
export async function runCommandOnHost(
  auth: HostAuth,
  command: string,
  timeoutMs = 30000,
): Promise<CommandResult> {
  const conn = new Client();
  let output = "";
  let errorOutput = "";
  let truncated = false;

  // Append to a capped buffer; once the combined size limit is reached we stop
  // accumulating and flag the result as truncated.
  const appendCapped = (current: string, chunk: string): string => {
    if (truncated) return current;
    const remaining = MAX_OUTPUT_BYTES - (output.length + errorOutput.length);
    if (remaining <= 0) {
      truncated = true;
      return current;
    }
    if (chunk.length > remaining) {
      truncated = true;
      return current + chunk.slice(0, remaining);
    }
    return current + chunk;
  };

  /* eslint-disable no-async-promise-executor */
  return new Promise<CommandResult>(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      conn.end();
      reject(
        new Error(
          `Command execution timeout (${Math.round(timeoutMs / 1000)}s)`,
        ),
      );
    }, timeoutMs);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          return reject(err);
        }

        stream.on("close", (code: number | null) => {
          clearTimeout(timeout);
          conn.end();
          resolve({
            // A null exit code means the process was killed by a signal, which
            // is a failure — not a success.
            success: code === 0,
            output,
            stderr: errorOutput,
            exitCode: code ?? null,
            truncated,
          });
        });

        stream.on("data", (data: Buffer) => {
          output = appendCapped(output, data.toString());
        });

        stream.stderr.on("data", (data: Buffer) => {
          errorOutput = appendCapped(errorOutput, data.toString());
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      conn.end();
      reject(err);
    });

    const config: Record<string, unknown> = {
      host: auth.ip,
      port: auth.port,
      username: auth.username,
      tryKeyboard: true,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 30000,
      tcpKeepAlive: true,
      tcpKeepAliveInitialDelay: 30000,
      timeout: 30000,
      env: {
        TERM: "xterm-256color",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        LC_CTYPE: "en_US.UTF-8",
        LC_MESSAGES: "en_US.UTF-8",
        LC_MONETARY: "en_US.UTF-8",
        LC_NUMERIC: "en_US.UTF-8",
        LC_TIME: "en_US.UTF-8",
        LC_COLLATE: "en_US.UTF-8",
        COLORTERM: "truecolor",
      },
      algorithms: {
        kex: [
          "curve25519-sha256",
          "curve25519-sha256@libssh.org",
          "ecdh-sha2-nistp521",
          "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp256",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group-exchange-sha1",
          "diffie-hellman-group1-sha1",
        ],
        serverHostKey: [
          "ssh-ed25519",
          "ecdsa-sha2-nistp521",
          "ecdsa-sha2-nistp384",
          "ecdsa-sha2-nistp256",
          "rsa-sha2-512",
          "rsa-sha2-256",
          "ssh-rsa",
          "ssh-dss",
        ],
        cipher: SSH_ALGORITHMS.cipher,
        hmac: [
          "hmac-sha2-512-etm@openssh.com",
          "hmac-sha2-256-etm@openssh.com",
          "hmac-sha2-512",
          "hmac-sha2-256",
          "hmac-sha1",
          "hmac-md5",
        ],
        compress: ["none", "zlib@openssh.com", "zlib"],
      },
    };

    const authType = auth.authType;
    const password = auth.password;
    const privateKey = auth.privateKey;
    const passphrase = auth.passphrase;

    if (authType === "password" && password) {
      config.password = password;
    } else if (authType === "key" && privateKey) {
      const cleanKey = privateKey
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      config.privateKey = Buffer.from(cleanKey, "utf8");
      if (passphrase) {
        config.passphrase = passphrase;
      }
    } else if (authType === "agent") {
      const result = await applyAgentAuth(config, auth.terminalConfig);
      if ("error" in result) {
        clearTimeout(timeout);
        return reject(new Error(result.error));
      }
    } else if (password) {
      config.password = password;
    } else if (privateKey) {
      const cleanKey = privateKey
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      config.privateKey = Buffer.from(cleanKey, "utf8");
      if (passphrase) {
        config.passphrase = passphrase;
      }
    }

    conn.connect(config);
  });
  /* eslint-enable no-async-promise-executor */
}
