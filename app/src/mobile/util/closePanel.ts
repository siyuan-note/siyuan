export const closePanel = () => {
    document.getElementById("menu").style.right = "-100vw";
    document.getElementById("sidebar").style.left = "-100vw";
    document.getElementById("model").style.top = "-200vh";
    document.querySelector(".scrim").classList.add("fn__none");
};
