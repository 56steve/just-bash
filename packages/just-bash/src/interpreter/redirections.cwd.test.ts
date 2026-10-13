import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("prepared output destinations survive directory changes", () => {
  it("does not reinterpret a relative file operand as stream-device syntax", async () => {
    const bash = new Bash();
    const result = await bash.exec("cd /dev; { cd /tmp; echo kept; } > stdout");
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bash.fs.readFile("/dev/stdout")).toBe("kept\n");
    expect(await bash.fs.exists("/tmp/stdout")).toBe(false);
  });
  it.each([
    ">",
    ">|",
    ">>",
    "&>",
    "&>>",
  ])("retains the file opened by %s", async (operator) => {
    const bash = new Bash({
      files: { "/original/out": "", "/later/keep": "" },
    });
    const result = await bash.exec(
      `cd /original; { cd /later; echo kept; } ${operator} out`,
    );
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bash.fs.readFile("/original/out")).toBe("kept\n");
    expect(await bash.fs.exists("/later/out")).toBe(false);
  });

  it.each([
    ">",
    ">>",
    "&>",
    "&>>",
  ])("retains the null device opened by %s", async (operator) => {
    const bash = new Bash();
    const result = await bash.exec(
      `cd /dev; { cd /tmp; echo hidden; } ${operator} null`,
    );
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bash.fs.exists("/tmp/null")).toBe(false);
  });
});
