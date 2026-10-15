// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestResolveAIProviderDraft(t *testing.T) {
	provider, err := resolveAIProvider(apicontract.AIProviderRequest{
		ProviderConfig: &apicontract.SettingProvider{
			BaseURL:        " http://127.0.0.1:8080/v1 ",
			APIKey:         " key ",
			Headers:        map[string]string{"X-Api-Key": "header-key"},
			RequestTimeout: 700,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.BaseURL != "http://127.0.0.1:8080/v1" {
		t.Fatalf("base URL = %q", provider.BaseURL)
	}
	if provider.APIKey != "key" {
		t.Fatalf("API key = %q", provider.APIKey)
	}
	if provider.Headers["X-Api-Key"] != "header-key" {
		t.Fatal("provider headers were not retained")
	}
	if provider.RequestTimeout != 600 {
		t.Fatalf("request timeout = %d, want 600", provider.RequestTimeout)
	}
	if provider.Protocol != "openai" || provider.ID == "" {
		t.Fatalf("draft provider was not normalized: %#v", provider)
	}
}

func TestResolveAIProviderDraftRequiresBaseURL(t *testing.T) {
	if _, err := resolveAIProvider(apicontract.AIProviderRequest{ProviderConfig: &apicontract.SettingProvider{}}); err == nil {
		t.Fatal("empty draft provider should be rejected")
	}
}

func TestAITestModelFailureMessageHintsCodingPlanEndpoint(t *testing.T) {
	previousConf, previousLangs := model.Conf, util.Langs
	t.Cleanup(func() { model.Conf, util.Langs = previousConf, previousLangs })
	model.Conf = &model.AppConf{}
	util.Langs = map[string]map[int]string{"en": {421: "set the API address to the coding endpoint"}}
	billing := &openai.APIError{Message: "余额不足或无可用资源包,请充值", HTTPStatusCode: http.StatusTooManyRequests}

	// 按量端点用编码套餐 Key 时补充地址提示，其余情况原样返回服务端错误
	message := aiTestModelFailureMessage("https://open.bigmodel.cn/api/paas/v4", billing)
	if !strings.Contains(message, billing.Error()) || !strings.Contains(message, "set the API address to the coding endpoint") {
		t.Fatalf("coding plan hint was not appended: %q", message)
	}
	if message = aiTestModelFailureMessage("https://open.bigmodel.cn/api/coding/paas/v4", billing); message != billing.Error() {
		t.Fatalf("coding endpoint should keep the server error: %q", message)
	}
	if message = aiTestModelFailureMessage("https://open.bigmodel.cn/api/paas/v4", errors.New("connection refused")); message != "connection refused" {
		t.Fatalf("unrelated error changed: %q", message)
	}
}
