// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type PandocRequest struct {
	Dir  string   `json:"dir" api:"optional,nullable"`
	Args []string `json:"args"`
}

type PandocData struct {
	Path string `json:"path"`
}
