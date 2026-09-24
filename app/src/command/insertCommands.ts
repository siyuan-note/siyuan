import {getCommandRegistry} from "./service";
import {getEnglishCommandLabel} from "./english";
import type {ICommandContextSnapshot, ICommandDefinition} from "./types";
import {getBuiltinSlashMenuItems} from "../protyle/hint/extend";
import {isBuiltinInlineStyleVisible, type TBuiltinInlineStyleID} from "../protyle/toolbar/inlineStyle";
import {focusByRange} from "../protyle/util/selection";
import {isDisabledFeature, isInAndroid} from "../protyle/util/compatibility";
import {getHostCapabilities} from "../util/hostCapabilities";
/// #if MOBILE
import {callMobileAppShowKeyboard} from "../mobile/util/mobileAppUtil";
/// #endif

const initializedApps = new WeakSet<object>();

// 与加号菜单的内置插入项保持一致，具体插入值仍由斜杠菜单提供。
const INSERT_IDS = [
    "template", "widget", "assets", "ref", "blockEmbed", "aiWriting", "database", "newSubDocRef",
    "insertAsset", "insertIframeURL", "insertImgURL", "insertVideoURL", "insertAudioURL", "emoji",
    "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
    "list", "orderedList", "check", "quote", "tabs", "mindmap",
    "calloutNote", "calloutTip", "calloutImportant", "calloutWarning", "calloutCaution",
    "code", "table", "line", "math", "html", "staff", "chart", "flowChart", "graph", "mermaid", "UML",
    "infoStyle", "successStyle", "warningStyle", "errorStyle", "clearFontStyle",
] as const;
const BUILTIN_STYLES: Record<string, TBuiltinInlineStyleID> = {
    infoStyle: "info", successStyle: "success", warningStyle: "warning", errorStyle: "error",
};
const SPECIAL_LABELS: Record<string, string> = {
    html: "HTML", flowChart: "Flow Chart", graph: "Graph", mermaid: "Mermaid", UML: "UML",
};

const labelKey = (id: string) => id === "orderedList" ? "ordered-list" : id;
const label = (id: string, english = false) => {
    if (id.startsWith("callout")) {
        const kind = id.slice("callout".length);
        const callout = english ? getEnglishCommandLabel("callout") : window.siyuan.languages.callout;
        return `${callout || window.siyuan.languages.callout} - ${kind}`;
    }
    return SPECIAL_LABELS[id] || (english ? getEnglishCommandLabel(labelKey(id)) : window.siyuan.languages[labelKey(id)]) || id;
};

const available = (context: ICommandContextSnapshot, id: string) => {
    const protyle = context.protyle;
    const range = context.range;
    if (!protyle || protyle.lite || protyle.disabled || window.siyuan.isPublish || window.siyuan.config.readonly ||
        !range?.startContainer.isConnected || !range.endContainer.isConnected ||
        !protyle.wysiwyg.element.contains(range.startContainer) ||
        !protyle.wysiwyg.element.contains(range.endContainer)) {
        return false;
    }
    if (id === "widget") {
        return getHostCapabilities().widgets;
    }
    if (id === "aiWriting") {
        return !isDisabledFeature("ai");
    }
    if (id === "insertIframeURL") {
        return !getHostCapabilities().remoteKernel;
    }
    if (id === "insertImage" || id === "insertPhoto") {
        return Boolean(isInAndroid());
    }
    if (BUILTIN_STYLES[id]) {
        return isBuiltinInlineStyleVisible("style1", BUILTIN_STYLES[id]);
    }
    return true;
};

const openUpload = (context: ICommandContextSnapshot, id: string) => {
    const protyle = context.protyle;
    const host = document.createElement("div");
    const input = document.createElement("input");
    host.hidden = true;
    input.type = "file";
    input.className = "b3-form__upload";
    input.multiple = id !== "insertPhoto";
    if (id === "insertImage") {
        input.accept = "image/*,application/x-siyuan-image-picker";
    } else if (id === "insertPhoto") {
        input.accept = "image/*";
        input.capture = "user";
    } else if (protyle.options.upload.accept) {
        input.accept = protyle.options.upload.accept;
    }
    host.append(input);
    document.body.append(host);
    protyle.toolbar.range = context.range.cloneRange();
    protyle.hint.lastIndex = -1;
    protyle.hint.bindUploadEvent(protyle, host);
    const cleanup = () => host.remove();
    input.addEventListener("change", cleanup, {once: true});
    input.addEventListener("cancel", cleanup, {once: true});
    input.click();
};

const executeInsert = (context: ICommandContextSnapshot, id: string) => {
    if (!available(context, id)) {
        return;
    }
    if (["insertAsset", "insertImage", "insertPhoto"].includes(id)) {
        openUpload(context, id);
        return;
    }
    const protyle = context.protyle;
    const item = getBuiltinSlashMenuItems(protyle).find(candidate => candidate.id === id);
    if (!item) {
        return;
    }
    protyle.toolbar.range = context.range.cloneRange();
    protyle.hint.splitChar = "/";
    protyle.hint.lastIndex = -1;
    focusByRange(protyle.toolbar.range);
    protyle.hint.fill(item.value, protyle, false);
    if ((context.environment === "mobile" || context.environment === "browser-mobile") &&
        (id === "ref" || id === "blockEmbed")) {
        /// #if MOBILE
        callMobileAppShowKeyboard();
        /// #endif
    }
};

export const ensureInsertCommands = (app: object, mobile: boolean) => {
    if (initializedApps.has(app)) {
        return;
    }
    const registry = getCommandRegistry(app);
    const owner = {};
    const disposers: Array<() => boolean> = [];
    try {
        [...INSERT_IDS, ...(mobile ? ["insertImage", "insertPhoto"] : [])].forEach((id, order) => {
            const command: ICommandDefinition = {
                id: `core.${mobile ? "mobile." : ""}insert.${id}`,
                category: "core",
                label: () => label(id),
                englishLabel: () => label(id, true),
                keywords: () => [id],
                surfaces: ["commandPanel"],
                platform: environment => mobile ? environment === "mobile" || environment === "browser-mobile" :
                    environment === "desktop" || environment === "desktop-window" || environment === "browser-desktop",
                order: 2000 + order,
                when: context => available(context, id),
                execute: context => executeInsert(context, id),
            };
            disposers.push(registry.register(command, owner));
        });
        initializedApps.add(app);
    } catch (error) {
        disposers.reverse().forEach(dispose => dispose());
        throw error;
    }
};
