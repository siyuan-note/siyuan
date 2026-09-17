import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const setup = () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/syncUi.ts"), "utf8");
    const code = transpileModule(source + "\nexports.bind = bindProviderConfigEvent;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const s3 = {endpoint: "", accessKey: "", secretKey: "", bucket: "", region: "", timeout: 30,
        pathStyle: true, skipTlsVerify: false, concurrentReqs: 4};
    const sync = {provider: 2, s3};
    let focused = "";
    const inputs = Object.fromEntries(Object.keys(s3).map((key) => [key, {
        value: "", focus: () => { focused = key; },
    }]));
    const messages: string[] = [];
    const clicks: Record<string, () => void> = {};
    const button = {disabled: false, addEventListener: (name: string, callback: () => void) => {
        clicks[name] = callback;
    }};
    const events: Record<string, (event: unknown) => void> = {};
    const element = {
        querySelector: (selector: string) => selector === "#saveSyncConfig" ? button : inputs[selector.slice(1)] || null,
        addEventListener: (name: string, callback: (event: unknown) => void) => { events[name] = callback; },
    };
    const requests: {data: {s3: typeof s3}, resolve: (response: unknown) => void, reject: (error: Error) => void}[] = [];
    const moduleExports = {} as {bind: (config: unknown, root: unknown) => void};
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {config: {sync}, languages: {_kernel: {142: "Input can not be empty"}}}},
        require: (name: string) => {
            if (name === "../../util/fetch") {
                return {fetchSyncPost: (_url: string, data: {s3: typeof s3}) => new Promise((resolve, reject) => {
                    requests.push({data, resolve, reject});
                })};
            }
            if (name === "../../dialog/message") {
                return {showMessage: (message: string) => messages.push(message)};
            }
            if (name === "../../util/needSubscribe") {
                return {isPaidUser: () => true};
            }
            return {};
        },
    });
    moduleExports.bind(element, element);
    const fill = () => {
        for (const key of ["endpoint", "accessKey", "secretKey", "bucket", "region"]) {
            inputs[key].value = key === "endpoint" ? " storage.example.com " : key;
            events.change({target: {matches: () => true}});
        }
    };
    return {sync, inputs, button, requests, messages, fill, save: () => clicks.click(), focused: () => focused};
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("S3 fields remain editable until explicit save and missing fields are identified", () => {
    const ui = setup();
    ui.save();
    assert.equal(ui.focused(), "endpoint");
    assert.match(ui.messages[0], /Endpoint: Input can not be empty/);
    assert.equal(ui.requests.length, 0);
    ui.fill();
    assert.equal(ui.requests.length, 0);
    ui.save();
    ui.save();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].data.s3.region, "region");
    assert.equal(ui.button.disabled, true);
});

test("failed S3 saves retain all inputs and allow retry", async () => {
    const ui = setup();
    ui.fill();
    ui.save();
    ui.requests[0].resolve({code: -1});
    await settle();
    assert.equal(ui.inputs.endpoint.value, " storage.example.com ");
    assert.equal(ui.inputs.secretKey.value, "secretKey");
    assert.equal(ui.sync.s3.endpoint, "");
    assert.equal(ui.button.disabled, false);
    ui.save();
    ui.requests[1].reject(new Error("network"));
    await settle();
    assert.equal(ui.inputs.endpoint.value, " storage.example.com ");
    assert.equal(ui.button.disabled, false);
});

test("successful S3 saves normalize unchanged fields and preserve edits made while saving", async () => {
    const ui = setup();
    ui.fill();
    ui.save();
    ui.inputs.bucket.value = "another-bucket";
    ui.requests[0].resolve({code: 0, data: {s3: {...ui.requests[0].data.s3, endpoint: "https://storage.example.com"}}});
    await settle();
    assert.equal(ui.inputs.endpoint.value, "https://storage.example.com");
    assert.equal(ui.inputs.bucket.value, "another-bucket");
    assert.equal(ui.sync.s3.bucket, "bucket");
    assert.equal(ui.button.disabled, false);
});
