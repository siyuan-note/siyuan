// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
