// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	doomLoopWarnThreshold = 3
	doomLoopStopThreshold = 5
	doomLoopWindowSize    = 10
)

type doomObservation struct {
	target  string
	result  [32]byte
	isError bool
}

type doomLoopTracker struct {
	observations []doomObservation
	count        int
}

func buildDoomSignature(identity, action string, args map[string]any) string {
	encoded, err := json.Marshal([]any{identity, action, args})
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%x", sha256.Sum256(encoded))
}

// 仅识别明确的原生读取操作，未知扩展及有交互或写入副作用的调用不能作为停滞证据。
func repeatReadCandidate(registration *capabilityRegistration, action, result string) bool {
	if registration == nil || registration.Source != "native" || registration.Runtime != "kernel" || registration.Tool == nil {
		return false
	}
	switch registration.Tool.Name {
	case "file":
		switch action {
		case "read", "list", "grep", "find", "stat":
			return true
		}
	case "web_search":
		return true
	case "web_fetch":
		return !strings.HasPrefix(result, "Saved to: ")
	case "http_request":
		_, body, _ := strings.Cut(result, "\n\n")
		return (action == "" || strings.EqualFold(action, "get")) && !strings.HasPrefix(body, "Saved to: ")
	}
	return false
}

func (tracker *doomLoopTracker) record(registration *capabilityRegistration, name, action string, args map[string]any, result string, isError bool) (warn, stop bool) {
	failed := isError || strings.TrimSpace(result) == ""
	if name == "frontend" || (!failed && !repeatReadCandidate(registration, action, result)) {
		*tracker = doomLoopTracker{}
		return
	}
	identity := name
	if registration != nil && registration.ID != "" {
		identity = registration.ID
	}
	target := buildDoomSignature(identity, action, args)
	if target == "" {
		*tracker = doomLoopTracker{}
		return
	}
	observation := doomObservation{target: target, result: sha256.Sum256([]byte(result)), isError: isError}
	// 同一目标的结果变化代表新观察期；其余目标只保留有限窗口，避免长期累积误判。
	for i, old := range tracker.observations {
		if old.target == target && old != observation {
			tracker.observations[i] = doomObservation{}
		}
	}
	tracker.observations = append(tracker.observations, observation)
	if len(tracker.observations) > doomLoopWindowSize {
		tracker.observations = tracker.observations[len(tracker.observations)-doomLoopWindowSize:]
	}
	tracker.count = 0
	for _, old := range tracker.observations {
		if old == observation {
			tracker.count++
		}
	}
	return tracker.count == doomLoopWarnThreshold, tracker.count >= doomLoopStopThreshold
}
