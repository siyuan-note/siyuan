// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "github.com/siyuan-note/logging"

// AttributeViewSaved 由 model 层注入，在属性视图落盘后刷新载体文档的引用索引。
var AttributeViewSaved func(avID, boxID string)

// NotifyAttributeViewSaved 安全地通知上层属性视图已经落盘。
func NotifyAttributeViewSaved(avID, boxID string) {
	if nil == AttributeViewSaved {
		return
	}
	defer func() {
		if recovered := recover(); nil != recovered {
			logging.LogErrorf("notify saved attribute view [%s] failed: %v", avID, recovered)
		}
	}()
	AttributeViewSaved(avID, boxID)
}
