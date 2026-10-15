package model

import (
	"errors"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ClearSyncProviderConfig 清除指定第三方配置；当前来源必须完整，清除后关闭同步。
func ClearSyncProviderConfig(provider int) error {
	if util.ReadOnly {
		return errors.New(Conf.Language(34))
	}
	if provider != conf.ProviderS3 && provider != conf.ProviderWebDAV && provider != conf.ProviderLocal {
		return errors.New("invalid sync provider")
	}
	release := lockAssetSourceChange()
	defer release()
	if provider == Conf.Sync.Load().Provider {
		if err := requireCompleteAssetDownloads(); err != nil {
			return err
		}
		if err := clearAssetDownloadState(); err != nil {
			return err
		}
	}
	if err := persistClearedSyncProviderConfig(provider); err != nil {
		return err
	}
	if provider == Conf.Sync.Load().Provider {
		syncIndexListNotice.reset(util.PushClearMsg)
	}
	refreshLANSyncManager()
	return nil
}

// persistClearedSyncProviderConfig 先持久化副本，写入失败时保留生效配置。
func persistClearedSyncProviderConfig(provider int) error {
	Conf.m.Lock()
	defer Conf.m.Unlock()
	next := Conf.cloneSettings()
	// 深复制同步配置段，避免与生效配置共享子结构
	syncConfig := cloneConfSection(Conf.Sync.Load())
	if provider == syncConfig.Provider {
		syncConfig.Enabled = false
	}
	timeout := util.NormalizeTimeout(0)
	concurrentReqs := util.NormalizeConcurrentReqs(0, provider)
	switch provider {
	case conf.ProviderS3:
		syncConfig.S3 = &conf.S3{PathStyle: true, SkipTlsVerify: true, Timeout: timeout, ConcurrentReqs: concurrentReqs}
	case conf.ProviderWebDAV:
		syncConfig.WebDAV = &conf.WebDAV{SkipTlsVerify: true, Timeout: timeout, ConcurrentReqs: concurrentReqs}
	case conf.ProviderLocal:
		syncConfig.Local = &conf.Local{Timeout: timeout, ConcurrentReqs: concurrentReqs}
	}
	next.Sync.Store(conf.NormalizeSync(syncConfig))
	data, err := next.marshalForSave()
	if err != nil {
		return err
	}
	if err = atomicWriteFile(filepath.Join(util.ConfDir, "conf.json"), data); err != nil {
		return err
	}
	recordPersistedConf(data)
	Conf.Sync.Store(next.Sync.Load())
	return nil
}
