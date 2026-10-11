package model

import (
	"errors"
	"fmt"
	"sync"

	"github.com/88250/lute/html"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// syncCloudIndexListNotice 仅记录当前来源的提示，不改变同步配置或仓库内容。
type syncCloudIndexListNotice struct {
	mu            sync.Mutex
	source        string
	sourceVersion uint64
	noticeVersion uint64
	failed        bool
	messageID     string
}

var syncIndexListNotice syncCloudIndexListNotice

// reset 使已修改配置的异步结果失效，并撤销对应提示。
func (notice *syncCloudIndexListNotice) reset(hide func(string)) {
	notice.mu.Lock()
	defer notice.mu.Unlock()
	notice.source = ""
	notice.sourceVersion++
	notice.noticeVersion++
	notice.failed = false
	if notice.messageID != "" {
		hide(notice.messageID)
		notice.messageID = ""
	}
}

func newSyncCloudIndexListObserver(scope string, provider int) func(error) {
	language := Conf.Language
	return syncIndexListNotice.observer(scope, func(err error) string {
		return syncCloudIndexListWarning(provider, err, language)
	}, func(callback func()) {
		go func() {
			util.WaitForUILoaded()
			callback()
		}()
	}, func(message string) string { return util.PushErrMsg(message, 0) }, util.PushClearMsg)
}

// observer 合并连续失败，成功或来源改变时撤销提示，忽略旧来源和启动等待期间过期的结果。
func (notice *syncCloudIndexListNotice) observer(source string, format func(error) string, enqueue func(func()), show func(string) string, hide func(string)) func(error) {
	notice.mu.Lock()
	if notice.source != source {
		notice.source = source
		notice.sourceVersion++
		notice.noticeVersion++
		notice.failed = false
		if notice.messageID != "" {
			hide(notice.messageID)
			notice.messageID = ""
		}
	}
	sourceVersion := notice.sourceVersion
	notice.mu.Unlock()
	return func(err error) {
		notice.mu.Lock()
		if sourceVersion != notice.sourceVersion {
			notice.mu.Unlock()
			return
		}
		if err == nil {
			notice.noticeVersion++
			notice.failed = false
			if notice.messageID != "" {
				hide(notice.messageID)
				notice.messageID = ""
			}
			notice.mu.Unlock()
			return
		}
		if notice.failed {
			notice.mu.Unlock()
			return
		}
		notice.failed = true
		notice.noticeVersion++
		version := notice.noticeVersion
		notice.mu.Unlock()
		enqueue(func() {
			notice.mu.Lock()
			defer notice.mu.Unlock()
			if version == notice.noticeVersion && notice.failed {
				notice.messageID = show(format(err))
			}
		})
	}
}

// syncCloudIndexListWarning 只展示本地化原因，避免将签名地址、凭据或服务端响应正文发送到界面。
func syncCloudIndexListWarning(provider int, err error, language func(int) string) string {
	message := html.EscapeString(fmt.Sprintf(language(420), conf.ProviderToStr(provider)))
	detail := cloudLockErrorDetail(err, language)
	if errors.Is(err, cloud.ErrCloudAuthFailed) {
		if provider == conf.ProviderSiYuan {
			detail = language(31)
		} else {
			detail = language(249)
		}
	} else if errors.Is(err, cloud.ErrCloudForbidden) {
		detail = language(249)
	}
	if detail != "" {
		message += "<br>" + html.EscapeString(detail)
	}
	return message
}
