// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// syncSourceIdentity excludes encryption keys, credentials and transport options.
func syncSourceIdentity(provider int, c *cloud.Conf) string {
	dir := c.Dir
	if provider == conf.ProviderS3 {
		dir = ""
	}
	identity := []string{fmt.Sprint(provider), dir}
	switch provider {
	case conf.ProviderSiYuan:
		identity = append(identity, c.Server, c.UserID)
	case conf.ProviderS3:
		if c.S3 != nil {
			identity = append(identity, c.S3.Endpoint, c.S3.Bucket)
		}
	case conf.ProviderWebDAV:
		if c.WebDAV != nil {
			identity = append(identity, c.WebDAV.Endpoint, c.WebDAV.Username)
		}
	case conf.ProviderLocal:
		if c.Local != nil {
			identity = append(identity, filepath.Clean(c.Local.Endpoint))
		}
	}
	data, _ := json.Marshal(identity)
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

// prepareSyncSourceChange runs with the sync and asset-source locks held.
// Enroll the old identity before its configuration is replaced, including legacy workspaces.
func prepareSyncSourceChange() (err error) {
	if _, err = os.Stat(filepath.Join(util.RepoDir, "refs", "latest-sync")); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	repo, err := newRepositoryWithAssetSourceLocked()
	if err != nil {
		return err
	}
	if err = repo.BindLegacySyncSource(); err != nil {
		return err
	}
	checkout, err := prepareRepoCheckout(repo)
	if err != nil {
		return err
	}
	defer checkout.finish(repo, &err)
	_, err = repo.IndexWithOptions("Backup before changing sync source", false, nil, dejavu.IndexOptions{FullCheck: true})
	return
}

func GetSyncSourceState() (ret apicontract.SyncSourceState, err error) {
	release := lockAssetSourceChange()
	defer release()
	repo, err := newRepositoryWithAssetSourceLocked()
	if err != nil {
		return ret, err
	}
	changed, err := repo.SyncSourceChanged()
	if err != nil || !changed {
		return ret, err
	}
	remote, err := repo.GetCloudLatest(newSyncContext())
	if errors.Is(err, cloud.ErrCloudObjectNotFound) {
		remote, err = &entity.Index{}, nil
	}
	if err != nil {
		return ret, err
	}
	checkout, err := prepareRepoCheckout(repo)
	if err != nil {
		return ret, err
	}
	defer checkout.finish(repo, &err)
	if _, err = repo.IndexWithOptions("Preview changed sync source", false, nil, dejavu.IndexOptions{FullCheck: true}); err != nil {
		return ret, err
	}
	preview, err := repo.PreviewSyncSource(remote, newSyncContext())
	if err != nil {
		return ret, err
	}
	c, err := buildCloudConf()
	if err != nil {
		return ret, err
	}
	ret = apicontract.SyncSourceState{Pending: remote.ID != "", Source: syncSourceIdentity(Conf.Sync.Load().Provider, c),
		LocalID: preview.LocalID, CloudID: remote.ID, LocalFiles: preview.LocalFiles, CloudFiles: len(remote.Files),
		CloudCreated: remote.Created, CloudDevice: remote.SystemName, UploadFiles: preview.UploadFiles,
		OverwriteFiles: preview.OverwriteFiles, RemoveFiles: preview.RemoveFiles}
	if ret.CloudDevice == "" {
		ret.CloudDevice = remote.SystemID
	}
	return
}

// SyncSourceDecision pins an explicit choice to the source and snapshots shown in the preview.
type SyncSourceDecision struct{ Source, LocalID, CloudID string }

// The caller already saved editors, drained transactions and holds the write guard.
// Do not wait for a transaction worker which may itself be waiting for that guard.
func indexRepoForSourceDecision(repo *dejavu.Repo, upload bool) (err error) {
	if upload {
		if err = checkRepositoryPasswordMigration(); err != nil {
			return
		}
	}
	if err = processAssetDownloadRecovery(repo, true); err != nil {
		return
	}
	_, err = repo.IndexWithOptions("[Sync] Confirm changed source", true, newSyncContext(), dejavu.IndexOptions{FullCheck: true})
	return
}

func applySyncSourceDecision(context map[string]interface{}, decisions []SyncSourceDecision) error {
	if len(decisions) == 0 {
		return nil
	}
	d := decisions[0]
	c, err := buildCloudConf()
	if err != nil {
		return err
	}
	if d.Source != syncSourceIdentity(Conf.Sync.Load().Provider, c) || d.LocalID == "" {
		return dejavu.ErrSyncSourcePreviewChanged
	}
	context[dejavu.CtxExpectedSyncLocal] = d.LocalID
	context[dejavu.CtxExpectedSyncCloud] = d.CloudID
	return nil
}

// 预览失效由方向对话框就地处理，通知记录插件写入数据会使刚刷新的预览再次失效。
func pushSyncSourceDecisionError(msg string, err error) {
	if !errors.Is(err, dejavu.ErrSyncSourcePreviewChanged) {
		util.PushErrMsg(msg, 0)
	}
}
