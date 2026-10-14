import type {App} from "../../index";
import {processSiYuanUri} from "../../util/uri";

let ready = false;
const pending = new Set<string>();

// 系统链接在插件、语言和移动端界面就绪后分派，块链接继续使用移动端的定位流程。
export const processMobileSystemUri = (app: App, uri: string) => {
    try {
        const url = new URL(uri);
        if (url.protocol !== "siyuan:" || !["plugins", "bazaar"].includes(url.hostname)) {
            return false;
        }
    } catch {
        return false;
    }
    if (!ready) {
        pending.add(uri);
        return true;
    }
    return processSiYuanUri(app, uri);
};

export const finishMobileSystemUris = (app: App) => {
    ready = true;
    const uris = [...pending];
    pending.clear();
    uris.forEach(uri => processSiYuanUri(app, uri));
};
