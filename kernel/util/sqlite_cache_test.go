package util

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestSQLitePageCacheBudgetPerConnection(t *testing.T) {
	original := Container
	t.Cleanup(func() { Container = original })
	for _, container := range []string{ContainerStd, ContainerDocker, "", ContainerAndroid, ContainerIOS, ContainerHarmony} {
		t.Run(container, func(t *testing.T) {
			Container = container
			want := -128000
			if container == ContainerAndroid || container == ContainerIOS || container == ContainerHarmony {
				want = -16384
			}
			db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "cache.db")+"?_journal_mode=WAL"+SQLitePageCacheDSN())
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			db.SetMaxOpenConns(3)
			for range 3 {
				conn, err := db.Conn(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				defer conn.Close()
				var got int
				if err = conn.QueryRowContext(context.Background(), "PRAGMA cache_size").Scan(&got); err != nil {
					t.Fatal(err)
				}
				if got != want {
					t.Fatalf("cache budget for %s: got %d KiB, want %d", container, got, want)
				}
			}
			if db.Stats().OpenConnections != 3 {
				t.Fatal("page cache budget was not checked on three distinct connections")
			}
		})
	}
}
