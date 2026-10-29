// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path"
	"strings"
)

// SearchDocDisplayFields 把 SearchDocs 返回的单条结果拆成展示用的类型、ID 与名称。
// 路径为 "/" 时该条结果表示笔记本根，类型为 NOTEBOOK；其余为 DOCUMENT，名称取文档路径去掉 .sy 后缀。
func SearchDocDisplayFields(doc map[string]string) (typ, id, name string) {
	if "/" == doc["path"] {
		return "NOTEBOOK", doc["box"], doc["title"]
	}
	return "DOCUMENT", strings.TrimSuffix(path.Base(doc["path"]), ".sy"), doc["title"]
}
