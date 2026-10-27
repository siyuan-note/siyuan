// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type ZipRequest struct {
	Path    string `json:"path" api:"trim"`
	ZipPath string `json:"zipPath" api:"trim"`
}

type UnzipRequest struct {
	ZipPath string `json:"zipPath" api:"trim"`
	Path    string `json:"path"`
}
