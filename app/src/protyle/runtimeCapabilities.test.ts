import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    applyProtyleLockedOptions,
    areProtylePluginExtensionsEnabled,
    areProtyleRuntimePluginExtensionsEnabled,
    disableProtyleUpload,
    isProtyleUploadDisabled,
    getProtyleBlockDOMSanitizer,
    getProtyleLockedToolbar,
    getProtyleRestrictedPlainTextHTML,
    isProtyleCustomBlockRenderEnabled,
    registerProtyleRuntimeCapabilities,
    resolveProtyleLute,
    restoreProtyleLuteMarkdownSyntax,
} from "./runtimeCapabilities";

describe("Protyle runtime capabilities", () => {
    it("applies toolbar and hint constraints after plugin options", () => {
        const pluginOptions = {
            toolbar: ["upload", "widget"],
            hint: {
                emojiPath: "/plugin-emojis",
                extend: [{key: ":"}, {key: "/"}],
            },
        } as unknown as IProtyleOptions;
        const lockedToolbar = ["strong", "em"];
        const lockedHint = {extend: [{key: "/"}]};
        const resolved = applyProtyleLockedOptions(pluginOptions, {
            toolbar: lockedToolbar,
            hint: lockedHint,
        });

        assert.deepEqual(resolved.toolbar, lockedToolbar);
        assert.deepEqual(resolved.hint.extend, lockedHint.extend);
        assert.equal(resolved.hint.emojiPath, "/plugin-emojis");
        assert.equal(areProtyleRuntimePluginExtensionsEnabled({}), true);
        assert.equal(areProtyleRuntimePluginExtensionsEnabled({pluginExtensions: false}), false);
    });

    it("injects an isolated Lute without obtaining or mutating the shared instance", () => {
        const isolatedLute = {} as Lute;
        let sharedCalls = 0;
        const resolved = resolveProtyleLute(() => {
            sharedCalls++;
            return {} as Lute;
        }, isolatedLute);

        assert.equal(resolved, isolatedLute);
        assert.equal(sharedCalls, 0);
    });

    it("restores an isolated Lute with its runtime policy and keeps the ordinary fallback", () => {
        const isolatedLute = {} as Lute;
        const isolated = {lute: isolatedLute} as IProtyle;
        let runtimeRestore: Lute | undefined;
        let defaultRestore: Lute | undefined;
        registerProtyleRuntimeCapabilities(isolated, {
            restoreLuteMarkdownSyntax: (lute) => {
                runtimeRestore = lute;
            },
        });

        restoreProtyleLuteMarkdownSyntax(isolated, (lute) => {
            defaultRestore = lute;
        });
        assert.equal(runtimeRestore, isolatedLute);
        assert.equal(defaultRestore, undefined);

        const ordinaryLute = {} as Lute;
        const ordinary = {lute: ordinaryLute} as IProtyle;
        restoreProtyleLuteMarkdownSyntax(ordinary, (lute) => {
            defaultRestore = lute;
        });
        assert.equal(defaultRestore, ordinaryLute);
    });

    it("keeps disabled upload state tied to the Protyle instance", () => {
        const disabled = {} as IProtyle;
        const enabled = {} as IProtyle;

        disableProtyleUpload(disabled);

        assert.equal(isProtyleUploadDisabled(disabled), true);
        assert.equal(isProtyleUploadDisabled(enabled), false);
    });

    it("keeps restricted plugin and BlockDOM capabilities tied to one instance", () => {
        const restricted = {} as IProtyle;
        const regular = {} as IProtyle;
        const toolbar = ["strong", "em"];
        const sanitizer = (blockDOM: string) => blockDOM.replace(/<img[^>]*>/g, "");
        registerProtyleRuntimeCapabilities(restricted, {
            pluginExtensions: false,
            customBlockRender: false,
            lockedOptions: {toolbar},
            sanitizeBlockDOM: sanitizer,
        });

        assert.equal(areProtylePluginExtensionsEnabled(restricted), false);
        assert.equal(isProtyleCustomBlockRenderEnabled(restricted), false);
        assert.deepEqual(getProtyleLockedToolbar(restricted), toolbar);
        assert.equal(getProtyleBlockDOMSanitizer(restricted), sanitizer);
        assert.equal(areProtylePluginExtensionsEnabled(regular), true);
        assert.equal(isProtyleCustomBlockRenderEnabled(regular), true);
    });

    it("turns restricted fallback paste into inert text only", () => {
        assert.equal(getProtyleRestrictedPlainTextHTML(
            '<table><img src=x onerror="alert(1)"></table>\nnext'
        ), "&lt;table&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;/table&gt;<br>next");
    });
});
