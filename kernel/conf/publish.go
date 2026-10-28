// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Publish struct {
	Enable bool       `json:"enable"` // 是否启用发布服务
	Port   uint16     `json:"port"`   // 发布服务端口
	Auth   *BasicAuth `json:"auth"`   // Basic 认证
}

type BasicAuth struct {
	Enable   bool                `json:"enable"`   // 是否启用基础认证
	Accounts []*BasicAuthAccount `json:"accounts"` // 账户列表
}

type BasicAuthAccount struct {
	Username string `json:"username"` // 用户名
	Password string `json:"password"` // 密码
	Memo     string `json:"memo"`     // 备注
}

func NewPublish() *Publish {
	return &Publish{
		Enable: false,
		Port:   6808,
		Auth: &BasicAuth{
			Enable:   true,
			Accounts: []*BasicAuthAccount{},
		},
	}
}
