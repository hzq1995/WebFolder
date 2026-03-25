/**
 * WebFolder — Frontend Logic
 * ============================================================
 * Vanilla ES2020+.  No build step required.
 */

"use strict";

/* ── Utility helpers ────────────────────────────────────────────────────── */

/** Format bytes to human-readable string */
function fmtSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Show/hide a DOM element */
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

/** Get element by id */
const $ = (id) => document.getElementById(id);

/* ── Snackbar (Toast) ───────────────────────────────────────────────────── */

let _snackTimer = null;

function showSnack(msg, duration = 3000) {
  const bar = $("snackbar");
  $("snackbarMsg").textContent = msg;
  show(bar);
  clearTimeout(_snackTimer);
  _snackTimer = setTimeout(() => hide(bar), duration);
}

/* ── File type → Material Icon mapping ─────────────────────────────────── */

const EXT_ICONS = {
  // Images
  jpg: "image", jpeg: "image", png: "image", gif: "image",
  webp: "image", svg: "image", bmp: "image", ico: "image",
  // Documents
  pdf: "picture_as_pdf",
  doc: "description", docx: "description",
  xls: "table_chart", xlsx: "table_chart",
  ppt: "slideshow", pptx: "slideshow",
  // Text / code
  txt: "text_snippet", md: "article",
  json: "data_object", xml: "code", html: "html", htm: "html",
  css: "css", js: "javascript", ts: "javascript",
  py: "code", sh: "terminal", yaml: "code", yml: "code",
  toml: "code", ini: "settings", cfg: "settings", conf: "settings",
  log: "receipt_long", csv: "table_rows",
  // Archives
  zip: "folder_zip", rar: "folder_zip", "7z": "folder_zip",
  tar: "folder_zip", gz: "folder_zip",
  // Media
  mp3: "audio_file", wav: "audio_file", flac: "audio_file",
  mp4: "video_file", mkv: "video_file", avi: "video_file", mov: "video_file",
  // Misc
  exe: "terminal", dmg: "disc_full", iso: "disc_full",
};

function fileIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return EXT_ICONS[ext] || "insert_drive_file";
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

async function checkAuth() {
  try {
    const res = await fetch("/api/auth-check", { credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

async function initApp() {
  const authed = await checkAuth();
  if (authed) {
    showMain();
  } else {
    showLogin();
  }
}

function showLogin() {
  hide($("mainScreen"));
  show($("loginScreen"));
  setTimeout(() => $("passwordInput").focus(), 80);
}

function showMain() {
  hide($("loginScreen"));
  show($("mainScreen"));
  loadFiles();
  restoreRemoteTasks();
}

async function restoreRemoteTasks() {
  try {
    const res = await fetch('/api/remote-download/tasks', { credentials: 'same-origin' });
    if (!res.ok) return;
    const tasks = await res.json();
    if (!tasks.length) return;
    tasks.forEach((task) => {
      // avoid adding duplicate cards if already present
      if (!$(`remote-task-${task.id}`)) {
        addRemoteTask(task.id, task.filename || task.url);
      }
      pollRemoteTask(task.id);
    });
  } catch { /* silent */ }
}

/* ── Login handlers ─────────────────────────────────────────────────────── */

$("loginBtn").addEventListener("click", doLogin);
$("passwordInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

$("togglePw").addEventListener("click", () => {
  const input = $("passwordInput");
  const icon = $("togglePwIcon");
  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "visibility";
  } else {
    input.type = "password";
    icon.textContent = "visibility_off";
  }
});

async function doLogin() {
  const password = $("passwordInput").value;
  const errEl = $("loginError");
  errEl.textContent = "";

  if (!password) {
    errEl.textContent = "请输入密码";
    return;
  }

  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "验证中…";

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      credentials: "same-origin",
    });

    if (res.ok) {
      $("passwordInput").value = "";
      showMain();
    } else {
      errEl.textContent = "密码错误，请重试";
      $("passwordInput").select();
    }
  } catch {
    errEl.textContent = "网络错误，请检查连接";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-round">lock_open</span>登录';
  }
}

/* ── Logout ─────────────────────────────────────────────────────────────── */

$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  showLogin();
});

/* ── Refresh ────────────────────────────────────────────────────────────── */

$("refreshBtn").addEventListener("click", loadFiles);

/* ── File list ──────────────────────────────────────────────────────────── */

async function loadFiles() {
  const listEl = $("fileList");
  const emptyEl = $("emptyState");

  try {
    const res = await fetch("/api/files", { credentials: "same-origin" });
    if (res.status === 401) { showLogin(); return; }

    const files = await res.json();

    // Clear existing items (keep emptyState in DOM)
    listEl.querySelectorAll(".file-item").forEach((el) => el.remove());

    if (files.length === 0) {
      show(emptyEl);
      return;
    }
    hide(emptyEl);

    files.forEach((file) => {
      listEl.appendChild(buildFileRow(file));
    });
  } catch {
    showSnack("加载文件列表失败");
  }
}

function buildFileRow(file) {
  const row = document.createElement("div");
  row.className = "file-item";
  row.dataset.name = file.name;

  const actions = [];

  if (file.previewable) {
    actions.push(
      `<button class="icon-btn preview-btn" title="预览" data-name="${esc(file.name)}">
         <span class="material-icons-round">visibility</span>
       </button>`
    );
  }
  if (file.editable) {
    actions.push(
      `<button class="icon-btn edit-btn" title="编辑" data-name="${esc(file.name)}">
         <span class="material-icons-round">edit</span>
       </button>`
    );
  }
  actions.push(
    `<button class="icon-btn download-btn" title="下载" data-name="${esc(file.name)}">
       <span class="material-icons-round">download</span>
     </button>`,
    `<button class="icon-btn copylink-btn" title="复制下载链接" data-name="${esc(file.name)}">
       <span class="material-icons-round">link</span>
     </button>`,
    `<button class="icon-btn rename-btn" title="重命名" data-name="${esc(file.name)}">
       <span class="material-icons-round">drive_file_rename_outline</span>
     </button>`,
    `<button class="icon-btn delete-btn" title="删除" data-name="${esc(file.name)}">
       <span class="material-icons-round">delete</span>
     </button>`
  );

  row.innerHTML = `
    <div class="file-col-name">
      <span class="material-icons-round file-type-icon">${fileIcon(file.name)}</span>
      <span class="file-name-text" title="${esc(file.name)}">${esc(file.name)}</span>
    </div>
    <div class="file-col-size">${fmtSize(file.size)}</div>
    <div class="file-col-date">${esc(file.modified)}</div>
    <div class="file-col-actions">${actions.join("")}</div>
  `;

  // Bind button events
  row.querySelector(".download-btn")?.addEventListener("click", () => downloadFile(file.name));
  row.querySelector(".copylink-btn")?.addEventListener("click", () => copyDownloadLink(file.name));
  row.querySelector(".delete-btn")?.addEventListener("click", () => confirmDelete(file.name));
  row.querySelector(".preview-btn")?.addEventListener("click", () => previewImage(file.name));
  row.querySelector(".edit-btn")?.addEventListener("click", () => openEditor(file.name));
  row.querySelector(".rename-btn")?.addEventListener("click", () => openRename(file.name));

  return row;
}

/** HTML-escape a string to prevent XSS in innerHTML */
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Upload ─────────────────────────────────────────────────────────────── */

const uploadZone = $("uploadZone");
const fileInput  = $("fileInput");

$("selectFileBtn").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) uploadFile(fileInput.files[0]);
  fileInput.value = "";
});

// Drag-and-drop
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

function uploadFile(file) {
  const progContainer = $("uploadProgressContainer");
  const progBar       = $("uploadProgressBar");
  const progPct       = $("uploadProgressPct");
  const progLabel     = $("uploadProgressLabel");

  progLabel.textContent = `正在上传：${file.name}`;
  progBar.style.width   = "0%";
  progPct.textContent   = "0%";
  show(progContainer);

  const xhr = new XMLHttpRequest();
  const fd  = new FormData();
  fd.append("file", file);

  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progBar.style.width = pct + "%";
      progPct.textContent = pct + "%";
    }
  });

  xhr.addEventListener("load", () => {
    hide(progContainer);
    if (xhr.status === 201) {
      showSnack(`✓ 上传成功：${file.name}`);
      loadFiles();
    } else {
      let msg = "上传失败";
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
      showSnack(`✗ ${msg}`);
    }
  });

  xhr.addEventListener("error", () => {
    hide(progContainer);
    showSnack("✗ 网络错误，上传失败");
  });

  xhr.open("POST", "/api/upload");
  xhr.withCredentials = true;
  xhr.send(fd);
}

/* ── Download ───────────────────────────────────────────────────────────── */

function downloadFile(filename) {
  // Use a direct anchor navigation so the browser handles streaming natively.
  // The auth cookie is sent automatically with same-origin requests, so the
  // @require_auth check on /api/download will still pass.
  const a = document.createElement("a");
  a.href = `/api/download/${encodeURIComponent(filename)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
  showSnack(`⬇ 开始下载：${filename}`);
}

function copyDownloadLink(filename) {
  fetch("/api/apikey", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((data) => {
      const base = `${location.origin}/api/download/${encodeURIComponent(filename)}`;
      const url = data.api_key ? `${base}?token=${encodeURIComponent(data.api_key)}` : base;
      const doCopy = () => {
        navigator.clipboard.writeText(url).then(
          () => showSnack(`🔗 链接已复制：${filename}`),
          () => {
            const ta = document.createElement("textarea");
            ta.value = url;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
            showSnack(`🔗 链接已复制：${filename}`);
          }
        );
      };
      doCopy();
    })
    .catch(() => showSnack("❌ 获取授权信息失败"));
}

/* ── Delete ─────────────────────────────────────────────────────────────── */

let _pendingDelete = null;

function confirmDelete(filename) {
  _pendingDelete = filename;
  $("deleteDialogBody").textContent = `确定要删除「${filename}」吗？此操作不可撤销。`;
  show($("deleteDialogBackdrop"));
}

$("deleteCancelBtn").addEventListener("click", () => {
  _pendingDelete = null;
  hide($("deleteDialogBackdrop"));
});

$("deleteDialogBackdrop").addEventListener("click", (e) => {
  if (e.target === $("deleteDialogBackdrop")) {
    _pendingDelete = null;
    hide($("deleteDialogBackdrop"));
  }
});

$("deleteConfirmBtn").addEventListener("click", async () => {
  if (!_pendingDelete) return;
  const filename = _pendingDelete;
  _pendingDelete = null;
  hide($("deleteDialogBackdrop"));

  try {
    const res = await fetch(`/api/delete/${encodeURIComponent(filename)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      showSnack(`✓ 已删除：${filename}`);
      loadFiles();
    } else {
      showSnack("✗ 删除失败");
    }
  } catch {
    showSnack("✗ 网络错误，删除失败");
  }
});

/* ── Image Preview ──────────────────────────────────────────────────────── */

function previewImage(filename) {
  $("previewImg").src = `/api/preview/${encodeURIComponent(filename)}`;
  $("imageDialogTitle").textContent = filename;
  show($("imageDialogBackdrop"));
}

$("imageDialogClose").addEventListener("click", closeImageDialog);
$("imageDialogBackdrop").addEventListener("click", (e) => {
  if (e.target === $("imageDialogBackdrop")) closeImageDialog();
});

function closeImageDialog() {
  hide($("imageDialogBackdrop"));
  // Delay clearing src to avoid flicker
  setTimeout(() => { $("previewImg").src = ""; }, 200);
}

/* ── Text Editor ────────────────────────────────────────────────────────── */

let _editingFile = null;

async function openEditor(filename) {
  try {
    const res = await fetch(`/api/preview/${encodeURIComponent(filename)}`, {
      credentials: "same-origin",
    });
    if (!res.ok) { showSnack("✗ 无法读取文件内容"); return; }
    const data = await res.json();
    _editingFile = filename;
    $("editorTextarea").value = data.content;
    $("editorDialogTitle").textContent = `编辑 — ${filename}`;
    show($("editorDialogBackdrop"));
    setTimeout(() => $("editorTextarea").focus(), 80);
  } catch {
    showSnack("✗ 读取文件失败");
  }
}

$("editorCancelBtn").addEventListener("click", closeEditor);
$("editorDialogClose").addEventListener("click", closeEditor);
$("editorDialogBackdrop").addEventListener("click", (e) => {
  if (e.target === $("editorDialogBackdrop")) closeEditor();
});

function closeEditor() {
  _editingFile = null;
  hide($("editorDialogBackdrop"));
}

$("editorSaveBtn").addEventListener("click", async () => {
  if (!_editingFile) return;
  const content = $("editorTextarea").value;
  const btn = $("editorSaveBtn");
  btn.disabled = true;

  try {
    const res = await fetch(`/api/edit/${encodeURIComponent(_editingFile)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      credentials: "same-origin",
    });
    if (res.ok) {
      showSnack(`✓ 已保存：${_editingFile}`);
      closeEditor();
      loadFiles();
    } else {
      showSnack("✗ 保存失败");
    }
  } catch {
    showSnack("✗ 网络错误，保存失败");
  } finally {
    btn.disabled = false;
  }
});

// Ctrl+S shortcut inside editor
$("editorTextarea").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    $("editorSaveBtn").click();
  }
});

/* ── Rename ─────────────────────────────────────────────────────────────── */

let _renamingFile = null;

function openRename(filename) {
  _renamingFile = filename;
  $("renameInput").value = filename;
  $("renameError").textContent = "";
  show($("renameDialogBackdrop"));
  setTimeout(() => {
    const input = $("renameInput");
    input.focus();
    // Select filename without extension
    const dot = filename.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : filename.length);
  }, 80);
}

$("renameCancelBtn").addEventListener("click", closeRename);
$("renameDialogBackdrop").addEventListener("click", (e) => {
  if (e.target === $("renameDialogBackdrop")) closeRename();
});

function closeRename() {
  _renamingFile = null;
  hide($("renameDialogBackdrop"));
}

$("renameConfirmBtn").addEventListener("click", doRename);
$("renameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doRename();
});

async function doRename() {
  if (!_renamingFile) return;
  const newName = $("renameInput").value.trim();
  const errEl   = $("renameError");
  errEl.textContent = "";

  if (!newName) { errEl.textContent = "请输入新文件名"; return; }
  if (newName === _renamingFile) { closeRename(); return; }

  const btn = $("renameConfirmBtn");
  btn.disabled = true;

  try {
    const res = await fetch(`/api/rename/${encodeURIComponent(_renamingFile)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
      credentials: "same-origin",
    });

    if (res.ok) {
      showSnack(`✓ 已重命名为：${newName}`);
      closeRename();
      loadFiles();
    } else {
      const data = await res.json().catch(() => ({}));
      errEl.textContent = data.error || "重命名失败";
    }
  } catch {
    errEl.textContent = "网络错误，请重试";
  } finally {
    btn.disabled = false;
  }
}

/* ── New File ───────────────────────────────────────────────────────────── */

$("newFileBtn").addEventListener("click", openNewFile);

function openNewFile() {
  $("newFileNameInput").value = "";
  $("newFileError").textContent = "";
  show($("newFileDialogBackdrop"));
  setTimeout(() => $("newFileNameInput").focus(), 80);
}

$("newFileCancelBtn").addEventListener("click", closeNewFile);
$("newFileDialogBackdrop").addEventListener("click", (e) => {
  if (e.target === $("newFileDialogBackdrop")) closeNewFile();
});

function closeNewFile() {
  hide($("newFileDialogBackdrop"));
}

$("newFileConfirmBtn").addEventListener("click", doCreateFile);
$("newFileNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doCreateFile();
});

async function doCreateFile() {
  const filename = $("newFileNameInput").value.trim();
  const errEl    = $("newFileError");
  errEl.textContent = "";

  if (!filename) { errEl.textContent = "请输入文件名"; return; }

  const btn = $("newFileConfirmBtn");
  btn.disabled = true;

  try {
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
      credentials: "same-origin",
    });

    if (res.ok) {
      const data = await res.json();
      showSnack(`✓ 已创建：${data.file.name}`);
      closeNewFile();
      loadFiles();
    } else {
      const data = await res.json().catch(() => ({}));
      errEl.textContent = data.error || "创建失败";
    }
  } catch {
    errEl.textContent = "网络错误，请重试";
  } finally {
    btn.disabled = false;
  }
}

/* ── Remote Download ────────────────────────────────────────────── */

$('remoteDownloadBtn').addEventListener('click', openRemoteDownload);

function openRemoteDownload() {
  $('remoteUrlInput').value = '';
  $('remoteFilenameInput').value = '';
  $('remoteDownloadError').textContent = '';
  show($('remoteDownloadBackdrop'));
  setTimeout(() => $('remoteUrlInput').focus(), 80);
}

$('remoteDownloadCancelBtn').addEventListener('click', closeRemoteDownload);
$('remoteDownloadBackdrop').addEventListener('click', (e) => {
  if (e.target === $('remoteDownloadBackdrop')) closeRemoteDownload();
});

function closeRemoteDownload() {
  hide($('remoteDownloadBackdrop'));
}

$('remoteDownloadConfirmBtn').addEventListener('click', doRemoteDownload);
$('remoteUrlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doRemoteDownload();
});

async function doRemoteDownload() {
  const url      = $('remoteUrlInput').value.trim();
  const filename = $('remoteFilenameInput').value.trim();
  const errEl    = $('remoteDownloadError');
  errEl.textContent = '';

  if (!url) { errEl.textContent = '请输入下载链接'; return; }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    errEl.textContent = '请输入有效的 http/https 链接';
    return;
  }

  const btn = $('remoteDownloadConfirmBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/remote-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, filename }),
      credentials: 'same-origin',
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || '启动失败';
      return;
    }
    closeRemoteDownload();
    addRemoteTask(data.task_id, data.filename || url);
    pollRemoteTask(data.task_id);
  } catch {
    errEl.textContent = '网络错误，请重试';
  } finally {
    btn.disabled = false;
  }
}

function addRemoteTask(taskId, filename) {
  show($('remoteTasksPanel'));
  const item = document.createElement('div');
  item.className = 'remote-task-item';
  item.id = `remote-task-${taskId}`;
  item.innerHTML = `
    <div class="remote-task-header">
      <span class="material-icons-round" style="font-size:18px;color:var(--md-primary);flex-shrink:0">cloud_download</span>
      <span class="remote-task-name" title="${esc(filename)}">${esc(filename)}</span>
      <span class="remote-task-status" id="remote-task-status-${taskId}">等待中…</span>
      <button class="icon-btn remote-task-cancel-btn" id="remote-task-cancel-${taskId}" title="取消下载">
        <span class="material-icons-round" style="font-size:18px">close</span>
      </button>
    </div>
    <div class="md-progress-bar">
      <div class="md-progress-bar__fill" id="remote-task-bar-${taskId}" style="width:0%"></div>
    </div>
    <div class="remote-task-detail" id="remote-task-detail-${taskId}"></div>
  `;
  $('remoteTasksList').appendChild(item);
  $(`remote-task-cancel-${taskId}`).addEventListener('click', () => cancelRemoteTask(taskId));
}

async function cancelRemoteTask(taskId) {
  try {
    await fetch(`/api/remote-download/cancel/${taskId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch { /* silent */ }
}

function pollRemoteTask(taskId) {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`/api/remote-download/status/${taskId}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) { clearInterval(timer); return; }
      const task = await res.json();

      const statusEl = $(`remote-task-status-${taskId}`);
      const barEl    = $(`remote-task-bar-${taskId}`);
      const detailEl = $(`remote-task-detail-${taskId}`);
      if (!statusEl) { clearInterval(timer); return; }

      if (task.status === 'pending' || task.status === 'running') {
        const pct = task.progress || 0;
        barEl.style.width = pct + '%';
        barEl.style.background = '';
        statusEl.textContent = pct + '%';
        statusEl.className = 'remote-task-status';
        if (task.total) {
          detailEl.textContent = `${fmtSize(task.received)} / ${fmtSize(task.total)}`;
        } else if (task.received > 0) {
          detailEl.textContent = `已接收 ${fmtSize(task.received)}`;
        }
      } else if (task.status === 'retrying') {
        barEl.style.background = 'var(--md-secondary)';
        statusEl.textContent = `重试 ${task.retry}/${task.max_retries}`;
        statusEl.className = 'remote-task-status';
        detailEl.textContent = task.error || '';
      } else if (task.status === 'done') {
        clearInterval(timer);
        const cancelBtn = $(`remote-task-cancel-${taskId}`);
        if (cancelBtn) cancelBtn.style.display = 'none';
        barEl.style.width = '100%';
        statusEl.textContent = '完成 ✓';
        statusEl.className = 'remote-task-status done';
        detailEl.textContent = `已保存：${task.filename}`;
        showSnack(`✓ 远程下载完成：${task.filename}`);
        loadFiles();
        setTimeout(() => {
          const el = $(`remote-task-${taskId}`);
          if (el) el.remove();
          if (!$('remoteTasksList').children.length) hide($('remoteTasksPanel'));
        }, 5000);
      } else if (task.status === 'cancelled') {
        clearInterval(timer);
        const cancelBtn = $(`remote-task-cancel-${taskId}`);
        if (cancelBtn) cancelBtn.style.display = 'none';
        barEl.style.width = '0%';
        statusEl.textContent = '已取消';
        statusEl.className = 'remote-task-status';
        detailEl.textContent = '';
        showSnack(`已取消下载：${task.filename}`);
        setTimeout(() => {
          const el = $(`remote-task-${taskId}`);
          if (el) el.remove();
          if (!$('remoteTasksList').children.length) hide($('remoteTasksPanel'));
        }, 3000);
      } else if (task.status === 'error') {
        clearInterval(timer);
        const cancelBtn = $(`remote-task-cancel-${taskId}`);
        if (cancelBtn) cancelBtn.style.display = 'none';
        barEl.style.width = '0%';
        barEl.style.background = 'var(--md-error)';
        statusEl.textContent = '失败';
        statusEl.className = 'remote-task-status error';
        detailEl.textContent = task.error || '未知错误';
        showSnack(`✗ 远程下载失败：${task.error || '未知错误'}`);
      }
    } catch { /* keep polling */ }
  }, 1000);
}

/* ── Global keyboard shortcuts ──────────────────────────────────────────── */

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hide($("deleteDialogBackdrop"));
    closeImageDialog();
    closeEditor();
    closeRename();
    closeNewFile();
    closeRemoteDownload();
    closeApiDoc();
  }
});

/* ── API Doc Dialog ───────────────────────────────────────────────────────────────────────────────────── */

$("apiDocBtn").addEventListener("click", openApiDoc);
$("apiDocClose").addEventListener("click", closeApiDoc);
$("apiDocBackdrop").addEventListener("click", (e) => {
  if (e.target === $("apiDocBackdrop")) closeApiDoc();
});

async function openApiDoc() {
  const base = `${window.location.protocol}//${window.location.host}`;
  _renderDocExamples(base, "YOUR_API_KEY");
  show($("apiDocBackdrop"));

  try {
    const res = await fetch("/api/apikey", { credentials: "same-origin" });
    const data = await res.json();
    const key = data.api_key;
    const valEl  = $("docApiKeyVal");
    const hintEl = $("docApiKeyHint");
    if (key) {
      valEl.textContent = key;
      hintEl.textContent = "";
      _renderDocExamples(base, key);
    } else {
      valEl.textContent = "（未配置）";
      hintEl.textContent = "在 config.py 中设置 API_KEY 字段后即可通过命令行访问。";
    }
  } catch {
    $("docApiKeyVal").textContent = "（获取失败）";
  }
}

function closeApiDoc() {
  hide($("apiDocBackdrop"));
}

$("docApiKeyCopy").addEventListener("click", () => {
  const key = $("docApiKeyVal").textContent;
  if (!key || key.startsWith("（")) return;
  navigator.clipboard.writeText(key).then(() => showSnack("✓ API Key 已复制"));
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".doc-copy-btn");
  if (!btn) return;
  const pre = $(btn.dataset.target);
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => showSnack("✓ 已复制"));
});

function _renderDocExamples(base, key) {
  const h = `-H "Authorization: Bearer ${key}"`;

  $("docBaseUrlInline").textContent = base;
  $("docKeyInline").textContent     = key;

  $("ex-list").textContent =
    `curl ${h} \\\n  ${base}/api/files`;

  $("ex-upload").textContent =
    `curl -X POST ${h} \\\n  -F "file=@/path/to/file.txt" \\\n  ${base}/api/upload`;

  $("ex-download").textContent =
    `curl ${h} \\\n  "${base}/api/download/filename.txt" \\\n  -o filename.txt`;

  $("ex-delete").textContent =
    `curl -X DELETE ${h} \\\n  "${base}/api/delete/filename.txt"`;

  $("ex-create").textContent =
    `curl -X POST ${h} \\\n  -H "Content-Type: application/json" \\\n  -d '{"filename":"notes.txt","content":"Hello World"}' \\\n  ${base}/api/create`;

  $("ex-rename").textContent =
    `curl -X PATCH ${h} \\\n  -H "Content-Type: application/json" \\\n  -d '{"newName":"new_name.txt"}' \\\n  "${base}/api/rename/old_name.txt"`;
}

/* ── Bootstrap ──────────────────────────────────────────────────────────── */
initApp();
