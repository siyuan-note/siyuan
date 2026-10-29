// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import "regexp"

// Variable 是一条命名变量，Name 为引用名，Value 为明文存储（不加密），用于非敏感配置数据。
type Variable struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Variables 是全局变量库，与 Secrets 对应：Secrets 加密存储敏感数据，Variables 明文存储非敏感数据。
// 两者以 {{vars.NAME}} 形式被智能体工具、MCP 服务请求头和 stdio 环境变量等引用。
type Variables struct {
	Items []*Variable `json:"items"`
}

func NewVariables() *Variables {
	return &Variables{Items: []*Variable{}}
}

// varPlaceholder 匹配 {{vars.NAME}} 形式的占位符，NAME 部分不含 } 字符。
var varPlaceholder = regexp.MustCompile(`\{\{vars\.([^}]+)\}\}`)

// Resolve 把字符串里的 {{vars.NAME}} 占位符替换为对应变量值，并处理无前缀的
// $NAME、${NAME}（仅在变量库存在对应名字时才替换）。找不到对应名字时保留原文，
// 与 Secrets.Resolve 行为一致。
func (v *Variables) Resolve(in string) string {
	if v == nil {
		return in
	}
	in = varPlaceholder.ReplaceAllStringFunc(in, func(match string) string {
		sub := varPlaceholder.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		name := sub[1]
		for _, item := range v.Items {
			if item != nil && item.Name == name {
				return item.Value
			}
		}
		return match
	})
	return resolveDollar(in, v.lookup)
}

// lookup 按名查找变量值，返回值及是否存在。
func (v *Variables) lookup(name string) (string, bool) {
	if v == nil {
		return "", false
	}
	for _, item := range v.Items {
		if item != nil && item.Name == name {
			return item.Value, true
		}
	}
	return "", false
}
