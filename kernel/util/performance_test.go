// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"testing"
	"time"
)

func TestPerformanceAccumulatesStagesAndReportsOnce(t *testing.T) {
	now := time.Unix(0, 0)
	var records []performanceRecord
	p := newPerformance("search", func() time.Time { return now }, func(record performanceRecord) {
		records = append(records, record)
	})
	now = now.Add(time.Millisecond)
	p.Stage("query")
	now = now.Add(2 * time.Millisecond)
	p.Stage("format")
	now = now.Add(time.Millisecond)
	p.Stage("query")
	now = now.Add(3 * time.Millisecond)
	p.Count("rows", 20)
	p.Finish()
	p.Count("rows", 99)
	p.Finish()
	if len(records) != 1 {
		t.Fatalf("operation produced %d records", len(records))
	}
	r := records[0]
	if r.Operation != "search" || r.DurationUS != 7000 || r.StagesUS["prepare"] != 1000 ||
		r.StagesUS["query"] != 5000 || r.StagesUS["format"] != 1000 || r.Counts["rows"] != 20 {
		t.Fatalf("incorrect timing or mutation after completion: %+v", r)
	}
}

func TestDisabledPerformanceDoesNotAllocate(t *testing.T) {
	if performanceEnabled {
		t.Skip("performance logging was explicitly enabled")
	}
	if allocations := testing.AllocsPerRun(100, func() {
		p := BeginPerformance("search")
		p.Stage("query")
		p.Count("rows", 10)
		p.Finish()
	}); allocations != 0 {
		t.Fatalf("disabled instrumentation allocated %v objects", allocations)
	}
}
