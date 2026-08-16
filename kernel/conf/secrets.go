// SiYuan - From thought to insight, with agents
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
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// Secret 是一条命名密钥，Name 为引用名（如 weread_key），Value 在运行时为明文，落盘时由 Secrets.Encrypt 加密。
// AllowedHosts 是该密钥允许插值到的 HTTP 出站目标主机列表（不含协议与端口，大小写不敏感，精确匹配）；
// 为空时该密钥不会插值到任何 HTTP 出站请求，防止密钥被发送到未授权的目标主机。
// stdio 型 MCP 服务器的环境变量插值不受该列表约束：目标是无网络主机的本地子进程，管理员在 Env 中
// 引用 {{secrets.NAME}} 本身就是对该服务器的显式授权。
type Secret struct {
	Name         string   `json:"name"`
	Value        string   `json:"value"`
	AllowedHosts []string `json:"allowedHosts"`
}

// Secrets 是全局密钥库，脱离 AI 配置独立存在，供智能体 http_request 工具、MCP 服务请求头和 stdio 环境变量等以
// {{secrets.名字}} 形式引用。落盘时 Value 经 AES 加密，运行时为明文。AllowedHosts 仅约束 HTTP 出站插值，
// stdio 环境变量面向管理员显式配置的本地子进程，不受主机列表约束。
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

// Resolve 把字符串里的 {{secrets.NAME}} 占位符替换为对应明文密钥，并处理无前缀的
// $NAME、${NAME}（仅在密钥库存在对应名字时才替换）。找不到对应名字时保留原文，
// 便于调用方/LLM 发现尚未配置的密钥。
// 必须在内存明文状态下（InitConf 解密后或 AppConf.Save 的 defer 还原后）调用。
func (s *Secrets) Resolve(in string) string {
	if s == nil {
		return in
	}
	in = secretPlaceholder.ReplaceAllStringFunc(in, func(match string) string {
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
	return resolveDollar(in, s.lookup)
}

// lookup 按名查找密钥值，返回值及是否存在。
func (s *Secrets) lookup(name string) (string, bool) {
	if s == nil {
		return "", false
	}
	for _, item := range s.Items {
		if item != nil && item.Name == name {
			return item.Value, true
		}
	}
	return "", false
}

// hostAllowed 判断 host 是否命中密钥的允许主机列表，空列表视为不允许任何主机。
// 仅做不区分大小写的精确匹配，子域名、后缀拼接与 IP 直写均不隐式放行。
func hostAllowed(item *Secret, host string) bool {
	if item == nil || host == "" {
		return false
	}
	for _, allowed := range item.AllowedHosts {
		if strings.EqualFold(strings.TrimSpace(allowed), host) {
			return true
		}
	}
	return false
}

// ResolveForHost 与 Resolve 类似，但只有当目标 host 命中该密钥的 AllowedHosts 时才替换，
// 未命中时保留原文，避免密钥被发送到未授权的目标主机；host 为空时不替换任何密钥。
// 必须在内存明文状态下（InitConf 解密后或 AppConf.Save 的 defer 还原后）调用。
func (s *Secrets) ResolveForHost(in, host string) string {
	if s == nil {
		return in
	}
	in = secretPlaceholder.ReplaceAllStringFunc(in, func(match string) string {
		sub := secretPlaceholder.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		for _, item := range s.Items {
			if item != nil && item.Name == sub[1] && hostAllowed(item, host) {
				return item.Value
			}
		}
		return match
	})
	return resolveDollar(in, s.lookupForHost(host))
}

// lookupForHost 按名查找密钥值，仅当 host 命中密钥的允许主机列表时返回。
func (s *Secrets) lookupForHost(host string) func(name string) (string, bool) {
	return func(name string) (string, bool) {
		if s == nil {
			return "", false
		}
		for _, item := range s.Items {
			if item != nil && item.Name == name && hostAllowed(item, host) {
				return item.Value, true
			}
		}
		return "", false
	}
}

// dollarPlaceholder 匹配无前缀的 shell 风格变量引用：${NAME} 与 $NAME。
// NAME 限定为字母/数字/下划线，避免误匹配 $100、正则等。
var dollarPlaceholder = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)`)

// resolveDollar 替换字符串里的 $NAME、${NAME}（shell 风格）。按顺序尝试 lookups，
// 首个命中的值生效；都不命中则保留原文。仅在能查到名字时才替换，因此 $100、正则等
// 不相关内容不受影响。
func resolveDollar(in string, lookups ...func(string) (string, bool)) string {
	return dollarPlaceholder.ReplaceAllStringFunc(in, func(match string) string {
		sub := dollarPlaceholder.FindStringSubmatch(match)
		// sub[1] 为 ${NAME} 捕获组，sub[2] 为 $NAME 捕获组。
		name := sub[1]
		if name == "" {
			name = sub[2]
		}
		if name == "" {
			return match
		}
		for _, lk := range lookups {
			if v, ok := lk(name); ok {
				return v
			}
		}
		return match
	})
}

// ResolveSecretsVars 替换 {{secrets.NAME}}、{{vars.NAME}} 与无前缀的 $NAME、${NAME}。
// Secrets.Resolve / Variables.Resolve 已各自处理显式语法与无前缀引用（仅查各自库），
// 串行调用后即覆盖「$NAME 先密钥后变量」的优先级。仅在库中存在对应名字时才替换，
// 找不到保留原文——因此 $100、正则等不相关内容不受影响。
// 供智能体 http_request 工具、MCP 服务请求头和 stdio 环境变量等统一消费密钥与变量。
// 不受 AllowedHosts 约束，仅用于目标无需主机限定的场景（如 stdio 环境变量）；HTTP 出站请改用 ResolveSecretsVarsForHost。
func ResolveSecretsVars(secrets *Secrets, vars *Variables, in string) string {
	in = secrets.Resolve(in)
	return vars.Resolve(in)
}

// ResolveSecretsVarsForHost 在 ResolveSecretsVars 的基础上按目标主机限制密钥插值：
// {{secrets.NAME}} 与 $NAME/${NAME} 只有在该密钥的 AllowedHosts 包含 host 时才替换，
// 未命中时保留原文；变量不受主机限制。供 http_request 工具、MCP 客户端等按出站目标主机消费密钥与变量。
func ResolveSecretsVarsForHost(secrets *Secrets, vars *Variables, host, in string) string {
	in = secrets.ResolveForHost(in, host)
	return vars.Resolve(in)
}
