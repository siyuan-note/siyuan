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
    const exports = {} as {renderWelcomeHTML: (hasModel?: boolean, greetingKey?: string) => string};
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

test("dynamic greetings preserve two lines and escape localized text with and without a model", () => {
    const render = loadRenderer({agentWelcomeFirst1: 'Hi <friend> & "you"\nLet\'s begin', agentWelcomeGreeting: "Fallback"});
    for (const hasModel of [true, false]) {
        assert.ok(render(hasModel, "agentWelcomeFirst1").includes(
            '<div class="agent-welcome__greeting">' + escapeHtmlTextAndAttr('Hi <friend> & "you"\nLet\'s begin') + "</div>"));
        assert.ok(render(hasModel, "missing").includes('class="agent-welcome__greeting">Fallback</div>'));
    }
});

test("every locale supplies the complete two-line greeting groups", () => {
    for (const file of readdirSync("appearance/langs").filter(file => file.endsWith(".json"))) {
        const languages = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        const render = loadRenderer(languages);
        for (const group of ["First", "Return", "Morning", "Day", "Evening", "Late"]) {
            const count = group === "First" || group === "Return" ? 2 : 5;
            for (let i = 1; i <= count; i++) {
                const key = `agentWelcome${group}${i}`;
                assert.equal(typeof languages[key], "string", `${file}: ${key}`);
                assert.equal(languages[key].split("\n").length, 2, `${file}: ${key}`);
                assert.ok(languages[key].split("\n").every((line: string) => line.trim()), `${file}: ${key}`);
                assert.ok(render(true, key).includes(escapeHtmlTextAndAttr(languages[key])), `${file}: ${key}`);
                assert.ok(render(false, key).includes(escapeHtmlTextAndAttr(languages[key])), `${file}: ${key}`);
            }
        }
    }
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
        welcomeGreeting: {getKey: () => ""},
        messagesContainer: {innerHTML: "", querySelectorAll: () => [example]},
        getSelectedModel: () => "model",
        sessionRunController: {begin: () => ({sessionID: "session", controller: {signal: {}}}), finish: () => {}},
    });
    for (const method of ["destroyEditingComposer", "appendUserMessage", "rebuildNavMarkers", "tryGenerateTitle",
        "setStreaming", "saveSession"]) {
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
