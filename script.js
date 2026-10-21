var boxHistory = {};
var globalHistory = [];

async function fetchJson(url, options) {
  var response = await fetch(url, options || {});
  var payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

function addGlobalHistory(action, boxId, details) {
  var entry = {
    action: action,
    boxId: boxId,
    details: details,
    timestamp: new Date().toLocaleString()
  };

  globalHistory.push(entry);

  fetchJson('/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: entry.action,
      boxId: entry.boxId,
      details: entry.details,
      timestamp: new Date().toISOString()
    })
  }).catch(function (err) {
    console.error('Failed to save activity log:', err);
  });
}

function getDisplayTimestamp(value) {
  if (!value) {
    return '';
  }

  var date = new Date(value);
  if (isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getStatusFromTimestamp(timestampValue) {
  if (!timestampValue) {
    return 'default';
  }

  var date = new Date(timestampValue);
  if (isNaN(date.getTime())) {
    return 'default';
  }

  var ageInSeconds = (Date.now() - date.getTime()) / 1000;

  if (ageInSeconds < 5) {
    return 'green';
  }
  if (ageInSeconds <= 30) {
    return 'yellow';
  }

  return 'red';
}

function renderBox(box) {
  var history = boxHistory[box.id] || [];
  var latestEntry = history[history.length - 1];

  box.classList.remove('green', 'yellow', 'red', 'default');

  if (!latestEntry) {
    box.textContent = box.id;
    box.classList.add('default');
    box.classList.remove('clicked');
    return;
  }

  var timestampText = getDisplayTimestamp(latestEntry.timestamp);
  box.textContent = box.id + '\n' + timestampText + '\n' + latestEntry.name;
  box.classList.add(getStatusFromTimestamp(latestEntry.timestamp));
  box.classList.add('clicked');
}

function showHistory(boxId) {
  var history = boxHistory[boxId] || [];

  if (history.length === 0) {
    alert(boxId + ' has no logs yet.');
    return;
  }

  var text = boxId + ' history:\n\n';
  history.forEach(function (entry, index) {
    text += (index + 1) + ') ' + getDisplayTimestamp(entry.timestamp) + '\n';
    text += 'Name: ' + entry.name + '\n';
    text += 'Comment: ' + entry.comment + '\n\n';
  });

  alert(text);
}

function showAllHistory() {
  if (globalHistory.length === 0) {
    alert('No page activity has been recorded yet.');
    return;
  }

  var text = 'Full page history:\n\n';
  globalHistory.forEach(function (entry, index) {
    text += (index + 1) + ') ' + entry.timestamp + '\n';
    text += 'Action: ' + entry.action + '\n';
    text += 'Box: ' + entry.boxId + '\n';
    text += 'Details: ' + JSON.stringify(entry.details) + '\n\n';
  });

  alert(text);
}

function deleteLastLog(boxId) {
  var history = boxHistory[boxId] || [];

  if (history.length === 0) {
    alert(boxId + ' has no logs to delete.');
    return;
  }

  var deletedEntry = history.pop();
  addGlobalHistory('delete_last_log', boxId, {
    deletedEntry: deletedEntry
  });

  var box = document.getElementById(boxId);
  renderBox(box);
  alert('Deleted last log for ' + boxId + '.');
}

async function loadActivityHistory() {
  try {
    var activity = await fetchJson('/api/activity');
    globalHistory = Array.isArray(activity) ? activity.map(function (item) {
      return {
        action: item.action,
        boxId: item.boxId || item.box_id,
        details: item.details || {},
        timestamp: item.timestamp || item.created_at
      };
    }) : [];
  } catch (error) {
    console.error('Failed to load activity history:', error);
    globalHistory = [];
  }
}

async function loadBoxHistory(boxId) {
  try {
    var rows = await fetchJson('/api/walks/' + boxId);
    var normalized = Array.isArray(rows) ? rows.map(function (row) {
      return {
        timestamp: row.timestamp,
        name: row.name,
        comment: row.comment || 'No comment'
      };
    }) : [];

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
    console.error('Failed to load box history:', error);
    boxHistory[boxId] = [];
    return [];
  }
}

async function loadDogData() {
  try {
    var result = await fetchJson('/api/dogs');

    result.forEach(function (dog) {
      var boxId = dog.kennel_id;
      var box = document.getElementById(boxId);
      if (!box) {
        return;
      }

      boxHistory[boxId] = [];
    });

    var boxes = Array.from(document.querySelectorAll('.box'));
    for (var i = 0; i < boxes.length; i += 1) {
      await loadBoxHistory(boxes[i].id);
    }
  } catch (error) {
    console.error('Failed to load dog data from server:', error);
  }
}

async function persistWalk(boxId, name, comment) {
  try {
    var result = await fetchJson('/api/walks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kennel_id: boxId,
        name: name,
        comment: comment
      })
    });

    await loadBoxHistory(boxId);

    addGlobalHistory('register_walk', boxId, {
      name: result.name,
      comment: result.comment || 'No comment',
      timestamp: result.timestamp
    });

    var box = document.getElementById(boxId);
    renderBox(box);
  } catch (error) {
    console.error('Failed to save walk:', error);
    alert('Could not save walk. Please try again.');
  }
}

async function deleteLastServerLog(boxId) {
  try {
    var result = await fetchJson('/api/walks/' + boxId + '/last', {
      method: 'DELETE'
    });

    await loadBoxHistory(boxId);

    addGlobalHistory('delete_last_log', boxId, {
      deletedEntry: result.deleted
    });

    var box = document.getElementById(boxId);
    renderBox(box);
  } catch (error) {
    console.error('Failed to delete last walk:', error);
    alert('Could not delete the last log for this kennel.');
  }
}

function bindBox(box) {
  var boxId = box.id;
  boxHistory[boxId] = [];

  box.addEventListener('click', function () {
    addGlobalHistory('box_click', boxId, { message: 'Big box clicked' });

    var shouldRegister = confirm('Register a walk for ' + boxId + '?');
    if (!shouldRegister) {
      addGlobalHistory('cancel_register', boxId, { status: 'no' });
      return;
    }

    var name = prompt('Enter your name for ' + boxId + ':');
    if (name === null || name.trim() === '') {
      name = 'Unknown';
    }

    var comment = prompt('Enter your comment for ' + boxId + ':');
    if (comment === null || comment.trim() === '') {
      comment = 'No comment';
    }

    persistWalk(boxId, name, comment);
  });

  var logsBtn = document.getElementById(boxId + 'logs');
  var deleteBtn = document.getElementById(boxId + 'delete');

  logsBtn.addEventListener('click', function () {
    addGlobalHistory('view_logs', boxId, { count: boxHistory[boxId].length });
    showHistory(boxId);
  });

  deleteBtn.addEventListener('click', function () {
    addGlobalHistory('delete_button_click', boxId, { message: 'Delete requested' });
    deleteLastServerLog(boxId);
  });

  renderBox(box);
}

document.querySelectorAll('.box').forEach(function (box) {
  bindBox(box);
});

document.getElementById('show-all-history').addEventListener('click', showAllHistory);
document.getElementById('open-admin').addEventListener('click', function () {
  window.location.href = '/admin.html';
});

function refreshBoard() {
  Promise.all([
    loadActivityHistory(),
    loadDogData()
  ]);
}

document.getElementById('refresh-board').addEventListener('click', function () {
  refreshBoard();
});

setInterval(function () {
  refreshBoard();
}, 5 * 60 * 1000);

setInterval(function () {
  document.querySelectorAll('.box').forEach(function (box) {
    renderBox(box);
  });
}, 1000);

Promise.all([
  loadActivityHistory(),
  loadDogData()
]);
