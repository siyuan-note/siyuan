import {Dialog} from "../../dialog";
import {showMessage} from "../../dialog/message";
import {escapeHtml} from "../../util/escape";

const sheets = new Set<MobileEditorDialog>();

export const closeMobileEditorSheets = () => {
    if (sheets.size) {
        return Promise.all(Array.from(sheets, dialog => dialog.close())).then(() => undefined);
    }
};

export class MobileEditorDialog extends Dialog {
    public beforeClose: () => Promise<void>;
    private closing?: Promise<void>;
    private discarded = false;

    public register() {
        sheets.add(this);
    }

    public close() {
        if (this.discarded) {
            return Promise.resolve();
        }
        if (!this.closing) {
            this.closing = Promise.resolve().then(() => this.beforeClose?.()).then(() => {
                sheets.delete(this);
                super.destroy();
            }).catch(error => {
                if (this.discarded) {
                    return;
                }
                this.closing = undefined;
                showMessage(escapeHtml(String(error)));
                throw error;
            });
        }
        return this.closing;
    }

    public destroy() {
        void this.close().catch(error => console.error(error));
    }

    // 笔记本锁定或内容删除时立即注销面板，不等待已经失去访问权限的保存请求。
    public discard() {
        this.discarded = true;
        sheets.delete(this);
        super.destroy();
    }
}
