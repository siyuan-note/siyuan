import type {SettingTabBuilder} from "../setting/builder";
import {
    genSecretsBlockHtml,
    getSecretsBlockKeywords,
    mountSecretsBlock,
    genVariablesBlockHtml,
    getVariablesBlockKeywords,
    mountVariablesBlock,
} from "./secretsVariablesUi";

const registerSecretsGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("secrets", window.siyuan.languages.secrets);

    group.slot({
        key: "secrets",
        keywords: getSecretsBlockKeywords(),
        html: genSecretsBlockHtml,
        afterMount: mountSecretsBlock,
    });
};

const registerVariablesGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("variables", window.siyuan.languages.variables);

    group.slot({
        key: "variables",
        keywords: getVariablesBlockKeywords(),
        html: genVariablesBlockHtml,
        afterMount: mountVariablesBlock,
    });
};

export const registerSecretsVariablesTab = (tab: SettingTabBuilder) => {
    registerSecretsGroup(tab);
    registerVariablesGroup(tab);
};
