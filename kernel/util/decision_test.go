package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func decisionTestQuestions() map[string]DecisionQuestion {
	return map[string]DecisionQuestion{
		"category":  {Type: "choice", Instructions: "Classify", Criteria: json.RawMessage(`{"a":"Alpha","b":"Beta"}`)},
		"rating":    {Type: "score", Instructions: "Rate", Criteria: json.RawMessage(`["Low","High"]`)},
		"condition": {Type: "noul", Instructions: "Is it relevant?"},
	}
}

const decisionTestResponse = `{"model":"jev-test","answers":{"category":{"type":"choice","choice":"a","probabilities":{"a":0.8,"b":0.2},"confidence":0.6},"rating":{"type":"score","score":0.75,"probabilities":{"0":0.25,"1":0.75},"legend":{"0":"Low","1":"High"},"confidence":0.5},"condition":{"type":"noul","noul":0.2}},"usage":{"input_tokens":12,"output_tokens":8}}`

func TestDecisionProtocol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("incorrect decision request headers")
		}
		var request struct {
			Model     string
			State     DecisionState
			Questions map[string]DecisionQuestion
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Model != "jev-latest" || request.State.Text != "完整正文" || request.Questions["rating"].Type != "score" {
			t.Errorf("incorrect decision request: %+v", request)
		}
		io.WriteString(w, decisionTestResponse)
	}))
	defer server.Close()
	result, err := EvaluateDecision(context.Background(), DecisionOptions{Endpoint: server.URL, APIKey: "test-key", Model: "jev-latest"}, DecisionState{Text: "完整正文"}, decisionTestQuestions())
	if err != nil {
		t.Fatal(err)
	}
	if *result.Answers["rating"].Score != 0.75 || *result.Answers["condition"].Noul != 0.2 || result.Usage.InputTokens != 12 {
		t.Fatalf("decision values were coerced: %+v", result)
	}
}

func TestDecisionRejectsInvalidAnswers(t *testing.T) {
	for name, response := range map[string]string{
		"missing answer":     strings.Replace(decisionTestResponse, `"condition":{"type":"noul","noul":0.2}`, `"other":{"type":"noul","noul":0.2}`, 1),
		"missing number":     strings.Replace(decisionTestResponse, `,"noul":0.2`, ``, 1),
		"null number":        strings.Replace(decisionTestResponse, `"noul":0.2`, `"noul":null`, 1),
		"out of range":       strings.Replace(decisionTestResponse, `"noul":0.2`, `"noul":2`, 1),
		"unknown option":     strings.Replace(decisionTestResponse, `"choice":"a"`, `"choice":"c"`, 1),
		"wrong type":         strings.Replace(decisionTestResponse, `"type":"noul"`, `"type":"choice"`, 1),
		"bad probabilities":  strings.Replace(decisionTestResponse, `"a":0.8`, `"a":0.1`, 1),
		"null probability":   strings.Replace(decisionTestResponse, `"a":0.8,"b":0.2`, `"a":null,"b":1`, 1),
		"missing confidence": strings.Replace(decisionTestResponse, `,"confidence":0.6`, ``, 1),
		"invalid JSON":       `{`,
		"empty":              `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, response) }))
			defer server.Close()
			result, err := EvaluateDecision(context.Background(), DecisionOptions{Endpoint: server.URL, APIKey: "key", Model: "jev"}, DecisionState{Text: "text"}, decisionTestQuestions())
			if err == nil || result != nil {
				t.Fatalf("invalid response accepted: %+v, %v", result, err)
			}
		})
	}
}

func TestDecisionCancellationLimitsAndErrors(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
		io.WriteString(w, "secret-key and private input")
	}))
	defer server.Close()
	options := DecisionOptions{Endpoint: server.URL, APIKey: "secret-key", Model: "jev"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := EvaluateDecision(ctx, options, DecisionState{Text: "text"}, decisionTestQuestions()); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	if _, err := EvaluateDecision(context.Background(), options, DecisionState{Text: strings.Repeat("x", DecisionMaxBytes)}, decisionTestQuestions()); err == nil {
		t.Fatal("oversized request accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("rejected request was sent")
	}
	_, err := EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, decisionTestQuestions())
	if err == nil || !strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "secret") || calls.Load() != 1 {
		t.Fatalf("HTTP failure retried or leaked content: %v", err)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, server.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	options.Endpoint = redirect.URL
	if _, err = EvaluateDecision(context.Background(), options, DecisionState{Text: "text"}, decisionTestQuestions()); err == nil || calls.Load() != 1 {
		t.Fatal("decision request followed a redirect")
	}
	timeout := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
	}))
	defer timeout.Close()
	options.Endpoint = timeout.URL
	ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err = EvaluateDecision(ctx, options, DecisionState{Text: "text"}, decisionTestQuestions()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout lost: %v", err)
	}
}

func TestDecisionQuestionLimits(t *testing.T) {
	for _, question := range []DecisionQuestion{
		{Type: "choice", Instructions: "classify", Criteria: json.RawMessage(`{"one":"Only"}`)},
		{Type: "score", Instructions: "rate", Criteria: json.RawMessage(`["Only"]`)},
		{Type: "noul"},
		{Type: "unknown", Instructions: "question"},
	} {
		if ValidateDecisionQuestions(map[string]DecisionQuestion{"q": question}) == nil {
			t.Fatal("invalid question accepted")
		}
	}
}
