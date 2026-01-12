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

package mobile

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/job"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
	_ "golang.org/x/mobile/bind"
)

// VerifyAppStoreTransaction 用于验证苹果 App Store 交易。
//
// accountToken UUID:
//
//	6ba7b810-9dad-11d1-0001-377616491562
//	6ba7b810-9dad-11d1-{Cloud Region}00{User ID}，中间的 00 为保留位
//
// 返回码：
//
// 0：验证通过
// -1：云端区域无效
// -2：服务器通讯失败，需要重试
// -3：非 iOS 设备
// -4：账号未登录
// -5：账号状态异常
// -6：参数错误
// -7：校验 accountToken 失败
// -8：校验 transaction 失败
// -9：未知的商品
func VerifyAppStoreTransaction(accountToken, transactionID string) (retCode int) {
	retCode = -2
	retMsg := "unknown error"

	accountToken = strings.TrimSpace(accountToken)
	transactionID = strings.TrimSpace(transactionID)
	if "" == accountToken || "" == transactionID {
		retCode = -6
		retMsg = "invalid parameters"
		logging.LogErrorf(retMsg)
		return
	}

	if 36 != len(accountToken) {
		retCode = -6
		retMsg = fmt.Sprintf("invalid accountToken [%s]", accountToken)
		logging.LogErrorf(retMsg)
		return
	}

	if util.ContainerIOS != util.Container {
		retCode = -3
		retMsg = fmt.Sprintf("invalid container [%s]", util.Container)
		logging.LogErrorf(retMsg)
		return
	}

	user := model.Conf.GetUser()
	if nil == user || "" == user.UserToken {
		retCode = -4
		retMsg = "account not logged in"
		logging.LogErrorf(retMsg)
		return
	}

	cloudRegionArg := accountToken[19:20]
	if "0" != cloudRegionArg && "1" != cloudRegionArg {
		retCode = -1
		retMsg = fmt.Sprintf("invalid cloud region [%s]", cloudRegionArg)
		logging.LogErrorf(retMsg)
		return
	}

	cloudRegion, _ := strconv.Atoi(cloudRegionArg)
	if util.CurrentCloudRegion != cloudRegion {
		retCode = -1
		retMsg = fmt.Sprintf("invalid cloud region [cloudRegionArg=%s, currentRegion=%d]", cloudRegionArg, util.CurrentCloudRegion)
		logging.LogErrorf(retMsg)
		return
	}

	userID := strings.ReplaceAll(accountToken[22:], "-", "")
	if user.UserId != userID {
		retCode = -5
		retMsg = fmt.Sprintf("invalid user [userID=%s, accountToken=%s]", user.UserId, accountToken)
		logging.LogErrorf(retMsg)
		return
	}

	verifyURL := util.GetCloudServer() + "/apis/siyuan/verifyAppStoreTransaction"
	result := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	resp, reqErr := request.SetSuccessResult(result).SetCookies(&http.Cookie{Name: "symphony", Value: user.UserToken}).
		SetBody(map[string]string{"transactionId": transactionID, "accountToken": accountToken, "userId": userID}).Post(verifyURL)
	if nil != reqErr {
		retCode = -2
		retMsg = fmt.Sprintf("verify app store transaction failed: %s", reqErr)
		logging.LogErrorf(retMsg)
		return
	}
	if http.StatusUnauthorized == resp.StatusCode || http.StatusForbidden == resp.StatusCode {
		retCode = -4
		retMsg = fmt.Sprintf("verify app store transaction failed [sc=%d]", resp.StatusCode)
		logging.LogErrorf(retMsg)
		return
	}
	if http.StatusOK != resp.StatusCode {
		retCode = -2
		retMsg = fmt.Sprintf("verify app store transaction failed [sc=%d]", resp.StatusCode)
		logging.LogErrorf(retMsg)
		return
	}

	if -1 == result.Code {
		retCode = -5
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if -3 == result.Code {
		retCode = -6
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if -2 == result.Code {
		retCode = -8
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if -4 == result.Code {
		retCode = -8
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if -5 == result.Code {
		retCode = -7
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if -6 == result.Code {
		retCode = -9
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if -64 == result.Code {
		retCode = -2
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}
	if 0 != result.Code {
		retCode = -2
		retMsg = fmt.Sprintf("verify app store transaction failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(retMsg)
		return
	}

	retCode = 0
	retMsg = fmt.Sprintf("verify app store transaction [%s] success", transactionID)
	logging.LogInfof(retMsg)
	return
}

func StartKernelFast(container, appDir, workspaceBaseDir, localIPs string) {
	go server.Serve(true, model.Conf.CookieKey)
}

func StartKernel(container, appDir, workspaceBaseDir, timezoneID, localIPs, lang, osVer string) {
	SetTimezone(container, appDir, timezoneID)
	util.Mode = "prod"
	util.MobileOSVer = osVer
	util.LocalIPs = strings.Split(localIPs, ",")
	util.BootMobile(container, appDir, workspaceBaseDir, lang)

	model.InitConf()
	go server.Serve(false, model.Conf.CookieKey)
	go func() {
		model.InitAppearance()
		sql.InitDatabase(false)
		sql.InitHistoryDatabase(false)
		sql.InitAssetContentDatabase(false)
		sql.SetCaseSensitive(model.Conf.Search.CaseSensitive)
		sql.SetIndexAssetPath(model.Conf.Search.IndexAssetPath)

		model.BootSyncData()
		model.InitBoxes()
		model.LoadFlashcards()
		util.LoadAssetsTexts()

		util.SetBooted()
		util.PushClearAllMsg()

		job.StartCron()
		go model.AutoGenerateFileHistory()
		go cache.LoadAssets()
	}()
}

func Language(num int) string {
	return model.Conf.Language(num)
}

func ShowMsg(msg string, timeout int) {
	util.PushMsg(msg, timeout)
}

func IsHttpServing() bool {
	return util.HttpServing
}

func SetHttpServerPort(port int) {
	filelock.AndroidServerPort = port
}

func GetCurrentWorkspacePath() string {
	return util.WorkspaceDir
}

func GetAssetAbsPath(asset string) (ret string) {
	ret, err := model.GetAssetAbsPath(asset)
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", asset, err)
		ret = asset
	}
	return
}

func GetMimeTypeByExt(ext string) string {
	return util.GetMimeTypeByExt(ext)
}

func SetTimezone(container, appDir, timezoneID string) {
	if "ios" == container {
		os.Setenv("ZONEINFO", filepath.Join(appDir, "app", "zoneinfo.zip"))
	}
	z, err := time.LoadLocation(strings.TrimSpace(timezoneID))
	if err != nil {
		fmt.Printf("load location failed: %s\n", err)
		time.Local = time.FixedZone("CST", 8*3600)
		return
	}
	time.Local = z
}

func DisableFeature(feature string) {
	util.DisableFeature(feature)
}

func FilepathBase(path string) string {
	return filepath.Base(path)
}

func FilterUploadFileName(name string) string {
	return util.FilterUploadFileName(name)
}

func AssetName(name string) string {
	return util.AssetName(name, ast.NewNodeID())
}

func Exit() {
	os.Exit(logging.ExitCodeOk)
}
