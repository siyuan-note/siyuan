export const openDock = (type: string) => {
    document.getElementById("toolbarFile").dispatchEvent(new CustomEvent("click"));
    document.querySelector("#sidebar .toolbar--border").dispatchEvent(new CustomEvent("click", {detail:type}));
};
