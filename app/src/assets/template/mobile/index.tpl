<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, height=device-height, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
    <link rel="manifest" href="/manifest.webmanifest">
    <style id="editorFontSize" type="text/css"></style>
</head>
<body class="fn__flex-column">
<div id="loading" class="b3-dialog b3-dialog--open">
    <div class="b3-dialog__scrim" style="background-color: #1e1e1e"></div>
    <img style="position: absolute;width: 36vh;" src="../../icon.png">
</div>
<div class="toolbar toolbar--border">
    <svg id="toolbarFile" class="toolbar__icon">
        <use xlink:href="#iconMenu"></use>
    </svg>
    <input class="toolbar__title fn__hidden" id="toolbarName">
    <svg id="toolbarSync" class="toolbar__icon fn__none">
        <use xlink:href="#iconCloudSucc"></use>
    </svg>
    <svg id="toolbarEdit" class="toolbar__icon fn__hidden">
        <use xlink:href="#iconEdit"></use>
    </svg>
    <svg id="toolbarMore" class="toolbar__icon">
        <use xlink:href="#iconMore"></use>
    </svg>
</div>
<div id="editor" class="fn__none fn__flex-1"></div>
<div id="empty" class="b3-list--mobile"></div>
<div id="sidebar" class="side-panel fn__flex-column">
    <div class="toolbar toolbar--border">
        <svg data-type="sidebar-file-tab" class="toolbar__icon toolbar__icon--active"><use xlink:href="#iconFiles"></use></svg>
        <svg data-type="sidebar-outline-tab" class="toolbar__icon"><use xlink:href="#iconAlignCenter"></use></svg>
        <svg data-type="sidebar-bookmark-tab" class="toolbar__icon"><use xlink:href="#iconBookmark"></use></svg>
        <svg data-type="sidebar-tag-tab" class="toolbar__icon"><use xlink:href="#iconTags"></use></svg>
        <svg data-type="sidebar-backlink-tab" class="toolbar__icon"><use xlink:href="#iconLink"></use></svg>
        <svg data-type="sidebar-inbox-tab" class="toolbar__icon"><use xlink:href="#iconInbox"></use></svg>
        <span class="fn__flex-1"></span>
        <svg class="toolbar__icon"><use xlink:href="#iconRight"></use></svg>
    </div>
    <div class="fn__flex-1 b3-list--mobile">
        <div class="fn__flex-column" data-type="sidebar-file"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-outline"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-bookmark"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-tag"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-backlink"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-inbox"></div>
    </div>
</div>
<div id="menu" class="b3-menu b3-menu--fullscreen"></div>
<div id="model" class="side-panel side-panel--all fn__flex-column">
    <div class="toolbar toolbar--border">
        <svg class="toolbar__icon"><use xlink:href="#iconMenu"></use></svg>
        <span class="toolbar__text"></span>
        <svg id="modelClose" class="toolbar__icon">
            <use xlink:href="#iconCloseRound"></use>
        </svg>
    </div>
    <div id="modelMain" class="fn__flex-1"></div>
</div>
<div id="commonMenu" class="b3-menu fn__none">
    <div class="b3-menu__title fn__none">
        <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
        <span class="b3-menu__label"></span>
    </div>
    <div class="b3-menu__items"></div>
</div>
<div id="message" class="b3-snackbars"></div>
<div id="status" class="status status--hide"></div>
<div id="keyboardToolbar" class="keyboard fn__none"></div>
<div class="side-mask fn__none"></div>
</body>
</html>
