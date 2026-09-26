package model

import (
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestCloudUserCachedDuringSync(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previous })
	for _, user := range []*conf.User{nil, {UserId: "owner", UserTokenExpireTime: "0"}} {
		Conf.SetUser(user)
		Conf.UserData = "preserved-account"
		release := lockAssetSourceChange()
		done := make(chan struct{})
		var got *conf.User
		var err error
		go func() {
			got, err = GetCloudUser("ignored-token", true)
			close(done)
		}()
		select {
		case <-done:
			release()
		case <-time.After(3 * time.Second):
			release()
			<-done
			t.Fatal("cached account query waited for synchronization")
		}
		if err != nil || got != user || Conf.GetUser() != user || Conf.UserData != "preserved-account" {
			t.Fatal("cached query changed the account or attempted to refresh it")
		}
	}
}
