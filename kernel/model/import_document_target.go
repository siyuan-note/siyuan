// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "github.com/siyuan-note/siyuan/kernel/conf"

// remapImportedDocumentTarget 只改写身份，不把标题模板中的 ID 字面文字当作引用。
// 完整笔记本包共享的 ID 表包含其他笔记本文档；包外身份没有映射，原样保留。
func remapImportedDocumentTarget(target *conf.DocumentTarget, sourceBoxID, boxID string, ids map[string]string) *conf.DocumentTarget {
	if target == nil {
		return nil
	}
	ret := *target
	ret.Parents = append([]string{}, target.Parents...)
	if ret.Notebook == sourceBoxID {
		ret.Notebook = boxID
	} else if id := ids[ret.Notebook]; id != "" {
		ret.Notebook = id
	}
	if ret.Anchor.Kind == "document" {
		if ret.Anchor.ID == sourceBoxID {
			ret.Anchor.ID = boxID
		} else if id := ids[ret.Anchor.ID]; id != "" {
			ret.Anchor.ID = id
		}
	}
	return &ret
}
