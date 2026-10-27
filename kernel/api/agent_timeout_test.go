// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
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

func TestSessionDeadlineTimeoutSecondsSkippedWhenUnlimited(t *testing.T) {
	if _, skipped := sessionDeadlineTimeoutSeconds(0); !skipped {
		t.Fatal("zero session timeout was not treated as unlimited")
	}
}

func TestSessionDeadlineTimeoutSecondsCapsAtMax(t *testing.T) {
	seconds, skipped := sessionDeadlineTimeoutSeconds(conf.MaxAgentSessionTimeout + 1)
	if skipped || seconds != conf.MaxAgentSessionTimeout {
		t.Fatalf("session timeout above the max = %d, skipped=%v", seconds, skipped)
	}
	if seconds, skipped = sessionDeadlineTimeoutSeconds(30); skipped || seconds != 30 {
		t.Fatalf("session timeout below the max = %d, skipped=%v", seconds, skipped)
	}
}

func TestResolveAgentConfirmTimeout(t *testing.T) {
	if conf.DefaultAgentConfirmTimeout != 600 {
		t.Fatalf("default confirmation timeout changed: %d", conf.DefaultAgentConfirmTimeout)
	}
	if timeout := resolveAgentConfirmTimeout(0); timeout != 0 {
		t.Fatalf("zero confirmation timeout was changed: %v", timeout)
	}
	if timeout := resolveAgentConfirmTimeout(30); timeout != 30*time.Second {
		t.Fatalf("positive confirmation timeout was not preserved: %v", timeout)
	}
	if timeout := resolveAgentConfirmTimeout(-1); timeout != time.Duration(conf.DefaultAgentConfirmTimeout)*time.Second {
		t.Fatalf("negative confirmation timeout did not use the default: %v", timeout)
	}
}
