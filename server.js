const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const testHash = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), testHash);
}

function defaultStore() {
  const now = new Date().toISOString();
  const ownerId = id("usr");
  const teammateId = id("usr");
  const projectId = id("prj");
  const todo = id("col");
  const doing = id("col");
  const done = id("col");
  const taskId = id("tsk");
  return {
    sessions: {},
    users: [
      { id: ownerId, name: "Demo Manager", email: "demo@example.com", passwordHash: hashPassword("password123") },
      { id: teammateId, name: "Project Teammate", email: "teammate@example.com", passwordHash: hashPassword("password123") }
    ],
    projects: [
      {
        id: projectId,
        name: "Website Launch",
        description: "Coordinate design, content, engineering, and release tasks.",
        ownerId,
        memberIds: [ownerId, teammateId],
        columns: [
          { id: todo, name: "To Do" },
          { id: doing, name: "In Progress" },
          { id: done, name: "Done" }
        ],
        createdAt: now
      }
    ],
    tasks: [
      {
        id: taskId,
        projectId,
        columnId: todo,
        title: "Prepare launch checklist",
        description: "Gather owners, due dates, and final approval steps.",
        assigneeId: teammateId,
        priority: "High",
        dueDate: "",
        createdBy: ownerId,
        createdAt: now
      }
    ],
    comments: [
      {
        id: id("cmt"),
        taskId,
        authorId: ownerId,
        body: "Please add the release blockers here so the team can track them.",
        createdAt: now
      }
    ],
    notifications: []
  };
}

function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const store = defaultStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
    return store;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

let store = loadStore();

function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const userId = store.sessions[cookies.session];
  return store.users.find((user) => user.id === userId) || null;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Please sign in first." });
    return;
  }
  req.user = user;
  next();
}

function canAccessProject(userId, projectId) {
  const project = store.projects.find((item) => item.id === projectId);
  return project && project.memberIds.includes(userId);
}

function createNotification(userId, message, projectId, taskId) {
  if (!userId) return;
  store.notifications.unshift({
    id: id("ntf"),
    userId,
    message,
    projectId,
    taskId,
    read: false,
    createdAt: new Date().toISOString()
  });
}

function boardPayload(user) {
  const projects = store.projects
    .filter((project) => project.memberIds.includes(user.id))
    .map((project) => ({
      ...project,
      members: project.memberIds.map((memberId) => publicUser(store.users.find((item) => item.id === memberId))),
      tasks: store.tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => ({
          ...task,
          assignee: publicUser(store.users.find((item) => item.id === task.assigneeId)),
          comments: store.comments
            .filter((comment) => comment.taskId === task.id)
            .map((comment) => ({
              ...comment,
              author: publicUser(store.users.find((item) => item.id === comment.authorId))
            }))
        }))
    }));

  return {
    user: publicUser(user),
    users: store.users.map(publicUser),
    projects,
    notifications: store.notifications.filter((notification) => notification.userId === user.id).slice(0, 30)
  };
}

function emitProject(projectId) {
  io.to(projectId).emit("project:updated", { projectId });
}

app.get("/api/me", requireAuth, (req, res) => {
  res.json(boardPayload(req.user));
});

app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password are required." });
  if (store.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "That email is already registered." });
  }
  const user = { id: id("usr"), name, email, passwordHash: hashPassword(password) };
  const session = id("ses");
  store.users.push(user);
  store.sessions[session] = user.id;
  saveStore();
  res.cookie("session", session, { httpOnly: true, sameSite: "lax" });
  res.status(201).json(boardPayload(user));
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = store.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !verifyPassword(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const session = id("ses");
  store.sessions[session] = user.id;
  saveStore();
  res.cookie("session", session, { httpOnly: true, sameSite: "lax" });
  res.json(boardPayload(user));
});

app.post("/api/logout", requireAuth, (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  delete store.sessions[cookies.session];
  saveStore();
  res.clearCookie("session");
  res.json({ ok: true });
});

app.post("/api/projects", requireAuth, (req, res) => {
  const { name, description, memberEmails = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Project name is required." });
  const memberIds = new Set([req.user.id]);
  memberEmails.forEach((email) => {
    const member = store.users.find((user) => user.email.toLowerCase() === String(email).toLowerCase().trim());
    if (member) memberIds.add(member.id);
  });
  const project = {
    id: id("prj"),
    name,
    description: description || "",
    ownerId: req.user.id,
    memberIds: [...memberIds],
    columns: [
      { id: id("col"), name: "To Do" },
      { id: id("col"), name: "In Progress" },
      { id: id("col"), name: "Done" }
    ],
    createdAt: new Date().toISOString()
  };
  store.projects.push(project);
  project.memberIds.forEach((memberId) => {
    if (memberId !== req.user.id) createNotification(memberId, `${req.user.name} added you to ${project.name}.`, project.id);
  });
  saveStore();
  io.emit("projects:changed");
  res.status(201).json(boardPayload(req.user));
});

app.post("/api/projects/:projectId/tasks", requireAuth, (req, res) => {
  const { projectId } = req.params;
  if (!canAccessProject(req.user.id, projectId)) return res.status(403).json({ error: "You are not on this project." });
  const project = store.projects.find((item) => item.id === projectId);
  const { title, description, assigneeId, priority, dueDate } = req.body;
  if (!title) return res.status(400).json({ error: "Task title is required." });
  const task = {
    id: id("tsk"),
    projectId,
    columnId: project.columns[0].id,
    title,
    description: description || "",
    assigneeId: assigneeId || "",
    priority: priority || "Medium",
    dueDate: dueDate || "",
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  store.tasks.push(task);
  createNotification(assigneeId, `${req.user.name} assigned you: ${title}.`, projectId, task.id);
  saveStore();
  emitProject(projectId);
  res.status(201).json(boardPayload(req.user));
});

app.patch("/api/tasks/:taskId", requireAuth, (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId);
  if (!task || !canAccessProject(req.user.id, task.projectId)) return res.status(404).json({ error: "Task not found." });
  const previousAssignee = task.assigneeId;
  ["title", "description", "assigneeId", "priority", "dueDate", "columnId"].forEach((field) => {
    if (req.body[field] !== undefined) task[field] = req.body[field];
  });
  if (task.assigneeId && task.assigneeId !== previousAssignee) {
    createNotification(task.assigneeId, `${req.user.name} assigned you: ${task.title}.`, task.projectId, task.id);
  }
  saveStore();
  emitProject(task.projectId);
  res.json(boardPayload(req.user));
});

app.post("/api/tasks/:taskId/comments", requireAuth, (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.taskId);
  if (!task || !canAccessProject(req.user.id, task.projectId)) return res.status(404).json({ error: "Task not found." });
  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ error: "Comment cannot be empty." });
  const comment = { id: id("cmt"), taskId: task.id, authorId: req.user.id, body, createdAt: new Date().toISOString() };
  store.comments.push(comment);
  const project = store.projects.find((item) => item.id === task.projectId);
  project.memberIds
    .filter((memberId) => memberId !== req.user.id)
    .forEach((memberId) => createNotification(memberId, `${req.user.name} commented on ${task.title}.`, task.projectId, task.id));
  saveStore();
  emitProject(task.projectId);
  res.status(201).json(boardPayload(req.user));
});

app.post("/api/notifications/read", requireAuth, (req, res) => {
  store.notifications.forEach((notification) => {
    if (notification.userId === req.user.id) notification.read = true;
  });
  saveStore();
  res.json(boardPayload(req.user));
});

io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const userId = store.sessions[cookies.session];
  const user = store.users.find((item) => item.id === userId);
  if (!user) return next(new Error("unauthorized"));
  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  store.projects
    .filter((project) => project.memberIds.includes(socket.user.id))
    .forEach((project) => socket.join(project.id));
});

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

function listen(port, attemptsLeft = 10) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });

  server.listen(port, () => {
    console.log(`Collab Tool running at http://127.0.0.1:${port}`);
  });
}

listen(PORT);
