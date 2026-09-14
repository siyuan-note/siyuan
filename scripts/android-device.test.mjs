import assert from "node:assert/strict";
import {test} from "node:test";
import {selectDuplicateDevice} from "./android-device.mjs";

const devices = ["adb-phone (2)._adb-tls-connect._tcp", "adb-phone._adb-tls-connect._tcp"];

test("duplicate wireless connections use the physical serial without splitting names", () => {
  const calls = [];
  const selected = selectDuplicateDevice("adb", devices, (command, args, options) => {
    calls.push(args);
    assert.equal(command, "adb");
    assert.equal(options.timeout, 3000);
    return {status: 0, stdout: "physical-serial\r\n"};
  });
  assert.equal(selected, devices[0]);
  assert.deepEqual(calls, devices.map((serial) => ["-s", serial, "shell", "getprop", "ro.serialno"]));
});

test("similar connection names do not merge different phones", () => {
  assert.equal(selectDuplicateDevice("adb", devices, (command, args) => ({
    status: 0,
    stdout: args[1] === devices[0] ? "phone-a" : "phone-b",
  })), null);
});

test("USB and wireless connections to one phone can be merged", () => {
  assert.equal(selectDuplicateDevice("adb", ["physical-serial", devices[0]], () => ({
    status: 0, stdout: "physical-serial",
  })), "physical-serial");
});

test("unidentified or unresponsive connections require explicit selection", () => {
  for (const result of [
    {status: 0, stdout: ""},
    {status: 0, stdout: "unknown"},
    {status: 0, stdout: "00000000"},
    {status: 1, stdout: ""},
    {status: null, error: new Error("timeout")},
  ]) {
    let calls = 0;
    assert.equal(selectDuplicateDevice("adb", devices, () => ++calls === 1
      ? {status: 0, stdout: "phone-a"} : result), null);
  }
});
