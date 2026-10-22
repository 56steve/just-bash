import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const files = {
  "/w/a/b/file.txt": "x",
  "/w/a/c/file.txt": "x",
  "/w/d/file.txt": "x",
  "/w/top.txt": "x",
};

describe("glob with a trailing slash and globstar", () => {
  it("lists every directory recursively for **/", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec("shopt -s globstar; echo **/");
    expect(result.stdout).toBe("a/ a/b/ a/c/ d/\n");
    expect(result.stderr).toBe("");
  });

  it("lists directories below a prefix for dir/**/", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec("shopt -s globstar; echo a/**/");
    expect(result.stdout).toBe("a/ a/b/ a/c/\n");
  });

  it("matches only directories for **/b*/", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec("shopt -s globstar; echo **/b*/");
    expect(result.stdout).toBe("a/b/\n");
  });
});
