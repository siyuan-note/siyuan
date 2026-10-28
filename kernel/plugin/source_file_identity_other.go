// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin

package plugin

import "os"

func readPluginSourceFileIdentity(_ os.FileInfo) (device, inode uint64, ctime int64) {
	return
}
