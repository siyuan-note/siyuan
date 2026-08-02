#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const quickCreatePath = path.join(root, "app/src/protyle/render/av/calendar/quick-create.ts");
const fail = (message) => {
  console.error(`calendar quick-create duplicate-submit smoke failed: ${message}`);
  process.exit(1);
};

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.style = {values: new Map(), setProperty: (key, value) => this.style.values.set(key, value)};
    this.className = "";
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        this.className = [...classes].join(" ");
      },
    };
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.attributes = new Map();
    this.focused = false;
    this.selected = false;
    this.removed = false;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  remove() {
    this.removed = true;
  }
  focus() {
    this.focused = true;
  }
  select() {
    this.selected = true;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
  click() {
    this.dispatch("click", {preventDefault() {}});
  }
  querySelector(selector) {
    const match = selector.match(/\[data-type="?([^"\]]+)"?\]/) || selector.match(/\[data-type='([^']+)'\]/);
    if (!match) {
      return null;
    }
    return this.byType?.get(match[1]) ?? null;
  }
  set innerHTML(_html) {
    const make = (type, tag = "div") => {
      const element = new FakeElement(tag);
      element.setAttribute("data-type", type);
      return element;
    };
    this.byType = new Map([
      ["calendar-quick-create-summary", make("calendar-quick-create-summary")],
      ["calendar-quick-create-title", make("calendar-quick-create-title", "input")],
      ["calendar-quick-create-all-day", make("calendar-quick-create-all-day", "input")],
      ["calendar-quick-create-error", make("calendar-quick-create-error")],
      ["calendar-quick-create-cancel", make("calendar-quick-create-cancel", "button")],
      ["calendar-quick-create-more", make("calendar-quick-create-more", "button")],
      ["calendar-quick-create-save", make("calendar-quick-create-save", "button")],
    ]);
    this.children = [...this.byType.values()];
  }
}

const source = fs.readFileSync(quickCreatePath, "utf8");
let executable = source
  .replace(/import[^\n]+\n/g, "")
  .replace(/export interface IQuickCreateOptions \{[\s\S]*?\n\}/, "")
  .replace(/export const openQuickCreate/, "const openQuickCreate")
  .replace(/: ICalendarEventDraft/g, "")
  .replace(/: IQuickCreateOptions/g, "")
  .replace(/ as HTMLInputElement/g, "")
  .replace(/ as HTMLElement/g, "")
  .replace(/ as HTMLButtonElement/g, "")
  .replace(/event: KeyboardEvent/g, "event")
  .replace(/\((\w+): boolean\)/g, "($1)")
  .replace(/\n};\s*$/s, "\n};\nthis.openQuickCreate = openQuickCreate;");

const target = new FakeElement("section");
let submitCount = 0;
let cancelCount = 0;
let moreCount = 0;
let resolveSave;
const savePromise = new Promise((resolve) => { resolveSave = resolve; });
const context = {
  document: {querySelectorAll: () => [], createElement: () => new FakeElement()},
  window: {siyuan: {languages: {title: "Title", save: "Save", cancel: "Cancel", more: "More", calendarAllDay: "All day", invalid: "Invalid", _kernel: {29: "Save failed"}}}, requestAnimationFrame: () => 0},
  showMessage() {},
  escapeAttr: (value) => String(value),
  escapeHtml: (value) => String(value),
  console,
};
vm.createContext(context);
vm.runInContext(executable, context, {filename: quickCreatePath});
const panel = context.openQuickCreate({
  target,
  draft: {title: "Draft", date: "2026-06-01", startTime: "09:00", endTime: "09:30", isAllDay: false},
  onSave: async () => {
    submitCount += 1;
    await savePromise;
  },
  onMoreOptions() { moreCount += 1; },
  onCancel() { cancelCount += 1; },
});
const title = panel.querySelector('[data-type="calendar-quick-create-title"]');
const cancelButton = panel.querySelector('[data-type="calendar-quick-create-cancel"]');
const moreButton = panel.querySelector('[data-type="calendar-quick-create-more"]');
const saveButton = panel.querySelector('[data-type="calendar-quick-create-save"]');
title.value = "One submit only";
const enterEvent = {key: "Enter", preventDefault() { this.prevented = true; }};
title.dispatch("keydown", enterEvent);
title.dispatch("keydown", {key: "Enter", preventDefault() {}});
saveButton.click();
cancelButton.click();
title.dispatch("keydown", {key: "Escape", preventDefault() {}});
moreButton.click();
await Promise.resolve();

if (submitCount !== 1) {
  fail(`expected exactly one unresolved submit, got ${submitCount}`);
}
if (cancelCount !== 0) {
  fail(`pending Escape/Cancel must not cancel/remove panel, got ${cancelCount} cancels`);
}
if (moreCount !== 0) {
  fail(`pending More must not open full dialog/remove panel, got ${moreCount} more-options calls`);
}
if (panel.removed) {
  fail("quick-create panel must stay mounted while save is pending");
}
for (const [name, button] of [["save", saveButton], ["cancel", cancelButton], ["more", moreButton]]) {
  if (!button.disabled) {
    fail(`${name} button must stay disabled while save is pending`);
  }
}
if (panel.getAttribute("aria-busy") !== "true") {
  fail("quick-create panel must expose aria-busy=true while saving");
}
if (saveButton.getAttribute("aria-busy") !== "true") {
  fail("quick-create save button must expose aria-busy=true while saving");
}
if (!/is--/.test(panel.className)) {
  fail("quick-create panel must expose pending class while saving");
}
resolveSave();
await new Promise((resolve) => setImmediate(resolve));
if (!panel.removed) {
  fail("quick-create panel should be removed after successful save resolves");
}
console.log("calendar quick-create duplicate-submit smoke passed: unresolved Enter/click attempts submit once");
