// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

const maxCapabilityModelNameLen = 64

// FrontendCapability 描述当前浏览器实例可执行的 Agent 能力。处理函数保留在浏览器中，
// 内核只接收声明并在执行时通过 SSE 将调用分发回发起会话的实例。
type FrontendCapability struct {
	ID            string                       `json:"id"`
	Title         string                       `json:"title,omitempty"`
	Description   string                       `json:"description"`
	InputSchema   tools.ToolSchema             `json:"inputSchema"`
	OutputSchema  *tools.ToolSchema            `json:"outputSchema,omitempty"`
	Source        string                       `json:"source"`
	OwnerID       string                       `json:"ownerId,omitempty"`
	OwnerName     string                       `json:"ownerName,omitempty"`
	Effects       *tools.ToolEffects           `json:"effects,omitempty"`
	ActionEffects map[string]tools.ToolEffects `json:"actionEffects,omitempty"`
	Generation    uint64                       `json:"generation"`
}

type capabilityRegistration struct {
	ID              string
	ModelName       string
	Title           string
	Description     string
	Source          string
	OwnerID         string
	OwnerName       string
	Runtime         string
	Effects         tools.ToolEffects
	EffectsDeclared bool
	ActionEffects   map[string]tools.ToolEffects
	Generation      uint64
	Tool            *tools.Tool
	Validator       *tools.ToolValidator
	InputSchema     tools.ToolSchema
	OutputSchema    *tools.ToolSchema
	AccessContext   capabilityAccessContext
}

// capabilityAccessContext 保留授权决策所需的稳定上下文，后续可在不改变调用链的前提下增加笔记本级规则。
type capabilityAccessContext struct {
	SessionID  string
	NotebookID string
	DocumentID string
	Arguments  map[string]any
}

type capabilityAuthorizer interface {
	Allows(id string, context capabilityAccessContext) bool
}

type configCapabilityAuthorizer struct{}

func (configCapabilityAuthorizer) Allows(id string, _ capabilityAccessContext) bool {
	if kernelModel.Conf == nil || kernelModel.Conf.AI == nil || kernelModel.Conf.AI.Agent == nil {
		return true
	}
	return kernelModel.Conf.AI.Agent.CapabilityPolicy.Allows(id)
}

var currentCapabilityAuthorizer capabilityAuthorizer = configCapabilityAuthorizer{}

type capabilityApprover interface {
	Decision(id, action string, context capabilityAccessContext) string
}

type configCapabilityApprover struct{}

func (configCapabilityApprover) Decision(id, action string, _ capabilityAccessContext) string {
	if kernelModel.Conf == nil || kernelModel.Conf.AI == nil || kernelModel.Conf.AI.Agent == nil {
		return conf.ApprovalDecisionRisk
	}
	return kernelModel.Conf.AI.Agent.ApprovalPolicy.Decision(id, action)
}

var currentCapabilityApprover capabilityApprover = configCapabilityApprover{}

func capabilityApprovalDecision(registration *capabilityRegistration, action string, args map[string]any) string {
	if registration == nil {
		return conf.ApprovalDecisionRisk
	}
	accessContext := registration.AccessContext
	accessContext.Arguments = args
	return currentCapabilityApprover.Decision(registration.ID, action, accessContext)
}

func (registration *capabilityRegistration) isBrowser() bool {
	return registration != nil && registration.Runtime == "browser"
}

func (registration *capabilityRegistration) browserEffectsFor(action string) (tools.ToolEffects, bool) {
	if registration == nil || !registration.isBrowser() {
		return tools.ToolEffects{}, false
	}
	if effects, ok := registration.ActionEffects[action]; ok {
		return effects, true
	}
	return registration.Effects, registration.EffectsDeclared
}

type capabilitySet struct {
	definitions   []openai.Tool
	registrations map[string]*capabilityRegistration
	ids           map[string]*capabilityRegistration
}

func (set *capabilitySet) registration(modelName string) *capabilityRegistration {
	if set == nil {
		return nil
	}
	return set.registrations[modelName]
}

func (set *capabilitySet) hasModelName(modelName string) bool {
	return set != nil && set.registrations[modelName] != nil
}

func filterSystemPromptByCapabilities(prompt string, set *capabilitySet) string {
	if set == nil {
		return prompt
	}
	allTools := tools.GetAllTools()
	lines := strings.Split(prompt, "\n")
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		allowed := true
		for _, tool := range allTools {
			if set.hasModelName(tool.Name) {
				continue
			}
			if strings.Contains(line, tool.Name+".") ||
				strings.Contains(line, tool.Name+" tool") ||
				strings.Contains(line, tool.Name+" tools") ||
				strings.Contains(line, "\""+tool.Name+"\"") {
				allowed = false
				break
			}
		}
		if allowed {
			filtered = append(filtered, line)
		}
	}
	return strings.Join(filtered, "\n")
}

func capabilityAllowed(id string, context capabilityAccessContext) bool {
	return currentCapabilityAuthorizer.Allows(id, context)
}

func capabilityOwnerAvailable(source, runtime, ownerID string) bool {
	if source != "mcp" && runtime != "mcp" {
		return true
	}
	if ownerID == "" {
		return true
	}
	if kernelModel.Conf == nil || kernelModel.Conf.AI == nil || kernelModel.Conf.AI.MCP == nil {
		return false
	}
	for _, server := range kernelModel.Conf.AI.MCP.Servers {
		if server.ID == ownerID {
			return server.Enabled
		}
	}
	return false
}

func buildCapabilitySet(frontendCapabilities []FrontendCapability, accessContext capabilityAccessContext) (*capabilitySet, error) {
	set := &capabilitySet{
		registrations: map[string]*capabilityRegistration{},
		ids:           map[string]*capabilityRegistration{},
	}
	for _, tool := range tools.GetAllTools() {
		id := tools.CapabilityIDForTool(tool)
		runtime := tool.Runtime
		if runtime == "" {
			runtime = "kernel"
		}
		source := tool.Source
		if source == "" {
			source = "native"
		}
		if id == "" || !capabilityOwnerAvailable(source, runtime, tool.OwnerID) ||
			!capabilityAllowed(id, accessContext) {
			continue
		}
		registered, validator := tools.LookupToolWithValidator(tool.Name)
		if registered != tool || validator == nil {
			continue
		}
		registration := &capabilityRegistration{
			ID:            id,
			ModelName:     tool.Name,
			Title:         tool.Title,
			Description:   tool.Description,
			Source:        source,
			OwnerID:       tool.OwnerID,
			OwnerName:     tool.OwnerName,
			Runtime:       runtime,
			Tool:          tool,
			Validator:     validator,
			InputSchema:   tool.InputSchema,
			OutputSchema:  tool.OutputSchema,
			AccessContext: accessContext,
		}
		if err := set.add(registration); err != nil {
			return nil, err
		}
	}

	for _, frontend := range frontendCapabilities {
		if !validFrontendCapabilityID(frontend.ID) {
			return nil, fmt.Errorf("invalid frontend capability ID: %s", frontend.ID)
		}
		if strings.TrimSpace(frontend.Description) == "" {
			return nil, fmt.Errorf("frontend capability description is required: %s", frontend.ID)
		}
		if !capabilityAllowed(frontend.ID, accessContext) {
			continue
		}
		validationTool := &tools.Tool{
			Name:         frontendCapabilityModelName(frontend.ID),
			Description:  frontend.Description,
			InputSchema:  frontend.InputSchema,
			OutputSchema: frontend.OutputSchema,
		}
		validator, err := tools.CompileToolValidator(validationTool)
		if err != nil {
			return nil, fmt.Errorf("invalid frontend capability [%s]: %w", frontend.ID, err)
		}
		source := "native"
		if strings.HasPrefix(frontend.ID, "plugin/frontend/") {
			source = "plugin"
		}
		effects := tools.ToolEffects{}
		if frontend.Effects != nil {
			effects = *frontend.Effects
		}
		registration := &capabilityRegistration{
			ID:              frontend.ID,
			ModelName:       validationTool.Name,
			Title:           frontend.Title,
			Description:     frontend.Description,
			Source:          source,
			OwnerID:         frontend.OwnerID,
			OwnerName:       frontend.OwnerName,
			Runtime:         "browser",
			Effects:         effects,
			EffectsDeclared: frontend.Effects != nil,
			ActionEffects:   frontend.ActionEffects,
			Generation:      frontend.Generation,
			Validator:       validator,
			InputSchema:     frontend.InputSchema,
			OutputSchema:    frontend.OutputSchema,
			AccessContext:   accessContext,
		}
		if err := set.add(registration); err != nil {
			return nil, err
		}
	}

	sort.Slice(set.definitions, func(i, j int) bool {
		return set.definitions[i].Function.Name < set.definitions[j].Function.Name
	})
	return set, nil
}

func (set *capabilitySet) add(registration *capabilityRegistration) error {
	if set.registrations == nil {
		set.registrations = map[string]*capabilityRegistration{}
	}
	if set.ids == nil {
		set.ids = map[string]*capabilityRegistration{}
	}
	if previous := set.ids[registration.ID]; previous != nil {
		return fmt.Errorf("capability ID collision [%s]: %s and %s",
			registration.ID, previous.ModelName, registration.ModelName)
	}
	if previous := set.registrations[registration.ModelName]; previous != nil {
		return fmt.Errorf("capability model name collision [%s]: %s and %s",
			registration.ModelName, previous.ID, registration.ID)
	}
	set.ids[registration.ID] = registration
	set.registrations[registration.ModelName] = registration
	set.definitions = append(set.definitions, openai.Tool{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        registration.ModelName,
			Description: registration.Description,
			Parameters:  convertSchema(registration.InputSchema),
		},
	})
	return nil
}

func validFrontendCapabilityID(id string) bool {
	if len(id) > 512 {
		return false
	}
	parts := strings.Split(id, "/")
	if len(parts) == 3 {
		return parts[0] == "native" && parts[1] == "frontend" && parts[2] != ""
	}
	if len(parts) == 4 {
		return parts[0] == "plugin" && parts[1] == "frontend" && parts[2] != "" && parts[3] != ""
	}
	return false
}

func frontendCapabilityModelName(id string) string {
	var builder strings.Builder
	builder.WriteString("frontend__")
	for _, char := range id {
		if char <= unicode.MaxASCII && (unicode.IsLetter(char) || unicode.IsDigit(char) || char == '_' || char == '-') {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('_')
		}
	}
	hash := sha256.Sum256([]byte(id))
	suffix := fmt.Sprintf("__%x", hash[:6])
	name := builder.String()
	if len(name) > maxCapabilityModelNameLen-len(suffix) {
		name = name[:maxCapabilityModelNameLen-len(suffix)]
	}
	return name + suffix
}

func capabilityStillExecutable(registration *capabilityRegistration, args map[string]any) bool {
	if registration == nil {
		return false
	}
	accessContext := registration.AccessContext
	accessContext.Arguments = args
	ownerID := registration.OwnerID
	if ownerID == "" && registration.Tool != nil {
		ownerID = registration.Tool.OwnerID
	}
	if !capabilityOwnerAvailable(registration.Source, registration.Runtime, ownerID) ||
		!capabilityAllowed(registration.ID, accessContext) {
		return false
	}
	if registration.isBrowser() {
		return true
	}
	current, validator := tools.LookupToolWithValidator(registration.ModelName)
	return current != nil && current == registration.Tool && validator == registration.Validator
}
