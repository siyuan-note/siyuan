package tools

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"strings"
)

func isPluginProjectAction(action string) bool {
	switch action {
	case "prepare_project", "project_status", "restore_project", "package_local":
		return true
	}
	return false
}

func bazaarProjectJSON(value any) (CallToolResult, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return blockToolError(err.Error())
	}
	if len(data) >= util.MaxToolOutputChars {
		return blockToolError("too_large: project status exceeds the safe tool output budget; reduce the approved inventory")
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(data)}}, StructuredContent: value, StructuredContentSet: true}, nil
}

// 部分替换或写后校验失败必须明确标记结果未知，不能被当成完全未执行的普通错误。
func bazaarProjectError(err error, partial any) (CallToolResult, error) {
	if err == nil {
		return bazaarProjectJSON(partial)
	}
	unknown := strings.Contains(err.Error(), "result_unknown")
	if partial == nil && !unknown {
		return blockToolError(err.Error())
	}
	data, marshalErr := json.Marshal(map[string]any{"error": err.Error(), "resultUnknown": unknown, "partialResult": partial, "nextStep": "Inspect the current project or installed revision before retrying; retained recovery files have not been removed."})
	if marshalErr != nil {
		return blockToolError(err.Error())
	}
	if len(data) >= util.MaxToolOutputChars {
		data, _ = json.Marshal(map[string]any{"error": "operation failed; inspect project status and retained recovery points for details", "resultUnknown": unknown, "detailsTruncated": true})
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(data)}}, IsError: true, ExecutionUnknown: unknown}, nil
}

func bazaarPluginProjectAction(ctx context.Context, action string, args map[string]any) (CallToolResult, error) {
	taskID, _ := args["taskId"].(string)
	grant, err := util.RequirePluginDevelopment(ctx, "read")
	if err != nil {
		return bazaarProjectError(err, nil)
	}
	if taskID == "" || taskID != grant.TaskID {
		return blockToolError("taskId must match the current trusted plugin development task")
	}
	expected, _ := args["expectedSourceRevision"].(string)
	sourcePath, _ := args["sourcePath"].(string)
	if sourcePath != "" && action != "project_status" {
		return blockToolError("sourcePath is only supported for read-only project_status; prepare uses the approved source")
	}
	var result any
	switch action {
	case "prepare_project":
		result, err = util.PreparePluginProject(ctx, taskID, authorizeFinalPath, expected)
	case "project_status":
		if sourcePath != "" {
			var abs string
			abs, err = resolvePath(sourcePath)
			if err == nil {
				if raw, found := args["sourceFiles"]; found {
					encoded, encodeErr := json.Marshal(raw)
					var selected []string
					if encodeErr != nil || json.Unmarshal(encoded, &selected) != nil {
						return blockToolError("sourceFiles must be a list of relative file paths")
					}
					result, err = util.InspectPluginProjectSource(abs, authorizeFinalPath, selected)
				} else {
					result, err = util.InspectPluginProjectSource(abs, authorizeFinalPath)
				}
			}
		} else {
			result, err = util.GetPluginProjectStatus(ctx, taskID)
		}
	case "restore_project":
		result, err = util.RestorePluginProject(ctx, taskID, expected)
	case "package_local":
		result, err = bazaar.PackagePluginProject(ctx, taskID, expected)
	default:
		err = errors.New("unsupported project action")
	}
	if err != nil {
		return bazaarProjectError(err, result)
	}
	payload := map[string]any{"project": result}
	if grant.PackageName != "" {
		revision, revisionErr := model.GetInstalledBazaarPackageRevision("plugins", grant.PackageName)
		if revisionErr == nil {
			payload["installedRevision"] = revision
		} else {
			payload["installedRevisionError"] = revisionErr.Error()
		}
	}
	return bazaarProjectJSON(payload)
}
