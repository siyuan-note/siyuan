#!/usr/bin/env node
/**
 * Calendar settings add-property regression smoke.
 *
 * The Attribute View settings panel (av-more -> "config" -> "Fields") is shared
 * by every view type and ends with an "add property" (newCol) button that opens
 * the add-column menu. Calendar views must not expose or invoke that
 * affordance from their settings, while every other view type and all existing
 * property selection/mapping (field rows, show/hide, edit) must keep working.
 *
 * Static source assertions, same style as the other calendar-*-smoke scripts.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`calendar settings add-property smoke failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const openMenuPanel = read("app/src/protyle/render/av/openMenuPanel.ts");
const col = read("app/src/protyle/render/av/col.ts");
const view = read("app/src/protyle/render/av/view.ts");
const avRender = read("app/src/protyle/render/av/render.ts");
const action = read("app/src/protyle/render/av/action.ts");
const blockAttr = read("app/src/protyle/render/av/blockAttr.ts");

// 1. The properties panel must know the active view type so it can drop the
//    add-property button for calendar only.
assert(openMenuPanel.includes("export const getPropertiesHTML = (fields: IAVColumn[], viewType?: string)"),
  "getPropertiesHTML must accept the active view type");
assert(openMenuPanel.includes('viewType === "calendar" ? "" : `<button class="b3-menu__separator"></button>'),
  "the add-property (newCol) button must be suppressed for calendar views");

// 2. Every caller must thread the view type; no bare call may remain.
const threadedCalls = openMenuPanel.split("getPropertiesHTML(fields, data.viewType)").length - 1;
assert(threadedCalls === 7, `all 7 openMenuPanel call sites must pass data.viewType (found ${threadedCalls})`);
assert(!openMenuPanel.includes("getPropertiesHTML(fields)"),
  "no openMenuPanel call site may render the properties panel without the view type");
assert(col.includes("getPropertiesHTML(options.fields, options.viewType)"),
  "removeCol must re-render the properties panel with the view type");
assert(!col.includes("getPropertiesHTML(options.fields)"),
  "removeCol may not re-render the properties panel without the view type");

// 3. The add-property action path must be unreachable from calendar settings.
assert(openMenuPanel.includes('type === "newCol" && data.viewType !== "calendar"'),
  "the newCol action handler must refuse calendar views");
assert(openMenuPanel.split("viewType: data.viewType,").length - 1 === 3,
  "all removeCol call sites must pass the active view type");

// 4. Existing property selection/mapping must be preserved: the settings
//    Fields entry, the field rows and the show/hide controls stay for every
//    view type, calendar included.
assert(view.includes('data-type="go-properties"'),
  "view settings must keep the Fields (properties) entry");
assert(openMenuPanel.includes('data-type="editCol"'),
  "field rows must stay editable in the properties panel");
assert(openMenuPanel.includes('data-type="showAllCol"') && openMenuPanel.includes('data-type="hideAllCol"'),
  "show-all / hide-all controls must stay in the properties panel");

// 5. Non-calendar property creation must be unchanged.
assert(openMenuPanel.includes('data-type="newCol"'),
  "the add-property button must still be rendered for non-calendar view types");
assert(col.includes("export const addCol"),
  "the add-column menu must stay available for non-calendar views");
assert(avRender.includes('data-type="av-header-add"'),
  "the table header add-column button must stay");
assert(action.includes('type === "av-header-add"'),
  "the table header add-column handler must stay");
assert(blockAttr.includes('data-type="addColumn"'),
  "the block attribute panel add-property button must stay");

console.log("calendar settings add-property smoke: ok");
