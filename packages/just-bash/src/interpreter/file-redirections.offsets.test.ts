import * as hostFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../fs/interface.js";
import { MountableFs } from "../fs/mountable-fs/mountable-fs.js";
import { OverlayFs } from "../fs/overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "../fs/read-write-fs/read-write-fs.js";

const cases = [
  ["{ echo a; echo b >&3; } >f 3>&1; cat f", "a\nb\n"],
  [
    "exec 9>&1; exec 1>f; exec 3>&1; { exec 3>g; echo x; } >h; echo y; cat f >&9",
    "y\n",
  ],
  ["{ echo a 1>&1; echo b >&3; } >f 3>&1; cat f", "a\nb\n"],
  ["{ echo a; echo b >&3; } >f 2>&1 3>&2; cat f", "a\nb\n"],
  ["{ echo oooo; echo e >&2; } >f 2>f; cat f", "e\noo\n"],
  ["exec 3>f; echo one >&3; echo two >&3; exec 3>&-; cat f", "one\ntwo\n"],
  ["printf abcdef >f; { echo X; echo Y >&2; } 1<>f 2>&1; cat f", "X\nY\nef"],
  ["echo a >>f; { echo b; echo c >&3; } >>f 3>&1; cat f", "a\nb\nc\n"],
  ["printf abcdef >f; exec 3<>f; printf XY >f; printf Z >&3; cat f", "ZY"],
  ["printf abcdef >f; exec 3<>f; printf X >>f; printf Y >&3; cat f", "YbcdefX"],
  ["exec 3>f; echo one >&3; echo other >f; echo two >&3; cat f", "othetwo\n"],
  ["exec 3>f; printf é >&3; printf X >&3; cat f", "éX"],
  ["{ echo abc | tr a-z A-Z; } >f; cat f", "ABC\n"],
  ["{ { echo abc >&2; } |& tr a-z A-Z; } &>f; cat f", "ABC\n"],
  ["exec 3>f; echo a >&3; (echo b >&3); echo c >&3; cat f", "a\nb\nc\n"],
  [
    "exec 3>f; echo one >&3; { echo two >&4; } 4>&3; echo three >&3; cat f",
    "one\ntwo\nthree\n",
  ],
] as const;

describe.each([
  "memory",
  "overlay",
  "read-write",
  "mountable",
])("file output offsets (%s)", (kind) => {
  let directory: string;
  let fs: IFileSystem;
  let bash: Bash;
  beforeEach(async () => {
    directory = await hostFs.mkdtemp(path.join(os.tmpdir(), "file-offsets-"));
    if (kind === "overlay")
      fs = new OverlayFs({ root: directory, mountPoint: "/" });
    else if (kind === "read-write") fs = new ReadWriteFs({ root: directory });
    else if (kind === "mountable") {
      const mounted = new MountableFs({ base: new InMemoryFs() });
      mounted.mount("/work", new ReadWriteFs({ root: directory }));
      fs = mounted;
    } else fs = new InMemoryFs();
    await fs.mkdir("/work", { recursive: true });
    bash = new Bash({ fs, cwd: "/work" });
  });
  afterEach(async () => {
    await hostFs.rm(directory, { recursive: true, force: true });
  });

  it.each(cases)("%s", async (script, stdout) => {
    expect(await bash.exec(script)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe(stdout);
  });
  it("replaces a file binding with a captured live stream", async () => {
    expect(await bash.exec("{ echo x; } >f 1>&2")).toMatchObject({
      stdout: "",
      stderr: "x\n",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe("");
  });
  it("closes a file binding before the redirected body runs", async () => {
    expect(await bash.exec("{ echo x; } >f 1>&-")).toMatchObject({
      stdout: "",
      stderr: "bash: echo: write error: Bad file descriptor\n",
      exitCode: 1,
    });
    expect(await fs.readFile("/work/f")).toBe("");
  });

  it.runIf(process.env.BENCHMARK_FILE_REDIRECTS === "1")(
    "measures repeated redirected writes",
    async () => {
      if (process.env.BENCHMARK_BASE_PATH) {
        const baseline = await import(
          `${process.env.BENCHMARK_BASE_PATH}/packages/just-bash/src/Bash.ts`
        );
        bash = new baseline.Bash({ fs, cwd: "/work" });
      }
      const samples: number[] = [];
      const script = `for ((i=0;i<2000;i++)); do printf '%s\\n' '${"x".repeat(1023)}'; done >f`;
      for (let sample = 0; sample < 6; sample++) {
        const start = performance.now();
        expect(await bash.exec(script)).toMatchObject({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });
        if (sample > 0) samples.push(performance.now() - start);
        expect((await fs.stat("/work/f")).size).toBe(2_048_000);
      }
      samples.sort((left, right) => left - right);
      process.stdout.write(
        `${JSON.stringify({ filesystem: kind, medianMs: samples[2], samples })}\n`,
      );
    },
  );
});
