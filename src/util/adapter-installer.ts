/**
 * Adapter Installer
 *
 * Downloads and manages debug adapter binaries.
 */

import { createWriteStream, existsSync, chmodSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const execAsync = promisify(exec);

// netcoredbg release info
const NETCOREDBG_VERSION = "3.1.3-1062";
const NETCOREDBG_BASE_URL = `https://github.com/Samsung/netcoredbg/releases/download/${NETCOREDBG_VERSION}`;

// js-debug release info
const JSDEBUG_VERSION = "1.105.0";
const JSDEBUG_DOWNLOAD_URL = `https://github.com/microsoft/vscode-js-debug/releases/download/v${JSDEBUG_VERSION}/js-debug-dap-v${JSDEBUG_VERSION}.tar.gz`;

interface PlatformInfo {
  os: string;
  arch: string;
  archiveExt: string;
  executableName: string;
}

function getPlatformInfo(): PlatformInfo {
  const platform = os.platform();
  const arch = os.arch();

  let osName: string;
  let archName: string;
  let archiveExt = "tar.gz";
  let executableName = "netcoredbg";

  switch (platform) {
    case "darwin":
      osName = "osx";
      break;
    case "linux":
      osName = "linux";
      break;
    case "win32":
      osName = "win";
      archiveExt = "zip";
      executableName = "netcoredbg.exe";
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  switch (arch) {
    case "arm64":
      // Note: macOS arm64 uses amd64 build via Rosetta (no native arm64 build available)
      // This may cause stability issues - recommend using Homebrew or building from source
      // for Apple Silicon Macs when native builds become available
      archName = osName === "osx" ? "amd64" : "arm64";
      break;
    case "x64":
      archName = "amd64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  // Windows only has 64-bit builds
  if (osName === "win") {
    archName = "64";
  }

  return {
    os: osName,
    arch: archName,
    archiveExt,
    executableName,
  };
}

function getDownloadUrl(): string {
  const info = getPlatformInfo();
  const filename = `netcoredbg-${info.os}-${info.arch}.${info.archiveExt}`;
  return `${NETCOREDBG_BASE_URL}/${filename}`;
}

/**
 * Get the path to the bundled adapters directory
 */
export function getAdaptersDir(): string {
  // Use a directory relative to the package
  // import.meta.url gives us file:///path/to/adapter-installer.ts
  const currentFileUrl = import.meta.url;
  const currentFilePath = new URL(currentFileUrl).pathname;
  const packageRoot = path.resolve(path.dirname(currentFilePath), "..", "..");
  return path.join(packageRoot, "bin", "adapters");
}

/**
 * Get the path to the netcoredbg executable
 */
export function getNetcoredbgPath(): string {
  const info = getPlatformInfo();
  return path.join(getAdaptersDir(), "netcoredbg", info.executableName);
}

/**
 * Check if netcoredbg is installed in the bundled location
 */
export function isNetcoredbgInstalled(): boolean {
  return existsSync(getNetcoredbgPath());
}

/**
 * Download and install netcoredbg
 */
export async function installNetcoredbg(
  onProgress?: (message: string) => void
): Promise<string> {
  const log = onProgress ?? console.log;
  const info = getPlatformInfo();
  const adaptersDir = getAdaptersDir();
  const netcoredbgDir = path.join(adaptersDir, "netcoredbg");
  const downloadUrl = getDownloadUrl();
  const archivePath = path.join(os.tmpdir(), `netcoredbg.${info.archiveExt}`);

  log(`Downloading netcoredbg from ${downloadUrl}...`);

  // Create directories
  await mkdir(netcoredbgDir, { recursive: true });

  // Download the archive
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download netcoredbg: ${response.statusText}`);
  }

  // Save to temp file
  const fileStream = createWriteStream(archivePath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);

  log("Extracting...");

  // Extract the archive
  if (info.archiveExt === "zip") {
    await execAsync(`unzip -o "${archivePath}" -d "${netcoredbgDir}"`);
  } else {
    await execAsync(`tar -xzf "${archivePath}" -C "${netcoredbgDir}" --strip-components=1`);
  }

  // Make executable
  const execPath = getNetcoredbgPath();
  if (info.os !== "win") {
    chmodSync(execPath, 0o755);
  }

  // Clean up
  await rm(archivePath, { force: true });

  log(`Installed netcoredbg to ${execPath}`);
  return execPath;
}

/**
 * Ensure netcoredbg is installed, downloading if necessary
 */
export async function ensureNetcoredbg(
  onProgress?: (message: string) => void
): Promise<string> {
  if (isNetcoredbgInstalled()) {
    return getNetcoredbgPath();
  }

  return await installNetcoredbg(onProgress);
}

// ============================================================================
// js-debug (Node.js/TypeScript debugger)
// ============================================================================

/**
 * Get the path to the js-debug DAP server
 */
export function getJsDebugPath(): string {
  return path.join(getAdaptersDir(), "js-debug", "src", "dapDebugServer.js");
}

/**
 * Check if js-debug is installed in the bundled location
 */
export function isJsDebugInstalled(): boolean {
  return existsSync(getJsDebugPath());
}

/**
 * Download and install js-debug
 */
export async function installJsDebug(
  onProgress?: (message: string) => void
): Promise<string> {
  const log = onProgress ?? console.log;
  const adaptersDir = getAdaptersDir();
  const jsDebugDir = path.join(adaptersDir, "js-debug");
  const archivePath = path.join(os.tmpdir(), "js-debug.tar.gz");

  log(`Downloading js-debug v${JSDEBUG_VERSION} from GitHub...`);

  // Create directories
  await mkdir(jsDebugDir, { recursive: true });

  // Download the archive
  const response = await fetch(JSDEBUG_DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Failed to download js-debug: ${response.statusText}`);
  }

  // Save to temp file
  const fileStream = createWriteStream(archivePath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);

  log("Extracting...");

  // Extract the archive - js-debug tarball has a js-debug/ root directory
  // First remove existing if any
  if (existsSync(jsDebugDir)) {
    await rm(jsDebugDir, { recursive: true, force: true });
  }
  await mkdir(adaptersDir, { recursive: true });

  // Extract to adapters dir (it will create js-debug/ inside)
  await execAsync(`tar -xzf "${archivePath}" -C "${adaptersDir}"`);

  // Clean up
  await rm(archivePath, { force: true });

  const execPath = getJsDebugPath();
  log(`Installed js-debug to ${execPath}`);
  return execPath;
}

/**
 * Ensure js-debug is installed, downloading if necessary
 */
export async function ensureJsDebug(
  onProgress?: (message: string) => void
): Promise<string> {
  if (isJsDebugInstalled()) {
    return getJsDebugPath();
  }

  return await installJsDebug(onProgress);
}
