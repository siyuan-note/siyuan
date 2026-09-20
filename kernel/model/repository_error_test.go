package model

import (
	"errors"
	"fmt"
	"html"
	"sync"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFormatSyncRepoErrorMsg(t *testing.T) {
	previousConf := Conf
	const lang = "sync-error-test"
	previousLang, hadLang := util.Langs[lang]
	util.Langs[lang] = map[int]string{
		43: "Cloud quota exceeded [%s]",
		68: "Subscribe to upgrade cloud quota [%s]",
		80: "Sync failed: %s",
	}
	t.Cleanup(func() {
		Conf = previousConf
		if hadLang {
			util.Langs[lang] = previousLang
		} else {
			delete(util.Langs, lang)
		}
	})

	for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderLocal, conf.ProviderS3, conf.ProviderWebDAV} {
		for _, plan := range []float64{-1, 0, 2} {
			for _, repoErr := range []error{
				dejavu.ErrCloudStorageSizeExceeded,
				fmt.Errorf("wrapped: %w", dejavu.ErrCloudStorageSizeExceeded),
				errors.New("unexpected <error>"),
			} {
				t.Run(fmt.Sprintf("%d/%g/%s", provider, plan, repoErr), func(t *testing.T) {
					Conf = &AppConf{
						userLock: &sync.RWMutex{},
						Lang:     lang,
						Sync:     &conf.Sync{Provider: provider},
						User:     &conf.User{UserSiYuanRepoSize: 8 * 1000 * 1000 * 1000, UserSiYuanSubscriptionPlan: plan},
					}
					want := "Sync failed: " + html.EscapeString(repoErr.Error()) + " (Provider: " + conf.ProviderToStr(provider) + ")"
					if provider == conf.ProviderSiYuan && errors.Is(repoErr, dejavu.ErrCloudStorageSizeExceeded) {
						want = "Cloud quota exceeded [8 GB]"
						if plan == 2 {
							want = "Subscribe to upgrade cloud quota [8 GB]"
						}
					}
					if got := formatSyncRepoErrorMsg(repoErr); got != want {
						t.Fatalf("got %q, want %q", got, want)
					}
				})
			}
		}
	}
}
