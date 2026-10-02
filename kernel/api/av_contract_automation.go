package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func toContractAVAutomationConfig(value *av.AutomationConfig) *apicontract.AVAutomationConfig {
	if value == nil {
		return nil
	}
	return &apicontract.AVAutomationConfig{Spec: value.Spec, Rules: avContractSlice(value.Rules, func(rule *av.AutomationRule) *apicontract.AVAutomationRule {
		if rule == nil {
			return nil
		}
		return &apicontract.AVAutomationRule{ID: rule.ID, Name: rule.Name, Enabled: rule.Enabled, Trigger: rule.Trigger,
			KeyID: rule.KeyID, Conditions: avContractSlice(rule.Conditions, toContractAVViewFilter),
			Actions: avContractSlice(rule.Actions, func(action *av.AutomationAction) *apicontract.AVAutomationAction {
				if action == nil {
					return nil
				}
				return &apicontract.AVAutomationAction{Type: action.Type, Target: action.Target, AvID: action.AvID,
					RelationKeyID: action.RelationKeyID, Filters: avContractSlice(action.Filters, toContractAVViewFilter),
					Fields: avContractMap(action.Fields, func(field *av.AutomationValue) *apicontract.AVAutomationValue {
						if field == nil {
							return nil
						}
						return &apicontract.AVAutomationValue{Mode: field.Mode, KeyID: field.KeyID, Value: toContractAVValue(field.Value)}
					})}
			})}
	})}
}
