import {merge} from "./util/merge";

export interface ProtyleRuntimeCapabilities {
    upload?: boolean;
    websocket?: boolean;
    lute?: Lute;
    lockedOptions?: Partial<Pick<IProtyleOptions, "hint" | "toolbar">>;
    pluginExtensions?: boolean;
    customBlockRender?: boolean;
    sanitizeBlockDOM?: (blockDOM: string) => string;
    restoreLuteMarkdownSyntax?: (lute: Lute) => void;
}

const uploadDisabledProtyles = new WeakSet<IProtyle>();
const protyleRuntimeCapabilities = new WeakMap<IProtyle, ProtyleRuntimeCapabilities>();

export const applyProtyleLockedOptions = (options: IProtyleOptions,
                                          lockedOptions?: ProtyleRuntimeCapabilities["lockedOptions"]) =>
    lockedOptions ? merge(options, lockedOptions) as IProtyleOptions : options;

export const resolveProtyleLute = (getSharedLute: () => Lute, runtimeLute?: Lute) =>
    runtimeLute || getSharedLute();

export const registerProtyleRuntimeCapabilities = (protyle: IProtyle,
                                                    capabilities: ProtyleRuntimeCapabilities) => {
    protyleRuntimeCapabilities.set(protyle, capabilities);
};

export const areProtyleRuntimePluginExtensionsEnabled = (capabilities: ProtyleRuntimeCapabilities) =>
    capabilities.pluginExtensions !== false;

export const areProtylePluginExtensionsEnabled = (protyle: IProtyle) =>
    areProtyleRuntimePluginExtensionsEnabled(protyleRuntimeCapabilities.get(protyle) || {});

export const isProtyleCustomBlockRenderEnabled = (protyle: IProtyle) =>
    protyleRuntimeCapabilities.get(protyle)?.customBlockRender !== false;

export const getProtyleLockedToolbar = (protyle: IProtyle) =>
    protyleRuntimeCapabilities.get(protyle)?.lockedOptions?.toolbar;

export const getProtyleBlockDOMSanitizer = (protyle: IProtyle) =>
    protyleRuntimeCapabilities.get(protyle)?.sanitizeBlockDOM;

export const restoreProtyleLuteMarkdownSyntax = (protyle: IProtyle, restoreDefault: (lute: Lute) => void) => {
    const restore = protyleRuntimeCapabilities.get(protyle)?.restoreLuteMarkdownSyntax || restoreDefault;
    restore(protyle.lute);
};

export const getProtyleRestrictedPlainTextHTML = (value: string) => value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n?|\n/g, "<br>");

export const disableProtyleUpload = (protyle: IProtyle) => {
    uploadDisabledProtyles.add(protyle);
};

export const isProtyleUploadDisabled = (protyle: IProtyle) => uploadDisabledProtyles.has(protyle);
