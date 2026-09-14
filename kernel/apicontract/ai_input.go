package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
)

func aiStructDecoder[Request, Data any](endpoint *Endpoint[Request, Data], legacyName string) {
	endpoint.decodeRequest = func(reader io.Reader) (value Request, err error) {
		err = json.NewDecoder(reader).Decode(&value)
		if err != nil {
			message := strings.ReplaceAll(err.Error(), reflect.TypeFor[Request]().Name()+".", legacyName+".")
			for _, name := range []string{"Reference", "EditorContext", "FrontendCapability", "ToolEffects"} {
				message = strings.ReplaceAll(message, "AI"+name+".", name+".")
			}
			err = fmt.Errorf("invalid request: %s", message)
		}
		return
	}
}

func (r AIProviderRequest) ProviderError() error { return r.providerError }

func aiLegacyString(fields fileTreeFields, key string, required, trim bool) (value string, err error) {
	value, err = legacyField[string](fields, key, "String", required)
	if err == nil && trim {
		value = strings.TrimSpace(value)
		if value == "" {
			err = fmt.Errorf("Field [%s] must not be empty", key)
		}
	}
	return
}

func aiJSONDecoder[Request, Data any](endpoint *Endpoint[Request, Data], bind func(fileTreeFields) (Request, error)) {
	endpoint.decodeRequest = func(reader io.Reader) (value Request, err error) {
		fields, err := fileTreeRequestFields(reader, endpoint.definition.Path)
		if err == nil {
			value, err = bind(fields)
		}
		return
	}
}

func aiProviderFields(fields fileTreeFields) AIProviderRequest {
	request := AIProviderRequest{}
	_ = json.Unmarshal(fields["provider"], &request.Provider)
	if raw := fields["providerConfig"]; len(raw) > 0 && !bytes.Equal(raw, []byte("null")) {
		value, err := legacyJSONValue[SettingProvider](raw)
		if err != nil {
			err = fmt.Errorf("%s", strings.NewReplacer("SettingProvider.", "Provider.", "SettingModel.", "Model.", "apicontract.SettingProvider", "conf.Provider", "apicontract.SettingModel", "conf.Model").Replace(err.Error()))
		}
		request.ProviderConfig = &value
		request.providerError = err
	}
	return request
}

func init() {
	aiStructDecoder(&AIEditorChat, "aiEditorChatReq")
	aiStructDecoder(&AIAgentChat, "agentChatReq")
	aiStructDecoder(&AIGetSession, "agentSessionGetReq")
	AISaveSession.decodeRequest = func(reader io.Reader) (value AISession, err error) {
		value.raw, err = io.ReadAll(reader)
		if err != nil {
			err = fmt.Errorf("failed to read body: %s", err)
		}
		return
	}
	aiStructDecoder(&AIAgentConfirm, "agentConfirmReq")
	aiStructDecoder(&AIAgentSetPermission, "agentPermissionReq")
	aiStructDecoder(&AIAgentQuestion, "agentQuestionReq")
	aiStructDecoder(&AIAgentBrowserCapabilityResult, "agentBrowserCapabilityResultReq")
	aiStructDecoder(&AIAgentTitle, "agentTitleReq")
	aiStructDecoder(&AIListSessions, "agentSessionsReq")
	aiStructDecoder(&AIRemoveSession, "agentSessionDeleteReq")
	aiStructDecoder(&AIGetSkill, "skillGetReq")
	aiStructDecoder(&AISaveSkill, "skillSaveReq")
	aiStructDecoder(&AIRemoveSkill, "skillRemoveReq")
	aiStructDecoder(&AIRenameSkill, "skillRenameReq")
	aiJSONDecoder(&AIChatGPT, func(fields fileTreeFields) (value AIMessageRequest, err error) {
		value.Msg, err = aiLegacyString(fields, "msg", true, true)
		return
	})
	fileTreeJSONDecoder(&AIChatGPTWithAction)
	aiJSONDecoder(&AISaveEditorAction, func(fields fileTreeFields) (value AIEditorActionSaveRequest, err error) {
		if value.ID, err = aiLegacyString(fields, "id", false, false); err != nil {
			return
		}
		if value.Name, err = aiLegacyString(fields, "name", true, false); err != nil {
			return
		}
		value.Action, err = aiLegacyString(fields, "action", true, false)
		return
	})
	aiJSONDecoder(&AIRemoveEditorAction, func(fields fileTreeFields) (value AIEditorActionIDRequest, err error) {
		value.ID, err = aiLegacyString(fields, "id", true, true)
		return
	})
	fileTreeJSONDecoder(&AIMCPOAuthAuthorize)
	fileTreeJSONDecoder(&AIMCPOAuthDisconnect)
	AIListModels.decodeRequest = func(reader io.Reader) (value AIProviderRequest, err error) {
		fields, err := fileTreeRequestFields(reader, AIListModels.definition.Path)
		if err == nil {
			value = aiProviderFields(fields)
		}
		return
	}
	AITestModel.decodeRequest = func(reader io.Reader) (value AIModelRequest, err error) {
		fields, err := fileTreeRequestFields(reader, AITestModel.definition.Path)
		if err != nil {
			return
		}
		model, err := aiLegacyString(fields, "model", true, true)
		if err == nil {
			value.Model = model
			value.AIProviderRequest = aiProviderFields(fields)
		}
		return
	}
}
