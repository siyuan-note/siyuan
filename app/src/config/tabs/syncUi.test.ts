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
    const inputs = Object.fromEntries(Object.keys(s3).map((key) => [key, {
        value: "",
    }]));
    const messages: string[] = [];
    const events: Record<string, (event: unknown) => void> = {};
    const element = {
        querySelector: (selector: string) => inputs[selector.slice(1)] || null,
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
    return {sync, inputs, requests, messages, fill, change: () => events.change({target: {matches: () => true}})};
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("S3 configuration saves automatically once required fields are complete", async () => {
    const ui = setup();
    ui.change();
    await settle();
    assert.equal(ui.messages.length, 0);
    assert.equal(ui.requests.length, 0);
    ui.fill();
    await settle();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].data.s3.region, "region");
});

test("failed S3 saves retain all inputs and allow retry", async () => {
    const ui = setup();
    ui.fill();
    await settle();
    ui.requests[0].resolve({code: -1});
    await settle();
    assert.equal(ui.inputs.endpoint.value, " storage.example.com ");
    assert.equal(ui.inputs.secretKey.value, "secretKey");
    assert.equal(ui.sync.s3.endpoint, "");
    ui.change();
    await settle();
    ui.requests[1].reject(new Error("network"));
    await settle();
    assert.equal(ui.inputs.endpoint.value, " storage.example.com ");
});

test("successful S3 saves normalize unchanged fields and preserve edits made while saving", async () => {
    const ui = setup();
    ui.fill();
    await settle();
    ui.inputs.bucket.value = "another-bucket";
    ui.change();
    await settle();
    assert.equal(ui.requests.length, 1);
    ui.requests[0].resolve({code: 0, data: {s3: {...ui.requests[0].data.s3, endpoint: "https://storage.example.com"}}});
    await settle();
    assert.equal(ui.inputs.endpoint.value, "https://storage.example.com");
    assert.equal(ui.inputs.bucket.value, "another-bucket");
    assert.equal(ui.sync.s3.bucket, "bucket");
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.requests[1].data.s3.bucket, "another-bucket");
    ui.requests[1].resolve({code: 0, data: {s3: ui.requests[1].data.s3}});
    await settle();
    assert.equal(ui.sync.s3.bucket, "another-bucket");
});
