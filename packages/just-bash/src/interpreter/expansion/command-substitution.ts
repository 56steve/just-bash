/**
 * Command Substitution Helpers
 *
 * Helper functions for handling command substitution patterns.
 */

import type {
  ScriptNode,
  SimpleCommandNode,
  WordNode,
} from "../../ast/types.js";
import { Parser } from "../../parser/parser.js";
import { ExecutionLimitError, ExitError } from "../errors.js";
import { cloneArrays } from "../helpers/array.js";
import { recordSubstitutionExit } from "../helpers/substitution-status.js";
import type { InterpreterContext } from "../types.js";

/**
 * Check if a command substitution body matches the $(<file) shorthand pattern.
 * This is a special case where $(< file) is equivalent to $(cat file) but reads
 * the file directly without spawning a subprocess.
 *
 * For this to match, the body must consist of:
 * - One statement without operators (no && or ||)
 * - One pipeline with one command
 * - A SimpleCommand with no name, no args, no assignments
 * - Exactly one input redirection (<)
 *
 * Note: The special $(<file) behavior only works when it's the ONLY element
 * in the command substitution. $(< file; cmd) or $(cmd; < file) are NOT special.
 */
export function getFileReadShorthand(
  body: ScriptNode,
): { target: WordNode } | null {
  // Must have exactly one statement
  if (body.statements.length !== 1) return null;

  const statement = body.statements[0];
  // Must not have any operators (no && or ||)
  if (statement.operators.length !== 0) return null;
  // Must have exactly one pipeline
  if (statement.pipelines.length !== 1) return null;

  const pipeline = statement.pipelines[0];
  // Must not be negated
  if (pipeline.negated) return null;
  // Must have exactly one command
  if (pipeline.commands.length !== 1) return null;

  const cmd = pipeline.commands[0];
  // Must be a SimpleCommand
  if (cmd.type !== "SimpleCommand") return null;

  const simpleCmd = cmd as SimpleCommandNode;
  // Must have no command name
  if (simpleCmd.name !== null) return null;
  // Must have no arguments
  if (simpleCmd.args.length !== 0) return null;
  // Must have no assignments
  if (simpleCmd.assignments.length !== 0) return null;
  // Must have exactly one redirection
  if (simpleCmd.redirections.length !== 1) return null;

  const redirect = simpleCmd.redirections[0];
  // Must be an input redirection (<)
  if (redirect.operator !== "<") return null;
  // Target must be a WordNode (not heredoc)
  if (redirect.target.type !== "Word") return null;

  return { target: redirect.target };
}

function checkOutputLength(ctx: InterpreterContext, output: string): void {
  if (output.length > ctx.limits.maxStringLength) {
    throw new ExecutionLimitError(
      `command substitution: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
      "string_length",
    );
  }
}

/**
 * Run a command substitution body in a subshell of the current shell and
 * return its output without trailing newlines.
 */
export async function executeCommandSubstitution(
  ctx: InterpreterContext,
  body: ScriptNode,
): Promise<string> {
  // Command substitution runs in a subshell-like context
  // ExitError should NOT terminate the main script, just this substitution
  // But ExecutionLimitError MUST propagate to protect against infinite recursion
  // Check command substitution nesting depth limit
  const currentDepth = ctx.substitutionDepth ?? 0;
  const maxDepth = ctx.limits.maxSubstitutionDepth;
  if (currentDepth >= maxDepth) {
    throw new ExecutionLimitError(
      `Command substitution nesting limit exceeded (${maxDepth})`,
      "substitution_depth",
    );
  }
  // Increment depth for nested substitutions
  const savedDepth = ctx.substitutionDepth;
  ctx.substitutionDepth = currentDepth + 1;

  // Command substitutions get a new BASHPID (unlike $$ which stays the same)
  const savedBashPid = ctx.state.bashPid;
  ctx.state.bashPid = ctx.state.nextVirtualPid++;
  // Save environment - command substitutions run in a subshell and should not
  // modify parent environment (e.g., aliases defined inside $() should not leak)
  const savedEnv = new Map(ctx.state.env);
  const savedArrays = cloneArrays(ctx.state.arrays);
  const savedCwd = ctx.state.cwd;
  // Suppress verbose mode (set -v) inside command substitutions
  // bash only prints verbose output for the main script
  const savedSuppressVerbose = ctx.state.suppressVerbose;
  ctx.state.suppressVerbose = true;
  try {
    const result = await ctx.executeScript(body);
    // Restore environment but preserve exit code
    const exitCode = result.exitCode;
    ctx.state.env = savedEnv;
    ctx.state.arrays = savedArrays;
    ctx.state.cwd = savedCwd;
    ctx.state.suppressVerbose = savedSuppressVerbose;
    // Store the exit code for $?
    recordSubstitutionExit(ctx.state, exitCode);
    // Command substitution stderr should go to the shell's stderr at expansion time,
    // NOT be affected by later redirections on the outer command
    if (result.stderr) {
      ctx.state.expansionStderr =
        (ctx.state.expansionStderr || "") + result.stderr;
    }
    ctx.state.bashPid = savedBashPid;
    ctx.substitutionDepth = savedDepth;
    const output = result.stdout.replace(/\n+$/, "");
    // Check string length limit for command substitution output
    checkOutputLength(ctx, output);
    return output;
  } catch (error) {
    // Restore environment on error as well
    ctx.state.env = savedEnv;
    ctx.state.arrays = savedArrays;
    ctx.state.cwd = savedCwd;
    ctx.state.bashPid = savedBashPid;
    ctx.substitutionDepth = savedDepth;
    ctx.state.suppressVerbose = savedSuppressVerbose;
    // ExecutionLimitError must always propagate - these are safety limits
    if (error instanceof ExecutionLimitError) {
      throw error;
    }
    if (error instanceof ExitError) {
      // Catch exit in command substitution - return output so far
      recordSubstitutionExit(ctx.state, error.exitCode);
      // Also forward stderr from the exit
      if (error.stderr) {
        ctx.state.expansionStderr =
          (ctx.state.expansionStderr || "") + error.stderr;
      }
      const exitOutput = error.stdout.replace(/\n+$/, "");
      // Check string length limit for command substitution output
      checkOutputLength(ctx, exitOutput);
      return exitOutput;
    }
    throw error;
  }
}

/**
 * Parse and run a command substitution that arithmetic kept as source text.
 */
export async function executeCommandSubstitutionSource(
  ctx: InterpreterContext,
  command: string,
): Promise<string> {
  let body: ScriptNode;
  try {
    body = new Parser().parse(command);
  } catch (error) {
    if (error instanceof ExecutionLimitError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    ctx.state.expansionStderr = `${ctx.state.expansionStderr || ""}bash: syntax error: ${message}\n`;
    recordSubstitutionExit(ctx.state, 2);
    return "";
  }
  return executeCommandSubstitution(ctx, body);
}
