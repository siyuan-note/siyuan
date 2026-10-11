package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestS3ConfigurationValidation(t *testing.T) {
	prepareSyncDirectoryTest(t)
	originalLangs := util.Langs
	util.Langs = map[string]map[int]string{"en": {142: "Input cannot be empty", 249: "Configuration or permission error"}}
	t.Cleanup(func() { util.Langs = originalLangs })
	valid := conf.S3{Endpoint: "https://storage.example.com", AccessKey: "key", SecretKey: "secret", Bucket: "notes", Region: "auto"}
	for _, field := range []string{"endpoint", "accessKey", "secretKey", "bucket", "region", "scheme", "host"} {
		t.Run(field, func(t *testing.T) {
			candidate := valid
			message := Conf.Language(142)
			switch field {
			case "endpoint":
				candidate.Endpoint = " "
			case "accessKey":
				candidate.AccessKey = " "
			case "secretKey":
				candidate.SecretKey = " "
			case "bucket":
				candidate.Bucket = " "
			case "region":
				candidate.Region = " "
			case "scheme":
				candidate.Endpoint = "ftp://storage.example.com"
				message = Conf.Language(249)
			case "host":
				candidate.Endpoint = "https://"
				message = Conf.Language(249)
			}
			Conf.Sync.Load().S3 = &valid
			Conf.Save()
			path := filepath.Join(util.ConfDir, "conf.json")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = SetSyncProviderS3(&candidate); err == nil || err.Error() != message {
				t.Fatalf("expected localized configuration error: %v", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) || Conf.Sync.Load().S3 != &valid {
				t.Fatal("invalid configuration changed the saved settings")
			}
			Conf.Sync.Load().S3 = &candidate
			if _, err = GetCloudRepoTagSnapshots(); err == nil || err.Error() != message {
				t.Fatalf("cloud tags did not reject invalid settings: %v", err)
			}
			if _, _, _, err = GetCloudRepoSnapshots(1); err == nil {
				t.Fatal("cloud snapshots accepted invalid settings")
			}
			if _, _, err = ListCloudSyncDir(); err == nil {
				t.Fatal("cloud directory listing accepted invalid settings")
			}
		})
	}
	for _, endpoint := range []string{"https://storage.example.com", "http://localhost:9000", "storage.example.com"} {
		valid.Endpoint = endpoint
		if err := validateSyncS3(&valid); err != nil {
			t.Fatalf("valid endpoint %q rejected: %v", endpoint, err)
		}
	}
	if err := validateSyncS3(nil); err == nil || err.Error() != Conf.Language(142) {
		t.Fatalf("expected missing-input error for nil configuration: %v", err)
	}
	Conf.Sync.Load().S3 = &conf.S3{}
	if _, err := newRepository(); err != nil {
		t.Fatalf("incomplete cloud settings blocked the local repository: %v", err)
	}
}
