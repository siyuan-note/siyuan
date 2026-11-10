// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package templatehttp

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDatabaseDenialCoversColumnOnlyForCurrentExecution(t *testing.T) {
	prompts := 0
	newExecution := func() *Execution {
		return New(context.Background(), "database", func(context.Context, Request) bool { prompts++; return false })
	}
	e := newExecution()
	defer e.Close()
	for row := 0; row < 70; row++ {
		if got := e.getScoped("column-one", "https://example.com/"+strconv.Itoa(row))["error"]; got != "denied" {
			t.Fatal(got)
		}
	}
	if prompts != 1 || e.requests != 1 || e.Err() != nil {
		t.Fatalf("repeated rejection prompts=%d requests=%d err=%v", prompts, e.requests, e.Err())
	}
	e.getScoped("column-two", "https://example.com/other")
	e.getScoped("column-one-new-version", "https://example.com/other")
	if prompts != 3 {
		t.Fatal("denial escaped its source/version", prompts)
	}
	next := newExecution()
	defer next.Close()
	next.getScoped("column-one", "https://example.com/new-execution")
	if prompts != 4 {
		t.Fatal("denial persisted", prompts)
	}
}

func TestDatabaseBatchesContinueAndKeepBudgets(t *testing.T) {
	e := New(context.Background(), "database", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.DatabaseFuncs("column")
	requests := 0
	var batchStarted time.Time
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		requests++
		if requests == maxRequests {
			batchStarted = time.Now()
		}
		if requests == maxRequests+1 && time.Since(batchStarted) < batchInterval {
			t.Fatal("next batch started without pacing")
		}
		return response(200, "value"), nil
	})
	for row := 0; row < 70; row++ {
		if got := e.getScoped("column", "https://example.com/"+strconv.Itoa(row)); got["ok"] != true {
			t.Fatal(row, got)
		}
	}
	if requests != 70 {
		t.Fatal(requests)
	}
	e.requests = maxCalls
	if got := e.Get("https://example.com/overflow")["error"]; got != "budget_exceeded" || e.Err() == nil {
		t.Fatal("total request cap escaped", got)
	}
	for _, budget := range []string{"bytes", "duration"} {
		t.Run(budget, func(t *testing.T) {
			x := New(context.Background(), "database", func(context.Context, Request) bool { return true })
			defer x.Close()
			x.DatabaseFuncs("column")
			if budget == "bytes" {
				x.bytes = maxTotalBody
			} else {
				x.networkTime = maxNetworkDuration
			}
			if got := x.Get("https://example.com")["error"]; got != "budget_exceeded" {
				t.Fatal(got)
			}
		})
	}
}

func TestDatabaseBatchWaitRespondsToCancellation(t *testing.T) {
	e := New(context.Background(), "database", func(context.Context, Request) bool { t.Fatal("confirmation after cancel"); return false })
	defer e.Close()
	e.DatabaseFuncs("column")
	e.requests = maxRequests
	go func() { time.Sleep(batchInterval / 4); e.Close() }()
	if got := e.Get("https://example.com")["error"]; got != "execution_ended" {
		t.Fatal(got)
	}
	if len(networkSlots) != 0 {
		t.Fatal("batch wait held network slot")
	}
}

func TestTemplateResultCacheGuardsRefreshAndClearing(t *testing.T) {
	ClearTemplateResults()
	t.Cleanup(ClearTemplateResults)
	newExecution := func(automatic bool) *Execution {
		e := New(context.Background(), "database", func(context.Context, Request) bool { return true })
		e.SetAutomaticRefresh(automatic)
		t.Cleanup(e.Close)
		return e
	}
	first := newExecution(false)
	first.StoreTemplate("source", "row-one", "source/input-one", "old")
	first.CommitTemplateResults()
	auto := newExecution(true)
	if got, ok := auto.CachedTemplate("source", "row-one", "source/input-one"); !ok || got != "old" {
		t.Fatal(got, ok)
	}
	if _, ok := auto.CachedTemplate("source", "row-two", "source/input-one"); ok {
		t.Fatal("new row reused another row")
	}
	if _, ok := auto.CachedTemplate("source", "row-one", "source/input-two"); ok {
		t.Fatal("changed input reused")
	}
	if _, ok := auto.CachedTemplate("source", "row-one", "source/input-one"); ok {
		t.Fatal("old input revived")
	}
	first.StoreTemplate("source", "row-one", "source/input-one", "old")
	first.CommitTemplateResults()
	manual := newExecution(false)
	if _, ok := manual.CachedTemplate("source", "row-one", "source/input-one"); ok {
		t.Fatal("manual refresh reused")
	}
	if _, ok := auto.CachedTemplate("source", "row-one", "source/input-one"); ok {
		t.Fatal("failed manual refresh retained old output")
	}
	first.StoreTemplate("source", "row-one", "source/input-one", "old")
	first.CommitTemplateResults()
	auto.SetRequestGuard(func(context.Context, string) bool { return false })
	if _, ok := auto.CachedTemplate("source", "row-one", "source/input-one"); ok || auto.Err() == nil {
		t.Fatal("stale owner read cached data")
	}
	ClearTemplateResults()
	first.StoreTemplate("source", "row-one", "source/input-one", "late")
	first.CommitTemplateResults()
	if _, ok := newExecution(true).CachedTemplate("source", "row-one", "source/input-one"); ok {
		t.Fatal("late write after clearing")
	}
}

func TestTemplateResultCacheLimitsAndOutputBudget(t *testing.T) {
	ClearTemplateResults()
	t.Cleanup(ClearTemplateResults)
	e := New(context.Background(), "database", nil)
	defer e.Close()
	e.SetAutomaticRefresh(true)
	for row := 0; row <= maxCachedTemplates; row++ {
		e.StoreTemplate("source", strconv.Itoa(row), "input", "value")
		e.CommitTemplateResults()
	}
	if _, ok := e.CachedTemplate("source", "0", "input"); ok {
		t.Fatal("entry limit escaped")
	}
	for row := 0; row < 20; row++ {
		e.StoreTemplate("source", strconv.Itoa(row), "input", strings.Repeat("x", maxBody))
		e.CommitTemplateResults()
	}
	templateResults.Lock()
	bytes, count := templateResults.bytes, len(templateResults.entries)
	templateResults.Unlock()
	if bytes > maxCachedTemplateBytes || count > maxCachedTemplates {
		t.Fatal(bytes, count)
	}
	e.outputBytes = maxOutput
	if _, ok := e.CachedTemplate("source", "19", "input"); ok || e.Err() == nil {
		t.Fatal("cached output bypassed budget")
	}
}

func TestTemplateResultCacheDiscardsIncompleteExecutions(t *testing.T) {
	for _, reason := range []string{"canceled", "error", "stale-source"} {
		t.Run(reason, func(t *testing.T) {
			ClearTemplateResults()
			t.Cleanup(ClearTemplateResults)
			e := New(context.Background(), "database", nil)
			defer e.Close()
			e.StoreTemplate("source", "row", "input", "partial output")
			next := New(context.Background(), "database", nil)
			defer next.Close()
			next.SetAutomaticRefresh(true)
			if _, ok := next.CachedTemplate("source", "row", "input"); ok {
				t.Fatal("incomplete render published intermediate output")
			}
			switch reason {
			case "canceled":
				e.Close()
			case "error":
				e.ReportTemplateError()
			case "stale-source":
				e.SetRequestGuard(func(context.Context, string) bool { return false })
			}
			e.CommitTemplateResults()
			if _, ok := next.CachedTemplate("source", "row", "input"); ok {
				t.Fatal("invalidated render admitted intermediate output")
			}
		})
	}
}
