import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const COUNT_FN = 'f () { echo "n=$# [$1] [$2] [$3]"; }';

describe('"$@" as the word of a default or alternative expansion', () => {
  it.each([
    ['f ${1+"$@"}', "unquoted ${1+...}"],
    ['f ${1:+"$@"}', "unquoted ${1:+...}"],
    ['f ${x-"$@"}', "unquoted ${x-...}"],
    ['f ${x:-"$@"}', "unquoted ${x:-...}"],
    ['f ${1+"${@}"}', "braced $@"],
    ['f "${1+"$@"}"', "outer double quotes"],
    ['f "${1+$@}"', "bare $@ in outer double quotes"],
    ["eval f '${1+\"$@\"}'", "through eval"],
  ])("keeps one word per positional parameter: %s (%s)", async (call) => {
    const bash = new Bash();
    const result = await bash.exec(`${COUNT_FN}
set -- a "b c" d
${call}`);
    expect(result.stdout).toBe("n=3 [a] [b c] [d]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("produces no words when there are no positional parameters", async () => {
    const bash = new Bash();
    const result = await bash.exec(`${COUNT_FN}
set --
f ${"$"}{x-"$@"}`);
    expect(result.stdout).toBe("n=0 [] [] []\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not use the alternative when the test parameter is unset", async () => {
    const bash = new Bash();
    const result = await bash.exec(`${COUNT_FN}
set -- a "b c"
f \${x+"$@"}; f \${1-"fallback"}`);
    expect(result.stdout).toBe("n=0 [] [] []\nn=1 [a] [] []\n");
    expect(result.exitCode).toBe(0);
  });

  it('still joins "$*"', async () => {
    const bash = new Bash();
    const result = await bash.exec(`${COUNT_FN}
set -- a "b c" d
f \${1+"$*"}`);
    expect(result.stdout).toBe("n=1 [a b c d] [] []\n");
    expect(result.exitCode).toBe(0);
  });
});
