import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { resolveConfig } from "../core/config.js";
import { TermixClient } from "../core/http.js";
import { fail, printJson, run } from "../core/output.js";
import { parseId } from "./hosts.js";

const EXIT_MARKER = "__TERMIX_EXIT=";

export interface SnippetExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Wrap a command so its real exit code survives the snippet-execution API,
 * whose `success` flag only reflects "nothing was written to stderr". The
 * command runs in a subshell so an explicit `exit N` cannot skip the marker.
 */
export function wrapCommand(command: string): string {
  return `(\n${command}\n)\nprintf '\\n${EXIT_MARKER}%d\\n' "$?"`;
}

/** Split the marker out of the captured stdout. */
export function parseExecOutput(raw: string): {
  output: string;
  exitCode: number | null;
} {
  const match = raw.match(/\n?__TERMIX_EXIT=(\d+)\s*$/);
  if (!match) {
    return { output: raw, exitCode: null };
  }
  return {
    output: raw.slice(0, match.index),
    exitCode: Number(match[1]),
  };
}

async function executeOnHost(
  client: TermixClient,
  hostId: number,
  content: string,
  name: string,
): Promise<SnippetExecuteResponse> {
  const created = await client.request<{ id: number }>({
    method: "POST",
    path: "/snippets",
    data: {
      name,
      content,
      description: "Ephemeral snippet created by termix-cli (safe to delete).",
    },
  });

  try {
    return await client.request<SnippetExecuteResponse>({
      method: "POST",
      path: "/snippets/execute",
      data: { snippetId: created.id, hostId },
    });
  } finally {
    await client
      .request({ method: "DELETE", path: `/snippets/${created.id}` })
      .catch(() => {
        process.stderr.write(
          `termix: warning: could not delete ephemeral snippet ${created.id}\n`,
        );
      });
  }
}

export function registerExecCommands(program: Command): void {
  program
    .command("exec <hostId> <command...>")
    .description(
      "Run a shell command on a host over SSH. Prints the remote stdout/stderr and exits with the remote exit code (255 on CLI/API errors). Server-side execution timeout: 30s.",
    )
    .action(async (hostIdArg: string, commandParts: string[]) => {
      try {
        const hostId = parseId(hostIdArg);
        const command = commandParts.join(" ");
        const client = new TermixClient(resolveConfig());

        const result = await executeOnHost(
          client,
          hostId,
          wrapCommand(command),
          `cli-exec-${randomUUID()}`,
        );

        const { output, exitCode } = parseExecOutput(result.output ?? "");
        if (output) process.stdout.write(output);
        if (result.error) process.stderr.write(result.error);

        // Marker missing means the wrapper never ran (e.g. server timeout):
        // fall back to the API's stderr-based success flag.
        process.exit(exitCode ?? (result.success ? 0 : 1));
      } catch (error) {
        fail(error, 255);
      }
    });

  const snippets = program
    .command("snippets")
    .description("List and run the command snippets saved in Termix.");

  snippets
    .command("list")
    .description("List saved snippets (id, name, description, folder).")
    .action(async () =>
      run(async () => {
        const client = new TermixClient(resolveConfig());
        const all = await client.request<Array<Record<string, unknown>>>({
          method: "GET",
          path: "/snippets",
        });
        const summaries = all.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          folder: s.folder ?? null,
        }));
        printJson({ count: summaries.length, snippets: summaries });
      }),
    );

  snippets
    .command("run <snippetId>")
    .description(
      "Execute a saved snippet on a host. Prints remote stdout/stderr; exits 0 when the snippet produced no stderr, 1 otherwise (the API does not expose the exit code).",
    )
    .requiredOption("--host <hostId>", "Host id to run the snippet on")
    .action(async (snippetIdArg: string, opts: { host: string }) => {
      try {
        const snippetId = parseId(snippetIdArg);
        const hostId = parseId(opts.host);
        const client = new TermixClient(resolveConfig());

        const result = await client.request<SnippetExecuteResponse>({
          method: "POST",
          path: "/snippets/execute",
          data: { snippetId, hostId },
        });

        if (result.output) process.stdout.write(result.output);
        if (result.error) process.stderr.write(result.error);
        process.exit(result.success ? 0 : 1);
      } catch (error) {
        fail(error, 255);
      }
    });
}
