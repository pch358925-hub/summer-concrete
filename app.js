const DEFAULT_PROJECT_NAME = "세종천안 2공구 (주)한화";
const DAY_COUNT = 5;
const LOCAL_PREFIX = "curing-photo-board:";
const META_DRAFT_PREFIX = `${LOCAL_PREFIX}meta-draft:`;
const STORAGE_DISPLAY_LIMIT_BYTES = 1024 * 1024 * 1024;
const ESTIMATED_PHOTO_BYTES = 600 * 1024;
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_HEIGHT = 1067;
const IMAGE_QUALITY = 0.78;

const elements = {
  searchButton: document.getElementById("searchButton"),
  printButton: document.getElementById("printButton"),
  newBoardButton: document.getElementById("newBoardButton"),
  boardSearchBar: document.getElementById("boardSearchBar"),
  boardSearchInput: document.getElementById("boardSearchInput"),
  clearSearchButton: document.getElementById("clearSearchButton"),
  storageMeterText: document.getElementById("storageMeterText"),
  storageMeterBar: document.getElementById("storageMeterBar"),
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
let boardSearchQuery = "";
let boardListRenderFrame = 0;
let isBoardSearchComposing = false;
let isFilePickerOpen = false;
let filePickerClearTimer = null;

let state = {
  shareCode: "",
  boardId: null,
  projectName: DEFAULT_PROJECT_NAME,
  pourPart: "",
  pourDate: "",
  createdAt: "",
  entries: {},
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.shareCode = ensureShareCode();
  bindEvents();
  setSyncStatus("저장소를 확인하는 중입니다.");

  if (canUseCloud()) {
    await setupCloudMode();
  } else {
    if (state.shareCode) {
      loadLocalBoard();
    } else {
      resetCurrentBoard();
    }
    await loadBoardList();
    setSyncStatus("현재 브라우저에만 저장됩니다. 실시간 공유는 config.js 설정 후 사용할 수 있습니다.");
  }

  renderAll();
}

function bindEvents() {
  elements.searchButton.addEventListener("click", toggleBoardSearch);
  elements.boardSearchInput.addEventListener("compositionstart", () => {
    isBoardSearchComposing = true;
  });
  elements.boardSearchInput.addEventListener("compositionend", () => {
    isBoardSearchComposing = false;
    boardSearchQuery = elements.boardSearchInput.value;
    scheduleBoardListRender();
  });
  elements.boardSearchInput.addEventListener("input", () => {
    if (isBoardSearchComposing) return;
    boardSearchQuery = elements.boardSearchInput.value;
    scheduleBoardListRender();
  });
  elements.boardSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearBoardSearch();
    }
  });
  elements.clearSearchButton.addEventListener("click", clearBoardSearch);
  elements.printButton.addEventListener("click", handlePrint);
  elements.newBoardButton.addEventListener("click", createNewBoard);
  elements.prevPourDateButton.addEventListener("click", () => shiftPourDate(-1));
  elements.nextPourDateButton.addEventListener("click", () => shiftPourDate(1));
  window.addEventListener("popstate", () => {
    syncUrlToCurrentBoard();
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
      saveMetaDraft();
      queueMetaSave();
      renderMetaPreview();
    });
    input.addEventListener("change", flushMetaSave);
    input.addEventListener("blur", flushMetaSave);
  });

  window.addEventListener("pagehide", () => {
    if (isFilePickerOpen) return;
    flushMetaSave();
  });
  document.addEventListener("visibilitychange", () => {
    if (isFilePickerOpen) return;
    if (document.visibilityState === "hidden") {
      flushMetaSave();
    }
  });
  window.addEventListener("focus", endFilePickSoon);

  elements.dayGrid.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".file-control")) {
      beginFilePick();
    }
  });

  elements.dayGrid.addEventListener("click", (event) => {
    if (event.target.closest(".file-control")) {
      beginFilePick();
    }
  });

  elements.dayGrid.addEventListener("change", async (event) => {
    const target = event.target;
    if (!target.matches("input[type='file']")) return;

    const day = Number(target.dataset.day);
    const files = Array.from(target.files || []);
    target.value = "";
    window.clearTimeout(filePickerClearTimer);
    isFilePickerOpen = false;
    if (!day || !files.length) return;

    await handlePhotoSelection(day, files);
  });

  elements.dayGrid.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-day]");
    if (!deleteButton) return;

    const day = Number(deleteButton.dataset.deleteDay);
    await deletePhoto(day);
  });
}

function canUseCloud() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.bucket);
}

async function setupCloudMode() {
  try {
    await ensureSupabaseClient();
    dbClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    if (state.shareCode) {
      const usedDraft = await loadCloudBoard();
      if (usedDraft) {
        await saveMeta();
      }
      await subscribeToChanges();
    } else {
      resetCurrentBoard();
    }
    await loadBoardList();
    setSyncStatus("실시간 공유 저장소에 연결되었습니다.");
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
  return url.searchParams.get("board") || "";
}

function syncUrlToCurrentBoard() {
  const url = new URL(window.location.href);
  if (state.shareCode) {
    url.searchParams.set("board", state.shareCode);
  } else {
    url.searchParams.delete("board");
  }
  window.history.replaceState({}, "", url.toString());
}

function createShareCode() {
  return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resetCurrentBoard(options = {}) {
  const shareCode = options.keepShareCode ? state.shareCode : "";
  state = {
    shareCode,
    boardId: null,
    projectName: DEFAULT_PROJECT_NAME,
    pourPart: "",
    pourDate: toDateInputValue(new Date()),
    createdAt: "",
    entries: {},
  };
  syncInputsFromState();
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

  applyMetaDraft("");
  syncInputsFromState();
  saveLocalBoard();
}

async function loadCloudBoard(options = {}) {
  const shouldSyncInputs = options.syncInputs !== false;
  const createIfMissing = options.createIfMissing === true;
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
    state.createdAt = board.created_at || "";
  } else if (createIfMissing) {
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
    state.createdAt = created.created_at || "";
  } else {
    resetCurrentBoard({ keepShareCode: true });
  }

  const usedDraft = shouldSyncInputs && (board || createIfMissing) ? applyMetaDraft(board?.updated_at || "") : false;
  if (!board && !createIfMissing) {
    clearMetaDraft();
  }
  await loadCloudEntries();
  if (shouldSyncInputs) {
    syncInputsFromState();
  }

  return usedDraft;
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
    .select("id, share_code, project_name, pour_part, pour_date, created_at, updated_at, photo_entries(day_no, photo_url)")
    .not("pour_date", "is", null)
    .order("pour_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (range.start) query = query.gte("pour_date", range.start);
  if (range.end) query = query.lte("pour_date", range.end);

  const { data, error } = await query;
  if (error) throw error;

  boardList = (data || []).map((board) => {
    const pourPart = board.pour_part || "미입력";
    return {
      shareCode: board.share_code,
      projectName: normalizeProjectName(board.project_name || DEFAULT_PROJECT_NAME),
      pourPart,
      searchText: normalizeSearchText(pourPart),
      pourDate: board.pour_date || "",
      createdAt: board.created_at || "",
      updatedAt: board.updated_at || "",
      completedCount: (board.photo_entries || []).filter((entry) => entry.photo_url).length,
    };
  });
}

function loadLocalBoardList() {
  const range = getListRange();
  boardList = Object.keys(localStorage)
    .filter((key) => key.startsWith(LOCAL_PREFIX) && !key.startsWith(META_DRAFT_PREFIX))
    .map((key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        const entries = parsed.entries || {};
        const pourPart = parsed.pourPart || "미입력";
        return {
          shareCode: key.slice(LOCAL_PREFIX.length),
          projectName: normalizeProjectName(parsed.projectName || DEFAULT_PROJECT_NAME),
          pourPart,
          searchText: normalizeSearchText(pourPart),
          pourDate: parsed.pourDate || "",
          createdAt: parsed.createdAt || parsed.updatedAt || "",
          updatedAt: parsed.updatedAt || "",
          completedCount: Object.values(entries).filter((entry) => entry && entry.photoUrl).length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((board) => {
      if (!board.pourDate) return false;
      if (range.start && board.pourDate < range.start) return false;
      if (range.end && board.pourDate > range.end) return false;
      return true;
    })
    .sort((a, b) => {
      const dateCompare = (b.pourDate || "").localeCompare(a.pourDate || "");
      if (dateCompare) return dateCompare;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
}

function getListRange() {
  return { start: "", end: "" };
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
          const inputFocused = isMetaInputFocused();
          await loadCloudBoard({ syncInputs: !inputFocused });
          if (inputFocused) {
            renderMetaPreview();
          } else {
            renderAll();
          }
        }
        await loadBoardList();
        renderBoardList();
        renderStorageMeter();
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
        renderStorageMeter();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setSyncStatus("실시간 공유 저장소에 연결되었습니다.");
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
  state.projectName = normalizeProjectName(elements.projectNameInput.value || DEFAULT_PROJECT_NAME);
  state.pourPart = elements.pourPartInput.value;
  state.pourDate = elements.pourDateInput.value || "";
}

function queueMetaSave() {
  window.clearTimeout(metaSaveTimer);
  metaSaveTimer = window.setTimeout(saveMeta, 300);
}

function flushMetaSave() {
  pullMetaFromInputs();
  saveMetaDraft();
  window.clearTimeout(metaSaveTimer);
  metaSaveTimer = null;
  saveMeta().catch(console.error);
}

async function saveMeta() {
  pullMetaFromInputs();
  if (!state.shareCode) return;
  if (dbClient && !state.boardId) return;

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

    clearMetaDraft();
    await loadBoardList();
    renderBoardList();
    renderStorageMeter();
  } else {
    saveLocalBoard();
    clearMetaDraft();
    await loadBoardList();
    renderBoardList();
    renderStorageMeter();
  }
}

function saveMetaDraft() {
  try {
    localStorage.setItem(
      META_DRAFT_PREFIX + state.shareCode,
      JSON.stringify({
        projectName: state.projectName,
        pourPart: state.pourPart,
        pourDate: state.pourDate,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn("Meta draft save failed", error);
  }
}

function applyMetaDraft(remoteUpdatedAt) {
  try {
    const saved = localStorage.getItem(META_DRAFT_PREFIX + state.shareCode);
    if (!saved) return false;

    const draft = JSON.parse(saved);
    const draftTime = Date.parse(draft.updatedAt || "");
    const remoteTime = Date.parse(remoteUpdatedAt || "");
    if (remoteUpdatedAt && (!draftTime || draftTime <= remoteTime)) {
      clearMetaDraft();
      return false;
    }

    state.projectName = normalizeProjectName(draft.projectName || DEFAULT_PROJECT_NAME);
    state.pourPart = typeof draft.pourPart === "string" ? draft.pourPart : "";
    state.pourDate = draft.pourDate || state.pourDate || toDateInputValue(new Date());
    return true;
  } catch (error) {
    console.warn("Meta draft apply failed", error);
    clearMetaDraft();
    return false;
  }
}

function clearMetaDraft() {
  try {
    localStorage.removeItem(META_DRAFT_PREFIX + state.shareCode);
  } catch {
    // Ignore storage cleanup errors.
  }
}

async function saveEntry(day) {
  if (!state.shareCode || (dbClient && !state.boardId)) {
    showToast("새 대지를 먼저 만들어 주세요.");
    return false;
  }

  const saved = await persistEntry(day);
  if (!saved) return false;

  await loadBoardList();
  renderAll();
  return true;
}

async function persistEntry(day) {
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
      return false;
    }
  } else {
    return saveLocalBoard();
  }

  return true;
}

function saveLocalBoard() {
  if (!state.shareCode) return false;

  try {
    localStorage.setItem(
      LOCAL_PREFIX + state.shareCode,
      JSON.stringify({
        projectName: state.projectName,
        pourPart: state.pourPart,
        pourDate: state.pourDate,
        createdAt: state.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: state.entries,
      })
    );
    renderStorageMeter();
    return true;
  } catch (error) {
    console.error(error);
    showToast("브라우저 저장공간이 부족합니다. 실시간 저장소 연결이 필요합니다.");
    return false;
  }
}

async function handlePhotoUpload(day, file) {
  if (!state.shareCode || (dbClient && !state.boardId)) {
    showToast("새 대지를 먼저 만들어 주세요.");
    return false;
  }

  if (!isImageFile(file)) {
    showToast("이미지 파일만 등록할 수 있습니다.");
    return false;
  }

  try {
    showToast(`${day}일차 사진을 압축하는 중입니다.`);
    const image = await preparePhotoEntry(day, file);
    const saved = await saveEntry(day);
    if (!saved) return false;
    cleanupOldPhotoPath(image.oldPath, image.newPath);
    showToast(`${day}일차 사진을 등록했습니다. ${formatBytes(file.size)} → ${formatBytes(image.blob.size)}`);
    return true;
  } catch (error) {
    console.error(error);
    showToast("사진 등록에 실패했습니다. 다른 사진이나 JPG 사진으로 다시 시도해 주세요.");
    return false;
  }
}

async function handlePhotoSelection(startDay, files) {
  if (files.length <= 1) {
    await handlePhotoUpload(startDay, files[0]);
    return;
  }

  if (!state.shareCode || (dbClient && !state.boardId)) {
    showToast("새 대지를 먼저 만들어 주세요.");
    return;
  }

  const imageFiles = files.filter(isImageFile);
  if (!imageFiles.length) {
    showToast("이미지 파일만 등록할 수 있습니다.");
    return;
  }

  const targetDays = days().filter((day) => day >= startDay).slice(0, imageFiles.length);
  if (!targetDays.length) return;

  const overwriteCount = targetDays.filter((day) => getEntry(day).photoUrl).length;
  if (overwriteCount) {
    const ok = window.confirm(`기존 사진 ${overwriteCount}장을 새 사진으로 바꿀까요?`);
    if (!ok) return;
  }

  let completed = 0;
  try {
    showToast(`${targetDays[0]}일차부터 사진 ${targetDays.length}장을 등록하는 중입니다.`);
    for (const day of targetDays) {
      const image = await preparePhotoEntry(day, imageFiles[completed]);
      const saved = await persistEntry(day);
      if (!saved) throw new Error(`${day}일차 저장 실패`);
      cleanupOldPhotoPath(image.oldPath, image.newPath);
      completed += 1;
    }

    await loadBoardList();
    renderAll();

    const overflowCount = imageFiles.length - targetDays.length;
    const invalidCount = files.length - imageFiles.length;
    const overflowText = overflowCount > 0 ? ` ${overflowCount}장은 5일차를 넘어 제외했습니다.` : "";
    const invalidText = invalidCount > 0 ? ` 이미지가 아닌 파일 ${invalidCount}개는 제외했습니다.` : "";
    showToast(`${targetDays[0]}일차부터 ${completed}장 등록했습니다.${overflowText}${invalidText}`);
  } catch (error) {
    console.error(error);
    await loadBoardList();
    renderAll();
    showToast(`${completed}장 등록 후 중단됐습니다. 실패한 사진은 다시 시도해 주세요.`);
  }
}

async function preparePhotoEntry(day, file) {
  const uploadFile = await prepareImageFile(file);
  const image = await resizeImage(uploadFile);
  const entry = getEntry(day);
  const oldPath = entry.photoPath;
  let newPath = "";
  entry.photoUrl = image.dataUrl;
  entry.photoPath = "";
  entry.uploadedAt = new Date().toISOString();
  entry.sizeBytes = image.blob.size;

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
    newPath = path;
  }

  return {
    ...image,
    oldPath,
    newPath,
  };
}

function cleanupOldPhotoPath(oldPath, newPath) {
  if (dbClient && oldPath && oldPath !== newPath) {
    dbClient.storage.from(config.bucket).remove([oldPath]).catch(console.error);
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
  entry.sizeBytes = 0;

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
  if (!isFilePickerOpen) {
    renderDayGrid();
  }
  renderPrintArea();
  renderStorageMeter();
}

function renderMetaPreview() {
  renderSummary();
  if (!isFilePickerOpen) {
    renderDayGrid();
  }
  renderPrintArea();
}

function beginFilePick() {
  window.clearTimeout(filePickerClearTimer);
  isFilePickerOpen = true;
  filePickerClearTimer = window.setTimeout(() => {
    isFilePickerOpen = false;
  }, 120000);
}

function endFilePickSoon() {
  window.clearTimeout(filePickerClearTimer);
  filePickerClearTimer = window.setTimeout(() => {
    isFilePickerOpen = false;
  }, 800);
}

function renderBoardList() {
  cancelScheduledBoardListRender();

  const visibleBoards = getVisibleBoardList();
  if (!visibleBoards.length) {
    const isSearching = Boolean(normalizeSearchText(boardSearchQuery));
    elements.boardList.innerHTML = `
      <div class="empty-list">
        ${isSearching ? "검색 결과가 없습니다." : "등록된 사진대지가 없습니다."}
      </div>
    `;
    return;
  }

  elements.boardList.innerHTML = visibleBoards
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

function getVisibleBoardList() {
  const query = normalizeSearchText(boardSearchQuery);
  if (!query) return boardList;

  return boardList.filter((board) => (board.searchText || normalizeSearchText(board.pourPart)).includes(query));
}

function scheduleBoardListRender() {
  cancelScheduledBoardListRender();
  const schedule = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 16);
  boardListRenderFrame = schedule(() => {
    boardListRenderFrame = 0;
    renderBoardList();
  });
}

function cancelScheduledBoardListRender() {
  if (!boardListRenderFrame) return;
  if (window.cancelAnimationFrame) {
    window.cancelAnimationFrame(boardListRenderFrame);
  } else {
    window.clearTimeout(boardListRenderFrame);
  }
  boardListRenderFrame = 0;
}

function toggleBoardSearch() {
  const willOpen = elements.boardSearchBar.hidden;
  elements.boardSearchBar.hidden = !willOpen;
  elements.searchButton.setAttribute("aria-expanded", String(willOpen));

  if (willOpen) {
    elements.boardSearchInput.focus();
    elements.boardSearchInput.select();
    return;
  }

  if (boardSearchQuery) {
    boardSearchQuery = "";
    elements.boardSearchInput.value = "";
    renderBoardList();
  }
  elements.boardSearchInput.blur();
}

function clearBoardSearch() {
  boardSearchQuery = "";
  elements.boardSearchInput.value = "";
  renderBoardList();
  elements.boardSearchInput.focus();
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
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

async function renderStorageMeter() {
  if (!elements.storageMeterText || !elements.storageMeterBar) return;

  const usage = getKnownPhotoBytes();
  const quota = getStorageDisplayLimitBytes();
  const percent = quota ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
  elements.storageMeterText.textContent = `${formatBytes(usage)} / ${formatBytes(quota)}`;
  elements.storageMeterBar.style.width = `${percent}%`;
  elements.storageMeterBar.classList.toggle("warn", percent >= 80);
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
              <div class="file-control">
                <label class="file-control-title" for="camera-${day}">▣ 촬영</label>
                <input id="camera-${day}" class="file-input" data-day="${day}" type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif" capture="environment" aria-label="${day}일차 사진 촬영">
              </div>
              <div class="file-control">
                <label class="file-control-title" for="gallery-${day}">＋ 첨부</label>
                <input id="gallery-${day}" class="file-input" data-day="${day}" type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple aria-label="${day}일차 사진 첨부">
              </div>
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
  const locationText = state.pourPart || "";
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

function handlePrint() {
  if (isKakaoInAppBrowser()) {
    showToast("카톡 안에서는 인쇄가 막힐 수 있습니다. 브라우저로 열어서 인쇄해 주세요.");
    return;
  }

  window.print();
}

async function createNewBoard() {
  window.clearTimeout(metaSaveTimer);

  const url = new URL(window.location.href);
  const shareCode = createShareCode();
  url.searchParams.set("board", shareCode);
  window.history.replaceState({}, "", url.toString());

  state = {
    shareCode,
    boardId: null,
    projectName: DEFAULT_PROJECT_NAME,
    pourPart: "",
    pourDate: toDateInputValue(new Date()),
    entries: {},
  };

  if (dbClient) {
    await loadCloudBoard({ createIfMissing: true });
    await subscribeToChanges();
  } else {
    syncInputsFromState();
    saveLocalBoard();
  }

  await loadBoardList();
  renderAll();
  showToast("새 사진대지를 만들었습니다.");
}

async function openBoard(shareCode) {
  if (!shareCode || shareCode === state.shareCode) return;
  const url = new URL(window.location.href);
  url.searchParams.set("board", shareCode);
  window.history.replaceState({}, "", url.toString());
  state.shareCode = shareCode;

  if (dbClient) {
    await loadCloudBoard();
    await subscribeToChanges();
  } else {
    loadLocalBoard();
  }

  await loadBoardList();
  renderAll();
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
      await loadBoardList();
      renderBoardList();
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
    localStorage.removeItem(META_DRAFT_PREFIX + shareCode);
  }

  try {
    localStorage.removeItem(META_DRAFT_PREFIX + shareCode);
  } catch {
    // Ignore storage cleanup errors.
  }

  showToast(`${target?.pourPart || "사진대지"}를 삭제했습니다.`);

  await loadBoardList();

  if (shareCode === state.shareCode) {
    await openNextBoardAfterDelete();
    return;
  }

  renderBoardList();
  renderStorageMeter();
}

async function openNextBoardAfterDelete() {
  const nextBoard = boardList.find((board) => board.shareCode !== state.shareCode);
  if (nextBoard) {
    await openBoard(nextBoard.shareCode);
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("board");
  window.history.replaceState({}, "", url.toString());

  resetCurrentBoard();
  renderAll();
  showToast("삭제했습니다. 새 대지를 누르면 새 사진대지가 만들어집니다.");
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

function isMetaInputFocused() {
  return [elements.projectNameInput, elements.pourPartInput, elements.pourDateInput].includes(document.activeElement);
}

function getKnownPhotoBytes() {
  const listPhotoCount = boardList.reduce((sum, board) => sum + Number(board.completedCount || 0), 0);
  const currentPhotoCount = Object.values(state.entries || {}).filter((entry) => entry?.photoUrl).length;
  return Math.max(listPhotoCount, currentPhotoCount) * ESTIMATED_PHOTO_BYTES;
}

async function prepareImageFile(file) {
  if (!isHeicFile(file)) return file;

  showToast("휴대폰 사진 형식을 변환하는 중입니다.");
  await ensureHeicConverter();
  const converted = await window.heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: IMAGE_QUALITY,
  });

  return Array.isArray(converted) ? converted[0] : converted;
}

async function ensureHeicConverter() {
  if (window.heic2any) return;
  await loadScript("https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js");
  if (!window.heic2any) {
    throw new Error("HEIC converter unavailable");
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

function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "");
}

function isHeicFile(file) {
  return /hei(c|f)/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || "");
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
  const date = new Date(`${value}T00:00:00`);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekday = date.toLocaleDateString("ko-KR", { weekday: "short" });
  return `${month}.${day}.(${weekday})`;
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
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  return `${Math.round(bytes / 1024 / 1024 / 1024)}GB`;
}

function getStorageDisplayLimitBytes() {
  const configuredMb = Number(config.storageLimitMb);
  if (configuredMb > 0) {
    return configuredMb * 1024 * 1024;
  }

  return STORAGE_DISPLAY_LIMIT_BYTES;
}

function ensureSupabaseClient() {
  if (window.supabase) return Promise.resolve();
  return loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
}

function isKakaoInAppBrowser() {
  return /KAKAOTALK/i.test(navigator.userAgent);
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
