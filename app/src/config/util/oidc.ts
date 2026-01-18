import {Dialog} from "../../dialog";
import {fetchPost} from "../../util/fetch";
import {isMobile} from "../../util/functions";
import {showMessage} from "../../dialog/message";

const defaultProviders = ["custom", "google", "microsoft", "github"];
const claimOptions = [
    "provider",
    "subject",
    "email",
    "email_verified",
    "preferred_username",
    "name",
    "issuer",
    "audience",
    "hosted_domain",
    "tenant_id",
    "groups",
];

const cloneProviders = (providers: Record<string, Config.IOIDCProviderConf> | undefined) => {
    const cloned: Record<string, Config.IOIDCProviderConf> = {};
    if (!providers) {
        return cloned;
    }
    Object.keys(providers).forEach((id) => {
        const provider = providers[id];
        if (!provider) {
            return;
        }
        cloned[id] = {
            clientID: provider.clientID || "",
            clientSecret: provider.clientSecret || "",
            redirectURL: provider.redirectURL || "",
            issuerURL: provider.issuerURL || "",
            scopes: provider.scopes ? [...provider.scopes] : [],
            tenant: provider.tenant || "",
            providerLabel: provider.providerLabel || "",
            claimMap: provider.claimMap ? Object.assign({}, provider.claimMap) : {},
        };
    });
    return cloned;
};

const ensureProvider = (providers: Record<string, Config.IOIDCProviderConf>, id: string) => {
    if (!providers[id]) {
        providers[id] = {
            clientID: "",
            clientSecret: "",
            redirectURL: "",
            issuerURL: "",
            scopes: [],
            tenant: "",
            providerLabel: "",
            claimMap: {},
        };
    }
};

const parseScopes = (raw: string) => {
    return raw
        .split(/[, \t\r\n]+/)
        .map((item) => item.trim())
        .filter((item) => item);
};

type OIDCClaimMapRow = {
    claim: string;
    field: string;
};

const claimMapToRows = (claimMap: Record<string, string> | undefined) => {
    const rows: OIDCClaimMapRow[] = [];
    if (!claimMap) {
        return rows;
    }
    Object.keys(claimMap).sort().forEach((claim) => {
        rows.push({
            claim,
            field: claimMap[claim] || "",
        });
    });
    return rows;
};

const rowsToClaimMap = (rows: OIDCClaimMapRow[]) => {
    const claimMap: Record<string, string> = {};
    if (!rows.length) {
        return {claimMap};
    }
    for (const row of rows) {
        const claim = row.claim.trim();
        const field = row.field.trim();
        if (!claim || !field) {
            return {claimMap: null};
        }
        claimMap[claim] = field;
    }
    return {claimMap};
};

type OIDCFilterRow = {
    claim: string;
    op: string;
    pattern: string;
};

const parseFilterPattern = (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed) {
        return null;
    }
    const sepIndex = trimmed.indexOf(":");
    if (sepIndex > 0) {
        const prefix = trimmed.slice(0, sepIndex).trim().toLowerCase();
        const rest = trimmed.slice(sepIndex + 1).trim();
        if (prefix === "regex" || prefix === "re") {
            return {op: "regex", pattern: rest};
        }
        if (prefix === "regexi") {
            return {op: "regexi", pattern: rest};
        }
        if (prefix === "str" || prefix === "string") {
            return {op: "str", pattern: rest};
        }
        if (prefix === "exact") {
            return {op: "exact", pattern: rest};
        }
    }
    return {op: "regexi", pattern: trimmed};
};

const filterPatternFromRow = (row: OIDCFilterRow) => {
    const pattern = row.pattern.trim();
    if (!pattern) {
        return "";
    }
    switch (row.op) {
        case "regex":
            return `regex:${pattern}`;
        case "regexi":
            return `regexi:${pattern}`;
        case "str":
            return `str:${pattern}`;
        case "exact":
            return `exact:${pattern}`;
        default:
            return pattern;
    }
};

const filtersToRows = (filters: Record<string, string[]> | undefined) => {
    const rows: OIDCFilterRow[] = [];
    if (!filters) {
        return rows;
    }
    Object.keys(filters).sort().forEach((claim) => {
        const patterns = filters[claim] || [];
        patterns.forEach((pattern) => {
            const parsed = parseFilterPattern(pattern || "");
            if (!parsed) {
                return;
            }
            rows.push({
                claim,
                op: parsed.op,
                pattern: parsed.pattern,
            });
        });
    });
    return rows;
};

const rowsToFilters = (rows: OIDCFilterRow[]) => {
    const filters: Record<string, string[]> = {};
    for (const row of rows) {
        const claim = row.claim.trim();
        const pattern = row.pattern.trim();
        if (!claim || !pattern) {
            return {filters: null};
        }
        const encoded = filterPatternFromRow(row);
        if (!encoded) {
            return {filters: null};
        }
        if (!filters[claim]) {
            filters[claim] = [];
        }
        filters[claim].push(encoded);
    }
    return {filters};
};

export const setOIDCConfig = () => {
    const oidc = window.siyuan.config.oidc || {provider: "", providers: {}, filters: {}};
    const providers = cloneProviders(oidc.providers);
    const providerIds = Array.from(new Set([...defaultProviders, ...Object.keys(providers)])).filter((id) => id);
    if (oidc.provider && !providerIds.includes(oidc.provider)) {
        providerIds.unshift(oidc.provider);
    }
    let enabledProvider = oidc.provider || "";
    let currentProvider = oidc.provider || providerIds[0];
    ensureProvider(providers, currentProvider);
    const providerDisplayNames: Record<string, string> = {
        custom: window.siyuan.languages.oidcProviderCustom,
        google: "Google",
        microsoft: "Microsoft",
        github: "GitHub",
    };

    const dialog = new Dialog({
        title: "\uD83D\uDD10 " + window.siyuan.languages.oidc,
        width: isMobile() ? "92vw" : "640px",
        height: isMobile() ? "80vh" : "70vh",
        content: `<div class="b3-dialog__content">
    <div class="fn__flex b3-label config__item">
        <div class="fn__flex-1">
            ${window.siyuan.languages.oidcProvider}
            <div class="b3-label__text">${window.siyuan.languages.oidcProviderTip}</div>
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="oidcProvider">
            <option value=""${enabledProvider ? "" : " selected"}>${window.siyuan.languages.disable}</option>
            ${providerIds.map((id) => {
                const label = providerDisplayNames[id] || id;
                return `<option value="${id}"${id === enabledProvider ? " selected" : ""}>${label}</option>`;
            }).join("")}
        </select>
    </div>
    <div id="oidcProviderConfig">
        <div class="fn__flex b3-label config__item" id="oidcProviderLabelRow">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcProviderLabel}
                <div class="b3-label__text">${window.siyuan.languages.oidcProviderLabelTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcProviderLabel">
        </div>
        <div class="fn__flex b3-label config__item">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcClientID}
                <div class="b3-label__text">${window.siyuan.languages.oidcClientIDTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcClientID">
        </div>
        <div class="fn__flex b3-label config__item">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcClientSecret}
                <div class="b3-label__text">${window.siyuan.languages.oidcClientSecretTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcClientSecret" type="password">
        </div>
        <div class="fn__flex b3-label config__item" id="oidcIssuerRow">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcIssuerURL}
                <div class="b3-label__text">${window.siyuan.languages.oidcIssuerURLTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcIssuerURL">
        </div>
        <div class="fn__flex b3-label config__item">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcRedirectURL}
                <div class="b3-label__text">${window.siyuan.languages.oidcRedirectURLTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcRedirectURL">
        </div>
        <div class="fn__flex b3-label config__item" id="oidcScopesRow">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcScopes}
                <div class="b3-label__text">${window.siyuan.languages.oidcScopesTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcScopes">
        </div>
        <div class="fn__flex b3-label config__item fn__none" id="oidcTenantRow">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcTenant}
                <div class="b3-label__text">${window.siyuan.languages.oidcTenantTip}</div>
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field fn__size200" id="oidcTenant">
        </div>
        <div class="b3-label fn__none" id="oidcClaimMapRow">
            <div class="fn__flex config__item">
                <div class="fn__flex-1">
                    ${window.siyuan.languages.oidcClaimMap}
                    <div class="b3-label__text">${window.siyuan.languages.oidcClaimMapTip}</div>
                </div>
                <span class="fn__space"></span>
                <button class="b3-button b3-button--outline fn__size200 fn__flex-center" id="oidcClaimMapAdd">
                    <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.oidcClaimMapAdd}
                </button>
            </div>
            <div id="oidcClaimMapList"></div>
        </div>
    </div>
    <div class="b3-label" id="oidcFiltersBlock">
        <div class="fn__flex config__item">
            <div class="fn__flex-1">
                ${window.siyuan.languages.oidcFilters}
                <div class="b3-label__text">${window.siyuan.languages.oidcFiltersTip}</div>
                <div class="b3-label__text">${window.siyuan.languages.oidcFiltersTipLine1}</div>
                <div class="b3-label__text">${window.siyuan.languages.oidcFiltersTipLine2}</div>
            </div>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline fn__size200 fn__flex-center" id="oidcFilterAdd">
                <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.oidcFilterAdd}
            </button>
        </div>
        <div id="oidcFiltersList"></div>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.save}</button>
</div>`,
    });

    const providerSelect = dialog.element.querySelector("#oidcProvider") as HTMLSelectElement;
    const providerLabelInput = dialog.element.querySelector("#oidcProviderLabel") as HTMLInputElement;
    const clientIDInput = dialog.element.querySelector("#oidcClientID") as HTMLInputElement;
    const clientSecretInput = dialog.element.querySelector("#oidcClientSecret") as HTMLInputElement;
    const issuerInput = dialog.element.querySelector("#oidcIssuerURL") as HTMLInputElement;
    const redirectInput = dialog.element.querySelector("#oidcRedirectURL") as HTMLInputElement;
    const scopesInput = dialog.element.querySelector("#oidcScopes") as HTMLInputElement;
    const tenantInput = dialog.element.querySelector("#oidcTenant") as HTMLInputElement;
    const claimMapList = dialog.element.querySelector("#oidcClaimMapList") as HTMLDivElement;
    const claimMapAddButton = dialog.element.querySelector("#oidcClaimMapAdd") as HTMLButtonElement;
    const filtersList = dialog.element.querySelector("#oidcFiltersList") as HTMLDivElement;
    const filterAddButton = dialog.element.querySelector("#oidcFilterAdd") as HTMLButtonElement;
    const filtersBlock = dialog.element.querySelector("#oidcFiltersBlock") as HTMLElement;
    const providerConfigBlock = dialog.element.querySelector("#oidcProviderConfig") as HTMLElement;
    const issuerRow = dialog.element.querySelector("#oidcIssuerRow") as HTMLElement;
    const providerLabelRow = dialog.element.querySelector("#oidcProviderLabelRow") as HTMLElement;
    const scopesRow = dialog.element.querySelector("#oidcScopesRow") as HTMLElement;
    const tenantRow = dialog.element.querySelector("#oidcTenantRow") as HTMLElement;
    const claimMapRow = dialog.element.querySelector("#oidcClaimMapRow") as HTMLElement;
    const buttons = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");

    const setProviderVisibility = (id: string) => {
        const isKnownProvider = Object.prototype.hasOwnProperty.call(providerDisplayNames, id);
        const showAll = !isKnownProvider;
        const showIssuer = showAll || id === "custom";
        const showTenant = showAll || id === "microsoft";
        const showClaimMap = showAll || id === "custom";
        const showScopes = showAll || id === "custom";
        const showProviderLabel = showAll || id === "custom";
        issuerRow.classList.toggle("fn__none", !showIssuer);
        scopesRow.classList.toggle("fn__none", !showScopes);
        providerLabelRow.classList.toggle("fn__none", !showProviderLabel);
        tenantRow.classList.toggle("fn__none", !showTenant);
        claimMapRow.classList.toggle("fn__none", !showClaimMap);
    };

    const setProviderConfigVisible = (visible: boolean) => {
        providerConfigBlock.classList.toggle("fn__none", !visible);
    };

    const setFiltersVisible = (visible: boolean) => {
        filtersBlock.classList.toggle("fn__none", !visible);
    };

    let claimMapRows: OIDCClaimMapRow[] = [];

    const setProviderForm = (id: string) => {
        const provider = providers[id];
        providerLabelInput.value = provider.providerLabel || "";
        clientIDInput.value = provider.clientID || "";
        clientSecretInput.value = provider.clientSecret || "";
        issuerInput.value = provider.issuerURL || "";
        redirectInput.value = provider.redirectURL || "";
        scopesInput.value = provider.scopes && provider.scopes.length ? provider.scopes.join(", ") : "";
        tenantInput.value = provider.tenant || "";
        claimMapRows = claimMapToRows(provider.claimMap);
        renderClaimMapRows();
        setProviderVisibility(id);
    };

    const readProviderForm = () => {
        const provider = providers[currentProvider];
        let claimMap = provider.claimMap || {};
        if (currentProvider === "custom") {
            const claimMapResult = rowsToClaimMap(claimMapRows);
            if (!claimMapResult.claimMap) {
                showMessage(window.siyuan.languages.oidcClaimMapRowInvalid);
                return null;
            }
            claimMap = claimMapResult.claimMap || {};
        }
        return {
            clientID: clientIDInput.value.trim(),
            clientSecret: clientSecretInput.value,
            redirectURL: redirectInput.value.trim(),
            issuerURL: issuerInput.value.trim(),
            scopes: parseScopes(scopesInput.value),
            tenant: tenantInput.value.trim(),
            providerLabel: currentProvider === "custom" ? providerLabelInput.value.trim() : "",
            claimMap,
        } as Config.IOIDCProviderConf;
    };

    const filterRows = filtersToRows(oidc.filters);
    const operatorOptions = [
        {value: "regexi", label: window.siyuan.languages.oidcFilterOpRegexI},
        {value: "regex", label: window.siyuan.languages.oidcFilterOpRegex},
        {value: "str", label: window.siyuan.languages.oidcFilterOpString},
        {value: "exact", label: window.siyuan.languages.oidcFilterOpExact},
    ];

    const renderClaimMapRows = () => {
        const mobile = isMobile();
        if (!claimMapRows.length) {
            claimMapList.innerHTML = "";
            return;
        }

        claimMapList.innerHTML = `<div class="fn__hr"></div><ul class="fn__flex-1">${
            claimMapRows.map((row, index) => `
<li class="b3-label b3-label--inner fn__flex" data-index="${index}">
    <select class="b3-select fn__flex-center" data-field="claim">
        ${(() => {
            const options = claimOptions.slice();
            if (row.claim && !options.includes(row.claim)) {
                options.unshift(row.claim);
            }
            return options.map((claim) => `<option value="${claim}"${claim === row.claim ? " selected" : ""}>${claim}</option>`).join("");
        })()}
    </select>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__block" data-field="field" value="${row.field}" placeholder="${window.siyuan.languages.oidcClaimMapValuePlaceholder}">
    <span class="fn__space"></span>
    ${mobile ? `
    <button class="b3-button b3-button--outline fn__block" data-action="remove">
        <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.delete}
    </button>` : `
    <span data-action="remove" class="block__icon block__icon--show">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>`}
</li>`).join("")
        }</ul>`;

        claimMapList.querySelectorAll("input, select").forEach((input) => {
            input.addEventListener("change", () => {
                const li = input.closest("li");
                if (!li) {
                    return;
                }
                const index = parseInt(li.getAttribute("data-index") || "0", 10);
                const field = (input as HTMLInputElement).dataset.field;
                if (!claimMapRows[index] || !field) {
                    return;
                }
                if (field === "claim") {
                    claimMapRows[index].claim = (input as HTMLInputElement).value;
                } else if (field === "field") {
                    claimMapRows[index].field = (input as HTMLInputElement).value;
                }
            });
        });

        claimMapList.querySelectorAll('[data-action="remove"]').forEach((remove) => {
            remove.addEventListener("click", () => {
                const li = remove.closest("li");
                if (!li) {
                    return;
                }
                const index = parseInt(li.getAttribute("data-index") || "0", 10);
                claimMapRows.splice(index, 1);
                renderClaimMapRows();
            });
        });
    };

    const renderFilterRows = () => {
        filtersList.innerHTML = `<div class="fn__hr"></div><ul class="fn__flex-1">${
            filterRows
                .map((row, index) => `
<li class="b3-label b3-label--inner fn__flex" data-index="${index}">
    <select class="b3-select fn__flex-center" data-field="claim">
        ${(() => {
            const options = claimOptions.slice();
            if (row.claim && !options.includes(row.claim)) {
                options.unshift(row.claim);
            }
            return options.map((claim) => `<option value="${claim}"${claim === row.claim ? " selected" : ""}>${claim}</option>`).join("");
        })()}
    </select>
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center" data-field="op">
        ${operatorOptions.map((opt) => `<option value="${opt.value}"${opt.value === row.op ? " selected" : ""}>${opt.label}</option>`).join("")}
    </select>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__block" data-field="pattern" value="${row.pattern}" placeholder="${window.siyuan.languages.oidcFilterPatternPlaceholder}">
    <span class="fn__space"></span>
    ${isMobile() ? `
    <button class="b3-button b3-button--outline fn__block" data-action="remove">
        <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.delete}
    </button>` : `
    <span data-action="remove" class="block__icon block__icon--show">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>`}
</li>`).join("")
        }</ul>`;

        filtersList.querySelectorAll("input, select").forEach((input) => {
            input.addEventListener("change", () => {
                const li = input.closest("li");
                if (!li) {
                    return;
                }
                const index = parseInt(li.getAttribute("data-index") || "0", 10);
                const field = (input as HTMLInputElement).dataset.field;
                if (!filterRows[index] || !field) {
                    return;
                }
                if (field === "op") {
                    filterRows[index].op = (input as HTMLSelectElement).value;
                } else if (field === "claim") {
                    filterRows[index].claim = (input as HTMLInputElement).value;
                } else if (field === "pattern") {
                    filterRows[index].pattern = (input as HTMLInputElement).value;
                }
            });
        });

        filtersList.querySelectorAll('[data-action="remove"]').forEach((remove) => {
            remove.addEventListener("click", () => {
                const li = remove.closest("li");
                if (!li) {
                    return;
                }
                const index = parseInt(li.getAttribute("data-index") || "0", 10);
                filterRows.splice(index, 1);
                renderFilterRows();
            });
        });
    };

    setProviderForm(currentProvider);
    setProviderConfigVisible(!!enabledProvider);
    setFiltersVisible(!!enabledProvider);
    renderFilterRows();

    claimMapAddButton.addEventListener("click", () => {
        const defaultClaim = claimOptions[0] || "";
        claimMapRows.push({
            claim: defaultClaim,
            field: "",
        });
        renderClaimMapRows();
    });

    filterAddButton.addEventListener("click", () => {
        const defaultClaim = claimOptions[0] || "";
        filterRows.push({
            claim: defaultClaim,
            op: "regexi",
            pattern: "",
        });
        renderFilterRows();
    });

    providerSelect.addEventListener("change", () => {
        const nextProvider = providerSelect.value;
        const updated = readProviderForm();
        if (!updated) {
            providerSelect.value = enabledProvider;
            return;
        }
        providers[currentProvider] = updated;
        if (nextProvider) {
            currentProvider = nextProvider;
            ensureProvider(providers, currentProvider);
            setProviderForm(currentProvider);
        }
        enabledProvider = nextProvider;
        setProviderConfigVisible(!!enabledProvider);
        setFiltersVisible(!!enabledProvider);
    });

    buttons[0].addEventListener("click", () => {
        dialog.destroy();
    });

    buttons[1].addEventListener("click", () => {
        const updated = readProviderForm();
        if (!updated) {
            return;
        }
        providers[currentProvider] = updated;
        const filtersResult = rowsToFilters(filterRows);
        if (!filtersResult.filters) {
            showMessage(window.siyuan.languages.oidcFiltersRowInvalid);
            return;
        }
        const payload = {
            provider: enabledProvider,
            providers,
            filters: filtersResult.filters,
        };
        fetchPost("/api/system/setOIDCConfig", {oidc: payload}, () => {
            window.siyuan.config.oidc = payload;
            dialog.destroy();
        });
    });
};
