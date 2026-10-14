import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("file output offsets - Real Bash Comparison", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  it.each([
    "{ echo a; echo b >&3; } >f 3>&1; cat f",
    "exec 9>&1; exec 1>f; exec 3>&1; { exec 3>g; echo x; } >h; echo y; cat f >&9",
    "{ echo a; echo b >&3; } >f 2>&1 3>&2; cat f",
    "{ echo oooo; echo e >&2; } >f 2>f; cat f",
    "exec 3>f; echo one >&3; echo two >&3; exec 3>&-; cat f",
    "printf abcdef >f; { echo X; echo Y >&2; } 1<>f 2>&1; cat f",
    "echo a >>f; { echo b; echo c >&3; } >>f 3>&1; cat f",
    "{ echo abc | tr a-z A-Z; } >f; cat f",
  ])("%s", async (script) => {
    const bash = await setupFiles(directory, {});
    await compareOutputs(bash, directory, script);
  });
});
