package tools

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// PluginDevelopmentInstallPreview 供宿主在原生工具确认前展示真实包身份及运行风险，不授予安装权限。
func PluginDevelopmentInstallPreview(ctx context.Context, args map[string]any) (map[string]any, error) {
	action, _ := args["action"].(string)
	if action != "install_local" && action != "restore_install" {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	expectedHash, _ := args["expectedPackageHash"].(string)
	expectedInstalled, _ := args["expectedInstalledRevision"].(string)
	frontend, _ := args["frontend"].(string)
	payload := map[string]any{"action": action, "frontend": frontend, "runtimeWarning": "Replacing or restoring plugin code may execute or reload code, or encounter code that is still running, regardless of the current enabled setting. Disabling changes configuration and sends a notification; it does not acknowledge runtime unload.", "expectedInstalledRevision": expectedInstalled}
	if action == "restore_install" {
		backupID, _ := args["backupId"].(string)
		if backupID == "" || expectedHash == "" || expectedInstalled == "" {
			return nil, errors.New("backupId, expectedPackageHash and expectedInstalledRevision are required for rollback confirmation")
		}
		backup, err := model.GetLocalBazaarInstallBackup(backupID)
		if err != nil {
			return nil, err
		}
		if backup.PackageHash != expectedHash {
			return nil, errors.New("revision_conflict: backup hash changed")
		}
		preview, err := model.PreviewLocalBazaarRestore(backupID, expectedHash)
		if err != nil {
			return nil, err
		}
		if preview.InstalledRevision != expectedInstalled {
			return nil, errors.New("revision_conflict: installed package changed before confirmation")
		}
		payload["backup"], payload["package"] = backup, preview
		payload["recoveryScope"] = "Retained plugin code only. Runtime data and other configuration are unchanged. The restored plugin is configured disabled."
		return payload, nil
	}
	archivePath, _ := args["path"].(string)
	if archivePath == "" {
		return nil, errors.New("path is required")
	}
	abs := filepath.Join(util.WorkspaceDir, filepath.FromSlash(archivePath))
	var archive string
	var err error
	managed := util.IsPluginProjectPath(abs) || bazaar.IsPluginProjectDeliveryPath(abs)
	if managed {
		if expectedHash == "" || expectedInstalled == "" {
			return nil, errors.New("managed installation requires expectedPackageHash and expectedInstalledRevision")
		}
		grant, grantErr := util.RequirePluginDevelopment(ctx, "write")
		if grantErr != nil {
			return nil, grantErr
		}
		if frontend != grant.Frontend {
			return nil, errors.New("frontend differs from the approved plugin development plan")
		}
		taskID, _ := args["taskId"].(string)
		archive, err = bazaar.ResolvePluginProjectArtifact(ctx, taskID, archivePath, expectedHash)
	} else {
		archive, err = resolvePath(archivePath)
	}
	if err != nil {
		return nil, err
	}
	preview, err := model.PreviewLocalBazaarPackage(archive, expectedHash)
	if err != nil {
		return nil, err
	}
	if expectedInstalled != "" && preview.InstalledRevision != expectedInstalled {
		return nil, errors.New("revision_conflict: installed package changed before confirmation")
	}
	payload["package"], payload["managedArtifact"] = preview, managed
	payload["archiveHashBound"], payload["targetRevisionBound"] = expectedHash != "", expectedInstalled != ""
	return payload, nil
}
