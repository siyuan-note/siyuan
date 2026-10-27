// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type Bookmark struct {
	Name   string         `json:"name"`
	Blocks []*SearchBlock `json:"blocks"`
	Type   string         `json:"type"`
	Depth  int            `json:"depth"`
	Count  int            `json:"count"`
}
