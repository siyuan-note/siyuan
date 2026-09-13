import type {Dock} from "../layout/dock";

export const togglePinDock = (id: "switchLeftDock" | "switchRightDock" | "switchBottomDock", dock: Dock, pinIcon: string, unpinIcon: string) => {
    const isFloating = dock.isFloating();
    return {
        id,
        label: `${isFloating ? window.siyuan.languages.switchToFixedLayout : window.siyuan.languages.switchToFloatingLayout}`,
        icon: `${isFloating ? pinIcon : unpinIcon}`,
        accelerator: window.siyuan.config.keymap.general[id].custom,
        current: isFloating,
        click() {
            dock.togglePin();
        }
    };
};
