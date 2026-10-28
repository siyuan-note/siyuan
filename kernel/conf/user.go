// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type User struct {
	UserId                          string       `json:"userId"`
	UserName                        string       `json:"userName"`
	UserAvatarURL                   string       `json:"userAvatarURL"`
	UserHomeBImgURL                 string       `json:"userHomeBImgURL"`
	UserTitles                      []*UserTitle `json:"userTitles"`
	UserIntro                       string       `json:"userIntro"`
	UserNickname                    string       `json:"userNickname"`
	UserCreateTime                  string       `json:"userCreateTime"`
	UserSiYuanProExpireTime         float64      `json:"userSiYuanProExpireTime"`
	UserToken                       string       `json:"userToken"`
	UserTokenExpireTime             string       `json:"userTokenExpireTime"`
	UserSiYuanRepoSize              float64      `json:"userSiYuanRepoSize"`
	UserSiYuanPointExchangeRepoSize float64      `json:"userSiYuanPointExchangeRepoSize"`
	UserSiYuanAssetSize             float64      `json:"userSiYuanAssetSize"`
	UserTrafficUpload               float64      `json:"userTrafficUpload"`
	UserTrafficDownload             float64      `json:"userTrafficDownload"`
	UserTrafficAPIGet               float64      `json:"userTrafficAPIGet"`
	UserTrafficAPIPut               float64      `json:"userTrafficAPIPut"`
	UserTrafficTime                 float64      `json:"userTrafficTime"`
	UserSiYuanSubscriptionPlan      float64      `json:"userSiYuanSubscriptionPlan"`   // -1：未订阅，0：标准订阅，1：教育订阅，2：试用订阅
	UserSiYuanSubscriptionStatus    float64      `json:"userSiYuanSubscriptionStatus"` // -1：未订阅，0：订阅可用，1：订阅封禁，2：订阅过期
	UserSiYuanSubscriptionType      float64      `json:"userSiYuanSubscriptionType"`   // 0 年付订阅；1 终生订阅；2 月付订阅（目前不支持）
	UserSiYuanOneTimePayStatus      float64      `json:"userSiYuanOneTimePayStatus"`   // 0 功能特性未付费；1 功能特性已付费
}

type UserTitle struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
	Icon string `json:"icon"`
}

func (user *User) GetCloudRepoAvailableSize() int64 {
	return int64(user.UserSiYuanRepoSize - user.UserSiYuanAssetSize)
}
