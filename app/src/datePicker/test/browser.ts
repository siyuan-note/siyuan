import {execFile} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

export const canRunBrowser = existsSync(require("electron"));
export const browserSources = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([key, path]) =>
    [key, transpileModule(readFileSync(path, "utf8"), {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText]));

export const runBrowserCase = async (callback: (sources: Record<string, string>, css: string) => Promise<string>,
                                     sources: Record<string, string>, css = "", options: {width?: number; height?: number} = {}) => {
    const width = options.width || 900;
    const height = options.height || 900;
    const temporary = mkdtempSync(join(tmpdir(), "siyuan-date-picker-"));
    const callbackSource = transpileModule(`(${callback.toString()})`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText.trim().replace(/;$/, "");
    const expression = `const __name = value => value; ${callbackSource}(${JSON.stringify(sources)},${JSON.stringify(css)})`;
    try {
        const script = join(temporary, "run.cjs");
        writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(join(temporary, "profile"))});app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,useContentSize:true,width:${width},height:${height},webPreferences:{contextIsolation:false}});
try{await win.loadURL("data:text/html,<html><body></body></html>");win.show();win.focus();
if(await win.webContents.executeJavaScript("innerWidth")!==${width}||await win.webContents.executeJavaScript("innerHeight")!==${height})throw Error("Unexpected browser viewport");
console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));app.exit(0);}
catch(error){console.error(error);app.exit(1);}});`, "utf8");
        const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: join(temporary, "cache"), XDG_CONFIG_HOME: join(temporary, "config"),
            XDG_DATA_HOME: join(temporary, "data")}; delete env.ELECTRON_RUN_AS_NODE;
        const flags = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless", "--ozone-override-screen-size=1200,1200"] : [];
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [...flags, script], {env, timeout: 30000, windowsHide: true});
            return stdout;
        } catch (error) {
            const stderr = String((error as {stderr?: string}).stderr || error);
            const locations = Array.from(stderr.matchAll(/at <anonymous>:(\d+):(\d+)/g));
            const location = locations.at(-1);
            const line = location && expression.split("\n")[Number(location[1]) - 1];
            const context = line?.substring(Math.max(0, Number(location[2]) - 120), Number(location[2]) + 120);
            throw new Error(stderr + (context ? "\nBrowser source: " + context : ""), {cause: error});
        }
    } finally { rmSync(temporary, {recursive: true, force: true}); }
};
