package main

import (
	"log"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

func main() {
	app := pocketbase.New()

	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Id: "bannerToolInit",
		Func: func(e *core.ServeEvent) error {
			if err := ensureCollections(app); err != nil {
				log.Printf("WARN: ensureCollections: %v", err)
			}
			registerRoutes(e)
			return e.Next()
		},
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
