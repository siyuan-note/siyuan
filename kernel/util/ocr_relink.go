// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"errors"
)

// CopyAssetTextForRelink 复制 OCR 元数据，保留源资源的识别结果，并拒绝覆盖不同的目标结果。
func CopyAssetTextForRelink(oldPath, newPath, historyDir string, dryRun bool) (exists bool, err error) {
	plan, err := PrepareAssetTextRelinks([]AssetTextRelinkMapping{{OldPath: oldPath, NewPath: newPath}})
	if err != nil {
		return false, err
	}
	result := plan.Results[0]
	if result.Reason != "" {
		return result.Exists, errors.New(result.Reason)
	}
	if !dryRun {
		_, err = plan.Save(historyDir, []int{0})
	}
	return result.Exists, err
}
