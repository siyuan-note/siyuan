// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"sort"
	"testing"
)

// 一个工具的对外契约由 schema 声明，实际能力由 handler 实现，效果声明由 ActionEffects 提供，三处独立维护。
// 这里只断言那些在所有工具上都成立的关系；不适用的维度在各自注释里说明为什么不断言，
// 避免为了统一而改造本来就是刻意不同的实现。
func TestToolSchemaDeclaresItsActions(t *testing.T) {
	names := sortedToolNames()
	for _, name := range names {
		tool := Registry[name]
		action, hasAction := tool.InputSchema.Properties["action"]
		if hasAction {
			if len(action.Enum) == 0 {
				t.Errorf("%s: declares an action property without an enum, so callers cannot know the accepted values", name)
			}
			// 不断言 action 必须出现在 required：http_request 的 action 是可省略的 HTTP 方法，
			// 文档与实现都按「默认 get」处理，强制必填反而会改变既有契约。
		}
		// 不断言 enum 必须与 handler 的 switch 分支一一对应：file、skill、snippet、sql 的 handler
		// 把分派委托给另一个函数，bazaar 用 isPluginProjectAction 走 if 分支，http_request 把 action
		// 直接作为 HTTP 方法传下去，mcp 用匿名 handler 注册。这些写法都有明确理由，静态匹配只会误报。
	}
}

// ActionEffects 按 action 声明本地读写、数据外发与外部计费，智能体据此决定确认与快照。
// 空串键是「未单独列出的动作」的兜底项（见 Tool.EffectsFor）；除此之外的键不在 schema 的 enum 里
// 就永远不会被读到，是纯粹的死声明。
func TestActionEffectsOnlyDeclareReachableActions(t *testing.T) {
	for _, name := range sortedToolNames() {
		tool := Registry[name]
		if len(tool.ActionEffects) == 0 {
			continue
		}
		declared := map[string]bool{"": true}
		for _, value := range tool.InputSchema.Properties["action"].Enum {
			declared[value] = true
		}
		keys := make([]string, 0, len(tool.ActionEffects))
		for key := range tool.ActionEffects {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if !declared[key] {
				t.Errorf("%s: declares effects for action %q, which the schema does not accept", name, key)
			}
		}
	}
}

func sortedToolNames() []string {
	names := make([]string, 0, len(Registry))
	for name := range Registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
