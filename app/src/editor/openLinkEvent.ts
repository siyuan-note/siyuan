import type {App} from "../index";
import {eventBusHas, hasPluginSubscriber} from "../plugin/EventBusCore";

export interface IOpenLinkEventDetail {
    href: string;
    originalHref: string;
    event?: MouseEvent | KeyboardEvent;
}

export const resolveOpenLinkEvent = (options: {
    href: string,
    originalHref: string,
    isAsset: boolean,
    isLocal: boolean,
    event?: MouseEvent | KeyboardEvent,
}): IOpenLinkEventDetail | undefined => {
    if (!options.href || options.isAsset) {
        return;
    }
    const href = !options.isLocal && 0 > options.href.indexOf(":") ? `https://${options.href}` : options.href;
    return {href, originalHref: options.originalHref, event: options.event};
};

const emitCancelablePluginEvent = <T>(app: App, type: TEventBus, detail: T) => {
    if (!hasPluginSubscriber(type)) {
        return true;
    }
    for (const plugin of app.plugins) {
        if (!eventBusHas(plugin.eventBus, type)) {
            continue;
        }
        if (!plugin.eventBus.emit(type, detail)) {
            return false;
        }
    }
    return true;
};

export const emitOpenLink = (app: App, detail: IOpenLinkEventDetail) => {
    return emitCancelablePluginEvent(app, "open-link", detail);
};

export const emitOpenAsset = (
    app: App,
    path: string,
    action: Config.TAssetOpenAction,
    event?: MouseEvent,
) => {
    return emitCancelablePluginEvent(app, "open-asset", {path, action, event});
};
