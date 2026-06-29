import type {SettingTabBuilder} from "../setting/builder";
import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {Constants} from "../../constants";
import {isBrowser, isMobile} from "../../util/functions";
import {showMessage} from "../../dialog/message";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {isInMobileApp, saveExportFile} from "../../protyle/util/compatibility";
import {genConfigItemMainHtml} from "../render/fragments";
import {renderPublishAuthAccounts, savePublish, sendAccessSetting, updatePublishConfig} from "./accessRuntime";
import {sendAppSetting} from "./appRuntime";

const registerAccessAuthGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("authentication", window.siyuan.languages.authentication);
    const onWeb = isBrowser() && !isInMobileApp();

    if (!window.siyuan.config.readonly && !onWeb) {
        group.button({
            id: "authCode",
            title: window.siyuan.languages.about5,
            desc: window.siyuan.languages.about6,
            label: window.siyuan.languages.config,
            icon: "iconLock",
            afterMount: mountAuthCodeButton,
        });
    }
    if (window.siyuan.config.accessAuthCode && !onWeb) {
        group.switch("system.lockScreenMode", {
            title: window.siyuan.languages.about7,
            desc: window.siyuan.languages.about8,
            save: (value) => sendAppSetting("system.lockScreenMode", value),
        });
    }
    group.text("api.token", {
        title: window.siyuan.languages.about13,
        desc: window.siyuan.languages.about14.replace("${token}", window.siyuan.config.api.token),
        save: (value) => sendAccessSetting("api.token", value),
        afterMount: bindApiTokenInput,
    });
};

const mountAuthCodeButton = (root: HTMLElement) => {
    root.querySelector("#authCode")?.addEventListener("click", () => {
        const dialog = new Dialog({
            title: window.siyuan.languages.about5,
            content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.about5}" value="${window.siyuan.config.accessAuthCode}">
    <div class="b3-label__text">${window.siyuan.languages.about6}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: isMobile() ? "92vw" : "520px",
        });
        const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
        const btnsElement = dialog.element.querySelectorAll(".b3-button");
        dialog.element.setAttribute("data-key", Constants.DIALOG_ACCESSAUTHCODE);
        dialog.bindInput(inputElement, () => {
            (btnsElement[1] as HTMLButtonElement).click();
        });
        inputElement.select();
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
        });
        btnsElement[1].addEventListener("click", () => {
            fetchPost("/api/system/setAccessAuthCode", {accessAuthCode: inputElement.value});
        });
    });
};

const bindApiTokenInput = (root: HTMLElement) => {
    const tokenElement = root.querySelector<HTMLInputElement>(`#${CSS.escape("api.token")}`);
    let tokenFocused = false;
    tokenElement?.addEventListener("focus", () => {
        tokenFocused = true;
    });
    tokenElement?.addEventListener("blur", () => {
        tokenFocused = false;
    });
    tokenElement?.addEventListener("mousedown", (event) => {
        if (!tokenFocused) {
            event.preventDefault();
            tokenElement.select();
        }
    });
};

const registerAccessServerGroup = (tab: SettingTabBuilder) => {
    const hideOnWeb = isBrowser() && !isInMobileApp();
    if (hideOnWeb) {
        return;
    }
    const group = tab.group("server", window.siyuan.languages.configGroupServer);

    group.switch("system.networkServe", {
        title: window.siyuan.languages.about11,
        desc: window.siyuan.languages.about12,
        save: (value) => sendAppSetting("system.networkServe", value),
    });
    if (window.siyuan.config.system.networkServe) {
        group.switch("system.networkServeTLS", {
            title: window.siyuan.languages.networkServeTLS,
            desc: `${window.siyuan.languages.networkServeTLSTip}<div class="fn__hr--small"></div>${window.siyuan.languages.networkServeTLSTip2}`,
            save: (value) => sendAppSetting("system.networkServeTLS", value),
        });
    }
    if (window.siyuan.config.system.networkServe && window.siyuan.config.system.networkServeTLS) {
        group.button({
            id: "exportCACert",
            title: window.siyuan.languages.exportCACert,
            desc: window.siyuan.languages.exportCACertTip,
            label: window.siyuan.languages.export,
            icon: "iconUpload",
            afterMount: (root) => {
                root.querySelector("#exportCACert")?.addEventListener("click", () => {
                    fetchPost("/api/system/exportTLSCACert", {}, (response) => {
                        void saveExportFile(response.data.path);
                    });
                });
            },
        });
        group.button({
            id: "exportCABundle",
            title: window.siyuan.languages.exportCABundle,
            desc: window.siyuan.languages.exportCABundleTip,
            label: window.siyuan.languages.export,
            icon: "iconUpload",
            afterMount: (root) => {
                root.querySelector("#exportCABundle")?.addEventListener("click", () => {
                    fetchPost("/api/system/exportTLSCABundle", {}, (response) => {
                        void saveExportFile(response.data.path);
                    });
                });
            },
        });
        group.button({
            id: "importCABundle",
            title: window.siyuan.languages.importCABundle,
            desc: window.siyuan.languages.importCABundleTip,
            label: window.siyuan.languages.import,
            icon: "iconDownload",
            afterMount: (root) => {
                root.querySelector("#importCABundle")?.addEventListener("click", () => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".zip";
                    input.onchange = () => {
                        if (input.files && input.files[0]) {
                            const formData = new FormData();
                            formData.append("file", input.files[0]);
                            fetch("/api/system/importTLSCABundle", {
                                method: "POST",
                                body: formData,
                            }).then(res => res.json()).then((response) => {
                                if (response.code === 0) {
                                    showMessage(window.siyuan.languages.importCABundleSuccess);
                                } else {
                                    showMessage(response.msg, 6000, "error");
                                }
                            });
                        }
                    };
                    input.click();
                });
            },
        });
    }
    group.stack({
        key: "localServer",
        keywords: [
            window.siyuan.languages.about2,
            window.siyuan.languages.about3,
            window.siyuan.languages.about4,
            window.siyuan.languages.about18,
        ],
        afterMount: (root) => {
            root.querySelector("#openLocalServer")?.addEventListener("click", () => {
                const url = `http://127.0.0.1:${location.port}`;
                /// #if !BROWSER
                void shell.openExternal(url);
                /// #else
                window.open(url);
                /// #endif
            });
        },
    }, (stack) => {
        stack.title(window.siyuan.languages.about2);
        stack.button({
            id: "openLocalServer",
            label: window.siyuan.languages.about4,
            icon: "iconLink",
        });
        stack.desc(window.siyuan.languages.about3.replace("${port}", location.port));
        stack.desc((() => {
            const parts: string[] = [];
            for (const serverAddr of window.siyuan.config.serverAddrs) {
                if (!serverAddr.trim()) {
                    break;
                }
                parts.push(`<code class="fn__code">${serverAddr}</code>`);
            }
            return parts.join(" ");
        })());
        stack.desc(window.siyuan.languages.about18);
    });
};

const registerAccessPublishGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("publish", window.siyuan.languages.configGroupPublish);

    group.switch("publish.enable", {
        title: window.siyuan.languages.publishService,
        desc: window.siyuan.languages.publishServiceTip,
        save: (value) => sendAccessSetting("publish.enable", value),
    });
    group.number("publish.port", {
        title: window.siyuan.languages.publishServicePort,
        desc: window.siyuan.languages.publishServicePortTip,
        min: 0,
        max: 65535,
        save: (value) => sendAccessSetting("publish.port", value),
    });
    group.slot({
        key: "publishAddresses",
        keywords: [
            window.siyuan.languages.publishServiceAddresses,
            window.siyuan.languages.publishServiceAddressesTip,
            window.siyuan.languages.publishServiceNotStarted,
        ],
        html: () => `<div class="b3-label config-item">
    <div class="fn__flex config-wrap">
        ${genConfigItemMainHtml(window.siyuan.languages.publishServiceAddresses, window.siyuan.languages.publishServiceAddressesTip)}
        <div class="fn__space"></div>
    </div>
    <div id="publishAddresses" class="b3-label__text"></div>
</div>`,
        afterMount: () => {
            fetchPost("/api/setting/getPublish", {}, (response: IWebSocketData) => {
                updatePublishConfig(true, response);
            });
        },
    });
    group.switch("publish.auth.enable", {
        title: window.siyuan.languages.publishServiceAuth,
        desc: window.siyuan.languages.publishServiceAuthTip,
        save: (value) => sendAccessSetting("publish.auth.enable", value),
    });
    group.button({
        id: "publishAuthAccountAdd",
        title: window.siyuan.languages.publishServiceAuthAccounts,
        desc: window.siyuan.languages.publishServiceAuthAccountsTip,
        label: window.siyuan.languages.publishServiceAuthAccountAdd,
        icon: "iconAdd",
        afterMount: (root) => {
            root.querySelector("#publishAuthAccountAdd")?.addEventListener("click", () => {
                window.siyuan.config.publish.auth.accounts.push({
                    username: "",
                    password: "",
                    memo: "",
                });
                renderPublishAuthAccounts();
            });
        },
    });
    group.slot({
        key: "publishAuthAccounts",
        keywords: [
            window.siyuan.languages.userName,
            window.siyuan.languages.password,
            window.siyuan.languages.memo,
            window.siyuan.languages.delete,
        ],
        html: () => '<div class="b3-label config-item"><div class="fn__flex-1" id="publishAuthAccounts" style="overflow: visible;"></div></div>',
        afterMount: mountPublishAuthAccounts,
    });
};

const mountPublishAuthAccounts = (root: HTMLElement) => {
    const publishAuthAccounts = root.querySelector("#publishAuthAccounts");
    publishAuthAccounts?.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        if (input.tagName !== "INPUT" || !input.dataset.name) {
            return;
        }
        const li = input.closest("li");
        if (li) {
            const index = parseInt(li.dataset.index);
            const name = input.dataset.name as keyof Config.IPublishAuthAccount;
            if (name in window.siyuan.config.publish.auth.accounts[index]) {
                window.siyuan.config.publish.auth.accounts[index][name] = input.value;
                savePublish(false);
            }
        }
    });
    publishAuthAccounts?.addEventListener("click", (event) => {
        const target = event.target as Element;
        const li = target.closest('[data-action="remove"]')?.closest("li");
        if (li) {
            const index = parseInt(li.dataset.index);
            window.siyuan.config.publish.auth.accounts.splice(index, 1);
            savePublish(true);
            return;
        }
        const togglePassword = target.closest('.b3-form__icona-icon[data-action="togglePassword"]');
        if (togglePassword) {
            const isEye = togglePassword.firstElementChild.getAttribute("xlink:href") === "#iconEye";
            togglePassword.firstElementChild.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
            togglePassword.previousElementSibling.setAttribute("type", isEye ? "text" : "password");
        }
    });
};

export const registerAccessTab = (tab: SettingTabBuilder) => {
    registerAccessAuthGroup(tab);
    registerAccessServerGroup(tab);
    registerAccessPublishGroup(tab);
};
