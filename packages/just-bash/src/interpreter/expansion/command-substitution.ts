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
import { decodedTextFromResult } from "../../encoding.js";
import { parse } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import { ExecutionLimitError } from "../errors.js";
import { recordSubstitutionExit } from "../helpers/substitution-status.js";
import { executeSubshell } from "../subshell-group.js";
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

/**
 * Run a command substitution body in a subshell of the current shell and
 * return its output without trailing newlines.
 */
export async function executeCommandSubstitution(
  ctx: InterpreterContext,
  body: ScriptNode,
): Promise<string> {
  const currentDepth = ctx.substitutionDepth ?? 0;
  const maxDepth = ctx.limits.maxSubstitutionDepth;
  if (currentDepth >= maxDepth) {
    throw new ExecutionLimitError(
      `Command substitution nesting limit exceeded (${maxDepth})`,
      "substitution_depth",
    );
  }
  const savedDepth = ctx.substitutionDepth;
  ctx.substitutionDepth = currentDepth + 1;
  // bash only prints verbose (set -v) output for the main script
  const savedSuppressVerbose = ctx.state.suppressVerbose;
  ctx.state.suppressVerbose = true;
  let result: ExecResult;
  try {
    result = await executeSubshell(
      ctx,
      { type: "Subshell", body: body.statements, redirections: [] },
      "",
      ctx.executeStatement,
    );
  } finally {
    ctx.substitutionDepth = savedDepth;
    ctx.state.suppressVerbose = savedSuppressVerbose;
  }
  recordSubstitutionExit(ctx.state, result.exitCode);
  // Report stderr at expansion time, before the outer command's redirections
  if (result.stderr) {
    ctx.state.expansionStderr =
      (ctx.state.expansionStderr || "") + result.stderr;
  }
  const output = decodedTextFromResult(result).replace(/\n+$/, "");
  if (output.length > ctx.limits.maxStringLength) {
    throw new ExecutionLimitError(
      `command substitution: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
      "string_length",
    );
  }
  return output;
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
    body = parse(command, { maxHeredocSize: ctx.limits.maxHeredocSize });
  } catch (error) {
    if (error instanceof ExecutionLimitError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    ctx.state.expansionStderr = `${ctx.state.expansionStderr || ""}bash: syntax error: ${message}\n`;
    recordSubstitutionExit(ctx.state, 2);
    return "";
  }
  return executeCommandSubstitution(ctx, body);
}
