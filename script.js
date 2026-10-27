var boxHistory = {};
var globalHistory = [];
var disabledKennels = {};
var stateHistory = {};

async function loadDisabledKennelsFromServer() {
  try {
    var rows = await fetchJson("/api/kennel-state");
    disabledKennels = {};

    rows.forEach(function (row) {
      if (row && row.kennel_id) {
        disabledKennels[row.kennel_id] = !!row.disabled;
      }
    });

    saveDisabledKennels();
  } catch (error) {
    console.error("Failed to load disabled kennel state from server:", error);
  }
}

async function saveDisabledKennelsToServer(
  boxId,
  nextDisabledState,
  name,
  comment,
) {
  try {
    await fetchJson("/api/kennel-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kennel_id: boxId,
        disabled: nextDisabledState,
        name: name,
        comment: comment,
      }),
    });
  } catch (error) {
    console.error("Failed to save kennel state to server:", error);
  }
}

function saveDisabledKennels() {
  localStorage.setItem(
    "shelter-disabled-kennels",
    JSON.stringify(disabledKennels),
  );
}

function loadDisabledKennels() {
  try {
    var saved = JSON.parse(
      localStorage.getItem("shelter-disabled-kennels") || "{}",
    );
    disabledKennels = saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    disabledKennels = {};
  }
}

function loadStateHistory() {
  try {
    var saved = JSON.parse(
      localStorage.getItem("shelter-kennel-state-history") || "{}",
    );
    if (saved && typeof saved === "object") {
      Object.keys(saved).forEach(function (boxId) {
        if (!Array.isArray(boxHistory[boxId])) {
          boxHistory[boxId] = [];
        }
        var entries = Array.isArray(saved[boxId]) ? saved[boxId] : [];
        boxHistory[boxId] = boxHistory[boxId].concat(entries);
      });
    }
  } catch (error) {
    console.error("Failed to load state history:", error);
  }
}

function saveStateHistory() {
  var stateOnly = {};
  Object.keys(boxHistory).forEach(function (boxId) {
    var entries = (boxHistory[boxId] || []).filter(function (entry) {
      return entry && entry.kind === "state_change";
    });
    if (entries.length > 0) {
      stateOnly[boxId] = entries;
    }
  });
  localStorage.setItem(
    "shelter-kennel-state-history",
    JSON.stringify(stateOnly),
  );
}

function ensureToggleButtons() {
  document.querySelectorAll(".box-wrapper").forEach(function (wrapper) {
    var box = wrapper.querySelector(".box");
    if (!box) {
      return;
    }

    if (wrapper.querySelector(".toggle-disable")) {
      return;
    }

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "toggle-disable";
    toggleBtn.id = box.id + "toggle";
    toggleBtn.textContent = "on/off";
    wrapper.appendChild(toggleBtn);
  });
}

async function fetchJson(url, options) {
  var response = await fetch(url, options || {});
  var payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function addGlobalHistory(action, boxId, details) {
  var entry = {
    action: action,
    boxId: boxId,
    details: details,
    timestamp: new Date().toLocaleString(),
  };

  globalHistory.push(entry);

  fetchJson("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: entry.action,
      boxId: entry.boxId,
      details: entry.details,
      timestamp: new Date().toISOString(),
    }),
  }).catch(function (err) {
    console.error("Failed to save activity log:", err);
  });
}

function getDisplayTimestamp(value) {
  if (!value) {
    return "";
  }

  var date = new Date(value);
  if (isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getStatusFromTimestamp(timestampValue) {
  if (!timestampValue) {
    return "default";
  }

  var date = new Date(timestampValue);
  if (isNaN(date.getTime())) {
    return "default";
  }

  var ageInDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

  if (ageInDays < 7) {
    return "green";
  }
  if (ageInDays < 30) {
    return "yellow";
  }

  return "red";
}

function getBoxDisplayName(boxOrId) {
  var box =
    typeof boxOrId === "string" ? document.getElementById(boxOrId) : boxOrId;
  if (box && box.dataset && box.dataset.name) {
    return box.dataset.name;
  }

  var boxId =
    typeof boxOrId === "string" ? boxOrId : box && box.id ? box.id : "Unknown";
  return boxId;
}

function getBoxReferenceText(boxOrId) {
  return (
    getBoxDisplayName(boxOrId) +
    " (" +
    (typeof boxOrId === "string"
      ? boxOrId
      : boxOrId && boxOrId.id
        ? boxOrId.id
        : "unknown") +
    ")"
  );
}

function renderBox(box) {
  var history = boxHistory[box.id] || [];
  var walkHistory = history.filter(function (entry) {
    return entry.kind !== "state_change";
  });
  var latestEntry = walkHistory[walkHistory.length - 1];
  var displayName = getBoxDisplayName(box);

  box.classList.remove(
    "green",
    "yellow",
    "red",
    "default",
    "disabled",
    "clicked",
  );

  if (disabledKennels[box.id]) {
    box.textContent = displayName;
    box.classList.add("disabled");
    return;
  }

  if (!latestEntry) {
    box.textContent = displayName;
    box.classList.add("default");
    return;
  }

  box.textContent = displayName;
  box.classList.add(getStatusFromTimestamp(latestEntry.timestamp));
  box.classList.add("clicked");
}

function toggleDisableKennel(boxId) {
  var isDisabled = !!disabledKennels[boxId];
  var nextDisabledState = !isDisabled;
  var action = nextDisabledState ? "disable_kennel" : "enable_kennel";
  var boxLabel = getBoxDisplayName(boxId);

  var shouldProceed = confirm(
    (nextDisabledState ? "Do you want to disable" : "Do you want to enable") +
      " kennel " +
      boxLabel +
      "?",
  );

  if (!shouldProceed) {
    return;
  }

  var name = prompt("Enter your name for " + boxLabel + ":");
  if (name === null || name.trim() === "") {
    name = "Unknown";
  }

  var comment = prompt("Enter your comment for " + boxLabel + ":");
  if (comment === null || comment.trim() === "") {
    comment = "No comment";
  }

  disabledKennels[boxId] = nextDisabledState;
  saveDisabledKennels();
  saveDisabledKennelsToServer(boxId, nextDisabledState, name, comment);

  var box = document.getElementById(boxId);
  if (box) {
    renderBox(box);
  }

  addGlobalHistory(action, boxId, {
    name: name,
    comment: comment,
    disabled: nextDisabledState,
    displayName: boxLabel,
  });

  var history = boxHistory[boxId] || [];
  history.push({
    timestamp: new Date().toISOString(),
    name: name,
    comment:
      comment +
      " [kennel " +
      (nextDisabledState ? "disabled" : "enabled") +
      "]",
    disabled: nextDisabledState,
    kind: "state_change",
    action: action,
    displayName: boxLabel,
  });
  boxHistory[boxId] = history;

  alert(
    "Kennel " +
      boxLabel +
      " has been " +
      (nextDisabledState ? "disabled" : "enabled") +
      ".",
  );
}

async function refreshGlobalKennelStates() {
  try {
    await loadDisabledKennelsFromServer();
    document.querySelectorAll(".box").forEach(function (box) {
      renderBox(box);
    });
  } catch (error) {
    console.error("Failed to refresh global kennel state:", error);
  }
}

function getKennelLogEntries(boxId) {
  var localEntries = Array.isArray(boxHistory[boxId])
    ? boxHistory[boxId].slice()
    : [];
  var boxLabel = getBoxDisplayName(boxId);

  var globalEntries = (Array.isArray(globalHistory) ? globalHistory : [])
    .filter(function (entry) {
      var details = entry.details || {};
      return (
        String(entry.boxId) === String(boxId) &&
        (entry.action === "register_walk" ||
          entry.action === "disable_kennel" ||
          entry.action === "enable_kennel" ||
          (entry.action === "delete_last_log" &&
            details.deletedEntry &&
            typeof details.deletedEntry === "object"))
      );
    })
    .map(function (entry) {
      var details = entry.details || {};
      if (entry.action === "register_walk") {
        return {
          timestamp: details.timestamp || entry.timestamp,
          name: details.name || "Unknown",
          comment: details.comment || "No comment",
          kind: "registered_walk",
          action: entry.action,
        };
      }

      if (entry.action === "delete_last_log") {
        var deletedEntry = details.deletedEntry;
        return {
          timestamp: entry.timestamp,
          name: deletedEntry.name || "Unknown",
          comment: deletedEntry.comment || "No comment",
          kind: "deleted_walk",
          action: entry.action,
          walkTimestamp: deletedEntry.timestamp,
          deletedBy: details.name,
        };
      }

      return {
        timestamp: entry.timestamp,
        name: details.name || "Unknown",
        comment:
          (details.comment || "No comment") +
          " [kennel " +
          (entry.action === "disable_kennel" ? "disabled" : "enabled") +
          "]",
        kind: "state_change",
        action: entry.action,
        displayName: details.displayName || boxLabel,
      };
    });

  var registeredWalkKeys = globalEntries
    .filter(function (entry) {
      return entry.kind === "registered_walk";
    })
    .map(function (entry) {
      var timestamp = new Date(entry.timestamp).getTime();
      return [
        isNaN(timestamp) ? entry.timestamp : timestamp,
        entry.name,
        entry.comment,
      ].join("|");
    });

  localEntries = localEntries.filter(function (entry) {
    var timestamp = new Date(entry.timestamp).getTime();
    var key = [
      isNaN(timestamp) ? entry.timestamp : timestamp,
      entry.name || "Unknown",
      entry.comment || "No comment",
    ].join("|");
    return registeredWalkKeys.indexOf(key) === -1;
  });

  var savedEntries = [];
  try {
    var saved = JSON.parse(
      localStorage.getItem("shelter-kennel-state-history") || "{}",
    );
    savedEntries = Array.isArray(saved[boxId]) ? saved[boxId] : [];
  } catch (error) {
    savedEntries = [];
  }

  return localEntries.concat(globalEntries).concat(savedEntries);
}

function showHistory(boxId) {
  var mergedHistory = getKennelLogEntries(boxId);
  var boxLabel = getBoxDisplayName(boxId);
  var historyTitle = document.getElementById("history-title");
  var historySummary = document.getElementById("history-summary");
  var historyList = document.getElementById("history-list");
  var historyDialog = document.getElementById("history-dialog");

  mergedHistory.sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  historyTitle.textContent = boxLabel + " history";
  historySummary.textContent =
    mergedHistory.length +
    (mergedHistory.length === 1 ? " entry" : " entries") +
    " · newest first";
  historyList.replaceChildren();

  mergedHistory.forEach(function (entry) {
    var item = document.createElement("li");
    item.className = "history-item";

    var header = document.createElement("div");
    header.className = "history-item-header";

    var action = document.createElement("strong");
    action.className = "history-action";
    action.textContent =
      entry.kind === "state_change"
        ? getHistoryActionLabel(entry.action)
        : entry.kind === "deleted_walk"
          ? "Last walk deleted"
          : "Walk registered";
    header.appendChild(action);

    var timestamp = document.createElement("time");
    timestamp.className = "history-timestamp";
    timestamp.textContent = getDisplayTimestamp(entry.timestamp);
    var parsedTimestamp = new Date(entry.timestamp);
    if (!isNaN(parsedTimestamp.getTime())) {
      timestamp.dateTime = parsedTimestamp.toISOString();
    }
    header.appendChild(timestamp);
    item.appendChild(header);

    var kennel = document.createElement("p");
    kennel.className = "history-box";
    kennel.textContent = "Kennel: " + boxLabel;
    item.appendChild(kennel);

    var fields = [
      ["Name", entry.name || "Unknown"],
      ["Comment", entry.comment || "No comment"],
    ];
    if (entry.walkTimestamp) {
      fields.push(["Walk date", getDisplayTimestamp(entry.walkTimestamp)]);
    }
    if (entry.deletedBy) {
      fields.push(["Deleted by", entry.deletedBy]);
    }

    fields.forEach(function (field) {
      var detail = document.createElement("p");
      detail.className = "history-detail";
      var label = document.createElement("span");
      label.className = "history-detail-label";
      label.textContent = field[0] + ": ";
      detail.appendChild(label);
      detail.appendChild(document.createTextNode(String(field[1])));
      item.appendChild(detail);
    });

    historyList.appendChild(item);
  });

  historyDialog.showModal();
}

function showAllHistory() {
  var visibleHistory = globalHistory.filter(function (entry) {
    return (
      entry.action !== "box_click" &&
      entry.action !== "cancel_register" &&
      entry.action !== "view_logs" &&
      entry.action !== "delete_button_click"
    );
  });

  if (visibleHistory.length === 0) {
    alert("No page activity has been recorded yet.");
    return;
  }

  var historyList = document.getElementById("history-list");
  document.getElementById("history-title").textContent = "Full page history";
  var historySummary = document.getElementById("history-summary");
  var historyDialog = document.getElementById("history-dialog");
  var sortedHistory = visibleHistory.sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  historySummary.textContent =
    sortedHistory.length +
    (sortedHistory.length === 1 ? " activity" : " activities") +
    " · newest first";
  historyList.replaceChildren();

  sortedHistory.forEach(function (entry) {
    var boxLabel = getBoxDisplayName(entry.boxId);
    var details =
      entry.details && typeof entry.details === "object" ? entry.details : {};
    var item = document.createElement("li");
    item.className = "history-item";

    var header = document.createElement("div");
    header.className = "history-item-header";

    var action = document.createElement("strong");
    action.className = "history-action";
    action.textContent = getHistoryActionLabel(entry.action);
    header.appendChild(action);

    var timestamp = document.createElement("time");
    timestamp.className = "history-timestamp";
    timestamp.textContent = getDisplayTimestamp(entry.timestamp);
    var parsedTimestamp = new Date(entry.timestamp);
    if (!isNaN(parsedTimestamp.getTime())) {
      timestamp.dateTime = parsedTimestamp.toISOString();
    }
    header.appendChild(timestamp);
    item.appendChild(header);

    var box = document.createElement("p");
    box.className = "history-box";
    box.textContent = "Kennel: " + boxLabel;
    item.appendChild(box);

    var fields = [];
    if (details.name) {
      fields.push(["Name", details.name]);
    }
    if (details.comment) {
      fields.push(["Comment", details.comment]);
    }
    if (details.message) {
      fields.push(["Note", details.message]);
    }
    if (typeof details.disabled === "boolean") {
      fields.push(["Status", details.disabled ? "Disabled" : "Enabled"]);
    }
    if (typeof details.count === "number") {
      fields.push([
        "Logs",
        details.count + (details.count === 1 ? " entry" : " entries"),
      ]);
    }
    if (details.deletedEntry && typeof details.deletedEntry === "object") {
      var deletedEntry = details.deletedEntry;
      fields.push([
        "Deleted walk",
        [
          deletedEntry.name,
          deletedEntry.timestamp
            ? getDisplayTimestamp(deletedEntry.timestamp)
            : "",
          deletedEntry.comment,
        ]
          .filter(Boolean)
          .join(" · ") || "Walk details unavailable",
      ]);
    }

    fields.forEach(function (field) {
      var detail = document.createElement("p");
      detail.className = "history-detail";
      var label = document.createElement("span");
      label.className = "history-detail-label";
      label.textContent = field[0] + ": ";
      detail.appendChild(label);
      detail.appendChild(document.createTextNode(String(field[1])));
      item.appendChild(detail);
    });

    historyList.appendChild(item);
  });

  historyDialog.showModal();
}

function getHistoryActionLabel(action) {
  var labels = {
    register_walk: "Walk registered",
    delete_last_log: "Last walk deleted",
    disable_kennel: "Kennel disabled",
    enable_kennel: "Kennel enabled",
    box_click: "Kennel selected",
    cancel_register: "Walk registration cancelled",
    view_logs: "Kennel logs viewed",
    delete_button_click: "Delete requested",
  };

  return labels[action] || String(action || "Activity").replace(/_/g, " ");
}

function deleteLastLog(boxId) {
  var history = boxHistory[boxId] || [];
  var boxLabel = getBoxDisplayName(boxId);

  if (history.length === 0) {
    alert(boxLabel + " has no logs to delete.");
    return;
  }

  var deletedEntry = history.pop();
  addGlobalHistory("delete_last_log", boxId, {
    deletedEntry: deletedEntry,
    displayName: boxLabel,
  });

  var box = document.getElementById(boxId);
  renderBox(box);
  alert("Deleted last log for " + boxLabel + ".");
}

async function loadActivityHistory() {
  try {
    var activity = await fetchJson("/api/activity");
    globalHistory = Array.isArray(activity)
      ? activity.map(function (item) {
          return {
            action: item.action,
            boxId: item.boxId || item.box_id,
            details: item.details || {},
            timestamp: item.timestamp || item.created_at,
          };
        })
      : [];
  } catch (error) {
    console.error("Failed to load activity history:", error);
    globalHistory = [];
  }
}

async function loadBoxHistory(boxId) {
  try {
    var rows = await fetchJson("/api/walks/" + boxId);
    var normalized = Array.isArray(rows)
      ? rows.map(function (row) {
          return {
            timestamp: row.timestamp,
            name: row.name,
            comment: row.comment || "No comment",
          };
        })
      : [];

    normalized.sort(function (a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });

    boxHistory[boxId] = normalized;

    var box = document.getElementById(boxId);
    if (box) {
      renderBox(box);
    }

    return normalized;
  } catch (error) {
    console.error("Failed to load box history:", error);
    boxHistory[boxId] = [];
    return [];
  }
}

async function loadDogData() {
  try {
    var result = await fetchJson("/api/dogs");

    result.forEach(function (dog) {
      var boxId = dog.kennel_id;
      var box = document.getElementById(boxId);
      if (!box) {
        return;
      }

      boxHistory[boxId] = [];
    });

    var boxes = Array.from(document.querySelectorAll(".box"));
    for (var i = 0; i < boxes.length; i += 1) {
      await loadBoxHistory(boxes[i].id);
    }
  } catch (error) {
    console.error("Failed to load dog data from server:", error);
  }
}

async function persistWalk(boxId, name, comment) {
  try {
    var result = await fetchJson("/api/walks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kennel_id: boxId,
        name: name,
        comment: comment,
      }),
    });

    await loadBoxHistory(boxId);

    addGlobalHistory("register_walk", boxId, {
      name: result.name,
      comment: result.comment || "No comment",
      timestamp: result.timestamp,
    });

    var box = document.getElementById(boxId);
    renderBox(box);
  } catch (error) {
    console.error("Failed to save walk:", error);
    alert("Could not save walk. Please try again.");
  }
}

async function deleteLastServerLog(boxId, name) {
  try {
    var result = await fetchJson("/api/walks/" + boxId + "/last", {
      method: "DELETE",
    });

    await loadBoxHistory(boxId);

    addGlobalHistory("delete_last_log", boxId, {
      name: name,
      deletedEntry: result.deleted,
    });

    var box = document.getElementById(boxId);
    renderBox(box);
  } catch (error) {
    console.error("Failed to delete last walk:", error);
    alert("Could not delete the last log for this kennel.");
  }
}

function bindBox(box) {
  var boxId = box.id;
  var boxLabel = getBoxDisplayName(box);
  boxHistory[boxId] = [];

  box.addEventListener("click", function () {
    if (disabledKennels[boxId]) {
      alert(
        "Kennel " +
          boxLabel +
          " is currently disabled. Use the on/off button to enable it.",
      );
      return;
    }

    addGlobalHistory("box_click", boxId, {
      message: "Big box clicked",
      displayName: boxLabel,
    });

    var shouldRegister = confirm("Register a walk for " + boxLabel + "?");
    if (!shouldRegister) {
      addGlobalHistory("cancel_register", boxId, {
        status: "no",
        displayName: boxLabel,
      });
      return;
    }

    var name = prompt("Enter your name for " + boxLabel + ":");
    if (name === null || name.trim() === "") {
      name = "Unknown";
    }

    var comment = prompt("Enter your comment for " + boxLabel + ":");
    if (comment === null || comment.trim() === "") {
      comment = "No comment";
    }

    persistWalk(boxId, name, comment);
  });

  var logsBtn = document.getElementById(boxId + "logs");
  var deleteBtn = document.getElementById(boxId + "delete");
  var toggleBtn = document.getElementById(boxId + "toggle");

  logsBtn.addEventListener("click", function () {
    addGlobalHistory("view_logs", boxId, {
      count: boxHistory[boxId].length,
      displayName: boxLabel,
    });
    showHistory(boxId);
  });

  deleteBtn.addEventListener("click", function () {
    var shouldDelete = confirm(
      "Do you want to delete the last log from " + boxLabel + "?",
    );
    if (!shouldDelete) {
      return;
    }

    var name = prompt("Enter your name for " + boxLabel + ":");
    if (name === null) {
      return;
    }
    if (name.trim() === "") {
      name = "Unknown";
    }

    deleteLastServerLog(boxId, name);
  });

  toggleBtn.addEventListener("click", function () {
    toggleDisableKennel(boxId);
  });

  renderBox(box);
}

document.querySelectorAll(".box").forEach(function (box) {
  bindBox(box);
});

loadDisabledKennels();
loadStateHistory();
Promise.all([
  loadDisabledKennelsFromServer(),
  loadActivityHistory(),
  loadDogData(),
]);
ensureToggleButtons();
initAdminControlsToggle();

function refreshBoard() {
  Promise.all([
    loadDisabledKennelsFromServer(),
    loadActivityHistory(),
    loadDogData(),
  ]).then(function () {
    document.querySelectorAll(".box").forEach(function (box) {
      renderBox(box);
    });
  });
}

document
  .getElementById("show-all-history")
  .addEventListener("click", showAllHistory);
document.getElementById("close-history").addEventListener("click", function () {
  document.getElementById("history-dialog").close();
});
document.getElementById("open-admin").addEventListener("click", function () {
  window.location.href = "/admin.html";
});

document.getElementById("refresh-board").addEventListener("click", function () {
  refreshBoard();
});

setInterval(
  function () {
    refreshBoard();
  },
  60 * 60 * 1000,
);

setInterval(function () {
  document.querySelectorAll(".box").forEach(function (box) {
    renderBox(box);
  });
}, 1000);

Promise.all([loadActivityHistory(), loadDogData()]);

function toggleAdminControls() {
  var buttons = document.querySelectorAll(".toggle-disable");
  var isHidden =
    buttons.length > 0 &&
    Array.from(buttons).every(function (btn) {
      return btn.style.display === "none";
    });

  buttons.forEach(function (btn) {
    btn.style.display = isHidden ? "block" : "none";
  });
}

function initAdminControlsToggle() {
  document.querySelectorAll(".toggle-disable").forEach(function (btn) {
    btn.style.display = "none";
  });

  var toggleButton = document.getElementById("show-admin-controls");
  if (toggleButton) {
    toggleButton.addEventListener("click", function () {
      toggleAdminControls();
    });
  }
}
