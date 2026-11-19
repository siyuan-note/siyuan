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
import {unmountOCRTab} from "../../config/ocr";
import {unmountWorkspaceStorage} from "../../config/tabs/workspaceStorage";
import {watchSettingTabInteractions} from "../../config/setting/mount";
import {isInIOS} from "../../protyle/util/compatibility";
import {getVisibleViewportBounds, scrollInputIntoView} from "../util/visibleViewport";
import {Constants} from "../../constants";

/** 卸载设置页中持有全局状态的模块，避免容器被替换后残留副作用 */
export const unmountSettingTab = (root: HTMLElement, tabId: TSettingTab) => {
    if (tabId === "bazaar") {
        unmountBazaarTab(root);
    } else if (tabId === "assets") {
        unmountAssetsTab(root);
    } else if (tabId === "ocr") {
        unmountOCRTab(root);
    } else if (tabId === "app") {
        unmountWorkspaceStorage(root);
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
    let keyboardLayoutTimer: number;
    const viewport = isInIOS() ? window.visualViewport : undefined;
    const resizeForKeyboard = () => {
        if (!root?.isConnected) {
            return;
        }
        const {top, bottom} = getVisibleViewportBounds();
        root.style.maxHeight = bottom === window.innerHeight && top === 0 ? "" :
            `${Math.max(0, bottom - Math.max(top, root.getBoundingClientRect().top))}px`;
        if (root.contains(document.activeElement)) {
            scrollInputIntoView(document.activeElement);
        }
    };
    const updateForKeyboard = () => {
        resizeForKeyboard();
        window.clearTimeout(keyboardLayoutTimer);
        // WebKit 可能在变更视口后再次调整滚动位置。
        if (root?.contains(document.activeElement)) {
            keyboardLayoutTimer = window.setTimeout(resizeForKeyboard, Constants.TIMEOUT_TRANSITION);
        }
    };
    openModel({
        title: settingTabDef.title,
        icon: "iconLeft",
        hideCloseIcon: true,
        html: `<div class="config${isMobile() ? " config--mobile" : ""}" data-setting-tab="${settingTabDef.id}"></div>`,
        bindEvent(modelMainElement: HTMLElement) {
            root = modelMainElement.firstElementChild as HTMLElement;
            if (viewport) {
                window.addEventListener("resize", updateForKeyboard);
                viewport.addEventListener("resize", updateForKeyboard);
                viewport.addEventListener("scroll", updateForKeyboard);
                root.addEventListener("focusin", updateForKeyboard);
                resizeForKeyboard();
            }
            watchSettingTabInteractions();
            bindSettingSaveDelegation(root);
            const mountedRoot = root;
            void getSettingTab(settingTabDef.id).mount(mountedRoot, undefined, app, settingTabDef.id === "access").then(() => {
                if (mountedRoot.isConnected) {
                    mountedRoot.classList.toggle("config--mobile-items", Boolean(mountedRoot.querySelector(":scope > .config-group")));
                } else {
                    unmountSettingTab(mountedRoot, settingTabDef.id);
                }
            });
        },
        destroyCallback() {
            if (viewport) {
                window.clearTimeout(keyboardLayoutTimer);
                window.removeEventListener("resize", updateForKeyboard);
                viewport.removeEventListener("resize", updateForKeyboard);
                viewport.removeEventListener("scroll", updateForKeyboard);
            }
            if (root) {
                if (viewport) root.removeEventListener("focusin", updateForKeyboard);
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
