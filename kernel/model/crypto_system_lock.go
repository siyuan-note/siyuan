package model

// SetEncryptedNotebookFollowSystemLock 将锁屏策略保存在本机系统配置中，不参与密钥备份认证。
func SetEncryptedNotebookFollowSystemLock(enabled bool) {
	Conf.m.Lock()
	Conf.System.EncryptedNotebookFollowSystemLock = enabled
	Conf.m.Unlock()
}

// LockEncryptedNotebooksOnSystemLock 等待正在解锁的笔记本完成，再复用卸载流程保存内容并清除密钥。
func LockEncryptedNotebooksOnSystemLock() {
	Conf.m.RLock()
	enabled := Conf.System.EncryptedNotebookFollowSystemLock
	Conf.m.RUnlock()
	if !enabled {
		return
	}

	notebookCryptoMu.Lock()
	cachedDEKsLock.RLock()
	boxIDs := make([]string, 0, len(cachedDEKs))
	for boxID := range cachedDEKs {
		boxIDs = append(boxIDs, boxID)
	}
	cachedDEKsLock.RUnlock()
	notebookCryptoMu.Unlock()
	for _, boxID := range boxIDs {
		Unmount(boxID)
	}
}
