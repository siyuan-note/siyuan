import {addScript, addScriptSync} from "../protyle/util/addScript";
import {Constants} from "../constants";
import {onMessage} from "./util/onMessage";
import {genUUID} from "../util/genID";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasTopClosestByClassName
} from "../protyle/util/hasClosest";
import {Model} from "../layout/Model";
import "../assets/scss/mobile.scss";
import {Menus} from "../menus";
import {addBaseURL, parseSiYuanUriInfo, setNoteBook} from "../util/pathName";
import {activateQueuedAVLocate, queueAVLocateRequest} from "../protyle/render/av/locate";
import {handleTouchEnd, handleTouchMove, handleTouchStart, handleTouchUp} from "./util/touch";
import {fetchGet, fetchPost} from "../util/fetch";
import {initFramework} from "./util/initFramework";
import {initAssets} from "../util/assets";
import {bootSync, lockScreen} from "../dialog/processSystem";
import {initMessage, showMessage} from "../dialog/message";
import {goBack} from "./util/MobileBackFoward";
import {activeBlur, hideKeyboardToolbar, showKeyboardToolbar} from "./util/keyboardToolbar";
import {
    getLocalStorage,
    initWindowOpenOverride,
    isChromeBrowser,
    isInIOS,
    isInMobileApp,
    writeText
} from "../protyle/util/compatibility";
import {getCurrentEditor, openMobileFileById} from "./editor";
import {ensureOnboarding} from "../onboarding";
import {checkPublishServiceClosed} from "../util/processMessage";
import {initRightMenu} from "./menu";
import {openChangelog} from "../boot/openChangelog";
import {registerServiceWorker} from "../util/serviceWorker";
import {loadPlugins} from "../plugin/loader";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {removeBlock} from "../protyle/wysiwyg/remove";
import {isNotEditBlock} from "../protyle/wysiwyg/getBlock";
import {updateCardHV} from "../card/util";
import {mobileKeydown} from "./util/keydown";
import {correctHotkey} from "../boot/globalEvent/commonHotkey";
import {processIOSPurchaseResponse} from "../util/iOSPurchase";
import {nbsp2space} from "../protyle/util/normalizeText";
import {armKeyboardLock, callMobileAppShowKeyboard, canInput, setWebViewFocusable} from "./util/mobileAppUtil";
import {hideAllElements} from "../protyle/ui/hideElements";
import {initTouchDragBridge} from "../util/touchDragBridge";
import {appearanceConfigApi} from "../config/tabs/appearanceRuntime";
import {openByMobile} from "../editor/openLink";

class App {
    public plugins: import("../plugin").Plugin[] = [];
    public appId: string;

    constructor() {
        if (checkPublishServiceClosed()) {
            return;
        }
        registerServiceWorker(`${Constants.SERVICE_WORKER_PATH}?v=${Constants.SIYUAN_VERSION}`);
        addBaseURL();
        this.appId = Constants.SIYUAN_APPID;

        const mainWs = new Model({app: this});
        mainWs.connect({
            id: genUUID(),
            type: "main",
            msgCallback: (data) => {
                this.plugins.forEach((plugin) => {
                    plugin.eventBus.emit("ws-main", data);
                });
                onMessage(this, data);
            }
        });

        window.siyuan = {
            zIndex: 10,
            notebooks: [],
            reqIds: {},
            backStack: [],
            dialogs: [],
            blockPanels: [],
            mobile: {
                size: {},
                docks: {
                    outline: null,
                    file: null,
                    bookmark: null,
                    tag: null,
                    backlink: null,
                    inbox: null,
                }
            },
            ws: mainWs
        };
        // 不能使用 touchstart，否则会被 event.stopImmediatePropagation() 阻塞
        window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (!window.siyuan.menus.menu.element.contains(event.target) && !hasClosestByAttribute(event.target, "data-menu", "true")) {
                window.siyuan.menus.menu.remove();
            }
            const copyElement = hasTopClosestByClassName(event.target, "protyle-action__copy");
            if (copyElement) {
                let text = copyElement.parentElement.nextElementSibling.textContent.trimEnd();
                text = nbsp2space(text); // Replace non-breaking spaces with normal spaces when copying https://github.com/siyuan-note/siyuan/issues/9382
                writeText(text);
                showMessage(window.siyuan.languages.copied, 2000);
                event.preventDefault();
            }
            if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
                setTimeout(() => {
                    event.target.scrollIntoView({
                        block: "center",
                    });
                }, Constants.TIMEOUT_TRANSITION);
            }
            if (canInput(event.target)) {
                // 原生 App 通过桥接主动唤起键盘；移动端浏览器没有桥接，但点击可编辑区域后也会立刻触发 resize，
                // 进而调用 activeBlur 关闭键盘（比如三星键盘 https://github.com/siyuan-note/siyuan/issues/18078），所以此处也需要上锁
                if (window.JSAndroid && window.JSAndroid.showKeyboard || window.JSHarmony && window.JSHarmony.showKeyboard) {
                    callMobileAppShowKeyboard();
                } else {
                    armKeyboardLock();
                }
            }
            if (document.contains(event.target) && !hasClosestByClassName(event.target as Element, "protyle-util")) {
                hideAllElements(["util"]);
            }
        });
        {
            const __siyuan_original_focus = HTMLElement.prototype.focus;
            HTMLElement.prototype.focus = function (this: HTMLElement, ...args) {
                try {
                    if (typeof __siyuan_original_focus === "function") {
                        __siyuan_original_focus.apply(this, args);
                    }
                } catch (e) {
                    console.error("Error in focus event:", e);
                }
                if (canInput(this)) {
                    // 原生 App 通过桥接主动唤起键盘；移动端浏览器没有桥接，仅上锁以阻止 focus 后立即触发的 activeBlur 关闭键盘
                    if (window.JSAndroid && window.JSAndroid.showKeyboard || window.JSHarmony && window.JSHarmony.showKeyboard) {
                        callMobileAppShowKeyboard();
                    } else {
                        armKeyboardLock();
                    }
                }
            };
        }
        window.addEventListener("beforeunload", () => {
            saveScroll(window.siyuan.mobile.editor.protyle);
        }, false);
        window.addEventListener("pagehide", () => {
            saveScroll(window.siyuan.mobile.editor.protyle);
        }, false);
        // 判断手机横竖屏状态
        window.matchMedia("(orientation:portrait)").addEventListener("change", () => {
            updateCardHV();
            activeBlur();
        });
        fetchPost("/api/system/getConf", {}, async (confResponse) => {
            addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
            addScript(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
            window.siyuan.config = confResponse.data.conf;
            window.siyuan.isPublish = confResponse.data.isPublish;
            correctHotkey(siyuanApp);
            await loadPlugins(this);
            getLocalStorage(() => {
                fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages: IObject) => {
                    window.siyuan.languages = lauguages;
                    window.siyuan.menus = new Menus(this);
                    document.title = window.siyuan.languages.siyuanNote;
                    bootSync();
                    appearanceConfigApi.apply(window.siyuan.config.appearance);
                    initMessage();
                    initAssets();
                    if (!isInMobileApp()) {
                        if (isChromeBrowser()) {
                            document.querySelector('meta[name="viewport"]').setAttribute("content", "width=device-width, height=device-height, interactive-widget=resizes-content, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover");
                        } else {
                            document.querySelector('meta[name="viewport"]').setAttribute("content", "width=device-width, height=device-height, interactive-widget=resizes-visual, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover");
                            if (!window.siyuan.config.readonly && !window.siyuan.isPublish
                                && window.siyuan.config.appearance.notifications?.browserCompatibility !== false) {
                                showMessage(window.siyuan.languages.useChrome, 0, "error");
                            }
                        }
                    } else if (!isInIOS()) {
                        document.querySelector('meta[name="viewport"]').setAttribute("content", "width=device-width, height=device-height, interactive-widget=resizes-visual, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover");
                    }
                    fetchPost("/api/setting/getCloudUser", {}, async userResponse => {
                        window.siyuan.user = userResponse.data;
                        await ensureOnboarding();
                        fetchPost("/api/system/getEmojiConf", {}, emojiResponse => {
                            window.siyuan.emojis = emojiResponse.data as IEmoji[];
                            setNoteBook(() => {
                                initFramework(this, confResponse.data.start);
                                initRightMenu(this);
                                openChangelog();
                            });
                        });
                    });
                });
            });
            document.addEventListener("touchstart", handleTouchStart, false);
            document.addEventListener("touchmove", handleTouchMove, false);
            document.addEventListener("touchend", handleTouchEnd, false);
            document.addEventListener("touchcancel", handleTouchEnd, false);
            window.addEventListener("nativePhysicalTouchUp", handleTouchUp, false);
            window.addEventListener("keyup", () => {
                window.siyuan.ctrlIsPressed = false;
                window.siyuan.shiftIsPressed = false;
                window.siyuan.altIsPressed = false;
            });
            window.addEventListener("blur", () => {
                setWebViewFocusable();
            });
            // 移动端删除键 https://github.com/siyuan-note/siyuan/issues/9259
            window.addEventListener("keydown", (event) => {
                mobileKeydown(siyuanApp, event);
                if (getSelection().rangeCount > 0) {
                    const range = getSelection().getRangeAt(0);
                    const editor = getCurrentEditor();
                    if (range.toString() === "" &&
                        editor && editor.protyle.wysiwyg.element.contains(range.startContainer) &&
                        !event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
                        const nodeElement = hasClosestBlock(range.startContainer);
                        if (nodeElement && isNotEditBlock(nodeElement)) {
                            nodeElement.classList.add("protyle-wysiwyg--select");
                            removeBlock(editor.protyle, nodeElement, range, event.key);
                            event.stopPropagation();
                            event.preventDefault();
                            return;
                        }
                    }
                }
            });
            initTouchDragBridge();
        });
    }
}

const siyuanApp = new App();

initWindowOpenOverride(siyuanApp, openByMobile);
// https://github.com/siyuan-note/siyuan/issues/8441
window.reconnectWebSocket = () => {
    // 后台唤醒时任一 socket 可能仍在 CONNECTING，调用 send 会抛 InvalidStateError，
    // 单独 try/catch 防止首个错误中断整个 ping 序列；下次 reconnectWebSocket 会再次尝试
    const tryPing = (m?: { send: (cmd: string, p: Record<string, unknown>) => void }) => {
        if (!m) {
            return;
        }
        try {
            m.send("ping", {});
        } catch (e) {
            console.warn("reconnectWebSocket: ping skipped", e);
        }
    };
    tryPing(window.siyuan.ws);
    tryPing(window.siyuan.mobile.docks?.file);
    tryPing(window.siyuan.mobile.editor?.protyle.ws);
    tryPing(window.siyuan.mobile.popEditor?.protyle.ws);
};
window.lockscreenByMode = () => {
    if (window.siyuan.config.system.lockScreenMode === 1) {
        lockScreen(siyuanApp);
    }
};
window.goBack = goBack;
window.showMessage = showMessage;
window.processIOSPurchaseResponse = processIOSPurchaseResponse;
window.showKeyboardToolbar = showKeyboardToolbar;
window.hideKeyboardToolbar = hideKeyboardToolbar;
window.openFileByURL = (openURL) => {
    const blockInfo = parseSiYuanUriInfo(openURL);
    if (blockInfo != null) {
        if (blockInfo.avItemID) {
            queueAVLocateRequest(blockInfo.id, {
                itemID: blockInfo.avItemID,
                viewID: blockInfo.avViewID,
                groupID: blockInfo.avGroupID,
            });
        }
        openMobileFileById(siyuanApp, blockInfo.id, blockInfo.avItemID ? [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL] :
            (blockInfo.focus ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]),
        undefined, undefined, blockInfo.avItemID ? (protyle) => activateQueuedAVLocate(protyle, blockInfo.id) : undefined);
        return true;
    }
    return false;
};
