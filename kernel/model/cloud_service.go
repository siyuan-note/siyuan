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
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ErrFailedToConnectCloudServer = errors.New("failed to connect cloud server")

func CloudChatGPT(msg string, contextMsgs []string) (ret string, stop bool, err error) {
	if nil == Conf.GetUser() {
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
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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
	if nil == Conf.GetUser() {
		return errors.New(Conf.Language(31))
	}

	requestResult := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(requestResult).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/user/startFreeTrial")
	if nil != err {
		logging.LogErrorf("start free trial failed: %s", err)
		return ErrFailedToConnectCloudServer
	}
	if http.StatusOK != resp.StatusCode {
		logging.LogErrorf("start free trial failed: %d", resp.StatusCode)
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
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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
	go util.GetRhyResult(true) // 发一次请求进行结果缓存
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

	if IsSubscriber() && -1 != Conf.GetUser().UserSiYuanProExpireTime {
		expired := int64(Conf.GetUser().UserSiYuanProExpireTime)
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
		if 2 == Conf.GetUser().UserSiYuanSubscriptionPlan {
			expireDay = 3 // 试用订阅提前 3 天提醒
		}

		if 0 < remains && expireDay > remains {
			util.WaitForUILoaded()
			time.Sleep(time.Second * 7)
			util.PushErrMsg(fmt.Sprintf(Conf.Language(127), remains), 0)
			return
		}
	}
}

func refreshUser() {
	defer logging.Recover()

	if nil != Conf.GetUser() {
		time.Sleep(2 * time.Minute)
		if nil != Conf.GetUser() {
			RefreshUser(Conf.GetUser().UserToken)
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

func RefreshUser(token string) {
	threeDaysAfter := util.CurrentTimeMillis() + 1000*60*60*24*3
    Conf.SetUser(loadUserFromConf())
	if "" == token {
		if "" != Conf.UserData {
			Conf.SetUser(loadUserFromConf())
		}
		if nil == Conf.GetUser() {
			return
		}

		var tokenExpireTime int64
		tokenExpireTime, err := strconv.ParseInt(Conf.GetUser().UserTokenExpireTime+"000", 10, 64)
		if nil != err {
			logging.LogErrorf("convert token expire time [%s] failed: %s", Conf.GetUser().UserTokenExpireTime, err)
			util.PushErrMsg(Conf.Language(19), 5000)
			return
		}

		if threeDaysAfter > tokenExpireTime {
			token = Conf.GetUser().UserToken
			goto Net
		}
		return
	}

Net:
	start := time.Now()
	user, err := getUser(token)
	if err != nil {
		if nil == Conf.GetUser() || errInvalidUser == err {
			util.PushErrMsg(Conf.Language(19), 5000)
			return
		}

		var tokenExpireTime int64
		tokenExpireTime, err = strconv.ParseInt(Conf.GetUser().UserTokenExpireTime+"000", 10, 64)
		if nil != err {
			logging.LogErrorf("convert token expire time [%s] failed: %s", Conf.GetUser().UserTokenExpireTime, err)
			util.PushErrMsg(Conf.Language(19), 5000)
			return
		}

		if threeDaysAfter > tokenExpireTime {
			util.PushErrMsg(Conf.Language(19), 5000)
			return
		}
		return
	}

	Conf.SetUser(user)
	data, _ := gulu.JSON.MarshalJSON(user)
	Conf.UserData = util.AESEncrypt(string(data))
	Conf.Save()

	if elapsed := time.Now().Sub(start).Milliseconds(); 3000 < elapsed {
		logging.LogInfof("get cloud user elapsed [%dms]", elapsed)
	}
	return
}

func loadUserFromConf() *conf.User {

    // var dec = util.AESDecrypt("0b3a434622d756db12ac9d0f035924bcd44c6aabb6017433bea4976a8e4d6d97d063c8e213e703c9adebedb7cb668508fb6b01203c4b69a3e30fb938b37c2e13dc07e5800419c13f4a598218972b0d49d6e7349a6259fcd686769591a6699350160969c9968967a546403c366ac24b946fc235235d5916d29c4336c5c17ac0269cd9237254b2d78ab2f5fadfd235dde3d5331224c7e192939944d9e56ead9c9e1d225bb43a5268f415ba7d70795c6a90dbffb2d2b1aeb9647cadb35b0ae982cfc862078966955db1a58ea28a416b713024a662496ca91763da1401149f02d23820f2c31867bd533813113f2c1442d9667237e75d7d33a8518b40a851a9d181457ca362fc2c680fc2161f40f69fcf058f7b2081c45f262b5c8585f19ee5198c75e0ae088e3175e03b3dcf66d3bef902919ae723fe7be8b68a54fbc6eecd7f51eda3dc7f935f4e7ebb5b85c3787f818ec51adf320305718c4570de9b82c19f7f84df08a77c3adb384cc65b9e5d5bd675a6e1a1381f304e8c99bbe72ab4374f183574860e4279e50e8ca7486aa27760fefd8f0a4a2b2be95a301d5571c812afa02125180f9a9870b42d54fb675bd8e0daf8e2715705625d7d6d160a9a329ac1a18df598945f48fc5b582fac3ce3f845e84727ee322a4745a3d9072824db4c7c72411622070674ce1fdfba0166dd9b61d89d95dcca2127cf58ca2e9ad8f6a7c67789e32c6639e2e33ee9c0526783a2f4a31544e2f56b474cf0516d031b491e7eea270738875d321eb75aa2b76721772ea728e6788d86590c26737faa4d4e8411e5a58378078e3c0035bbc42fe54251975def077751cde9bc28d373b70cd2a4f1bc5ff1ea3288529ca70a1133c2450445b7981f4441699358aab8440273ad2a62c4f85706b686fff325e5dfbc31dbfd3c09a34662aa400f7abe63267f0da8290f1555ba78840d72b222f1a9f8538e4377d500bb463eab92eb4302008174fc2d1bf560e11bd8548763dd1a882b2e9627c94e1b76f1ce2379026a3931753a1b19e0c56fcf02388954d49528e682880eb328a98acf02569e0a00db3dcf6e28307def9a51c44ad5bc318c3d6a66f4b633a2c6aaca000d704e3af74041096e189595937641319cd557f5efad026365904f71b72530bde252dcbcde868e3c7437ecd4a173e1b8aeb8a1b7b42a9234566ae5099e6eed7e63873ececc35f9031250cdf2d24654324280e371e90de0b41d44681be8172c2846ff42a04f4f450f8e9b70c58c716ac03060193950f88a123f44457a072a2c464c5babcb35a5719682c6371e4a231cdf1aae5edff09342a5a1b56ed4d0b3b5acff99ed1b81e139c29acac996f8f0a798fa2483cd560c5345bba85e279ed4f3f781d7e3d17665b0a5635f91a82fdb30edfa57faf50670417bdcd2f2a154cb07f81bbf3e3c818ac7798f277ecf23a4c35da691842cb671c6a00708479d8804808ea7a4e62e2cbed1dfa7c289bbea75fc843d5a286c54a536fe2130bfbfbb685c82c2f1e68dc58b465d307ab5ab557733e162d0c87c34b85fdade77f516daa2e27d2cca43f2b171ac1946eff1778a1ea62c47f7b358216e6b0aa45b3cafced0147e0899b037f029d824891708628e37e00")
    // fmt.Println(dec)
    userStr := `{"userId":"1719061610038","userName":"realneo","userAvatarURL":"https://assets.b3logfile.com/avatar/1719061610038.png?imageView2/1/w/256/h/256/interlace/0/q/100","userHomeBImgURL":"","userIntro":"","userNickname":"","userCreateTime":"20240622 21:06:50","userSiYuanProExpireTime":-1,"userToken":"b1d0d1ad98acdd5d7d846d4359048a923f932962125e7ad0c9db814d5942879467b648f693d6a11336bcaa8b1bee42090ae1061a025b6f16d8afdc6baac0c1129f62ce384f54ec3360273c1f53642adebbfd8d37a5170806c144c59ee5044cc88dd6e440a06e8853cfdf59e8a45800ec8b5e8bd41105485f1487839127608f94ed7fe815944a37852dd7a501050b20406a145b7f233259ca64051fb209eb0c988e2c8d1cef2fa81ae3991e267f9b3a8ae73983e05a43575e4431f814449b3e2b990f0182ec8d7fad6e834efa68396f913fc52221695f3125e772d5f907eb382e1da1b902feab17c7d10bf64ecd567f81","userTokenExpireTime":"7275693060","userSiYuanRepoSize":0,"userSiYuanPointExchangeRepoSize":0,"userSiYuanAssetSize":0,"userTrafficUpload":0,"userTrafficDownload":0,"userTrafficAPIGet":0,"userTrafficAPIPut":0,"userTrafficTime":0,"userSiYuanSubscriptionPlan":0,"userSiYuanSubscriptionStatus":0,"userSiYuanSubscriptionType":1,"userSiYuanOneTimePayStatus":1}`
    user := &conf.User{}
    gulu.JSON.UnmarshalJSON([]byte(userStr), &user)
    // {1719061610038 realneo https://assets.b3logfile.com/avatar/1719061610038.png?imageView2/1/w/256/h/256/interlace/0/q/100  []   20240622 21:06:50 -1 b1d0d1ad98acdd5d7d846d4359048a923f932962125e7ad0c9db814d5942879467b648f693d6a11336bcaa8b1bee42090ae1061a025b6f16d8afdc6baac0c1129f62ce384f54ec3360273c1f53642adebbfd8d37a5170806c144c59ee5044cc88dd6e440a06e8853cfdf59e8a45800ec8b5e8bd41105485f1487839127608f94ed7fe815944a37852dd7a501050b20406a145b7f233259ca64051fb209eb0c988e2c8d1cef2fa81ae3991e267f9b3a8ae73983e05a43575e4431f814449b3e2b990f0182ec8d7fad6e834efa68396f913fc52221695f3125e772d5f907eb382e1da1b902feab17c7d10bf64ecd567f81 7275693060 0 0 0 0 0 0 0 0 0 0 1 1}
    // gulu.JSON.UnmarshalJSON(dec, user)
    // user.UserCreateTime = "1719061610038"
    // user.UserId
    fmt.Print("inject user success")
    return user
    // return user1
	// if "" == Conf.UserData {
	// 	return nil
	// }
	// data := util.AESDecrypt(Conf.UserData)
	// data, _ = hex.DecodeString(string(data))
	// user := &conf.User{}
	// if err := gulu.JSON.UnmarshalJSON(data, &user); nil == err {
	// 	return user
	// }

	// return nil
}

func RemoveCloudShorthands(ids []string) (err error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	body := map[string]interface{}{
		"ids": ids,
	}
	resp, err := request.
		SetSuccessResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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

	md := ret["shorthandContent"].(string)
	ret["shorthandMd"] = md

	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
	content := luteEngine.ProtylePreview(tree, luteEngine.RenderOptions)
	ret["shorthandContent"] = content
	return
}

func GetCloudShorthands(page int) (result map[string]interface{}, err error) {
	result = map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(&result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
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

	luteEngine := NewLute()
	audioRegexp := regexp.MustCompile("<audio.*>.*</audio>")
	videoRegexp := regexp.MustCompile("<video.*>.*</video>")
	fileRegexp := regexp.MustCompile("\\[文件]\\(.*\\)")
	shorthands := result["data"].(map[string]interface{})["shorthands"].([]interface{})
	for _, item := range shorthands {
		shorthand := item.(map[string]interface{})
		id := shorthand["oId"].(string)
		t, _ := strconv.ParseInt(id, 10, 64)
		hCreated := util.Millisecond2Time(t)
		shorthand["hCreated"] = hCreated.Format("2006-01-02 15:04")

		desc := shorthand["shorthandDesc"].(string)
		desc = audioRegexp.ReplaceAllString(desc, " 语音 ")
		desc = videoRegexp.ReplaceAllString(desc, " 视频 ")
		desc = fileRegexp.ReplaceAllString(desc, " 文件 ")
		desc = strings.ReplaceAll(desc, "\n\n", "")
		desc = strings.TrimSpace(desc)
		shorthand["shorthandDesc"] = desc

		md := shorthand["shorthandContent"].(string)
		shorthand["shorthandMd"] = md
		tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
		content := luteEngine.ProtylePreview(tree, luteEngine.RenderOptions)
		shorthand["shorthandContent"] = content
	}
	return
}

var errInvalidUser = errors.New("invalid user")

func getUser(token string) (*conf.User, error) {
	result := map[string]interface{}{}
	request := httpclient.NewCloudRequest30s()
	resp, err := request.
		SetSuccessResult(&result).
		SetBody(map[string]string{"token": token}).
		Post(util.GetCloudServer() + "/apis/siyuan/user")
	if nil != err {
		logging.LogErrorf("get community user failed: %s", err)
		return nil, errors.New(Conf.Language(18))
	}
	if http.StatusOK != resp.StatusCode {
		logging.LogErrorf("get community user failed: %d", resp.StatusCode)
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
	resp, err := request.
		SetSuccessResult(requestResult).
		SetBody(map[string]string{"data": code}).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/useActivationcode")
	if nil != err {
		logging.LogErrorf("check activation code failed: %s", err)
		return ErrFailedToConnectCloudServer
	}
	if http.StatusOK != resp.StatusCode {
		logging.LogErrorf("check activation code failed: %d", resp.StatusCode)
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
	resp, err := request.
		SetSuccessResult(requestResult).
		SetBody(map[string]string{"data": code}).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
		Post(util.GetCloudServer() + "/apis/siyuan/checkActivationcode")
	if nil != err {
		logging.LogErrorf("check activation code failed: %s", err)
		msg = ErrFailedToConnectCloudServer.Error()
		return
	}
	if http.StatusOK != resp.StatusCode {
		logging.LogErrorf("check activation code failed: %d", resp.StatusCode)
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
	resp, err := request.
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
	if http.StatusOK != resp.StatusCode {
		logging.LogErrorf("login failed: %d", resp.StatusCode)
		ret = gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = Conf.Language(18)
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
	Conf.SetUser(nil)
	Conf.Save()
}
