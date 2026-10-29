// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestDecisionJSONLimits(t *testing.T) {
	for _, data := range []string{`{}`, `[]`, `[{"id":9007199254740993,"nested":[true,null,2.5]}]`, `{"text":"role and image_url remain evidence"}`} {
		if err := ValidateDecisionJSON(json.RawMessage(data)); err != nil {
			t.Fatalf("valid JSON rejected: %s: %v", data, err)
		}
	}
	for name, data := range map[string]string{
		"null": "null", "number": "1", "primitive array": "[1]", "mixed array": "[{},true]", "invalid": "{", "trailing": "{} {}",
		"oversized": `{"text":"` + strings.Repeat("x", DecisionJSONMaxBytes) + `"}`,
		"deep":      strings.Repeat(`{"v":`, 33) + `0` + strings.Repeat(`}`, 33),
		"values":    `{"v":[` + strings.Repeat(`0,`, 9999) + `0]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateDecisionJSON(json.RawMessage(data)); err == nil {
				t.Fatal("invalid JSON evidence accepted")
			}
		})
	}
	boundary := `{"v":"` + strings.Repeat("x", DecisionJSONMaxBytes-len(`{"v":""}`)) + `"}`
	if err := ValidateDecisionJSON(json.RawMessage(" \n" + boundary + " \n")); err != nil {
		t.Fatal("compact 256 KiB boundary rejected:", err)
	}
	if err := ValidateDecisionJSON(json.RawMessage(strings.Repeat(`{"v":`, 32) + `0` + strings.Repeat(`}`, 32))); err != nil {
		t.Fatal("32 container levels rejected:", err)
	}
}

func TestDecisionOpenAIJSONAndImages(t *testing.T) {
	state := DecisionState{Context: "shared", Text: "![not automatically attached](assets/implicit.png)",
		Data:   json.RawMessage(`{"id":9007199254740993,"image_url":"https://example.com/not-attached.png"}`),
		Images: []DecisionImage{{URL: "https://example.com/shared.png", Detail: "high"}}}
	questions := decisionTestQuestions()
	q := questions["condition"]
	q.Images = []DecisionImage{{URL: "https://example.com/candidate.png", Detail: "original"}}
	questions["condition"] = q
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Input []struct {
				Role    string               `json:"role"`
				Content []openAIDecisionPart `json:"content"`
			} `json:"input"`
			Questions []openAIDecisionQuestion `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		if len(payload.Input) != 1 || payload.Input[0].Role != "user" || len(payload.Input[0].Content) != 3 {
			t.Errorf("wrong content envelope: %+v", payload.Input)
			return
		}
		parts := payload.Input[0].Content
		if !strings.Contains(parts[0].Text, "implicit.png") || parts[1].Type != "input_image" || parts[1].ImageURL != state.Images[0].URL || parts[1].Detail != "high" || parts[2].Type != "input_json" || string(parts[2].Data) != string(state.Data) {
			t.Errorf("evidence changed: %+v", parts)
		}
		var instructionParts []openAIDecisionPart
		if err := json.Unmarshal(payload.Questions[1].Instructions, &instructionParts); err != nil || len(instructionParts) != 2 || instructionParts[0].Text != q.Instructions || instructionParts[1].ImageURL != q.Images[0].URL || instructionParts[1].Detail != "original" {
			t.Errorf("question image mapping: %+v %v", instructionParts, err)
		}
		var textInstructions string
		if err := json.Unmarshal(payload.Questions[0].Instructions, &textInstructions); err != nil || textInstructions != questions["category"].Instructions {
			t.Error("text instructions no longer use a string")
		}
		io.WriteString(w, strings.Replace(openAIDecisionFixture, `"cached_tokens":0`, `"cached_tokens":5,"cache_write_tokens":4`, 1))
	}))
	defer server.Close()
	result, err := EvaluateDecision(context.Background(), DecisionOptions{Provider: "openai", Endpoint: server.URL, APIKey: "key", Model: "gpt-6-luna"}, state, questions)
	if err != nil {
		t.Fatal(err)
	}
	if result.Usage.InputTokens != 12 || !reflect.DeepEqual(result.Usage.InputTokensDetails, &DecisionInputTokensDetails{CachedTokens: 5, CacheWriteTokens: 4}) {
		t.Fatalf("cache usage was lost or counted twice: %+v", result.Usage)
	}
}

func TestDecisionProviderInputLimitsBeforeRequest(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request struct {
			Questions []openAIDecisionQuestion `json:"questions"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		answers := make([]map[string]any, len(request.Questions))
		for i, question := range request.Questions {
			answers[i] = map[string]any{"name": question.Name, "type": "predicate", "probability": .5}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "gpt-6-luna", "answers": answers, "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}})
	}))
	defer server.Close()
	questions := map[string]DecisionQuestion{}
	for i := 0; i < 400; i++ {
		questions[fmt.Sprint(i)] = DecisionQuestion{Type: "noul", Instructions: "Relevant?"}
	}
	options := DecisionOptions{Provider: "openai", Endpoint: server.URL, APIKey: "key", Model: "gpt-6-luna"}
	if result, err := EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, questions); err != nil || len(result.Answers) != 400 {
		t.Fatalf("400 questions rejected: %v", err)
	}
	questions["extra"] = DecisionQuestion{Type: "noul", Instructions: "Relevant?"}
	if _, err := EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, questions); err == nil || calls != 1 {
		t.Fatal("401 questions sent to service")
	}
	options.Provider = "typesafe"
	delete(questions, "extra")
	if _, err := EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, questions); err == nil || calls != 1 {
		t.Fatal("TypeSafe question limit changed")
	}
	for _, state := range []DecisionState{{Data: json.RawMessage(`{}`)}, {Images: []DecisionImage{{URL: "https://example.com/a.png"}}}} {
		if _, err := EvaluateDecision(context.Background(), options, state, decisionTestQuestions()); err == nil || calls != 1 {
			t.Fatal("unsupported TypeSafe input sent or silently ignored")
		}
	}
	options.Provider = "openai"
	for _, state := range []DecisionState{{Data: json.RawMessage(`null`)}, {Images: []DecisionImage{{URL: "file:///private.png"}}}, {Images: make([]DecisionImage, 129)}} {
		if _, err := EvaluateDecision(context.Background(), options, state, decisionTestQuestions()); err == nil || calls != 1 {
			t.Fatal("invalid multimodal input sent to service")
		}
	}
}

func TestDecisionImageValidation(t *testing.T) {
	for _, image := range []DecisionImage{{URL: "https://example.com/a.png?key=public", Detail: "original"}, {URL: "data:image/png;base64,aGVsbG8="}} {
		if err := ValidateDecisionImage(image); err != nil {
			t.Fatal(err)
		}
	}
	for _, image := range []DecisionImage{{URL: "file:///a.png"}, {URL: "http://user:secret@example.com/a.png"}, {URL: "http:///a.png"}, {URL: "https://example.com/a.png", Detail: "invalid"}, {URL: "data:image/svg+xml;base64,AAAA"}, {URL: "data:image/png;base64,not-base64"}, {URL: "data:image/png;base64,"}} {
		if err := ValidateDecisionImage(image); err == nil {
			t.Fatalf("invalid image accepted: %+v", image)
		}
	}
}

func TestDecisionOpenAIMultimodalInputOmitsEmptyState(t *testing.T) {
	image := DecisionImage{URL: "https://example.com/explicit.png"}
	for _, tc := range []struct {
		name  string
		state DecisionState
		types []string
	}{
		{"image only", DecisionState{Images: []DecisionImage{image}}, []string{"input_image"}},
		{"JSON only", DecisionState{Data: json.RawMessage(`{}`)}, []string{"input_json"}},
		{"JSON and image", DecisionState{Data: json.RawMessage(`{"id":9007199254740993}`), Images: []DecisionImage{image}}, []string{"input_image", "input_json"}},
		{"explicit text", DecisionState{Text: "{}", Images: []DecisionImage{image}}, []string{"input_text", "input_image"}},
		{"shared context", DecisionState{Context: "Reference image", Images: []DecisionImage{image}}, []string{"input_text", "input_image"}},
		{"blocks", DecisionState{Blocks: []DecisionBlock{{ID: "block", Markdown: "Evidence"}}, Images: []DecisionImage{image}}, []string{"input_text", "input_image"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input, err := openAIDecisionInput(tc.state)
			if err != nil {
				t.Fatal(err)
			}
			var messages []struct {
				Content []openAIDecisionPart `json:"content"`
			}
			if err := json.Unmarshal(input, &messages); err != nil || len(messages) != 1 {
				t.Fatalf("invalid input envelope: %s: %v", input, err)
			}
			var types []string
			for _, part := range messages[0].Content {
				types = append(types, part.Type)
				if part.Type == "input_text" && part.Text == "{}" {
					t.Fatal("synthetic empty-state text was sent as evidence")
				}
				if part.Type == "input_json" && string(part.Data) != string(tc.state.Data) {
					t.Fatal("explicit JSON evidence changed")
				}
			}
			if !reflect.DeepEqual(types, tc.types) {
				t.Fatalf("content types: got %v want %v", types, tc.types)
			}
		})
	}
}
