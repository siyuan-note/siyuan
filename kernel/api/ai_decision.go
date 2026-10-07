package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var testDecisionModel = contractHandler(apicontract.AITestDecisionModel, testDecisionModelContract)

// testDecisionModelContract 使用固定样例测试，不读取笔记或保存草稿。
func testDecisionModelContract(c *gin.Context, request apicontract.AIDecisionTestRequest) apicontract.Response[apicontract.AIDecisionTestData] {
	var decision *conf.Decision
	if request.HasDraft() {
		if request.Provider == "" || request.Profile == nil {
			message := "decision draft requires provider and complete profile"
			return apicontract.Success(apicontract.AIDecisionTestData{Msg: &message})
		}
		profile := request.Profile
		decision = &conf.Decision{Provider: request.Provider, Profiles: map[string]*conf.DecisionProfile{request.Provider: {Endpoint: profile.Endpoint, APIKey: profile.APIKey, Name: profile.Name, Timeout: profile.Timeout}}}
	} else {
		settingMutationMu.Lock()
		if model.Conf.AI != nil {
			decision = model.Conf.AI.Decision.Clone()
		}
		settingMutationMu.Unlock()
	}
	options, err := decision.ActiveOptions()
	if err == nil {
		_, err = util.EvaluateDecision(c.Request.Context(), options, util.DecisionState{Text: "The sky is blue."}, map[string]util.DecisionQuestion{
			"sample":   {Type: "noul", Instructions: "Does the text mention a color?"},
			"category": {Type: "choice", Instructions: "What does the text describe?", Criteria: json.RawMessage(`{"sky":"The sky","sea":"The sea"}`)},
			"rating":   {Type: "score", Instructions: "How clearly does the text describe a color?", Criteria: json.RawMessage(`["No color mentioned","A color is explicitly mentioned"]`)},
		})
	}
	result := apicontract.AIDecisionTestData{Matched: err == nil}
	if err != nil {
		message := err.Error()
		result.Msg = &message
	}
	return apicontract.Success(result)
}
