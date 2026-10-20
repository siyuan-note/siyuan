import {readFileSync, readdirSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const directory = new URL("../appearance/langs/", import.meta.url);
const target = new URL("../appearance/boot/startup-languages.json", import.meta.url);
const keys = ["startupFailed", "startupStage", "startupReload", "startupCopy", "startupTimeout", "startupStagePage", "startupStageConfiguration", "startupStageEngine", "startupStagePlugins", "startupStageStorage", "startupStageLanguage", "startupStageInterface", "startupCopyFailed", "copied"];
const result = {};
// 启动错误提示独立打包，语言文件无法读取时仍可使用当前语言。
for (const file of readdirSync(directory).filter(file => file.endsWith(".json")).sort()) {
    const language = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    result[file.slice(0, -5)] = Object.fromEntries(keys.map(key => {
        if (typeof language[key] !== "string" || !language[key]) throw new Error(`${file}: ${key}`);
        return [key, language[key]];
    }));
}
const output = JSON.stringify(result, null, "\t") + "\n";
if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== output) throw new Error("Run node scripts/startup-languages.mjs");
} else {
    writeFileSync(target, output);
}
console.log(fileURLToPath(target));
