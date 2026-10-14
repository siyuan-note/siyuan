import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const appRoot = fileURLToPath(new URL("../", import.meta.url));

// 整体重建构建输出目录，避免已移除的构建配置留下无人清理的孤儿产物。
// 只处理 git 忽略的 stage/build；stage 下被跟踪的源码目录不在此处清理。
export const cleanStageBuild = (buildDir) => {
    let info;
    try {
        info = fs.lstatSync(buildDir);
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
    // 符号链接和目录联接不递归删除，避免删除链接指向的其他目录。
    if (info.isSymbolicLink()) {
        return false;
    }
    fs.rmSync(buildDir, {recursive: true, force: true});
    return true;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    cleanStageBuild(path.join(appRoot, "stage", "build"));
}
