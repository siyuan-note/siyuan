// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

// secretFilePermissions 是含凭据文件的权限，仅当前用户可读写。
const secretFilePermissions os.FileMode = 0600

// RestrictConfFilePermissions 收紧工作空间配置目录中凭据文件的权限。conf.json 由 filelock 以 0644 写入，
// 因此在每次保存后与启动时调用；同目录的 TLS 私钥在启动时一并迁移旧版本遗留的宽松权限。
func RestrictConfFilePermissions() {
	if ReadOnly || "" == ConfDir {
		return
	}
	RestrictSecretFile(filepath.Join(ConfDir, "conf.json"))
	RestrictSecretFile(filepath.Join(ConfDir, TLSKeyFilename))
}

// RestrictSecretFile 在文件存在且允许组或其他用户访问时收紧为仅当前用户可读写；失败时保留原权限并记录警告。
// Windows 由用户目录的访问控制保护，不处理权限位。
func RestrictSecretFile(path string) {
	if gulu.OS.IsWindows() {
		return
	}
	info, err := os.Stat(path)
	if err != nil || 0 == info.Mode().Perm()&0077 {
		return
	}
	if err = os.Chmod(path, secretFilePermissions); err != nil {
		logging.LogWarnf("restrict file [%s] permission failed: %s", path, err)
	}
}
