package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	mcpclient "github.com/siyuan-note/siyuan/kernel/mcp/client"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func aiProviderAdmission(c *gin.Context) *apicontract.Response[apicontract.Null] {
	if model.Conf.AI.HasAnyProvider() {
		return nil
	}
	response := apicontract.Failure[apicontract.Null](-1, model.Conf.Language(193))
	return &response
}

func aiEditorRequest(request apicontract.AIEditorChatRequest) aiEditorChatReq {
	result := aiEditorChatReq{TaskID: request.TaskID, IDs: request.IDs, Input: request.Input, Action: request.Action}
	if request.History != nil {
		result.History = make([]model.AIEditorMessage, len(request.History))
		for i, item := range request.History {
			result.History[i] = model.AIEditorMessage(item)
		}
	}
	return result
}

func aiAgentRequest(request apicontract.AIAgentChatRequest) (result agentChatReq, err error) {
	encoded, err := json.Marshal(request)
	if err == nil {
		err = json.Unmarshal(encoded, &result)
	}
	return
}

func aiSessionContract(fields map[string]any) (*apicontract.AISession, error) {
	if fields == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	result := &apicontract.AISession{}
	err = json.Unmarshal(encoded, result)
	return result, err
}

func aiEditorActionsContract(values []*model.AIEditorAction) []*apicontract.AIEditorAction {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.AIEditorAction, len(values))
	for i, value := range values {
		result[i] = (*apicontract.AIEditorAction)(value)
	}
	return result
}
func aiMCPStatusContract(values []mcpclient.MCPStatusItem) []apicontract.AIMCPStatus {
	if values == nil {
		return nil
	}
	result := make([]apicontract.AIMCPStatus, len(values))
	for i, value := range values {
		result[i] = apicontract.AIMCPStatus(value)
	}
	return result
}
func aiSkillsContract(values []util.SkillInfo) []apicontract.AISkillInfo {
	if values == nil {
		return nil
	}
	result := make([]apicontract.AISkillInfo, len(values))
	for i, value := range values {
		result[i] = apicontract.AISkillInfo(value)
	}
	return result
}
func aiUserSkillsContract(values []util.UserSkillInfo) []apicontract.AIUserSkillInfo {
	if values == nil {
		return nil
	}
	result := make([]apicontract.AIUserSkillInfo, len(values))
	for i, value := range values {
		result[i] = apicontract.AIUserSkillInfo(value)
	}
	return result
}
func aiSessionListContract(value *agent.SessionListResult) apicontract.AISessionList {
	result := apicontract.AISessionList{Total: value.Total, Page: value.Page, PageSize: value.PageSize}
	if value.Sessions != nil {
		result.Sessions = make([]*apicontract.AISessionIndex, len(value.Sessions))
		for i, item := range value.Sessions {
			result.Sessions[i] = (*apicontract.AISessionIndex)(item)
		}
	}
	return result
}
func aiCapabilityManifestsContract(values []tools.CapabilityManifest) []apicontract.AICapabilityManifest {
	if values == nil {
		return nil
	}
	result := make([]apicontract.AICapabilityManifest, len(values))
	for i, value := range values {
		item := apicontract.AICapabilityManifest{ID: value.ID, Name: value.Name, Title: value.Title, Description: value.Description, Source: value.Source, OwnerID: value.OwnerID, OwnerName: value.OwnerName, Runtime: value.Runtime, AgentOnly: value.AgentOnly, Effects: apicontract.AIToolEffects(value.Effects), Available: value.Available}
		if value.Actions != nil {
			item.Actions = make([]apicontract.AICapabilityAction, len(value.Actions))
			for j, action := range value.Actions {
				item.Actions[j] = apicontract.AICapabilityAction{Name: action.Name, Effects: apicontract.AIToolEffects(action.Effects)}
			}
		}
		result[i] = item
	}
	return result
}
