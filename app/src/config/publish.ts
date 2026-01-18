import {fetchPost} from "../util/fetch";
import {hasClosestByTag} from "../protyle/util/hasClosest";
import {isMobile} from "../util/functions";

export const publish = {
    element: undefined as Element,
    genHTML: () => {
        const mobile = isMobile();
        return `
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.publishService}
        <div class="b3-label__text">${window.siyuan.languages.publishServiceTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="publishEnable" type="checkbox"${window.siyuan.config.publish.enable ? " checked" : ""}/>
</label>
<div class="b3-label">
    ${(()=>{
        if (mobile) {
            return `
${window.siyuan.languages.publishServicePort}
<span class="fn__hr"></span>
<input class="b3-text-field fn__block" id="publishPort" type="number" min="0" max="65535" value="${window.siyuan.config.publish.port}">
<div class="b3-label__text">${window.siyuan.languages.publishServicePortTip}</div>`;
        } else {
            return `
<div class="fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.publishServicePort}
        <div class="b3-label__text">${window.siyuan.languages.publishServicePortTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="publishPort" type="number" min="0" max="65535" value="${window.siyuan.config.publish.port}">
</div>`;
        }
    })()}
</div>
<div class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.publishServiceAddresses}
            <div class="b3-label__text">${window.siyuan.languages.publishServiceAddressesTip}</div>
        </div>
        <div class="fn__space"></div>
    </div>
    <div class="fn__hr"></div>
    <div id="publishAddresses">
    </div>
</div>
<div class="b3-label">
    <label class="fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.publishServiceAuth}
            <div class="b3-label__text">${window.siyuan.languages.publishServiceAuthTip}</div>
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" id="publishAuthEnable" type="checkbox"${window.siyuan.config.publish.auth.enable ? " checked" : ""}/>
    </label>
</div>
<div class="b3-label">
    ${(()=>{
        if (mobile) {
            return `
${window.siyuan.languages.publishServiceAuthAccounts}
<div class="b3-label__text">${window.siyuan.languages.publishServiceAuthAccountsTip}</div>
<div class="b3-label b3-label--inner fn__flex">
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--outline fn__size200 fn__flex-center" id="publishAuthAccountAdd">
        <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.publishServiceAuthAccountAdd}
    </button>
</div>`;
        } else {
            return `
<div class="fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.publishServiceAuthAccounts}
        <div class="b3-label__text">${window.siyuan.languages.publishServiceAuthAccountsTip}</div>
    </div>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--outline fn__size200 fn__flex-center" id="publishAuthAccountAdd">
        <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.publishServiceAuthAccountAdd}
    </button>
</div>`;
        }
    })()}
    <div class="fn__flex-1" id="publishAuthAccounts">
    </div>
</div>
`;
    },
    bindEvent: () => {
        const publishAuthAccountAdd = publish.element.querySelector<HTMLButtonElement>("#publishAuthAccountAdd");

        // add account
        publishAuthAccountAdd.addEventListener("click", () => {
            window.siyuan.config.publish.auth.accounts.push({
                username: "",
                password: "",
                memo: "",
            });
            publish._renderPublishAuthAccounts(publish.element);
        });

        // input change
        publish.element.querySelectorAll("input").forEach(item => {
            item.addEventListener("change", () => {
                publish._savePublish();
            });
        });

        publish._refreshPublish();
    },
    _refreshPublish: () => {
        fetchPost("/api/setting/getPublish", {}, publish._updatePublishConfig.bind(null, true));
    },
    _savePublish: (reloadAccounts = true) => {
        const publishEnable = publish.element.querySelector<HTMLInputElement>("#publishEnable");
        const publishPort = publish.element.querySelector<HTMLInputElement>("#publishPort");
        const publishAuthEnable = publish.element.querySelector<HTMLInputElement>("#publishAuthEnable");

        fetchPost("/api/setting/setPublish", {
            enable: publishEnable.checked,
            port: publishPort.valueAsNumber,
            auth: {
                enable: publishAuthEnable.checked,
                accounts: window.siyuan.config.publish.auth.accounts,
            } as Config.IPublishAuth,
        } as Config.IPublish, publish._updatePublishConfig.bind(null, reloadAccounts));
    },
    _updatePublishConfig: (
        reloadAccounts: boolean,
        response: IWebSocketData,
    ) => {
        if (response.code === 0) {
            window.siyuan.config.publish = response.data.publish;
            if (reloadAccounts) {
                publish._renderPublishAuthAccounts(publish.element);
            }
            publish._renderPublishAddressList(publish.element, response.data.port);
        } else {
            publish._renderPublishAddressList(publish.element, 0);
        }
    },
    _renderPublishAuthAccounts: (
        element: Element,
        accounts: Config.IPublishAuthAccount[] = window.siyuan.config.publish.auth.accounts,
    ) => {
        const mobile = isMobile();
        const publishAuthAccounts = element.querySelector<HTMLDivElement>("#publishAuthAccounts");
        publishAuthAccounts.innerHTML = `<div class="fn__hr"></div><ul class="fn__flex-1">${
            accounts
                .map((account, index) => `
<li class="b3-label b3-label--inner fn__flex" data-index="${index}">
    <input class="b3-text-field fn__block" data-name="username" value="${account.username}" placeholder="${window.siyuan.languages.userName}">
    <span class="fn__space"></span>
    <div class="b3-form__icona fn__block">
        <input class="b3-text-field fn__block b3-form__icona-input" type="password" data-name="password" value="${account.password}" placeholder="${window.siyuan.languages.password}">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__block" data-name="memo" value="${account.memo}" placeholder="${window.siyuan.languages.memo}">
    <span class="fn__space"></span>
    ${(()=>{
        if (mobile) {
            return `
<button class="b3-button b3-button--outline fn__block" data-action="remove">
    <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.delete}
</button>`;
        } else {
            return `
<span data-action="remove" class="block__icon block__icon--show">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>`;
        }
    })()}
</li>
`)
                .join("")
        }</ul>`;

        // account field changed
        publishAuthAccounts
            .querySelectorAll("input")
            .forEach(input => {
                input.addEventListener("change", () => {
                    const li = hasClosestByTag(input, "LI");
                    if (li) {
                        const index = parseInt(li.dataset.index);
                        const name = input.dataset.name as keyof Config.IPublishAuthAccount;
                        if (name in window.siyuan.config.publish.auth.accounts[index]) {
                            window.siyuan.config.publish.auth.accounts[index][name] = input.value;
                            publish._savePublish(false);
                        }
                    }
                });
            });

        // delete account
        publishAuthAccounts
            .querySelectorAll('[data-action="remove"]')
            .forEach(remove => {
                remove.addEventListener("click", () => {
                    const li = hasClosestByTag(remove, "LI");
                    if (li) {
                        const index = parseInt(li.dataset.index);
                        window.siyuan.config.publish.auth.accounts.splice(index, 1);
                        publish._savePublish();
                    }
                });
            });

        // Toggle the password display status
        publishAuthAccounts
            .querySelectorAll('.b3-form__icona-icon[data-action="togglePassword"]')
            .forEach(togglePassword => {
                togglePassword.addEventListener("click", () => {
                    const isEye = togglePassword.firstElementChild.getAttribute("xlink:href") === "#iconEye";
                    togglePassword.firstElementChild.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
                    togglePassword.previousElementSibling.setAttribute("type", isEye ? "text" : "password");
                });
            });
    },
    _renderPublishAddressList: (
        element: Element,
        port: number,
    ) => {
        const publishAddresses = element.querySelector<HTMLDivElement>("#publishAddresses");
        if (port === 0) {
            publishAddresses.innerText = window.siyuan.languages.publishServiceNotStarted;
        } else {
            publishAddresses.innerHTML = `<div class="b3-label__text">${
                window.siyuan.config.serverAddrs
                    .map(serverAddr => {
                        serverAddr = serverAddr.substring(0, serverAddr.lastIndexOf(":"));
                        return `<code class="fn__code">${serverAddr}:${port}</code>`;
                    }).join(" ")
            }</div>`;
        }
    },
};
