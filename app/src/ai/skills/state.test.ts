import * as assert from "node:assert/strict";
import {test} from "node:test";
import {canChangeSkillEntry, getSkillDirectory, isSkillEntryPoint, SkillSourceState} from "./state";

test("skill entry points and resources cannot be renamed or deleted separately", () => {
    assert.equal(isSkillEntryPoint({path: "review/SKILL.md", isDir: false, editable: true}), true);
    assert.equal(canChangeSkillEntry({path: "review/skill.MD", isDir: false, editable: true}), false);
    assert.equal(canChangeSkillEntry({path: "review/references/SKILL.md", isDir: false, editable: true}), true);
    assert.equal(canChangeSkillEntry({path: "review/run.js", isDir: false, editable: false}), false);
    assert.equal(canChangeSkillEntry({path: "review/run.js", isDir: false, editable: true}), true);
    assert.equal(canChangeSkillEntry({path: "review/.claude/.config.json", isDir: false, editable: true}), true);
    assert.equal(canChangeSkillEntry({path: "review", isDir: true, editable: false}), true);
    assert.equal(canChangeSkillEntry(undefined), false);
});

test("new text files stay inside the selected skill directory", () => {
    assert.equal(getSkillDirectory(), "");
    assert.equal(getSkillDirectory({path: "review", isDir: true, editable: false}), "review");
    assert.equal(getSkillDirectory({path: "review/references/info.md", isDir: false, editable: true}), "review/references");
    assert.equal(getSkillDirectory({path: "loose.md", isDir: false, editable: false}), "");
});

test("text editing preserves UTF-8 BOM and uniform line endings without evaluating scripts", () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
        const state = new SkillSourceState();
        const content = "\ufeffprint('text only')" + newline;
        state.load("skill/.script.py", content, "original");
        assert.equal(state.content, content);
        state.text += "# edited\n";
        assert.equal(state.content, content + "# edited" + newline);
        state.acceptSave("new");
        assert.equal(state.dirty, false);
    }
});

test("editing preserves Markdown front matter, Unicode, and CRLF", () => {
    const state = new SkillSourceState();
    const content = "---\r\nname: review\r\ndescription: \"检查\"\r\n---\r\n\r\n# Notes\r\n";
    state.load("folder/SKILL.md", content, "original");
    assert.equal(state.content, content);
    state.text += "更多内容\n";
    assert.equal(state.dirty, true);
    assert.equal(state.content, content + "更多内容\r\n");
    assert.equal(state.revision, "original");
    state.acceptSave("updated");
    assert.equal(state.dirty, false);
    assert.equal(state.revision, "updated");
});

test("a rejected save retains draft and original revision, and discard restores the saved version", () => {
    const state = new SkillSourceState();
    state.load("folder/SKILL.md", "saved\n", "original");
    state.text = "draft\n";
    assert.equal(state.content, "draft\n");
    assert.equal(state.revision, "original");
    assert.equal(state.dirty, true);
    state.discard();
    assert.equal(state.content, "saved\n");
    assert.equal(state.dirty, false);
});

test("unchanged mixed line endings retain the original source", () => {
    const state = new SkillSourceState();
    const content = "---\r\nname: review\n---\r\n正文\r\n";
    state.load("review/SKILL.md", content, "original");
    assert.equal(state.content, content);
    state.text += "extra";
    state.discard();
    assert.equal(state.content, content);
});
