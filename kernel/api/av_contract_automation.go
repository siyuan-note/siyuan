package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var previewAttributeViewCollection = contractHandler(apicontract.PreviewAttributeViewCollection,
	func(c *gin.Context, request apicontract.AVBlockCollectionPreviewRequest) apicontract.Response[*apicontract.AVBlockCollectionPreview] {
		if err := holdAttributeViewRequest(c, "", request.AvID); err != nil {
			return apicontract.Failure[*apicontract.AVBlockCollectionPreview](-1, err.Error())
		}
		data, err := model.PreviewAttributeViewCollection(request.AvID, request.RuleID, request.Page)
		if err != nil {
			return apicontract.Failure[*apicontract.AVBlockCollectionPreview](-1, err.Error())
		}
		return apicontract.Success(data)
	})

var reviewAttributeViewCollection = contractHandler(apicontract.ReviewAttributeViewCollection,
	func(c *gin.Context, request apicontract.AVCollectionReviewRequest) apicontract.Response[*apicontract.AVCollectionReview] {
		if err := holdAttributeViewRequest(c, "", request.AvID); err != nil {
			return apicontract.Failure[*apicontract.AVCollectionReview](-1, err.Error())
		}
		data, err := model.ReviewAttributeViewCollection(request.AvID, request.Page, request.Status)
		if err != nil {
			return apicontract.Failure[*apicontract.AVCollectionReview](-1, err.Error())
		}
		return apicontract.Success(data)
	})

var previewAttributeViewTemplate = contractHandler(apicontract.PreviewAttributeViewTemplate,
	func(c *gin.Context, request apicontract.AVAutomationTemplatePreviewRequest) apicontract.Response[*apicontract.AVValue] {
		if err := holdAttributeViewRequest(c, "", request.AvID); err != nil {
			return apicontract.Failure[*apicontract.AVValue](-1, err.Error())
		}
		value, err := model.PreviewAttributeViewTemplate(request)
		if err != nil {
			return apicontract.Failure[*apicontract.AVValue](-1, err.Error())
		}
		return apicontract.Success(toContractAVValue(value))
	})

func toContractAVAutomationConfig(value *av.AutomationConfig) *apicontract.AVAutomationConfig {
	if value == nil {
		return nil
	}
	return &apicontract.AVAutomationConfig{Spec: value.Spec, Rules: avContractSlice(value.Rules, func(rule *av.AutomationRule) *apicontract.AVAutomationRule {
		if rule == nil {
			return nil
		}
		return &apicontract.AVAutomationRule{ID: rule.ID, Name: rule.Name, Enabled: rule.Enabled, Trigger: rule.Trigger,
			TimeZone: rule.TimeZone, NotifyOnSuccess: rule.NotifyOnSuccess,
			BlockSource: toContractAVAutomationBlockSource(rule.BlockSource),
			KeyID:       rule.KeyID, Conditions: avContractSlice(rule.Conditions, toContractAVViewFilter),
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
						return &apicontract.AVAutomationValue{Mode: field.Mode, KeyID: field.KeyID, Value: toContractAVValue(field.Value), Template: field.Template}
					})}
			})}
	})}
}

func toContractAVAutomationBlockSource(source *av.AutomationBlockSource) *apicontract.AVAutomationBlockSource {
	if source == nil {
		return nil
	}
	return &apicontract.AVAutomationBlockSource{NotebookIDs: source.NotebookIDs, DocumentIDs: source.DocumentIDs,
		TagMatch: source.TagMatch, TagTarget: source.TagTarget, AttributeMatch: source.AttributeMatch,
		Types: source.Types, Tags: source.Tags, Attributes: avContractSlice(source.Attributes, func(attr *av.AutomationBlockAttribute) *apicontract.AVAutomationBlockAttribute {
			if attr == nil {
				return nil
			}
			return &apicontract.AVAutomationBlockAttribute{Name: attr.Name, Operator: attr.Operator, Value: attr.Value}
		})}
}
