import pb from "./pb";

const PB = pb;
const API = `${PB.baseUrl}/api`;

// Helper: fetch & parse JSON, throw on error
// Auto-attach auth token from PocketBase authStore
function authHeaders() {
  const token = PB.authStore.token;
  return token ? { Authorization: token } : {};
}

async function get(url) {
  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);
  return resp.json();
}

async function post(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...headers },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || err.message || `请求失败 (${resp.status})`);
  }
  return resp.json();
}

async function del(url) {
  const resp = await fetch(url, { method: "DELETE", headers: authHeaders() });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `删除失败 (${resp.status})`);
  }
  return resp.json();
}

// Paginated list helper
async function list(collection, { filter, sort, page = 1, perPage = 500 } = {}) {
  let url = `${API}/collections/${collection}/records?page=${page}&perPage=${perPage}`;
  if (filter) url += `&filter=${encodeURIComponent(filter)}`;
  if (sort) url += `&sort=${encodeURIComponent(sort)}`;
  const data = await get(url);
  return data.items || [];
}

// Create record with auto-owner
async function create(collection, data) {
  const userId = PB.authStore.model?.id;
  const body = userId ? { ...data, owner: userId } : { ...data, owner: "" };
  const result = await post(`${API}/collections/${collection}/records`, body);
  return result;
}

// ---- Projects ----

export async function listProjects() {
  return list("projects", { sort: "-id" });
}

export async function createProject(data) {
  return create("projects", { ...data, status: "active" });
}

// ---- Tasks ----

export async function listTasks(projectId) {
  return list("tasks", { filter: `project="${projectId}"`, sort: "-id" });
}

export async function createTask(data) {
  return create("tasks", { ...data, status: "draft" });
}

// ---- Iterations ----

export async function listIterations(taskId) {
  return list("iterations", { filter: `task="${taskId}"`, sort: "-version" });
}

export async function createNextIteration(taskId, notes = "") {
  return post(`${API}/custom/iterations/next`, { taskId, notes });
}

export async function markBestIteration(iterationId) {
  return post(`${API}/custom/iterations/${iterationId}/mark-best`, {});
}

export async function getIterationResults(iterationId) {
  return get(`${API}/custom/iterations/${iterationId}/results`);
}

export async function getIterationsSummary(taskId) {
  return get(`${API}/custom/tasks/${taskId}/iterations-summary`);
}

// ---- Generation ----

export async function generateImages({ jobs, model, apiMode, modelConfigId, referenceImage }) {
  return post(`${API}/custom/generate-images`, { jobs, model, apiMode, modelConfigId, referenceImage });
}

// generateImagesStream — SSE 流式生图，每完成一张回调 onResult
// 优先走 PocketBase 后端（带持久化），后端不可用时 fallback 到 Vite 代理
export function generateImagesStream({ jobs, model, apiMode, modelConfigId, iterationId, referenceImage, onResult, onError, onDone }) {
  const primaryUrl = `${API}/custom/generate-images?stream=1`;
  const fallbackUrl = `/api/generate-images`;

  const body = JSON.stringify({ jobs, model, apiMode, modelConfigId, iterationId, referenceImage });
  const headers = { "Content-Type": "application/json" };

  // 先从主后端（PocketBase）请求，失败则 fallback 到 Vite 代理
  fetch(primaryUrl, { method: "POST", headers, body })
    .then(async (response) => {
      if (!response.ok) {
        // 后端不可用，尝试 Vite 代理
        throw new Error("POCKETBASE_UNAVAILABLE");
      }
      return response;
    })
    .catch(async (err) => {
      if (err.message === "POCKETBASE_UNAVAILABLE" || err.name === "TypeError") {
        // Fallback 到 Vite 代理（无 SSE，一次性返回）
        return fetch(fallbackUrl, { method: "POST", headers, body }).then((r) => {
          if (!r.ok) throw new Error(`生图服务不可用 (${r.status})`);
          return r;
        });
      }
      throw err;
    })
    .then(async (response) => {
      // 判断是否是 SSE 流式响应
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // SSE 流式模式（PocketBase 后端）
        return handleSSEStream(response, onResult, onError, onDone);
      } else {
        // 非流式模式（Vite 代理 fallback）
        const data = await response.json().catch(() => ({}));
        const results = data.results || [];
        const templateImages = data.templateImages || {};

        if (results.length === 0 && Object.keys(templateImages).length === 0) {
          if (onError) onError(data.error || "生图返回为空");
          if (onDone) onDone();
          return;
        }

        // 模拟流式逐个回调
        if (Object.keys(templateImages).length > 0) {
          for (const [key, src] of Object.entries(templateImages)) {
            if (onResult) onResult({ key, src, modelUsed: data.model || model });
          }
        } else {
          for (const r of results) {
            if (onResult) onResult(r);
          }
        }
        if (onDone) onDone();
      }
    })
    .catch((err) => {
      if (onError) onError(err.message);
      if (onDone) onDone();
    });
}

async function handleSSEStream(response, onResult, onError, onDone) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          switch (data.type) {
            case "init":
              break;
            case "result":
              if (onResult) onResult(data.result);
              break;
            case "error":
              if (onError) onError(data.error, data.key);
              break;
            case "done":
              if (onDone) onDone();
              break;
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  }
  if (onDone) onDone();
}

export async function generateTitleImages({ jobs, model, apiMode, modelConfigId, stylePrompt }) {
  return post(`${API}/custom/generate-title-images`, { jobs, model, apiMode, modelConfigId, stylePrompt });
}

export async function saveGeneration({ iterationId, title, subtitle, buttonText, activityTime, prompt, imageModel, apiMode, results, params }) {
  return post(`${API}/custom/generations/save`, {
    iterationId, title, subtitle, buttonText, activityTime, prompt, imageModel, apiMode, results, params,
  });
}

export async function listGenerationConfigs(iterationId) {
  return list("generation_configs", { filter: `iteration="${iterationId}"`, sort: "-id" });
}

export async function listGenerationResults(configId) {
  return list("generation_results", { filter: `config="${configId}"`, sort: "size_key" });
}

// ---- Evaluation ----

export async function evaluateImage({ imageSrc, scorerModel, modelConfigId, prompt, title, subtitle, sizeKey }) {
  return post(`${API}/custom/evaluate-image`, { imageSrc, scorerModel, modelConfigId, prompt, title, subtitle, sizeKey });
}

export async function saveEvaluation({ resultId, iterationId, evaluation, model }) {
  return create("evaluations", {
    result: resultId,
    iteration: iterationId,
    scorer_model: model,
    overall_score: evaluation.overallScore,
    composition_score: evaluation.compositionScore,
    color_score: evaluation.colorScore,
    atmosphere_score: evaluation.atmosphereScore,
    commercial_score: evaluation.commercialScore,
    positive_tags: (evaluation.positiveTags || []).join(","),
    negative_tags: (evaluation.negativeTags || []).join(","),
    suggestions: evaluation.suggestions,
    raw_response: evaluation,
  });
}

export async function listEvaluations(iterationId) {
  return list("evaluations", { filter: `iteration="${iterationId}"`, sort: "-id" });
}

// ---- Model Configs ----

export async function listModelConfigs(type) {
  const filter = type ? `model_type="${type}"` : "";
  return list("model_configs", { filter, sort: "sort_order" });
}

// ---- Activity Templates ----

export async function listActivityTemplates() {
  try {
    return await get(`${API}/custom/activity-templates`);
  } catch {
    return { templates: [] };
  }
}

export async function saveActivityTemplate(data) {
  return post(`${API}/custom/activity-templates`, data, {
    Authorization: PB.authStore.token || "",
  });
}

export async function deleteActivityTemplate(id) {
  return del(`${API}/custom/activity-templates/${id}`);
}

// ---- Delete helpers ----

async function remove(collection, id) {
  return del(`${API}/collections/${collection}/records/${id}`);
}

export async function deleteProject(id) {
  return remove("projects", id);
}

export async function deleteTask(id) {
  return remove("tasks", id);
}

export async function deleteIteration(id) {
  return remove("iterations", id);
}
