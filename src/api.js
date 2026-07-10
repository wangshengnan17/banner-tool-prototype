import pb from "./pb";

const PB = pb;

// ---- Projects ----

export async function listProjects() {
  return PB.collection("projects").getFullList({ sort: "-created" });
}

export async function createProject(data) {
  return PB.collection("projects").create({ ...data, status: "active" });
}

// ---- Tasks ----

export async function listTasks(projectId) {
  return PB.collection("tasks").getFullList({
    filter: `project = "${projectId}"`,
    sort: "-created",
  });
}

export async function createTask(data) {
  return PB.collection("tasks").create({ ...data, status: "draft" });
}

// ---- Iterations ----

export async function listIterations(taskId) {
  return PB.collection("iterations").getFullList({
    filter: `task = "${taskId}"`,
    sort: "-version",
  });
}

export async function createNextIteration(taskId, notes = "") {
  const resp = await fetch(`${PB.baseUrl}/api/custom/iterations/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, notes }),
  });
  return resp.json();
}

export async function markBestIteration(iterationId) {
  const resp = await fetch(`${PB.baseUrl}/api/custom/iterations/${iterationId}/mark-best`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return resp.json();
}

// ---- Generation ----

export async function generateImages({ jobs, model, apiMode, modelConfigId, referenceImage }) {
  const resp = await fetch(`${PB.baseUrl}/api/custom/generate-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs, model, apiMode, modelConfigId, referenceImage }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || "生成失败");
  }
  return resp.json();
}

export async function saveGeneration({ iterationId, title, subtitle, buttonText, activityTime, prompt, imageModel, apiMode, results, params }) {
  const resp = await fetch(`${PB.baseUrl}/api/custom/generations/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ iterationId, title, subtitle, buttonText, activityTime, prompt, imageModel, apiMode, results, params }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || "保存失败");
  }
  return resp.json();
}

export async function listGenerationConfigs(iterationId) {
  return PB.collection("generation_configs").getFullList({
    filter: `iteration = "${iterationId}"`,
    sort: "-created",
  });
}

export async function listGenerationResults(configId) {
  return PB.collection("generation_results").getFullList({
    filter: `config = "${configId}"`,
    sort: "size_key",
  });
}

// ---- Evaluation ----

export async function evaluateImage({ imageSrc, scorerModel, modelConfigId, prompt, title, subtitle, sizeKey }) {
  const resp = await fetch(`${PB.baseUrl}/api/custom/evaluate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageSrc, scorerModel, modelConfigId, prompt, title, subtitle, sizeKey }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || "评估失败");
  }
  return resp.json();
}

export async function saveEvaluation({ resultId, iterationId, evaluation, model }) {
  return PB.collection("evaluations").create({
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
  return PB.collection("evaluations").getFullList({
    filter: `iteration = "${iterationId}"`,
    sort: "-created",
  });
}

// ---- Model Configs ----

export async function listModelConfigs(type) {
  return PB.collection("model_configs").getFullList({
    filter: type ? `model_type = "${type}"` : "",
    sort: "sort_order",
  });
}
