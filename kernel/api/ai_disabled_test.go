package api

import (
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAIDisabled(t *testing.T) {
	aiContractConfiguration(t)
	previousWorkingDir := util.WorkingDir
	t.Cleanup(func() { util.WorkingDir = previousWorkingDir })
	util.WorkingDir = filepath.Join("..", "..", "app")
	model.Conf.Lang = "en"
	previous := util.DisabledFeatures
	t.Cleanup(func() { util.DisabledFeatures = previous })
	util.DisabledFeatures = []string{"ai"}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	for path, handler := range map[string]gin.HandlerFunc{
		"/api/ai/chatGPT":            chatGPT,
		"/api/ai/editor/chat":        aiEditorChat,
		"/api/ai/agent/chat":         agentChat,
		"/api/ai/testModel":          testModel,
		"/api/ai/testEmbeddingModel": testEmbeddingModel,
		"/api/ai/testRerankModel":    testRerankModel,
		"/api/ai/testDecisionModel":  testDecisionModel,
		"/api/ai/listModels":         listModels,
		"/api/ai/mcpOAuthAuthorize":  mcpOAuthAuthorize,
		"/api/ai/reindexEmbedding":   reindexEmbedding,
		"/api/ai/agent/saveSession":  saveSession,
		"/api/ai/agent/manageSkills": manageSkills,
		"/api/setting/setAI":         setAI,
	} {
		engine.POST(path, handler)
		request := httptest.NewRequest("POST", path, nil)
		request.Body = aiUnreadBody{t: t}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"code":-1`) || !strings.Contains(recorder.Body.String(), "Currently unavailable") {
			t.Fatalf("%s: %d %s", path, recorder.Code, recorder.Body.String())
		}
		if err := bundle.ValidateErrorResponse("POST", path, recorder.Body.Bytes()); err != nil {
			t.Fatalf("%s: %s", path, err)
		}
	}
	engine.GET("/api/ai/mcp/oauth/callback/:flowID", mcpOAuthCallback)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/api/ai/mcp/oauth/callback/test", nil))
	if recorder.Code != 403 {
		t.Fatalf("OAuth callback was not disabled: %d", recorder.Code)
	}
	if err := bundle.ValidateHTTPResponse("GET", "/api/ai/mcp/oauth/callback/:flowID", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
		t.Fatal(err)
	}

	// 其他功能开关不影响 AI 接口，移除渠道限制后恢复原有响应。
	util.DisabledFeatures = []string{"bazaar"}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/testModel", strings.NewReader("{")))
	if strings.Contains(recorder.Body.String(), "Currently unavailable") {
		t.Fatal("AI remains disabled without the AI feature flag")
	}
}
