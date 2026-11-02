import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import type {LogFunction} from "../shared/types";

type UpdateInstallRequest = {workspaceDir: string};

type UpdateInstall = {
    validateUpdateInstallPackage: (request: UpdateInstallRequest, requestedInstallPkgPath?: string) => string | undefined;
    launchUpdateInstallPackage: (installPkgPath: string) => Promise<void>;
};

// 安装包校验是执行外部安装程序前的唯一边界，只接受安装目录直属的思源安装包。
const createUpdateInstall = ({confDir, writeLog, platform = process.platform,
    spawn = childProcess.spawn}: {
        confDir: string;
        writeLog: LogFunction;
        platform?: NodeJS.Platform;
        spawn?: typeof childProcess.spawn;
    }): UpdateInstall => {
    const validateUpdateInstallPackage = (request: UpdateInstallRequest,
        requestedInstallPkgPath?: string): string | undefined => {
        if (!requestedInstallPkgPath) {
            writeLog("the initiating kernel did not return an update install package");
            return;
        }

        try {
            const installPkgPath = fs.realpathSync(requestedInstallPkgPath) as string;
            const installDirs = [path.join(confDir, "install"), path.join(request.workspaceDir, "temp", "install")];
            const contained = installDirs.some((directory: string) => {
                if (!fs.existsSync(directory)) {
                    return false;
                }
                const relativePkgPath = path.relative(fs.realpathSync(directory) as string, installPkgPath);
                return relativePkgPath && !path.isAbsolute(relativePkgPath) && path.dirname(relativePkgPath) === ".";
            });
            if (!contained) {
                writeLog("rejected update install package outside the install directories [path=" + installPkgPath + "]");
                return;
            }

            const packageName = path.basename(installPkgPath);
            const validPackageName = platform === "win32"
                ? /^siyuan-.+-win(?:-arm64)?\.exe$/i.test(packageName)
                : /^siyuan-.+-mac(?:-arm64)?\.dmg$/i.test(packageName);
            if (!validPackageName || !fs.statSync(installPkgPath).isFile()) {
                writeLog("rejected invalid update install package [path=" + installPkgPath + "]");
                return;
            }
            writeLog("validated update install package [path=" + installPkgPath + "]");
            return installPkgPath;
        } catch (error) {
            writeLog("validate update install package failed: " + error);
        }
    };

    const launchUpdateInstallPackage = (installPkgPath: string): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            const command = platform === "darwin" ? "/usr/bin/open" : installPkgPath;
            const args = platform === "darwin" ? [installPkgPath] : [];
            const installProcess = spawn(command, args, {
                cwd: path.dirname(installPkgPath),
                detached: true,
                stdio: "ignore",
            });
            installProcess.once("error", reject);
            installProcess.once("spawn", () => {
                writeLog("launched update install package [pid=" + installProcess.pid + ", path=" + installPkgPath + "]");
                installProcess.unref();
                resolve();
            });
        });
    };

    return {
        validateUpdateInstallPackage,
        launchUpdateInstallPackage,
    };
};

export {createUpdateInstall};
