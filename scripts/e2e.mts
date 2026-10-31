import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createServer } from "node:net";

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to select a port");
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function waitForServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("E2E server did not start")),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Server listening at")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("E2E server exited before startup"));
    });
    server.stderr.resume();
  });
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (result) => resolve(result ?? 1));
  });
}

async function run(testArguments: string[], scenario = "success") {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(join(tmpdir(), "identityhub-e2e-"));
  const fakeRequestLog = join(directory, "fake-requests.log");
  const server = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/e2e-server.mts"],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        ATLASSIAN_CLIENT_ID: "",
        ATLASSIAN_CLIENT_SECRET: "",
        OAUTH_REDIRECT_URI: "",
        ENCRYPTION_KEY: "",
        ATLASSIAN_AUTH_BASE: "",
        ATLASSIAN_AUTH_BROWSER_BASE: "",
        E2E_JIRA_SCENARIO: scenario,
        E2E_FAKE_REQUEST_LOG: fakeRequestLog,
        DATABASE_PATH: join(directory, "e2e.db"),
        PORT: String(port),
        APP_BASE_URL: baseUrl,
      },
      stdio: "pipe",
    },
  );
  let runner: ChildProcess | undefined;
  let interrupted = false;

  function interrupt() {
    interrupted = true;
    runner?.kill();
    server.kill();
  }

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await waitForServer(server);
    if (interrupted) throw new Error("E2E run interrupted");
    runner = spawn(
      process.execPath,
      [
        resolve("node_modules/@playwright/test/cli.js"),
        "test",
        ...testArguments,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_BASE_URL: baseUrl,
          E2E_FAKE_REQUEST_LOG: fakeRequestLog,
        },
      },
    );
    const result = await waitForExit(runner);
    process.exitCode = interrupted ? 1 : result;
  } finally {
    server.kill();
    if (server.exitCode === null && server.signalCode === null) {
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await rm(directory, { recursive: true, force: true });
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

await run(["--grep-invert", "@verification|@jira|@keys|@scanner"]);
if (!process.exitCode) await run(["--grep", "@verification"]);
if (!process.exitCode) await run(["--grep", "@keys"]);
if (!process.exitCode) await run(["--grep", "@scanner"]);
if (!process.exitCode) await run(["--grep", "@jira(?:\\s|$)"]);
if (!process.exitCode) await run(["--grep", "@jira-missing"], "missing");
if (!process.exitCode) await run(["--grep", "@jira-invalid"], "invalid");
if (!process.exitCode) await run(["--grep", "@jira-exchange"], "exchange");
