const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const sourceFile = file => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2021, true);
const compile = source => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const storageCommands = ["setLocalStorageVal", "setLocalStorageVals", "removeLocalStorageVal", "removeLocalStorageVals"];

// 各处存储推送只更新 window.siyuan.storage，不能丢掉各自平台已有的钩子。
for (const [file, expectedCalls] of [
    ["src/index.ts", []],
    ["src/window/index.ts", ["window:zoom", "window:zoom", "window:mobile-bottom", "window:zoom",
        "window:zoom", "window:mobile-side"]],
    ["src/mobile/util/onMessage.ts", ["mobile:bottom", "mobile:side"]],
    ["src/config/setting/windowRuntime.ts", ["desktop:zoom", "desktop:zoom", "desktop:zoom", "desktop:zoom"]],
]) {
    test(`storage pushes keep platform hooks (${file})`, () => {
        const source = sourceFile(file);
        const clauses = [];
        let storageChanged = "";
        const visit = node => {
            if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
                item.name.getText(source) === "onStorageChanged")) storageChanged = node.getText(source);
            if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && storageCommands.includes(node.expression.text)) {
                clauses.push(node.getText(source));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        assert.equal(clauses.length, storageCommands.length);
        const calls = [];
        const storage = {};
        const receiver = {};
        runInNewContext(compile(`let zoomRevision = 0; ${storageChanged}
export const receive = data => {switch(data.cmd){${clauses.join("\n")}}};`), {
            exports: receiver, window: {siyuan: {storage}},
            onWindowWorkspaceStorageChanged: key => calls.push(`window:${key}`),
            renderMobileBottomBar: () => calls.push("mobile:bottom"),
            dispatchMobileSidePanelConfigChange: () => calls.push("mobile:side"),
            applyZoom: () => calls.push("desktop:zoom"),
            Constants: {LOCAL_MOBILE_BOTTOM_BAR: "mobile-bottom", LOCAL_MOBILE_SIDE_PANEL: "mobile-side", LOCAL_ZOOM: "zoom"},
        });
        receiver.receive({cmd: "setLocalStorageVal", data: {key: "zoom", val: 2}});
        receiver.receive({cmd: "setLocalStorageVals", data: {keyVals: {zoom: 3, "mobile-bottom": true}}});
        receiver.receive({cmd: "removeLocalStorageVal", data: {key: "zoom"}});
        receiver.receive({cmd: "removeLocalStorageVals", data: {keys: ["zoom", "mobile-side"]}});
        assert.deepEqual(calls, expectedCalls);
        assert.deepEqual(storage, {"mobile-bottom": true});
    });
}

test("cloud account pushes and responses deliver one login notification after UI state is applied", () => {
    const events = [];
    const order = [];
    const window = {siyuan: {user: null}, dispatchEvent: event => {
        events.push(event.type);
        order.push("login");
    }};
    const cloud = {};
    runInNewContext(compile(readFileSync("src/config/tabs/cloudUser.ts", "utf8")), {exports: cloud, window});
    const source = sourceFile("src/config/tabs/accountUi.ts");
    const apply = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(source) === "applyCloudUserState"));
    const account = {};
    runInNewContext(compile(apply.getText(source)), {
        exports: account, window, ...cloud, syncTabElement: {},
        renderAccount: () => order.push("account"), refreshSyncCloudSpaceGroup: () => order.push("space"),
        onSetaccount: () => order.push("toolbar"), processSync: () => order.push("sync"),
        CustomEvent: class {constructor(type) {this.type = type;}},
    });
    const user = {userId: "alice", userName: "Alice"};
    account.applyCloudUserState(user);
    assert.deepEqual(order, ["account", "space", "toolbar", "sync", "login"]);
    account.applyCloudUserState({...user});
    account.applyCloudUserState({...user, userNickname: "Updated"});
    assert.deepEqual(events, ["siyuan-login-success"]);
    assert.equal(window.siyuan.user.userNickname, "Updated");
    account.applyCloudUserState({userId: "bob", userName: "Bob"});
    assert.equal(events.length, 2);
    account.applyCloudUserState(null, "Bob");
    assert.equal(events.length, 2);
    account.applyCloudUserState({userId: "bob", userName: "Bob"});
    assert.equal(events.length, 3);
    assert.equal(order.at(-1), "login");
});
