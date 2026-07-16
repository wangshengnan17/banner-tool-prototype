package main

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// ---- GET /api/custom/iterations/{id}/results ----

func handleIterationResults(re *core.RequestEvent) error {
	iterationId := re.Request.PathValue("id")
	if iterationId == "" {
		return apiError(re, 400, "缺少迭代ID")
	}

	app := re.App

	results, err := app.FindRecordsByFilter(
		"generation_results",
		"iteration = {:iterationId}",
		"size_key",
		100, 0,
		map[string]any{"iterationId": iterationId},
	)
	if err != nil {
		return apiError(re, 500, "查询结果失败: "+err.Error())
	}

	items := make([]map[string]any, len(results))
	for i, r := range results {
		imageUrl := ""
		if fn := r.GetString("image"); fn != "" {
			imageUrl = baseFileUrl(app) + "/api/files/" + r.Collection().Name + "/" + r.Id + "/" + fn
		}
		items[i] = map[string]any{
			"id":         r.Id,
			"sizeKey":    r.GetString("size_key"),
			"width":      r.GetInt("width"),
			"height":     r.GetInt("height"),
			"imageUrl":   imageUrl,
			"promptUsed": r.GetString("prompt_used"),
			"modelUsed":  r.GetString("model_used"),
		}
	}

	return writeJSON(re, 200, map[string]any{
		"iterationId": iterationId,
		"results":     items,
	})
}

// ---- GET /api/custom/tasks/{taskId}/iterations-summary ----

func handleIterationsSummary(re *core.RequestEvent) error {
	taskId := re.Request.PathValue("taskId")
	if taskId == "" {
		return apiError(re, 400, "缺少任务ID")
	}

	app := re.App

	iterations, err := app.FindRecordsByFilter(
		"iterations",
		"task = {:taskId}",
		"-version",
		50, 0,
		map[string]any{"taskId": taskId},
	)
	if err != nil {
		return apiError(re, 500, "查询迭代失败: "+err.Error())
	}

	items := make([]map[string]any, len(iterations))
	for i, it := range iterations {
		evals, evalErr := app.FindRecordsByFilter(
			"evaluations",
			"iteration = {:iterationId}",
			"-created",
			1, 0,
			map[string]any{"iterationId": it.Id},
		)
		var score float64 = 0
		if evalErr == nil && len(evals) > 0 {
			score = evals[0].GetFloat("overall_score")
		}

		items[i] = map[string]any{
			"id":      it.Id,
			"version": it.GetInt("version"),
			"status":  it.GetString("status"),
			"isBest":  it.GetBool("is_best"),
			"notes":   it.GetString("notes"),
			"score":   score,
			"created": it.GetString("created"),
		}
	}

	return writeJSON(re, 200, map[string]any{
		"taskId":     taskId,
		"iterations": items,
	})
}

func baseFileUrl(app core.App) string {
	u := envDefault("PB_BASE_URL", "http://127.0.0.1:8090")
	return strings.TrimRight(u, "/")
}
