// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ErrManualAutomationExpired = errors.New("manual automation progress is unavailable")
var errManualAutomationChanged = errors.New("manual automation rule changed")

type manualAutomationRow struct{ id, status, code string }

// 进度仅保存标识、摘要及计数，跨批次不持有数据库明文或笔记本租约。
type manualAutomationRun struct {
	id, avID, blockID, boxID, ruleID, version string
	owner                                     *attributeViewHTTPOwner
	rows                                      []*manualAutomationRow
	step, operations                          int
	paused                                    string
	running                                   bool
	expires                                   time.Time
	budget                                    *templatehttp.Budget
	allowedSources                            map[string]bool
}

var manualAutomationRuns = struct {
	sync.Mutex
	values map[string]*manualAutomationRun
}{values: map[string]*manualAutomationRun{}}

func automationRuleVersion(rule *av.AutomationRule) string {
	data, _ := json.Marshal(rule)
	return templateHTTPDigest(string(data))
}

func (run *manualAutomationRun) report() *apicontract.AVAutomationRunResult {
	ret := &apicontract.AVAutomationRunResult{RunID: run.id, Step: run.step, Total: len(run.rows), Paused: run.paused, Running: run.running,
		Succeeded: []string{}, Failed: []*apicontract.AVAutomationRunFailure{}, Pending: []string{}, Skipped: []string{}}
	for _, row := range run.rows {
		switch row.status {
		case "succeeded":
			ret.Succeeded = append(ret.Succeeded, row.id)
		case "failed":
			ret.Failed = append(ret.Failed, &apicontract.AVAutomationRunFailure{ItemID: row.id, Code: row.code})
		case "skipped":
			ret.Skipped = append(ret.Skipped, row.id)
		default:
			ret.Pending = append(ret.Pending, row.id)
		}
	}
	return ret
}

func StartManualAutomationRows(request apicontract.RunAttributeViewAutomationRequest, app, session string) (*apicontract.AVAutomationRunResult, error) {
	if request.AvID == "" || request.BlockID == "" || request.RuleID == "" {
		return nil, ErrManualAutomationExpired
	}
	connection, _ := util.BindableInteractiveSession(app, session)
	if connection == nil {
		return nil, ErrManualAutomationExpired
	}
	reader := &Transaction{}
	defer reader.finishAttributeViewMutation(false)
	_, boxID := av.FindAttributeViewPath(request.AvID)
	view, err := reader.readAttributeViewForMutation(request.AvID, request.BlockID, boxID)
	if err != nil {
		return nil, err
	}
	view, err = cloneAttributeViewForFieldMutation(view)
	if err != nil {
		return nil, err
	}
	if view.Automations == nil || view.Automations.ValidateSpec() != nil {
		return nil, errManualAutomationChanged
	}
	var selected *av.AutomationRule
	for _, rule := range view.Automations.Rules {
		if rule != nil && rule.ID == request.RuleID && rule.Enabled && rule.Trigger == "manual" {
			selected = rule
			break
		}
	}
	if selected == nil {
		return nil, errManualAutomationChanged
	}
	_, boxID = view.StoragePath()
	if err = reader.validateAutomationRule(view, selected, boxID); err != nil {
		return nil, err
	}
	run := &manualAutomationRun{id: rand.Text(), avID: view.ID, blockID: request.BlockID, boxID: boxID, ruleID: selected.ID,
		version: automationRuleVersion(selected), owner: &attributeViewHTTPOwner{app, session, connection},
		expires: time.Now().Add(15 * time.Minute), budget: templatehttp.NewBudget()}
	values := reader.automationRelationValues(boxID, map[string]*av.AttributeView{view.ID: view})
	for _, row := range view.GetBlockKeyValues().Values {
		matches, matchErr := view.MatchesAutomationFilters(row.BlockID, selected.Conditions, values)
		if matchErr != nil {
			return nil, matchErr
		}
		if matches {
			if len(run.rows) >= 10000 {
				return nil, fmt.Errorf("manual automation exceeds 10000 source entries")
			}
			run.rows = append(run.rows, &manualAutomationRow{id: row.BlockID})
		}
	}
	manualAutomationRuns.Lock()
	defer manualAutomationRuns.Unlock()
	for id, candidate := range manualAutomationRuns.values {
		if !candidate.running && time.Now().After(candidate.expires) {
			delete(manualAutomationRuns.values, id)
		}
	}
	if len(manualAutomationRuns.values) >= 32 {
		return nil, fmt.Errorf("too many manual automation runs")
	}
	manualAutomationRuns.values[run.id] = run
	return run.report(), nil
}

func manualAutomationRunLocked(request apicontract.RunAttributeViewAutomationRequest, app, session string) (*manualAutomationRun, error) {
	connection, _ := util.BindableInteractiveSession(app, session)
	run := manualAutomationRuns.values[request.RunID]
	if run == nil || time.Now().After(run.expires) || run.avID != request.AvID || run.blockID != request.BlockID || run.ruleID != request.RuleID ||
		connection == nil || connection != run.owner.connection || app != run.owner.app || session != run.owner.session {
		return nil, ErrManualAutomationExpired
	}
	return run, nil
}

func ManualAutomationRowsStatus(request apicontract.RunAttributeViewAutomationRequest, app, session string) (*apicontract.AVAutomationRunResult, error) {
	manualAutomationRuns.Lock()
	defer manualAutomationRuns.Unlock()
	run, err := manualAutomationRunLocked(request, app, session)
	if err != nil {
		return nil, err
	}
	return run.report(), nil
}

func RunManualAutomationRows(ctx context.Context, request apicontract.RunAttributeViewAutomationRequest, app, session string,
	runtime *templatehttp.Execution, committed func(*Transaction)) (*apicontract.AVAutomationRunResult, error) {
	manualAutomationRuns.Lock()
	run, err := manualAutomationRunLocked(request, app, session)
	if err != nil {
		manualAutomationRuns.Unlock()
		return nil, err
	}
	if request.Step < 0 || request.Step > run.step {
		manualAutomationRuns.Unlock()
		return nil, fmt.Errorf("invalid automation step")
	}
	if run.running || request.Step < run.step || request.Action != "retry" && run.paused != "" {
		ret := run.report()
		manualAutomationRuns.Unlock()
		return ret, nil
	}
	if request.Action == "retry" {
		for _, row := range run.rows {
			if row.status == "failed" {
				row.status, row.code = "", ""
			}
		}
		run.budget, run.operations, run.paused = templatehttp.NewBudget(), 0, ""
		run.allowedSources = nil
	}
	run.running = true
	var pending []*manualAutomationRow
	approvals := make(map[string]bool, len(run.allowedSources))
	for scope, allowed := range run.allowedSources {
		approvals[scope] = allowed
	}
	for _, row := range run.rows {
		if row.status == "" {
			pending = append(pending, row)
			if len(pending) == 32 {
				break
			}
		}
	}
	manualAutomationRuns.Unlock()
	defer func() {
		manualAutomationRuns.Lock()
		if run.running {
			run.running, run.step = false, run.step+1
		}
		manualAutomationRuns.Unlock()
	}()
	if runtime != nil {
		runtime.UseBudget(run.budget)
	}
	execution := managedTemplateHTTPExecution(runtime)
	if execution != nil {
		execution.mu.Lock()
		execution.allowedSources = make(map[string]bool, len(approvals))
		for scope, allowed := range approvals {
			execution.allowedSources[scope] = allowed
		}
		execution.mu.Unlock()
	}
	for _, row := range pending {
		paused := ""
		if run.operations >= maxAutomationOperations || run.budget.Exhausted() {
			paused = "budget"
		}
		if ctx.Err() != nil || runtime != nil && runtime.Err() != nil {
			paused = "canceled"
		}
		if paused != "" {
			manualAutomationRuns.Lock()
			run.paused = paused
			manualAutomationRuns.Unlock()
			break
		}
		var tx *Transaction
		err = runStoredAttributeViewAutomation(ctx, run.avID, run.blockID, run.ruleID, runtime, nil, &tx,
			storedAutomationOptions{items: []string{row.id}, operations: maxAutomationOperations - run.operations, ruleVersion: run.version})
		if runtime != nil {
			runtime.SaveBudget()
		}
		manualAutomationRuns.Lock()
		if err == nil {
			if tx == nil {
				row.status = "skipped"
			} else {
				row.status = "succeeded"
				run.operations += tx.storedAutomation.operations
			}
		} else if errors.Is(err, errAutomationOperationBudget) || run.budget.Exhausted() {
			run.paused = "budget"
		} else if errors.Is(err, errManualAutomationChanged) {
			run.paused = "changed"
		} else if ctx.Err() != nil || runtime != nil && runtime.Err() != nil {
			run.paused = "canceled"
		} else {
			row.status, row.code = "failed", "failed"
			var httpErr *automationHTTPError
			if errors.As(err, &httpErr) {
				row.code = httpErr.code
				if httpErr.code == "denied" || httpErr.code == "confirmation_timeout" || httpErr.code == "interaction_required" {
					row.status, row.code, run.paused = "", "", "denied"
				}
			}
		}
		stopped := run.paused != ""
		manualAutomationRuns.Unlock()
		if err == nil && tx != nil && committed != nil {
			committed(tx)
		}
		if stopped {
			break
		}
	}
	if execution != nil {
		execution.mu.Lock()
		allowed := make(map[string]bool, len(execution.allowedSources))
		if execution.ctx.Err() == nil {
			for scope, value := range execution.allowedSources {
				allowed[scope] = value
			}
		}
		execution.mu.Unlock()
		manualAutomationRuns.Lock()
		run.allowedSources = allowed
		manualAutomationRuns.Unlock()
	}
	manualAutomationRuns.Lock()
	defer manualAutomationRuns.Unlock()
	run.running, run.step = false, run.step+1
	return run.report(), nil
}

func clearManualAutomationRuns() {
	manualAutomationRuns.Lock()
	defer manualAutomationRuns.Unlock()
	clear(manualAutomationRuns.values)
}

func clearManualAutomationApprovals() {
	manualAutomationRuns.Lock()
	defer manualAutomationRuns.Unlock()
	for _, run := range manualAutomationRuns.values {
		run.allowedSources = nil
	}
}
