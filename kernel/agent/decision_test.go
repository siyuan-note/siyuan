// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestDecisionCapabilityAvailabilityAndApproval(t *testing.T) {
	original := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI.Store(conf.NewAI())
	t.Cleanup(func() { kernelModel.Conf = original })
	check := func(want bool) *capabilitySet {
		t.Helper()
		set, err := buildCapabilitySet(nil, capabilityAccessContext{})
		if err != nil {
			t.Fatal(err)
		}
		if (set.registration("decision") != nil) != want {
			t.Fatalf("decision exposure, want %v", want)
		}
		if strings.Contains(buildSystemPrompt("en", set), "## Decision model") != want {
			t.Fatal("decision prompt did not follow capability exposure")
		}
		return set
	}
	check(false)
	kernelModel.Conf.AI.Load().Decision.Enabled = true
	check(false)
	kernelModel.Conf.AI.Load().Decision.Profiles["typesafe"].APIKey = "key"
	set := check(true)
	registration := set.registration("decision")
	if required, _ := capabilityConfirmRequirement(registration, "evaluate", nil, false, nil); !tools.DecisionTool.AgentOnly || !required {
		t.Fatal("decision bypassed data egress/cost confirmation")
	}
	kernelModel.Conf.AI.Load().Decision.Enabled = false
	if capabilityStillExecutable(registration, nil) {
		t.Fatal("disabled decision remained executable")
	}
	check(false)
	kernelModel.Conf.AI.Load().Decision.Enabled = true
	kernelModel.Conf.AI.Load().Agent.CapabilityPolicy.Overrides["native/backend/decision"] = "deny"
	check(false)
	if capabilityStillExecutable(registration, nil) {
		t.Fatal("denied decision remained executable")
	}
}

func TestDecisionNativeJSONPrecision(t *testing.T) {
	const evidence = `{"id":9007199254740993,"ratio":0.1234567890123456789,"nested":[{"enabled":true}]}`
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Input []struct {
				Content []struct {
					Type string          `json:"type"`
					Data json.RawMessage `json:"data"`
				} `json:"content"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		if len(payload.Input) != 1 || len(payload.Input[0].Content) != 1 || string(payload.Input[0].Content[0].Data) != evidence {
			t.Errorf("native JSON evidence changed: %+v", payload)
		}
		io.WriteString(w, `{"model":"gpt-6-luna","answers":[{"name":"q","type":"predicate","probability":0.8}],"usage":{"input_tokens":20,"output_tokens":0}}`)
	}))
	defer server.Close()
	original := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI.Store(conf.NewAI())
	t.Cleanup(func() { kernelModel.Conf = original })
	kernelModel.Conf.AI.Load().Decision = &conf.Decision{Enabled: true, Provider: "openai", Profiles: map[string]*conf.DecisionProfile{
		"openai": {Endpoint: server.URL, APIKey: "key", Name: "gpt-6-luna", Timeout: 1},
	}}
	set, err := buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	registration := set.registration("decision")
	if registration == nil {
		t.Fatal("native decision capability missing")
	}
	result := executeCapability(context.Background(), openai.ToolCall{ID: "precision", Function: openai.FunctionCall{
		Name: "decision", Arguments: `{"action":"evaluate","items":[{"id":"one","data":` + evidence + `}],"questions":[{"id":"q","type":"noul","instructions":"Relevant?"}]}`,
	}}, "decision-precision-test", registration)
	if result.IsError || calls != 1 {
		t.Fatalf("native JSON execution failed: %+v; calls=%d", result, calls)
	}
}
