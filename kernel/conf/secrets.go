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

import (
	"encoding/hex"
	"regexp"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// Secret 是一条命名密钥，Name 为引用名（如 weread_key），Value 在运行时为明文，落盘时由 Secrets.Encrypt 加密。
type Secret struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Secrets 是全局密钥库，脱离 AI 配置独立存在，供智能体 http_request 工具、MCP 服务 headers 等以
// {{secret:名字}} 形式引用。落盘时 Value 经 AES 加密，运行时为明文。
type Secrets struct {
	Items []*Secret `json:"items"`
}

func NewSecrets() *Secrets {
	return &Secrets{Items: []*Secret{}}
}

// Encrypt 把内存明文加密为密文，供 AppConf.Save() 序列化前调用。
func (s *Secrets) Encrypt() {
	if s == nil {
		return
	}
	for _, item := range s.Items {
		if item == nil || item.Value == "" {
			continue
		}
		item.Value = util.AESEncrypt(item.Value)
	}
}

// Decrypt 把密文解密回明文。util.AESDecrypt 返回的是 hex 文本，必须再做一次 hex.DecodeString
// 才是真正的明文，照搬 conf.AI.DecryptAPIKeys 的双 hex 模式。
func (s *Secrets) Decrypt() {
	if s == nil {
		return
	}
	for _, item := range s.Items {
		if item == nil || item.Value == "" {
			continue
		}
		dec := util.AESDecrypt(item.Value)
		if dec == nil {
			continue
		}
		if plain, err := hex.DecodeString(string(dec)); err == nil {
			item.Value = string(plain)
		}
	}
}

// secretPlaceholder 匹配 {{secrets.NAME}} 形式的占位符，NAME 部分不含 } 字符。
var secretPlaceholder = regexp.MustCompile(`\{\{secrets\.([^}]+)\}\}`)

// Resolve 把字符串里的 {{secrets.NAME}} 占位符替换为对应明文密钥。
// 找不到对应名字时保留原占位符不替换，便于调用方/LLM 发现尚未配置的密钥。
// 必须在内存明文状态下（InitConf 解密后或 AppConf.Save 的 defer 还原后）调用。
func (s *Secrets) Resolve(in string) string {
	if s == nil {
		return in
	}
	return secretPlaceholder.ReplaceAllStringFunc(in, func(match string) string {
		sub := secretPlaceholder.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		name := sub[1]
		for _, item := range s.Items {
			if item != nil && item.Name == name {
				return item.Value
			}
		}
		return match
	})
}

// ResolveSecretsVars 同时替换 {{secrets.NAME}} 与 {{vars.NAME}} 两种占位符，
// 供智能体 http_request 工具、MCP 服务 headers 等统一消费密钥与变量。
// 任一参数为 nil 时跳过其对应占位符的替换。
func ResolveSecretsVars(secrets *Secrets, vars *Variables, in string) string {
	in = secrets.Resolve(in)
	in = vars.Resolve(in)
	return in
}
