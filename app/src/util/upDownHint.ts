export const upDownHint = (listElement: Element, event: KeyboardEvent) => {
    let currentHintElement: HTMLElement = listElement.querySelector(".b3-list-item--focus");

    if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove("b3-list-item--focus");
        if (!currentHintElement.nextElementSibling) {
            listElement.children[0].classList.add("b3-list-item--focus");
        } else {
            if (currentHintElement.nextElementSibling.classList.contains("b3-list-item")) {
                currentHintElement.nextElementSibling.classList.add("b3-list-item--focus");
            } else {
                currentHintElement.nextElementSibling.nextElementSibling.classList.add("b3-list-item--focus");
            }
        }
        currentHintElement = listElement.querySelector(".b3-list-item--focus");
        if (listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop) {
            listElement.scrollTop = currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight;
        }
        return currentHintElement;
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove("b3-list-item--focus");
        if (!currentHintElement.previousElementSibling) {
            const length = listElement.children.length;
            listElement.children[length - 1].classList.add("b3-list-item--focus");
        } else {
            if (currentHintElement.previousElementSibling.classList.contains("b3-list-item")) {
                currentHintElement.previousElementSibling.classList.add("b3-list-item--focus");
            } else {
                currentHintElement.previousElementSibling.previousElementSibling.classList.add("b3-list-item--focus");
            }
        }
        currentHintElement = listElement.querySelector(".b3-list-item--focus");
        if (listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop - currentHintElement.clientHeight * 2) {
            listElement.scrollTop = currentHintElement.offsetTop - currentHintElement.clientHeight * 2;
        }
        return currentHintElement;
    }
};
