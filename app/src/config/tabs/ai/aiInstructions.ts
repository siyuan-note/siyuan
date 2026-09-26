import {openInputDialog} from "../../../dialog/inputDialog";
import {showMessage} from "../../../dialog/message";
import {fetchPost} from "../../../util/fetch";

export const openAgentInstructions = () => {
    fetchPost("/api/ai/agent/getInstructions", {}, (response) => {
        const revision = response.data.revision;
        let saving = false;
        const dialog = openInputDialog({
            title: window.siyuan.languages.agentInstructions,
            value: response.data.content,
            multiline: true,
            resize: "vertical",
            description: window.siyuan.languages.agentInstructionsTip,
            confirmText: window.siyuan.languages.save,
            onConfirm: (content, currentDialog) => {
                if (saving) {
                    return;
                }
                if (new TextEncoder().encode(content).length > 32 * 1024) {
                    showMessage(window.siyuan.languages.agentInstructionsTooLarge);
                    return;
                }
                saving = true;
                const button = currentDialog.element.querySelector<HTMLButtonElement>("[data-input-confirm]");
                const input = currentDialog.element.querySelector<HTMLTextAreaElement>("textarea");
                button.disabled = true;
                input.disabled = true;
                // 失败时保留编辑内容和原修订，禁止静默覆盖其它窗口或同步产生的新版本。
                fetchPost("/api/ai/agent/setInstructions", {content, revision}, () => {
                    currentDialog.destroy();
                }).finally(() => {
                    saving = false;
                    button.disabled = false;
                    input.disabled = false;
                });
            },
        });
        dialog.element.querySelector<HTMLTextAreaElement>("textarea").rows = 12;
    });
};
