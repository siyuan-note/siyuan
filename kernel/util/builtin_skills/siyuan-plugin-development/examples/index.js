const {Plugin, showMessage} = require("siyuan");

module.exports = class LocalExample extends Plugin {
    onload() {
        this.disposed = false;
        this.button = null;
    }

    onLayoutReady() {
        if (this.disposed || this.button) {
            return;
        }
        this.button = this.addTopBar({
            icon: "iconPlugin",
            title: this.i18n.hello,
            position: "right",
            callback: () => {
                if (!this.disposed) {
                    showMessage(this.i18n.hello);
                }
            },
        });
    }

    onunload() {
        this.disposed = true;
        this.button?.remove();
        this.button = null;
    }
};
