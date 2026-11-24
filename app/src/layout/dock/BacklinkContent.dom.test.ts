import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {compile} from "sass";
import {canRunBrowser, runBrowserCase} from "../../datePicker/test/browser";

test("反链侧栏在最小宽度显示计数和操作按钮", {timeout: 45000, skip: !canRunBrowser}, async () => {
    const source = readFileSync(join(__dirname, "BacklinkContent.ts"), "utf8");
    const template = source.match(/this\.element\.innerHTML = (`<div class="block__icons backlinkList__header">[\s\S]*?`);/)[1];
    const css = readFileSync("appearance/themes/daylight/theme.css", "utf8") +
        compile("src/assets/scss/base.scss", {logger: {warn() {}}}).css;
    const result = await runBrowserCase(async ({template}, css) => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        const panel = document.createElement("div");
        panel.className = "sy__backlink file-tree";
        panel.style.cssText = "width:320px; position:absolute; top:0; left:0; font-size:20px";
        document.body.append(panel);
        const render = new Function("window", "updateHotkeyAfterTip", "backlinkSort", "backmentionSort", "return " + template);
        panel.innerHTML = render.call({type: "pin"}, {
            siyuan: {
                languages: {backlinks: "反向链接", mentions: "Erwähnungen", search: "Search"},
                config: {keymap: {general: {closeTab: {}}, editor: {general: {expand: {}, collapse: {}}}}},
            },
        }, () => "", 0, 0);
        panel.querySelectorAll(".counter").forEach(count => count.textContent = "123");
        return "反链侧栏已渲染";
    }, {template}, css, {interact: async win => {
        const debug = win.webContents.debugger;
        await debug.sendCommand("DOM.enable");
        await debug.sendCommand("CSS.enable");
        const {root} = await debug.sendCommand("DOM.getDocument");
        const {nodeId} = await debug.sendCommand("DOM.querySelector", {nodeId: root.nodeId, selector: ".sy__backlink"});
        await debug.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: ["hover"]});
        return win.webContents.executeJavaScript(`JSON.stringify((() => {
            const panel = document.querySelector(".sy__backlink");
            const counts = Array.from(panel.querySelectorAll(".counter"), count => {
                const range = document.createRange();
                range.selectNodeContents(count);
                const digits = range.getBoundingClientRect();
                const logo = count.parentElement.getBoundingClientRect();
                const actions = Array.from(count.closest(".block__icons").querySelectorAll(".block__icon"))
                    .filter(action => action.getBoundingClientRect().width > 0);
                return {digits: digits.toJSON(), logo: logo.toJSON(), firstAction: actions[0]?.getBoundingClientRect().left};
            });
            return counts;
        })())`);
    }});
    const counts = JSON.parse(result);
    assert.equal(counts.length, 2);
    for (const {digits, logo, firstAction} of counts) {
        assert.ok(digits.width > 0 && digits.right <= logo.right && digits.right <= firstAction, result);
    }
});
