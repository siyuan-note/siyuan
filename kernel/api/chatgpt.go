package api

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/chatgpt"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func chatGPTAccountValue(profile chatgpt.Profile) apicontract.ChatGPTAccount {
	return apicontract.ChatGPTAccount{ID: profile.ID, Email: profile.Email, Name: profile.Name, Connected: profile.Connected, Sharing: profile.Sharing}
}

func chatGPTNoCache(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
}

var chatGPTAccounts = contractHandler(apicontract.ChatGPTAccounts, chatGPTAccountsContract)

func chatGPTAccountsContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[[]apicontract.ChatGPTAccount] {
	chatGPTNoCache(c)
	profiles, err := util.ChatGPTService().Profiles(c.Request.Context())
	if err != nil {
		return apicontract.Failure[[]apicontract.ChatGPTAccount](-1, err.Error())
	}
	result := make([]apicontract.ChatGPTAccount, 0, len(profiles))
	for _, p := range profiles {
		result = append(result, chatGPTAccountValue(p))
	}
	return apicontract.Success(result)
}

var chatGPTStart = contractHandler(apicontract.ChatGPTStart, chatGPTStartContract)

func chatGPTStartContract(c *gin.Context, req apicontract.ChatGPTAccountRequest) apicontract.Response[apicontract.ChatGPTLogin] {
	chatGPTNoCache(c)
	login, err := util.ChatGPTService().Start(c.Request.Context(), req.AccountID, util.I18nTerm(model.Conf.Lang, "chatGPTCallbackTip"))
	if err != nil {
		return apicontract.Failure[apicontract.ChatGPTLogin](-1, err.Error())
	}
	return apicontract.Success(apicontract.ChatGPTLogin{ID: login.ID, URL: login.URL})
}

var chatGPTStatus = contractHandler(apicontract.ChatGPTStatus, chatGPTStatusContract)

func chatGPTStatusContract(c *gin.Context, req apicontract.ChatGPTLoginRequest) apicontract.Response[apicontract.ChatGPTLoginStatus] {
	chatGPTNoCache(c)
	status, err := util.ChatGPTService().Status(req.ID)
	if err != nil {
		return apicontract.Failure[apicontract.ChatGPTLoginStatus](-1, err.Error())
	}
	return apicontract.Success(apicontract.ChatGPTLoginStatus{State: status.State, AccountID: status.AccountID, Error: status.Error})
}

var chatGPTCancel = contractHandler(apicontract.ChatGPTCancel, chatGPTCancelContract)

func chatGPTCancelContract(c *gin.Context, req apicontract.ChatGPTLoginRequest) apicontract.Response[apicontract.Null] {
	util.ChatGPTService().Cancel(req.ID)
	return apicontract.Success(apicontract.Null{})
}

var chatGPTLogout = contractHandler(apicontract.ChatGPTLogout, chatGPTLogoutContract)

func chatGPTLogoutContract(c *gin.Context, req apicontract.ChatGPTAccountRequest) apicontract.Response[apicontract.ChatGPTLogoutResult] {
	chatGPTNoCache(c)
	revoked, err := util.ChatGPTService().Logout(c.Request.Context(), req.AccountID)
	if err != nil {
		return apicontract.Failure[apicontract.ChatGPTLogoutResult](-1, err.Error())
	}
	return apicontract.Success(apicontract.ChatGPTLogoutResult{Revoked: revoked})
}

var chatGPTExport = contractHandler(apicontract.ChatGPTExport, chatGPTExportContract)

func chatGPTExportContract(c *gin.Context, req apicontract.ChatGPTTransferRequest) apicontract.Response[apicontract.ExportFileData] {
	chatGPTNoCache(c)
	name := "chatgpt-" + gulu.Rand.String(16) + ".siyuan-chatgpt.json"
	dir := filepath.Join(util.TempDir, "export")
	_, err := util.ChatGPTService().Export(c.Request.Context(), req.AccountID, req.Password, func(data string) error {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dir, name), []byte(data), 0600)
	})
	if err != nil {
		return apicontract.Failure[apicontract.ExportFileData](-1, err.Error())
	}
	return apicontract.Success(apicontract.ExportFileData{File: "/export/" + name})
}

var chatGPTImport = contractHandler(apicontract.ChatGPTImport, chatGPTImportContract)

func chatGPTImportContract(c *gin.Context, req apicontract.ChatGPTTransferRequest) apicontract.Response[apicontract.ChatGPTAccount] {
	chatGPTNoCache(c)
	profile, err := util.ChatGPTService().Import(c.Request.Context(), req.Data, req.Password)
	if err != nil {
		return apicontract.Failure[apicontract.ChatGPTAccount](-1, err.Error())
	}
	return apicontract.Success(chatGPTAccountValue(profile))
}

func testChatGPTModel(ctx context.Context, provider *conf.Provider, name string) (available []string, matched bool, err error) {
	timeout := provider.RequestTimeout
	if timeout < 1 {
		timeout = 30
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	models, err := util.ChatGPTService().Models(ctx, provider.AccountID)
	if err != nil {
		return []string{}, false, err
	}
	for _, m := range models {
		available = append(available, m.ID)
	}
	client := util.NewChatGPTClient(provider.AccountID)
	ctx = util.ContextWithOpenAIResponsesBaseURL(ctx, chatgpt.Resource)
	stream, err := util.CreateOpenAICompletionStream(ctx, client, util.OpenAIProtocolResponses,
		openai.ChatCompletionRequest{Model: name, Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "Say OK"}}}, nil)
	if err != nil {
		return available, false, err
	}
	defer stream.Close()
	for {
		_, err = stream.Recv()
		if errors.Is(err, io.EOF) {
			return available, true, nil
		}
		if err != nil {
			return available, false, err
		}
	}
}
