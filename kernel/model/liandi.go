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

package model

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ErrFailedToConnectCloudServer = errors.New("failed to connect cloud server")

func CloudChatGPT(msg string, contextMsgs []string) (ret string, stop bool, err error) {
	if nil == Conf.User {
		return
	}

	payload := map[string]interface{}{}
	var messages []map[string]interface{}
	for _, contextMsg := range contextMsgs {
		messages = append(messages, map[string]interface{}{
			"role":    "user",
			"content": contextMsg,
		})
	}
	messages = append(messages, map[string]interface{}{
		"role":    "user",
		"content": msg,
	})
	payload["messages"] = messages

	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	_, err = request.
		SetSuccessResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		SetBody(payload).
		Post(util.GetCloudServer() + "/apis/siyuan/ai/chatGPT")
	if nil != err {
		logging.LogErrorf("chat gpt failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}
	if 0 != requestResult.Code {
		err = errors.New(requestResult.Msg)
		stop = true
		return
	}

	data := requestResult.Data.(map[string]interface{})
	choices := data["choices"].([]interface{})
	if 1 > len(choices) {
		stop = true
		return
	}
	choice := choices[0].(map[string]interface{})
	message := choice["message"].(map[string]interface{})
	ret = message["content"].(string)

	if nil != choice["finish_reason"] {
		finishReason := choice["finish_reason"].(string)
		if "length" == finishReason {
			stop = false
		} else {
			stop = true
		}
	} else {
		stop = true
	}
	return
}

func StartFreeTrial() (err error) {
	if nil == Conf.User {
		return errors.New(Conf.Language(31))
	}

	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	_, err = request.
		SetSuccessResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/user/startFreeTrial")
	if nil != err {
		logging.LogErrorf("start free trial failed: %s", err)
		return ErrFailedToConnectCloudServer
	}
	if 0 != requestResult.Code {
		return errors.New(requestResult.Msg)
	}
	return
}

func DeactivateUser() (err error) {
	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/user/deactivate")
	if nil != err {
		logging.LogErrorf("deactivate user failed: %s", err)
		return ErrFailedToConnectCloudServer
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 0 != requestResult.Code {
		logging.LogErrorf("deactivate user failed: %s", requestResult.Msg)
		return errors.New(requestResult.Msg)
	}
	return
}

func SetCloudBlockReminder(id, data string, timed int64) (err error) {
	requestResult := gulu.Ret.NewResult()
	payload := map[string]interface{}{"dataId": id, "data": data, "timed": timed}
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(requestResult).
		SetBody(payload).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/calendar/setBlockReminder")
	if nil != err {
		logging.LogErrorf("set block reminder failed: %s", err)
		return ErrFailedToConnectCloudServer
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 0 != requestResult.Code {
		logging.LogErrorf("set block reminder failed: %s", requestResult.Msg)
		return errors.New(requestResult.Msg)
	}
	return
}

var uploadToken = ""
var uploadTokenTime int64

func LoadUploadToken() (err error) {
	now := time.Now().Unix()
	if 3600 >= now-uploadTokenTime {
		return
	}

	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/upload/token")
	if nil != err {
		logging.LogErrorf("get upload token failed: %s", err)
		return ErrFailedToConnectCloudServer
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 0 != requestResult.Code {
		logging.LogErrorf("get upload token failed: %s", requestResult.Msg)
		return
	}

	resultData := requestResult.Data.(map[string]interface{})
	uploadToken = resultData["uploadToken"].(string)
	uploadTokenTime = now
	return
}

var (
	subscriptionExpirationReminded bool
)

func RefreshCheckJob() {
	go refreshSubscriptionExpirationRemind()
	go refreshUser()
	go refreshAnnouncement()
	go refreshCheckDownloadInstallPkg()
}

func refreshSubscriptionExpirationRemind() {
	if subscriptionExpirationReminded {
		return
	}
	subscriptionExpirationReminded = true

	if "ios" == util.Container {
		return
	}

	defer logging.Recover()

	if IsSubscriber() && -1 != Conf.User.UserSiYuanProExpireTime {
		expired := int64(Conf.User.UserSiYuanProExpireTime)
		now := time.Now().UnixMilli()
		if now >= expired { // 已经过期
			if now-expired <= 1000*60*60*24*2 { // 2 天内提醒 https://github.com/siyuan-note/siyuan/issues/7816
				time.Sleep(time.Second * 30)
				util.PushErrMsg(Conf.Language(128), 0)
			}
			return
		}
		remains := int((expired - now) / 1000 / 60 / 60 / 24)
		expireDay := 15 // 付费订阅提前 15 天提醒
		if 2 == Conf.User.UserSiYuanSubscriptionPlan {
			expireDay = 3 // 试用订阅提前 3 天提醒
		}

		if 0 < remains && expireDay > remains {
			util.WaitForUILoaded()
			time.Sleep(time.Second * 3)
			util.PushErrMsg(fmt.Sprintf(Conf.Language(127), remains), 0)
			return
		}
	}
}

func refreshUser() {
	defer logging.Recover()

	if nil != Conf.User {
		time.Sleep(2 * time.Minute)
		if nil != Conf.User {
			RefreshUser(Conf.User.UserToken)
		}
		subscriptionExpirationReminded = false
	}
}

func refreshCheckDownloadInstallPkg() {
	defer logging.Recover()

	time.Sleep(3 * time.Minute)
	checkDownloadInstallPkg()
	if "" != getNewVerInstallPkgPath() {
		util.PushMsg(Conf.Language(62), 15*1000)
	}
}

func refreshAnnouncement() {
	defer logging.Recover()

	time.Sleep(1 * time.Minute)
	announcementConf := filepath.Join(util.HomeDir, ".config", "siyuan", "announcement.json")
	var existingAnnouncements, newAnnouncements []*Announcement
	if gulu.File.IsExist(announcementConf) {
		data, err := os.ReadFile(announcementConf)
		if nil != err {
			logging.LogErrorf("read announcement conf failed: %s", err)
			return
		}
		if err = gulu.JSON.UnmarshalJSON(data, &existingAnnouncements); nil != err {
			logging.LogErrorf("unmarshal announcement conf failed: %s", err)
			os.Remove(announcementConf)
			return
		}
	}

	for _, announcement := range GetAnnouncements() {
		var exist bool
		for _, existingAnnouncement := range existingAnnouncements {
			if announcement.Id == existingAnnouncement.Id {
				exist = true
				break
			}
		}
		if !exist {
			existingAnnouncements = append(existingAnnouncements, announcement)
			if Conf.CloudRegion == announcement.Region {
				newAnnouncements = append(newAnnouncements, announcement)
			}
		}
	}

	data, err := gulu.JSON.MarshalJSON(existingAnnouncements)
	if nil != err {
		logging.LogErrorf("marshal announcement conf failed: %s", err)
		return
	}
	if err = os.WriteFile(announcementConf, data, 0644); nil != err {
		logging.LogErrorf("write announcement conf failed: %s", err)
		return
	}

	for _, newAnnouncement := range newAnnouncements {
		util.PushMsg(fmt.Sprintf(Conf.Language(11), newAnnouncement.URL, newAnnouncement.Title), 0)
	}
}

func RefreshUser(token string) error {
	threeDaysAfter := util.CurrentTimeMillis() + 1000*60*60*24*3
	if "" == token {
		if "" != Conf.UserData {
			Conf.User = loadUserFromConf()
		}
		if nil == Conf.User {
			return errors.New(Conf.Language(19))
		}

		var tokenExpireTime int64
		tokenExpireTime, err := strconv.ParseInt(Conf.User.UserTokenExpireTime+"000", 10, 64)
		if nil != err {
			logging.LogErrorf("convert token expire time [%s] failed: %s", Conf.User.UserTokenExpireTime, err)
			return errors.New(Conf.Language(19))
		}

		if threeDaysAfter > tokenExpireTime {
			token = Conf.User.UserToken
			goto Net
		}
		return nil
	}

Net:
	start := time.Now()
	user, err := getUser(token)
	if err != nil {
		if nil == Conf.User || errInvalidUser == err {
			return errors.New(Conf.Language(19))
		}

		var tokenExpireTime int64
		tokenExpireTime, err = strconv.ParseInt(Conf.User.UserTokenExpireTime+"000", 10, 64)
		if nil != err {
			logging.LogErrorf("convert token expire time [%s] failed: %s", Conf.User.UserTokenExpireTime, err)
			return errors.New(Conf.Language(19))
		}

		if threeDaysAfter > tokenExpireTime {
			return errors.New(Conf.Language(19))
		}
		return nil
	}

	Conf.User = user
	data, _ := gulu.JSON.MarshalJSON(user)
	Conf.UserData = util.AESEncrypt(string(data))
	Conf.Save()

	if elapsed := time.Now().Sub(start).Milliseconds(); 3000 < elapsed {
		logging.LogInfof("get cloud user elapsed [%dms]", elapsed)
	}
	return nil
}

func loadUserFromConf() *conf.User {
	if "" == Conf.UserData {
		return nil
	}

	data := util.AESDecrypt(Conf.UserData)
	data, _ = hex.DecodeString(string(data))
	user := &conf.User{}
	if err := gulu.JSON.UnmarshalJSON(data, &user); nil == err {
		return user
	}
	return nil
}

func RemoveCloudShorthands(ids []string) (err error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	body := map[string]interface{}{
		"ids": ids,
	}
	resp, err := request.
		SetSuccessResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		SetBody(body).
		Post(util.GetCloudServer() + "/apis/siyuan/inbox/removeCloudShorthands")
	if nil != err {
		logging.LogErrorf("remove cloud shorthands failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		logging.LogErrorf("remove cloud shorthands failed: %s", result["msg"])
		err = errors.New(result["msg"].(string))
		return
	}
	return
}

func GetCloudShorthand(id string) (ret map[string]interface{}, err error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/inbox/getCloudShorthand?id=" + id)
	if nil != err {
		logging.LogErrorf("get cloud shorthand failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		logging.LogErrorf("get cloud shorthand failed: %s", result["msg"])
		err = errors.New(result["msg"].(string))
		return
	}
	ret = result["data"].(map[string]interface{})
	t, _ := strconv.ParseInt(id, 10, 64)
	hCreated := util.Millisecond2Time(t)
	ret["hCreated"] = hCreated.Format("2006-01-02 15:04")
	return
}

func GetCloudShorthands(page int) (result map[string]interface{}, err error) {
	result = map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/inbox/getCloudShorthands?p=" + strconv.Itoa(page))
	if nil != err {
		logging.LogErrorf("get cloud shorthands failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		logging.LogErrorf("get cloud shorthands failed: %s", result["msg"])
		err = errors.New(result["msg"].(string))
		return
	}
	shorthands := result["data"].(map[string]interface{})["shorthands"].([]interface{})
	for _, item := range shorthands {
		shorthand := item.(map[string]interface{})
		id := shorthand["oId"].(string)
		t, _ := strconv.ParseInt(id, 10, 64)
		hCreated := util.Millisecond2Time(t)
		shorthand["hCreated"] = hCreated.Format("2006-01-02 15:04")
	}
	return
}

var errInvalidUser = errors.New("invalid user")

func getUser(token string) (*conf.User, error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	_, err := request.
		SetSuccessResult(&result).
		SetBody(map[string]string{"token": token}).
		Post(util.GetCloudServer() + "/apis/siyuan/user")
	if nil != err {
		logging.LogErrorf("get community user failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}

	code := result["code"].(float64)
	if 0 != code {
		if 255 == code {
			return nil, errInvalidUser
		}
		logging.LogErrorf("get community user failed: %s", result["msg"])
		return nil, errors.New(Conf.Language(18))
	}

	dataStr := result["data"].(string)
	data := util.AESDecrypt(dataStr)
	user := &conf.User{}
	if err = gulu.JSON.UnmarshalJSON(data, &user); nil != err {
		logging.LogErrorf("get community user failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}
	return user, nil
}

func UseActivationcode(code string) (err error) {
	code = strings.TrimSpace(code)
	code = gulu.Str.RemoveInvisible(code)
	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	_, err = request.
		SetSuccessResult(requestResult).
		SetBody(map[string]string{"data": code}).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/useActivationcode")
	if nil != err {
		logging.LogErrorf("check activation code failed: %s", err)
		return ErrFailedToConnectCloudServer
	}
	if 0 != requestResult.Code {
		return errors.New(requestResult.Msg)
	}
	return
}

func CheckActivationcode(code string) (retCode int, msg string) {
	code = strings.TrimSpace(code)
	code = gulu.Str.RemoveInvisible(code)
	retCode = 1
	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	_, err := request.
		SetSuccessResult(requestResult).
		SetBody(map[string]string{"data": code}).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/checkActivationcode")
	if nil != err {
		logging.LogErrorf("check activation code failed: %s", err)
		msg = ErrFailedToConnectCloudServer.Error()
		return
	}
	if 0 == requestResult.Code {
		retCode = 0
	}
	msg = requestResult.Msg
	return
}

func Login(userName, password, captcha string, cloudRegion int) (ret *gulu.Result) {
	Conf.CloudRegion = cloudRegion
	Conf.Save()
	util.CurrentCloudRegion = cloudRegion

	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	_, err := request.
		SetSuccessResult(&result).
		SetBody(map[string]string{"userName": userName, "userPassword": password, "captcha": captcha}).
		Post(util.GetCloudServer() + "/apis/siyuan/login")
	if nil != err {
		logging.LogErrorf("login failed: %s", err)
		ret = gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = Conf.Language(18) + ": " + err.Error()
		return
	}
	ret = &gulu.Result{
		Code: int(result["code"].(float64)),
		Msg:  result["msg"].(string),
		Data: map[string]interface{}{
			"userName":    result["userName"],
			"token":       result["token"],
			"needCaptcha": result["needCaptcha"],
		},
	}
	if -1 == ret.Code {
		ret.Code = 1
	}
	return
}

func Login2fa(token, code string) (map[string]interface{}, error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	_, err := request.
		SetSuccessResult(&result).
		SetBody(map[string]string{"twofactorAuthCode": code}).
		SetHeader("token", token).
		Post(util.GetCloudServer() + "/apis/siyuan/login/2fa")
	if nil != err {
		logging.LogErrorf("login 2fa failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}
	return result, nil
}

func LogoutUser() {
	Conf.UserData = ""
	Conf.User = nil
	Conf.Save()
}
