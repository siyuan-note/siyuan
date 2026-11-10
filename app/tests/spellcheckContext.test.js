const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");
const {mockElectron, resetElectronStub} = require("../electron/fixtures/electronStub");
const protocol = require("../src/menus/spellcheckContext");
const {Channel} = require("../electron/shared/channels");

const code = ts.transpileModule(parse(readFileSync(path.join(__dirname, "../src/menus/spellcheck.ts"), "utf8"),
    {BROWSER: false}, false, true), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
}).outputText;

let contentsSequence = 0;
const setup = t => {
    t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 1000000});
    resetElectronStub();
    const popups = [];
    mockElectron(t, {Menu: {buildFromTemplate: items => ({popup: () => popups.push(items)})}});
    const main = require("../electron/window/contextMenu");
    const ipc = new EventEmitter();
    const responses = [];
    const dictionary = [];
    const replacements = [];
    const requests = [];
    const contents = Object.assign(new EventEmitter(), {
        id: ++contentsSequence,
        send: (channel, context) => {responses.push(context); ipc.emit(channel, {}, context);},
        session: {addWordToSpellCheckerDictionary: word => {dictionary.push(word); return true;}},
        replaceMisspelling: word => replacements.push(word),
        getZoomFactor: () => 1,
        isDestroyed: () => false,
    });
    main.bindSpellcheckContextMenu(contents);
    t.after(() => contents.emit("destroyed"));
    ipc.send = (_channel, request) => {requests.push(request); main.requestSpellcheckContext(contents, request);};
    ipc.invoke = async (_channel, action) => main.applySpellcheckAction(contents, action);
    const fragments = [];
    const exports = {};
    const dependencies = {
        "../constants": {Constants: Channel},
        "./spellcheckContext": protocol,
        "electron": {ipcRenderer: ipc},
        "./Menu": {MenuItem: class {constructor(options) {this.element = options;}}},
        "../util/escape": {escapeHtml: value => value},
        "../dialog/message": {showMessage: message => assert.fail(message)},
    };
    runInNewContext(code, {
        exports,
        require: name => {assert.ok(dependencies[name], name); return dependencies[name];},
        Date,
        window: {
            setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
            siyuan: {languages: {addToDictionary: "Add to dictionary"},
                menus: {menu: {element: {lastElementChild: {prepend: fragment => fragments.push(fragment)}}}}},
        },
        document: {createDocumentFragment: () => ({children: [], append(item) {this.children.push(item);}})},
    });
    const native = (word = "ñqzxvbnmñ", suggestions = [], x = 10, y = 20) => contents.emit("context-menu", {}, {
        x, y, misspelledWord: word, dictionarySuggestions: suggestions,
    });
    return {...exports, main, contents, native, ipc, requests, responses, fragments, dictionary, replacements, popups};
};

for (const delay of [450, 1500]) {
    test(`misspellings without suggestions retain Add to dictionary after ${delay} ms`, async t => {
        const f = setup(t);
        let settled = false;
        const pending = f.requestSpellcheckContext(10, 20).then(context => {settled = true; return context;});
        t.mock.timers.tick(delay);
        await Promise.resolve();
        assert.equal(settled, false);
        f.native();
        const context = await pending;
        assert.equal(context.misspelledWord, "ñqzxvbnmñ");
        assert.equal(context.dictionarySuggestions.length, 0);
        f.addSpellcheckMenuItems(context);
        const items = f.fragments[0].children;
        assert.deepEqual(items.map(item => item.label || item.type), ["Add to dictionary", "separator"]);
        await items[0].click();
        assert.deepEqual(f.dictionary, ["ñqzxvbnmñ"]);
    });
}

test("suggested replacements and their actions remain tied to the current native context", async t => {
    const f = setup(t);
    const pending = f.requestSpellcheckContext(10, 20);
    t.mock.timers.tick(40);
    f.native("murciélgo", ["murciélago"]);
    const context = await pending;
    f.addSpellcheckMenuItems(context);
    const items = f.fragments[0].children;
    assert.deepEqual(items.map(item => item.label || item.type), ["murciélago", "Add to dictionary", "separator"]);
    assert.equal(f.main.applySpellcheckAction(f.contents, {contextId: context.contextId,
        action: "replace", suggestion: "untrusted"}), false);
    await items[0].click();
    assert.deepEqual(f.replacements, ["murciélago"]);
    assert.equal(f.main.applySpellcheckAction(f.contents, {contextId: context.contextId, action: "addToDictionary"}), false);
});

test("native context can arrive first and renderer timestamps tolerate small clock differences", async t => {
    const f = setup(t);
    f.native();
    t.mock.timers.tick(5);
    assert.equal((await f.requestSpellcheckContext(10, 20)).misspelledWord, "ñqzxvbnmñ");
    const pending = f.requestSpellcheckContext(10, 20);
    f.native("");
    const context = await pending;
    assert.equal(context.misspelledWord, "");
    f.addSpellcheckMenuItems(context);
    assert.equal(f.fragments.length, 0);
});

test("old or differently positioned native contexts cannot supply the current menu", async t => {
    const f = setup(t);
    f.native("stale");
    t.mock.timers.tick(100);
    const pending = f.requestSpellcheckContext(10, 20);
    f.native("elsewhere", [], 30, 40);
    assert.equal(f.responses.length, 0);
    t.mock.timers.tick(400);
    f.native("current");
    assert.equal((await pending).misspelledWord, "current");
});

test("a delayed IPC response cannot resolve a newer right click at the same coordinates", async t => {
    const f = setup(t);
    const first = f.requestSpellcheckContext(10, 20);
    const oldId = f.requests.at(-1).requestId;
    const second = f.requestSpellcheckContext(10, 20);
    assert.equal(await first, null);
    f.ipc.emit(Channel.SIYUAN_SPELLCHECK_CONTEXT, {}, {
        requestId: oldId, contextId: 1, x: 10, y: 20, misspelledWord: "stale", dictionarySuggestions: [],
    });
    let settled = false;
    void second.then(() => {settled = true;});
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(400);
    f.native("current");
    assert.equal((await second).misspelledWord, "current");
});

test("native DIP coordinates match rounded renderer coordinates at different zoom factors", async t => {
    const f = setup(t);
    for (const zoom of [0.75, 1.25, 2]) {
        f.contents.getZoomFactor = () => zoom;
        const pending = f.requestSpellcheckContext(492, 214);
        t.mock.timers.tick(450);
        f.native("current", [], Math.floor(492.8 * zoom), Math.floor(214.8 * zoom));
        const context = await pending;
        assert.equal(context.misspelledWord, "current");
        assert.equal(context.x, 492);
        assert.equal(context.y, 214);
    }
});

test("missing native events time out and late responses are ignored", async t => {
    const f = setup(t);
    const pending = f.requestSpellcheckContext(10, 20);
    t.mock.timers.tick(protocol.SPELLCHECK_CONTEXT_TIMEOUT);
    assert.equal(await pending, undefined);
    f.native();
    assert.equal(f.responses.length, 0);
});

test("native text fields wait for slow dictionaries and include Add to dictionary without suggestions", t => {
    const f = setup(t);
    f.main.requestContextMenu(f.contents, {x: 10, y: 20, requestedAt: Date.now(),
        items: [{type: "addToDictionary", label: "Add to dictionary"}, {role: "copy"}]});
    t.mock.timers.tick(450);
    assert.equal(f.popups.length, 0);
    f.native();
    assert.equal(f.popups.length, 1);
    assert.equal(f.popups[0][0].label, "Add to dictionary");
    f.popups[0][0].click();
    assert.deepEqual(f.dictionary, ["ñqzxvbnmñ"]);
    t.mock.timers.tick(protocol.SPELLCHECK_CONTEXT_TIMEOUT);
    assert.equal(f.popups.length, 1);
});
