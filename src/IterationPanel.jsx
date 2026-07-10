import { useState, useEffect } from "react";
import {
  listEvaluations, evaluateImage, saveEvaluation,
  listModelConfigs,
} from "./api";

export function IterationPanel({ iteration, iterationResults }) {
  const [evaluations, setEvaluations] = useState([]);
  const [scoring, setScoring] = useState(false);
  const [scoringFor, setScoringFor] = useState(null);
  const [scoreModels, setScoreModels] = useState([]);
  const [selectedScorer, setSelectedScorer] = useState("");

  useEffect(() => {
    if (!iteration) return;
    listEvaluations(iteration.id).then(setEvaluations).catch(() => {});
    listModelConfigs("scoring").then((models) => {
      setScoreModels(models);
      const active = models.find((m) => m.is_active);
      if (active) setSelectedScorer(active.id);
    }).catch(() => {});
  }, [iteration]);

  async function handleEvaluate(result) {
    if (!result || !result.image) return;
    setScoring(true);
    setScoringFor(result.id);

    try {
      let scorerModel = "gpt-4o";
      let modelConfigId = selectedScorer;

      const config = scoreModels.find((m) => m.id === selectedScorer);
      if (config) {
        scorerModel = config.model_name;
      }

      const evalResp = await evaluateImage({
        imageSrc: result.image,
        scorerModel,
        modelConfigId,
        sizeKey: result.size_key,
      });

      await saveEvaluation({
        resultId: result.id,
        iterationId: iteration.id,
        evaluation: evalResp.evaluation,
        model: scorerModel,
      });

      const updated = await listEvaluations(iteration.id);
      setEvaluations(updated);
    } catch (e) {
      console.error("评估失败", e);
    } finally {
      setScoring(false);
      setScoringFor(null);
    }
  }

  if (!iteration) return null;

  const latestEval = evaluations[0];

  return (
    <div className="panel iteration-panel">
      <div className="section-head">
        <div>
          <h2>迭代 v{iteration.version}</h2>
          <p>{iteration.notes || "无备注"}</p>
        </div>
        <span className={`status-tag status-${iteration.status}`}>
          {iteration.is_best ? "⭐ " : ""}{iteration.status}
        </span>
      </div>

      {/* Latest Evaluation Score */}
      {latestEval && (
        <div className="eval-summary">
          <div className="eval-score-main">
            <span className="eval-score-number">{latestEval.overall_score?.toFixed(1)}</span>
            <span className="eval-score-max">/10</span>
          </div>
          <div className="eval-score-details">
            <ScoreBar label="构图" value={latestEval.composition_score} />
            <ScoreBar label="色彩" value={latestEval.color_score} />
            <ScoreBar label="氛围" value={latestEval.atmosphere_score} />
            <ScoreBar label="商业感" value={latestEval.commercial_score} />
          </div>
          {latestEval.positive_tags && (
            <div className="eval-tags positive">
              {latestEval.positive_tags.split(",").filter(Boolean).map((t, i) => (
                <span key={i} className="tag tag-positive">{t.trim()}</span>
              ))}
            </div>
          )}
          {latestEval.negative_tags && (
            <div className="eval-tags negative">
              {latestEval.negative_tags.split(",").filter(Boolean).map((t, i) => (
                <span key={i} className="tag tag-negative">{t.trim()}</span>
              ))}
            </div>
          )}
          {latestEval.suggestions && (
            <p className="eval-suggestions">💡 {latestEval.suggestions}</p>
          )}
        </div>
      )}

      {/* Score this iteration */}
      {iterationResults && iterationResults.length > 0 && (
        <div className="eval-actions">
          <div className="eval-model-select">
            <select value={selectedScorer} onChange={(e) => setSelectedScorer(e.target.value)}>
              <option value="">默认模型 (gpt-4o)</option>
              {scoreModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <button
            className="soft-button"
            disabled={scoring}
            onClick={() => handleEvaluate(iterationResults[0])}
          >
            {scoring ? "评估中..." : "AI 打分"}
          </button>
        </div>
      )}

      {/* Evaluation History */}
      {evaluations.length > 1 && (
        <details className="eval-history">
          <summary>历史打分 ({evaluations.length})</summary>
          {evaluations.slice(1).map((ev, i) => (
            <div key={i} className="eval-history-item">
              <span className="eval-history-score">{ev.overall_score?.toFixed(1)}</span>
              <span className="eval-history-model">{ev.scorer_model}</span>
              <span className="eval-history-time">{new Date(ev.created).toLocaleString("zh-CN")}</span>
            </div>
          ))}
        </details>
      )}

      {!latestEval && !scoring && (
        <div className="eval-empty">
          <p>尚未评估。点击「AI 打分」让多模态模型给出专业评审。</p>
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value }) {
  if (value == null) return null;
  const pct = ((value || 0) / 10) * 100;
  return (
    <div className="score-bar-row">
      <span className="score-label">{label}</span>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="score-value">{Number(value).toFixed(1)}</span>
    </div>
  );
}
