// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type TrimmedIDRequest struct {
	ID string `json:"id" api:"trim"`
}

type NetImageAssetsRequest struct {
	ID  string `json:"id" api:"trim"`
	URL string `json:"url" api:"optional,nullable"`
}
