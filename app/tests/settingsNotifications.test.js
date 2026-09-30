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

for (const file of ["src/index.ts", "src/window/index.ts", "src/mobile/util/onMessage.ts", "src/config/setting/window.ts"]) {
    test(`storage pushes notify the active streaming renderer without losing platform hooks (${file})`, () => {
        const source = sourceFile(file);
        const clauses = [];
        const visit = node => {
            if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && storageCommands.includes(node.expression.text)) {
                clauses.push(node.getText(source));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        assert.equal(clauses.length, storageCommands.length);
        const preference = {};
        const events = [];
        const storage = {};
        const window = {siyuan: {storage}, dispatchEvent: event => {
            events.push(event.type);
            agent.checkStreamingMarkdownChanged();
        }};
        runInNewContext(compile(readFileSync("src/config/tabs/ai/agentStreamingMarkdown.ts", "utf8")), {
            exports: preference, window, require: () => ({setStorageVal() {}}),
            CustomEvent: class {constructor(type) {this.type = type;}},
        });
        const agentSource = sourceFile("src/layout/dock/agent/AgentChat.ts");
        const agentClass = agentSource.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "AgentChat");
        const check = agentClass.members.find(member => member.name?.getText(agentSource) === "checkStreamingMarkdownChanged");
        const agentExports = {};
        runInNewContext(compile(`export class Observer {${check.getText(agentSource)}}`), {
            exports: agentExports, isAgentStreamingMarkdownEnabled: preference.isAgentStreamingMarkdownEnabled,
        });
        const body = {textContent: "cached", classList: {remove() {}}};
        let renders = 0;
        const agent = Object.assign(new agentExports.Observer(), {
            streamingMarkdownEnabled: false, currentContent: "cached", currentAIElement: {querySelector: () => body},
            cancelTokenUpdate() {}, updateStreamingMarkdown: () => {renders++; body.textContent = "rendered";},
        });
        const platformCalls = [];
        const receiver = {};
        runInNewContext(compile(`export const receive = data => {switch(data.cmd){${clauses.join("\n")}}};`), {
            exports: receiver, window, ...preference,
            onWindowWorkspaceStorageChanged: key => platformCalls.push(key),
            MOBILE_BARS_CONFIG_KEY: "mobile-bars", Constants: {LOCAL_MOBILE_BOTTOM_BAR: "mobile-bottom", LOCAL_MOBILE_SIDE_PANEL: "mobile-side"},
            showMobileBars: () => platformCalls.push("bars"), renderMobileBottomBar: () => platformCalls.push("bottom"),
            dispatchMobileSidePanelConfigChange: () => platformCalls.push("side"),
        });
        const key = preference.AGENT_STREAMING_MARKDOWN_KEY;
        receiver.receive({cmd: "setLocalStorageVal", data: {key, val: true}});
        assert.equal(agent.streamingMarkdownEnabled, true);
        assert.equal(body.textContent, "rendered");
        assert.equal(renders, 1);
        receiver.receive({cmd: "setLocalStorageVal", data: {key: "unrelated", val: 1}});
        assert.equal(events.length, 1);
        receiver.receive({cmd: "setLocalStorageVal", data: {key, val: true}});
        assert.equal(renders, 1);
        receiver.receive({cmd: "setLocalStorageVals", data: {keyVals: {[key]: false, "mobile-bottom": true}}});
        assert.equal(agent.streamingMarkdownEnabled, false);
        assert.equal(body.textContent, "cached");
        receiver.receive({cmd: "setLocalStorageVal", data: {key, val: true}});
        receiver.receive({cmd: "removeLocalStorageVal", data: {key}});
        assert.equal(agent.streamingMarkdownEnabled, false);
        assert.ok(!Object.hasOwn(storage, key));
        receiver.receive({cmd: "setLocalStorageVal", data: {key, val: true}});
        receiver.receive({cmd: "removeLocalStorageVals", data: {keys: [key, "mobile-side"]}});
        assert.equal(agent.streamingMarkdownEnabled, false);
        assert.equal(body.textContent, "cached");
        assert.ok(events.every(type => type === preference.AGENT_STREAMING_MARKDOWN_CHANGED_EVENT));
        assert.equal(events.length, 7);
        if (file.includes("mobile/")) assert.deepEqual(platformCalls, ["bottom", "side"]);
        if (file.includes("window/index")) assert.ok(platformCalls.includes(key));
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
