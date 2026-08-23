// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"testing"
	"time"
)

func TestNewAgentSessionDeadlineZeroHasNoLimit(t *testing.T) {
	timer, deadline := newAgentSessionDeadline(0)
	if timer != nil || deadline != nil {
		if timer != nil {
			timer.Stop()
		}
		t.Fatalf("zero timeout created a deadline: timer=%v, deadline=%v", timer, deadline)
	}
}

func TestResolveAgentConfirmTimeout(t *testing.T) {
	if timeout := resolveAgentConfirmTimeout(0); timeout != 0 {
		t.Fatalf("zero confirmation timeout was changed: %v", timeout)
	}
	if timeout := resolveAgentConfirmTimeout(30); timeout != 30*time.Second {
		t.Fatalf("positive confirmation timeout was not preserved: %v", timeout)
	}
	if timeout := resolveAgentConfirmTimeout(-1); timeout != 120*time.Second {
		t.Fatalf("negative confirmation timeout did not use the default: %v", timeout)
	}
}
