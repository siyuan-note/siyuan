// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type storedAttributeViewAutomation struct {
	ctx        context.Context
	runtime    *templatehttp.Execution
	at         time.Time
	source     *attributeViewAutomationSource
	runs       []*storedAutomationRun
	jobID      string
	views      map[string]*av.AttributeView
	versions   map[string]string
	values     map[string]map[*av.AutomationValue]*av.Value
	targets    map[string]map[*av.AutomationAction][]string
	operations int
}

type storedAutomationOptions struct {
	items       []string
	operations  int
	ruleVersion string
}

var errAutomationOperationBudget = errors.New("automation operation budget exhausted")

type automationHTTPError struct{ code string }

func (err *automationHTTPError) Error() string { return "automation HTTP request failed: " + err.code }

type storedAutomationRun struct {
	rule  *av.AutomationRule
	items []string
}

func attributeViewAutomationVersion(view *av.AttributeView) string {
	data, _ := json.Marshal(view)
	return templateHTTPDigest(string(data))
}

func RunAttributeViewAutomation(ctx context.Context, avID, blockID, ruleID string, runtime *templatehttp.Execution) error {
	return runStoredAttributeViewAutomation(ctx, avID, blockID, ruleID, runtime, nil, nil)
}

// 取数在存储快照上完成，全部成功后再进入写事务，网络等待不占用编辑事务锁。
func runStoredAttributeViewAutomation(ctx context.Context, avID, blockID, ruleID string, runtime *templatehttp.Execution,
	job *attributeViewHTTPAutomation, result **Transaction, options ...storedAutomationOptions) error {
	if job != nil && job.overflow {
		return fmt.Errorf("automation exceeds %d operations per execution", maxAutomationOperations)
	}
	FlushTxQueue()
	_, boxID := av.FindAttributeViewPath(avID)
	if job != nil {
		boxID = job.boxID
	}
	reader := &Transaction{}
	defer reader.finishAttributeViewMutation(false)
	plan := &storedAttributeViewAutomation{ctx: ctx, runtime: runtime, at: time.Now(),
		views: map[string]*av.AttributeView{}, versions: map[string]string{},
		values: map[string]map[*av.AutomationValue]*av.Value{}, targets: map[string]map[*av.AutomationAction][]string{}}
	load := func(id, carrier string) (*av.AttributeView, error) {
		if view := plan.views[id]; view != nil {
			return view, nil
		}
		view, err := reader.readAttributeViewForMutation(id, carrier, boxID)
		if err != nil {
			return nil, err
		}
		view, err = cloneAttributeViewForFieldMutation(view)
		if err == nil {
			plan.views[id], plan.versions[id] = view, attributeViewAutomationVersion(view)
		}
		return view, err
	}
	source, err := load(avID, blockID)
	if err != nil {
		return err
	}
	plan.source = &attributeViewAutomationSource{source, blockID, boxID}
	if job != nil {
		if job.version != attributeViewAutomationVersion(source) {
			return ErrAutomaticHTTPObsolete
		}
		plan.jobID = job.ID
	}
	if source.Automations == nil || source.Automations.ValidateSpec() != nil {
		if len(options) > 0 {
			return errManualAutomationChanged
		}
		return fmt.Errorf("manual automation is unavailable")
	}
	for _, rule := range source.Automations.Rules {
		if rule == nil || !rule.Enabled {
			continue
		}
		if job == nil && rule.ID == ruleID && rule.Trigger == "manual" ||
			job != nil && len(job.rules[rule.ID]) > 0 && (rule.Trigger == "added" || rule.Trigger == "changed") && rule.UsesHTTP() {
			plan.runs = append(plan.runs, &storedAutomationRun{rule: rule})
		}
	}
	if len(plan.runs) == 0 {
		if len(options) > 0 {
			return errManualAutomationChanged
		}
		return fmt.Errorf("manual automation is unavailable")
	}
	for _, run := range plan.runs {
		if len(options) > 0 && automationRuleVersion(run.rule) != options[0].ruleVersion {
			return errManualAutomationChanged
		}
		if err = reader.validateAutomationRule(source, run.rule, boxID); err != nil {
			return err
		}
	}
	relations := func(key *av.Key, ids []string) ([]*av.Value, error) {
		if key.Relation == nil {
			return nil, fmt.Errorf("automation relation is unavailable")
		}
		view, readErr := load(key.Relation.AvID, "")
		if readErr != nil {
			return nil, readErr
		}
		ret := []*av.Value{}
		for _, id := range ids {
			if value := view.GetBlockValue(id); value != nil {
				ret = append(ret, value)
			}
		}
		return ret, nil
	}
	count := 0
	for _, run := range plan.runs {
		rule := run.rule
		functions, functionErr := automationHTTPFunctions(runtime, boxID, avID, rule)
		err = functionErr
		if err != nil {
			return err
		}
		for _, item := range source.GetBlockKeyValues().Values {
			if len(options) > 0 && !slices.Contains(options[0].items, item.BlockID) {
				continue
			}
			if job != nil && !slices.Contains(job.rules[rule.ID], item.BlockID) {
				continue
			}
			if err = ctx.Err(); err != nil {
				return err
			}
			matches, matchErr := source.MatchesAutomationFilters(item.BlockID, rule.Conditions, relations)
			if matchErr != nil {
				return matchErr
			}
			if !matches {
				continue
			}
			run.items = append(run.items, item.BlockID)
			if plan.values[item.BlockID] == nil {
				plan.values[item.BlockID] = map[*av.AutomationValue]*av.Value{}
			}
			if plan.targets[item.BlockID] == nil {
				plan.targets[item.BlockID] = map[*av.AutomationAction][]string{}
			}
			for _, action := range rule.Actions {
				target, targetErr := reader.automationTarget(source, action, boxID)
				if targetErr != nil {
					return targetErr
				}
				target, targetErr = load(target.ID, "")
				if targetErr != nil {
					return targetErr
				}
				ids := []string{item.BlockID}
				if action.Target == "related" {
					ids = nil
					if value := source.GetValue(action.RelationKeyID, item.BlockID); value != nil && value.Relation != nil {
						ids = slices.Clone(value.Relation.BlockIDs)
					}
				} else if action.Target == "filtered" {
					ids = nil
					for _, row := range target.GetBlockKeyValues().Values {
						ids = append(ids, row.BlockID)
					}
				}
				selected := []string{}
				if action.Type != "add" {
					for _, id := range ids {
						matches, matchErr = target.MatchesAutomationFilters(id, action.Filters, relations)
						if matchErr != nil {
							return matchErr
						}
						if matches && !slices.Contains(selected, id) {
							selected = append(selected, id)
						}
					}
					if len(selected) == 0 {
						continue
					}
				}
				plan.targets[item.BlockID][action] = selected
				operations := len(selected) * len(action.Fields)
				if action.Type == "add" {
					operations = 1 + len(action.Fields)
				}
				count += operations
				if count > maxAutomationOperations {
					return fmt.Errorf("automation exceeds %d operations per execution", maxAutomationOperations)
				}
				if len(options) > 0 && count > options[0].operations {
					return errAutomationOperationBudget
				}
				keys := make([]string, 0, len(action.Fields))
				for id := range action.Fields {
					keys = append(keys, id)
				}
				sort.Strings(keys)
				for _, id := range keys {
					field := action.Fields[id]
					key, _ := target.GetKey(id)
					var value *av.Value
					if field.Mode == "template" {
						value, err = av.EvaluateAutomationTemplate(av.AutomationTemplateContext{Source: source,
							ItemID: item.BlockID, Time: plan.at, TimeZone: rule.TimeZone, AllowHTTP: true, HTTP: functions}, key, field.Template)
					} else {
						reader.attributeViewAutomations = &attributeViewAutomationState{time: plan.at.UnixMilli()}
						value, err = reader.resolveAutomationValue(source, item.BlockID, key, field, rule.TimeZone)
					}
					if err != nil {
						return err
					}
					if err = reader.validateAutomationTemplateReferences(source, target, key, value, boxID); err != nil {
						return err
					}
					plan.values[item.BlockID][field] = value
				}
			}
		}
	}
	if count == 0 {
		return nil
	}
	plan.operations = count
	tx := &Transaction{storedAutomation: plan, fromAPI: true}
	err = PerformTransactionSync(tx)
	if err == nil && result != nil {
		*result = tx
	}
	return err
}

func automationHTTPFunctions(runtime *templatehttp.Execution, boxID, avID string, rule *av.AutomationRule) (map[string]any, error) {
	if runtime == nil {
		return nil, nil
	}
	source, err := ResolveTemplateHTTPAutomationSource(boxID, avID, rule)
	if err != nil {
		return nil, err
	}
	scope := registerTemplateHTTPSource(runtime, boxID, source)
	request := runtime.DatabaseFuncs(scope)["httpGet"].(func(string, ...map[string]any) (map[string]any, error))
	return map[string]any{"httpGet": func(url string, options ...map[string]any) (map[string]any, error) {
		value, requestErr := request(url, options...)
		if requestErr == nil && value["ok"] != true {
			code, _ := value["error"].(string)
			requestErr = &automationHTTPError{code: code}
		}
		return value, requestErr
	}}, nil
}

func (tx *Transaction) validateStoredAttributeViewAutomation() error {
	plan := tx.storedAutomation
	if plan == nil {
		return nil
	}
	if err := plan.ctx.Err(); err != nil {
		return err
	}
	if plan.runtime != nil && plan.runtime.Err() != nil {
		return plan.runtime.Err()
	}
	for id, version := range plan.versions {
		view, err := tx.readAttributeViewForMutation(id, "", plan.source.boxID)
		if err != nil {
			return err
		}
		if attributeViewAutomationVersion(view) != version {
			if plan.jobID != "" {
				return ErrAutomaticHTTPObsolete
			}
			return fmt.Errorf("database changed during manual automation; run it again")
		}
	}
	return nil
}

func (tx *Transaction) applyStoredAttributeViewAutomation() error {
	plan := tx.storedAutomation
	if err := plan.ctx.Err(); err != nil {
		return err
	}
	tree, err := tx.loadTree(plan.source.blockID)
	if err != nil {
		return err
	}
	carrier := treenode.GetNodeInTree(tree, plan.source.blockID)
	if carrier == nil {
		return fmt.Errorf("manual automation carrier is unavailable")
	}
	previousUpdated := carrier.IALAttr("updated")
	tx.UndoOperations = []*Operation{{Action: "doUpdateUpdated", ID: carrier.ID, Data: previousUpdated}}
	for _, run := range plan.runs {
		result := tx.automationResult(plan.source.boxID, plan.source.before.ID, run.rule)
		for _, item := range run.items {
			for _, action := range run.rule.Actions {
				if action.Type != "add" && len(plan.targets[item][action]) == 0 {
					continue
				}
				if err := tx.runAutomationAction(plan.source, plan.source.before, item, action, run.rule.TimeZone, result); err != nil {
					return err
				}
			}
		}
	}
	if len(tx.DoOperations) > 0 {
		// 取数结果归属到载体文档，沿用其更新时间及撤销入口。
		operation := &Operation{Action: "doUpdateUpdated", ID: carrier.ID, Data: plan.at.Format("20060102150405")}
		if err := tx.doUpdateUpdated(operation); err != nil {
			return err
		}
		tx.DoOperations = append(tx.DoOperations, operation)
	}
	return nil
}
