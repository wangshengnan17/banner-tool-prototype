package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// ---- types ----

type ImageJob struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Prompt      string `json:"prompt"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Title       string `json:"title,omitempty"`
	Subtitle    string `json:"subtitle,omitempty"`
	CandidateId string `json:"candidateId,omitempty"`
}

type GenerateRequest struct {
	Mode           string     `json:"mode"`
	Jobs           []ImageJob `json:"jobs"`
	Model          string     `json:"model"`
	ApiMode        string     `json:"apiMode"`
	ReferenceImage *RefImage  `json:"referenceImage,omitempty"`
}

type RefImage struct {
	Name string `json:"name,omitempty"`
	Src  string `json:"src"`
}

type GenerateResult struct {
	Key         string `json:"key"`
	Label       string `json:"label,omitempty"`
	CandidateId string `json:"candidateId,omitempty"`
	Src         string `json:"src"`
	Size        string `json:"size"`
	ModelUsed   string `json:"modelUsed"`
	PromptUsed  string `json:"promptUsed"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}

type ApiDebug struct {
	ApiMode    string `json:"apiMode"`
	Endpoint   string `json:"endpoint,omitempty"`
	Model      string `json:"model,omitempty"`
	RawBody    string `json:"rawBody,omitempty"`
	Status     int    `json:"status"`
	StatusText string `json:"statusText,omitempty"`
}

// ---- image size calculation ----

func imageSizeForJob(job ImageJob, model string) string {
	width := job.Width
	height := job.Height
	if width <= 0 {
		width = 1536
	}
	if height <= 0 {
		height = 1024
	}

	if model == "gpt-image-1" {
		if height > width {
			return "1024x1536"
		}
		if width > height {
			return "1536x1024"
		}
		return "1024x1024"
	}

	minPixels := 655360.0
	multiple := 16
	scale := math.Max(1, math.Sqrt(minPixels/math.Max(float64(width*height), 1)))
	targetWidth := int(math.Ceil(float64(int(math.Ceil(float64(width)*scale)))/float64(multiple))) * multiple
	targetHeight := int(math.Ceil(float64(int(math.Ceil(float64(height)*scale)))/float64(multiple))) * multiple

	return fmt.Sprintf("%dx%d", targetWidth, targetHeight)
}

func dashScopeSizeForJob(job ImageJob, model string) string {
	return strings.ReplaceAll(imageSizeForJob(job, model), "x", "*")
}

// ---- HTTP helpers ----

func withoutTrailingSlash(s string) string {
	return strings.TrimRight(s, "/")
}

func isRetriable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	tokens := []string{"abort", "econnreset", "etimedout", "fetch failed", "socket", "terminated", "timeout", "connection reset"}
	for _, t := range tokens {
		if strings.Contains(msg, t) {
			return true
		}
	}
	return false
}

func doRequest(method, url string, headers map[string]string, body io.Reader, timeout time.Duration) (*http.Response, error) {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return client.Do(req)
}

// ---- image extraction ----

var (
	reDataUrl        = regexp.MustCompile(`data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+`)
	reMarkdownImage  = regexp.MustCompile(`!\[[^\]]*]\((https?://[^)\s]+)\)`)
	rePlainUrl       = regexp.MustCompile(`https?://[^\s"'<>)]+`)
	reBase64String   = regexp.MustCompile(`^[A-Za-z0-9+/=]+$`)
)

func extractImageSource(payload any) string {
	if payload == nil {
		return ""
	}

	switch v := payload.(type) {
	case string:
		if m := reDataUrl.FindString(v); m != "" {
			return m
		}
		if m := reMarkdownImage.FindStringSubmatch(v); len(m) > 1 {
			return m[1]
		}
		if m := rePlainUrl.FindString(v); m != "" {
			return m
		}
		compact := strings.ReplaceAll(v, " ", "")
		if reBase64String.MatchString(compact) && len(compact) > 1000 {
			return "data:image/png;base64," + compact
		}
		return ""
	case []any:
		for _, item := range v {
			if s := extractImageSource(item); s != "" {
				return s
			}
		}
	case map[string]any:
		if b64, ok := v["b64_json"].(string); ok {
			return "data:image/png;base64," + b64
		}
		if u, ok := v["data_url"].(string); ok {
			return u
		}
		if u, ok := v["dataUrl"].(string); ok {
			return u
		}
		if u, ok := v["url"].(string); ok {
			return u
		}
		if u, ok := v["uri"].(string); ok {
			return u
		}
		if u, ok := v["image_url"].(string); ok {
			return u
		}
		if imgUrl, ok := v["image_url"].(map[string]any); ok {
			if u, ok2 := imgUrl["url"].(string); ok2 {
				return u
			}
		}
		if b64, ok := v["image_base64"].(string); ok {
			return "data:image/png;base64," + b64
		}
		if b64, ok := v["imageBase64"].(string); ok {
			return "data:image/png;base64," + b64
		}
		if b64, ok := v["base64"].(string); ok {
			return "data:image/png;base64," + b64
		}
		if b64, ok := v["b64"].(string); ok {
			return "data:image/png;base64," + b64
		}
		if img, ok := v["image"].(string); ok {
			if s := extractImageSource(img); s != "" {
				return s
			}
		}
		if img, ok := v["image_data"].(string); ok {
			if s := extractImageSource(img); s != "" {
				return s
			}
		}
		// try nested keys
		for _, key := range []string{"data", "content", "message", "choices", "output", "images", "result", "results"} {
			if nested, ok := v[key]; ok {
				if s := extractImageSource(nested); s != "" {
					return s
				}
			}
		}
	}
	return ""
}

func fetchImageAsDataUrl(imageUrl string, timeout time.Duration) (string, error) {
	resp, err := doRequest("GET", imageUrl, nil, nil, timeout)
	if err != nil {
		return "", fmt.Errorf("图片下载失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("图片下载失败: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}

	return fmt.Sprintf("data:%s;base64,%s", contentType, base64.StdEncoding.EncodeToString(data)), nil
}

func normalizeImageSource(source string, timeout time.Duration) (string, error) {
	if strings.HasPrefix(source, "data:") {
		return source, nil
	}
	return fetchImageAsDataUrl(source, timeout)
}

// ---- Generation functions ----

func generateImagesApiImage(apiKey, baseUrl string, job ImageJob, model, quality string, timeout time.Duration) (string, string, error) {
	size := imageSizeForJob(job, model)
	endpoint := withoutTrailingSlash(baseUrl) + "/images/generations"

	body := map[string]any{
		"model":  model,
		"prompt": job.Prompt,
		"n":      1,
		"size":   size,
	}
	if quality != "" {
		body["quality"] = quality
	}
	bodyBytes, _ := json.Marshal(body)

	resp, err := doRequest("POST", endpoint, map[string]string{
		"Authorization": "Bearer " + apiKey,
		"Content-Type":  "application/json",
	}, bytes.NewReader(bodyBytes), timeout)
	if err != nil {
		return "", size, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var payload map[string]any
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return "", size, fmt.Errorf("OpenAI Images API: %s (status %d)", string(respBody), resp.StatusCode)
	}

	if resp.StatusCode != 200 {
		errMsg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if e, ok := payload["error"].(map[string]any); ok {
			if m, ok2 := e["message"].(string); ok2 {
				errMsg = m
			}
		}
		return "", size, fmt.Errorf("OpenAI Images API: %s", errMsg)
	}

	data, ok := payload["data"].([]any)
	if !ok || len(data) == 0 {
		return "", size, fmt.Errorf("OpenAI Images API 没有返回图片数据")
	}

	first := data[0].(map[string]any)
	if b64, ok := first["b64_json"].(string); ok && len(b64) > 100 {
		return "data:image/png;base64," + b64, size, nil
	}
	if u, ok := first["url"].(string); ok && u != "" {
		log.Printf("[images] 下载图片 URL: %s (len=%d)", u[:min(80, len(u))], len(u))
		src, err := fetchImageAsDataUrl(u, timeout)
		if err != nil {
			log.Printf("[images] 下载失败: %v", err)
		} else {
			log.Printf("[images] 下载成功, data URL 长度: %d", len(src))
		}
		return src, size, err
	}

	return "", size, fmt.Errorf("OpenAI Images API 没有返回图片数据")
}

func generateChatCompletionImage(apiKey, baseUrl string, job ImageJob, model string, referenceImage *RefImage, temperature float64, maxTokens int, timeout time.Duration) (string, string, error) {
	size := imageSizeForJob(job, model)
	endpoint := withoutTrailingSlash(baseUrl) + "/chat/completions"

	promptLines := []string{
		fmt.Sprintf("请生成一张可直接用于电商 Banner 的图片，图中必须包含以下文字信息："),
		fmt.Sprintf("- 主标题：「%s」", job.Title),
	}
	if job.Subtitle != "" {
		promptLines = append(promptLines, fmt.Sprintf("- 副标题：「%s」", job.Subtitle))
	}
	promptLines = append(promptLines,
		"文字排版要求：主标题醒目突出，副标题（如果有）略小一些；文字不要贴边，四周留有呼吸空间。",
		job.Prompt,
		fmt.Sprintf("目标画布比例参考：%dx%d。", job.Width, job.Height),
		"不要添加 Logo、水印或其他无关文字。",
		"如果接口支持图片输出，请返回图片数据或图片 URL。",
	)
	prompt := strings.Join(promptLines, "\n")

	content := []map[string]any{
		{"type": "text", "text": prompt},
	}
	if referenceImage != nil && referenceImage.Src != "" {
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]string{"url": referenceImage.Src},
		})
	}

	body := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "user", "content": content},
		},
		"modalities":   []string{"image", "text"},
		"max_tokens":   maxTokens,
		"temperature":  temperature,
	}
	bodyBytes, _ := json.Marshal(body)

	resp, err := doRequest("POST", endpoint, map[string]string{
		"Authorization": "Bearer " + apiKey,
		"Content-Type":  "application/json",
	}, bytes.NewReader(bodyBytes), timeout)
	if err != nil {
		return "", size, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var payload map[string]any
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return "", size, fmt.Errorf("Chat Completions: %s (status %d)", string(respBody), resp.StatusCode)
	}

	if resp.StatusCode != 200 {
		errMsg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if e, ok := payload["error"].(map[string]any); ok {
			if m, ok2 := e["message"].(string); ok2 {
				errMsg = m
			}
		}
		return "", size, fmt.Errorf("Chat Completions: %s", errMsg)
	}

	source := extractImageSource(payload)
	if source == "" {
		return "", size, fmt.Errorf("Chat Completions 接口未返回图片数据")
	}

	src, err := normalizeImageSource(source, timeout)
	return src, size, err
}

func generateDashScopeWanImage(apiKey, baseUrl string, job ImageJob, model string, referenceImage *RefImage, timeout time.Duration) (string, string, error) {
	size := dashScopeSizeForJob(job, model)
	endpoint := withoutTrailingSlash(baseUrl) + "/services/aigc/multimodal-generation/generation"

	prompt := fmt.Sprintf(
		"请生成一张可直接用于电商 Banner 的氛围图，不要只输出文字描述。\n%s\n目标画布比例参考：%dx%d。\n不要在图片中生成任何文字、数字、Logo、水印或可读字符；主副标题会由系统模板另外叠加。",
		job.Prompt, job.Width, job.Height,
	)

	content := []map[string]any{
		{"text": prompt},
	}
	if referenceImage != nil && referenceImage.Src != "" {
		content = append(content, map[string]any{"image": referenceImage.Src})
	}

	parameters := map[string]any{
		"n":         1,
		"size":      size,
		"watermark": false,
	}
	if referenceImage == nil || referenceImage.Src == "" {
		parameters["thinking_mode"] = true
	}

	body := map[string]any{
		"input": map[string]any{
			"messages": []map[string]any{
				{"role": "user", "content": content},
			},
		},
		"model":      model,
		"parameters": parameters,
	}
	bodyBytes, _ := json.Marshal(body)

	resp, err := doRequest("POST", endpoint, map[string]string{
		"Authorization": "Bearer " + apiKey,
		"Content-Type":  "application/json",
	}, bytes.NewReader(bodyBytes), timeout)
	if err != nil {
		return "", size, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var payload map[string]any
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return "", size, fmt.Errorf("DashScope: %s (status %d)", string(respBody), resp.StatusCode)
	}

	if resp.StatusCode != 200 {
		errMsg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if e, ok := payload["message"].(string); ok {
			errMsg = e
		} else if e, ok := payload["error"].(map[string]any); ok {
			if m, ok2 := e["message"].(string); ok2 {
				errMsg = m
			}
		}
		return "", size, fmt.Errorf("DashScope: %s", errMsg)
	}

	// try extract from known structure: output.choices[].message.content[].image
	if output, ok := payload["output"].(map[string]any); ok {
		if choices, ok := output["choices"].([]any); ok && len(choices) > 0 {
			if choice, ok := choices[0].(map[string]any); ok {
				if msg, ok := choice["message"].(map[string]any); ok {
					if contents, ok := msg["content"].([]any); ok {
						for _, c := range contents {
							if cm, ok := c.(map[string]any); ok {
								if img, ok := cm["image"]; ok {
									imgStr := fmt.Sprint(img)
									if src, err := normalizeImageSource(imgStr, timeout); err == nil {
										return src, size, nil
									}
								}
							}
						}
					}
				}
			}
		}
	}

	source := extractImageSource(payload)
	if source == "" {
		return "", size, fmt.Errorf("DashScope 接口未返回图片数据")
	}

	src, err := normalizeImageSource(source, timeout)
	return src, size, err
}

// ---- retry + concurrency ----

type generateFn func() (src, size string, err error)

func withRetries(fn generateFn, maxRetries int, label string) (string, string, error) {
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[%s] 第 %d/%d 次尝试...", label, attempt, maxRetries)
		src, size, err := fn()
		if err == nil {
			log.Printf("[%s] 成功", label)
			return src, size, nil
		}
		lastErr = err
		log.Printf("[%s] 失败: %v", label, err)
		if attempt >= maxRetries || !isRetriable(err) {
			break
		}
		time.Sleep(time.Duration(800*attempt) * time.Millisecond)
	}
	log.Printf("[%s] 已放弃（重试 %d 次后仍失败）", label, maxRetries)
	return "", "", fmt.Errorf("%s 生成失败: %w", label, lastErr)
}

func mapWithConcurrency[T any, R any](items []T, concurrency int, fn func(T) (R, error)) ([]R, error) {
	if concurrency <= 0 {
		concurrency = 1
	}
	if concurrency > len(items) {
		concurrency = len(items)
	}

	results := make([]R, len(items))
	ch := make(chan struct {
		idx int
		val R
		err error
	}, len(items))

	sem := make(chan struct{}, concurrency)
	for i, item := range items {
		go func(index int, it T) {
			sem <- struct{}{}
			defer func() { <-sem }()
			r, e := fn(it)
			ch <- struct {
				idx int
				val R
				err error
			}{index, r, e}
		}(i, item)
	}

	var firstErr error
	for range items {
		res := <-ch
		if res.err != nil && firstErr == nil {
			firstErr = res.err
		}
		results[res.idx] = res.val
	}

	return results, firstErr
}

// ---- main generation dispatcher ----

func generateAllImages(req GenerateRequest, apiKey, baseUrl string) ([]GenerateResult, error) {
	timeout := time.Duration(envInt("IMAGE_API_TIMEOUT_MS", 600000)) * time.Millisecond
	concurrency := envInt("IMAGE_API_CONCURRENCY", 1)
	if concurrency <= 0 {
		concurrency = 1
	}
	maxRetries := envInt("IMAGE_API_RETRIES", 1) + 1

	quality := envDefault("OPENAI_IMAGE_QUALITY", "high")
	maxTokens := envInt("IMAGE_API_MAX_TOKENS", 8192)
	temperature := envFloat("OPENAI_IMAGE_TEMPERATURE", 0.7)

	fn := func(job ImageJob) (GenerateResult, error) {
		label := job.Label
		if label == "" {
			label = job.Key
		}

		src, size, err := withRetries(func() (string, string, error) {
			switch req.ApiMode {
			case "dashscope-wan":
				return generateDashScopeWanImage(apiKey, baseUrl, job, req.Model, req.ReferenceImage, timeout)
			case "chat-completions":
				return generateChatCompletionImage(apiKey, baseUrl, job, req.Model, req.ReferenceImage, temperature, maxTokens, timeout)
			default:
				return generateImagesApiImage(apiKey, baseUrl, job, req.Model, quality, timeout)
			}
		}, maxRetries, label)

		if err != nil {
			return GenerateResult{}, err
		}

		return GenerateResult{
			Key:        job.Key,
			Label:      job.Label,
			Src:        src,
			Size:       size,
			ModelUsed:  req.Model,
			PromptUsed: job.Prompt,
			Width:      job.Width,
			Height:     job.Height,
		}, nil
	}

	return mapWithConcurrency(req.Jobs, concurrency, fn)
}

// generateAllImagesStream — 流式版本，每完成一张图即回调 onResult
func generateAllImagesStream(req GenerateRequest, apiKey, baseUrl string, onResult func(GenerateResult), onError func(string, error)) {
	timeout := time.Duration(envInt("IMAGE_API_TIMEOUT_MS", 600000)) * time.Millisecond
	concurrency := envInt("IMAGE_API_CONCURRENCY", 1)
	if concurrency <= 0 {
		concurrency = 1
	}
	maxRetries := envInt("IMAGE_API_RETRIES", 1) + 1

	quality := envDefault("OPENAI_IMAGE_QUALITY", "high")
	maxTokens := envInt("IMAGE_API_MAX_TOKENS", 8192)
	temperature := envFloat("OPENAI_IMAGE_TEMPERATURE", 0.7)

	type jobResult struct {
		job ImageJob
		res GenerateResult
		err error
	}

	results := make(chan jobResult, len(req.Jobs))
	sem := make(chan struct{}, concurrency)

	for _, job := range req.Jobs {
		go func(j ImageJob) {
			sem <- struct{}{}
			defer func() { <-sem }()

			label := j.Label
			if label == "" {
				label = j.Key
			}

			src, size, err := withRetries(func() (string, string, error) {
				switch req.ApiMode {
				case "dashscope-wan":
					return generateDashScopeWanImage(apiKey, baseUrl, j, req.Model, req.ReferenceImage, timeout)
				case "chat-completions":
					return generateChatCompletionImage(apiKey, baseUrl, j, req.Model, req.ReferenceImage, temperature, maxTokens, timeout)
				default:
					return generateImagesApiImage(apiKey, baseUrl, j, req.Model, quality, timeout)
				}
			}, maxRetries, label)

			results <- jobResult{
				job: j,
				res: GenerateResult{
					Key:        j.Key,
					Label:      j.Label,
					Src:        src,
					Size:       size,
					ModelUsed:  req.Model,
					PromptUsed: j.Prompt,
					Width:      j.Width,
					Height:     j.Height,
				},
				err: err,
			}

			// 逐张间延迟，避免 rate limit
			delaySec := envInt("IMAGE_API_JOB_DELAY_SEC", 600)
			if delaySec > 0 {
				time.Sleep(time.Duration(delaySec) * time.Second)
			}
		}(job)
	}

	completed := 0
	total := len(req.Jobs)
	for completed < total {
		r := <-results
		if r.err != nil {
			onError(r.job.Key, r.err)
		} else {
			onResult(r.res)
		}
		completed++
	}
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		var n float64
		if _, err := fmt.Sscanf(v, "%f", &n); err == nil {
			return n
		}
	}
	return fallback
}
