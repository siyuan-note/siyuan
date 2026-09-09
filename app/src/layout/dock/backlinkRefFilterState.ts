import {ViewStateService, type IViewStateServiceOptions} from "../../util/viewState";
import {normalizeExcludedRefDefIDs} from "./backlinkSourceFilter";

interface ISharedRefFilter {
    service: ViewStateService;
    listeners: Set<(ids: string[]) => void>;
}

const states = new Map<string, ISharedRefFilter>();

// 同一目标块的面板共享状态实例，切换目标前立即提交，避免重新打开时读取到过期选择。
export const acquireBacklinkRefFilter = (hostID: string, listener: (ids: string[]) => void,
                                        options?: IViewStateServiceOptions) => {
    let state = states.get(hostID);
    if (!state) {
        state = {
            service: new ViewStateService({scope: "backlink", surface: "ref-filter", hostID}, options),
            listeners: new Set(),
        };
        states.set(hostID, state);
    }
    const shared = state;
    shared.listeners.add(listener);
    const get = () => normalizeExcludedRefDefIDs(shared.service.get("excludedRefDefIDs"));
    return {
        ready: shared.service.ready.then(() => {
            if (shared.listeners.has(listener)) {
                listener(get());
            }
        }),
        set(ids: string[]) {
            shared.service.set("excludedRefDefIDs", normalizeExcludedRefDefIDs(ids));
            shared.listeners.forEach(callback => callback(get()));
        },
        async release() {
            shared.listeners.delete(listener);
            await shared.service.flush();
            if (shared.listeners.size === 0 && states.get(hostID) === shared) {
                states.delete(hostID);
                await shared.service.destroy();
            }
        },
    };
};
