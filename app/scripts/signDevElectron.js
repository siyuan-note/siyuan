/**
 * macOS 开发环境：为 node_modules 中的 Electron.app 代码签名。
 *
 * 背景：Electron 42+ 在 macOS 上使用 UNNotification，要求应用具备有效代码签名；
 * 刚安装的 Electron.app 仅有 linker-signed 占位签名，开发时通知会静默失败。
 *
 * 用法（在 app 目录下）：
 *   pnpm run install:electron   # 安装 / 更新 Electron 二进制
 *   pnpm run sign:dev           # macOS 开发者手动签名，供本地通知等功能使用
 *
 * 非 macOS 平台直接跳过。无可用证书时仅打印提示并以退出码 0 结束。
 * 可通过环境变量 SIYUAN_DEV_SIGN_IDENTITY 或 CSC_NAME 指定证书名称。
 */
const {execFileSync} = require("child_process");
const fs = require("fs");
const path = require("path");

const PREFERRED_IDENTITY_PATTERNS = [
    /^Apple Development:/,
    /^Developer ID Application:/,
    /^Mac Developer:/,
];

function resolveElectronApp() {
    let electronPkg;
    try {
        electronPkg = require.resolve("electron/package.json");
    } catch {
        return null;
    }
    const appPath = path.join(path.dirname(electronPkg), "dist", "Electron.app");
    return fs.existsSync(appPath) ? appPath : null;
}

function listCodeSignIdentities() {
    let output;
    try {
        output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
            encoding: "utf8",
        });
    } catch {
        return [];
    }
    const identities = [];
    for (const line of output.split("\n")) {
        // 1) ABCD1234 "Apple Development: name (TEAMID)"
        const match = line.match(/^\s*\d+\)\s+[0-9A-F]+\s+"(.+)"\s*$/);
        if (match) {
            identities.push(match[1]);
        }
    }
    return identities;
}

function pickIdentity(identities) {
    const envIdentity = process.env.SIYUAN_DEV_SIGN_IDENTITY || process.env.CSC_NAME;
    if (envIdentity) {
        if (identities.includes(envIdentity)) {
            return envIdentity;
        }
        console.warn(`sign:dev: identity not found: ${envIdentity}, auto-selecting`);
    }
    for (const pattern of PREFERRED_IDENTITY_PATTERNS) {
        const found = identities.find((name) => pattern.test(name));
        if (found) {
            return found;
        }
    }
    return identities[0] || null;
}

function getCodesignInfo(appPath) {
    try {
        const result = require("child_process").spawnSync("codesign", ["-dvv", appPath], {encoding: "utf8"});
        return (result.stdout || "") + (result.stderr || "");
    } catch {
        return "";
    }
}

function isAlreadySigned(appPath) {
    const output = getCodesignInfo(appPath);
    return !/linker-signed/.test(output) && /Authority=/.test(output);
}

function main() {
    if (process.platform !== "darwin") {
        return;
    }

    const appPath = resolveElectronApp();
    if (!appPath) {
        console.warn("sign:dev: Electron.app not found, run install:electron first");
        return;
    }

    const identities = listCodeSignIdentities();
    const identity = pickIdentity(identities);
    if (!identity) {
        console.warn("sign:dev: no codesigning identity (macOS notifications may not work)");
        console.warn("sign:dev: sign in with Apple ID in Xcode, or set SIYUAN_DEV_SIGN_IDENTITY");
        return;
    }

    if (isAlreadySigned(appPath)) {
        console.log(`sign:dev: already signed (${identity})`);
        return;
    }

    console.log(`sign:dev: signing with ${identity}`);
    execFileSync("codesign", ["--force", "--deep", "--sign", identity, appPath], {stdio: "inherit"});
    console.log("sign:dev: done");
}

main();
