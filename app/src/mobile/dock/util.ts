import {activeBlur} from "../util/keyboardToolbar";

export const openDock = (type: string) => {
    activeBlur();
    document.getElementById("sidebar").style.transform = "translateX(0px)";
    document.querySelector("#sidebar .toolbar--border").dispatchEvent(new CustomEvent("click", {detail:type}));
};
