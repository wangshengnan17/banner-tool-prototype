package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func registerRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/custom/generate-images", handleGenerateImages)
	e.Router.POST("/api/custom/evaluate-image", handleEvaluateImage)
	e.Router.POST("/api/custom/iterations/next", handleCreateNextIteration)
	e.Router.POST("/api/custom/iterations/{id}/mark-best", handleMarkBestIteration)
	e.Router.POST("/api/custom/generations/save", handleSaveGeneration)
	e.Router.GET("/api/custom/iterations/{id}/results", handleIterationResults)
	e.Router.GET("/api/custom/tasks/{taskId}/iterations-summary", handleIterationsSummary)
	e.Router.GET("/api/custom/activity-templates", handleListActivityTemplates)
	e.Router.POST("/api/custom/activity-templates", handleSaveActivityTemplate)
	e.Router.DELETE("/api/custom/activity-templates/{id}", handleDeleteActivityTemplate)
}

func readJSON(r *http.Request) (map[string]any, error) {
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func writeJSON(re *core.RequestEvent, status int, data any) error {
	re.Response.Header().Set("Content-Type", "application/json; charset=utf-8")
	re.Response.WriteHeader(status)
	return json.NewEncoder(re.Response).Encode(data)
}

func apiError(re *core.RequestEvent, status int, msg string) error {
	return writeJSON(re, status, map[string]any{"error": msg})
}

func getApiCredentials(modelConfigId string, app core.App) (apiKey, baseUrl, modelName, apiMode string, err error) {
	if modelConfigId != "" {
		record, findErr := app.FindRecordById("model_configs", modelConfigId)
		if findErr != nil {
			return "", "", "", "", fmtErr("模型配置不存在: %s", modelConfigId)
		}
		apiKey = record.GetString("api_key")
		baseUrl = record.GetString("api_base_url")
		modelName = record.GetString("model_name")
		apiMode = record.GetString("api_mode")
		if baseUrl == "" {
			baseUrl = envDefault("IMAGE_API_BASE_URL", "https://api.openai.com/v1")
		}
		return
	}

	apiKey = envDefault("DASHSCOPE_API_KEY",
		envDefault("QIANWEN_API_KEY",
			envDefault("NEW_API_KEY",
				envDefault("OPENAI_API_KEY",
					envDefault("IMAGE_API_KEY", "")))))
	baseUrl = envDefault("IMAGE_API_BASE_URL", "https://api.openai.com/v1")
	return
}

func fmtErr(format string, args ...any) error {
	s := format
	for _, a := range args {
		s = strings.Replace(s, "%s", toString(a), 1)
		s = strings.Replace(s, "%v", toString(a), 1)
	}
	return &errStr{s}
}

type errStr struct{ s string }

func (e *errStr) Error() string { return e.s }

func toString(v any) string {
	if v == nil {
		return "<nil>"
	}
	b, _ := json.Marshal(v)
	return strings.Trim(string(b), `"`)
}

// ---- POST /api/custom/generate-images ----

func handleGenerateImages(re *core.RequestEvent) error {
	body, err := readJSON(re.Request)
	if err != nil {
		return apiError(re, 400, "请求体格式错误")
	}

	var req GenerateRequest
	if b, e2 := json.Marshal(body); e2 == nil {
		json.Unmarshal(b, &req)
	}

	if len(req.Jobs) == 0 {
		return apiError(re, 400, "缺少生图任务")
	}

	modelConfigId, _ := body["modelConfigId"].(string)
	apiKey, baseUrl, modelName, apiMode, err := getApiCredentials(modelConfigId, re.App)
	if err != nil {
		return apiError(re, 400, err.Error())
	}
	if apiKey == "" {
		return apiError(re, 400, "请配置 API Key（环境变量或在模型配置中设置）")
	}

	if modelName != "" {
		req.Model = modelName
	}
	if apiMode != "" {
		req.ApiMode = apiMode
	}
	if req.ApiMode == "" {
		req.ApiMode = inferApiMode(req.Model)
	}

	// dashscope-wan 模式：通过兼容代理的 /images/generations 端点（OpenAI Images API 格式）
	// hupan 等代理将 DashScope Key 转为 OpenAI 兼容的 Images API
	if req.ApiMode == "dashscope-wan" && !strings.Contains(baseUrl, "dashscope.aliyuncs.com") {
		log.Printf("[route] dashscope-wan 通过代理走 images 模式 (baseUrl=%s)", baseUrl)
		req.ApiMode = "images"
	}

	// SSE 流式模式
	useStream := re.Request.URL.Query().Get("stream") == "1"
	if useStream {
		w := re.Response
		flusher, ok := w.(http.Flusher)
		if !ok {
			return apiError(re, 500, "SSE 不支持")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(200)
		flusher.Flush()

		// 从请求体读取 iterationId（前端传入，用于持久化）
		iterationId, _ := body["iterationId"].(string)

		// 先发一个 init 事件告知总数
		initData, _ := json.Marshal(map[string]any{
			"type":        "init",
			"total":       len(req.Jobs),
			"model":       req.Model,
			"iterationId": iterationId,
		})
		fmt.Fprintf(w, "data: %s\n\n", string(initData))
		flusher.Flush()

		// 如果有迭代ID，创建 generation_config 记录
		var configId string
		if iterationId != "" {
			configId, _ = createGenConfig(re.App, iterationId, body)
		}

		generateAllImagesStream(req, apiKey, baseUrl,
			func(result GenerateResult) {
				// 每完成一张图，立刻保存到 PocketBase
				if configId != "" {
					saveGenResult(re.App, configId, iterationId, result)
				}

				data, _ := json.Marshal(map[string]any{
					"type":   "result",
					"result": result,
				})
				fmt.Fprintf(w, "data: %s\n\n", string(data))
				flusher.Flush()
			},
			func(key string, genErr error) {
				data, _ := json.Marshal(map[string]any{
					"type":  "error",
					"key":   key,
					"error": genErr.Error(),
				})
				fmt.Fprintf(w, "data: %s\n\n", string(data))
				flusher.Flush()
			},
		)

		// 标记迭代状态
		if iterationId != "" && configId != "" {
			updateIterationStatus(re.App, iterationId, "generated")
		}

		// 发送结束事件（带 configId）
		endPayload := map[string]any{"type": "done"}
		if configId != "" {
			endPayload["configId"] = configId
		}
		endData, _ := json.Marshal(endPayload)
		fmt.Fprintf(w, "data: %s\n\n", string(endData))
		flusher.Flush()
		return nil
	}

	// 兼容旧的非流式模式
	results, genErr := generateAllImages(req, apiKey, baseUrl)
	if genErr != nil {
		return apiError(re, 500, genErr.Error())
	}

	return writeJSON(re, 200, map[string]any{
		"results": results,
		"model":   req.Model,
		"apiMode": req.ApiMode,
	})
}

func inferApiMode(model string) string {
	if strings.HasPrefix(model, "wan") || strings.HasPrefix(model, "qwen-image") {
		return "dashscope-wan"
	}
	if strings.Contains(model, "gpt") && strings.Contains(model, "image") {
		return "chat-completions"
	}
	return "images"
}

// ---- POST /api/custom/evaluate-image ----

func handleEvaluateImage(re *core.RequestEvent) error {
	body, err := readJSON(re.Request)
	if err != nil {
		return apiError(re, 400, "请求体格式错误")
	}

	imageSrc, _ := body["imageSrc"].(string)
	if imageSrc == "" {
		return apiError(re, 400, "缺少图片数据")
	}

	modelConfigId, _ := body["modelConfigId"].(string)
	apiKey, baseUrl, modelName, _, err := getApiCredentials(modelConfigId, re.App)
	if err != nil {
		return apiError(re, 400, err.Error())
	}
	if apiKey == "" {
		return apiError(re, 400, "请配置打分模型的 API Key")
	}

	scorerModel := modelName
	if scorerModel == "" {
		scorerModel, _ = body["scorerModel"].(string)
		if scorerModel == "" {
			scorerModel = "gpt-4o"
		}
	}

	reqData := EvalRequest{
		ImageSrc:    imageSrc,
		ScorerModel: scorerModel,
		ApiBaseUrl:  baseUrl,
		ApiKey:      apiKey,
	}
	if v, ok := body["prompt"].(string); ok {
		reqData.Prompt = v
	}
	if v, ok := body["title"].(string); ok {
		reqData.Title = v
	}
	if v, ok := body["subtitle"].(string); ok {
		reqData.Subtitle = v
	}
	if v, ok := body["sizeKey"].(string); ok {
		reqData.SizeKey = v
	}

	timeout := time.Duration(envInt("IMAGE_API_TIMEOUT_MS", 300000)) * time.Millisecond
	result, evalErr := evaluateImage(reqData, timeout)
	if evalErr != nil {
		return apiError(re, 500, evalErr.Error())
	}

	return writeJSON(re, 200, map[string]any{
		"evaluation": result,
		"model":      scorerModel,
	})
}

// ---- POST /api/custom/iterations/next ----

func handleCreateNextIteration(re *core.RequestEvent) error {
	body, err := readJSON(re.Request)
	if err != nil {
		return apiError(re, 400, "请求体格式错误")
	}

	taskId, _ := body["taskId"].(string)
	if taskId == "" {
		return apiError(re, 400, "缺少任务ID")
	}

	app := re.App

	records, findErr := app.FindRecordsByFilter(
		"iterations",
		"task = {:taskId}",
		"-version",
		1, 0,
		map[string]any{"taskId": taskId},
	)

	nextVersion := 1
	if findErr == nil && len(records) > 0 {
		nextVersion = int(records[0].GetInt("version")) + 1
	}

	notes, _ := body["notes"].(string)

	collection, _ := app.FindCollectionByNameOrId("iterations")
	record := core.NewRecord(collection)
	record.Set("owner", re.Auth.Id) // 从认证信息中获取当前用户
	record.Set("task", taskId)
	record.Set("version", nextVersion)
	record.Set("status", "draft")
	record.Set("notes", notes)
	record.Set("is_best", false)

	if err := app.Save(record); err != nil {
		return apiError(re, 500, "创建迭代失败: "+err.Error())
	}

	return writeJSON(re, 201, map[string]any{
		"id":      record.Id,
		"version": nextVersion,
		"taskId":  taskId,
	})
}

// ---- POST /api/custom/iterations/{id}/mark-best ----

func handleMarkBestIteration(re *core.RequestEvent) error {
	iterationId := re.Request.PathValue("id")
	if iterationId == "" {
		return apiError(re, 400, "缺少迭代ID")
	}

	app := re.App

	record, err := app.FindRecordById("iterations", iterationId)
	if err != nil {
		return apiError(re, 404, "迭代不存在")
	}

	taskId := record.GetString("task")

	allIterations, findErr := app.FindRecordsByFilter(
		"iterations",
		"task = {:taskId}",
		"", 0, 0,
		map[string]any{"taskId": taskId},
	)
	if findErr == nil {
		for _, it := range allIterations {
			if it.Id != iterationId && it.GetBool("is_best") {
				it.Set("is_best", false)
				app.Save(it)
			}
		}
	}

	record.Set("is_best", true)
	if err := app.Save(record); err != nil {
		return apiError(re, 500, "标记最佳迭代失败: "+err.Error())
	}

	return writeJSON(re, 200, map[string]any{
		"id":      iterationId,
		"is_best": true,
	})
}

// ---- POST /api/custom/generations/save ----

func handleSaveGeneration(re *core.RequestEvent) error {
	body, err := readJSON(re.Request)
	if err != nil {
		return apiError(re, 400, "请求体格式错误")
	}

	app := re.App

	iterationId, _ := body["iterationId"].(string)
	if iterationId == "" {
		return apiError(re, 400, "缺少迭代ID")
	}

	configCollection, _ := app.FindCollectionByNameOrId("generation_configs")
	configRecord := core.NewRecord(configCollection)
	configRecord.Set("iteration", iterationId)
	if v, ok := body["title"].(string); ok {
		configRecord.Set("title", v)
	}
	if v, ok := body["subtitle"].(string); ok {
		configRecord.Set("subtitle", v)
	}
	if v, ok := body["buttonText"].(string); ok {
		configRecord.Set("button_text", v)
	}
	if v, ok := body["activityTime"].(string); ok {
		configRecord.Set("activity_time", v)
	}
	if v, ok := body["prompt"].(string); ok {
		configRecord.Set("prompt", v)
	}
	if v, ok := body["imageModel"].(string); ok {
		configRecord.Set("image_model", v)
	}
	if v, ok := body["apiMode"].(string); ok {
		configRecord.Set("api_mode", v)
	}
	if v, ok := body["params"].(map[string]any); ok {
		configRecord.Set("params_json", v)
	}

	if err := app.Save(configRecord); err != nil {
		return apiError(re, 500, "保存生成配置失败: "+err.Error())
	}

	results, _ := body["results"].([]any)
	resultCollection, _ := app.FindCollectionByNameOrId("generation_results")

	savedResults := []map[string]any{}
	for _, r := range results {
		rm, ok := r.(map[string]any)
		if !ok {
			continue
		}

		rec := core.NewRecord(resultCollection)
		rec.Set("config", configRecord.Id)
		rec.Set("iteration", iterationId)
		if v, ok := rm["key"].(string); ok {
			rec.Set("size_key", v)
		}
		if v, ok := rm["width"].(float64); ok {
			rec.Set("width", int(v))
		}
		if v, ok := rm["height"].(float64); ok {
			rec.Set("height", int(v))
		}
		if v, ok := rm["src"].(string); ok {
			rec.Set("image", v)
		}
		if v, ok := rm["promptUsed"].(string); ok {
			rec.Set("prompt_used", v)
		}
		if v, ok := rm["modelUsed"].(string); ok {
			rec.Set("model_used", v)
		}
		if v, ok := rm["candidateId"].(string); ok {
			rec.Set("candidate_id", v)
		}

		if err := app.Save(rec); err != nil {
			return apiError(re, 500, "保存生成结果失败: "+err.Error())
		}

		savedResults = append(savedResults, map[string]any{
			"id":       rec.Id,
			"sizeKey":  rec.GetString("size_key"),
			"configId": configRecord.Id,
		})
	}

	iteration, findErr := app.FindRecordById("iterations", iterationId)
	if findErr == nil {
		iteration.Set("status", "generated")
		app.Save(iteration)
	}

	return writeJSON(re, 201, map[string]any{
		"configId":        configRecord.Id,
		"savedResults":    savedResults,
		"iterationId":     iterationId,
		"iterationStatus": "generated",
	})
}

// ---- GET /api/custom/activity-templates ----

func handleListActivityTemplates(re *core.RequestEvent) error {
	records, err := re.App.FindRecordsByFilter(
		"activity_templates",
		"",
		"-sort_order",
		100, 0,
	)
	if err != nil {
		return apiError(re, 500, "查询模板失败")
	}

	result := make([]map[string]any, len(records))
	for i, r := range records {
		result[i] = map[string]any{
			"id":            r.Id,
			"name":          r.GetString("name"),
			"title":         r.GetString("title"),
			"subtitle":      r.GetString("subtitle"),
			"button_text":   r.GetString("button_text"),
			"activity_time": r.GetString("activity_time"),
			"prompt":        r.GetString("prompt"),
			"image_model":   r.GetString("image_model"),
			"sort_order":    r.GetInt("sort_order"),
		}
	}
	return writeJSON(re, 200, map[string]any{"templates": result})
}

// ---- POST /api/custom/activity-templates ----

func handleSaveActivityTemplate(re *core.RequestEvent) error {
	body, err := readJSON(re.Request)
	if err != nil {
		return apiError(re, 400, "请求体格式错误")
	}

	app := re.App

	// Get authenticated user ID
	authRecord := re.Auth
	ownerId := ""
	if authRecord != nil {
		ownerId = authRecord.Id
	}

	id, _ := body["id"].(string)
	var record *core.Record

	if id != "" {
		record, err = app.FindRecordById("activity_templates", id)
		if err != nil {
			return apiError(re, 404, "模板不存在")
		}
	} else {
		collection, _ := app.FindCollectionByNameOrId("activity_templates")
		record = core.NewRecord(collection)

		// Set owner
		if ownerId != "" {
			record.Set("owner", ownerId)
		}

		existing, findErr := app.FindRecordsByFilter("activity_templates", "", "-sort_order", 1, 0)
		if findErr == nil && len(existing) > 0 {
			record.Set("sort_order", existing[0].GetInt("sort_order")+1)
		} else {
			record.Set("sort_order", 0)
		}
	}

	if v, ok := body["name"].(string); ok && v != "" {
		record.Set("name", v)
	}
	if v, ok := body["title"].(string); ok {
		record.Set("title", v)
	}
	if v, ok := body["subtitle"].(string); ok {
		record.Set("subtitle", v)
	}
	if v, ok := body["button_text"].(string); ok {
		record.Set("button_text", v)
	}
	if v, ok := body["activity_time"].(string); ok {
		record.Set("activity_time", v)
	}
	if v, ok := body["prompt"].(string); ok && v != "" {
		record.Set("prompt", v)
	}
	if v, ok := body["image_model"].(string); ok {
		record.Set("image_model", v)
	}

	if err := app.Save(record); err != nil {
		return apiError(re, 500, "保存模板失败: "+err.Error())
	}

	status := 200
	if id == "" {
		status = 201
	}
	return writeJSON(re, status, map[string]any{
		"id":            record.Id,
		"name":          record.GetString("name"),
		"title":         record.GetString("title"),
		"subtitle":      record.GetString("subtitle"),
		"button_text":   record.GetString("button_text"),
		"activity_time": record.GetString("activity_time"),
		"prompt":        record.GetString("prompt"),
		"image_model":   record.GetString("image_model"),
	})
}

// ---- DELETE /api/custom/activity-templates/{id} ----

func handleDeleteActivityTemplate(re *core.RequestEvent) error {
	id := re.Request.PathValue("id")
	if id == "" {
		return apiError(re, 400, "缺少模板ID")
	}

	record, err := re.App.FindRecordById("activity_templates", id)
	if err != nil {
		return apiError(re, 404, "模板不存在")
	}

	if err := re.App.Delete(record); err != nil {
		return apiError(re, 500, "删除模板失败: "+err.Error())
	}

	return writeJSON(re, 200, map[string]any{"deleted": id})
}

// ---- 生成结果即时持久化 helper ----

func createGenConfig(app core.App, iterationId string, body map[string]any) (string, error) {
	collection, err := app.FindCollectionByNameOrId("generation_configs")
	if err != nil {
		return "", err
	}
	record := core.NewRecord(collection)
	record.Set("iteration", iterationId)
	if v, ok := body["title"].(string); ok {
		record.Set("title", v)
	}
	if v, ok := body["subtitle"].(string); ok {
		record.Set("subtitle", v)
	}
	if v, ok := body["prompt"].(string); ok {
		record.Set("prompt", v)
	}
	if v, ok := body["model"].(string); ok {
		record.Set("image_model", v)
	}
	if v, ok := body["apiMode"].(string); ok {
		record.Set("api_mode", v)
	}
	if err := app.Save(record); err != nil {
		return "", err
	}
	return record.Id, nil
}

func saveGenResult(app core.App, configId, iterationId string, result GenerateResult) {
	collection, err := app.FindCollectionByNameOrId("generation_results")
	if err != nil {
		return
	}
	record := core.NewRecord(collection)
	record.Set("config", configId)
	record.Set("iteration", iterationId)
	record.Set("size_key", result.Key)
	record.Set("width", result.Width)
	record.Set("height", result.Height)
	record.Set("image", result.Src)
	record.Set("prompt_used", result.PromptUsed)
	record.Set("model_used", result.ModelUsed)
	app.Save(record)
}

func updateIterationStatus(app core.App, iterationId, status string) {
	record, err := app.FindRecordById("iterations", iterationId)
	if err != nil {
		return
	}
	record.Set("status", status)
	app.Save(record)
}
