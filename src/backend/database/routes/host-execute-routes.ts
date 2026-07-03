import type { Request, RequestHandler, Response, Router } from "express";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { sshLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import { resolveHostAuth, runCommandOnHost } from "../../ssh/ssh-exec.js";

interface HostExecuteRoutesDeps {
  authenticateJWT: RequestHandler;
  requireDataAccess: RequestHandler;
}

/** Hard ceiling on the client-supplied command timeout. */
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export function registerHostExecuteRoutes(
  router: Router,
  { authenticateJWT, requireDataAccess }: HostExecuteRoutesDeps,
): void {
  /**
   * @openapi
   * /host/execute:
   *   post:
   *     summary: Execute a command on an SSH host
   *     description: >
   *       Runs a single non-interactive command on the target host over a fresh
   *       SSH connection and returns its stdout, stderr and exit code. The host's
   *       stored credentials (or its linked shared credential) are decrypted
   *       server-side, so the caller only needs to reference the host by id.
   *       Every invocation is recorded in the audit log.
   *     tags:
   *       - Hosts
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - hostId
   *               - command
   *             properties:
   *               hostId:
   *                 type: integer
   *                 description: ID of the SSH host to run the command on.
   *               command:
   *                 type: string
   *                 description: The shell command to execute.
   *               timeout:
   *                 type: integer
   *                 description: >
   *                   Optional timeout in milliseconds (default 30000, capped at
   *                   600000).
   *     responses:
   *       200:
   *         description: Command completed (check exitCode for the process result).
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   description: True when the process exited with code 0.
   *                 output:
   *                   type: string
   *                   description: Captured stdout (may be truncated).
   *                 stderr:
   *                   type: string
   *                   description: Captured stderr (may be truncated).
   *                 exitCode:
   *                   type: integer
   *                   nullable: true
   *                   description: Process exit code (null if terminated by signal).
   *                 truncated:
   *                   type: boolean
   *                   description: True when stdout/stderr were truncated.
   *       400:
   *         description: Invalid input.
   *       404:
   *         description: Host not found.
   *       500:
   *         description: Failed to execute the command (connection/auth/timeout).
   */
  router.post(
    "/execute",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, command, timeout } = req.body;

      // Strict integer validation — parseInt("12abc") would silently accept
      // malformed input.
      const parsedHostId = Number(hostId);
      if (!userId || !Number.isInteger(parsedHostId)) {
        return res.status(400).json({ error: "Valid hostId is required" });
      }
      if (typeof command !== "string" || command.trim().length === 0) {
        return res.status(400).json({ error: "command is required" });
      }

      const timeoutMs =
        typeof timeout === "number" && timeout > 0
          ? Math.min(timeout, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;

      const { ipAddress, userAgent } = getRequestMeta(req);
      const actor = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const username = actor[0]?.username ?? userId;

      try {
        const auth = await resolveHostAuth(parsedHostId, userId);
        if (!auth) {
          await logAudit({
            userId,
            username,
            action: "execute_command",
            resourceType: "host",
            resourceId: String(parsedHostId),
            success: false,
            errorMessage: "Host not found",
            ipAddress,
            userAgent,
          });
          return res.status(404).json({ error: "Host not found" });
        }

        const result = await runCommandOnHost(auth, command, timeoutMs);

        sshLogger.success(`Command executed on host ${parsedHostId}`, {
          operation: "host_execute_success",
          userId,
          hostId: parsedHostId,
          exitCode: result.exitCode,
        });

        // Audit the most privileged action in the product. The command is
        // recorded (truncated) so admins can see what ran; note this may contain
        // sensitive arguments.
        await logAudit({
          userId,
          username,
          action: "execute_command",
          resourceType: "host",
          resourceId: String(parsedHostId),
          details: `exit=${result.exitCode}; cmd=${command.slice(0, 200)}`,
          success: result.success,
          ipAddress,
          userAgent,
        });

        res.json(result);
      } catch (error) {
        sshLogger.error("Failed to execute command on host", error, {
          operation: "host_execute_failed",
          userId,
          hostId: parsedHostId,
        });
        await logAudit({
          userId,
          username,
          action: "execute_command",
          resourceType: "host",
          resourceId: String(parsedHostId),
          details: `cmd=${command.slice(0, 200)}`,
          success: false,
          errorMessage:
            error instanceof Error ? error.message : "execution failed",
          ipAddress,
          userAgent,
        });
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to execute command",
        });
      }
    },
  );
}
