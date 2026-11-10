// 启动菜单的语言来源（`window/appMenu.ts`）：独立 Markdown 入口不读取工作空间配置。
// 被测模块在测试内 require：它在加载时从 electron 替身取成员。
import {test} from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {paths, state} from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
const assert = require("node:assert/strict");

const appDir = path.join(__dirname, "..", "..");
paths.appDir = appDir;

const readLanguages = (lang: string) =>
    JSON.parse(fs.readFileSync(path.join(appDir, "appearance", "langs", `${lang}.json`), "utf8"));

type MenuItemNode = {role?: string; label?: string};

test("a file entry keeps the startup menu off the workspace configuration", (t: any) => {
    resetElectronStub();
    let applied: MenuItemNode[] = [];
    mockElectron(t, {
        app: {getPreferredSystemLanguages: () => ["en-US"]} as any,
        Menu: {buildFromTemplate: (template: MenuItemNode[]) => template,
            setApplicationMenu: (menu: MenuItemNode[]) => { applied = menu; }} as any,
    });
    const {setStartupApplicationMenu} = require("./appMenu");

    // 工作空间记录里是中文，独立 Markdown 入口不应读取它。
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-menu-"));
    fs.mkdirSync(path.join(workspace, "conf"), {recursive: true});
    fs.writeFileSync(path.join(workspace, "conf", "conf.json"), JSON.stringify({appearance: {lang: "zh-CN"}}));
    const savedStartup = state.startup;
    const savedMarkdown = state.markdown.startup;
    t.after(() => {
        state.startup = savedStartup;
        state.markdown.startup = savedMarkdown;
        fs.rmSync(workspace, {recursive: true, force: true});
        resetElectronStub();
    });

    state.startup = Object.freeze({...savedStartup, lastWorkspacePath: workspace, remoteKernelTarget: undefined});
    state.markdown.startup = false;
    setStartupApplicationMenu();
    assert.equal(applied.find(item => item.role === "editMenu")?.label, readLanguages("zh-CN").edit);

    state.markdown.startup = true;
    setStartupApplicationMenu();
    assert.equal(applied.find(item => item.role === "editMenu")?.label, readLanguages("en").edit);
});
