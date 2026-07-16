import { useState, useEffect, useCallback, useRef } from "react";
import {
  listProjects, createProject, deleteProject,
  listTasks, createTask, deleteTask,
  listIterations, createNextIteration, markBestIteration, deleteIteration,
  getIterationResults, getIterationsSummary,
} from "./api";
import { useAuth } from "./auth/AuthContext";

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`} onClick={onClose}>
      <span>{message}</span>
    </div>
  );
}

function InlineEdit({ value, onSave, onCancel }) {
  const inputRef = useRef(null);
  const [v, setV] = useState(value);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    const trimmed = v.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else onCancel();
  }

  return (
    <input
      ref={inputRef}
      className="inline-edit-input"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

export function ProjectNav({
  project, setProject,
  task, setTask,
  iteration, setIteration,
  iterations, setIterations,
  onHistoryLoad,
}) {
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [iterSummaries, setIterSummaries] = useState([]);
  const [toast, setToast] = useState(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  // ---- inline-edit state ----
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);

  // ---- task counts (for select dropdown) ----
  const [projectTaskCounts, setProjectTaskCounts] = useState({});

  // ---- Esc to close forms ----
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (showNewProject) { setShowNewProject(false); setNewProjectName(""); }
        if (showNewTask)    { setShowNewTask(false);    setNewTaskName(""); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNewProject, showNewTask]);

  const showToast = useCallback((msg, type = "error") => {
    setToast({ msg, type, key: Date.now() });
  }, []);

  // ---- Load task counts ----
  const loadTaskCounts = useCallback(async (projList) => {
    const counts = {};
    for (const p of projList) {
      try {
        const list = await listTasks(p.id);
        counts[p.id] = list.length;
      } catch { counts[p.id] = 0; }
    }
    setProjectTaskCounts(counts);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      loadTaskCounts(list);
      if (!project && list.length > 0) {
        setProject(list[0]);
      }
    } catch (e) {
      console.warn("加载项目失败 (PocketBase 未启动?)", e);
    } finally {
      setLoading(false);
    }
  }, [setProject, loadTaskCounts, project]);

  const loadTasks = useCallback(async () => {
    if (!project) {
      setTasks([]);
      return null;
    }
    try {
      const list = await listTasks(project.id);
      setTasks(list);
      if (list.length > 0) {
        setTask(list[0]);
        return list[0];
      } else {
        setTask(null);
        return null;
      }
    } catch (e) {
      console.warn("加载任务失败", e);
      setTasks([]);
    }
    return null;
  }, [project, setTask]);

  const loadIterations = useCallback(async (t) => {
    if (!t) {
      setIterations([]);
      setIteration(null);
      return;
    }
    try {
      const list = await listIterations(t.id);
      setIterations(list);
      if (list.length > 0) {
        setIteration(list[0]);
      } else {
        setIteration(null);
      }
    } catch (e) {
      console.warn("加载迭代失败", e);
      setIterations([]);
    }
  }, [setIteration, setIterations]);

  const loadSummary = useCallback(async (t) => {
    if (!t) {
      setIterSummaries([]);
      return;
    }
    try {
      const data = await getIterationsSummary(t.id);
      setIterSummaries(data.iterations || []);
    } catch (e) {
      console.warn("加载迭代汇总失败", e);
      setIterSummaries([]);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => {
    loadTasks().then((t) => {
      loadIterations(t);
      loadSummary(t);
    });
  }, [project, loadTasks, loadIterations, loadSummary]);

  // ---- Inline-edit handlers ----
  async function handleRenameProject(projectId, newName) {
    try {
      const { pb } = await import("./pb");
      await pb.collection("projects").update(projectId, { name: newName });
      setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, name: newName } : p));
      if (project?.id === projectId) setProject((p) => ({ ...p, name: newName }));
    } catch (e) {
      showToast("重命名失败：" + (e.message || "未知错误"));
    }
  }

  async function handleRenameTask(taskId, newName) {
    try {
      const { pb } = await import("./pb");
      await pb.collection("tasks").update(taskId, { name: newName });
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, name: newName } : t));
      if (task?.id === taskId) setTask((t) => ({ ...t, name: newName }));
    } catch (e) {
      showToast("重命名失败：" + (e.message || "未知错误"));
    }
  }

  async function handleCreateProject() {
    if (!newProjectName.trim() || creatingProject) return;
    setCreatingProject(true);
    try {
      const p = await createProject({ name: newProjectName.trim() });
      setProjects((prev) => [p, ...prev]);
      setProjectTaskCounts((prev) => ({ ...prev, [p.id]: 0 }));
      setProject(p);
      setNewProjectName("");
      setShowNewProject(false);
    } catch (e) {
      showToast("创建项目失败：" + (e.message || "未知错误"));
      // 不关闭表单，让用户重试
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleCreateTask() {
    if (!newTaskName.trim() || !project || creatingTask) return;
    setCreatingTask(true);
    try {
      const t = await createTask({ name: newTaskName.trim(), project: project.id });
      setTasks((prev) => [t, ...prev]);
      setProjectTaskCounts((prev) => ({
        ...prev,
        [project.id]: (prev[project.id] || 0) + 1,
      }));
      setTask(t);
      setNewTaskName("");
      setShowNewTask(false);
    } catch (e) {
      showToast("创建任务失败：" + (e.message || "未知错误"));
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleNewIteration() {
    if (!task) return;
    try {
      const result = await createNextIteration(task.id);
      const list = await listIterations(task.id);
      setIterations(list);
      setIteration(list.find((it) => it.id === result.id) || list[0]);
      loadSummary(task);
    } catch (e) {
      showToast("创建迭代失败：" + (e.message || "未知错误"));
    }
  }

  async function handleMarkBest() {
    if (!iteration) return;
    try {
      await markBestIteration(iteration.id);
      const list = await listIterations(task.id);
      setIterations(list);
      loadSummary(task);
    } catch (e) {
      showToast("标记失败：" + (e.message || "未知错误"));
    }
  }

  async function handleSwitchIteration(iterId) {
    if (!iterId) return;
    const it = iterations.find((i) => i.id === iterId);
    if (it) {
      setIteration(it);
      try {
        const data = await getIterationResults(iterId);
        if (onHistoryLoad) onHistoryLoad(data.results || []);
      } catch (e) {
        console.warn("加载迭代结果失败", e);
      }
    }
  }

  async function handleDeleteProject(projectId) {
    if (!confirm("确定删除该项目及其所有任务？")) return;
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (project?.id === projectId) {
        setProject(null);
        setTask(null);
        setIteration(null);
        setIterations([]);
      }
    } catch (e) {
      showToast("删除项目失败：" + (e.message || "未知错误"));
    }
  }

  async function handleDeleteTask(taskId) {
    if (!confirm("确定删除该任务及其所有迭代？")) return;
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (task?.id === taskId) {
        setTask(null);
        setIteration(null);
        setIterations([]);
      }
      // 更新计数
      if (project) {
        setProjectTaskCounts((prev) => ({
          ...prev,
          [project.id]: Math.max(0, (prev[project.id] || 1) - 1),
        }));
      }
    } catch (e) {
      showToast("删除任务失败：" + (e.message || "未知错误"));
    }
  }

  async function handleDeleteIteration(iterId) {
    if (!confirm("确定删除此迭代？")) return;
    try {
      await deleteIteration(iterId);
      const list = await listIterations(task.id);
      setIterations(list);
      loadSummary(task);
      if (iteration?.id === iterId) {
        setIteration(list.length > 0 ? list[0] : null);
      }
    } catch (e) {
      showToast("删除迭代失败：" + (e.message || "未知错误"));
    }
  }

  if (loading) return <div className="topbar"><span className="loading-text">加载中...</span></div>;

  const canConnect = projects.length > 0 || !loading;

  return (
    <div className="topbar pb-nav">
      {toast && (
        <Toast
          key={toast.key}
          message={toast.msg}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="brand">
        <div className="brand-mark">B</div>
        <div>
          <h1>Banner 生图工具</h1>
          <p>AI 驱动 · 版本管理</p>
        </div>
      </div>

      <div className="nav-selectors">
        {/* Project */}
        <div className="nav-select-group">
          <label>项目</label>
          <div className="nav-select-row">
            <select value={project?.id || ""} onChange={(e) => {
              const p = projects.find((p) => p.id === e.target.value);
              setProject(p || null);
            }}>
              <option value="">-- 选择项目 --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{projectTaskCounts[p.id] != null ? ` (${projectTaskCounts[p.id]}个任务)` : ""}
                </option>
              ))}
            </select>
            <button className="mini-btn" onClick={() => setShowNewProject(!showNewProject)} title="新建项目">+</button>
            {project && (
              <button className="mini-btn del-mini-btn" onClick={() => handleDeleteProject(project.id)} title="删除项目">🗑</button>
            )}
          </div>
          {showNewProject && (
            <div className="nav-inline-form">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="项目名称"
                onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                autoFocus
              />
              <button onClick={handleCreateProject} disabled={creatingProject}>
                {creatingProject ? "创建中..." : "创建"}
              </button>
            </div>
          )}

          {/* inline-edit project name */}
          {editingProjectId && (
            <div className="nav-inline-edit-overlay" onClick={() => setEditingProjectId(null)}>
              <div className="nav-inline-edit-box" onClick={(e) => e.stopPropagation()}>
                <InlineEdit
                  value={projects.find((p) => p.id === editingProjectId)?.name || ""}
                  onSave={(v) => { handleRenameProject(editingProjectId, v); setEditingProjectId(null); }}
                  onCancel={() => setEditingProjectId(null)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Task */}
        <div className="nav-select-group">
          <label>任务</label>
          <div className="nav-select-row">
            <select value={task?.id || ""} onChange={(e) => {
              const t = tasks.find((t) => t.id === e.target.value);
              setTask(t || null);
            }}>
              <option value="">-- 选择任务 --</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button className="mini-btn" onClick={() => setShowNewTask(!showNewTask)} disabled={!project} title="新建任务">+</button>
            {task && (
              <button className="mini-btn del-mini-btn" onClick={() => handleDeleteTask(task.id)} title="删除任务">🗑</button>
            )}
          </div>
          {showNewTask && (
            <div className="nav-inline-form">
              <input
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                placeholder="任务名称"
                onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
                autoFocus
              />
              <button onClick={handleCreateTask} disabled={creatingTask}>
                {creatingTask ? "创建中..." : "创建"}
              </button>
            </div>
          )}

          {/* inline-edit task name */}
          {editingTaskId && (
            <div className="nav-inline-edit-overlay" onClick={() => setEditingTaskId(null)}>
              <div className="nav-inline-edit-box" onClick={(e) => e.stopPropagation()}>
                <InlineEdit
                  value={tasks.find((t) => t.id === editingTaskId)?.name || ""}
                  onSave={(v) => { handleRenameTask(editingTaskId, v); setEditingTaskId(null); }}
                  onCancel={() => setEditingTaskId(null)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Iteration selector */}
        {task && iterations.length > 0 && (
          <div className="nav-select-group">
            <label>迭代</label>
            <div className="nav-select-row">
              <select
                className="iteration-select"
                value={iteration?.id || ""}
                onChange={(e) => handleSwitchIteration(e.target.value)}
              >
                {iterations.map((it) => {
                  const summary = iterSummaries.find((s) => s.id === it.id);
                  const scoreStr = summary?.score ? ` [${summary.score.toFixed(1)}分]` : "";
                  const bestStr = it.is_best ? " ⭐" : "";
                  return (
                    <option key={it.id} value={it.id}>
                      v{it.version} · {it.status}{scoreStr}{bestStr}
                    </option>
                  );
                })}
              </select>
              {iteration && (
                <button className="mini-btn del-mini-btn" onClick={() => handleDeleteIteration(iteration.id)} title="删除迭代">🗑</button>
              )}
            </div>
          </div>
        )}

        {/* ---- empty state inline guide ---- */}
        {!task && project && tasks.length === 0 && (
          <div className="nav-empty-guide">
            <span>📋 还没有任务，点击 + 新建第一个任务</span>
          </div>
        )}
        {!project && projects.length > 0 && (
          <div className="nav-empty-guide">
            <span>👈 请先选择一个项目</span>
          </div>
        )}
        {!canConnect && (
          <div className="nav-empty-guide nav-empty-offline">
            <span>⚡ 未连接后端，请启动 PocketBase</span>
          </div>
        )}
      </div>

      <div className="nav-actions">
        {task && (
          <button className="soft-button nav-action-btn" onClick={handleNewIteration}>
            新建迭代
          </button>
        )}
        {iteration && !iteration.is_best && (
          <button className="soft-button nav-action-btn best-btn" onClick={handleMarkBest}>
            ⭐ 标为最佳
          </button>
        )}
        {task && iterations.length > 1 && (
          <button
            className="soft-button nav-action-btn history-btn"
            onClick={() => {
              const summary = iterSummaries;
              if (onHistoryLoad) onHistoryLoad(null, summary);
            }}
          >
            📋 版本对比
          </button>
        )}
      </div>

      <div className="nav-status">
        {iteration ? (
          <span className="iteration-badge">
            v{iteration.version} · {iteration.status}
            {iteration.is_best ? " ⭐" : ""}
          </span>
        ) : task ? (
          <span className="no-iteration-hint">尚无迭代，点击「新建迭代」开始</span>
        ) : (
          <span className="no-iteration-hint">{project ? "选择任务开始" : "选择项目开始"}</span>
        )}
      </div>

      {user && (
        <div className="nav-user">
          <span className="nav-user-name">{user.display_name || user.email}</span>
          <button className="nav-logout-btn" onClick={logout}>登出</button>
        </div>
      )}

      {/* ---- Project list with double-click to rename ---- */}
      <div className="nav-project-list-drawer" style={{ display: "none" }}>
        <ul className="project-rename-list">
          {projects.map((p) => (
            <li key={p.id} onDoubleClick={() => setEditingProjectId(p.id)}>
              {editingProjectId === p.id ? (
                <InlineEdit
                  value={p.name}
                  onSave={(v) => { handleRenameProject(p.id, v); setEditingProjectId(null); }}
                  onCancel={() => setEditingProjectId(null)}
                />
              ) : (
                <span>{p.name}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
