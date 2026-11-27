// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIModelPolicyRoutes(t *testing.T) {
	t.Cleanup(func() { util.SetAIModelPolicy("full") })
	util.SetAIModelPolicy("deepseek")
	for path, blocked := range map[string]bool{
		"/api/setting/setAI": false, "/api/ai/agent/chat": false, "/api/ai/editor/chat": false,
		"/api/ai/agent/title": false, "/api/ai/testModel": true, "/api/ai/listModels": true,
		"/api/ai/testDecisionModel": true, "/api/ai/chatgpt/start": true, "/api/ai/ocr": true,
		"/api/ai/mcp/oauth/callback/:flowID": true, "/api/system/getConf": false,
	} {
		if aiRouteUnavailable(path) != blocked {
			t.Errorf("unexpected restricted route decision for %s", path)
		}
	}
	util.SetAIModelPolicy("unavailable")
	if !aiRouteUnavailable("/api/ai/agent/chat") {
		t.Fatal("an unknown storefront may not dispatch AI requests")
	}
	util.SetAIModelPolicy("full")
	if aiRouteUnavailable("/api/ai/testModel") {
		t.Fatal("unrestricted distribution must allow the original routes")
	}
}
