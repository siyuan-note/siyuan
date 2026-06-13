import {App} from "../index";
import {Constants} from "../constants";

export const isSiYuanUriProtocol = (uri: URL | string | null | undefined): boolean => {
    try {
        if (uri == null) return false;

        const uriObj = new URL(uri);
        if (uriObj.protocol !== "siyuan:" && uriObj.protocol !== "web+siyuan:") {
            return false;
        }
        return true;
    } catch (error) {
        return false;
    }
};

export const processSiYuanUri = (app: App, uri: string) => {
    try {
        const uriObj = new URL(uri);
        if (!isSiYuanUriProtocol(uriObj)) {
            return false;
        }
        app.eventBus.dispatchEvent(new CustomEvent<IOpenSiYuanUriDetails>(Constants.SIYUAN_APP_EVENT_OPEN_URI, {detail: {uri: uriObj}}));
        return true;
    } catch (error) {
        return false;
    }
};
