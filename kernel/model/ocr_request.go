package model

import (
	"strings"
	"sync"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ocrRequests = struct {
	sync.Mutex
	active map[string]*ocrRequest
}{active: map[string]*ocrRequest{}}

// 同一资源的在途请求共用令牌，手动编辑或清空使整组令牌失效，完成后不保留资源状态。
type ocrRequest struct {
	path    string
	pending int
}

func beginOCRRequest(path string) *ocrRequest {
	path = util.OCRAssetKey(strings.TrimSpace(path))
	ocrRequests.Lock()
	defer ocrRequests.Unlock()
	request := ocrRequests.active[path]
	if request == nil {
		request = &ocrRequest{path: path}
		ocrRequests.active[path] = request
	}
	request.pending++
	return request
}

func (request *ocrRequest) finish(value conf.OCR, automatic bool, err error) {
	ocrRequests.Lock()
	defer ocrRequests.Unlock()
	request.pending--
	if ocrRequests.active[request.path] != request {
		return
	}
	if !automatic || automaticOCRMatches(value) {
		recordOCRFailure(request.path, err)
	}
	if request.pending == 0 {
		delete(ocrRequests.active, request.path)
	}
}

func (request *ocrRequest) save(text string, value conf.OCR, automatic bool) bool {
	if IsEncryptedOCRAsset(request.path) {
		return false
	}
	ocrRequests.Lock()
	if ocrRequests.active[request.path] != request || automatic && !canSaveAutomaticOCR(value, request.path) {
		ocrRequests.Unlock()
		return false
	}
	util.SetAssetText(request.path, text)
	clearOCRFailure(request.path)
	ocrRequests.Unlock()
	indexOCRAssetText(request.path)
	return true
}
