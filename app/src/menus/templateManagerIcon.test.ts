import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";

test("template management and Markdown editing have distinct existing icons on desktop and mobile", () => {
    for (const [file, templateId, editorId] of [
        ["workspace.ts", "templateManager", "markdownEditor"],
        ["../mobile/menu/mainMenu.ts", "menuTemplateManager", "menuMarkdownEditor"],
    ]) {
        const source = readFileSync(path.resolve(__dirname, file), "utf8");
        const icon = (id: string) => source.match(new RegExp(`id: "${id}"[\\s\\S]*?icon: "([^"]+)"`))?.[1];
        assert.equal(icon(templateId), "iconLayoutGrid");
        assert.equal(icon(editorId), "iconMarkdown");
    }
    const icons = readFileSync(path.resolve(__dirname, "../../appearance/icons/litheness/icon.js"), "utf8");
    assert.match(icons, /id="iconLayoutGrid"/);
});
