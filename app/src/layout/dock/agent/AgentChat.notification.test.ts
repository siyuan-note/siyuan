import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
    ScriptTarget.Latest, true);
const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "AgentChat");
assert.ok(declaration && isClassDeclaration(declaration));
const methods = ["handleSSEEvent", "notifyRunInteraction"].map(name => {
    const method = declaration.members.find(item => item.name?.getText(source) === name);
    assert.ok(method);
    return method.getText(source);
});
const compiled = transpileModule(`class Chat { ${methods.join("\n")} } globalThis.Chat = Chat;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

test("current-session questions notify desktop and mobile hosts without answering the question", async () => {
    for (const mobile of [false, true]) {
        const notifications: string[] = [];
        let rendered = 0;
        const context: any = {
            window: {siyuan: {languages: {agentNotifyConfirm: "Pending confirmation"}}},
            document: {hidden: true, hasFocus: () => false},
            notifyAgentInteraction: (title: string) => notifications.push(title),
        };
        runInNewContext(compiled, context);
        const chat = Object.assign(new context.Chat(), {
            host: mobile ? {notify: (type: string) => notifications.push(type)} : {},
            notifiedSessions: new Set(),
            appendQuestion: () => { rendered++; },
        });
        await chat.handleSSEEvent({type: "question", questionID: "question", arguments: {}});
        assert.equal(rendered, 1);
        assert.deepEqual(notifications, [mobile ? "confirm" : "Pending confirmation"]);
    }
});

test("mobile notifications are suppressed only when the agent is actually visible in the foreground", () => {
    const mobile = transpileModule(readFileSync("src/mobile/agent/MobileAgentChat.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const notifications: string[] = [];
    const messages: string[] = [];
    const context: any = {
        exports: {},
        require: () => ({sendNotification: ({title}: {title: string}) => notifications.push(title),
            showMessage: (title: string) => messages.push(title)}),
        window: {siyuan: {languages: {agentNotifyConfirm: "Pending", agentNotifyDone: "Done"}}},
        document: {hidden: false, hasFocus: () => true, getElementById: (): null => null, querySelector: (): null => null},
    };
    runInNewContext(mobile + "\nglobalThis.notifyAgent = notify; globalThis.setRoot = value => { rootElement = value; };", context);
    const sidebar = {style: {transform: "translateX(0px)"}};
    const panel = {classList: {contains: () => false}, closest: () => sidebar};
    context.setRoot({closest: () => panel});
    context.notifyAgent("confirm");
    assert.deepEqual(notifications, []);
    assert.deepEqual(messages, []);
    context.document.hidden = true;
    context.notifyAgent("confirm");
    context.notifyAgent("done");
    assert.deepEqual(notifications, ["Pending", "Done"]);
    context.document.hidden = false;
    sidebar.style.transform = "";
    context.notifyAgent("confirm");
    assert.deepEqual(messages, ["Pending"]);
});
