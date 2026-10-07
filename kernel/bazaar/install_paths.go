// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package bazaar

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func installPrivateRoot() string {
	confDir := util.ConfDir
	if confDir == "" && filepath.IsAbs(util.DataDir) {
		confDir = filepath.Join(filepath.Dir(util.DataDir), "conf")
	}
	if confDir == "" {
		return ""
	}
	return filepath.Join(confDir, "plugin-development")
}

// makePrivateInstallDir 拒绝链接目录及非绝对根；已有目录同样逐层检查。
func makePrivateInstallDir(root string) error {
	if !filepath.IsAbs(root) {
		return errors.New("private package operation root is unavailable")
	}
	if err := rejectInstallPathLinks(root); err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	return rejectInstallPathLinks(root)
}

func rejectInstallPathLinks(target string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	for current := target; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.IsDir()) {
			return errors.New("package operation path must contain only regular directories")
		}
		if filepath.Dir(current) == current {
			return nil
		}
	}
}
