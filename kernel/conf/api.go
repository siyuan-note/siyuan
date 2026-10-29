// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type API struct {
	Token string `json:"token"`
}

func NewAPI() *API {
	return &API{}
}
