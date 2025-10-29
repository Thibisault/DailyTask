
(() => {
  'use strict';

  // --- Utilities that must exist before first use ---
  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const STORAGE_KEY = 'dailyTask:v1';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { tasks: [], lastReset: todayStr(), seqPending: 0, seqCompleted: 0 };
      }
      const parsed = JSON.parse(raw);
      // Backfill sequences if missing
      if (typeof parsed.seqPending !== 'number' || typeof parsed.seqCompleted !== 'number') {
        parsed.seqPending = 0;
        parsed.seqCompleted = 0;
        for (const t of parsed.tasks ?? []) {
          if (t.done) parsed.seqCompleted = Math.max(parsed.seqCompleted, t.orderCompleted ?? 0);
          else parsed.seqPending = Math.max(parsed.seqPending, t.orderPending ?? 0);
        }
      }
      if (!parsed.lastReset) parsed.lastReset = todayStr();
      if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
      return parsed;
    } catch (e) {
      console.error('Failed to load state:', e);
      return { tasks: [], lastReset: todayStr(), seqPending: 0, seqCompleted: 0 };
    }
  }

  const state = loadState();

  const els = {
    today: document.getElementById('today'),
    addForm: document.getElementById('addForm'),
    taskInput: document.getElementById('taskInput'),
    pendingList: document.getElementById('pendingList'),
    doneList: document.getElementById('doneList'),
    tpl: document.getElementById('taskItemTemplate'),
    resetNow: document.getElementById('resetNow'),
  };

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // --- Reset at midnight (local) ---
  function maybeResetToday() {
    const t = todayStr();
    if (state.lastReset !== t) {
      for (const task of state.tasks) {
        task.done = false;
        // When moved back to pending, give it a new pending order to push near bottom
        task.orderPending = ++state.seqPending;
      }
      state.lastReset = t;
      saveState();
    }
  }

  function scheduleMidnightReset() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0); // next local midnight
    const ms = next - now;
    setTimeout(() => {
      // Reset and then schedule the next 24h cycle
      state.lastReset = '1970-01-01'; // force reset
      maybeResetToday();
      render();
      scheduleMidnightReset();
    }, ms);
  }

  // --- Task operations ---
  function addTask(title) {
    title = title.trim();
    if (!title) return;
    const id = 't_' + Math.random().toString(36).slice(2);
    const task = {
      id,
      title,
      done: false,
      orderPending: ++state.seqPending,
      orderCompleted: 0
    };
    state.tasks.push(task);
    saveState();
    render();
  }

  function toggleDone(id, checked) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    t.done = checked;
    if (checked) {
      t.orderCompleted = ++state.seqCompleted;
    } else {
      t.orderPending = ++state.seqPending;
    }
    saveState();
    render();
  }

  function deleteTask(id) {
    const ix = state.tasks.findIndex(x => x.id === id);
    if (ix >= 0) {
      state.tasks.splice(ix, 1);
      saveState();
      render();
    }
  }

  function editTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const next = prompt('Modifier la tâche :', t.title);
    if (next != null) {
      const trimmed = next.trim();
      if (trimmed) {
        t.title = trimmed;
        saveState();
        render();
      }
    }
  }

  // Reorder within listType = 'pending' | 'done' given fromIndex -> toIndex (0-based)
  function reorder(listType, fromIndex, toIndex) {
    const list = state.tasks.filter(x => !!(listType === 'done' ? x.done : !x.done));
    if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
    // Create stable order array of ids
    const ids = list
      .sort((a, b) => (listType === 'done' ? a.orderCompleted - b.orderCompleted : a.orderPending - b.orderPending))
      .map(t => t.id);
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    // Rewrite order numbers in that list
    if (listType === 'done') {
      ids.forEach((id, i) => {
        const t = state.tasks.find(x => x.id === id);
        if (t) t.orderCompleted = i + 1;
      });
      state.seqCompleted = ids.length;
    } else {
      ids.forEach((id, i) => {
        const t = state.tasks.find(x => x.id === id);
        if (t) t.orderPending = i + 1;
      });
      state.seqPending = ids.length;
    }
    saveState();
    render();
  }

  // --- Render ---
  function render() {
    // header date
    els.today.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year:'numeric', month:'long', day:'numeric' });
    // lists
    const pending = state.tasks.filter(t => !t.done).sort((a,b)=>a.orderPending-b.orderPending);
    const done = state.tasks.filter(t => t.done).sort((a,b)=>a.orderCompleted-b.orderCompleted);
    renderList(els.pendingList, pending, 'pending');
    renderList(els.doneList, done, 'done');
  }

  function renderList(rootEl, items, listType) {
    rootEl.innerHTML = '';
    items.forEach((task, index) => {
      const li = els.tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = task.id;
      li.dataset.index = index;
      li.dataset.list = listType;
      if (task.done) li.classList.add('done');
      li.querySelector('.toggle').checked = task.done;
      const titleSpan = li.querySelector('.title');
      titleSpan.textContent = task.title;
      titleSpan.title = task.title;

      // Handlers
      li.querySelector('.toggle').addEventListener('change', (e) => {
        toggleDone(task.id, e.currentTarget.checked);
      });
      li.querySelector('.delete').addEventListener('click', () => {
        if (confirm('Supprimer cette tâche ?')) deleteTask(task.id);
      });
      li.querySelector('.edit').addEventListener('click', () => {
        editTask(task.id);
      });

      // Drag & drop
      li.addEventListener('dragstart', (e) => {
        li.setAttribute('aria-grabbed', 'true');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({
          id: task.id, list: listType, index
        }));
      });
      li.addEventListener('dragend', () => {
        li.removeAttribute('aria-grabbed');
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
      });
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
      });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          const toList = listType;
          const toIndex = index;
          if (data.list !== toList) {
            // Only reorder within the same group to keep "terminé en bas"
            return;
          }
          reorder(listType === 'done' ? 'done' : 'pending', data.index, toIndex);
        } catch (err) {
          console.warn('Invalid drop data', err);
        }
      });

      rootEl.appendChild(li);
    });
  }

  // --- Events ---
  els.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addTask(els.taskInput.value);
    els.taskInput.value = '';
    els.taskInput.focus();
  });

  els.resetNow.addEventListener('click', () => {
    if (confirm("Réinitialiser l'état 'terminé' pour toutes les tâches aujourd'hui ?")) {
      state.lastReset = '1970-01-01';
      maybeResetToday();
      render();
    }
  });

  // First render & timers
  maybeResetToday();
  render();
  scheduleMidnightReset();
})();
