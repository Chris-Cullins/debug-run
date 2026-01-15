#!/usr/bin/env node

/**
 * debug-run: CLI tool enabling AI agents to programmatically debug code
 *
 * Uses the Debug Adapter Protocol (DAP) to communicate with various debuggers
 * (netcoredbg, debugpy, node inspector, lldb) and outputs structured JSON
 * that agents can parse and act on.
 */

import { createCli } from "./cli.js";

const cli = createCli();
cli.parse();
