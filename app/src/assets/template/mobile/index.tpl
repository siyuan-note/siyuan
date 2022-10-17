<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
    <style id="editorFontSize" type="text/css"></style>
</head>
<body class="fn__flex-column">
<div id="loading" class="b3-dialog b3-dialog--open">
    <div class="b3-dialog__scrim" style="background-color: #212224"></div>
    <img style="position: absolute;width: 36vh;" src="../../icon.png">
</div>
<div class="toolbar toolbar--border">
    <svg id="toolbarFile" class="toolbar__icon">
        <use xlink:href="#iconMenu"></use>
    </svg>
    <input class="toolbar__title b3-text-field fn__hidden" id="toolbarName">
    <svg id="toolbarEdit" class="toolbar__icon fn__hidden">
        <use xlink:href="#iconEdit"></use>
    </svg>
    <svg id="toolbarMore" class="toolbar__icon">
        <use xlink:href="#iconMore"></use>
    </svg>
</div>
<div id="editor" class="fn__none fn__flex-1"></div>
<div id="empty"></div>
<div class="scrim fn__none"></div>
<div id="sidebar" class="side-panel side-panel--left fn__flex-column">
    <div class="toolbar toolbar--border toolbar--dark">
        <svg data-type="sidebar-file-tab" class="toolbar__icon toolbar__icon--active"><use xlink:href="#iconFiles"></use></svg>
        <svg data-type="sidebar-outline-tab" class="toolbar__icon"><use xlink:href="#iconAlignCenter"></use></svg>
        <svg data-type="sidebar-bookmark-tab" class="toolbar__icon"><use xlink:href="#iconBookmark"></use></svg>
        <svg data-type="sidebar-tag-tab" class="toolbar__icon"><use xlink:href="#iconTags"></use></svg>
        <svg data-type="sidebar-backlink-tab" class="toolbar__icon"><use xlink:href="#iconLink"></use></svg>
    </div>
    <div class="fn__flex-1 b3-list--mobile">
        <div class="fn__flex-column" data-type="sidebar-file"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-outline"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-bookmark"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-tag"></div>
        <div class="fn__flex-column fn__none" data-type="sidebar-backlink"></div>
    </div>
</div>
<div id="menu" style="overflow: auto" class="side-panel b3-list b3-list--background fn__flex-column"></div>
<div id="model" class="side-panel side-panel--all fn__flex-column">
    <div class="toolbar toolbar--border">
        <svg class="toolbar__icon toolbar__icon--small"><use xlink:href="#iconMenu"></use></svg>
        <span class="toolbar__text"></span>
        <svg id="modelClose" class="toolbar__icon toolbar__icon--small">
            <use xlink:href="#iconClose"></use>
        </svg>
    </div>
    <div id="modelMain" class="fn__flex-1"></div>
</div>
<div id="commonMenu" class="b3-menu fn__none"></div>
<div id="message" class="b3-snackbars"></div>
<div id="status" class="status status--hide"></div>
<div id="keyboardToolbar" class="fn__none">
    <span class="fn__flex-1"></span>
    <button data-type="indent"><svg><use xlink:href="#iconIndent"></use></svg></button>
    <button data-type="outdent"><svg><use xlink:href="#iconOutdent"></use></svg></button>

    <button data-type="up"><svg><use xlink:href="#iconUp"></use></svg></button>
    <button data-type="down"><svg><use xlink:href="#iconDown"></use></svg></button>

    <button data-type="before"><svg><use xlink:href="#iconBefore"></use></svg></button>
    <button data-type="after"><svg><use xlink:href="#iconAfter"></use></svg></button>

    <button data-type="clear"><svg><use xlink:href="#iconClear"></use></svg></button>

    <button data-type="undo"><svg><use xlink:href="#iconUndo"></use></svg></button>
    <button data-type="redo"><svg><use xlink:href="#iconRedo"></use></svg></button>
    <span class="fn__flex-1"></span>
</div>
</body>
</html>
