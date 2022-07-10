// SiYuan - Build Your Eternal Digital Garden
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
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ErrFailedToConnectCloudServer = errors.New("failed to connect cloud server")

func StartFreeTrial() (err error) {
	if nil == Conf.User {
		return errors.New(Conf.Language(31))
	}

	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest()
	_, err = request.
		SetResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/user/startFreeTrial")
	if nil != err {
		util.LogErrorf("start free trial failed: %s", err)
		return ErrFailedToConnectCloudServer
	}
	if 0 != requestResult.Code {
		return errors.New(requestResult.Msg)
	}
	return
}

func DeactivateUser() (err error) {
	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest()
	resp, err := request.
		SetResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/user/deactivate")
	if nil != err {
		util.LogErrorf("deactivate user failed: %s", err)
		return ErrFailedToConnectCloudServer
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 0 != requestResult.Code {
		util.LogErrorf("deactivate user failed: %s", requestResult.Msg)
		return errors.New(requestResult.Msg)
	}
	return
}

func SetCloudBlockReminder(id, data string, timed int64) (err error) {
	requestResult := gulu.Ret.NewResult()
	payload := map[string]interface{}{"dataId": id, "data": data, "timed": timed}
	request := httpclient.NewCloudRequest()
	resp, err := request.
		SetResult(requestResult).
		SetBody(payload).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/calendar/setBlockReminder")
	if nil != err {
		util.LogErrorf("set block reminder failed: %s", err)
		return ErrFailedToConnectCloudServer
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 0 != requestResult.Code {
		util.LogErrorf("set block reminder failed: %s", requestResult.Msg)
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
	request := httpclient.NewCloudRequest()
	resp, err := request.
		SetResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/upload/token")
	if nil != err {
		util.LogErrorf("get upload token failed: %s", err)
		return ErrFailedToConnectCloudServer
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 0 != requestResult.Code {
		util.LogErrorf("get upload token failed: %s", requestResult.Msg)
		return
	}

	resultData := requestResult.Data.(map[string]interface{})
	uploadToken = resultData["uploadToken"].(string)
	uploadTokenTime = now
	return
}

var (
	refreshUserTicker              = time.NewTicker(30 * time.Minute)
	subscriptionExpirationReminded bool
)

func AutoRefreshUser() {
	for {
		if !subscriptionExpirationReminded {
			subscriptionExpirationReminded = true
			go func() {
				if "ios" == util.Container {
					return
				}
				if IsSubscriber() && -1 != Conf.User.UserSiYuanProExpireTime {
					expired := int64(Conf.User.UserSiYuanProExpireTime)
					if time.Now().UnixMilli() >= expired { // 已经过期
						time.Sleep(time.Second * 30)
						util.PushErrMsg(Conf.Language(128), 0)
						return
					}
					remains := (expired - time.Now().UnixMilli()) / 1000 / 60 / 60 / 24
					if 0 < remains && 15 > remains { // 15 后过期
						time.Sleep(3 * time.Minute)
						util.PushErrMsg(fmt.Sprintf(Conf.Language(127), remains), 0)
						return
					}
				}
			}()
		}

		if nil != Conf.User {
			time.Sleep(3 * time.Minute)
			if nil != Conf.User {
				RefreshUser(Conf.User.UserToken)
			}
			subscriptionExpirationReminded = false
		}
		<-refreshUserTicker.C
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
			util.LogErrorf("convert token expire time [%s] failed: %s", Conf.User.UserTokenExpireTime, err)
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
			util.LogErrorf("convert token expire time [%s] failed: %s", Conf.User.UserTokenExpireTime, err)
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
		util.LogInfof("get cloud user elapsed [%dms]", elapsed)
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
	request := httpclient.NewCloudRequest()
	body := map[string]interface{}{
		"ids": ids,
	}
	resp, err := request.
		SetResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		SetBody(body).
		Post(util.AliyunServer + "/apis/siyuan/inbox/removeCloudShorthands")
	if nil != err {
		util.LogErrorf("remove cloud shorthands failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		util.LogErrorf("remove cloud shorthands failed: %s", result["msg"])
		err = errors.New(result["msg"].(string))
		return
	}
	return
}

func GetCloudShorthands(page int) (result map[string]interface{}, err error) {
	result = map[string]interface{}{}
	request := httpclient.NewCloudRequest()
	resp, err := request.
		SetResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/inbox/getCloudShorthands?p=" + strconv.Itoa(page))
	if nil != err {
		util.LogErrorf("get cloud shorthands failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		util.LogErrorf("get cloud shorthands failed: %s", result["msg"])
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
	request := httpclient.NewCloudRequest()
	_, err := request.
		SetResult(&result).
		SetBody(map[string]string{"token": token}).
		Post(util.AliyunServer + "/apis/siyuan/user")
	if nil != err {
		util.LogErrorf("get community user failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}

	code := result["code"].(float64)
	if 0 != code {
		if 255 == code {
			return nil, errInvalidUser
		}
		util.LogErrorf("get community user failed: %s", result["msg"])
		return nil, errors.New(Conf.Language(18))
	}

	dataStr := result["data"].(string)
	data := util.AESDecrypt(dataStr)
	user := &conf.User{}
	if err = gulu.JSON.UnmarshalJSON(data, &user); nil != err {
		util.LogErrorf("get community user failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}
	return user, nil
}

func UseActivationcode(code string) (err error) {
	code = strings.TrimSpace(code)
	code = gulu.Str.RemoveInvisible(code)
	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest()
	_, err = request.
		SetResult(requestResult).
		SetBody(map[string]string{"data": code}).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/useActivationcode")
	if nil != err {
		util.LogErrorf("check activation code failed: %s", err)
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
	request := httpclient.NewCloudRequest()
	_, err := request.
		SetResult(requestResult).
		SetBody(map[string]string{"data": code}).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/checkActivationcode")
	if nil != err {
		util.LogErrorf("check activation code failed: %s", err)
		msg = ErrFailedToConnectCloudServer.Error()
		return
	}
	if 0 == requestResult.Code {
		retCode = 0
	}
	msg = requestResult.Msg
	return
}

func Login(userName, password, captcha string) (ret *gulu.Result, err error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest()
	_, err = request.
		SetResult(&result).
		SetBody(map[string]string{"userName": userName, "userPassword": password, "captcha": captcha}).
		Post(util.AliyunServer + "/apis/siyuan/login")
	if nil != err {
		util.LogErrorf("login failed: %s", err)
		return nil, errors.New(Conf.Language(18))
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
	request := httpclient.NewCloudRequest()
	_, err := request.
		SetResult(&result).
		SetBody(map[string]string{"twofactorAuthCode": code}).
		SetHeader("token", token).
		Post(util.AliyunServer + "/apis/siyuan/login/2fa")
	if nil != err {
		util.LogErrorf("login 2fa failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}
	return result, nil
}

func LogoutUser() {
	Conf.UserData = ""
	Conf.User = nil
	Conf.Save()
}
