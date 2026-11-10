import type {DocTreeController} from "../layout/dock/docTree/DocTreeController";
import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {collectDocTreeState, restoreDocTreeStateData} from "./docTreeStateCore";

const restoring = new WeakMap<DocTreeController, {interaction: number}>();

export const saveDocTreeState = (controller: DocTreeController) => {
    if (restoring.get(controller)?.interaction === controller.interactionVersion) {
        return;
    }
    const states = collectDocTreeState(controller);
    window.siyuan.storage[Constants.LOCAL_FILESPATHS] = states;
    // 复用存储入口对加密笔记本的过滤，路径和滚动位置都不能持久化到明文本地状态。
    void setStorageVal(Constants.LOCAL_FILESPATHS, states);
};

export const restoreDocTreeState = async (controller: DocTreeController) => {
    const token = {interaction: controller.interactionVersion};
    restoring.set(controller, token);
    try {
        await restoreDocTreeStateData(controller, window.siyuan.storage[Constants.LOCAL_FILESPATHS],
            () => restoring.get(controller) === token && controller.interactionVersion === token.interaction);
    } finally {
        if (restoring.get(controller) === token) {
            restoring.delete(controller);
        }
    }
};
