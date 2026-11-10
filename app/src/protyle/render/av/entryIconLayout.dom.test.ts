import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import * as sass from "sass";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

interface IconMenuFixture {
    name: string;
    html: string;
    labels: string[];
    checked: boolean[];
}

const getFixtures = (): IconMenuFixture[] => {
    const compiled = compileModule(path.join(__dirname, "layout.ts"));
    const dependencies: Record<string, unknown> = {
        "../../../constants": {Constants: {SIZE_DATABASE_MAZ_SIZE: 10000}},
        "./capabilities": {isAVSelectType: () => false},
        "./calendar/settings": {getCalendarSettingsHTML: () => ""},
        "./gallery/style": {getCardWidth: () => 240, getCardAspectRatioValue: () => 1, getCardAspectRatioLabel: () => "1:1"},
        "./gallery/cardLayout": {CARD_LAYOUT_COMPACT: 1},
    };
    const languagesPath = path.join(__dirname, "../../../../appearance/langs");
    const locales = readdirSync(languagesPath).filter(name => name.endsWith(".json")).sort();
    assert.equal(locales.length, 22);
    return locales.flatMap(locale => {
        const languages = JSON.parse(readFileSync(path.join(languagesPath, locale), "utf8"));
        const {getLayoutHTML} = evaluateModule<typeof import("./layout")>(compiled, {
            require: (name: string) => dependencies[name] || {},
            window: {siyuan: {languages}},
        });
        const labels = [languages.databaseShowIcon, languages.databaseShowRelationIcon];
        labels.forEach(label => assert.ok(typeof label === "string" && label.length > 0, locale));
        return (["table", "list", "gallery", "kanban", "calendar"] as const).flatMap(viewType =>
            [false, true].flatMap(showIcon => [undefined, false, true].map(showRelationIcon => ({
                name: `${locale}/${viewType}/${showIcon}/${showRelationIcon}`,
                html: getLayoutHTML({viewType, view: {showIcon, showRelationIcon, fields: [], columns: [],
                    calendar: {}, coverFrom: 0, pageSize: 20}} as unknown as IAV),
                labels,
                checked: [showIcon, showRelationIcon ?? showIcon],
            }))));
    });
};

const checkLayout = (fixtures: IconMenuFixture[], widths: number[]) => {
    const check = require("node:assert/strict");
    const menu = document.createElement("div");
    menu.className = "b3-menu";
    menu.style.left = "0";
    menu.style.top = "0";
    document.body.append(menu);
    let checked = 0;
    for (const fontSize of [16, 24]) {
        document.documentElement.style.setProperty("--b3-font-size", `${fontSize}px`);
        for (const width of widths) {
            menu.style.width = `${width}px`;
            for (const fixture of fixtures) {
                menu.innerHTML = fixture.html;
                const inputs = ["toggle-entries-icons", "toggle-relation-icons"].map(type =>
                    menu.querySelector<HTMLInputElement>(`input[data-type="${type}"]`));
                inputs.forEach((input, index) => {
                    const context = `${fixture.name}/${width}px/${fontSize}px/${index}`;
                    check.ok(input, context);
                    check.equal(input.checked, fixture.checked[index], context);
                    check.equal(input.type, "checkbox", context);
                    check.equal(input.labels.length, 1, context);
                    const label = input.labels[0];
                    check.equal(label.textContent.trim(), fixture.labels[index], context);
                    const text = label.querySelector<HTMLElement>(".b3-menu__label");
                    check.ok(text, context);
                    check.equal(getComputedStyle(text).fontSize, `${fontSize}px`, context);
                    const bounds = label.getBoundingClientRect();
                    const menuBounds = menu.getBoundingClientRect();
                    const switchBounds = input.getBoundingClientRect();
                    const textBounds = text.getBoundingClientRect();
                    const details = `${context}: ${JSON.stringify({bounds, menuBounds, switchBounds, textBounds})}`;
                    check.ok(bounds.left >= menuBounds.left && bounds.right <= menuBounds.right + 1, details);
                    check.ok(switchBounds.width >= 20 && switchBounds.height > 0, details);
                    check.ok(switchBounds.left >= bounds.left && switchBounds.right <= bounds.right + 1, details);
                    check.ok(switchBounds.top >= bounds.top && switchBounds.bottom <= bounds.bottom + 1, details);
                    check.ok(textBounds.right <= switchBounds.left, details);
                    check.ok(text.scrollWidth <= text.clientWidth + 1, details);
                    check.ok(text.scrollHeight <= text.clientHeight + 1, details);
                    const range = document.createRange();
                    range.selectNodeContents(text);
                    for (const line of range.getClientRects()) {
                        check.ok(line.left >= bounds.left - 1 && line.right <= switchBounds.left + 1, details);
                        check.ok(line.top >= bounds.top - 1 && line.bottom <= bounds.bottom + 1, details);
                    }
                    label.click();
                    check.equal(input.checked, !fixture.checked[index], context);
                    checked++;
                });
            }
        }
    }
    return `entry-icon-layout-ok:${checked}`;
};

for (const stylesheet of ["base", "mobile"]) {
    test(`${stylesheet} icon switches fit all locales and retain accessible labels and independent states`, {timeout: 60000}, async () => {
        const directory = mkdtempSync(path.join(tmpdir(), "siyuan-entry-icon-layout-"));
        try {
            const css = sass.compile(`src/assets/scss/${stylesheet}.scss`, {
                style: "compressed", silenceDeprecations: ["legacy-js-api"],
            }).css;
            const fixtures = getFixtures();
            const html = `<style>:root{--b3-font-family:Arial,sans-serif}</style><style>${css}</style><body></body>`;
            const execute = `const __name = value => value; document.write(${JSON.stringify(html)}); try { (${checkLayout.toString()})(${JSON.stringify(fixtures)}, ${JSON.stringify(stylesheet === "base" ? [290, 240] : [320, 240])}); } catch (error) { String(error.stack) }`;
            const script = path.join(directory, "main.cjs");
            writeFileSync(script, `const {app,BrowserWindow}=require("electron");
const {mkdirSync}=require("node:fs");
for(const [name,directory] of Object.entries(${JSON.stringify({userData: path.join(directory, "profile"), sessionData: path.join(directory, "session")})})){
mkdirSync(directory,{recursive:true});app.setPath(name,directory);}
app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,width:420,height:1200,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try{await win.loadURL("about:blank");console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));app.exit(0)}catch(error){console.error(error);app.exit(1)}});`);
            const env = {...process.env};
            delete env.ELECTRON_RUN_AS_NODE;
            const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"], {
                env, timeout: 50000, maxBuffer: 1024 * 1024, windowsHide: true,
            });
            assert.match(result.stdout, new RegExp(`entry-icon-layout-ok:${fixtures.length * 8}`));
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });
}
