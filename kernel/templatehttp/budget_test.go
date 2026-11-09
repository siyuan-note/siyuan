// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package templatehttp

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestDatabaseBudgetCarriesUsageWithoutResponsesOrApprovals(t *testing.T) {
	budget := NewBudget()
	requests, prompts := 0, 0
	for batch := 0; batch < 2; batch++ {
		e := New(context.Background(), "batch", func(context.Context, Request) bool { prompts++; return true })
		e.DatabaseFuncs("source")
		e.UseBudget(budget)
		e.transport = transportFunc(func(*http.Request) (*http.Response, error) { requests++; return response(200, "value"), nil })
		if ret := e.Get("https://example.com/"); ret["ok"] != true {
			t.Fatal(ret)
		}
		e.SaveBudget()
		e.Close()
	}
	if budget.calls != 2 || budget.requests != 2 || budget.bytes != 10 || requests != 2 || prompts != 2 {
		t.Fatal("batch usage was reset or plaintext/approval reused", budget, requests, prompts)
	}
	for _, limit := range []string{"calls", "bytes", "network", "elapsed", "output"} {
		t.Run(limit, func(t *testing.T) {
			b := NewBudget()
			switch limit {
			case "calls":
				b.calls = maxCalls
			case "bytes":
				b.bytes = maxTotalBody
			case "network":
				b.network = maxNetworkDuration
			case "elapsed":
				b.started = time.Now().Add(-maxDuration)
			case "output":
				b.output = maxOutput
			}
			if !b.Exhausted() {
				t.Fatal("shared limit was reset", limit)
			}
		})
	}
}
