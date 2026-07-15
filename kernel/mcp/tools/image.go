// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package tools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ImageTool = &Tool{
	Name:  "image",
	Title: "Document images",
	Description: "List and understand local images referenced by a SiYuan document, or generate an image asset. " +
		"Use list before analyze. analyze sends the selected image to the configured vision provider. " +
		"generate creates a reusable image asset in the target document's notebook.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":       {Type: "string", Enum: []string{"list", "analyze", "generate"}},
			"documentID":   {Type: "string", Description: "Document or descendant block ID used to resolve the target document and notebook"},
			"assetPath":    {Type: "string", Description: "Local assets/... path returned by list; required for analyze"},
			"question":     {Type: "string", Description: "Question for the vision model"},
			"detail":       {Type: "string", Enum: []string{"auto", "low", "high"}},
			"prompt":       {Type: "string", Description: "Prompt describing the image to generate"},
			"size":         {Type: "string", Description: "Provider-supported image size, such as 1024x1024"},
			"quality":      {Type: "string", Description: "Provider-supported image quality"},
			"outputFormat": {Type: "string", Enum: []string{"png", "jpeg", "webp"}},
		},
		Required: []string{"action", "documentID"},
	},
	EffectScope: EffectScopeMixed,
	ActionEffects: map[string]ToolEffects{
		"list":     {LocalRead: true},
		"analyze":  {LocalRead: true, DataEgress: true, ExternalCost: true},
		"generate": {LocalWrite: true, DataEgress: true, ExternalCost: true},
	},
	ContextHandler: imageHandler,
}

type imageOperation struct {
	done   chan struct{}
	result CallToolResult
}

type imageOperationMeta struct {
	Action     string
	DocumentID string
	AssetPath  string
}

type imageOperationRecord struct {
	Version    int            `json:"version"`
	CreatedAt  int64          `json:"createdAt"`
	State      string         `json:"state"`
	Action     string         `json:"action"`
	DocumentID string         `json:"documentId"`
	AssetPath  string         `json:"assetPath"`
	Result     CallToolResult `json:"result"`
}

const imageOperationRecordTTL = 24 * time.Hour

const (
	imageOperationStateRunning   = "running"
	imageOperationStateCompleted = "completed"
)

var imageOperations sync.Map

func init() {
	register(ImageTool)
}

func imageHandler(ctx context.Context, args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	documentID, _ := args["documentID"].(string)
	if strings.TrimSpace(documentID) == "" {
		return imageError("documentID is required"), nil
	}
	switch action {
	case "list":
		return imageList(documentID), nil
	case "analyze":
		assetPath, _ := args["assetPath"].(string)
		meta := imageOperationMeta{Action: action, DocumentID: documentID, AssetPath: assetPath}
		return runImageOperation(ctx, imageOperationKey(args, action), meta, func() CallToolResult {
			return imageAnalyze(ctx, documentID, args)
		}), nil
	case "generate":
		meta := imageOperationMeta{Action: action, DocumentID: documentID}
		return runImageOperation(ctx, imageOperationKey(args, action), meta, func() CallToolResult {
			return imageGenerate(ctx, documentID, args)
		}), nil
	default:
		return imageError("unknown image action: " + action), nil
	}
}

func imageList(documentID string) CallToolResult {
	result, err := model.ListDocumentImages(documentID)
	if err != nil {
		return imageError(err.Error())
	}
	return imageJSON(result)
}

func imageAnalyze(ctx context.Context, documentID string, args map[string]any) CallToolResult {
	assetPath, _ := args["assetPath"].(string)
	question, _ := args["question"].(string)
	detail, _ := args["detail"].(string)
	result, err := model.AnalyzeDocumentImage(ctx, model.AnalyzeDocumentImageRequest{
		DocumentID: documentID,
		AssetPath:  assetPath,
		Question:   question,
		Detail:     detail,
	})
	if err != nil {
		return imageResultForError(err)
	}
	return imageJSON(result)
}

func imageGenerate(ctx context.Context, documentID string, args map[string]any) CallToolResult {
	prompt, _ := args["prompt"].(string)
	size, _ := args["size"].(string)
	quality, _ := args["quality"].(string)
	outputFormat, _ := args["outputFormat"].(string)
	result, err := model.GenerateDocumentImage(ctx, model.GenerateDocumentImageRequest{
		DocumentID:   documentID,
		Prompt:       prompt,
		Size:         size,
		Quality:      quality,
		OutputFormat: outputFormat,
	})
	if err != nil {
		return imageResultForError(err)
	}
	operationID := imageOperationKey(args, "generate")
	return imageJSON(map[string]any{
		"operationId":   operationID,
		"artifact":      result.Artifact,
		"revisedPrompt": result.RevisedPrompt,
	})
}

func imageOperationKey(args map[string]any, action string) string {
	sessionID, _ := args["_sessionID"].(string)
	toolCallID, _ := args["_toolCallID"].(string)
	if sessionID == "" || toolCallID == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(sessionID + "\x00" + toolCallID + "\x00" + action))
	return hex.EncodeToString(digest[:])
}

func runImageOperation(ctx context.Context, key string, meta imageOperationMeta, execute func() CallToolResult) CallToolResult {
	if key == "" {
		return execute()
	}
	if result, ok := loadImageOperationRecord(key, meta); ok {
		return result
	}
	operation := &imageOperation{done: make(chan struct{})}
	actual, loaded := imageOperations.LoadOrStore(key, operation)
	if loaded {
		operation = actual.(*imageOperation)
		select {
		case <-operation.done:
			return operation.result
		case <-ctx.Done():
			return imageError("image operation was cancelled")
		}
	}
	if err := saveImageOperationRecord(key, meta, imageOperationStateRunning, CallToolResult{}); err != nil {
		operation.result = imageError("prepare image operation record failed: " + err.Error())
		close(operation.done)
		imageOperations.Delete(key)
		return operation.result
	}
	operation.result = execute()
	if operation.result.ExecutionUnknown {
		// running 记录表示外部请求可能已经执行，保留它以阻止恢复流程自动重试。
	} else if operation.result.IsError {
		removeImageOperationRecord(key)
	} else if err := saveImageOperationRecord(key, meta, imageOperationStateCompleted, operation.result); err != nil {
		logging.LogWarnf("save image operation [%s] failed: %s", key, err)
	}
	close(operation.done)
	if operation.result.IsError {
		imageOperations.Delete(key)
	} else {
		time.AfterFunc(30*time.Minute, func() { imageOperations.Delete(key) })
	}
	return operation.result
}

func imageOperationRecordPath(key string) string {
	return filepath.Join(util.DataDir, "storage", "ai", "agent", "operations", "image", key+".json")
}

func validImageOperationKey(key string) bool {
	if len(key) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(key)
	return err == nil
}

func loadImageOperationRecord(key string, meta imageOperationMeta) (CallToolResult, bool) {
	if !validImageOperationKey(key) {
		return CallToolResult{}, false
	}
	path := imageOperationRecordPath(key)
	data, err := os.ReadFile(path)
	if err != nil {
		return CallToolResult{}, false
	}
	record := imageOperationRecord{}
	if err = json.Unmarshal(data, &record); err != nil || record.Version != 1 || record.Action != meta.Action || record.DocumentID != meta.DocumentID ||
		time.Since(time.UnixMilli(record.CreatedAt)) > imageOperationRecordTTL {
		removeImageOperationRecord(key)
		return CallToolResult{}, false
	}
	if meta.AssetPath != "" && record.AssetPath != meta.AssetPath {
		removeImageOperationRecord(key)
		return CallToolResult{}, false
	}
	if record.State == imageOperationStateRunning {
		return imageUnknown("a previous image operation was interrupted; its external result is unknown and it must not be retried automatically"), true
	}
	if record.State != imageOperationStateCompleted || record.Result.IsError {
		removeImageOperationRecord(key)
		return CallToolResult{}, false
	}
	if record.AssetPath != "" && !imageOperationAssetExists(record.DocumentID, record.AssetPath) {
		removeImageOperationRecord(key)
		return CallToolResult{}, false
	}
	return record.Result, true
}

func saveImageOperationRecord(key string, meta imageOperationMeta, state string, result CallToolResult) error {
	if !validImageOperationKey(key) {
		return errors.New("invalid image operation key")
	}
	assetPath := meta.AssetPath
	if state == imageOperationStateCompleted {
		if resultPath := imageResultAssetPath(result); resultPath != "" {
			assetPath = resultPath
		}
	}
	if state != imageOperationStateRunning && state != imageOperationStateCompleted {
		return errors.New("invalid image operation state")
	}
	record := imageOperationRecord{
		Version: 1, CreatedAt: time.Now().UnixMilli(), State: state, Action: meta.Action, DocumentID: meta.DocumentID,
		AssetPath: assetPath, Result: result,
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	path := imageOperationRecordPath(key)
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return filelock.WriteFile(path, data)
}

func removeImageOperationRecord(key string) {
	if !validImageOperationKey(key) {
		return
	}
	_ = filelock.RemoveWithoutFatal(imageOperationRecordPath(key))
}

func imageResultAssetPath(result CallToolResult) string {
	if len(result.Content) == 0 || result.Content[0].Text == "" {
		return ""
	}
	payload := struct {
		Artifact model.ImageArtifactRef `json:"artifact"`
	}{}
	if json.Unmarshal([]byte(result.Content[0].Text), &payload) != nil {
		return ""
	}
	return payload.Artifact.Path
}

func imageOperationAssetExists(documentID, assetPath string) bool {
	bt := treenode.GetBlockTree(documentID)
	if bt == nil {
		return false
	}
	absPath, err := model.GetAssetAbsPathInBox(assetPath, bt.BoxID)
	return err == nil && filelock.IsExist(absPath)
}

func imageJSON(value any) CallToolResult {
	data, err := json.Marshal(value)
	if err != nil {
		return imageError(err.Error())
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(data)}}}
}

func imageError(message string) CallToolResult {
	if message == "" {
		message = errors.New("image operation failed").Error()
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: message}}, IsError: true}
}

func imageResultForError(err error) CallToolResult {
	if model.IsImageExecutionUnknown(err) {
		return imageUnknown(err.Error())
	}
	return imageError(err.Error())
}

func imageUnknown(message string) CallToolResult {
	result := imageError(message)
	result.ExecutionUnknown = true
	return result
}
