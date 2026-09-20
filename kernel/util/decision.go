package util

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/siyuan-note/httpclient"
)

// DecisionMaxBytes 限制单次请求和响应的内存占用，不替代供应商的 token 限制。
const DecisionMaxBytes = 1024 * 1024

type DecisionOptions struct {
	Endpoint, APIKey, Model string
	Timeout                 int
}

type DecisionState struct {
	Context string          `json:"context,omitempty"`
	Text    string          `json:"text,omitempty"`
	Blocks  []DecisionBlock `json:"blocks,omitempty"`
}

type DecisionBlock struct {
	ID       string `json:"id"`
	Markdown string `json:"markdown"`
}

type DecisionQuestion struct {
	Type         string          `json:"type"`
	Instructions string          `json:"instructions"`
	Criteria     json.RawMessage `json:"criteria,omitempty"`
}

type DecisionAnswer struct {
	Type          string              `json:"type"`
	Choice        *string             `json:"choice,omitempty"`
	Score         *float64            `json:"score,omitempty"`
	Noul          *float64            `json:"noul,omitempty"`
	Probabilities map[string]*float64 `json:"probabilities,omitempty"`
	Confidence    *float64            `json:"confidence,omitempty"`
	Legend        map[string]string   `json:"legend,omitempty"`
}

type DecisionResult struct {
	Model   string                    `json:"model"`
	Answers map[string]DecisionAnswer `json:"answers"`
	Usage   struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

var decisionHTTPClient = func() *http.Client {
	client := httpclient.NewUserAgentClient(nil)
	// 决策正文和凭据只发送到用户配置的端点。
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return client
}()

func ValidateDecisionQuestions(questions map[string]DecisionQuestion) error {
	if len(questions) == 0 || len(questions) > 32 {
		return errors.New("decision requires 1 to 32 questions")
	}
	for id, question := range questions {
		if strings.TrimSpace(id) == "" || strings.TrimSpace(question.Instructions) == "" {
			return errors.New("decision question IDs and instructions must not be empty")
		}
		switch question.Type {
		case "choice":
			var criteria map[string]string
			if err := json.Unmarshal(question.Criteria, &criteria); err != nil || len(criteria) < 2 || len(criteria) > 255 {
				return errors.New("choice requires 2 to 255 named options with descriptions")
			}
			for key, description := range criteria {
				if strings.TrimSpace(key) == "" || strings.TrimSpace(description) == "" {
					return errors.New("choice options and descriptions must not be empty")
				}
			}
		case "score":
			var criteria []string
			if err := json.Unmarshal(question.Criteria, &criteria); err != nil || len(criteria) < 2 || len(criteria) > 10 {
				return errors.New("score requires 2 to 10 ordered level descriptions")
			}
			for _, description := range criteria {
				if strings.TrimSpace(description) == "" {
					return errors.New("score level descriptions must not be empty")
				}
			}
		case "noul":
			if len(question.Criteria) != 0 {
				return errors.New("put yes/no criteria in the noul instructions")
			}
		default:
			return errors.New("decision question type must be choice, score or noul")
		}
	}
	return nil
}

// EvaluateDecision 发送一次判断请求，不重试、不截断原文，也不将缺失或无效答案转换为分数。
func EvaluateDecision(ctx context.Context, options DecisionOptions, state DecisionState, questions map[string]DecisionQuestion) (*DecisionResult, error) {
	if err := ValidateDecisionQuestions(questions); err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(options.Endpoint)
	if err != nil || endpoint.Host == "" || endpoint.User != nil || endpoint.Fragment != "" ||
		(endpoint.Scheme != "https" && endpoint.Scheme != "http") {
		return nil, errors.New("invalid decision API endpoint")
	}
	if strings.TrimSpace(options.APIKey) == "" || strings.TrimSpace(options.Model) == "" {
		return nil, errors.New("decision model not configured")
	}
	payload, err := json.Marshal(struct {
		Model     string                      `json:"model"`
		State     DecisionState               `json:"state"`
		Questions map[string]DecisionQuestion `json:"questions"`
	}{options.Model, state, questions})
	if err != nil || len(payload) > DecisionMaxBytes {
		return nil, errors.New("decision request exceeds 1 MiB; reduce the input without silently truncating it")
	}
	timeout := options.Timeout
	if timeout < 1 {
		timeout = 30
	}
	if timeout > 600 {
		timeout = 600
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, options.Endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, errors.New("could not create decision request")
	}
	req.Header.Set("Authorization", "Bearer "+options.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := decisionHTTPClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("decision request failed; check the endpoint and network")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("decision API returned HTTP %d; check credentials, limits and service availability", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, DecisionMaxBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("could not read decision response")
	}
	if len(data) > DecisionMaxBytes {
		return nil, errors.New("decision response exceeds 1 MiB")
	}
	var result DecisionResult
	if err = json.Unmarshal(data, &result); err != nil || !validDecisionResult(result, questions) {
		return nil, errors.New("decision API returned incomplete or invalid answers")
	}
	return &result, nil
}

func validDecisionResult(result DecisionResult, questions map[string]DecisionQuestion) bool {
	if result.Model == "" || len(result.Answers) != len(questions) {
		return false
	}
	for id, question := range questions {
		answer, ok := result.Answers[id]
		if !ok || answer.Type != question.Type {
			return false
		}
		if question.Type == "noul" {
			if !decisionNumberInRange(answer.Noul, 0, 1) {
				return false
			}
			continue
		}
		if !decisionNumberInRange(answer.Confidence, 0, 1) {
			return false
		}
		var choices map[string]string
		if question.Type == "choice" {
			_ = json.Unmarshal(question.Criteria, &choices)
			if answer.Choice == nil {
				return false
			}
			if _, ok = choices[*answer.Choice]; !ok {
				return false
			}
		} else {
			var levels []string
			_ = json.Unmarshal(question.Criteria, &levels)
			if !decisionNumberInRange(answer.Score, 0, float64(len(levels)-1)) {
				return false
			}
			choices = map[string]string{}
			for index, level := range levels {
				choices[strconv.Itoa(index)] = level
			}
			if len(answer.Legend) != len(choices) {
				return false
			}
			for key, level := range choices {
				if answer.Legend[key] != level {
					return false
				}
			}
		}
		if len(answer.Probabilities) != len(choices) {
			return false
		}
		sum := 0.0
		for key := range choices {
			probability, exists := answer.Probabilities[key]
			if !exists || !decisionNumberInRange(probability, 0, 1) {
				return false
			}
			sum += *probability
		}
		if math.Abs(sum-1) > 0.01 {
			return false
		}
	}
	return true
}

func decisionNumberInRange(value *float64, min, max float64) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0) && *value >= min && *value <= max
}
