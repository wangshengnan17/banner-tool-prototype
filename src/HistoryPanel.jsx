import { useState, useEffect, useMemo } from "react";
import { getIterationResults } from "./api";

const SIZE_LABELS = {
  "398x225": "398×225 标准横版",
  "240x360": "240×360 竖版",
  "520x294": "520×294 标准横版",
  "849x316": "849×316 超宽横版",
  "552x228": "552×228 紧凑横版",
  "846x417": "846×417 大横版",
};

export function HistoryPanel({ iterations, taskId, onClose, onSelectIteration }) {
  const [activeVersion, setActiveVersion] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedSize, setSelectedSize] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [compareResultsA, setCompareResultsA] = useState(null);
  const [compareResultsB, setCompareResultsB] = useState(null);

  // Sort iterations by version desc
  const sorted = useMemo(() => {
    return [...iterations].sort((a, b) => b.version - a.version);
  }, [iterations]);

  // All unique size keys from all iterations
  const allSizes = useMemo(() => {
    const sizes = new Set();
    if (results) {
      results.forEach((r) => sizes.add(r.sizeKey));
    }
    if (compareResultsA) {
      compareResultsA.forEach((r) => sizes.add(r.sizeKey));
    }
    if (compareResultsB) {
      compareResultsB.forEach((r) => sizes.add(r.sizeKey));
    }
    return [...sizes];
  }, [results, compareResultsA, compareResultsB]);

  async function loadVersionResults(version) {
    const it = iterations.find((i) => i.version === version);
    if (!it) return null;
    setLoading(true);
    try {
      const data = await getIterationResults(it.id);
      return data.results || [];
    } catch (e) {
      console.warn("加载迭代结果失败", e);
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectVersion(v) {
    if (compareMode) {
      // In compare mode: assign to A or B
      if (!compareA) {
        setCompareA(v);
        const r = await loadVersionResults(v);
        setCompareResultsA(r);
      } else if (!compareB && v !== compareA) {
        setCompareB(v);
        const r = await loadVersionResults(v);
        setCompareResultsB(r);
      }
      return;
    }

    setActiveVersion(v);
    const r = await loadVersionResults(v);
    setResults(r);
  }

  function toggleCompare() {
    if (compareMode) {
      setCompareMode(false);
      setCompareA(null);
      setCompareB(null);
      setCompareResultsA(null);
      setCompareResultsB(null);
      setActiveVersion(null);
      setResults(null);
    } else {
      setCompareMode(true);
      setActiveVersion(null);
      setResults(null);
    }
  }

  function findResult(resultsList, sizeKey) {
    if (!resultsList) return null;
    return resultsList.find((r) => r.sizeKey === sizeKey) || null;
  }

  const activeSize = selectedSize || allSizes[0];

  return (
    <div className="history-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="history-panel">
        <div className="history-header">
          <h2>迭代历史浏览</h2>
          <div className="history-header-actions">
            <button
              className={`soft-button ${compareMode ? "active" : ""}`}
              onClick={toggleCompare}
            >
              {compareMode ? "退出对比" : "🔀 版本对比"}
            </button>
            <button className="soft-button" onClick={onClose}>✕ 关闭</button>
          </div>
        </div>

        {/* Version timeline */}
        <div className="history-timeline">
          {sorted.map((it) => {
            const isActive = activeVersion === it.version;
            const isCompareA = compareA === it.version;
            const isCompareB = compareB === it.version;
            const isSelected = isActive || isCompareA || isCompareB;
            const statusLabel = { draft: "草稿", generated: "已生成", reviewed: "已评审" }[it.status] || it.status;

            return (
              <button
                key={it.id}
                className={`history-version-btn ${isSelected ? "selected" : ""} ${isCompareA ? "compare-a" : ""} ${isCompareB ? "compare-b" : ""}`}
                onClick={() => handleSelectVersion(it.version)}
              >
                <span className="version-num">v{it.version}</span>
                {it.isBest && <span className="best-star">⭐</span>}
                <span className="version-status">{statusLabel}</span>
                {it.score > 0 && <span className="version-score">{it.score.toFixed(1)}</span>}
                <span className="version-notes">{it.notes || ""}</span>
                {it.created && <span className="version-time">{new Date(it.created).toLocaleDateString("zh-CN")}</span>}
              </button>
            );
          })}
        </div>

        {/* Compare mode hint */}
        {compareMode && (
          <div className="compare-hint">
            {!compareA && <span>👈 请点击左侧第一个版本</span>}
            {compareA && !compareB && <span>👈 请点击第二个版本进行对比 (v{compareA} ✓)</span>}
            {compareA && compareB && <span>✅ 正在对比 v{compareA} vs v{compareB}</span>}
          </div>
        )}

        {/* Size selector */}
        {allSizes.length > 0 && (
          <div className="history-size-tabs">
            {allSizes.map((sk) => (
              <button
                key={sk}
                className={`size-tab ${activeSize === sk ? "active" : ""}`}
                onClick={() => setSelectedSize(sk)}
              >
                {SIZE_LABELS[sk] || sk}
              </button>
            ))}
          </div>
        )}

        {loading && <div className="history-loading">加载中...</div>}

        {/* Single version view */}
        {!compareMode && activeVersion && results && activeSize && (
          <div className="history-single-view">
            <h3>v{activeVersion} — {SIZE_LABELS[activeSize] || activeSize}</h3>
            <VersionResultDisplay result={findResult(results, activeSize)} />
          </div>
        )}

        {/* Compare view — side by side */}
        {compareMode && compareA && compareB && activeSize && (
          <div className="history-compare-view">
            <div className="compare-side">
              <h3 className="compare-label-a">v{compareA}</h3>
              <VersionResultDisplay result={findResult(compareResultsA, activeSize)} />
            </div>
            <div className="compare-divider" />
            <div className="compare-side">
              <h3 className="compare-label-b">v{compareB}</h3>
              <VersionResultDisplay result={findResult(compareResultsB, activeSize)} />
            </div>
          </div>
        )}

        {/* Empty state */}
        {!compareMode && !activeVersion && !loading && (
          <div className="history-empty">
            <p>点击上方迭代版本查看该版本下的生成结果。</p>
            <p>或点击「版本对比」同时查看两个版本。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionResultDisplay({ result }) {
  if (!result) {
    return <div className="history-no-result">该尺寸下暂无生成结果</div>;
  }

  return (
    <div className="history-result-card">
      <img
        src={result.imageUrl}
        alt={`${result.sizeKey} 生成图`}
        className="history-result-img"
        onError={(e) => {
          e.target.style.display = "none";
        }}
      />
      <div className="history-result-meta">
        <span>{result.width}×{result.height}</span>
        {result.modelUsed && <span className="meta-model">{result.modelUsed}</span>}
      </div>
    </div>
  );
}
