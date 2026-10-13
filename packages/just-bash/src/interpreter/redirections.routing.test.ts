import { expect, it } from "vitest";
import { Bash } from "../Bash.js";

it.each([
  ["cd /dev; { cd /tmp; echo hidden; } > null", undefined, undefined],
  ["cd /tmp; { cd /dev; echo kept; } > null", "kept\n", undefined],
  ["cd /tmp; { cd /dev; echo kept; } >> null", "seedkept\n", "seed"],
  ["cd /tmp; { cd /dev; echo kept; } >| null", "kept\n", undefined],
  ["cd /tmp; { cd /dev; echo kept; } &> null", "kept\n", undefined],
  ["cd /tmp; { cd /dev; echo kept; } &>> null", "seedkept\n", "seed"],
])("retains prepared destination: %s", async (script, content, initial) => {
  const bash = new Bash({ files: initial ? { "/tmp/null": initial } : {} });
  await bash.fs.mkdir("/tmp", { recursive: true });
  expect(await bash.exec(script)).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  expect(await bash.fs.exists("/tmp/null")).toBe(content !== undefined);
  if (content !== undefined)
    expect(await bash.fs.readFile("/tmp/null")).toBe(content);
});

it.each([
  [">/tmp/leak 1<>/dev/null", "", "seed"],
  ["1<>/dev/null >/tmp/leak", "secret\n", "seed"],
  [">/tmp/leak 1<>/tmp/other", "", "secret\n"],
  ["1<>/tmp/other >/tmp/leak", "secret\n", "seed"],
])("replays read-write opens in order: %s", async (redirects, leak, other) => {
  const bash = new Bash({ files: { "/tmp/other": "seed" } });
  expect(await bash.exec(`echo secret ${redirects}`)).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  expect(await bash.fs.readFile("/tmp/leak")).toBe(leak);
  expect(await bash.fs.readFile("/tmp/other")).toBe(other);
});

it("routes an open failure through preceding stderr redirection", async () => {
  const bash = new Bash();
  expect(await bash.exec("echo never 2>/tmp/error >/tmp")).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 1,
  });
  expect(await bash.fs.readFile("/tmp/error")).toBe(
    "bash: /tmp: Is a directory\n",
  );
});

it("replays a read-write stderr destination after an output open", async () => {
  const bash = new Bash();
  expect(
    await bash.exec("echo secret 2>/tmp/leak 2<>/dev/null >&2"),
  ).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
  expect(await bash.fs.readFile("/tmp/leak")).toBe("");
});
