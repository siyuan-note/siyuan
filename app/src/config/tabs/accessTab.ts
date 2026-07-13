import type {SettingTabBuilder} from "../setting/builder";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {Constants} from "../../constants";
import {isBrowser, isMobile} from "../../util/functions";
import {showMessage} from "../../dialog/message";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {isInMobileApp, saveExportFile} from "../../protyle/util/compatibility";
import {openByMobile} from "../../editor/openLink";
import {genConfigItemMainHtml} from "../render/fragments";
import {renderPublishAuthAccounts, savePublish, sendAccessSetting, updatePublishConfig} from "./accessRuntime";
import {sendAppSetting} from "./appRuntime";
import zxcvbn = require("zxcvbn");

const getPasswordStrength = (password: string) => {
    const score = zxcvbn(password).score;
    if (score <= 1) {
        return "weak";
    }
    if (score === 2) {
        return "medium";
    }
    return "strong";
};

const updatePasswordStrength = (element: HTMLElement, password: string) => {
    if (!password) {
        element.classList.add("fn__none");
        return;
    }
    const strength = getPasswordStrength(password);
    element.classList.remove("fn__none");
    element.setAttribute("data-strength", strength);
    element.textContent = window.siyuan.languages[`passwordStrength${strength[0].toUpperCase()}${strength.slice(1)}`];
};

const confirmWeakPassword = (password: string, confirm: () => void) => {
    if (getPasswordStrength(password) !== "weak") {
        confirm();
        return;
    }
    confirmDialog("⚠️ " + window.siyuan.languages.weakPasswordConfirmTitle, window.siyuan.languages.weakPasswordConfirmTip, confirm);
};

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
                openByMobile(url);
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
    registerEncryptedNotebookGroup(tab);
    registerAccessServerGroup(tab);
    registerAccessPublishGroup(tab);
};

const registerEncryptedNotebookGroup = (tab: SettingTabBuilder) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    const group = tab.group("encryptedNotebook", window.siyuan.languages.encryptedNotebook);
    group.slot({
        key: "encryptedNotebookStatus",
        keywords: [
            window.siyuan.languages.encryptedNotebook,
            window.siyuan.languages.enableEncryptedNotebook,
            window.siyuan.languages.masterPassword,
            window.siyuan.languages.changeMasterPassword,
        ],
        html: () =>
            // 开关行：结构与标准 group.switch 一致（label + config-item + b3-switch fn__flex-center）
            `<label class="fn__flex b3-label config-item">
	    ${genConfigItemMainHtml(window.siyuan.languages.enableEncryptedNotebook, window.siyuan.languages.encryptedNotebookTip + "<br><span class=\"ft__error\">" + window.siyuan.languages.encryptedNotebookRiskTip + "</span><br>" + window.siyuan.languages.featurePreview)}
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="encryptedNotebookSwitch" type="checkbox">
</label>
<div class="b3-label config-item fn__none" id="encryptedNotebookMigrationAlert">
    <div class="ft__error">${window.siyuan.languages.masterPasswordMigrationPending}</div>
</div>
<div class="b3-label config-item fn__none" id="encryptedNotebookActions">
    <div class="fn__flex fn__flex-center config-wrap">
        <div class="fn__flex-1"></div>
        <div class="fn__flex fn__flex-center" id="encryptedNotebookEnabledActions">
            <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="changeMasterPasswordBtn">
                <svg class="svg"><use xlink:href="#iconLock"></use></svg>
                ${window.siyuan.languages.changeMasterPassword}
            </button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="exportCryptoBackupBtn">
                <svg class="svg"><use xlink:href="#iconDownload"></use></svg>
                ${window.siyuan.languages.exportNotebookCryptoBackup}
            </button>
            <span class="fn__space"></span>
        </div>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="importCryptoBackupBtn">
            <svg class="svg"><use xlink:href="#iconUpload"></use></svg>
            ${window.siyuan.languages.importNotebookCryptoBackup}
        </button>
    </div>
</div>`,
        afterMount: mountEncryptedNotebook,
    });
    group.number("notebookCrypto.autoLockMinutes", {
        title: window.siyuan.languages.encryptedNotebookAutoLock,
        desc: window.siyuan.languages.encryptedNotebookAutoLockDesc,
        min: 0,
        save: (value) => {
            fetchPost("/api/notebook/setNotebookCryptoAutoLock", {autoLockMinutes: value});
        },
    });
};

const mountEncryptedNotebook = (root: HTMLElement) => {
    const switchElement = root.querySelector("#encryptedNotebookSwitch") as HTMLInputElement;
    const actionsElement = root.querySelector("#encryptedNotebookActions");
    const enabledActionsElement = root.querySelector("#encryptedNotebookEnabledActions");
    const importCryptoBackupBtnElement = root.querySelector("#importCryptoBackupBtn");
    const migrationAlertElement = root.querySelector("#encryptedNotebookMigrationAlert");
    const refresh = () => {
        fetchPost("/api/notebook/getEncryptedNotebookStatus", {}, (response) => {
            const enabled = response.data.enabled;
            switchElement.checked = enabled;
            window.siyuan.config.notebookCrypto.enabled = enabled;
            // 修改主密码/导出密钥仅在启用时可见；导入密钥仅在未启用时可见（详见设计 §4.1，
            // 已启用时导入会用导入备份的 MasterSalt/KEKVerifier 覆盖当前配置，孤立现有 WrappedDEK）
            enabledActionsElement.classList.toggle("fn__none", !enabled);
            importCryptoBackupBtnElement.classList.toggle("fn__none", enabled);
            actionsElement.classList.remove("fn__none");
            migrationAlertElement.classList.toggle("fn__none", !response.data.migrationPending);
        });
    };
    refresh();

    actionsElement.querySelector("#changeMasterPasswordBtn")?.addEventListener("click", () => {
        openChangeMasterPasswordDialog(refresh);
    });

    actionsElement.querySelector("#exportCryptoBackupBtn")?.addEventListener("click", () => {
        fetchPost("/api/notebook/exportNotebookCryptoBackup", {}, async (response) => {
            if (response.code === -1) {
                showMessage(response.msg, 6000, "error");
                return;
            }
            await saveExportFile(response.data.file);
            showMessage(window.siyuan.languages.exportNotebookCryptoBackupTip);
        });
    });

    actionsElement.querySelector("#importCryptoBackupBtn")?.addEventListener("click", () => {
        // 用隐藏 file input 选备份文件，multipart 上传导入
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json,application/json";
        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (!file) {
                return;
            }
            // 导入前需输入主密码校验（备份文件不含密码，校验用导入备份对应的主密码）
            const passwordDialog = new Dialog({
                title: window.siyuan.languages.masterPassword,
                content: `<div class="b3-dialog__content">
    <input type="password" placeholder="${window.siyuan.languages.masterPassword}" class="b3-text-field fn__block">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: "520px",
            });
            const pwdInput = passwordDialog.element.querySelector(".b3-text-field") as HTMLInputElement;
            passwordDialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => {
                passwordDialog.destroy();
            });
            passwordDialog.element.querySelector(".b3-button--text")?.addEventListener("click", () => {
                const password = pwdInput.value.trim();
                if (!password) {
                    showMessage(window.siyuan.languages.masterPassword);
                    return;
                }
                const formData = new FormData();
                formData.append("file", file);
                formData.append("password", password);
                fetch("/api/notebook/importNotebookCryptoBackup", {
                    method: "POST",
                    body: formData,
                }).then((res) => res.json()).then((response: IWebSocketData) => {
                    if (response.code === -1) {
                        showMessage(response.msg, 6000, "error");
                        return;
                    }
                    showMessage(window.siyuan.languages.importNotebookCryptoBackupTip);
                    passwordDialog.destroy();
                    refresh();
                });
            });
            pwdInput.focus();
        };
        fileInput.click();
    });

    switchElement.addEventListener("change", () => {
        if (switchElement.checked) {
            // 切到 ON：弹设密码框
            // onSuccess/onCancel 都用 refresh：开关状态以后端 enabled 真相为准，
            // 避免成功后 destroy 的 setTimeout 回调把开关错误地翻回 OFF（曾因 onCancel 直接置 false 而覆盖成功态）
            openEnableEncryptedDialog(refresh, refresh);
        } else {
            // 切到 OFF：没有加密笔记本时允许关闭
            fetchPost("/api/notebook/getEncryptedNotebookStatus", {}, (response) => {
                if (response.data.count > 0) {
                    showMessage(window.siyuan.languages.encryptedNotebookDisableTip.replace("${x}", response.data.count), 4000);
                    switchElement.checked = true;
                } else if (response.data.hasHistoryDependency) {
                    // 已删除加密笔记本的历史仍依赖当前密钥备份，禁用会让其永久锁死（详见设计 §19）
                    showMessage(window.siyuan.languages["_kernel"]["323"], 6000, "error");
                    switchElement.checked = true;
                } else {
                    // 用 sync 调用以便后端因任何原因拒绝时回滚开关，避免 UI 与后端状态不一致
                    fetchSyncPost("/api/notebook/disableEncryptedNotebooks", {}).then((res: IWebSocketData) => {
                        if (res.code === -1) {
                            switchElement.checked = true; // processMessage 已弹出错误，这里只回滚开关
                            return;
                        }
                        showMessage(window.siyuan.languages.encryptedNotebookDisabled);
                        refresh();
                    });
                }
            });
        }
    });
};

const openEnableEncryptedDialog = (onSuccess: () => void, onCancel: () => void) => {
    const dialog = new Dialog({
        title: "🔐 " + window.siyuan.languages.setMasterPassword,
        content: `<div class="b3-dialog__content">
    <input type="password" placeholder="${window.siyuan.languages.masterPassword}" class="b3-text-field fn__block">
    <div class="password-strength fn__none"></div>
    <div class="fn__hr"></div>
    <input type="password" placeholder="${window.siyuan.languages.confirmMasterPassword}" class="b3-text-field fn__block">
    <div class="fn__hr--b"></div>
    <label class="b3-label__text"><input type="checkbox" id="encRiskConfirm"> ${window.siyuan.languages.encryptedNotebookRiskTip}</label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" disabled>${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        destroyCallback: onCancel,
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    const inputs = dialog.element.querySelectorAll("input");
    const confirmBtn = btnsElement[1] as HTMLButtonElement;
    const riskCheckbox = dialog.element.querySelector("#encRiskConfirm") as HTMLInputElement;
    const passwordStrength = dialog.element.querySelector(".password-strength") as HTMLElement;
    (inputs[0] as HTMLInputElement).focus();
    inputs[0].addEventListener("input", () => updatePasswordStrength(passwordStrength, inputs[0].value));
    riskCheckbox.addEventListener("change", () => {
        confirmBtn.disabled = !riskCheckbox.checked;
    });
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    confirmBtn.addEventListener("click", () => {
        const pwd1 = (inputs[0] as HTMLInputElement).value;
        const pwd2 = (inputs[1] as HTMLInputElement).value;
        if (!pwd1) {
            showMessage(window.siyuan.languages.masterPassword);
            return;
        }
        if (pwd1 !== pwd2) {
            showMessage(window.siyuan.languages.passwordNoMatch);
            return;
        }
        confirmWeakPassword(pwd1, async () => {
            const response = await fetchSyncPost("/api/notebook/enableEncryptedNotebooks", {password: pwd1});
            if (response.code === 0) {
                showMessage(window.siyuan.languages.encryptedNotebookEnabled);
                dialog.destroy();
                onSuccess();
            }
        });
    });
};

const openChangeMasterPasswordDialog = (onChanged?: () => void) => {
    const dialog = new Dialog({
        title: "🔐 " + window.siyuan.languages.changeMasterPassword,
        content: `<div class="b3-dialog__content">
    <input type="password" placeholder="${window.siyuan.languages.oldMasterPassword}" class="b3-text-field fn__block">
    <div class="fn__hr"></div>
    <input type="password" placeholder="${window.siyuan.languages.newMasterPassword}" class="b3-text-field fn__block">
    <div class="password-strength fn__none"></div>
    <div class="fn__hr"></div>
    <input type="password" placeholder="${window.siyuan.languages.confirmMasterPassword}" class="b3-text-field fn__block">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    const inputs = dialog.element.querySelectorAll("input");
    const passwordStrength = dialog.element.querySelector(".password-strength") as HTMLElement;
    inputs[1].addEventListener("input", () => updatePasswordStrength(passwordStrength, inputs[1].value));
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        const oldPwd = (inputs[0] as HTMLInputElement).value;
        const newPwd = (inputs[1] as HTMLInputElement).value;
        const confirmPwd = (inputs[2] as HTMLInputElement).value;
        if (!oldPwd || !newPwd) {
            return;
        }
        if (newPwd !== confirmPwd) {
            showMessage(window.siyuan.languages.passwordNoMatch);
            return;
        }
        confirmWeakPassword(newPwd, async () => {
            const response = await fetchSyncPost("/api/notebook/changeMasterPassword", {
                oldPassword: oldPwd,
                newPassword: newPwd
            });
            if (response.code === 0) {
                showMessage(window.siyuan.languages.changeMasterPasswordSuccessTip);
                dialog.destroy();
            } else {
                showMessage(response.msg, 6000, "error");
                onChanged?.();
            }
        });
    });
};
