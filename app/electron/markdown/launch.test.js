const assert = require("node:assert/strict");
const {test} = require("node:test");
const {parseMarkdownLaunch} = require("./launch");

test("Markdown launch resolves Windows files against the sender working directory", () => {
    assert.deepEqual(parseMarkdownLaunch(["siyuan.exe", "notes/a.MD", "C:\\docs\\b.markdown", "notes/A.md"],
        "D:\\workspace", {startIndex: 1, platform: "win32"}), {
        requested: true, files: ["D:\\workspace\\notes\\a.MD", "C:\\docs\\b.markdown"], newDocument: false,
    });
});

test("explicit Markdown flags support a new document and file arguments", () => {
    assert.deepEqual(parseMarkdownLaunch(["--markdown"], "/home/user", {platform: "linux"}),
        {requested: true, files: [], newDocument: true});
    assert.deepEqual(parseMarkdownLaunch(["--markdown", "a.md", "--markdown=b.markdown"], "/home/user", {platform: "linux"}),
        {requested: true, files: ["/home/user/a.md", "/home/user/b.markdown"], newDocument: false});
    assert.deepEqual(parseMarkdownLaunch(["--markdown=", "a.md"], "/home/user", {platform: "linux"}),
        {requested: true, files: ["/home/user/a.md"], newDocument: true});
});

test("normal workspace arguments, URLs and the development entry point never open Markdown", () => {
    assert.deepEqual(parseMarkdownLaunch(["electron", "/source/main.md", "--workspace=notes.md", "https://host/a.md", "siyuan://blocks/a.md"],
        "/home/user", {startIndex: 2, platform: "linux"}), {requested: false, files: [], newDocument: false});
});

test("file URLs and option-like names after the separator stay local file selections", () => {
    assert.deepEqual(parseMarkdownLaunch(["file:///home/user/a%20b.md", "--", "--name.md"], "/home/user", {platform: "linux"}),
        {requested: true, files: ["/home/user/a b.md", "/home/user/--name.md"], newDocument: false});
});
