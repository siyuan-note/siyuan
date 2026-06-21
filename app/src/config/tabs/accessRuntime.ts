import {fetchPost} from "../../util/fetch";
import {isMobile} from "../../util/functions";

/** 访问授权 Tab 根节点，供 send 回调更新局部 UI */
let accessTabElement: HTMLElement | undefined;

/** 设置对话框关闭后释放 Tab 根节点引用，避免持有已脱离文档的 DOM */
export const clearAccessTabElement = () => {
    accessTabElement = undefined;
};

/** 访问授权 Tab 挂载后记录根节点（供 setting/tabs.ts afterMount 调用） */
export const mountAccessTab = (root: HTMLElement) => {
    accessTabElement = root;
};

export const savePublish = (
    reloadAccounts: boolean,
    overrides?: {
        enable?: boolean;
        port?: number;
        authEnable?: boolean;
    },
) => {
    fetchPost("/api/setting/setPublish", {
        enable: overrides?.enable ?? window.siyuan.config.publish.enable,
        port: overrides?.port ?? window.siyuan.config.publish.port,
        auth: {
            enable: overrides?.authEnable ?? window.siyuan.config.publish.auth.enable,
            accounts: window.siyuan.config.publish.auth.accounts,
        },
    }, (response: IWebSocketData) => {
        updatePublishConfig(reloadAccounts, response);
    });
};

export const updatePublishConfig = (
    reloadAccounts: boolean,
    response: IWebSocketData,
) => {
    let port = 0;
    if (response.code === 0) {
        window.siyuan.config.publish = response.data.publish;
        port = response.data.port;
        if (reloadAccounts) {
            renderPublishAuthAccounts();
        }
    }
    const publishAddresses = accessTabElement?.querySelector("#publishAddresses");
    if (!publishAddresses) {
        return;
    }
    if (port === 0) {
        publishAddresses.innerHTML = `<div class="ft__error">${window.siyuan.languages.publishServiceNotStarted}</div>`;
    } else {
        publishAddresses.innerHTML = `<div class="ft__on-surface">${
            window.siyuan.config.serverAddrs.map(serverAddr => {
                serverAddr = serverAddr.substring(0, serverAddr.lastIndexOf(":"));
                return `<code class="fn__code">${serverAddr}:${port}</code>`;
            }).join(" ")
        }</div>`;
    }
};

export const renderPublishAuthAccounts = () => {
    const publishAuthAccounts = accessTabElement?.querySelector("#publishAuthAccounts");
    if (!publishAuthAccounts) {
        return;
    }
    const removeButtonHtml = isMobile() ?
        `<button class="b3-button b3-button--outline fn__block" data-action="remove"><svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.delete}</button>`
        : '<span data-action="remove" class="block__icon block__icon--show"><svg><use xlink:href="#iconTrashcan"></use></svg></span>';
    const listItemHtml = window.siyuan.config.publish.auth.accounts.map((account, index) => `
<li class="b3-label b3-label--inner fn__flex" data-index="${index}">
    <input class="b3-text-field fn__block" data-name="username" value="${Lute.EscapeHTMLStr(account.username)}" placeholder="${window.siyuan.languages.userName}">
    <span class="fn__space"></span>
    <div class="b3-form__icona fn__block">
        <input class="b3-text-field fn__block b3-form__icona-input" type="password" data-name="password" value="${Lute.EscapeHTMLStr(account.password)}" placeholder="${window.siyuan.languages.password}">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__block" data-name="memo" value="${Lute.EscapeHTMLStr(account.memo)}" placeholder="${window.siyuan.languages.memo}">
    <span class="fn__space"></span>
    ${removeButtonHtml}
</li>`).join("");
    publishAuthAccounts.innerHTML = `<ul class="fn__flex-1" style="overflow: visible;">${listItemHtml}</ul>`;
};

/** 访问授权 Tab：按控件 id 路由到各 API */
export const sendAccessSetting = (controlId: string, value: unknown) => {
    switch (controlId) {
        case "api.token": {
            const token = value as Config.IAPI["token"];
            fetchPost("/api/system/setAPIToken", {token}, () => {
                window.siyuan.config.api.token = token;
                const tokenTipEl = accessTabElement?.querySelector(`#${CSS.escape("api.token")}`)?.closest(".config-item")?.querySelector(".b3-label__text");
                if (tokenTipEl) {
                    tokenTipEl.innerHTML = window.siyuan.languages.about14.replace("${token}", Lute.EscapeHTMLStr(token));
                }
            });
            break;
        }
        case "publish.enable": {
            const enable = Boolean(value) as Config.IPublish["enable"];
            savePublish(true, {enable});
            break;
        }
        case "publish.port": {
            const port = value as Config.IPublish["port"];
            savePublish(true, {port});
            break;
        }
        case "publish.auth.enable": {
            const authEnable = Boolean(value) as Config.IPublishAuth["enable"];
            savePublish(true, {authEnable});
            break;
        }
        default:
            console.warn(`[config] sendAccessSetting: unhandled controlId "${controlId}"`);
            break;
    }
};
