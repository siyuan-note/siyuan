package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var testDecisionModel = contractHandler(apicontract.AITestDecisionModel, testDecisionModelContract)

// testDecisionModelContract 使用固定样例测试已保存配置，允许在启用前测试，不读取笔记内容。
func testDecisionModelContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.AIDecisionTestData] {
	decision := model.Conf.AI.Decision
	if !decision.Configured() {
		message := "decision model not configured"
		return apicontract.Success(apicontract.AIDecisionTestData{Msg: &message})
	}
	_, err := util.EvaluateDecision(c.Request.Context(), util.DecisionOptions{
		Endpoint: decision.Endpoint, APIKey: decision.APIKey, Model: decision.Name, Timeout: decision.Timeout,
	}, util.DecisionState{Text: "The sky is blue."}, map[string]util.DecisionQuestion{
		"sample": {Type: "noul", Instructions: "Does the text mention a color?"},
	})
	result := apicontract.AIDecisionTestData{Matched: err == nil}
	if err != nil {
		message := err.Error()
		result.Msg = &message
	}
	return apicontract.Success(result)
}
