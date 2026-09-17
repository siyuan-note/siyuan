import type {App} from "../../index";
import {getSettingTab, type ISettingTabShell, type TSettingTab} from "../../config/setting/tabs";
import {bindSettingSaveDelegation} from "../../config/setting/save";
import {isMobile} from "../../util/functions";
import {openModel} from "./model";
import {closeModel} from "../util/closePanel";
import {unmountBazaarTab} from "../../config/bazaarTab";
import {clearSyncTabElement} from "../../config/tabs/syncRuntime";
import {clearAccessTabElement} from "../../config/tabs/accessRuntime";
import {unmountAssetsTab} from "../../config/assets";

/** 卸载设置页中持有全局状态的模块，避免容器被替换后残留副作用 */
export const unmountSettingTab = (root: HTMLElement, tabId: TSettingTab) => {
    if (tabId === "bazaar") {
        unmountBazaarTab(root);
    } else if (tabId === "assets") {
        unmountAssetsTab(root);
    } else if (tabId === "sync") {
        clearSyncTabElement(root);
    } else if (tabId === "access") {
        clearAccessTabElement(root);
    }
};

/** 以全屏面板打开单个设置页，`returnCallback` 用于接管面板返回按钮的行为 */
export const openSettingTab = (app: App, settingTabDef: ISettingTabShell<TSettingTab>,
                               returnCallback?: () => void) => {
    let root: HTMLElement | undefined;
    openModel({
        title: settingTabDef.title,
        icon: "iconLeft",
        hideCloseIcon: true,
        html: `<div class="config${isMobile() ? " config--mobile" : ""}"></div>`,
        bindEvent(modelMainElement: HTMLElement) {
            root = modelMainElement.firstElementChild as HTMLElement;
            bindSettingSaveDelegation(root);
            const mountedRoot = root;
            void getSettingTab(settingTabDef.id).mount(mountedRoot, undefined, app).then(() => {
                if (mountedRoot.isConnected) {
                    mountedRoot.classList.toggle("config--mobile-items", Boolean(mountedRoot.querySelector(":scope > .config-group")));
                } else {
                    unmountSettingTab(mountedRoot, settingTabDef.id);
                }
            });
        },
        destroyCallback() {
            if (root) {
                unmountSettingTab(root, settingTabDef.id);
                root.remove();
            }
        },
        backCallback() {
            if (settingTabDef.id === "bazaar") {
                const readmeElement = root?.querySelector("#configBazaarReadme.config__view--show");
                if (readmeElement) {
                    readmeElement.classList.remove("config__view--show");
                    return false;
                }
            }
            // 返回时优先关闭设置页内已展开的子视图，与子视图返回按钮的行为保持一致
            const views = root ? Array.from(root.querySelectorAll<HTMLElement>(".config__view--show")) : [];
            const backElement = views[views.length - 1]?.querySelector<HTMLElement>('[data-action="back"]');
            if (backElement) {
                backElement.click();
                return false;
            }
            if (returnCallback) {
                returnCallback();
            } else {
                closeModel();
            }
        },
        transition: "forward",
    });
};
