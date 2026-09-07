package model

import (
	"errors"
	"sync"

	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 账号状态变更单独串行化，认证失败处理不重复获取同步锁或资源来源锁。
var cloudAccountMu sync.Mutex

// 捕获请求凭据，只允许失败的请求清除同一云端的当前登录态。
func cloudAccountAuthFailureHandler(token string) func() {
	if Conf == nil || token == "" {
		return func() {}
	}
	server := util.GetCloudServer()
	requestedUser := Conf.GetUser()
	if requestedUser == nil {
		return func() {}
	}
	return func() {
		cloudAccountMu.Lock()
		defer cloudAccountMu.Unlock()
		user := Conf.GetUser()
		if token == "" || user == nil || user.UserToken != token || util.GetCloudServer() != server {
			return
		}
		if user.UserId != requestedUser.UserId {
			return
		}
		userName := user.UserName
		logoutUserLocked()
		util.BroadcastByType("main", "setCloudUser", 0, "", map[string]any{
			"user":     nil,
			"userName": userName,
		})
	}
}

// 调用方在来源锁或同步锁内捕获凭据，第三方存储错误不影响思源账号。
func cloudRepoErrorHandler() func(error) {
	user := Conf.GetUser()
	if Conf.Sync.Provider != conf.ProviderSiYuan || user == nil {
		return func(error) {}
	}
	invalid := cloudAccountAuthFailureHandler(user.UserToken)
	return func(err error) {
		if errors.Is(err, cloud.ErrCloudAuthFailed) {
			invalid()
		}
	}
}
