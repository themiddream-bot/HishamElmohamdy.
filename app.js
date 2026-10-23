let lessons = [];
let purchased = [];
let student = null;
let progressRows = [];
const grid = document.querySelector("#lessonGrid");
const walletDialog = document.querySelector("#walletDialog");
const accountDialog = document.querySelector("#accountDialog");
const toast = document.querySelector("#toast");
const apiBase = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "/api" : "/.netlify/functions/api";
let toastTimer;
let ytApiPromise;
let ytPlayer;
let activeLessonId;
let watchedSeconds = 0;
let lastTick = 0;
let lastSaved = 0;
let trackedDurationSeconds = 0;
let watchTimer;
let vimeoPlayer;

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path.replace(/^\/api/, "")}`, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "تعذر إتمام الطلب.");
  return data;
}

async function refresh() {
  const data = await api("/api/bootstrap");
  lessons = data.lessons;
  purchased = data.purchased;
  student = data.user;
  progressRows = data.progress;
  render();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function render() {
  document.querySelector("#balanceLabel").textContent = `${student?.balance || 0} ج.م`;
  document.querySelector("#accountLabel").textContent = student?.name || "دخول الطالب";
  const avatar = document.querySelector("#accountAvatar");
  avatar.hidden = !student?.avatar;
  avatar.src = student?.avatar || "";
  document.querySelector("#openAccount .fa-regular").hidden = Boolean(student?.avatar);
  document.querySelector("#quickProfile").hidden = !student || student.role === "admin";
  document.querySelector("#quickAdmin").hidden = !student || student.role !== "admin";
  grid.innerHTML = lessons.map((lesson, index) => {
    const owned = purchased.includes(lesson.id);
    return `<article class="lesson-card ${owned ? "purchased" : ""}"><div class="lesson-card-top"><span class="lesson-icon ${lesson.tone}"><i class="${lesson.icon}"></i></span><span class="lesson-number">الحصة ٠${index + 1}</span></div><h3>${lesson.title}</h3><p>${lesson.description}</p><div class="lesson-meta"><span><i class="fa-regular fa-clock"></i>${lesson.duration}</span><span><i class="fa-solid fa-signal"></i>${lesson.level}</span></div><div class="lesson-buy"><span class="price">${lesson.price} <small>جنيه</small></span><button class="button ${owned ? "" : "primary"}" data-lesson="${lesson.id}">${owned ? '<i class="fa-solid fa-circle-play"></i> مشاهدة الحصة' : '<i class="fa-solid fa-bag-shopping"></i> اشتري الحصة'}</button></div></article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function openAccount() {
  const logged = Boolean(student);
  document.querySelector("#accountForm").hidden = logged;
  document.querySelector(".auth-tabs").hidden = logged;
  document.querySelector("#accountTitle").textContent = logged ? `أهلاً ${student.name}` : "تسجيل دخول الطالب";
  document.querySelector("#logoutButton").hidden = !logged;
  document.querySelector("#profileEditButton").hidden = !logged || student.role === "admin";
  document.querySelector("#adminOpenButton").hidden = !logged || student.role !== "admin";
  accountDialog.showModal();
}

document.querySelector("#year").textContent = new Date().getFullYear();
document.querySelector("#openAccount").addEventListener("click", openAccount);
document.querySelector("#openWallet").addEventListener("click", () => {
  if (!student) { openAccount(); showToast("سجّل دخولك أولاً"); return; }
  document.querySelector("#rechargeMessage").textContent = "";
  walletDialog.showModal();
});

grid.addEventListener("click", async event => {
  const button = event.target.closest("button[data-lesson]");
  if (!button) return;
  const lesson = lessons.find(item => item.id === button.dataset.lesson);
  if (!student) { openAccount(); showToast("سجّل دخولك أولاً للشراء ومشاهدة الحصص"); return; }
  if (purchased.includes(lesson.id)) { openLesson(lesson); return; }
  try {
    const result = await api("/api/buy", { method: "POST", body: JSON.stringify({ lessonId: lesson.id }) });
    student = result.user;
    purchased.push(lesson.id);
    render();
    showToast("تم الشراء بنجاح. اضغط مشاهدة الحصة لفتح الفيديو.");
  } catch (error) {
    showToast(error.message);
    if (error.message.includes("رصيدك غير كافٍ")) walletDialog.showModal();
  }
});

document.querySelector("#rechargeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#rechargeMessage");
  try {
    const result = await api("/api/redeem", { method: "POST", body: JSON.stringify({ code: document.querySelector("#rechargeCode").value }) });
    student = result.user;
    event.target.reset();
    message.textContent = "تم شحن الرصيد بنجاح.";
    message.className = "form-message success";
    render();
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error";
  }
});

let accountMode = "login";
document.querySelectorAll(".auth-tab").forEach(tab => tab.addEventListener("click", () => {
  accountMode = tab.dataset.mode;
  document.querySelectorAll(".auth-tab").forEach(item => item.classList.toggle("selected", item === tab));
  document.querySelector("#accountTitle").textContent = accountMode === "register" ? "إنشاء حساب الطالب" : "تسجيل دخول الطالب";
  document.querySelector(".profile-fields").hidden = accountMode !== "register";
  for (const id of ["studentName", "studentPhone", "studentGrade"]) document.querySelector(`#${id}`).required = accountMode === "register";
  document.querySelector("#accountEmailLabel").textContent = accountMode === "register" ? "البريد الإلكتروني" : "البريد أو اسم المستخدم";
  document.querySelector("#studentEmail").type = accountMode === "register" ? "email" : "text";
  document.querySelector("#accountSubmit").textContent = accountMode === "register" ? "إنشاء حساب الطالب" : "دخول إلى منصة مستر هشام";
  document.querySelector("#accountMessage").textContent = "";
}));

document.querySelector("#accountForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#accountMessage");
  const register = accountMode === "register";
  const payload = register ? {
    email: document.querySelector("#studentEmail").value.trim(),
    password: document.querySelector("#studentPassword").value,
    name: document.querySelector("#studentName").value.trim(),
    phone: document.querySelector("#studentPhone").value.trim(),
    grade: document.querySelector("#studentGrade").value.trim()
  } : { login: document.querySelector("#studentEmail").value.trim(), password: document.querySelector("#studentPassword").value };
  try {
    const result = await api(register ? "/api/register" : "/api/login", { method: "POST", body: JSON.stringify(payload) });
    student = result.user;
    await refresh();
    accountDialog.close();
    event.target.reset();
    showToast(`أهلاً ${student.name} في منصة مستر هشام المحمدي`);
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error";
  }
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  student = null;
  purchased = [];
  render();
  accountDialog.close();
});

async function openAdminPanel() {
  if (student?.role !== "admin") return;
  accountDialog.close();
  try { await renderAdmin(); document.querySelector("#adminDialog").showModal(); }
  catch (error) { showToast(error.message); }
}
document.querySelector("#adminOpenButton").addEventListener("click", openAdminPanel);
document.querySelector("#quickAdmin").addEventListener("click", openAdminPanel);

async function renderAdmin() {
  const data = await api("/api/admin/overview");
  document.querySelector("#codeList").innerHTML = data.codes.map(item => `<li><span><b>${escapeHtml(item.code)}</b> — ${item.amount} ج.م ${item.used_at ? "· مستخدم" : "· غير مستخدم"}</span>${item.used_at ? "" : `<button class="mini-delete" data-delete-code="${escapeHtml(item.code)}">حذف</button>`}</li>`).join("") || "<li>لا توجد أكواد حتى الآن.</li>";
  document.querySelector("#studentList").innerHTML = data.students.map(item => `<li><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.username)} · ${escapeHtml(item.grade || "بدون صف")} · الرصيد ${item.balance} ج.م · شاهد ${Math.floor(item.watched_seconds/60)} د</small></span><button class="mini-delete" data-delete-student="${item.id}">حذف الحساب</button></li>`).join("") || "<li>لا يوجد طلاب مسجلون.</li>";
  document.querySelector("#studentProgressList").innerHTML = data.progress.map(item => {const percent=item.duration_seconds?Math.min(100,Math.floor(100*item.watched_seconds/item.duration_seconds)):0;return `<li class="progress-line"><span><b>${escapeHtml(item.student_name)}</b> — ${escapeHtml(item.lesson_title)}<small>${Math.floor(item.watched_seconds/60)} دقيقة مشاهدة · ${percent}% من الفيديو</small></span></li>`;}).join("") || "<li>لا يوجد تقدم مسجل بعد.</li>";
  document.querySelector("#lessonAdminList").innerHTML = data.lessons.map(lesson => `<form class="lesson-link-form" data-video-lesson="${lesson.id}"><label>${escapeHtml(lesson.title)}</label><div class="input-wrap"><i class="fa-brands fa-youtube"></i><input type="url" value="${escapeHtml(lesson.video)}" required></div><button class="button secondary">حفظ رابط الحصة</button></form>`).join("");
}

document.querySelector("#adminCodeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#adminCodeMessage");
  try {
    const result = await api("/api/admin/codes", { method: "POST", body: JSON.stringify({ amount: Number(document.querySelector("#adminCodeAmount").value) }) });
    message.textContent = `الكود ${result.code} بقيمة ${result.amount} جنيه. انسخه وأرسله للطالب.`;
    message.className = "form-message success";
    event.target.reset();
    await renderAdmin();
  } catch (error) { message.textContent = error.message; message.className = "form-message error"; }
});

document.querySelector("#adminDialog").addEventListener("click", async event => {
  const deleteCode = event.target.closest("[data-delete-code]");
  const deleteStudent = event.target.closest("[data-delete-student]");
  try {
    if (deleteCode) await api(`/api/admin/codes/${encodeURIComponent(deleteCode.dataset.deleteCode)}`, { method: "DELETE", body: "{}" });
    if (deleteStudent) {
      if (!confirm("تأكيد حذف حساب الطالب وكل مشترياته؟")) return;
      await api(`/api/admin/students/${deleteStudent.dataset.deleteStudent}`, { method: "DELETE", body: "{}" });
    }
    if (deleteCode || deleteStudent) await renderAdmin();
  } catch (error) { showToast(error.message); }
});

document.querySelector("#adminDialog").addEventListener("submit", async event => {
  const form = event.target.closest(".lesson-link-form");
  if (!form) return;
  event.preventDefault();
  try {
    await api(`/api/admin/lessons/${form.dataset.videoLesson}`, { method: "PUT", body: JSON.stringify({ video: form.querySelector("input").value.trim() }) });
    await refresh();
    showToast("تم حفظ رابط الحصة.");
  } catch (error) { showToast(error.message); }
});

function openProfile() {
  if (!student || student.role === "admin") return;
  document.querySelector("#profileName").value = student.name;
  document.querySelector("#profilePhone").value = student.phone;
  document.querySelector("#profileGrade").value = student.grade;
  document.querySelector("#avatarPreview").src = student.avatar || "";
  document.querySelector("#avatarPreview").dataset.image = "";
  accountDialog.close();
  document.querySelector("#profileDialog").showModal();
}
document.querySelector("#profileEditButton").addEventListener("click", openProfile);
document.querySelector("#quickProfile").addEventListener("click", openProfile);

document.querySelector("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await api("/api/profile", { method: "PUT", body: JSON.stringify({ name: document.querySelector("#profileName").value.trim(), phone: document.querySelector("#profilePhone").value.trim(), grade: document.querySelector("#profileGrade").value.trim(), avatar: document.querySelector("#avatarPreview").dataset.image || student.avatar || "" }) });
    student = result.user;
    render();
    document.querySelector("#profileMessage").textContent = "تم حفظ بياناتك.";
    document.querySelector("#profileMessage").className = "form-message success";
  } catch (error) { showToast(error.message); }
});

document.querySelector("#avatarUpload").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { showToast("اختر صورة PNG أو JPG أو WebP."); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.78);
      document.querySelector("#avatarPreview").src = data;
      document.querySelector("#avatarPreview").dataset.image = data;
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function openLesson(lesson) {
  document.querySelector("#lessonDialogTitle").textContent = `${lesson.title} — مستر هشام المحمدي`;
  const match = lesson.video.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  activeLessonId = lesson.id;
  const previous = progressRows.find(row => row.lesson_id === lesson.id);
  watchedSeconds = previous?.watched_seconds || 0;
  lastSaved = watchedSeconds;
  trackedDurationSeconds = previous?.duration_seconds || 0;
  const vimeoMatch = lesson.video.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  const host = document.querySelector("#lessonPlayerHost");
  host.replaceChildren();
  document.querySelector("#lessonDialog").showModal();
  if (match) attachYouTubeTracking(match[1]);
  else if (vimeoMatch) attachVimeoTracking(vimeoMatch[1]);
  else showFallbackVideo(lesson.video);
}
function startWatchTimer() {
  clearInterval(watchTimer);
  lastTick = Date.now();
  watchTimer = setInterval(() => {
    const now = Date.now();
    watchedSeconds += Math.min(6, Math.max(0, (now-lastTick)/1000));
    lastTick = now;
    if (watchedSeconds-lastSaved >= 15) saveProgress();
  }, 5000);
}
function stopWatchTimer() {
  if (watchTimer) {
    watchedSeconds += Math.min(6, Math.max(0, (Date.now()-lastTick)/1000));
    clearInterval(watchTimer);
    watchTimer = null;
    lastTick = 0;
    saveProgress();
  }
}
async function attachYouTubeTracking(videoId) {
  const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  showFallbackVideo(embedUrl);
  if (!ytApiPromise) ytApiPromise = new Promise(resolve => {
    window.onYouTubeIframeAPIReady = () => resolve(true);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => resolve(false);
    document.head.append(script);
    setTimeout(() => resolve(false), 8000);
  });
  const apiReady = await ytApiPromise;
  if (!apiReady) return;
  if (!document.querySelector("#lessonDialog").open) return;
  if (ytPlayer) ytPlayer.destroy();
  const host = document.querySelector("#lessonPlayerHost");
  host.replaceChildren();
  const mount = document.createElement("div");
  mount.id = "lessonPlayer";
  host.append(mount);
  ytPlayer = new YT.Player("lessonPlayer", { videoId, width: "100%", height: "100%", playerVars: { origin: location.origin, rel: 0 }, events: { onStateChange: event => {
    if (event.data === YT.PlayerState.PLAYING) {
      trackedDurationSeconds = Math.floor(ytPlayer.getDuration()) || trackedDurationSeconds;
      startWatchTimer();
    } else stopWatchTimer();
  }, onError: () => showFallbackVideo(`https://www.youtube.com/embed/${videoId}`) } });
}
async function attachVimeoTracking(videoId) {
  const frame = document.createElement("iframe");
  frame.src = `https://player.vimeo.com/video/${videoId}?api=1`;
  frame.allow = "autoplay; fullscreen; picture-in-picture";
  frame.allowFullscreen = true;
  frame.title = document.querySelector("#lessonDialogTitle").textContent;
  document.querySelector("#lessonPlayerHost").append(frame);
  if (!window.Vimeo?.Player) await new Promise(resolve => {
    const script = document.createElement("script");
    script.src = "https://player.vimeo.com/api/player.js";
    script.onload = resolve;
    script.onerror = resolve;
    setTimeout(resolve, 8000);
    document.head.append(script);
  });
  if (!document.querySelector("#lessonDialog").open || !window.Vimeo?.Player) return;
  vimeoPlayer = new Vimeo.Player(frame);
  vimeoPlayer.getDuration().then(duration => { trackedDurationSeconds = Math.floor(duration); });
  vimeoPlayer.on("play", startWatchTimer);
  vimeoPlayer.on("pause", stopWatchTimer);
  vimeoPlayer.on("ended", stopWatchTimer);
}
function showFallbackVideo(src) {
  const host = document.querySelector("#lessonPlayerHost");
  if (!document.querySelector("#lessonDialog").open) return;
  host.replaceChildren();
  const frame = document.createElement("iframe");
  frame.src = src;
  frame.title = document.querySelector("#lessonDialogTitle").textContent;
  frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  host.append(frame);
}
async function saveProgress() {
  if (!student || !activeLessonId) return;
  const durationSeconds = trackedDurationSeconds || Math.floor(ytPlayer?.getDuration?.() || 0);
  if (!durationSeconds || watchedSeconds <= lastSaved) return;
  lastSaved = Math.floor(watchedSeconds);
  const item = { lesson_id: activeLessonId, watched_seconds: lastSaved, duration_seconds: durationSeconds };
  const idx = progressRows.findIndex(row => row.lesson_id === activeLessonId);
  if (idx < 0) progressRows.push(item); else progressRows[idx] = item;
  try { await api("/api/progress", { method: "POST", body: JSON.stringify({ lessonId: activeLessonId, watchedSeconds: lastSaved, durationSeconds }) }); } catch {}
}
document.querySelector("#lessonDialog").addEventListener("close", () => {
  stopWatchTimer();
  saveProgress();
  if (ytPlayer) { ytPlayer.destroy(); ytPlayer = null; }
  if (vimeoPlayer) { vimeoPlayer.unload().catch(() => {}); vimeoPlayer = null; }
  document.querySelector("#lessonPlayerHost").replaceChildren();
});

document.querySelector("#accountDialog").addEventListener("close", () => {
  document.querySelector("#accountForm").hidden = Boolean(student);
  document.querySelector(".auth-tabs").hidden = Boolean(student);
});

refresh().catch(error => showToast(error.message));
