// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import "testing"

func TestNewAgentSessionDeadlineZeroHasNoLimit(t *testing.T) {
	timer, deadline := newAgentSessionDeadline(0)
	if timer != nil || deadline != nil {
		if timer != nil {
			timer.Stop()
		}
		t.Fatalf("zero timeout created a deadline: timer=%v, deadline=%v", timer, deadline)
	}
}
