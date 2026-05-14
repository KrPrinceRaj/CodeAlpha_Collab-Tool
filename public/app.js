const app = document.querySelector("#app");

let state = {
  user: null,
  users: [],
  projects: [],
  notifications: [],
  activeProjectId: null,
  socket: null,
  page: location.pathname === "/" ? "/dashboard" : location.pathname
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function setState(payload) {
  state = { ...state, ...payload };
  if (!state.activeProjectId && state.projects[0]) state.activeProjectId = state.projects[0].id;
  render();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function priorityClass(priority = "Medium") {
  return `priority-${priority.toLowerCase()}`;
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0];
}

function allTasks() {
  return state.projects.flatMap((project) =>
    project.tasks.map((task) => ({
      ...task,
      projectName: project.name,
      columnName: project.columns.find((column) => column.id === task.columnId)?.name || "Backlog"
    }))
  );
}

function goTo(page) {
  state.page = page;
  history.pushState({}, "", page);
  render();
}

function connectSocket() {
  if (state.socket || !state.user) return;
  state.socket = io();
  state.socket.on("project:updated", refresh);
  state.socket.on("projects:changed", refresh);
}

async function refresh() {
  const data = await api("/api/me");
  setState(data);
  connectSocket();
}

function renderAuth() {
  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-art">
        <div class="brand"><span class="logo">C</span> Collab Tool</div>
        <div>
          <h1>Project boards for focused teamwork.</h1>
          <p>Create group projects, assign tasks, discuss work inside cards, and see updates arrive live.</p>
        </div>
      </div>
      <div class="auth-panel">
        <form class="auth-card stack" id="authForm">
          <div>
            <h2>Sign in</h2>
            <p class="muted">Use demo@example.com / password123, or create a new account.</p>
          </div>
          <label>Name <input name="name" autocomplete="name" placeholder="Only needed for new accounts" /></label>
          <label>Email <input name="email" type="email" autocomplete="email" value="demo@example.com" required /></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" value="password123" required /></label>
          <p class="error" id="authError"></p>
          <div class="form-row">
            <button class="btn" data-mode="login">Sign in</button>
            <button class="btn secondary" data-mode="register">Create account</button>
          </div>
        </form>
      </div>
    </section>
  `;

  document.querySelector("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = event.submitter.dataset.mode;
    const form = new FormData(event.currentTarget);
    const error = document.querySelector("#authError");
    error.textContent = "";
    try {
      const data = await api(`/api/${mode}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form))
      });
      setState(data);
      connectSocket();
    } catch (err) {
      error.textContent = err.message;
    }
  });
}

function renderProjectForm() {
  return `
    <form class="panel stack" id="projectForm">
      <h2>Create group project</h2>
      <label>Project name <input name="name" placeholder="Mobile app sprint" required /></label>
      <label>Description <textarea name="description" placeholder="What this team is building"></textarea></label>
      <label>Invite by email <input name="memberEmails" placeholder="teammate@example.com, another@example.com" /></label>
      <button class="btn">Create project</button>
    </form>
  `;
}

function renderTaskForm(project) {
  const members = project.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join("");
  return `
    <form class="panel stack" id="taskForm">
      <h2>Add task card</h2>
      <label>Title <input name="title" placeholder="Write acceptance tests" required /></label>
      <label>Description <textarea name="description" placeholder="Task details"></textarea></label>
      <label>Assign to <select name="assigneeId">${members}</select></label>
      <div class="form-row">
        <label>Priority
          <select name="priority">
            <option>Medium</option>
            <option>High</option>
            <option>Low</option>
          </select>
        </label>
        <label>Due date <input name="dueDate" type="date" /></label>
      </div>
      <button class="btn">Add task</button>
    </form>
  `;
}

function renderNotifications() {
  const unread = state.notifications.filter((item) => !item.read).length;
  const rows = state.notifications.length
    ? state.notifications
        .map(
          (item) => `
          <div class="notification ${item.read ? "" : "unread"}">
            ${escapeHtml(item.message)}
            <div class="muted">${new Date(item.createdAt).toLocaleString()}</div>
          </div>`
        )
        .join("")
    : `<p class="muted">No notifications yet.</p>`;
  return `
    <section class="panel stack">
      <div class="notification-head">
        <h2>Notifications</h2>
        <span class="pill">${unread} new</span>
      </div>
      <div class="notifications">${rows}</div>
      <button class="btn secondary" id="readNotifications">Mark all read</button>
    </section>
  `;
}

function renderFullNotifications() {
  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Live updates</span>
          <h1>Notifications</h1>
          <p class="muted">Assignment updates, comments, and project activity arrive here in real time.</p>
        </div>
        <button class="btn secondary" id="readNotifications">Mark all read</button>
      </div>
      ${renderNotifications()}
    </section>
  `;
}

function renderTask(task, project) {
  const comments = task.comments
    .map(
      (comment) => `
      <div class="comment">
        <div class="comment-head">
          <strong>${escapeHtml(comment.author.name)}</strong>
          <span class="muted">${new Date(comment.createdAt).toLocaleString()}</span>
        </div>
        <p>${escapeHtml(comment.body)}</p>
      </div>`
    )
    .join("");
  const columns = project.columns
    .map((column) => `<option value="${column.id}" ${column.id === task.columnId ? "selected" : ""}>${escapeHtml(column.name)}</option>`)
    .join("");
  const members = project.members
    .map((member) => `<option value="${member.id}" ${member.id === task.assigneeId ? "selected" : ""}>${escapeHtml(member.name)}</option>`)
    .join("");

  return `
    <article class="task-card" draggable="true" data-task-id="${task.id}">
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(task.description)}</p>
      <div class="meta">
        <span class="pill ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
        <span class="pill">${escapeHtml(task.assignee?.name || "Unassigned")}</span>
        ${task.dueDate ? `<span class="pill">Due ${escapeHtml(task.dueDate)}</span>` : ""}
      </div>
      <div class="task-actions">
        <select data-action="move" data-task-id="${task.id}">${columns}</select>
        <select data-action="assign" data-task-id="${task.id}">${members}</select>
      </div>
      <div class="comments">${comments || `<p class="muted">No comments yet.</p>`}</div>
      <form class="comment-form" data-task-id="${task.id}">
        <input name="body" placeholder="Comment and communicate within this task" required />
        <button class="btn secondary">Comment</button>
      </form>
    </article>
  `;
}

function renderBoard(project) {
  if (!project) {
    return `<section class="panel"><h2>No projects yet</h2><p class="muted">Create a group project to start assigning tasks.</p></section>`;
  }
  const completed = project.tasks.filter((task) => {
    const column = project.columns.find((item) => item.id === task.columnId);
    return column?.name.toLowerCase() === "done";
  }).length;
  const assigned = project.tasks.filter((task) => task.assigneeId).length;
  return `
    <div class="board-head">
      <div>
        <h1>${escapeHtml(project.name)}</h1>
        <p class="muted">${escapeHtml(project.description || "Project board")}</p>
      </div>
      <div class="member-row">
        ${project.members
          .map((member) => `<span class="avatar" title="${escapeHtml(member.name)}">${escapeHtml(member.name.slice(0, 1))}</span>`)
          .join("")}
      </div>
    </div>
    <section class="metrics">
      <div><strong>${project.tasks.length}</strong><span>Total tasks</span></div>
      <div><strong>${assigned}</strong><span>Assigned</span></div>
      <div><strong>${completed}</strong><span>Completed</span></div>
      <div><strong>${project.members.length}</strong><span>Members</span></div>
    </section>
    <section class="board">
      ${project.columns
        .map((column) => {
          const tasks = project.tasks.filter((task) => task.columnId === column.id);
          return `
            <div class="column" data-column-id="${column.id}">
              <div class="column-title">
                <span>${escapeHtml(column.name)}</span>
                <span class="pill">${tasks.length}</span>
              </div>
              <div class="task-list">
                ${tasks.map((task) => renderTask(task, project)).join("") || `<p class="muted">Drop tasks here.</p>`}
              </div>
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderDashboard(project) {
  const tasks = allTasks();
  const completed = tasks.filter((task) => task.columnName.toLowerCase() === "done").length;
  const assigned = tasks.filter((task) => task.assigneeId).length;
  const recentTasks = tasks.slice(-5).reverse();

  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Overview</span>
          <h1>Dashboard</h1>
          <p class="muted">A quick view of projects, task progress, people, and recent work.</p>
        </div>
      </div>
      <section class="metrics">
        <div><strong>${state.projects.length}</strong><span>Projects</span></div>
        <div><strong>${tasks.length}</strong><span>Total tasks</span></div>
        <div><strong>${assigned}</strong><span>Assigned</span></div>
        <div><strong>${completed}</strong><span>Completed</span></div>
      </section>
      <section class="two-column">
        <div class="panel stack">
          <h2>Recent tasks</h2>
          ${recentTasks.length ? recentTasks.map(renderTaskSummary).join("") : `<p class="muted">No tasks yet.</p>`}
        </div>
        <div class="panel stack">
          <h2>Current project</h2>
          ${project ? renderProjectCard(project) : `<p class="muted">Create a project to begin.</p>`}
        </div>
      </section>
    </section>
  `;
}

function renderProjectCard(project) {
  const done = project.tasks.filter((task) => {
    const column = project.columns.find((item) => item.id === task.columnId);
    return column?.name.toLowerCase() === "done";
  }).length;

  return `
    <article class="project-card">
      <div>
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description || "No description")}</p>
      </div>
      <div class="meta">
        <span class="pill">${project.tasks.length} tasks</span>
        <span class="pill">${done} done</span>
        <span class="pill">${project.members.length} members</span>
      </div>
      <button class="btn secondary project-open" data-project-id="${project.id}">Open board</button>
    </article>
  `;
}

function renderProjectsPage() {
  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Group work</span>
          <h1>Projects</h1>
          <p class="muted">Create group projects and choose which board you want to manage.</p>
        </div>
      </div>
      <section class="two-column">
        <div class="project-grid">
          ${state.projects.map(renderProjectCard).join("") || `<div class="panel"><p class="muted">No projects yet.</p></div>`}
        </div>
        ${renderProjectForm()}
      </section>
    </section>
  `;
}

function renderBoardPage(project) {
  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Project board</span>
          <h1>Board</h1>
          <p class="muted">Move task cards between columns and manage assignments.</p>
        </div>
        ${renderProjectPicker(project)}
      </div>
      ${project ? `<div class="board-layout"><div>${renderBoard(project)}</div>${renderTaskForm(project)}</div>` : `<section class="panel"><p class="muted">Create a project first.</p></section>`}
    </section>
  `;
}

function renderProjectPicker(project) {
  if (!state.projects.length) return "";
  return `
    <label class="compact-label">Project
      <select id="activeProjectPicker">
        ${state.projects
          .map((item) => `<option value="${item.id}" ${item.id === project?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function renderTaskSummary(task) {
  return `
    <article class="summary-card">
      <div>
        <h3>${escapeHtml(task.title)}</h3>
        <p>${escapeHtml(task.projectName)} · ${escapeHtml(task.columnName)}</p>
      </div>
      <span class="pill ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
    </article>
  `;
}

function renderTasksPage(project) {
  const tasks = allTasks();
  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Work list</span>
          <h1>Tasks</h1>
          <p class="muted">All task cards from every project in one separate page.</p>
        </div>
        ${project ? `<button class="btn" id="taskPageBoard">Add task on board</button>` : ""}
      </div>
      <div class="task-directory">
        ${tasks.length ? tasks.map(renderTaskSummary).join("") : `<div class="panel"><p class="muted">No tasks created yet.</p></div>`}
      </div>
    </section>
  `;
}

function renderCommentsPage() {
  const comments = state.projects.flatMap((project) =>
    project.tasks.flatMap((task) =>
      task.comments.map((comment) => ({
        ...comment,
        taskTitle: task.title,
        projectName: project.name
      }))
    )
  );

  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Communication</span>
          <h1>Comments</h1>
          <p class="muted">Task discussions collected in one category page.</p>
        </div>
      </div>
      <div class="comment-directory">
        ${comments.length
          ? comments
              .map(
                (comment) => `
                <article class="panel">
                  <div class="comment-head">
                    <strong>${escapeHtml(comment.author.name)}</strong>
                    <span class="muted">${new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  <p>${escapeHtml(comment.body)}</p>
                  <span class="pill">${escapeHtml(comment.projectName)} / ${escapeHtml(comment.taskTitle)}</span>
                </article>`
              )
              .join("")
          : `<div class="panel"><p class="muted">No comments yet.</p></div>`}
      </div>
    </section>
  `;
}

function renderTeamPage(project) {
  const visibleUsers = project?.members || state.users;
  return `
    <section class="page-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Users backend</span>
          <h1>Team</h1>
          <p class="muted">People available for project membership and task assignment.</p>
        </div>
        ${renderProjectPicker(project)}
      </div>
      <div class="team-grid">
        ${visibleUsers
          .map(
            (user) => `
            <article class="team-card">
              <span class="avatar">${escapeHtml(user.name.slice(0, 1))}</span>
              <div>
                <h3>${escapeHtml(user.name)}</h3>
                <p class="muted">${escapeHtml(user.email)}</p>
              </div>
            </article>`
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderPage(project) {
  if (state.page === "/projects") return renderProjectsPage();
  if (state.page === "/board") return renderBoardPage(project);
  if (state.page === "/tasks") return renderTasksPage(project);
  if (state.page === "/comments") return renderCommentsPage();
  if (state.page === "/notifications") return renderFullNotifications();
  if (state.page === "/team") return renderTeamPage(project);
  return renderDashboard(project);
}

function renderNav() {
  const links = [
    ["/dashboard", "Dashboard"],
    ["/projects", "Projects"],
    ["/board", "Board"],
    ["/tasks", "Tasks"],
    ["/comments", "Comments"],
    ["/notifications", "Notifications"],
    ["/team", "Team"]
  ];
  return `
    <nav class="main-nav">
      ${links
        .map((link) => `<a href="${link[0]}" class="${state.page === link[0] ? "active" : ""}" data-route="${link[0]}">${link[1]}</a>`)
        .join("")}
    </nav>
  `;
}

function renderApp() {
  const project = activeProject();
  app.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="logo">C</span> Collab Tool</div>
        ${renderNav()}
        <div class="side-block">
          <span class="eyebrow">Projects</span>
          <div class="project-list">
            ${state.projects
              .map(
                (item) => `
                <button class="project-tab ${item.id === project?.id ? "active" : ""}" data-project-id="${item.id}">
                  ${escapeHtml(item.name)}
                </button>`
              )
              .join("") || `<p class="muted">No projects yet.</p>`}
          </div>
        </div>
        <div class="side-block mini-profile">
          <span class="avatar">${escapeHtml(state.user.name.slice(0, 1))}</span>
          <div>
            <strong>${escapeHtml(state.user.name)}</strong>
            <p class="muted">${escapeHtml(state.user.email)}</p>
          </div>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <span class="eyebrow">Workspace</span>
            <strong>${escapeHtml(state.user.name)}</strong>
            <div class="muted">${escapeHtml(state.user.email)}</div>
          </div>
          <button class="btn ghost" id="logout">Log out</button>
        </div>
        ${renderPage(project)}
      </main>
    </section>
  `;
  bindAppEvents(project);
}

function bindAppEvents(activeProject) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      goTo(link.dataset.route);
    });
  });

  document.querySelectorAll(".project-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeProjectId = button.dataset.projectId;
      goTo("/board");
    });
  });

  document.querySelectorAll(".project-open").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeProjectId = button.dataset.projectId;
      goTo("/board");
    });
  });

  document.querySelector("#activeProjectPicker")?.addEventListener("change", (event) => {
    setState({ activeProjectId: event.target.value });
  });

  document.querySelector("#taskPageBoard")?.addEventListener("click", () => {
    goTo("/board");
  });

  document.querySelector("#logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state = {
      user: null,
      users: [],
      projects: [],
      notifications: [],
      activeProjectId: null,
      socket: null,
      page: "/dashboard"
    };
    history.pushState({}, "", "/");
    render();
  });

  document.querySelector("#projectForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    payload.memberEmails = payload.memberEmails.split(",").map((email) => email.trim()).filter(Boolean);
    setState(await api("/api/projects", { method: "POST", body: JSON.stringify(payload) }));
  });

  document.querySelector("#taskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    setState(await api(`/api/projects/${activeProject.id}/tasks`, { method: "POST", body: JSON.stringify(payload) }));
  });

  document.querySelectorAll("[data-action='move']").forEach((select) => {
    select.addEventListener("change", async () => {
      setState(await api(`/api/tasks/${select.dataset.taskId}`, { method: "PATCH", body: JSON.stringify({ columnId: select.value }) }));
    });
  });

  document.querySelectorAll("[data-action='assign']").forEach((select) => {
    select.addEventListener("change", async () => {
      setState(await api(`/api/tasks/${select.dataset.taskId}`, { method: "PATCH", body: JSON.stringify({ assigneeId: select.value }) }));
    });
  });

  document.querySelectorAll(".comment-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      setState(await api(`/api/tasks/${form.dataset.taskId}/comments`, { method: "POST", body: JSON.stringify(payload) }));
    });
  });

  document.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", card.dataset.taskId));
  });

  document.querySelectorAll(".column").forEach((column) => {
    column.addEventListener("dragover", (event) => event.preventDefault());
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      const taskId = event.dataTransfer.getData("text/plain");
      setState(await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ columnId: column.dataset.columnId }) }));
    });
  });

  document.querySelector("#readNotifications")?.addEventListener("click", async () => {
    setState(await api("/api/notifications/read", { method: "POST" }));
  });
}

function render() {
  if (!state.user) renderAuth();
  else renderApp();
}

window.addEventListener("popstate", () => {
  state.page = location.pathname === "/" ? "/dashboard" : location.pathname;
  render();
});

refresh().catch(renderAuth);
