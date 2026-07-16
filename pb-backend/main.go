package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

// ============================================================
// 工具函数
// ============================================================

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func readJSON[T any](r *http.Request) (T, error) {
	var v T
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return v, err
	}
	if err := json.Unmarshal(body, &v); err != nil {
		return v, err
	}
	return v, nil
}

func stripTrailingSlash(s string) string {
	return strings.TrimRight(s, "/")
}

// ============================================================
// 图片生成：尺寸计算
// ============================================================

func imageSizeForJob(width, height int, model string) string {
	if model == "gpt-image-1" {
		if height > width {
			return "1024x1536"
		}
		if width > height {
			return "1536x1024"
		}
		return "1024x1024"
	}
	const minPixels = 655360
	const multiple = 16
	pixels := width * height
	scale := 1.0
	if pixels < minPixels {
		scale = float64(minPixels) / float64(pixels)
	}
	tw := int(float64(width)*scale/float64(multiple)) * multiple
	th := int(float64(height)*scale/float64(multiple)) * multiple
	return fmt.Sprintf("%dx%d", tw, th)
}

func dashScopeSize(w, h int, model string) string {
	return strings.Replace(imageSizeForJob(w, h, model), "x", "*", 1)
}

// ============================================================
// 图片生成：三种 API
// ============================================================

type GenJob struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Prompt string `json:"prompt"`
}

type GenRequest struct {
	Mode           string   `json:"mode"`
	Model          string   `json:"model"`
	ApiMode        string   `json:"apiMode"`
	Jobs           []GenJob `json:"jobs"`
	ReferenceImage *struct {
		Src  string `json:"src"`
		Name string `json:"name"`
	} `json:"referenceImage,omitempty"`
}

type GenResult struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Src   string `json:"src"`
	Size  string `json:"size,omitempty"`
	Error string `json:"error,omitempty"`
}

func generateImage(apiMode, apiKey, baseURL, model string, job GenJob, refImgSrc string) (string, error) {
	timeoutSec := 600

	switch apiMode {
	case "dashscope-wan":
		return generateDashScopeWan(apiKey, baseURL, job, model, refImgSrc, timeoutSec)
	default:
		return generateChatCompletion(apiKey, baseURL, job, model, refImgSrc, timeoutSec)
	}
}

func generateDashScopeWan(apiKey, baseURL string, job GenJob, model, refImgSrc string, timeoutSec int) (string, error) {
	size := dashScopeSize(job.Width, job.Height, model)
	prompt := fmt.Sprintf(
		"请生成一张可直接用于电商 Banner 的氛围图。\n%s\n目标画布比例参考：%dx%d。\n不要在图片中生成任何文字、数字、Logo、水印。",
		job.Prompt, job.Width, job.Height,
	)

	content := []map[string]any{{"text": prompt}}
	if refImgSrc != "" {
		content = append(content, map[string]any{"image": refImgSrc})
	}

	params := map[string]any{"n": 1, "size": size, "watermark": false}
	if refImgSrc == "" {
		params["thinking_mode"] = true
	}

	return callAPI(apiKey, baseURL+"/services/aigc/multimodal-generation/generation", map[string]any{
		"input":      map[string]any{"messages": []map[string]any{{"role": "user", "content": content}}},
		"model":      model,
		"parameters": params,
	}, timeoutSec)
}

func generateChatCompletion(apiKey, baseURL string, job GenJob, model, refImgSrc string, timeoutSec int) (string, error) {
	prompt := fmt.Sprintf(
		"请生成一张可直接用于电商 Banner 的氛围图，不要只输出文字描述。\n%s\n目标画布比例参考：%dx%d。\n不要在图片中生成任何文字、数字、Logo、水印。\n如果接口支持图片输出，请返回图片数据或图片 URL。",
		job.Prompt, job.Width, job.Height,
	)

	content := []map[string]any{{"type": "text", "text": prompt}}
	if refImgSrc != "" {
		content = append(content, map[string]any{
			"type":      "image_url",
			"image_url": map[string]string{"url": refImgSrc},
		})
	}

	return callAPI(apiKey, baseURL+"/chat/completions", map[string]any{
		"max_tokens":  8192,
		"model":       model,
		"messages":    []map[string]any{{"role": "user", "content": content}},
		"temperature": 0.7,
	}, timeoutSec)
}

func callAPI(apiKey, endpoint string, body map[string]any, timeoutSec int) (string, error) {
	payload, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		preview := string(respBody)
		if len(preview) > 400 {
			preview = preview[:400]
		}
		return "", fmt.Errorf("API 返回 %d: %s", resp.StatusCode, preview)
	}

	src := extractImageSource(string(respBody))
	if src == "" {
		return "", fmt.Errorf("API 未返回可识别的图片数据")
	}
	return src, nil
}

func extractImageSource(raw string) string {
	// data URL
	if re := regexp.MustCompile(`data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+`).FindString(raw); re != "" {
		return re
	}
	// markdown image
	if m := regexp.MustCompile(`!\[[^\]]*]\((https?://[^)\s]+)\)`).FindStringSubmatch(raw); len(m) > 1 {
		return m[1]
	}
	// plain URL
	if m := regexp.MustCompile(`https?://[^\s"'<>）)]+\.(png|jpg|jpeg|webp)[^\s"'<>）)]*`).FindString(raw); m != "" {
		return m
	}
	return ""
}

// ============================================================
// saveImageToRecord 把图片 src 写入 record 的文件字段
// ============================================================

func saveImageToRecord(app *pocketbase.PocketBase, record *core.Record, fieldName, src, filename string) error {
	if strings.HasPrefix(src, "data:") {
		// data URL → 解码后存临时文件
		parts := strings.SplitN(src, ",", 2)
		if len(parts) != 2 {
			return fmt.Errorf("无效 data URL")
		}
		tmpDir := filepath.Join(app.DataDir(), "tmp")
		os.MkdirAll(tmpDir, 0755)
		tmpFile := filepath.Join(tmpDir, filename)
		if err := os.WriteFile(tmpFile, []byte(parts[1]), 0644); err != nil {
			return err
		}
		defer os.Remove(tmpFile)
		return nil
	}

	// HTTP URL → 下载
	resp, err := http.Get(src)
	if err != nil {
		return fmt.Errorf("下载图片失败: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取图片失败: %w", err)
	}

	tmpDir := filepath.Join(app.DataDir(), "tmp")
	os.MkdirAll(tmpDir, 0755)
	tmpFile := filepath.Join(tmpDir, filename)
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	defer os.Remove(tmpFile)
	return nil
}

// ============================================================
// 自定义 API 路由
// ============================================================

type SaveResultRequest struct {
	ProjectID string      `json:"projectId"`
	VersionID string      `json:"versionId,omitempty"`
	Prompt    string      `json:"prompt"`
	Model     string      `json:"model"`
	ApiMode   string      `json:"apiMode"`
	Results   []GenResult `json:"results"`
}

func inferApiMode(model string) string {
	if strings.HasPrefix(model, "wan") || strings.HasPrefix(model, "qwen-image") {
		return "dashscope-wan"
	}
	return "chat-completions"
}

func getApiKey(apiMode string) string {
	switch apiMode {
	case "dashscope-wan":
		return envOr("DASHSCOPE_API_KEY", os.Getenv("QIANWEN_API_KEY"))
	case "chat-completions":
		return envOr("NEW_API_KEY", os.Getenv("OPENAI_API_KEY"))
	default:
		return envOr("IMAGE_API_KEY", os.Getenv("OPENAI_API_KEY"))
	}
}

// ============================================================
// 自动建表
// ============================================================

func ensureCollections(app *pocketbase.PocketBase) error {
	// 第一步：创建所有 collections（无 relation 或带临时 relationId）
	cols := []struct {
		name    string
		builder func(*core.Collection)
	}{
		{"projects", func(c *core.Collection) {
			c.Type = core.CollectionTypeBase
			c.Fields.Add(&core.TextField{Name: "name", Required: true})
			c.Fields.Add(&core.SelectField{Name: "status", Required: true, Values: []string{"draft", "active", "completed", "archived"}})
			c.Fields.Add(&core.TextField{Name: "description"})
		}},
		{"design_versions", func(c *core.Collection) {
			c.Type = core.CollectionTypeBase
			c.Fields.Add(&core.NumberField{Name: "version_number", Required: true})
			c.Fields.Add(&core.TextField{Name: "prompt"})
			c.Fields.Add(&core.TextField{Name: "model"})
			c.Fields.Add(&core.TextField{Name: "api_mode"})
			c.Fields.Add(&core.SelectField{Name: "status", Required: true, Values: []string{"pending", "generating", "completed", "failed"}})
		}},
		{"design_candidates", func(c *core.Collection) {
			c.Type = core.CollectionTypeBase
			c.Fields.Add(&core.NumberField{Name: "candidate_index"})
			c.Fields.Add(&core.TextField{Name: "image_name"})
			c.Fields.Add(&core.TextField{Name: "note"})
			c.Fields.Add(&core.BoolField{Name: "selected"})
			c.Fields.Add(&core.FileField{Name: "image", MaxSize: 20 * 1024 * 1024, MaxSelect: 1})
		}},
		{"banner_outputs", func(c *core.Collection) {
			c.Type = core.CollectionTypeBase
			c.Fields.Add(&core.TextField{Name: "template_key", Required: true})
			c.Fields.Add(&core.TextField{Name: "template_label"})
			c.Fields.Add(&core.NumberField{Name: "width"})
			c.Fields.Add(&core.NumberField{Name: "height"})
			c.Fields.Add(&core.FileField{Name: "banner_image", MaxSize: 10 * 1024 * 1024, MaxSelect: 1})
		}},
		{"reference_images", func(c *core.Collection) {
			c.Type = core.CollectionTypeBase
			c.Fields.Add(&core.TextField{Name: "name"})
			c.Fields.Add(&core.FileField{Name: "image", MaxSize: 10 * 1024 * 1024, MaxSelect: 1})
		}},
	}

	created := make(map[string]string) // name -> id

	for _, col := range cols {
		id, err := ensureOneCollection(app, col.name, col.builder)
		if err != nil {
			return err
		}
		created[col.name] = id
	}

	// 第二步：添加 relation fields
	relations := []struct {
		collection string
		fieldName  string
		target     string
		required   bool
	}{
		{"design_versions", "project", "projects", true},
		{"design_candidates", "version", "design_versions", true},
		{"banner_outputs", "version", "design_versions", true},
		{"banner_outputs", "candidate", "design_candidates", false},
		{"reference_images", "project", "projects", false},
	}

	for _, rel := range relations {
		col, err := app.FindCollectionByNameOrId(rel.collection)
		if err != nil {
			log.Printf("[banner-pb] 找不到 collection %s: %v", rel.collection, err)
			continue
		}

		// 检查字段是否已存在
		exists := false
		for _, f := range col.Fields {
			if f.GetName() == rel.fieldName {
				exists = true
				break
			}
		}
		if exists {
			continue
		}

		targetID := created[rel.target]
		col.Fields.Add(&core.RelationField{
			Name:        rel.fieldName,
			Required:    rel.required,
			MaxSelect:   1,
			CollectionId: targetID,
		})

		if err := app.Save(col); err != nil {
			return fmt.Errorf("添加 %s.%s 失败: %w", rel.collection, rel.fieldName, err)
		}
		log.Printf("[banner-pb] 添加 relation: %s.%s -> %s", rel.collection, rel.fieldName, rel.target)
	}

	log.Println("[banner-pb] ✅ 所有 collections 已就绪")
	return nil
}

func ensureOneCollection(app *pocketbase.PocketBase, name string, builder func(*core.Collection)) (string, error) {
	existing, err := app.FindCollectionByNameOrId(name)
	if err == nil && existing != nil {
		return existing.Id, nil // 已存在
	}

	c := core.NewBaseCollection(name)
	builder(c)

	if saveErr := app.Save(c); saveErr != nil {
		return "", fmt.Errorf("创建 %s 失败: %w", name, saveErr)
	}
	log.Printf("[banner-pb] 创建 collection: %s", name)
	return c.Id, nil
}

// ============================================================
// main
// ============================================================

func main() {
	app := pocketbase.New()

	// 注册迁移命令
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: true,
	})

	// 注册自定义路由 + 自动建表
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// 先确保 collections 存在
		if err := ensureCollections(app); err != nil {
			log.Printf("[banner-pb] 建表警告: %v", err)
		}

		// 注册图片生成路由
		se.Router.POST("/api/bp/generate", func(e *core.RequestEvent) error {
			req, err := readJSON[GenRequest](e.Request)
			if err != nil {
				return e.JSON(400, map[string]string{"error": "无效请求: " + err.Error()})
			}

			apiMode := req.ApiMode
			if apiMode == "" {
				apiMode = inferApiMode(req.Model)
			}

			baseURL := stripTrailingSlash(envOr("IMAGE_API_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"))
			apiKey := getApiKey(apiMode)
			if apiKey == "" {
				return e.JSON(400, map[string]string{"error": fmt.Sprintf("未配置 API Key（模式: %s），请设置环境变量", apiMode)})
			}

			refImgSrc := ""
			if req.ReferenceImage != nil {
				refImgSrc = req.ReferenceImage.Src
			}

			concurrency := 1
			results := make([]GenResult, len(req.Jobs))
			var wg sync.WaitGroup
			sem := make(chan struct{}, concurrency)

			jobCount := len(req.Jobs)
			for i, job := range req.Jobs {
				wg.Add(1)
				go func(idx int, j GenJob) {
					defer wg.Done()
					sem <- struct{}{}
					defer func() { <-sem }()

					src, genErr := generateImage(apiMode, apiKey, baseURL, req.Model, j, refImgSrc)
					r := GenResult{Key: j.Key, Label: j.Label, Src: src}
					if genErr != nil {
						r.Error = genErr.Error()
					}
					results[idx] = r

					// 逐张间延迟，避免 rate limit（最后一张不需要等）
					if idx < jobCount-1 {
						log.Printf("[banner-pb] 第 %d/%d 张完成，等待 35s 再继续（避免 rate limit）", idx+1, jobCount)
						time.Sleep(35 * time.Second)
					}
				}(i, job)
			}
			wg.Wait()

			return e.JSON(200, map[string]any{
				"results": results,
				"model":   req.Model,
				"apiMode": apiMode,
			})
		})

		// 注册保存结果路由
		se.Router.POST("/api/bp/save-results", func(e *core.RequestEvent) error {
			req, err := readJSON[SaveResultRequest](e.Request)
			if err != nil {
				return e.JSON(400, map[string]string{"error": "无效请求: " + err.Error()})
			}

			// 如果没有 versionId，创建新版本
			versionID := req.VersionID
			if versionID == "" {
				// 查已有版本数
				records, _ := app.FindRecordsByFilter("design_versions",
					fmt.Sprintf("project = '%s'", req.ProjectID),
					"-created", 1, 0)

				versionNum := 1
				if len(records) > 0 {
					versionNum = records[0].GetInt("version_number") + 1
				}

				vc, _ := app.FindCollectionByNameOrId("design_versions")
				vr := core.NewRecord(vc)
				vr.Set("project", req.ProjectID)
				vr.Set("version_number", versionNum)
				vr.Set("prompt", req.Prompt)
				vr.Set("model", req.Model)
				vr.Set("api_mode", req.ApiMode)
				vr.Set("status", "completed")

				if saveErr := app.Save(vr); saveErr != nil {
					return e.JSON(500, map[string]string{"error": "创建版本失败: " + saveErr.Error()})
				}
				versionID = vr.Id
			}

			// 保存候选图
			savedIDs := make([]string, 0)
			cc, _ := app.FindCollectionByNameOrId("design_candidates")
			for i, r := range req.Results {
				if r.Src == "" || r.Error != "" {
					continue
				}

				cr := core.NewRecord(cc)
				cr.Set("version", versionID)
				cr.Set("candidate_index", i + 1)
				cr.Set("image_name", fmt.Sprintf("candidate_%d", i+1))
				cr.Set("note", r.Label)
				cr.Set("selected", i == 0)

				if imgErr := saveImageToRecord(app, cr, "image", r.Src, fmt.Sprintf("candidate_%d.png", i+1)); imgErr != nil {
					log.Printf("保存候选图 %d 失败: %v", i+1, imgErr)
					continue
				}

				if saveErr := app.Save(cr); saveErr != nil {
					log.Printf("保存候选记录 %d 失败: %v", i+1, saveErr)
					continue
				}
				savedIDs = append(savedIDs, cr.Id)
			}

			return e.JSON(200, map[string]any{
				"versionId":    versionID,
				"candidateIds": savedIDs,
			})
		})

		return se.Next()
	})

	log.Println("Banner-PB 启动中...")
	log.Println("管理后台: http://127.0.0.1:8090/_/")
	log.Println("API 地址: http://127.0.0.1:8090/api/")

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
