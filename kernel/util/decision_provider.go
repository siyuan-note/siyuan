package util

import (
	"encoding/json"
	"errors"
	"sort"
	"strconv"
)

const (
	DecisionProviderTypeSafe = "typesafe"
	DecisionProviderOpenAI   = "openai"
)

// ErrDecisionRefused 区分供应商拒答和格式错误，不携带原始响应或笔记正文。
var ErrDecisionRefused = errors.New("decision provider refused to answer a question")

// decisionQuestionSpec 是供应商无关的问题定义，候选和等级在协议转换前完成校验。
type decisionQuestionSpec struct {
	ID, Kind, Instructions string
	Choices                []decisionChoice
	Levels                 []string
}

type decisionChoice struct {
	Value       string `json:"value"`
	Description string `json:"description"`
}

func normalizeDecisionQuestions(questions map[string]DecisionQuestion) ([]decisionQuestionSpec, error) {
	if err := validateDecisionQuestions(questions); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(questions))
	for id := range questions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	ret := make([]decisionQuestionSpec, 0, len(ids))
	for _, id := range ids {
		question := questions[id]
		spec := decisionQuestionSpec{ID: id, Kind: question.Type, Instructions: question.Instructions}
		switch question.Type {
		case "choice":
			var options map[string]string
			_ = json.Unmarshal(question.Criteria, &options)
			keys := make([]string, 0, len(options))
			for key := range options {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				spec.Choices = append(spec.Choices, decisionChoice{Value: key, Description: options[key]})
			}
		case "score":
			_ = json.Unmarshal(question.Criteria, &spec.Levels)
		}
		ret = append(ret, spec)
	}
	return ret, nil
}

type decisionProvider interface {
	encode(string, DecisionState, []decisionQuestionSpec) ([]byte, error)
	decode([]byte, []decisionQuestionSpec) (*DecisionResult, error)
}

func decisionProviderFor(provider string) (decisionProvider, error) {
	switch provider {
	case "", DecisionProviderTypeSafe:
		return typeSafeDecisionProvider{}, nil
	case DecisionProviderOpenAI:
		return openAIDecisionProvider{}, nil
	default:
		return nil, errors.New("unsupported decision provider")
	}
}

type typeSafeDecisionProvider struct{}

func (typeSafeDecisionProvider) encode(model string, state DecisionState, specs []decisionQuestionSpec) ([]byte, error) {
	questions := make(map[string]DecisionQuestion, len(specs))
	for _, spec := range specs {
		question := DecisionQuestion{Type: spec.Kind, Instructions: spec.Instructions}
		switch spec.Kind {
		case "choice":
			options := make(map[string]string, len(spec.Choices))
			for _, choice := range spec.Choices {
				options[choice.Value] = choice.Description
			}
			question.Criteria, _ = json.Marshal(options)
		case "score":
			question.Criteria, _ = json.Marshal(spec.Levels)
		}
		questions[spec.ID] = question
	}
	return json.Marshal(struct {
		Model     string                      `json:"model"`
		State     DecisionState               `json:"state"`
		Questions map[string]DecisionQuestion `json:"questions"`
	}{model, state, questions})
}

func (typeSafeDecisionProvider) decode(data []byte, _ []decisionQuestionSpec) (*DecisionResult, error) {
	var result DecisionResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, errors.New("decision API returned incomplete or invalid answers")
	}
	return &result, nil
}

type openAIDecisionProvider struct{}

type openAIDecisionLevel struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

type openAIDecisionQuestion struct {
	Type         string                `json:"type"`
	Name         string                `json:"name"`
	Instructions string                `json:"instructions"`
	Choices      []decisionChoice      `json:"choices,omitempty"`
	Levels       []openAIDecisionLevel `json:"levels,omitempty"`
}

func (openAIDecisionProvider) encode(model string, state DecisionState, specs []decisionQuestionSpec) ([]byte, error) {
	// 将完整状态作为结构化文本证据传递，问题指令只放在 questions 中。
	input, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	questions := make([]openAIDecisionQuestion, 0, len(specs))
	for _, spec := range specs {
		question := openAIDecisionQuestion{Type: spec.Kind, Name: spec.ID, Instructions: spec.Instructions}
		switch spec.Kind {
		case "noul":
			question.Type = "predicate"
		case "choice":
			question.Choices = spec.Choices
		case "score":
			for index, description := range spec.Levels {
				question.Levels = append(question.Levels, openAIDecisionLevel{Label: strconv.Itoa(index), Description: description})
			}
		}
		questions = append(questions, question)
	}
	return json.Marshal(struct {
		Model     string                   `json:"model"`
		Input     string                   `json:"input"`
		Questions []openAIDecisionQuestion `json:"questions"`
	}{model, string(input), questions})
}

func (openAIDecisionProvider) decode(data []byte, specs []decisionQuestionSpec) (*DecisionResult, error) {
	invalid := errors.New("decision API returned incomplete or invalid answers")
	var response struct {
		Model   string `json:"model"`
		Answers []struct {
			Name          *string  `json:"name"`
			Type          string   `json:"type"`
			Choice        *string  `json:"choice"`
			Score         *float64 `json:"score"`
			Probability   *float64 `json:"probability"`
			Confidence    *float64 `json:"confidence"`
			Probabilities []struct {
				Value       json.RawMessage `json:"value"`
				Label       *string         `json:"label"`
				Probability *float64        `json:"probability"`
			} `json:"probabilities"`
		} `json:"answers"`
		Usage *struct {
			InputTokens  *int `json:"input_tokens"`
			OutputTokens *int `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(data, &response) != nil || len(response.Answers) != len(specs) {
		return nil, invalid
	}
	questions := make(map[string]decisionQuestionSpec, len(specs))
	for _, spec := range specs {
		questions[spec.ID] = spec
	}
	result := &DecisionResult{Model: response.Model, Answers: make(map[string]DecisionAnswer, len(specs))}
	refused := false
	seen := make(map[string]bool, len(specs))
	for _, answer := range response.Answers {
		if answer.Name == nil || seen[*answer.Name] {
			return nil, invalid
		}
		spec, exists := questions[*answer.Name]
		if !exists {
			return nil, invalid
		}
		seen[*answer.Name] = true
		if answer.Type == "refusal" {
			refused = true
			continue
		}
		expectedType := spec.Kind
		if expectedType == "noul" {
			expectedType = "predicate"
		}
		if answer.Type != expectedType {
			return nil, invalid
		}
		converted := DecisionAnswer{Type: spec.Kind, Choice: answer.Choice, Score: answer.Score,
			Noul: answer.Probability, Confidence: answer.Confidence}
		if spec.Kind != "noul" {
			converted.Probabilities = make(map[string]*float64, len(answer.Probabilities))
			if spec.Kind == "score" {
				converted.Legend = make(map[string]string, len(spec.Levels))
			}
			for _, probability := range answer.Probabilities {
				var key string
				if spec.Kind == "choice" {
					var value *string
					if json.Unmarshal(probability.Value, &value) != nil || value == nil {
						return nil, invalid
					}
					key = *value
				} else {
					var index *int
					if json.Unmarshal(probability.Value, &index) != nil || index == nil || *index < 0 || *index >= len(spec.Levels) {
						return nil, invalid
					}
					key = strconv.Itoa(*index)
					if probability.Label == nil || *probability.Label != key {
						return nil, invalid
					}
					converted.Legend[key] = spec.Levels[*index]
				}
				if _, duplicate := converted.Probabilities[key]; duplicate {
					return nil, invalid
				}
				converted.Probabilities[key] = probability.Probability
			}
		}
		result.Answers[*answer.Name] = converted
	}
	if refused {
		return nil, ErrDecisionRefused
	}
	if response.Usage == nil || response.Usage.InputTokens == nil || response.Usage.OutputTokens == nil {
		return nil, invalid
	}
	result.Usage.InputTokens, result.Usage.OutputTokens = *response.Usage.InputTokens, *response.Usage.OutputTokens
	return result, nil
}
