const DEFAULT_PROJECT_NAME = "세종천안 2공구 (주)한화";
const DAY_COUNT = 5;
const LOCAL_PREFIX = "curing-photo-board:";
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_HEIGHT = 1067;
const IMAGE_QUALITY = 0.78;

const elements = {
  copyLinkButton: document.getElementById("copyLinkButton"),
  printButton: document.getElementById("printButton"),
  newBoardButton: document.getElementById("newBoardButton"),
  prevMonthButton: document.getElementById("prevMonthButton"),
  nextMonthButton: document.getElementById("nextMonthButton"),
  listMonthInput: document.getElementById("listMonthInput"),
  boardList: document.getElementById("boardList"),
  projectNameInput: document.getElementById("projectNameInput"),
  pourPartInput: document.getElementById("pourPartInput"),
  pourDateInput: document.getElementById("pourDateInput"),
  prevPourDateButton: document.getElementById("prevPourDateButton"),
  nextPourDateButton: document.getElementById("nextPourDateButton"),
  summaryList: document.getElementById("summaryList"),
  dayGrid: document.getElementById("dayGrid"),
  printArea: document.getElementById("printArea"),
  syncStatus: document.getElementById("syncStatus"),
  toast: document.getElementById("toast"),
};

const config = window.CONCRETE_PHOTO_CONFIG || {};
let dbClient = null;
let realtimeChannel = null;
let metaSaveTimer = null;
let boardList = [];
let touchStartX = 0;
let touchStartY = 0;
let swipeDay = null;

let state = {
  shareCode: "",
  boardId: null,
  projectName: DEFAULT_PROJECT_NAME,
  pourPart: "",
  pourDate: "",
  entries: {},
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.shareCode = ensureShareCode();
  bindEvents();
  setDefaultListDate();
  setSyncStatus("저장소를 확인하는 중입니다.");

  if (canUseCloud()) {
    await setupCloudMode();
  } else {
    loadLocalBoard();
    await loadBoardList();
    setSyncStatus("현재 브라우저에만 저장됩니다. 실시간 공유는 config.js 설정 후 사용할 수 있습니다.");
  }

  renderAll();
}

function bindEvents() {
  elements.copyLinkButton.addEventListener("click", copyShareLink);
  elements.printButton.addEventListener("click", () => window.print());
  elements.newBoardButton.addEventListener("click", createNewBoard);
  elements.prevMonthButton.addEventListener("click", () => shiftListDate(-1));
  elements.nextMonthButton.addEventListener("click", () => shiftListDate(1));
  elements.prevPourDateButton.addEventListener("click", () => shiftPourDate(-1));
  elements.nextPourDateButton.addEventListener("click", () => shiftPourDate(1));
  elements.listMonthInput.addEventListener("change", async () => {
    await loadBoardList();
    renderBoardList();
  });
  elements.summaryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-summary-day]");
    if (!button) return;

    const card = elements.dayGrid.querySelector(`[data-day-card="${button.dataset.summaryDay}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  elements.boardList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-board-code]");
    if (deleteButton) {
      event.stopPropagation();
      deleteBoard(deleteButton.dataset.deleteBoardCode);
      return;
    }

    const button = event.target.closest("[data-board-code]");
    if (!button) return;
    openBoard(button.dataset.boardCode);
  });

  [elements.projectNameInput, elements.pourPartInput, elements.pourDateInput].forEach((input) => {
    input.addEventListener("input", () => {
      pullMetaFromInputs();
      queueMetaSave();
      renderAll();
    });
  });

  elements.dayGrid.addEventListener("change", async (event) => {
    const target = event.target;
    if (!target.matches("input[type='file']")) return;

    const day = Number(target.dataset.day);
    const file = target.files && target.files[0];
    target.value = "";
    if (!day || !file) return;

    await handlePhotoUpload(day, file);
  });

  elements.dayGrid.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-day]");
    if (!deleteButton) return;

    const day = Number(deleteButton.dataset.deleteDay);
    await deletePhoto(day);
  });

  elements.dayGrid.addEventListener("touchstart", (event) => {
    const card = event.target.closest("[data-day-card]");
    if (!card || event.touches.length !== 1) return;

    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    swipeDay = Number(card.dataset.dayCard);
    card.classList.remove("swiping");
  }, { passive: true });

  elements.dayGrid.addEventListener("touchmove", (event) => {
    if (!swipeDay || event.touches.length !== 1) return;

    const card = elements.dayGrid.querySelector(`[data-day-card="${swipeDay}"]`);
    if (!card) return;

    const touch = event.touches[0];
    const diffX = touch.clientX - touchStartX;
    const diffY = Math.abs(touch.clientY - touchStartY);
    if (diffX >= 0 || Math.abs(diffX) < 16 || diffY > 42) return;

    card.classList.add("swiping");
    card.style.transform = `translateX(${Math.max(diffX, -76)}px)`;
  }, { passive: true });

  elements.dayGrid.addEventListener("touchend", async () => {
    if (!swipeDay) return;

    const card = elements.dayGrid.querySelector(`[data-day-card="${swipeDay}"]`);
    const diffX = card ? Number(card.style.transform.match(/-?\d+/)?.[0] || 0) : 0;
    const day = swipeDay;

    if (card) {
      card.classList.remove("swiping");
      card.style.transform = "";
    }

    touchStartX = 0;
    touchStartY = 0;
    swipeDay = null;

    if (diffX <= -64) {
      await deletePhoto(day);
    }
  });
}

function canUseCloud() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.bucket);
}

async function setupCloudMode() {
  try {
    await ensureSupabaseClient();
    dbClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    await loadCloudBoard();
    await loadBoardList();
    await subscribeToChanges();
    setSyncStatus("실시간 공유 저장소에 연결되었습니다.\n변경 사항은 자동으로 반영됩니다.");
  } catch (error) {
    console.error(error);
    showToast("실시간 연결에 실패해서 이 브라우저에만 저장합니다.");
    dbClient = null;
    loadLocalBoard();
    await loadBoardList();
    setSyncStatus("실시간 연결에 실패했습니다. Supabase 설정을 확인해 주세요.");
  }
}

function ensureShareCode() {
  const url = new URL(window.location.href);
  const current = url.searchParams.get("board");
  if (current) return current;

  const next = createShareCode();
  url.searchParams.set("board", next);
  window.history.replaceState({}, "", url.toString());
  return next;
}

function createShareCode() {
  return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLocalBoard() {
  const saved = localStorage.getItem(LOCAL_PREFIX + state.shareCode);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = {
        ...state,
        ...parsed,
        shareCode: state.shareCode,
        entries: parsed.entries || {},
      };
      state.projectName = normalizeProjectName(state.projectName);
    } catch (error) {
      console.warn("Local board parse failed", error);
    }
  }

  if (!state.pourDate) {
    state.pourDate = toDateInputValue(new Date());
  }

  syncInputsFromState();
  saveLocalBoard();
}

async function loadCloudBoard() {
  const { data: board, error } = await dbClient
    .from("photo_boards")
    .select("*")
    .eq("share_code", state.shareCode)
    .maybeSingle();

  if (error) throw error;

  if (board) {
    state.boardId = board.id;
    state.projectName = normalizeProjectName(board.project_name || DEFAULT_PROJECT_NAME);
    state.pourPart = board.pour_part || "";
    state.pourDate = board.pour_date || toDateInputValue(new Date());
  } else {
    const { data: created, error: insertError } = await dbClient
      .from("photo_boards")
      .insert({
        share_code: state.shareCode,
        project_name: DEFAULT_PROJECT_NAME,
        pour_part: "",
        pour_date: toDateInputValue(new Date()),
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    state.boardId = created.id;
    state.projectName = normalizeProjectName(created.project_name || DEFAULT_PROJECT_NAME);
    state.pourPart = created.pour_part || "";
    state.pourDate = created.pour_date || toDateInputValue(new Date());
  }

  await loadCloudEntries();
  syncInputsFromState();
}

async function loadCloudEntries() {
  if (!state.boardId) return;

  const { data, error } = await dbClient
    .from("photo_entries")
    .select("*")
    .eq("board_id", state.boardId)
    .order("day_no", { ascending: true });

  if (error) throw error;

  state.entries = {};
  (data || []).forEach((row) => {
    state.entries[row.day_no] = {
      dayNo: row.day_no,
      photoUrl: row.photo_url || "",
      photoPath: row.photo_path || "",
      uploadedAt: row.uploaded_at || "",
    };
  });
}

async function loadBoardList() {
  if (dbClient) {
    await loadCloudBoardList();
  } else {
    loadLocalBoardList();
  }
}

async function loadCloudBoardList() {
  const range = getListRange();
  let query = dbClient
    .from("photo_boards")
    .select("id, share_code, project_name, pour_part, pour_date, updated_at, photo_entries(day_no, photo_url)")
    .order("pour_date", { ascending: false })
    .order("updated_at", { ascending: false });

  if (range.start) query = query.gte("pour_date", range.start);
  if (range.end) query = query.lte("pour_date", range.end);

  const { data, error } = await query;
  if (error) throw error;

  boardList = (data || []).map((board) => ({
    shareCode: board.share_code,
    projectName: normalizeProjectName(board.project_name || DEFAULT_PROJECT_NAME),
    pourPart: board.pour_part || "타설부위 미입력",
    pourDate: board.pour_date || "",
    updatedAt: board.updated_at || "",
    completedCount: (board.photo_entries || []).filter((entry) => entry.photo_url).length,
  }));
}

function loadLocalBoardList() {
  const range = getListRange();
  boardList = Object.keys(localStorage)
    .filter((key) => key.startsWith(LOCAL_PREFIX))
    .map((key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        const entries = parsed.entries || {};
        return {
          shareCode: key.slice(LOCAL_PREFIX.length),
          projectName: normalizeProjectName(parsed.projectName || DEFAULT_PROJECT_NAME),
          pourPart: parsed.pourPart || "타설부위 미입력",
          pourDate: parsed.pourDate || "",
          updatedAt: parsed.updatedAt || "",
          completedCount: Object.values(entries).filter((entry) => entry && entry.photoUrl).length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((board) => {
      if (!board.pourDate) return !range.start && !range.end;
      if (range.start && board.pourDate < range.start) return false;
      if (range.end && board.pourDate > range.end) return false;
      return true;
    })
    .sort((a, b) => {
      const dateCompare = (b.pourDate || "").localeCompare(a.pourDate || "");
      if (dateCompare) return dateCompare;
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });
}

function getListRange() {
  const selectedDate = elements.listMonthInput.value;
  if (selectedDate) {
    return { start: selectedDate, end: selectedDate };
  }

  return { start: "", end: "" };
}

function setDefaultListDate() {
  if (!elements.listMonthInput.value) {
    elements.listMonthInput.value = toDateInputValue(new Date());
  }
}

async function shiftListDate(offset) {
  const current = elements.listMonthInput.value || toDateInputValue(new Date());
  const next = addDays(current, offset);
  elements.listMonthInput.value = toDateInputValue(next);
  await loadBoardList();
  renderBoardList();
}

async function shiftPourDate(offset) {
  const current = elements.pourDateInput.value || state.pourDate || toDateInputValue(new Date());
  const next = addDays(current, offset);
  elements.pourDateInput.value = toDateInputValue(next);
  pullMetaFromInputs();
  await saveMeta();
  renderAll();
}

async function subscribeToChanges() {
  if (!dbClient || !state.boardId) return;
  if (realtimeChannel) {
    await dbClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = dbClient
    .channel(`curing-board-${state.shareCode}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "photo_boards",
      },
      async (payload) => {
        if (payload.new?.share_code === state.shareCode || payload.old?.share_code === state.shareCode) {
          await loadCloudBoard();
          renderAll();
        }
        await loadBoardList();
        renderBoardList();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "photo_entries",
      },
      async (payload) => {
        if (payload.new?.board_id === state.boardId || payload.old?.board_id === state.boardId) {
          await loadCloudEntries();
          renderAll();
        }
        await loadBoardList();
        renderBoardList();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setSyncStatus("실시간 공유 저장소에 연결되었습니다.\n변경 사항은 자동으로 반영됩니다.");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setSyncStatus("실시간 수신이 불안정합니다. 저장은 계속 시도합니다.");
      }
    });
}

function syncInputsFromState() {
  state.projectName = normalizeProjectName(state.projectName);
  elements.projectNameInput.value = state.projectName || DEFAULT_PROJECT_NAME;
  elements.pourPartInput.value = state.pourPart || "";
  elements.pourDateInput.value = state.pourDate || "";
}

function pullMetaFromInputs() {
  state.projectName = normalizeProjectName(elements.projectNameInput.value.trim() || DEFAULT_PROJECT_NAME);
  state.pourPart = elements.pourPartInput.value.trim();
  state.pourDate = elements.pourDateInput.value || "";
}

function queueMetaSave() {
  window.clearTimeout(metaSaveTimer);
  metaSaveTimer = window.setTimeout(saveMeta, 300);
}

async function saveMeta() {
  pullMetaFromInputs();

  if (dbClient && state.boardId) {
    const { error } = await dbClient
      .from("photo_boards")
      .update({
        project_name: state.projectName,
        pour_part: state.pourPart,
        pour_date: state.pourDate || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", state.boardId);

    if (error) {
      console.error(error);
      showToast("사진대지 정보 저장에 실패했습니다.");
      return;
    }

    await loadBoardList();
    renderBoardList();
  } else {
    saveLocalBoard();
    await loadBoardList();
    renderBoardList();
  }
}

async function saveEntry(day) {
  const entry = getEntry(day);

  if (dbClient && state.boardId) {
    const { error } = await dbClient
      .from("photo_entries")
      .upsert(
        {
          board_id: state.boardId,
          day_no: day,
          photo_url: entry.photoUrl || null,
          photo_path: entry.photoPath || null,
          uploaded_at: entry.uploadedAt || null,
          memo: "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "board_id,day_no" }
      );

    if (error) {
      console.error(error);
      showToast(`${day}일차 저장에 실패했습니다.`);
      return;
    }

    await loadBoardList();
  } else {
    saveLocalBoard();
    await loadBoardList();
  }

  renderAll();
}

function saveLocalBoard() {
  try {
    localStorage.setItem(
      LOCAL_PREFIX + state.shareCode,
      JSON.stringify({
        projectName: state.projectName,
        pourPart: state.pourPart,
        pourDate: state.pourDate,
        updatedAt: new Date().toISOString(),
        entries: state.entries,
      })
    );
  } catch (error) {
    console.error(error);
    showToast("브라우저 저장공간이 부족합니다. 실시간 저장소 연결이 필요합니다.");
  }
}

async function handlePhotoUpload(day, file) {
  if (!file.type.startsWith("image/")) {
    showToast("이미지 파일만 등록할 수 있습니다.");
    return;
  }

  try {
    showToast(`${day}일차 사진을 압축하는 중입니다.`);
    const image = await resizeImage(file);
    const entry = getEntry(day);
    const oldPath = entry.photoPath;
    entry.photoUrl = image.dataUrl;
    entry.photoPath = "";
    entry.uploadedAt = new Date().toISOString();

    if (dbClient && state.boardId) {
      const path = `${state.shareCode}/day-${day}-${Date.now()}.jpg`;
      const { error: uploadError } = await dbClient.storage
        .from(config.bucket)
        .upload(path, image.blob, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data } = dbClient.storage.from(config.bucket).getPublicUrl(path);
      entry.photoUrl = data.publicUrl;
      entry.photoPath = path;

      if (oldPath && oldPath !== path) {
        dbClient.storage.from(config.bucket).remove([oldPath]).catch(console.error);
      }
    }

    await saveEntry(day);
    showToast(`${day}일차 사진을 등록했습니다. ${formatBytes(file.size)} → ${formatBytes(image.blob.size)}`);
  } catch (error) {
    console.error(error);
    showToast("사진 등록에 실패했습니다.");
  }
}

async function deletePhoto(day) {
  const entry = getEntry(day);
  if (!entry.photoUrl) return;
  const ok = window.confirm(`${day}일차 사진을 삭제할까요?`);
  if (!ok) return;

  const previousPath = entry.photoPath;
  entry.photoUrl = "";
  entry.photoPath = "";
  entry.uploadedAt = "";

  if (dbClient && previousPath) {
    dbClient.storage.from(config.bucket).remove([previousPath]).catch(console.error);
  }

  await saveEntry(day);
  showToast(`${day}일차 사진을 삭제했습니다.`);
}

function getEntry(day) {
  if (!state.entries[day]) {
    state.entries[day] = {
      dayNo: day,
      photoUrl: "",
      photoPath: "",
      uploadedAt: "",
    };
  }
  return state.entries[day];
}

function renderAll() {
  renderBoardList();
  renderSummary();
  renderDayGrid();
  renderPrintArea();
}

function renderBoardList() {
  if (!boardList.length) {
    elements.boardList.innerHTML = `
      <div class="empty-list">
        등록된 사진대지가 없습니다.
      </div>
    `;
    return;
  }

  elements.boardList.innerHTML = boardList
    .map((board) => {
      const active = board.shareCode === state.shareCode;
      return `
        <div class="board-list-item ${active ? "active" : ""}" data-board-code="${escapeAttribute(board.shareCode)}">
          <span class="board-date">${escapeHtml(formatListDate(board.pourDate))}</span>
          <span class="board-part">${escapeHtml(board.pourPart)}</span>
          <span class="board-count ${board.completedCount === DAY_COUNT ? "complete" : ""}">
            ${board.completedCount}/${DAY_COUNT}
          </span>
          <button class="board-delete-button" type="button" data-delete-board-code="${escapeAttribute(board.shareCode)}" title="사진대지 삭제">×</button>
        </div>
      `;
    })
    .join("");
}

function renderSummary() {
  elements.summaryList.innerHTML = days()
    .map((day) => {
      const entry = getEntry(day);
      const done = Boolean(entry.photoUrl);
      return `
        <button class="summary-item ${done ? "done" : ""}" type="button" data-summary-day="${day}">
          <strong>${day}일차</strong>
          <small>${formatCompactDayDate(day)}</small>
          <span class="summary-status">${done ? "등록" : "미등록"}</span>
        </button>
      `;
    })
    .join("");
}

function renderDayGrid() {
  elements.dayGrid.innerHTML = days()
    .map((day) => {
      const entry = getEntry(day);
      const hasPhoto = Boolean(entry.photoUrl);
      return `
        <article class="day-card ${hasPhoto ? "complete" : ""}" data-day-card="${day}">
          <div class="day-card-header">
            <h3>${day}일차</h3>
            <span class="date-pill">${formatDayDate(day)}</span>
          </div>
          <div class="photo-preview">
            ${
              hasPhoto
                ? `<img src="${escapeAttribute(entry.photoUrl)}" alt="${day}일차 습윤양생 사진">`
                : `<div class="empty-photo"><span>사진 미등록</span></div>`
            }
          </div>
          <div class="day-card-body">
            <div class="upload-row">
              <input id="camera-${day}" class="file-input" data-day="${day}" type="file" accept="image/*" capture="environment">
              <label class="small-button" for="camera-${day}">
                <span class="button-icon" aria-hidden="true">▣</span>
                <span>촬영</span>
              </label>
              <input id="gallery-${day}" class="file-input" data-day="${day}" type="file" accept="image/*">
              <label class="small-button" for="gallery-${day}">
                <span class="button-icon" aria-hidden="true">＋</span>
                <span>첨부</span>
              </label>
              ${
                hasPhoto
                  ? `<button class="small-button danger-button" type="button" data-delete-day="${day}">
                      <span class="button-icon" aria-hidden="true">×</span>
                      <span>삭제</span>
                    </button>`
                  : ""
              }
            </div>
            ${hasPhoto ? `<div class="uploaded-meta">${renderUploadedMeta(entry)}</div>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPrintArea() {
  const groupedDays = [[1, 2], [3, 4], [5, null]];
  elements.printArea.innerHTML = groupedDays
    .map((group) => {
      return `
        <div class="print-page">
          <h2 class="print-title">사 진 대 지</h2>
          <table class="print-sheet-table">
            <colgroup>
              <col class="print-col-label">
              <col class="print-col-main">
              <col class="print-col-day">
            </colgroup>
            <tbody>
              ${group.map(renderPrintBlock).join("")}
            </tbody>
          </table>
        </div>
      `;
    })
    .join("");
}

function renderPrintBlock(day) {
  if (!day) {
    return `
      <tr class="print-photo-row print-empty-row"><td colspan="3"></td></tr>
      <tr class="print-info-row print-empty-row"><td></td><td></td><td></td></tr>
      <tr class="print-content-row print-empty-row"><td></td><td colspan="2"></td></tr>
    `;
  }

  const entry = getEntry(day);
  const locationText = state.pourPart || "타설부위 미입력";
  const contentText = "습윤양생";

  return `
    <tr class="print-photo-row">
      <td colspan="3">
        <div class="print-photo-frame">
          ${
            entry.photoUrl
              ? `<img src="${escapeAttribute(entry.photoUrl)}" alt="${day}일차 습윤양생 사진">`
              : `<span class="print-placeholder">${day}일차 사진 미등록</span>`
          }
        </div>
      </td>
    </tr>
    <tr class="print-info-row">
      <td class="print-label">위&nbsp;&nbsp;치</td>
      <td class="print-main">${escapeHtml(locationText)}</td>
      <td class="print-day">${day}일차</td>
    </tr>
    <tr class="print-content-row">
      <td class="print-label">내&nbsp;&nbsp;용</td>
      <td colspan="2" class="print-main">${escapeHtml(contentText)}</td>
    </tr>
  `;
}

function renderUploadedMeta(entry) {
  if (!entry.photoUrl) return "";
  const time = entry.uploadedAt ? formatDateTime(entry.uploadedAt) : "";
  return time ? `등록 ${escapeHtml(time)} · 자동 압축` : "자동 압축";
}

async function copyShareLink() {
  const link = window.location.href;
  try {
    await navigator.clipboard.writeText(link);
    showToast("공유 링크를 복사했습니다.");
  } catch {
    window.prompt("공유 링크를 복사하세요.", link);
  }
}

function createNewBoard() {
  const url = new URL(window.location.href);
  url.searchParams.set("board", createShareCode());
  window.location.href = url.toString();
}

function openBoard(shareCode) {
  if (!shareCode || shareCode === state.shareCode) return;
  const url = new URL(window.location.href);
  url.searchParams.set("board", shareCode);
  window.location.href = url.toString();
}

async function deleteBoard(shareCode) {
  if (!shareCode) return;
  const ok = window.confirm("이 사진대지를 목록에서 삭제할까요?");
  if (!ok) return;

  const target = boardList.find((board) => board.shareCode === shareCode);
  boardList = boardList.filter((board) => board.shareCode !== shareCode);
  renderBoardList();

  if (dbClient) {
    const { data: board, error } = await dbClient
      .from("photo_boards")
      .select("id, photo_entries(photo_path)")
      .eq("share_code", shareCode)
      .maybeSingle();

    if (error) {
      console.error(error);
      showToast("사진대지 삭제에 실패했습니다.");
      return;
    }

    if (board?.id) {
      const { error: boardError } = await dbClient.from("photo_boards").delete().eq("id", board.id);
      if (boardError) {
        console.error(boardError);
        const hidden = await hideBoardFromList(shareCode);
        if (!hidden) {
          showToast("사진대지 삭제에 실패했습니다.");
          await loadBoardList();
          renderBoardList();
          return;
        }
      } else {
        const { data: remains, error: remainsError } = await dbClient
          .from("photo_boards")
          .select("id")
          .eq("share_code", shareCode)
          .maybeSingle();

        if (remainsError) {
          console.error(remainsError);
        }

        if (remains?.id) {
          const hidden = await hideBoardFromList(shareCode);
          if (!hidden) {
            showToast("사진대지를 목록에서 숨기지 못했습니다.");
            await loadBoardList();
            renderBoardList();
            return;
          }
        }
      }

      const paths = (board.photo_entries || []).map((entry) => entry.photo_path).filter(Boolean);
      if (paths.length) {
        dbClient.storage.from(config.bucket).remove(paths).catch(console.error);
      }
    }
  } else {
    localStorage.removeItem(LOCAL_PREFIX + shareCode);
  }

  showToast(`${target?.pourPart || "사진대지"}를 삭제했습니다.`);

  if (shareCode === state.shareCode) {
    createNewBoard();
    return;
  }

  await loadBoardList();
  renderBoardList();
}

async function hideBoardFromList(shareCode) {
  const { error } = await dbClient
    .from("photo_boards")
    .update({
      pour_date: null,
      updated_at: new Date().toISOString(),
    })
    .eq("share_code", shareCode);

  if (error) {
    console.error(error);
    return false;
  }

  return true;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

function setSyncStatus(message) {
  if (elements.syncStatus) {
    elements.syncStatus.textContent = message;
  }
}

function resizeImage(file, maxWidth = IMAGE_MAX_WIDTH, maxHeight = IMAGE_MAX_HEIGHT) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width, maxHeight / img.height);
      const width = Math.max(1, Math.round(img.width * ratio));
      const height = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Image conversion failed"));
            return;
          }

          resolve({
            blob,
            dataUrl: canvas.toDataURL("image/jpeg", IMAGE_QUALITY),
          });
        },
        "image/jpeg",
        IMAGE_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };

    img.src = url;
  });
}

function days() {
  return Array.from({ length: DAY_COUNT }, (_, index) => index + 1);
}

function formatDayDate(day) {
  if (!state.pourDate) return "타설일 미입력";
  return formatMonthDay(addDays(state.pourDate, day - 1));
}

function formatCompactDayDate(day) {
  if (!state.pourDate) return "-";
  const date = addDays(state.pourDate, day - 1);
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(dateValue, offset) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return date;
}

function formatMonthDay(date) {
  return date.toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function formatListDate(value) {
  if (!value) return "날짜 없음";
  return new Date(`${value}T00:00:00`).toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function ensureSupabaseClient() {
  if (window.supabase) return Promise.resolve();
  return loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function normalizeProjectName(value) {
  return String(value || DEFAULT_PROJECT_NAME).replaceAll("(주)서화", "(주)한화");
}
