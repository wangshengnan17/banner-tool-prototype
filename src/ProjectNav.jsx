import { useState, useEffect, useCallback } from "react";
import {
  listProjects, createProject,
  listTasks, createTask,
  listIterations, createNextIteration, markBestIteration,
} from "./api";

export function ProjectNav({
  project, setProject,
  task, setTask,
  iteration, setIteration,
  iterations, setIterations,
}) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newTaskName, setNewTaskName] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      if (!project && list.length > 0) {
        setProject(list[0]);
      }
    } catch (e) {
      console.warn("加载项目失败 (PocketBase 未启动?)", e);
    } finally {
      setLoading(false);
    }
  }, [project, setProject]);

  const loadTasks = useCallback(async () => {
    if (!project) return;
    try {
      const list = await listTasks(project.id);
      setTasks(list);
      if (list.length > 0) {
        setTask(list[0]);
        return list[0];
      }
    } catch (e) {
      console.warn("加载任务失败", e);
    }
    return null;
  }, [project, setTask]);

  const loadIterations = useCallback(async (t) => {
    if (!t) return;
    try {
      const list = await listIterations(t.id);
      setIterations(list);
      if (list.length > 0) {
        setIteration(list[0]);
      }
    } catch (e) {
      console.warn("加载迭代失败", e);
    }
  }, [setIteration, setIterations]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => {
    loadTasks().then((t) => loadIterations(t));
  }, [project, loadTasks, loadIterations]);

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;
    const p = await createProject({ name: newProjectName.trim() });
    setProjects((prev) => [p, ...prev]);
    setProject(p);
    setNewProjectName("");
    setShowNewProject(false);
  }

  async function handleCreateTask() {
    if (!newTaskName.trim() || !project) return;
    const t = await createTask({ name: newTaskName.trim(), project: project.id });
    setTasks((prev) => [t, ...prev]);
    setTask(t);
    setNewTaskName("");
    setShowNewTask(false);
  }

  async function handleNewIteration() {
    if (!task) return;
    try {
      const result = await createNextIteration(task.id);
      const list = await listIterations(task.id);
      setIterations(list);
      setIteration(list.find((it) => it.id === result.id) || list[0]);
    } catch (e) {
      console.error("创建迭代失败", e);
    }
  }

  async function handleMarkBest() {
    if (!iteration) return;
    try {
      await markBestIteration(iteration.id);
      const list = await listIterations(task.id);
      setIterations(list);
    } catch (e) {
      console.error("标记失败", e);
    }
  }

  if (loading) return <div className="topbar"><span className="loading-text">加载中...</span></div>;

  const canConnect = projects.length > 0 || !loading;

  return (
    <div className="topbar pb-nav">
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
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="mini-btn" onClick={() => setShowNewProject(!showNewProject)} title="新建项目">+</button>
          </div>
          {showNewProject && (
            <div className="nav-inline-form">
              <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="项目名称" onKeyDown={(e) => e.key === "Enter" && handleCreateProject()} />
              <button onClick={handleCreateProject}>创建</button>
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
          </div>
          {showNewTask && (
            <div className="nav-inline-form">
              <input value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} placeholder="任务名称" onKeyDown={(e) => e.key === "Enter" && handleCreateTask()} />
              <button onClick={handleCreateTask}>创建</button>
            </div>
          )}
        </div>
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

      {!canConnect && (
        <div className="pb-offline">未连接 PocketBase</div>
      )}
    </div>
  );
}
