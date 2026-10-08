import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml, escapeHtmlTextAndAttr} from "../../../util/escape";

const compile = (name: string) => transpileModule(readFileSync(`src/layout/dock/agent/${name}.ts`, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const renderer = compile("AgentMessageRenderer");
const chatSource = compile("AgentChat");
const loadRenderer = (languages: Record<string, string>) => {
    const exports = {} as {renderWelcomeHTML: (hasModel?: boolean) => string};
    runInNewContext(renderer, {exports, require: () => ({escapeHtml, escapeHtmlTextAndAttr}), window: {siyuan: {languages}}});
    return exports.renderWelcomeHTML;
};

test("every language renders plugin development as the fourth welcome suggestion", () => {
    for (const file of readdirSync("appearance/langs").filter(file => file.endsWith(".json"))) {
        const languages = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        const render = loadRenderer(languages);
        const examples = [...render().matchAll(/class="agent-welcome__example" data-text="([^"]*)">([^<]*)<\/div>/g)];
        assert.equal(examples.length, 4, file);
        for (let i = 0; i < 4; i++) {
            const escape = i === 3 ? escapeHtmlTextAndAttr : escapeHtml;
            assert.equal(examples[i][1], escape(languages[`agentExample${i + 1}`]), file);
        }
        assert.equal(examples[3][2], escapeHtmlTextAndAttr(languages.agentExample4), file);
        assert.doesNotMatch(render(false), /agent-welcome__example/);
    }
    assert.equal(JSON.parse(readFileSync("appearance/langs/zh-CN.json", "utf8")).agentExample4, "帮我开发一个插件");
});

test("plugin suggestion escapes its label and click payload", () => {
    const html = loadRenderer({agentExample4: 'Develop a plugin for "A&B" <test>'})();
    assert.ok(html.includes('data-text="Develop a plugin for &quot;A&amp;B&quot; &lt;test&gt;">Develop a plugin for &quot;A&amp;B&quot; &lt;test&gt;</div>'));
});

test("plugin suggestion uses the existing localized message sending path", async () => {
    const text = "帮我开发一个插件";
    const languages = {agentExample4: text};
    const sends: unknown[][] = [];
    let click: () => Promise<void>;
    const example = {
        getAttribute: (name: string) => name === "data-text" ? text : null,
        addEventListener: (_event: string, callback: () => Promise<void>) => click = callback,
    };
    const exports = {} as {AgentChat: {prototype: object}};
    runInNewContext(chatSource, {
        exports,
        require: () => ({
            Model: class {},
            renderWelcomeHTML: loadRenderer(languages),
            SessionStore: {newSessionId: () => "entry", getRevision: () => 1},
            fetchAgentSSE: async (...args: unknown[]) => { sends.push(args); },
        }),
        window: {siyuan: {languages, config: {appearance: {lang: "zh-CN"}}}},
    });
    const chat = Object.create(exports.AgentChat.prototype);
    Object.assign(chat, {
        modelOptions: [{id: "model"}], entries: [], composer: {},
        messagesContainer: {innerHTML: "", querySelectorAll: () => [example]},
        getSelectedModel: () => "model",
        beginSessionRun: () => ({sessionID: "session", controller: {signal: {}}}),
    });
    for (const method of ["destroyEditingComposer", "appendUserMessage", "rebuildNavMarkers", "tryGenerateTitle",
        "setStreaming", "saveSession", "finishSessionRun"]) {
        chat[method] = (): void => undefined;
    }
    chat.showWelcome();
    await click();
    assert.equal(sends.length, 1);
    assert.equal(sends[0][0], text);
    assert.equal(sends[0][1], "zh-CN");
    assert.equal(chat.entries.length, 1);
    assert.equal(chat.entries[0].type, "user");
    assert.equal(chat.entries[0].content, text);
    assert.equal(chat.messagesContainer.innerHTML, "");
    assert.equal(sends[0][9], undefined);
    assert.equal(sends[0][10], undefined);
    assert.equal(sends[0][11], undefined);
});
