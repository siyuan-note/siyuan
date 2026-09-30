const {spawn} = require("child_process");
const path = require("path");
const {Arch} = require("electron-builder");

function prepareArguments(context) {
    const platform = context.electronPlatformName === "win32" ? "windows" : context.electronPlatformName;
    if (!["windows", "darwin", "linux"].includes(platform) || ![Arch.arm64, Arch.x64].includes(context.arch)) {
        throw new Error("Unsupported OCR packaging target");
    }
    const arch = context.arch === Arch.arm64 ? "arm64" : "amd64";
    const args = [path.resolve(__dirname, "../../scripts/prepare-ocr.py"), "--runtime", `${platform}-${arch}`];
    if (platform === "linux") {
        args.push("--build-worker");
    }
    return args;
}

module.exports = async function beforePack(context) {
    const args = prepareArguments(context);
    await new Promise((resolve, reject) => {
        const child = spawn(process.platform === "win32" ? "python" : "python3", args, {stdio: "inherit"});
        child.on("error", reject);
        child.on("exit", code => code === 0 ? resolve() : reject(new Error(`OCR resource preparation failed: ${code}`)));
    });
};

module.exports.prepareArguments = prepareArguments;
