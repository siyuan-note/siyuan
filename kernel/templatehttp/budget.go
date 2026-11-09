// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package templatehttp

import "time"

// Budget 在顺序执行的批次间累计用量，不保存请求、授权或响应正文。
type Budget struct {
	requests, bytes, calls, output int
	network                        time.Duration
	started                        time.Time
}

func NewBudget() *Budget { return &Budget{started: time.Now()} }

func (budget *Budget) Exhausted() bool {
	return budget.calls >= maxCalls || budget.requests >= maxCalls || budget.bytes >= maxTotalBody ||
		budget.output >= maxOutput || budget.network >= maxNetworkDuration || time.Since(budget.started) >= maxDuration
}

// 调用方串行认领批次，在首次求值前载入并在每条记录结束后保存累计用量。
func (e *Execution) UseBudget(budget *Budget) {
	e.budget = budget
	e.requests, e.bytes, e.calls, e.outputBytes = budget.requests, budget.bytes, budget.calls, budget.output
	e.networkTime = budget.network
}

func (e *Execution) SaveBudget() {
	if budget := e.budget; budget != nil {
		budget.requests, budget.bytes, budget.calls, budget.output = e.requests, e.bytes, e.calls, e.outputBytes
		budget.network = e.networkTime
	}
}

func (e *Execution) budgetDuration() time.Duration {
	if e.budget == nil {
		return maxDuration
	}
	return time.Until(e.budget.started.Add(maxDuration))
}
