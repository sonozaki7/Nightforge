import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Nightforge's own storage directories inside the projects root. These are
 * never "projects" no matter what they contain.
 */
export const RESERVED_DIRS: ReadonlySet<string> = new Set(["releases"]);

/**
 * A real project is a subdirectory of the projects root that carries its own
 * `.nightforge/project.yaml` marker (written by addProject). Folders without
 * the marker — the app's own checkout, symlinks, reserved dirs — are not
 * projects and must never appear in console listings.
 */
export function registeredProjectIds(projectsDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !RESERVED_DIRS.has(entry.name) &&
        existsSync(
          path.join(projectsDir, entry.name, ".nightforge", "project.yaml")
        )
    )
    .map((entry) => entry.name)
    .sort();
}
