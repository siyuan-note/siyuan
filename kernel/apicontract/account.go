// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type ActivationCodeRequest struct {
	Data string `json:"data" api:"trim"`
}
type CheckActivationCodeRequest struct {
	Data string `json:"data"`
}
type AccountLoginRequest struct {
	UserName     string  `json:"userName"`
	UserPassword string  `json:"userPassword"`
	Captcha      string  `json:"captcha"`
	CloudRegion  float64 `json:"cloudRegion"`
}
type AccountLoginData struct {
	UserName    *string `json:"userName"`
	Token       *string `json:"token"`
	NeedCaptcha *string `json:"needCaptcha"`
}
