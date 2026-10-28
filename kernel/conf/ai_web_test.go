// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestAIWebConfiguration(t *testing.T) {
	ai := &AI{}
	ai.Normalize()
	if ai.Web.SearchProvider != "exa" || ai.Web.FetchProvider != "direct" || ai.Web.Timeout != 30 {
		t.Fatal("legacy defaults changed")
	}
	ai.Web = &AIWeb{SearchProvider: " deepseek ", FetchProvider: " direct ", APIKey: " test-key ", Timeout: 900}
	ai.Normalize()
	if ai.Web.SearchProvider != "deepseek" || ai.Web.FetchProvider != "direct" || ai.Web.Timeout != 600 || ai.Web.APIKey != "test-key" {
		t.Fatal("independent providers or limits lost")
	}
	ai.EncryptAPIKeys()
	if ai.Web.APIKey == "test-key" {
		t.Fatal("web credential saved in plaintext")
	}
	data, err := json.Marshal(ai)
	if err != nil {
		t.Fatal(err)
	}
	var restored AI
	if err = json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	restored.DecryptAPIKeys()
	restored.Normalize()
	if restored.Web.APIKey != "test-key" || restored.Web.SearchProvider != "deepseek" || restored.Web.FetchProvider != "direct" {
		t.Fatal("web credentials or provider selection lost after reload")
	}
}
