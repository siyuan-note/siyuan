// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"io"
	"strings"
)

type memoryKeywords struct {
	Intent string   `json:"intent"`
	Terms  []string `json:"terms"`
}

// 意图来自独立的检索阶段，仅约束提案方向，不能替代删除权限与目标核验。
func decodeMemoryKeywords(raw string, manual bool) (memoryKeywords, error) {
	var result memoryKeywords
	invalid := errors.New("invalid memory keyword response")
	if len(raw) > 8192 {
		return result, invalid
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&result); err != nil {
		return result, invalid
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF || result.Terms == nil || len(result.Terms) > 12 {
		return result, invalid
	}
	for _, term := range result.Terms {
		if len(term) > 100 || strings.TrimSpace(term) == "" {
			return result, invalid
		}
	}
	if manual && result.Intent == "ambiguous" {
		return result, errors.New("memory request intent is ambiguous; clarify the update")
	}
	if manual && result.Intent != "remember" && result.Intent != "forget" {
		return result, invalid
	}
	return result, nil
}

func validateMemoryIntent(intent string, proposal memoryProposal) error {
	if intent == "forget" && len(proposal.Actions) == 0 {
		return errors.New("memory forget request found no matching target")
	}
	for _, a := range proposal.Actions {
		if intent == "forget" && a.Operation != "forget" {
			return errors.New("memory proposal does not match forget intent")
		}
		if intent == "remember" && a.Operation == "forget" {
			return errors.New("memory proposal does not match remember intent")
		}
	}
	return nil
}
