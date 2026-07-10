package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type EvalRequest struct {
	ImageSrc    string `json:"imageSrc"`
	ScorerModel string `json:"scorerModel"`
	ApiBaseUrl  string `json:"apiBaseUrl"`
	ApiKey      string `json:"apiKey"`
	Prompt      string `json:"prompt,omitempty"`
	Title       string `json:"title,omitempty"`
	Subtitle    string `json:"subtitle,omitempty"`
	SizeKey     string `json:"sizeKey,omitempty"`
}

type EvalResult struct {
	OverallScore     float64  `json:"overallScore"`
	CompositionScore float64  `json:"compositionScore"`
	ColorScore       float64  `json:"colorScore"`
	AtmosphereScore  float64  `json:"atmosphereScore"`
	CommercialScore  float64  `json:"commercialScore"`
	PositiveTags     []string `json:"positiveTags"`
	NegativeTags     []string `json:"negativeTags"`
	Suggestions      string   `json:"suggestions"`
}

const evalSystemPrompt = `你是一位资深的电商视觉设计评审专家。请对给定的电商Banner氛围图进行专业评估。

请从以下四个维度打分（每个维度1-10分）：
1. **构图 (composition)**：元素布局是否合理，主体是否突出，留白是否恰当，视觉重心是否明确
2. **色彩 (color)**：配色是否协调，色调是否与电商促销氛围匹配，对比度是否合适
3. **氛围 (atmosphere)**：整体氛围是否符合电商大促场景，光效/粒子/3D等视觉语言是否到位
4. **商业感 (commercial)**：是否具备吸引点击的视觉冲击力，是否适合作为电商Banner背景

再给出：
- overallScore：综合评分（四个维度的加权平均，1-10分）
- positiveTags：做得好的标签（如 #色彩协调 #留白合理），每个以#开头，最多5个
- negativeTags：需要改进的标签（如 #文字区域干扰 #氛围不足），每个以#开头，最多5个
- suggestions：具体的改进建议，用中文写，100字以内

请严格按照以下JSON格式返回，不要包含markdown代码块标记：
{"overallScore":7.5,"compositionScore":8,"colorScore":7,"atmosphereScore":7,"commercialScore":8,"positiveTags":["#标签1","#标签2"],"negativeTags":["#标签1"],"suggestions":"建议文字"}`

func evaluateImage(req EvalRequest, timeout time.Duration) (*EvalResult, error) {
	endpoint := withoutTrailingSlash(req.ApiBaseUrl) + "/chat/completions"

	userPrompt := "请评估这张电商Banner氛围图。"
	if req.Prompt != "" {
		userPrompt += fmt.Sprintf("\n原始生成提示词：%s", req.Prompt)
	}
	if req.SizeKey != "" {
		userPrompt += fmt.Sprintf("\n目标尺寸：%s", req.SizeKey)
	}
	if req.Title != "" {
		userPrompt += fmt.Sprintf("\nBanner主标题：%s", req.Title)
	}

	content := []map[string]any{
		{"type": "text", "text": userPrompt},
		{"type": "image_url", "image_url": map[string]string{"url": req.ImageSrc}},
	}

	body := map[string]any{
		"model": req.ScorerModel,
		"messages": []map[string]any{
			{"role": "system", "content": evalSystemPrompt},
			{"role": "user", "content": content},
		},
		"max_tokens":  1024,
		"temperature": 0.3,
	}
	bodyBytes, _ := json.Marshal(body)

	resp, err := doRequest("POST", endpoint, map[string]string{
		"Authorization": "Bearer " + req.ApiKey,
		"Content-Type":  "application/json",
	}, bytes.NewReader(bodyBytes), timeout)
	if err != nil {
		return nil, fmt.Errorf("评估请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var payload map[string]any
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return nil, fmt.Errorf("评估响应解析失败: %s", string(respBody))
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("评估API返回错误: HTTP %d", resp.StatusCode)
	}

	// extract text from response
	text := extractTextFromChatResponse(payload)
	if text == "" {
		return nil, fmt.Errorf("评估模型未返回文字评估结果")
	}

	// try to parse JSON from text (handle potential markdown code fences)
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)

	var result EvalResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		// fallback: try to extract scores manually
		result = extractScoresManually(text)
	}

	// clamp scores
	result.OverallScore = clamp(result.OverallScore, 1, 10)
	result.CompositionScore = clamp(result.CompositionScore, 1, 10)
	result.ColorScore = clamp(result.ColorScore, 1, 10)
	result.AtmosphereScore = clamp(result.AtmosphereScore, 1, 10)
	result.CommercialScore = clamp(result.CommercialScore, 1, 10)

	return &result, nil
}

func extractTextFromChatResponse(payload map[string]any) string {
	if choices, ok := payload["choices"].([]any); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]any); ok {
			if msg, ok := choice["message"].(map[string]any); ok {
				if content, ok := msg["content"]; ok {
					switch c := content.(type) {
					case string:
						return c
					case []any:
						var parts []string
						for _, item := range c {
							if m, ok := item.(map[string]any); ok {
								if t, ok := m["text"].(string); ok {
									parts = append(parts, t)
								}
							}
						}
						return strings.Join(parts, "\n")
					}
				}
			}
		}
	}
	return ""
}

func extractScoresManually(text string) EvalResult {
	r := EvalResult{}
	r.OverallScore = parseScore(text, "overallScore|overall_score|综合评分|overall")
	r.CompositionScore = parseScore(text, "composition|构图")
	r.ColorScore = parseScore(text, "color|色彩")
	r.AtmosphereScore = parseScore(text, "atmosphere|氛围")
	r.CommercialScore = parseScore(text, "commercial|商业")
	r.PositiveTags = parseTags(text, "positiveTags|positive|优势|优点|positive_tags")
	r.NegativeTags = parseTags(text, "negativeTags|negative|问题|缺点|negative_tags")
	r.Suggestions = extractSuggestions(text)
	return r
}

func parseScore(text, pattern string) float64 {
	re := fmt.Sprintf(`(?i)(?:%s)[^\d]*(\d+(?:\.\d+)?)`, pattern)
	matches := regexp.MustCompile(re).FindStringSubmatch(text)
	if len(matches) > 1 {
		if v, err := strconv.ParseFloat(matches[1], 64); err == nil {
			if v > 10 {
				v = v / 10
			}
			return v
		}
	}
	return 0
}

func parseTags(text, pattern string) []string {
	re := fmt.Sprintf(`(?i)(?:%s)[^#]*((?:#\S+\s*)+)`, pattern)
	matches := regexp.MustCompile(re).FindStringSubmatch(text)
	if len(matches) > 1 {
		tagRe := regexp.MustCompile(`#\S+`)
		tags := tagRe.FindAllString(matches[1], -1)
		result := make([]string, len(tags))
		for i, t := range tags {
			result[i] = strings.TrimSpace(t)
		}
		return result
	}
	return nil
}

func extractSuggestions(text string) string {
	for _, key := range []string{"suggestions", "建议", "改进建议", "改进方向"} {
		re := fmt.Sprintf(`(?i)"%s"\s*:\s*"([^"]+)"`, key)
		matches := regexp.MustCompile(re).FindStringSubmatch(text)
		if len(matches) > 1 {
			return matches[1]
		}
	}
	return ""
}

func clamp(v float64, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
