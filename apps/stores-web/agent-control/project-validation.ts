import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type TopLevelResolver = (dir: string) => Promise<string>;

export type ProjectValidationResult =
  | { ok: true; topLevel: string }
  | { ok: false; reason: string };

export interface ValidateProjectRootInput {
  /** Configured project path (e.g. an isolated worktree). */
  projectPath: string;
  /** Optional allowlist of the exact Git top-levels accepted for the project. */
  allowedTopLevels?: string[];
  /** Injectable resolver for tests; defaults to `git rev-parse --show-toplevel`. */
  resolveTopLevel?: TopLevelResolver;
  timeoutMs?: number;
}

/**
 * Default resolver: ask Git itself, with a bounded timeout. Any failure
 * (missing binary, non-repo, timeout) rejects and the caller fails closed.
 */
export function createGitTopLevelResolver(timeoutMs = 5000): TopLevelResolver {
  return async (dir) => {
    const { stdout } = await execFileP("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      timeout: timeoutMs,
      windowsHide: true,
    });
    const top = stdout.trim();
    if (!top) throw new Error("git returned an empty top-level");
    return top;
  };
}

/**
 * Fail-closed project validation. The configured path must exist, must be a
 * directory, and must be EXACTLY the Git top-level reported for it — never a
 * subdirectory that merely resolves to some unrelated parent repository
 * (the class of error that sent Amursk SEO work into the wrong repo).
 * When an allowlist is given, the resolved top-level must match one of its
 * entries after realpath normalization.
 */
export async function validateProjectRoot(input: ValidateProjectRootInput): Promise<ProjectValidationResult> {
  let stat;
  try {
    stat = statSync(input.projectPath);
  } catch {
    return { ok: false, reason: `project path does not exist: ${input.projectPath}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: `project path is not a directory: ${input.projectPath}` };
  }

  const resolve = input.resolveTopLevel ?? createGitTopLevelResolver(input.timeoutMs);
  let topLevel: string;
  try {
    topLevel = await resolve(input.projectPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `unable to determine Git top-level (fail closed): ${message}` };
  }
  if (!topLevel) {
    return { ok: false, reason: "unable to determine Git top-level (fail closed): empty result" };
  }

  const realProject = realpathSync(input.projectPath);
  const realTop = realpathSync(topLevel);
  if (realProject !== realTop) {
    return {
      ok: false,
      reason: `project path ${realProject} is not the exact Git top-level; git reports ${realTop} (refusing to fall through to a parent repository)`,
    };
  }

  if (input.allowedTopLevels && input.allowedTopLevels.length > 0) {
    const allowed = input.allowedTopLevels.map((p) => realpathSync(p));
    if (!allowed.includes(realTop)) {
      return {
        ok: false,
        reason: `Git top-level ${realTop} is not in the configured allowlist for this project`,
      };
    }
  }

  return { ok: true, topLevel: realTop };
}
