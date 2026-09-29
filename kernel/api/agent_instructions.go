package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getAgentInstructions = contractHandler(apicontract.AIGetAgentInstructions, getAgentInstructionsContract)
var setAgentInstructions = contractHandler(apicontract.AISetAgentInstructions, setAgentInstructionsContract)

func agentInstructionsResponse(data util.AgentInstructions, err error) apicontract.Response[apicontract.AIAgentInstructionsData] {
	if err != nil {
		return apicontract.Failure[apicontract.AIAgentInstructionsData](-1, util.EscapeHTML(util.AgentInstructionsError(err, model.Conf.Lang)))
	}
	return apicontract.Success(apicontract.AIAgentInstructionsData{Content: data.Content, Revision: data.Revision})
}

func getAgentInstructionsContract(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.AIAgentInstructionsData] {
	return agentInstructionsResponse(util.ReadAgentInstructions())
}

func setAgentInstructionsContract(c *gin.Context, request apicontract.AIAgentInstructionsSaveRequest) apicontract.Response[apicontract.AIAgentInstructionsData] {
	data, err := util.SaveAgentInstructions(request.Content, request.Revision)
	if err == nil {
		model.IncSyncIfNeeded(util.AgentInstructionsPath())
	}
	return agentInstructionsResponse(data, err)
}
