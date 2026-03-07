/**
 * 合并前端（webpack-license-plugin 的 oss-licenses.json）与后端（go-licenses report --format=json），
 * 输出单一 credits.json，供内核路由 /stage/credits 读取并渲染 HTML。
 * 用法：node scripts/merge-oss-licenses.js [JSON 所在目录] [输出 credits.json 路径]
 * 例：node scripts/merge-oss-licenses.js stage/build/app stage/credits.json
 * 后端使用 github.com/TCOTC/go-licenses/v2（支持 --format=json），安装时取最新 tag 如 v2.0.1-tcotc.x。
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const appDir = path.resolve(__dirname, "..");
const jsonDir = path.resolve(appDir, process.argv[2] || "stage/build/app");
const kernelDir = path.resolve(appDir, "..", "kernel");
const frontendPath = path.join(jsonDir, "oss-licenses.json");
const outJsonPath = process.argv[3]
    ? path.resolve(appDir, process.argv[3])
    : path.join(jsonDir, "credits.json");

const GO_LICENSES_FORK_MODULE = "github.com/TCOTC/go-licenses/v2@latest";

function getGoLicensesCommand() {
    let gopath = "";
    try {
        gopath = (execSync("go env GOPATH", { encoding: "utf8" }) || "").trim();
    } catch (e) { /* empty */ }
    if (!gopath) gopath = path.join(process.env.HOME || process.env.USERPROFILE || "", "go");
    const forkExe = path.join(gopath, "bin", process.platform === "win32" ? "go-licenses.exe" : "go-licenses");
    if (!fs.existsSync(forkExe)) {
        try {
            execSync("go install " + GO_LICENSES_FORK_MODULE, { encoding: "utf8", stdio: "inherit", timeout: 120000 });
        } catch (e) {
            console.warn("merge-oss-licenses: 安装 " + GO_LICENSES_FORK_MODULE + " 失败:", e.message);
        }
    }
    return { cmd: fs.existsSync(forkExe) ? forkExe : "go-licenses" };
}

function getModuleRoot(name) {
    if (!name || typeof name !== "string") return name;
    const parts = name.split("/");
    if (parts[0] === "github.com" && parts.length >= 3) return parts.slice(0, 3).join("/");
    if (parts.length > 2) return parts.slice(0, -1).join("/");
    return name;
}

// 读取前端
let frontendPackages = [];
if (fs.existsSync(frontendPath)) {
    try {
        frontendPackages = JSON.parse(fs.readFileSync(frontendPath, "utf8"));
    } catch (e) {
        console.warn("merge-oss-licenses: 读取 oss-licenses.json 失败", e.message);
    }
}

// 后端：go-licenses report --format=json
let backendPackages = [];
const goModPath = path.join(kernelDir, "go.mod");
if (fs.existsSync(goModPath)) {
    const goLicensesInvoke = getGoLicensesCommand();
    function runGoLicensesJSON() {
        const r = spawnSync(goLicensesInvoke.cmd, ["report", "./...", "--format=json"], {
            cwd: kernelDir,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "inherit"],
        });
        if (r.stderr) process.stderr.write(r.stderr);
        return (r.stdout || "").trim();
    }
    let jsonRaw = runGoLicensesJSON();
    if (!jsonRaw) {
        // 可能 GOPATH/bin 里是上游 go-licenses（不支持 --format=json），强制安装 fork 后重试
        try {
            execSync("go install " + GO_LICENSES_FORK_MODULE, { encoding: "utf8", stdio: "inherit", timeout: 120000 });
            jsonRaw = runGoLicensesJSON();
        } catch (e) { /* empty */ }
    }
    if (jsonRaw) {
        try {
            backendPackages = JSON.parse(jsonRaw);
        } catch (e) {
            console.warn("merge-oss-licenses: go-licenses JSON 解析失败", e.message);
        }
    }
    backendPackages = backendPackages.filter((p) => !p.name || !p.name.startsWith("github.com/siyuan-note/"));
    // 按模块合并
    const byRoot = new Map();
    for (const p of backendPackages) {
        const root = getModuleRoot(p.name);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(p);
    }
    backendPackages = [];
    for (const [root, group] of byRoot) {
        const licenses = [...new Set(group.flatMap((p) => (p.license || "Unknown").split(/[,;]/).map((s) => s.trim())).filter(Boolean))];
        const first = group[0];
        backendPackages.push({
            name: root,
            license: licenses.join(", "),
            licenseText: group.map((p) => p.licenseText).find(Boolean) || first.licenseText || "",
        });
    }
}

// 前端条目统一为 { name, license?, licenseText? }
const frontendOut = frontendPackages.map((p) => ({
    name: p.name || "",
    license: p.license || "",
    licenseText: p.licenseText || "",
}));

const credits = { frontend: frontendOut, backend: backendPackages };
fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
fs.writeFileSync(outJsonPath, JSON.stringify(credits, null, "\t"), "utf8");
console.log("merge-oss-licenses: 已写入 " + outJsonPath + "（前端 " + frontendOut.length + " 项，后端 " + backendPackages.length + " 项）");
