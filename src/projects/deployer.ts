import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, cp, symlink, rm, readlink, readdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type { ProjectConfig } from "./registry.js";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-deployer" });

export interface DeployResult {
  success: boolean;
  releasePath: string | null;
  previousReleasePath: string | null;
  message: string;
}

export interface Deployer {
  deploy(
    projectConfig: ProjectConfig,
    sourcePath: string
  ): Promise<DeployResult>;
  rollback(projectConfig: ProjectConfig): Promise<DeployResult>;
  getCurrentRelease(projectPath: string): Promise<string | null>;
  listReleases(projectPath: string): Promise<string[]>;
}

function generateReleaseName(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").split(".")[0] ?? "";
  return timestamp;
}

export function createDeployer(): Deployer {
  return {
    async deploy(
      projectConfig: ProjectConfig,
      sourcePath: string
    ): Promise<DeployResult> {
      const projectPath = projectConfig.path;
      const releasesDir = path.join(projectPath, "..", "releases");
      const currentLink = path.join(projectPath, "..", "current");
      const releaseName = generateReleaseName();
      const releasePath = path.join(releasesDir, releaseName);

      const log = logger.child({
        projectId: projectConfig.id,
        releaseName,
      });

      log.info("Starting deployment");

      try {
        const previousRelease = await this.getCurrentRelease(projectPath);

        await mkdir(releasePath, { recursive: true });
        log.info({ releasePath }, "Release directory created");

        await cp(sourcePath, releasePath, {
          recursive: true,
          // Never carry node_modules or .git into a release. Worktree
          // node_modules is a symlink into the origin repo; copying it
          // would let the release's install step wipe the origin's
          // dependencies. prepare-release installs fresh deps instead.
          filter: (src: string): boolean => {
            const base = path.basename(src);
            return base !== "node_modules" && base !== ".git";
          },
        });
        log.info("Artifacts copied to release");

        const [cmd = "", ...args] = projectConfig.deployment.deployCommand.split(" ");
        await execFileAsync(cmd, args, {
          cwd: releasePath,
          timeout: 300000,
        });
        log.info("Deploy command executed");

        const tempLink = `${currentLink}.tmp`;
        await rm(tempLink, { force: true });
        await symlink(releasePath, tempLink);
        await rm(currentLink, { force: true });
        await symlink(releasePath, currentLink);
        await rm(tempLink, { force: true });

        log.info("Symlink swapped to new release");

        return {
          success: true,
          releasePath,
          previousReleasePath: previousRelease,
          message: `Deployed release ${releaseName}`,
        };
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "Deployment failed");

        await rm(releasePath, { recursive: true, force: true });

        return {
          success: false,
          releasePath: null,
          previousReleasePath: null,
          message: `Deployment failed: ${error.message}`,
        };
      }
    },

    async rollback(projectConfig: ProjectConfig): Promise<DeployResult> {
      const projectPath = projectConfig.path;
      const currentLink = path.join(projectPath, "..", "current");
      const releasesDir = path.join(projectPath, "..", "releases");

      const log = logger.child({ projectId: projectConfig.id });
      log.info("Starting rollback");

      try {
        const currentRelease = await readlink(currentLink);
        const releases = await this.listReleases(projectPath);

        const currentIndex = releases.indexOf(path.basename(currentRelease));
        const previousRelease =
          currentIndex > 0 ? releases[currentIndex - 1] : undefined;

        if (!previousRelease) {
          return {
            success: false,
            releasePath: null,
            previousReleasePath: null,
            message: "No previous release to rollback to",
          };
        }

        const previousPath = path.join(releasesDir, previousRelease);

        await rm(currentLink, { force: true });
        await symlink(previousPath, currentLink);

        const [cmd = "", ...args] =
          projectConfig.deployment.rollbackCommand.split(" ");
        await execFileAsync(cmd, args, {
          cwd: previousPath,
          timeout: 300000,
        });

        log.info({ previousRelease }, "Rollback completed");

        return {
          success: true,
          releasePath: previousPath,
          previousReleasePath: currentRelease,
          message: `Rolled back to ${previousRelease}`,
        };
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "Rollback failed");

        return {
          success: false,
          releasePath: null,
          previousReleasePath: null,
          message: `Rollback failed: ${error.message}`,
        };
      }
    },

    async getCurrentRelease(projectPath: string): Promise<string | null> {
      const currentLink = path.join(projectPath, "..", "current");
      try {
        return await readlink(currentLink);
      } catch {
        return null;
      }
    },

    async listReleases(projectPath: string): Promise<string[]> {
      const releasesDir = path.join(projectPath, "..", "releases");
      try {
        const entries = await readdir(releasesDir);
        return entries.sort();
      } catch {
        return [];
      }
    },
  };
}
