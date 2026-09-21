package model

import (
	"errors"
	"maps"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const syncCloudRefContextKey = "siyuanSyncCloudRefUpload"

var errSyncRemoteRequestSkipped = errors.New("remote sync request no longer applicable")

// syncRepoWithPublication 只在更新云端最新引用且同步成功后报告发布，上传对象或下载数据不代表发布。
func syncRepoWithPublication(repo *dejavu.Repo, context map[string]any) (*dejavu.MergeResult, *dejavu.TrafficStat, bool, error) {
	context = maps.Clone(context)
	if nil == context {
		context = map[string]any{}
	}
	uploadingRef := &atomic.Bool{}
	context[syncCloudRefContextKey] = uploadingRef
	mergeResult, trafficStat, err := repo.Sync(context)
	return mergeResult, trafficStat, nil == err && uploadingRef.Load(), err
}

// syncCloudAlreadyApplied 使用持久化同步点识别延迟通知，保留此后尚未上传的本地修改。
func syncCloudAlreadyApplied(repoPath, latestID string) (bool, error) {
	if "" == latestID {
		return false, nil
	}
	latestSync, err := filelock.ReadFile(filepath.Join(repoPath, "refs", "latest-sync"))
	if os.IsNotExist(err) {
		return false, nil
	}
	return nil == err && string(latestSync) == latestID, err
}

func syncDataFromCloud() {
	defer logging.Recover()
	if !Conf.Sync.Perception || conf.ProviderSiYuan != Conf.Sync.Provider || !checkSync(false, false, false) {
		return
	}
	scope := lanSyncScope()
	latestID := getSyncCloudLatestID()
	if "" == latestID {
		// 预读失败时仍使用完整合并，并由正常同步流程处理错误和重试。
		if scope == lanSyncScope() {
			syncData(false, false)
		}
		return
	}
	syncDataFromRemote(scope, latestID)
}

func syncDataFromRemote(scope, latestID string) {
	_, err := syncRemoteRequests.do(scope, latestID, func() error {
		lockSync()
		defer unlockSync()
		if scope != lanSyncScope() || !checkSync(false, false, false) {
			return errSyncRemoteRequestSkipped
		}
		if syncRemoteRequests.isCompleted(scope, latestID) {
			return nil
		}
		applied, err := syncCloudAlreadyApplied(util.RepoDir, latestID)
		if nil != err || applied {
			return err
		}
		// 感知同步按共同同步点合并，不能用云端快照直接覆盖本地未上传的数据。
		err = syncDataLocked(false, false)
		if nil == err {
			completeCurrentSyncRemoteRequest(scope)
		}
		return err
	})
	if nil != err && !errors.Is(err, errSyncRemoteRequestSkipped) {
		logging.LogWarnf("perceived sync failed: %s", err)
	}
}
