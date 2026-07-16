import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withApiDebug(error, debug) {
  Object.assign(error, { apiDebug: debug });
  return error;
}

function errorDebug(error) {
  return error && typeof error === "object" ? error.apiDebug : null;
}

function isAsciiHeaderValue(value) {
  return /^[\x20-\x7E]+$/.test(value);
}

function isLikelyPlaceholderApiKey(value) {
  return /你的|示例|占位|placeholder|your[_ -]?key/i.test(value);
}

function isRetriableGenerationError(error) {
  const message = errorMessage(error).toLowerCase();
  return ["abort", "econnreset", "etimedout", "fetch failed", "socket", "terminated", "timeout"].some((token) => message.includes(token));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} 请求超时，已等待 ${Math.round(timeoutMs / 1000)} 秒`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetries(task, { attempts, label }) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetriableGenerationError(error)) {
        break;
      }
      await wait(800 * attempt);
    }
  }

  const error = new Error(`${label} 生成失败：${errorMessage(lastError)}`);
  const debug = errorDebug(lastError);
  if (debug) {
    withApiDebug(error, debug);
  }
  throw error;
}

function imageSizeForJob(job, model) {
  const width = Number(job.width) || 1536;
  const height = Number(job.height) || 1024;

  if (model === "gpt-image-1") {
    if (height > width) return "1024x1536";
    if (width > height) return "1536x1024";
    return "1024x1024";
  }

  const minPixels = 655360;
  const multiple = 16;
  const scale = Math.max(1, Math.sqrt(minPixels / Math.max(width * height, 1)));
  const targetWidth = Math.ceil((width * scale) / multiple) * multiple;
  const targetHeight = Math.ceil((height * scale) / multiple) * multiple;

  return `${targetWidth}x${targetHeight}`;
}

function dashScopeSizeForJob(job, model) {
  return imageSizeForJob(job, model).replace("x", "*");
}

async function fetchImageAsDataUrl(url, timeoutMs = 120000) {
  const response = await fetchWithTimeout(url, {}, timeoutMs, "图片下载");
  if (!response.ok) {
    throw new Error(`图片下载失败：${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function extractImageSource(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const dataUrl = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrl) return dataUrl[0];

    const markdownImage = value.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/);
    if (markdownImage) return markdownImage[1];

    const url = value.match(/https?:\/\/[^\s"'<>）)]+/);
    if (url) return url[0];

    const compact = value.replace(/\s/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 1000) {
      return `data:image/png;base64,${compact}`;
    }

    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const source = extractImageSource(item);
      if (source) return source;
    }
    return "";
  }

  if (typeof value === "object") {
    if (typeof value.b64_json === "string") return `data:image/png;base64,${value.b64_json}`;
    if (typeof value.data_url === "string") return value.data_url;
    if (typeof value.dataUrl === "string") return value.dataUrl;
    if (typeof value.image === "string") return extractImageSource(value.image);
    if (typeof value.image_data === "string") return extractImageSource(value.image_data);
    if (typeof value.imageData === "string") return extractImageSource(value.imageData);
    if (typeof value.image_base64 === "string") return `data:image/png;base64,${value.image_base64}`;
    if (typeof value.imageBase64 === "string") return `data:image/png;base64,${value.imageBase64}`;
    if (typeof value.base64 === "string") return `data:image/png;base64,${value.base64}`;
    if (typeof value.b64 === "string") return `data:image/png;base64,${value.b64}`;
    if (typeof value.uri === "string") return value.uri;
    if (typeof value.url === "string") return value.url;
    if (typeof value.image_url === "string") return value.image_url;
    if (typeof value.image_url?.url === "string") return value.image_url.url;

    for (const key of ["data", "content", "message", "choices", "output", "images", "result", "results", "artifacts", "files"]) {
      const source = extractImageSource(value[key]);
      if (source) return source;
    }
  }

  return "";
}

function payloadPreview(value) {
  if (!value) return "";

  const directContent = value?.choices?.[0]?.message?.content;
  const source = directContent ?? value;
  const text = typeof source === "string" ? source : JSON.stringify(source);
  return text.replace(/\s+/g, " ").slice(0, 180);
}

function hasEmptyAssistantMessage(value) {
  const message = value?.choices?.[0]?.message;
  if (!message) return false;

  return !message.content && !message.images && !message.image && !message.image_url;
}

function defaultBaseUrlForModel(model, apiMode) {
  if (apiMode === "dashscope-wan") {
    return process.env.DASHSCOPE_API_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
  }

  if (apiMode === "chat-completions" && model.startsWith("openai/")) {
    return process.env.IMAGE_API_BASE_URL || process.env.OPENAI_BASE_URL || "https://llm.hupan.info/v1";
  }

  return process.env.IMAGE_API_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

function apiKeyForMode(apiMode) {
  if (apiMode === "dashscope-wan") {
    return process.env.DASHSCOPE_API_KEY || process.env.QIANWEN_API_KEY || process.env.NEW_API_KEY || process.env.OPENAI_API_KEY;
  }

  return process.env.NEW_API_KEY || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QIANWEN_API_KEY;
}

async function normalizeImageSource(source, timeoutMs = 120000) {
  if (source.startsWith("data:image/")) return source;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return fetchImageAsDataUrl(source, timeoutMs);
  }

  throw new Error("图片接口没有返回可用的图片 URL 或 base64 数据");
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

async function generateImagesApiImage({ apiKey, baseUrl, job, model, quality, timeoutMs }) {
  const size = imageSizeForJob(job, model);
  const endpoint = `${withoutTrailingSlash(baseUrl)}/images/generations`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: job.prompt,
      quality,
      size,
      n: 1,
    }),
  }, timeoutMs, job.label || job.key || "图片生成");

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: { message: text } };
  }

  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI 图片接口返回 ${response.status}`;
    throw withApiDebug(new Error(message), {
      apiMode: "images",
      endpoint,
      model,
      rawBody: text,
      status: response.status,
      statusText: response.statusText,
    });
  }

  const image = payload?.data?.[0];
  if (image?.b64_json) {
    return {
      size,
      src: `data:image/png;base64,${image.b64_json}`,
    };
  }

  if (image?.url) {
    return {
      size,
      src: await fetchImageAsDataUrl(image.url, timeoutMs),
    };
  }

  throw withApiDebug(new Error("OpenAI 图片接口没有返回图片数据"), {
    apiMode: "images",
    endpoint,
    model,
    rawBody: text,
    status: response.status,
    statusText: response.statusText,
  });
}

function chatCompletionContent(prompt, referenceImage) {
  const content = [
    {
      type: "text",
      text: prompt,
    },
  ];

  if (referenceImage?.src) {
    content.push({
      type: "image_url",
      image_url: {
        url: referenceImage.src,
      },
    });
  }

  return content;
}

async function generateChatCompletionImage({ apiKey, baseUrl, job, maxTokens, model, referenceImage, temperature, timeoutMs }) {
  const size = imageSizeForJob(job, model);
  const prompt = [
    "请生成一张可直接用于电商 Banner 的氛围图，不要只输出文字描述。",
    job.prompt,
    `目标画布比例参考：${job.width}x${job.height}。`,
    "不要在图片中生成任何文字、数字、Logo、水印或可读字符；主副标题会由系统模板另外叠加。",
    "如果接口支持图片输出，请返回图片数据或图片 URL。",
  ].join("\n");

  const endpoint = `${withoutTrailingSlash(baseUrl)}/chat/completions`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_tokens: maxTokens,
      model,
      messages: [
        {
          role: "user",
          content: chatCompletionContent(prompt, referenceImage),
        },
      ],
      temperature,
    }),
  }, timeoutMs, job.label || job.key || "图片生成");

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: { message: text } };
  }

  if (!response.ok) {
    const message = payload?.error?.message || `Chat Completions 图片接口返回 ${response.status}`;
    throw withApiDebug(new Error(message), {
      apiMode: "chat-completions",
      endpoint,
      model,
      rawBody: text,
      status: response.status,
      statusText: response.statusText,
    });
  }

  const source = extractImageSource(payload);
  if (!source) {
    if (hasEmptyAssistantMessage(payload)) {
      throw withApiDebug(new Error(`当前模型「${model}」没有返回图片数据，且 assistant 消息为空。请确认它是生图模型；如果它走图片接口，请把 IMAGE_API_MODE 改成 images 后重启 dev server。`), {
        apiMode: "chat-completions",
        endpoint,
        model,
        rawBody: text,
        status: response.status,
        statusText: response.statusText,
      });
    }

    const preview = payloadPreview(payload);
    throw withApiDebug(new Error(`Chat Completions 接口未返回图片数据${preview ? `，返回内容：${preview}` : ""}`), {
      apiMode: "chat-completions",
      endpoint,
      model,
      rawBody: text,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return {
    size,
    src: await normalizeImageSource(source, timeoutMs),
  };
}

function dashScopeContent(prompt, referenceImage) {
  const content = [{ text: prompt }];

  if (referenceImage?.src) {
    content.push({ image: referenceImage.src });
  }

  return content;
}

async function generateDashScopeWanImage({ apiKey, baseUrl, job, model, referenceImage, timeoutMs }) {
  const size = dashScopeSizeForJob(job, model);
  const prompt = [
    "请生成一张可直接用于电商 Banner 的氛围图，不要只输出文字描述。",
    job.prompt,
    `目标画布比例参考：${job.width}x${job.height}。`,
    "不要在图片中生成任何文字、数字、Logo、水印或可读字符；主副标题会由系统模板另外叠加。",
  ].join("\n");
  const endpoint = `${withoutTrailingSlash(baseUrl)}/services/aigc/multimodal-generation/generation`;

  const parameters = {
    n: 1,
    size,
    watermark: false,
  };

  if (!referenceImage?.src) {
    parameters.thinking_mode = true;
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        messages: [
          {
            role: "user",
            content: dashScopeContent(prompt, referenceImage),
          },
        ],
      },
      model,
      parameters,
    }),
  }, timeoutMs, job.label || job.key || "图片生成");

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: { message: text } };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || `DashScope 图片接口返回 ${response.status}`;
    throw withApiDebug(new Error(message), {
      apiMode: "dashscope-wan",
      endpoint,
      model,
      rawBody: text,
      status: response.status,
      statusText: response.statusText,
    });
  }

  const source = extractImageSource(payload);
  if (!source) {
    const preview = payloadPreview(payload);
    throw withApiDebug(new Error(`DashScope 接口未返回图片数据${preview ? `，返回内容：${preview}` : ""}`), {
      apiMode: "dashscope-wan",
      endpoint,
      model,
      rawBody: text,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return {
    size,
    src: await normalizeImageSource(source, timeoutMs),
  };
}

// 异步尝试将 Vite 代理的生成结果保存到 PocketBase 后端
async function trySaveToBackend(iterationId, results, body, model) {
  const PB_URL = "http://127.0.0.1:8090";
  try {
    // 先检查后端是否可用
    const healthCheck = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!healthCheck.ok) return;

    // 保存 generation config
    const saveResp = await fetch(`${PB_URL}/api/custom/generations/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId,
        title: body.title || "",
        subtitle: body.subtitle || "",
        prompt: body.prompt || "",
        imageModel: model,
        apiMode: body.apiMode || "",
        results: results.map((r) => ({
          key: r.key,
          label: r.label,
          width: r.width,
          height: r.height,
          src: r.src,
          promptUsed: r.promptUsed || body.prompt || "",
          modelUsed: r.modelUsed || model,
          size: r.size || "",
        })),
      }),
    });
    if (saveResp.ok) {
      console.log(`[vite proxy] 已将 ${results.length} 张图保存到后端`);
    }
  } catch {
    // 后端不可用，静默跳过
  }
}

function imageGenerationMiddleware() {
  return {
    name: "banner-image-generation-api",
    configureServer(server) {
      server.middlewares.use("/api/generate-images", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "只支持 POST 请求" });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const mode = body.mode === "single" ? "single" : "adaptive";
          const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
          const requestedApiMode = typeof body.apiMode === "string" ? body.apiMode.trim() : "";
          const model = requestedModel || process.env.OPENAI_IMAGE_MODEL || process.env.QIANWEN_IMAGE_MODEL || "openai/gpt-5.4-image-2";
          const isWanModel = model.startsWith("wan") || model.startsWith("qwen-image");
          const apiMode = requestedApiMode || process.env.IMAGE_API_MODE || (isWanModel ? "dashscope-wan" : "chat-completions");
          const baseUrl = defaultBaseUrlForModel(model, apiMode);
          const rawApiKey = apiKeyForMode(apiMode);

          if (!rawApiKey) {
            sendJson(res, 400, {
              error: apiMode === "dashscope-wan"
                ? "当前模型需要 DASHSCOPE_API_KEY 或 QIANWEN_API_KEY。请配置后重启 dev server，再点击「生成」。"
                : "当前模型需要 NEW_API_KEY 或 OPENAI_API_KEY。请配置后重启 dev server，再点击「生成」。",
            });
            return;
          }

          const apiKey = rawApiKey.trim();
          if (!isAsciiHeaderValue(apiKey) || isLikelyPlaceholderApiKey(apiKey)) {
            sendJson(res, 400, {
              error: "当前 API Key 不是有效 Key。请不要填写「你的 Key」这类占位文字，改成真实 API Key 后重启 dev server。",
            });
            return;
          }

          const maxTokens = Number(process.env.IMAGE_API_MAX_TOKENS || 8192);
          const quality = process.env.OPENAI_IMAGE_QUALITY || "high";
          const temperature = Number(process.env.OPENAI_IMAGE_TEMPERATURE || 0.7);
          const defaultConcurrency = apiMode === "chat-completions" || apiMode === "dashscope-wan" ? 1 : 3;
          const concurrency = Number(process.env.IMAGE_API_CONCURRENCY || defaultConcurrency);
          const retryCount = Number(process.env.IMAGE_API_RETRIES || 1);
          const timeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS || 600000);
          const jobs = Array.isArray(body.jobs) ? body.jobs : [];
          const referenceImage = body.referenceImage?.src ? body.referenceImage : null;

          if (!jobs.length) {
            sendJson(res, 400, { error: "缺少生图任务" });
            return;
          }

          const results = await mapWithConcurrency(jobs, concurrency, async (job) => {
            const label = job.label || job.key || "图片";
            return withRetries(async () => {
              let generated;
              if (apiMode === "dashscope-wan") {
                generated = await generateDashScopeWanImage({ apiKey, baseUrl, job, model, referenceImage, timeoutMs });
              } else if (apiMode === "chat-completions") {
                generated = await generateChatCompletionImage({ apiKey, baseUrl, job, maxTokens, model, referenceImage, temperature, timeoutMs });
              } else {
                generated = await generateImagesApiImage({ apiKey, baseUrl, job, model, quality, timeoutMs });
              }
              return { ...job, ...generated };
            }, {
              attempts: retryCount + 1,
              label: `「${label}」`,
            });
          });

          const templateImages = {};
          const templateImageSets = {};
          if (mode === "adaptive") {
            results.forEach((result) => {
              if (result.candidateId) {
                templateImageSets[result.candidateId] = templateImageSets[result.candidateId] || {};
                templateImageSets[result.candidateId][result.key] = result.src;
              } else {
                templateImages[result.key] = result.src;
              }
            });
          }

          const adaptiveCandidateIds = Object.keys(templateImageSets);
          const candidates = mode === "adaptive" && adaptiveCandidateIds.length
            ? adaptiveCandidateIds.map((candidateId, index) => {
              const representative = results.find((result) => result.candidateId === candidateId);
              const setSize = Object.keys(templateImageSets[candidateId]).length;
              return {
                id: candidateId,
                name: representative?.candidateName || `候选方向 ${index + 1}`,
                note: `${setSize} 张尺寸适配图，${representative?.candidateNote || `由 ${model} 生成`}`,
                src: representative?.src,
              };
            })
            : results.slice(0, 3).map((result, index) => ({
              id: `openai-${Date.now()}-${index}`,
              name: mode === "adaptive" ? `${result.label} 适配图` : `候选图 ${index + 1}`,
              note: `${result.size}，由 ${model} 生成`,
              src: result.src,
            }));

          if (mode === "adaptive" && adaptiveCandidateIds.length) {
            Object.assign(templateImages, templateImageSets[adaptiveCandidateIds[0]]);
          }

          sendJson(res, 200, {
            candidates,
            apiMode,
            concurrency,
            maxTokens,
            model,
            quality,
            retryCount,
            templateImages,
            templateImageSets,
            timeoutMs,
          });

          // 异步尝试将结果保存到 PocketBase 后端（不阻塞响应）
          const iterationId = body.iterationId;
          if (iterationId) {
            trySaveToBackend(iterationId, results, body, model).catch(() => {
              // 静默失败，不妨碍主流程
            });
          }
        } catch (error) {
          sendJson(res, 500, {
            apiDebug: errorDebug(error),
            error: error instanceof Error ? error.message : "图片生成失败",
          });
        }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), imageGenerationMiddleware()],
});
