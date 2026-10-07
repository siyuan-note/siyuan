package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

const openAIDecisionFixture = `{"model":"gpt-6-luna-resolved","answers":[{"type":"score","name":"rating","score":0.75,"probabilities":[{"value":0,"label":"0","probability":0.25},{"value":1,"label":"1","probability":0.75}],"confidence":0.5},{"type":"predicate","name":"condition","probability":0.2},{"type":"choice","name":"category","choice":"a","probabilities":[{"value":"a","probability":0.8},{"value":"b","probability":0.2}],"confidence":0.6}],"usage":{"input_tokens":12,"output_tokens":3,"total_tokens":15,"input_tokens_details":{"cached_tokens":0}}}`

func TestDecisionOpenAIProtocol(t *testing.T) {
	state := DecisionState{Context: "shared context", Text: "complete text", Blocks: []DecisionBlock{{ID: "block-id", Markdown: "full **Markdown** END"}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer openai-key" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("incorrect request headers")
		}
		var payload struct {
			Model     string                   `json:"model"`
			Input     string                   `json:"input"`
			Questions []openAIDecisionQuestion `json:"questions"`
			State     json.RawMessage          `json:"state"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		var decoded DecisionState
		if err := json.Unmarshal([]byte(payload.Input), &decoded); err != nil || !reflect.DeepEqual(decoded, state) {
			t.Errorf("lost input evidence: %+v", decoded)
		}
		if payload.Model != "gpt-6-luna" || len(payload.State) != 0 || len(payload.Questions) != 3 {
			t.Errorf("wrong protocol: %+v", payload)
		}
		if payload.Questions[0].Name != "category" || payload.Questions[0].Choices[0].Value != "a" || payload.Questions[1].Type != "predicate" || payload.Questions[2].Levels[1].Label != "1" || payload.Questions[2].Levels[1].Description != "High" {
			t.Errorf("incorrect stable question mapping: %+v", payload.Questions)
		}
		io.WriteString(w, openAIDecisionFixture)
	}))
	defer server.Close()
	result, err := EvaluateDecision(context.Background(), DecisionOptions{Provider: "openai", Endpoint: server.URL, APIKey: "openai-key", Model: "gpt-6-luna"}, state, decisionTestQuestions())
	if err != nil {
		t.Fatal(err)
	}
	if result.Model != "gpt-6-luna-resolved" || result.Usage.InputTokens != 12 || result.Usage.OutputTokens != 3 || *result.Answers["condition"].Noul != .2 || *result.Answers["rating"].Score != .75 || result.Answers["rating"].Legend["1"] != "High" || *result.Answers["category"].Choice != "a" {
		t.Fatalf("mapped values changed: %+v", result)
	}
}

func TestDecisionOpenAIRejectsInvalidAnswers(t *testing.T) {
	cases := map[string]string{
		"duplicate answer":         strings.Replace(openAIDecisionFixture, `"name":"condition"`, `"name":"category"`, 1),
		"unknown answer":           strings.Replace(openAIDecisionFixture, `"name":"condition"`, `"name":"other"`, 1),
		"null answer name":         strings.Replace(openAIDecisionFixture, `"name":"condition"`, `"name":null`, 1),
		"wrong answer type":        strings.Replace(openAIDecisionFixture, `"type":"predicate"`, `"type":"noul"`, 1),
		"missing probability":      strings.Replace(openAIDecisionFixture, `,"probability":0.2}`, `}`, 1),
		"null probability":         strings.Replace(openAIDecisionFixture, `"probability":0.2}`, `"probability":null}`, 1),
		"probability out of range": strings.Replace(openAIDecisionFixture, `"probability":0.2}`, `"probability":1.2}`, 1),
		"duplicate choice":         strings.Replace(openAIDecisionFixture, `"value":"b"`, `"value":"a"`, 1),
		"unknown choice":           strings.Replace(openAIDecisionFixture, `"choice":"a"`, `"choice":"c"`, 1),
		"boolean choice":           strings.Replace(openAIDecisionFixture, `"choice":"a"`, `"choice":true`, 1),
		"boolean option":           strings.Replace(openAIDecisionFixture, `"value":"a"`, `"value":true`, 1),
		"null option":              strings.Replace(openAIDecisionFixture, `"value":"a"`, `"value":null`, 1),
		"duplicate score index":    strings.Replace(openAIDecisionFixture, `"value":1,"label":"1"`, `"value":0,"label":"0"`, 1),
		"wrong label":              strings.Replace(openAIDecisionFixture, `"label":"1"`, `"label":"High"`, 1),
		"null score index":         strings.Replace(openAIDecisionFixture, `"value":0`, `"value":null`, 1),
		"fractional score index":   strings.Replace(openAIDecisionFixture, `"value":0`, `"value":0.5`, 1),
		"out of range score index": strings.Replace(openAIDecisionFixture, `"value":0`, `"value":2`, 1),
		"out of range score":       strings.Replace(openAIDecisionFixture, `"score":0.75`, `"score":2`, 1),
		"bad sum":                  strings.Replace(openAIDecisionFixture, `"probability":0.25`, `"probability":0.5`, 1),
		"missing confidence":       strings.Replace(openAIDecisionFixture, `,"confidence":0.5`, ``, 1),
		"missing model":            strings.Replace(openAIDecisionFixture, `"model":"gpt-6-luna-resolved",`, ``, 1),
		"missing usage":            strings.Replace(openAIDecisionFixture, `"usage":`, `"other":`, 1),
		"null tokens":              strings.Replace(openAIDecisionFixture, `"input_tokens":12`, `"input_tokens":null`, 1),
		"negative tokens":          strings.Replace(openAIDecisionFixture, `"input_tokens":12`, `"input_tokens":-1`, 1),
		"invalid json":             `{`,
	}
	for name, response := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, response) }))
			defer server.Close()
			result, err := EvaluateDecision(context.Background(), DecisionOptions{Provider: "openai", Endpoint: server.URL, APIKey: "key", Model: "gpt-6-luna"}, DecisionState{Text: "text"}, decisionTestQuestions())
			if err == nil || result != nil {
				t.Fatalf("invalid response accepted: %+v %v", result, err)
			}
		})
	}
}

func TestDecisionOpenAIRefusalAndUnknownProvider(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		io.WriteString(w, strings.Replace(openAIDecisionFixture, `{"type":"predicate","name":"condition","probability":0.2}`, `{"type":"refusal","name":"condition"}`, 1))
	}))
	defer server.Close()
	options := DecisionOptions{Provider: "openai", Endpoint: server.URL, APIKey: "key", Model: "gpt-6-luna"}
	result, err := EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, decisionTestQuestions())
	if !errors.Is(err, ErrDecisionRefused) || result != nil || calls.Load() != 1 {
		t.Fatalf("refusal was coerced or retried: %+v %v", result, err)
	}
	options.Provider = "unknown"
	if _, err = EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, decisionTestQuestions()); err == nil || calls.Load() != 1 {
		t.Fatal("unknown provider sent request or fell back")
	}
}
