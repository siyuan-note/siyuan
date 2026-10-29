// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

// coalesceDocumentPlanAncestors 在同一次批量业务计划中合并缺失祖先，保留每篇最终文档的身份。
// 只合并原计划确认不存在的相同父身份和标题，不以展示路径推断相同位置。
func coalesceDocumentPlanAncestors(plans []*DocumentCreatePlan) {
	type key struct{ box, parent, title string }
	ancestors := map[key]string{}
	replacements := map[string]string{}
	replace := func(value *string) *string {
		if value != nil {
			if id, ok := replacements[*value]; ok {
				return &id
			}
		}
		return value
	}
	for _, plan := range plans {
		steps := make([]DocumentCreateRequest, 0, len(plan.Steps))
		for i, step := range plan.Steps {
			step.ParentID = replace(step.ParentID)
			for j := range step.NameConditions {
				step.NameConditions[j].ParentID = replace(step.NameConditions[j].ParentID)
				step.NameConditions[j].ExpectedID = replace(step.NameConditions[j].ExpectedID)
			}
			if i < len(plan.Steps)-1 {
				parent := ""
				if step.ParentID != nil {
					parent = *step.ParentID
				}
				identity := key{plan.Notebook, parent, step.Title}
				if id, exists := ancestors[identity]; exists {
					replacements[step.ID] = id
					continue
				}
				ancestors[identity] = step.ID
			}
			steps = append(steps, step)
		}
		plan.Steps = steps
	}
}
