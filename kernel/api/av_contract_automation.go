// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

var runAttributeViewAutomation = contractHandler(apicontract.RunAttributeViewAutomation,
	func(c *gin.Context, request apicontract.RunAttributeViewAutomationRequest) apicontract.Response[apicontract.Null] {
		if err := holdAttributeViewRequest(c, request.BlockID, request.AvID); err != nil {
			return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(314))
		}
		if request.JobID != "" {
			job, ctx, finish, err := model.ClaimAttributeViewHTTPAutomation(c.Request.Context(), request.JobID, request.AvID, request.BlockID,
				c.GetHeader("X-Siyuan-Template-App"), c.GetHeader("X-Siyuan-Template-Session"))
			if errors.Is(err, model.ErrAutomaticHTTPObsolete) {
				return apicontract.Failure[apicontract.Null](-409, "")
			}
			if err != nil {
				return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(258))
			}
			defer finish()
			c.Request = c.Request.WithContext(ctx)
			execution, err := startTemplateHTTP(c, "automatic-automation")
			if err != nil || execution == nil {
				return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(258))
			}
			defer execution.Close()
			tx, err := model.RunAttributeViewHTTPAutomation(ctx, job, execution)
			if ctx.Err() != nil || errors.Is(err, model.ErrAutomaticHTTPObsolete) {
				return apicontract.Failure[apicontract.Null](-409, "")
			}
			if err != nil {
				return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(258))
			}
			if tx != nil {
				pushTransactions(c.GetHeader("X-Siyuan-Template-App"), c.GetHeader("X-Siyuan-Template-Session"), []*model.Transaction{tx})
			}
			return apicontract.Success(apicontract.Null{})
		}
		execution, err := startTemplateHTTP(c, "manual-automation")
		if err != nil {
			return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(258))
		}
		var runtime *templatehttp.Execution
		if execution != nil {
			defer execution.Close()
			runtime = execution.Runtime
		}
		if err = model.RunAttributeViewAutomation(c.Request.Context(), request.AvID, request.BlockID, request.RuleID, runtime); err != nil {
			return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(258))
		}
		return apicontract.Success(apicontract.Null{})
	})

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
		DocumentDepth:            source.DocumentDepth,
		IncludeSelectedDocuments: source.IncludeSelectedDocuments,
		ReferenceID:              source.ReferenceID,
		TagMatch:                 source.TagMatch, TagTarget: source.TagTarget, AttributeMatch: source.AttributeMatch,
		Types: source.Types, Tags: source.Tags, Attributes: avContractSlice(source.Attributes, func(attr *av.AutomationBlockAttribute) *apicontract.AVAutomationBlockAttribute {
			if attr == nil {
				return nil
			}
			return &apicontract.AVAutomationBlockAttribute{Name: attr.Name, NameOperator: attr.NameOperator,
				Operator: attr.Operator, Value: attr.Value}
		})}
}
