// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
)

const DecisionJSONMaxBytes = 256 * 1024

type openAIDecisionPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	ImageURL string          `json:"image_url,omitempty"`
	Detail   string          `json:"detail,omitempty"`
}

// ValidateDecisionJSON 校验原生 JSON 的服务端限制，不将数字转换为 float64。
func ValidateDecisionJSON(data json.RawMessage) error {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if !json.Valid(data) || decoder.Decode(&value) != nil {
		return errors.New("decision JSON must be a valid object or array of objects")
	}
	switch root := value.(type) {
	case map[string]any:
	case []any:
		for _, item := range root {
			if _, ok := item.(map[string]any); !ok {
				return errors.New("decision JSON must be an object or array of objects")
			}
		}
	default:
		return errors.New("decision JSON must be an object or array of objects")
	}
	var compact bytes.Buffer
	_ = json.Compact(&compact, data)
	if compact.Len() > DecisionJSONMaxBytes {
		return errors.New("decision JSON exceeds 256 KiB; use text for larger evidence")
	}
	count := 0
	var visit func(any, int) bool
	visit = func(current any, depth int) bool {
		count++
		if count > 10000 {
			return false
		}
		switch container := current.(type) {
		case map[string]any:
			depth++
			if depth > 32 {
				return false
			}
			for _, child := range container {
				if !visit(child, depth) {
					return false
				}
			}
		case []any:
			depth++
			if depth > 32 {
				return false
			}
			for _, child := range container {
				if !visit(child, depth) {
					return false
				}
			}
		}
		return true
	}
	if !visit(value, 0) {
		return errors.New("decision JSON exceeds 32 container levels or 10000 values")
	}
	return nil
}

func ValidateDecisionImageDetail(detail string) error {
	if detail != "" && detail != "auto" && detail != "low" && detail != "high" && detail != "original" {
		return errors.New("unsupported decision image detail")
	}
	return nil
}

func ValidateDecisionImage(image DecisionImage) error {
	if err := ValidateDecisionImageDetail(image.Detail); err != nil {
		return err
	}
	if strings.HasPrefix(image.URL, "data:") {
		prefix, encoded, ok := strings.Cut(image.URL, ",")
		if !ok || (prefix != "data:image/png;base64" && prefix != "data:image/jpeg;base64" &&
			prefix != "data:image/webp;base64" && prefix != "data:image/gif;base64") || len(encoded) > base64.StdEncoding.EncodedLen(DecisionMaxBytes) {
			return errors.New("decision image must be a supported base64 image within 1 MiB")
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(data) == 0 || len(data) > DecisionMaxBytes {
			return errors.New("invalid decision image data")
		}
		return nil
	}
	parsed, err := url.Parse(image.URL)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" ||
		(parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("decision image requires an HTTP(S) URL or base64 image data URL")
	}
	return nil
}

func openAIDecisionContent(text string, images []DecisionImage) ([]openAIDecisionPart, error) {
	parts := make([]openAIDecisionPart, 0, len(images)+1)
	if text != "" {
		parts = append(parts, openAIDecisionPart{Type: "input_text", Text: text})
	}
	for _, image := range images {
		if err := ValidateDecisionImage(image); err != nil {
			return nil, err
		}
		parts = append(parts, openAIDecisionPart{Type: "input_image", ImageURL: image.URL, Detail: image.Detail})
	}
	return parts, nil
}

func openAIDecisionInstructions(text string, images []DecisionImage) (json.RawMessage, error) {
	if len(images) == 0 {
		return json.Marshal(text)
	}
	parts, err := openAIDecisionContent(text, images)
	if err != nil {
		return nil, err
	}
	return json.Marshal(parts)
}

func openAIDecisionInput(state DecisionState) (json.RawMessage, error) {
	data := state.Data
	state.Data = nil
	// 保留旧文本请求的完整证据和格式，避免 JSON 单块限制缩小原有容量。
	text, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 && len(state.Images) == 0 {
		return json.Marshal(string(text))
	}
	// JSON 或图片单独作为证据时，不附加表示空状态的 "{}" 文本。
	// 这不是用户输入，可能干扰图片判断；显式提供的文本或 JSON 仍完整保留。
	if state.Context == "" && state.Text == "" && len(state.Blocks) == 0 {
		text = nil
	}
	parts, err := openAIDecisionContent(string(text), state.Images)
	if err != nil {
		return nil, err
	}
	if len(data) != 0 {
		if err = ValidateDecisionJSON(data); err != nil {
			return nil, err
		}
		parts = append(parts, openAIDecisionPart{Type: "input_json", Data: data})
	}
	return json.Marshal([]struct {
		Role    string               `json:"role"`
		Content []openAIDecisionPart `json:"content"`
	}{{Role: "user", Content: parts}})
}
