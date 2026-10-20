package model

import (
	"sort"
	"strconv"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type automationRuleResult struct {
	name  string
	items map[string]map[string]bool
}

// 各规则仅记录开启通知的实际写入，按数据库和条目去重，不把字段初始化重复计为更新。
func (tx *Transaction) automationResult(boxID, viewID string, rule *av.AutomationRule) *automationRuleResult {
	if tx.isReplay || tx.attributeViewAutomations == nil || rule == nil || rule.NotifyOnSuccess != nil && !*rule.NotifyOnSuccess {
		return nil
	}
	state := tx.attributeViewAutomations
	if state.results == nil {
		state.results = map[string]*automationRuleResult{}
	}
	key := boxID + "/" + viewID + "/" + rule.ID
	if state.results[key] == nil {
		state.results[key] = &automationRuleResult{name: rule.Name, items: map[string]map[string]bool{}}
	}
	return state.results[key]
}

func (result *automationRuleResult) record(kind, viewID, itemID string) {
	if result == nil {
		return
	}
	if result.items[kind] == nil {
		result.items[kind] = map[string]bool{}
	}
	result.items[kind][viewID+"/"+itemID] = true
}

// 在事务提交后生成单条摘要，未产生实际结果的规则不影响名称或统计。
func (state *attributeViewAutomationState) successMessage() string {
	if state == nil {
		return ""
	}
	totals := map[string]map[string]bool{}
	names := []string{}
	keys := make([]string, 0, len(state.results))
	for key := range state.results {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		result := state.results[key]
		count := 0
		for kind, items := range result.items {
			count += len(items)
			if totals[kind] == nil {
				totals[kind] = map[string]bool{}
			}
			for id := range items {
				totals[kind][id] = true
			}
		}
		if count > 0 {
			names = append(names, result.name)
		}
	}
	for id := range totals["added"] {
		delete(totals["updated"], id)
	}
	for id := range totals["collected"] {
		delete(totals["updated"], id)
	}
	parts := []string{}
	for _, result := range []struct{ kind, key string }{
		{"added", "automationResultAdded"}, {"updated", "automationResultUpdated"},
		{"collected", "automationResultCollected"}, {"removed", "automationResultRemoved"},
	} {
		if count := len(totals[result.kind]); count > 0 {
			parts = append(parts, strings.ReplaceAll(util.I18nTerm(Conf.Lang, result.key), "${1}", strconv.Itoa(count)))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	summary := strings.Join(parts, util.I18nTerm(Conf.Lang, "automationResultSeparator"))
	if len(names) == 1 {
		return strings.NewReplacer("${1}", util.EscapeHTML(names[0]), "${2}", summary).Replace(util.I18nTerm(Conf.Lang, "automationResultRule"))
	}
	return strings.ReplaceAll(util.I18nTerm(Conf.Lang, "automationResultSummary"), "${1}", summary)
}
