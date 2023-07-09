export const upDownHint = (listElement: Element, event: KeyboardEvent, classActiveName = "b3-list-item--focus") => {
    let currentHintElement: HTMLElement = listElement.querySelector("." + classActiveName);
    const className = classActiveName.split("--")[0];
    if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (!currentHintElement.nextElementSibling) {
            listElement.children[0].classList.add(classActiveName);
        } else {
            if (currentHintElement.nextElementSibling.classList.contains(className)) {
                currentHintElement.nextElementSibling.classList.add(classActiveName);
            } else {
                currentHintElement.nextElementSibling.nextElementSibling.classList.add(classActiveName);
            }
        }
        currentHintElement = listElement.querySelector("." + classActiveName);
        if (listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop) {
            currentHintElement.scrollIntoView(listElement.scrollTop > currentHintElement.offsetTop);
        }
        return currentHintElement;
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (!currentHintElement.previousElementSibling) {
            const length = listElement.children.length;
            listElement.children[length - 1].classList.add(classActiveName);
        } else {
            if (currentHintElement.previousElementSibling.classList.contains(className)) {
                currentHintElement.previousElementSibling.classList.add(classActiveName);
            } else {
                currentHintElement.previousElementSibling.previousElementSibling.classList.add(classActiveName);
            }
        }
        currentHintElement = listElement.querySelector("." + classActiveName);
        if (listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop - currentHintElement.clientHeight * 2) {
            currentHintElement.scrollIntoView(listElement.scrollTop > currentHintElement.offsetTop - currentHintElement.clientHeight * 2);
        }
        return currentHintElement;
    }
};
