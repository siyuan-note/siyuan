import {spawnSync} from "node:child_process";

export function selectDuplicateDevice(adb, devices, execute = spawnSync) {
  let identity = null;
  for (const serial of devices) {
    // 连接名称可能随无线服务重新发布而变化，使用手机报告的序列号核对身份。
    const result = execute(adb, ["-s", serial, "shell", "getprop", "ro.serialno"], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    const value = result.stdout?.trim();
    // 无法确认身份时保留手动选择，避免把未知连接合并到另一台手机。
    if (result.error || result.status !== 0 || !value || /^(unknown|null|0+)$/i.test(value)) {
      return null;
    }
    if (identity !== null && identity !== value) {
      return null;
    }
    identity = value;
  }
  return devices[0] || null;
}
