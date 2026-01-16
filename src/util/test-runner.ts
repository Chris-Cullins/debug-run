/**
 * Test Runner Utility
 *
 * Handles launching test processes (dotnet test) with VSTEST_HOST_DEBUG=1
 * and extracting the testhost PID for debugger attachment.
 */

import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

export interface TestRunnerConfig {
  /** Path to the test project directory or .csproj file */
  testProject: string;
  /** Optional test filter (--filter argument) */
  filter?: string;
  /** Working directory (defaults to test project directory) */
  cwd?: string;
  /** Additional dotnet test arguments */
  additionalArgs?: string[];
  /** Callback for progress messages */
  onProgress?: (message: string) => void;
}

export interface TestRunnerResult {
  /** The PID of the testhost process to attach to */
  pid: number;
  /** The spawned dotnet test process */
  process: ChildProcess;
}

/**
 * Launches dotnet test with VSTEST_HOST_DEBUG=1 and waits for the testhost PID.
 *
 * The test runner will output something like:
 *   Host debugging is enabled. Please attach debugger to testhost process to continue.
 *   Process Id: 12345, Name: testhost
 *   Waiting for debugger attach...
 *
 * This function parses that output to extract the PID.
 */
export async function launchTestRunner(config: TestRunnerConfig): Promise<TestRunnerResult> {
  const { testProject, filter, cwd, additionalArgs = [], onProgress } = config;

  // Determine working directory
  const projectPath = path.resolve(testProject);
  const workingDir = cwd ?? (projectPath.endsWith(".csproj")
    ? path.dirname(projectPath)
    : projectPath);

  // Build arguments
  const args = ["test", "--no-build"];

  // Add filter if specified
  if (filter) {
    args.push("--filter", filter);
  }

  // Add any additional arguments
  args.push(...additionalArgs);

  onProgress?.(`Starting test runner in: ${workingDir}`);
  onProgress?.(`Command: dotnet ${args.join(" ")}`);

  // Spawn dotnet test with VSTEST_HOST_DEBUG=1
  const testProcess = spawn("dotnet", args, {
    cwd: workingDir,
    env: {
      ...process.env,
      VSTEST_HOST_DEBUG: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Create readline interfaces for stdout and stderr
  const stdoutReader = readline.createInterface({ input: testProcess.stdout! });
  const stderrReader = readline.createInterface({ input: testProcess.stderr! });

  return new Promise<TestRunnerResult>((resolve, reject) => {
    let foundPid: number | null = null;
    let exitedEarly = false;
    let sawDebugHint = false;

    // Pattern to match "Host debugging is enabled" message
    const debugHintPattern = /Host debugging is enabled/i;

    // Pattern to match: "Process Id: 12345, Name: testhost" or "Process Id: 12345, Name: dotnet"
    // On Windows, the name is typically "testhost", on macOS/Linux it may be "dotnet"
    const pidPattern = /Process Id:\s*(\d+),?\s*Name:\s*(testhost|dotnet)/i;

    const handleLine = (line: string, stream: "stdout" | "stderr") => {
      onProgress?.(`[${stream}] ${line}`);

      // Check for debug hint
      if (debugHintPattern.test(line)) {
        sawDebugHint = true;
      }

      // Check for PID pattern
      const match = line.match(pidPattern);
      if (match && !foundPid && sawDebugHint) {
        foundPid = parseInt(match[1], 10);
        onProgress?.(`Found testhost PID: ${foundPid} (process: ${match[2]})`);
        resolve({
          pid: foundPid,
          process: testProcess,
        });
      }
    };

    stdoutReader.on("line", (line) => handleLine(line, "stdout"));
    stderrReader.on("line", (line) => handleLine(line, "stderr"));

    // Handle process exit before we find the PID
    testProcess.on("exit", (code, signal) => {
      if (!foundPid) {
        exitedEarly = true;
        reject(new Error(
          `Test process exited before testhost started. ` +
          `Exit code: ${code}, signal: ${signal}. ` +
          `Make sure the test project builds successfully and has tests.`
        ));
      }
    });

    testProcess.on("error", (err) => {
      if (!foundPid) {
        reject(new Error(`Failed to start test process: ${err.message}`));
      }
    });

    // Timeout after 60 seconds if we haven't found the PID
    setTimeout(() => {
      if (!foundPid && !exitedEarly) {
        testProcess.kill();
        reject(new Error(
          "Timeout waiting for testhost to start. " +
          "The VSTEST_HOST_DEBUG output was not detected within 60 seconds."
        ));
      }
    }, 60000);
  });
}

/**
 * Cleans up the test runner process.
 * Call this after debugging is complete.
 */
export function cleanupTestRunner(testProcess: ChildProcess): void {
  try {
    if (!testProcess.killed) {
      testProcess.kill("SIGTERM");
    }
  } catch {
    // Process may already be dead
  }
}
