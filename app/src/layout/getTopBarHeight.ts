export const getTopBarHeight = () => {
    return  document.getElementById("sidebar") ? 0 : (document.getElementById("toolbar")?.clientHeight || document.querySelector(".layout-tab-bar").clientHeight);
};
