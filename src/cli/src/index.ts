#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { registerAuthCommands } from "./commands/login.js";
import { registerHostCommands } from "./commands/hosts.js";
import { registerExecCommands } from "./commands/exec.js";
import { registerMiscCommands } from "./commands/misc.js";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("termix")
  .description(
    "Command-line interface for Termix — a thin wrapper around the Termix HTTP API.\n" +
      "Authenticate with `termix login` (interactive), or set TERMIX_URL + TERMIX_TOKEN\n" +
      "(or TERMIX_API_KEY for read-only endpoints) for scripts and agents.",
  )
  .version(pkg.version);

registerAuthCommands(program);
registerHostCommands(program);
registerExecCommands(program);
registerMiscCommands(program, pkg.version);

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(
    `termix: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
