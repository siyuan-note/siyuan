const {spawn} = require("node:child_process");
const path = require("node:path");

const signingPin = process.env.SIYUAN_RELEASE_SIGN_PIN;
delete process.env.SIYUAN_RELEASE_SIGN_PIN;

// 智能卡逐个处理签名，前一项失败时停止后续认证。
let queue = Promise.resolve();
exports.default = function (options) {
    queue = queue.then(() => sign(options));
    return queue;
};

async function sign(options, retry = true) {
    const thumbprint = options.options.signtoolOptions.certificateSha1;
    if (!signingPin || options.hash !== "sha256" || !/^[0-9a-f]{40}$/i.test(thumbprint || "")) {
        throw new Error("The hardware signing configuration is invalid");
    }
    await new Promise((resolve, reject) => {
        const env = {...process.env};
        delete env.PSModulePath;
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            path.join(__dirname, "release-sign-windows.ps1")],
        {windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"]});
        let output = "";
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error("Hardware signing timed out"));
        }, 120000);
        child.stdout.on("data", data => { output += data.toString("utf8"); });
        child.stderr.on("data", () => {});
        child.stdin.on("error", () => {});
        child.on("error", () => {
            clearTimeout(timeout);
            reject(new Error("Unable to start Windows hardware signing"));
        });
        child.on("close", code => {
            clearTimeout(timeout);
            if (code === 0) {
                process.stdout.write(output);
                resolve();
            } else if (code === 20 && retry) {
                setTimeout(() => { sign(options, false).then(resolve, reject); }, 1000);
            } else {
                reject(new Error("Hardware signing failed; check the PIN, token, certificate and timestamp connection"));
            }
        });
        child.stdin.end(JSON.stringify({pin: signingPin, thumbprint, files: [options.path]}) + "\n");
    });
}
