import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";

test("template management uses the grid icon on desktop and mobile", () => {
    for (const [file, templateId] of [
        ["workspace.ts", "templateManager"],
        ["../mobile/menu/mainMenu.ts", "menuTemplateManager"],
    ]) {
        const source = readFileSync(path.resolve(__dirname, file), "utf8");
        const icon = (id: string) => source.match(new RegExp(`id: "${id}"[\\s\\S]*?icon: "([^"]+)"`))?.[1];
        assert.equal(icon(templateId), "iconLayoutGrid");
    }
    const icons = readFileSync(path.resolve(__dirname, "../../appearance/icons/litheness/icon.js"), "utf8");
    assert.match(icons, /id="iconLayoutGrid"/);
});

test("the mobile Markdown entry uses the Markdown icon", () => {
    const source = readFileSync(path.resolve(__dirname, "../mobile/menu/mainMenu.ts"), "utf8");
    assert.match(source, /id: "menuMarkdownEditor",\s*icon: "iconMarkdown"/);
});
