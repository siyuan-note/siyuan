const assert = require("node:assert/strict");
const {test} = require("node:test");
const {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join, resolve} = require("node:path");
const {spawnSync} = require("node:child_process");

test("menu ownership rejects unowned openings and accepts explicit interaction policies", () => {
    const prefix = join(realpathSync(tmpdir()), "siyuan-menu-owner-");
    const directory = mkdtempSync(prefix);
    try {
        mkdirSync(join(directory, "scripts"));
        mkdirSync(join(directory, "app/src"), {recursive: true});
        writeFileSync(join(directory, "app/package.json"), "{}", "utf8");
        writeFileSync(join(directory, "scripts/menu-owner-exceptions.json"), "{}", "utf8");
        copyFileSync(join(__dirname, "../../scripts/check-menu-owner.mjs"), join(directory, "scripts/check-menu-owner.mjs"));
        for (const [source, accepted, message] of [
            ["window.siyuan.menus.menu.popup({x: 0, y: 0});", false, "unowned menu"],
            ["const picker = new Menu(); picker.open({x: 0, y: 0});", false, "unowned menu"],
            ["new Menu().open({x: 0, y: 0});", false, "unowned menu"],
            ["toggleMenu({build: () => {}, show: menu => menu.popup({x: 0, y: 0})});", false, "requires target"],
            ["toggleMenu({target: button, build: menu => menu.addItem({}), show: menu => menu.fullscreen('bottom')});", true],
            ["toggleMenu({toggle: false, build: menu => menu.popup({x: 0, y: 0})});", true],
        ]) {
            writeFileSync(join(directory, "app/src/probe.ts"), source, "utf8");
            const result = spawnSync(process.execPath, [join(directory, "scripts/check-menu-owner.mjs")], {
                encoding: "utf8", env: {...process.env, NODE_PATH: resolve(__dirname, "../node_modules")},
            });
            assert.equal(result.status, accepted ? 0 : 1, result.stderr);
            if (message) { assert.ok(result.stderr.includes(message), result.stderr); }
        }
    } finally {
        assert.ok(resolve(directory).startsWith(prefix));
        rmSync(directory, {recursive: true, force: true});
    }
});
