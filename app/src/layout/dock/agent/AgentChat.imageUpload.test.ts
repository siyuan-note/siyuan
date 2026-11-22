import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../../../util/escape";

const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const constantExports = {};
runInNewContext(compile("src/constants.ts"), {
    exports: constantExports,
    require: () => ({createDockKeymapDefaults: () => ({})}),
    SIYUAN_VERSION: "test",
    NODE_ENV: "test",
});
const compiled = compile("src/layout/dock/agent/AgentChat.ts");

const setup = (android: boolean) => {
    const messages: string[] = [];
    const uploads: File[][] = [];
    const openedAccepts: string[] = [];
    const imageUploadButton = new EventTarget();
    const imageFileUploadButton = android ? new EventTarget() : null;
    const imageUploadInput = Object.assign(new EventTarget(), {
        accept: "",
        value: "",
        files: [] as File[],
        click() {
            openedAccepts.push(this.accept);
        },
    });
    const exports = {} as {AgentChat: {prototype: {bindImageUpload: () => void}}};
    runInNewContext(compiled, {
        exports,
        require: (id: string) => id === "../../../constants" ? constantExports : {
            Model: class {},
            escapeHtml,
            showMessage: (message: string) => messages.push(message),
        },
        window: {siyuan: {languages: {fileTypeError: "Unsupported file type"}}},
    });
    const chat = {
        imageUploadInput,
        imageUploadButton,
        imageFileUploadButton,
        composer: {
            uploadImages: (files: File[], input: typeof imageUploadInput) => {
                assert.equal(input, imageUploadInput);
                uploads.push(Array.from(files));
            },
        },
    };
    exports.AgentChat.prototype.bindImageUpload.call(chat);
    const select = (...files: File[]) => {
        imageUploadInput.value = files[0]?.name || "";
        imageUploadInput.files = files;
        imageUploadInput.dispatchEvent(new Event("change"));
    };
    return {imageUploadInput, imageUploadButton, imageFileUploadButton, openedAccepts, select, messages, uploads};
};

test("Android agent image button opens the photo input and uploads compatible selections in order", () => {
    const {imageUploadInput, imageUploadButton, openedAccepts, select, messages, uploads} = setup(true);
    assert.equal(imageUploadInput.accept, "image/*,application/x-siyuan-image-picker");
    imageUploadButton.dispatchEvent(new Event("click"));
    assert.deepEqual(openedAccepts, ["image/*,application/x-siyuan-image-picker"]);

    const png = new File(["png"], "photo", {type: "image/png"});
    const heic = new File(["heic"], "<photo>.heic", {type: "image/heic"});
    const jpeg = new File(["jpeg"], "photo.JPEG");
    const webp = new File(["webp"], "photo.webp", {type: "application/octet-stream"});
    select(png, heic, jpeg, webp);
    assert.deepEqual(uploads, [[png, jpeg, webp]]);
    assert.match(messages[0], /&lt;photo>\.heic Unsupported file type/);
});

test("Android agent file and photo buttons select their own picker and share image validation", () => {
    const {imageUploadButton, imageFileUploadButton, openedAccepts, select, messages, uploads} = setup(true);
    imageFileUploadButton.dispatchEvent(new Event("click"));
    const gif = new File(["gif"], "photo.gif", {type: "image/gif"});
    const text = new File(["text"], "report.txt", {type: "text/plain"});
    select(gif, text);
    assert.deepEqual(uploads, [[gif]]);
    assert.match(messages[0], /report\.txt Unsupported file type/);

    imageUploadButton.dispatchEvent(new Event("click"));
    assert.deepEqual(openedAccepts, [
        "image/png,image/jpeg,image/gif,image/webp,application/x-siyuan-image-picker",
        "image/*,application/x-siyuan-image-picker",
    ]);
});

test("Android agent image input resets when no selected file is supported", () => {
    const {imageUploadInput, select, messages, uploads} = setup(true);
    select();
    assert.deepEqual(messages, []);
    select(new File(["heic"], "photo.jpg", {type: "image/heic"}));
    assert.deepEqual(uploads, []);
    assert.equal(imageUploadInput.value, "");
    assert.match(messages[0], /photo\.jpg Unsupported file type/);
});

test("agent image button on other clients uses the standard image MIME filter", () => {
    const {imageUploadInput, imageUploadButton, imageFileUploadButton, openedAccepts, select, messages, uploads} = setup(false);
    assert.equal(imageFileUploadButton, null);
    assert.equal(imageUploadInput.accept, "image/png,image/jpeg,image/gif,image/webp");
    imageUploadButton.dispatchEvent(new Event("click"));
    assert.deepEqual(openedAccepts, ["image/png,image/jpeg,image/gif,image/webp"]);
    const gif = new File(["gif"], "photo.gif", {type: "image/gif"});
    select(gif);
    assert.deepEqual(uploads, [[gif]]);
    assert.deepEqual(messages, []);
});
