import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {appendFileSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const goCacheKey = ({os, arch, image = "", version, sum}) => {
    for (const value of [os, arch, version, ...(os === "Linux" ? [image] : [])]) {
        if (!value || !/^[\w.-]+$/.test(value)) {
            throw new Error("Invalid Go cache metadata");
        }
    }
    const digest = createHash("sha256").update(sum).digest("hex");
    return `siyuan-go-v1-${os}-${arch}-${os === "Linux" ? image + "-" : ""}${version}-${digest}`;
};

// 所有作业从当前 Go 环境读取目录，恢复与保存使用同一组路径。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const metadata = JSON.parse(execFileSync("go", ["env", "-json", "GOMODCACHE", "GOCACHE", "GOVERSION"], {
        cwd: resolve(root, "kernel"), encoding: "utf8", windowsHide: true,
    }));
    const key = goCacheKey({os: process.env.RUNNER_OS, arch: process.env.RUNNER_ARCH,
        image: process.env.ImageOS, version: metadata.GOVERSION,
        sum: readFileSync(resolve(root, "kernel/go.sum"))});
    for (const value of [metadata.GOMODCACHE, metadata.GOCACHE]) {
        if (!value || /[\r\n]/.test(value)) {
            throw new Error("Invalid Go cache path");
        }
    }
    appendFileSync(process.env.GITHUB_OUTPUT,
        `key=${key}\nmodules=${metadata.GOMODCACHE}\nbuild=${metadata.GOCACHE}\n`);
}
