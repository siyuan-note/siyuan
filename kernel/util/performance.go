// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/json"
	"os"
	"time"

	"github.com/siyuan-note/logging"
)

var performanceEnabled = os.Getenv("SIYUAN_PERFORMANCE") == "1"

type performanceRecord struct {
	Operation  string           `json:"operation"`
	DurationUS int64            `json:"duration_us"`
	StagesUS   map[string]int64 `json:"stages_us"`
	Counts     map[string]int64 `json:"counts,omitempty"`
}

// Performance 记录单次同步操作的阶段耗时；名称和计数键仅使用代码内固定值，不写入正文或路径。
type Performance struct {
	record   performanceRecord
	started  time.Time
	previous time.Time
	stage    string
	now      func() time.Time
	report   func(performanceRecord)
	finished bool
}

// BeginPerformance 仅在进程启动前设置 SIYUAN_PERFORMANCE=1 时分配记录，默认不采样。
func BeginPerformance(operation string) *Performance {
	if !performanceEnabled {
		return nil
	}
	return newPerformance(operation, time.Now, func(record performanceRecord) {
		data, err := json.Marshal(record)
		if err == nil {
			logging.LogInfof("siyuan-performance %s", data)
		}
	})
}

func newPerformance(operation string, now func() time.Time, report func(performanceRecord)) *Performance {
	started := now()
	return &Performance{
		record:  performanceRecord{Operation: operation, StagesUS: map[string]int64{}},
		started: started, previous: started, stage: "prepare", now: now, report: report,
	}
}

// Stage 结束上一个阶段；相同名称的多个阶段累计耗时。
func (p *Performance) Stage(stage string) {
	if p == nil || p.finished {
		return
	}
	now := p.now()
	p.record.StagesUS[p.stage] += now.Sub(p.previous).Microseconds()
	p.stage, p.previous = stage, now
}

// Count 保存当前操作的规模，不采集进程全局内存以免混淆并发请求的归属。
func (p *Performance) Count(name string, value int64) {
	if p == nil || p.finished {
		return
	}
	if p.record.Counts == nil {
		p.record.Counts = map[string]int64{}
	}
	p.record.Counts[name] = value
}

func (p *Performance) Finish() {
	if p == nil || p.finished {
		return
	}
	p.Stage("finished")
	p.record.DurationUS = p.previous.Sub(p.started).Microseconds()
	p.finished = true
	p.report(p.record)
}
