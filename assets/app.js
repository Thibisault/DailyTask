
(() => {
  'use strict';

  // --- Utilities ---
  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const STORAGE_KEY = 'dailyTask:v2';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {
          tasks: [], lastReset: todayStr(), seqPending: 0, seqCompleted: 0,
          cycles: [sampleCycle()], currentCycleId: null
        };
      }
      const parsed = JSON.parse(raw);
      if (!parsed.tasks) parsed.tasks = [];
      if (!parsed.cycles || !Array.isArray(parsed.cycles) || parsed.cycles.length === 0) parsed.cycles = [sampleCycle()];
      if (!parsed.lastReset) parsed.lastReset = todayStr();
      if (typeof parsed.seqPending !== 'number') parsed.seqPending = 0;
      if (typeof parsed.seqCompleted !== 'number') parsed.seqCompleted = 0;
      if (!parsed.currentCycleId) parsed.currentCycleId = parsed.cycles[0]?.id ?? null;
      return parsed;
    } catch (e) {
      console.error('Failed to load state:', e);
      return {
        tasks: [], lastReset: todayStr(), seqPending: 0, seqCompleted: 0,
        cycles: [sampleCycle()], currentCycleId: null
      };
    }
  }
  const state = loadState();
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function uid(prefix='id') { return prefix + '_' + Math.random().toString(36).slice(2,8); }

  // --- Elements ---
  const els = {
    // Tabs + header
    today: document.getElementById('today'),
    tabBtns: [...document.querySelectorAll('.tab-btn')],
    tabTasks: document.getElementById('tab-tasks'),
    tabCycles: document.getElementById('tab-cycles'),
    blackout: document.getElementById('blackout'),
    blackoutToggle: document.getElementById('blackoutToggle'),
    audioEnable: document.getElementById('audioEnable'),

    // Tasks
    addForm: document.getElementById('addForm'),
    taskInput: document.getElementById('taskInput'),
    pendingList: document.getElementById('pendingList'),
    doneList: document.getElementById('doneList'),
    tplTask: document.getElementById('taskItemTemplate'),
    resetNow: document.getElementById('resetNow'),

    // Cycles
    cycleSelect: document.getElementById('cycleSelect'),
    addCycle: document.getElementById('addCycle'),
    renameCycle: document.getElementById('renameCycle'),
    deleteCycle: document.getElementById('deleteCycle'),
    blockList: document.getElementById('blockList'),
    tplBlock: document.getElementById('blockItemTemplate'),
    tplSub: document.getElementById('subItemTemplate'),
    addBlock: document.getElementById('addBlock'),
    startCycle: document.getElementById('startCycle'),
    pauseCycle: document.getElementById('pauseCycle'),
    resetCycle: document.getElementById('resetCycle'),
    currentLabel: document.getElementById('currentLabel'),
    nextLabel: document.getElementById('nextLabel'),
    clock: document.getElementById('clock'),
    progressBar: document.getElementById('progressBar'),
  };

  // --- Wake Lock & Blackout ---
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      }
    } catch (e) {
      console.warn('WakeLock failed', e);
    }
  }
  async function releaseWakeLock() {
    try { if (wakeLock) await wakeLock.release(); }
    catch (_) {}
    wakeLock = null;
  }

  function toggleBlackout(show) {
    if (show) {
      els.blackout.classList.remove('hidden');
      els.blackout.setAttribute('aria-hidden', 'false');
      requestWakeLock(); // keep screen on during blackout
      try { els.blackout.focus(); } catch(_) {}
    } else {
      els.blackout.classList.add('hidden');
      els.blackout.setAttribute('aria-hidden', 'true');
    }
  }

  els.blackout.addEventListener('click', () => toggleBlackout(false));
  els.blackoutToggle.addEventListener('click', () => toggleBlackout(els.blackout.classList.contains('hidden')));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && runner.active) {
      requestWakeLock();
    }
  });

  // --- Audio (Web Audio beep) ---
  let audioCtx = null;
  function ensureAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function beep(freq = 880, duration = 0.18) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    o.start(now);
    o.stop(now + duration + 0.02);
  }
  els.audioEnable.addEventListener('click', () => {
    ensureAudioContext();
    beep(1000, 0.12);
    els.audioEnable.textContent = 'Son activé';
    els.audioEnable.disabled = true;
  });

  // --- Tabs ---
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      els.tabTasks.classList.toggle('show', tab === 'tasks');
      els.tabCycles.classList.toggle('show', tab === 'cycles');
    });
  });

  // --- Midnight reset for tasks ---
  function maybeResetToday() {
    const t = todayStr();
    if (state.lastReset !== t) {
      for (const task of state.tasks) {
        task.done = false;
        task.orderPending = (state.seqPending = state.seqPending + 1);
      }
      state.lastReset = t;
      saveState();
    }
  }
  function scheduleMidnightReset() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const ms = next - now;
    setTimeout(() => {
      state.lastReset = '1970-01-01';
      maybeResetToday();
      renderTasks();
      scheduleMidnightReset();
    }, ms);
  }

  // --- Tasks features ---
  function addTask(title) {
    title = title.trim();
    if (!title) return;
    const t = { id: uid('t'), title, done:false, orderPending: ++state.seqPending, orderCompleted: 0 };
    state.tasks.push(t);
    saveState();
    renderTasks();
  }
  function toggleDone(id, checked) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    t.done = checked;
    if (checked) t.orderCompleted = (t.orderCompleted || 0) + 1;
    else t.orderPending = (t.orderPending || 0) + 1;
    saveState(); renderTasks();
  }
  function deleteTask(id) {
    const ix = state.tasks.findIndex(x => x.id === id);
    if (ix >= 0) { state.tasks.splice(ix, 1); saveState(); renderTasks(); }
  }
  function editTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const next = prompt('Modifier la tâche :', t.title);
    if (next != null && next.trim()) { t.title = next.trim(); saveState(); renderTasks(); }
  }
  function reorderTasks(listType, fromIndex, toIndex) {
    const list = state.tasks.filter(x => !!(listType==='done'?x.done:!x.done));
    if (fromIndex<0||fromIndex>=list.length||toIndex<0||toIndex>=list.length) return;
    const ids = list.sort((a,b)=>(listType==='done'?a.orderCompleted-b.orderCompleted:a.orderPending-b.orderPending)).map(t=>t.id);
    const [moved] = ids.splice(fromIndex,1); ids.splice(toIndex,0,moved);
    if (listType==='done') {
      ids.forEach((id,i)=>{ const t=state.tasks.find(x=>x.id===id); if(t) t.orderCompleted=i+1; }); 
    } else {
      ids.forEach((id,i)=>{ const t=state.tasks.find(x=>x.id===id); if(t) t.orderPending=i+1; });
    }
    saveState(); renderTasks();
  }
  function renderTasks() {
    els.today.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year:'numeric', month:'long', day:'numeric' });
    const pending = state.tasks.filter(t=>!t.done).sort((a,b)=>a.orderPending-b.orderPending);
    const done = state.tasks.filter(t=>t.done).sort((a,b)=>a.orderCompleted-b.orderCompleted);
    renderTaskList(els.pendingList, pending, 'pending');
    renderTaskList(els.doneList, done, 'done');
  }
  function renderTaskList(rootEl, items, listType) {
    rootEl.innerHTML='';
    items.forEach((task, index)=>{
      const li = els.tplTask.content.firstElementChild.cloneNode(true);
      li.dataset.id=task.id; li.dataset.index=index; li.dataset.list=listType;
      if (task.done) li.classList.add('done');
      li.querySelector('.toggle').checked = task.done;
      const titleSpan = li.querySelector('.title');
      titleSpan.textContent = task.title; titleSpan.title = task.title;

      li.querySelector('.toggle').addEventListener('change', e=> toggleDone(task.id, e.currentTarget.checked));
      li.querySelector('.delete').addEventListener('click', ()=> { if(confirm('Supprimer cette tâche ?')) deleteTask(task.id); });
      li.querySelector('.edit').addEventListener('click', ()=> editTask(task.id));

      // DnD
      li.addEventListener('dragstart', (e)=>{
        li.setAttribute('aria-grabbed','true');
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain', JSON.stringify({type:'task', list:listType, index}));
      });
      li.addEventListener('dragend', ()=> li.removeAttribute('aria-grabbed'));
      li.addEventListener('dragover', e=>{ e.preventDefault(); li.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
      li.addEventListener('dragleave', ()=> li.classList.remove('drag-over'));
      li.addEventListener('drop', e=>{
        e.preventDefault(); li.classList.remove('drag-over');
        try{
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          if (data.type==='task' && data.list===listType) reorderTasks(listType, data.index, index);
        }catch{}
      });

      rootEl.appendChild(li);
    });
  }

  // --- Sample cycle
  function sampleCycle() {
    return {
      id: uid('c'), name: 'Mon cycle',
      blocks: [
        { id: uid('b'), title:'Travail', duration: 29*60, sub: [] },
        { id: uid('b'), title:'Sport + étirements', duration: 6*60, sub: [
          { id: uid('s'), title:'Exo 1', duration: 40 },
          { id: uid('s'), title:'Exo 2', duration: 40 },
          { id: uid('s'), title:'Exo 3', duration: 40 },
          { id: uid('s'), title:'Exo 4', duration: 40 },
          { id: uid('s'), title:'Exo 5', duration: 40 },
          { id: uid('s'), title:'Exo 6', duration: 40 }
        ]},
        { id: uid('b'), title:'Travail', duration: 29*60, sub: [] },
        { id: uid('b'), title:'Pause', duration: 9*60, sub: [] }
      ]
    };
  }

  // --- Cycles: CRUD & builder ---
  function secondsFromInput(str) {
    const s = String(str||'').trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) return parseInt(s,10); // seconds direct
    const parts = s.split(':').map(p=>parseInt(p,10));
    if (parts.length===2) return parts[0]*60 + (parts[1]||0);
    if (parts.length===3) return parts[0]*3600 + (parts[1]||0)*60 + (parts[2]||0);
    return 0;
  }
  function inputFromSeconds(sec) {
    const m = Math.floor(sec/60); const s = Math.floor(sec%60);
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }

  function getCurrentCycle() {
    const id = state.currentCycleId || state.cycles[0]?.id;
    return state.cycles.find(c=>c.id===id) || state.cycles[0];
  }

  function renderCycleSelect() {
    const cur = getCurrentCycle();
    els.cycleSelect.innerHTML='';
    state.cycles.forEach(c=>{
      const opt = document.createElement('option');
      opt.value=c.id; opt.textContent=c.name;
      if (cur && c.id===cur.id) opt.selected=true;
      els.cycleSelect.appendChild(opt);
    });
  }

  function renderBlocks() {
    const cycle = getCurrentCycle();
    if (!cycle) return;
    els.blockList.innerHTML='';
    cycle.blocks.forEach((b, index)=>{
      const li = els.tplBlock.content.firstElementChild.cloneNode(true);
      li.dataset.id=b.id; li.dataset.index=index; li.classList.add('block');
      const title = li.querySelector('.block-title');
      const dur = li.querySelector('.block-duration');
      const subList = li.querySelector('.sub-list');
      title.value = b.title || '';
      dur.value = inputFromSeconds(b.duration||0);

      title.addEventListener('change', ()=>{ b.title = title.value.trim(); saveState(); });
      dur.addEventListener('change', ()=>{ b.duration = secondsFromInput(dur.value); dur.value = inputFromSeconds(b.duration); saveState(); });

      // Block actions
      li.querySelector('.add-sub').addEventListener('click', ()=>{
        b.sub = b.sub || [];
        b.sub.push({ id: uid('s'), title:'Sous-bloc', duration: 30 });
        saveState(); renderBlocks();
      });
      li.querySelector('.duplicate').addEventListener('click', ()=>{
        const copy = JSON.parse(JSON.stringify(b));
        copy.id = uid('b');
        (copy.sub||[]).forEach(s=> s.id = uid('s'));
        cycle.blocks.splice(index+1, 0, copy);
        saveState(); renderBlocks();
      });
      li.querySelector('.delete').addEventListener('click', ()=>{
        if (confirm('Supprimer ce bloc ?')) { cycle.blocks.splice(index,1); saveState(); renderBlocks(); }
      });

      // DnD for blocks
      li.addEventListener('dragstart', (e)=>{
        li.setAttribute('aria-grabbed','true');
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain', JSON.stringify({type:'block', index}));
      });
      li.addEventListener('dragend', ()=> li.removeAttribute('aria-grabbed'));
      li.addEventListener('dragover', e=>{ e.preventDefault(); li.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
      li.addEventListener('dragleave', ()=> li.classList.remove('drag-over'));
      li.addEventListener('drop', e=>{
        e.preventDefault(); li.classList.remove('drag-over');
        const data = JSON.parse(e.dataTransfer.getData('text/plain')||'{}');
        if (data.type==='block') {
          const from = data.index; const to = index;
          if (from!==to) {
            const [moved] = cycle.blocks.splice(from,1);
            cycle.blocks.splice(to,0,moved);
            saveState(); renderBlocks();
          }
        }
      });

      // Sub-list render
      (b.sub||[]).forEach((s, sIndex)=>{
        const sub = els.tplSub.content.firstElementChild.cloneNode(true);
        sub.dataset.id = s.id; sub.dataset.index = sIndex; sub.dataset.blockId=b.id;
        const stitle = sub.querySelector('.sub-title');
        const sdur = sub.querySelector('.sub-duration');
        stitle.value = s.title || '';
        sdur.value = inputFromSeconds(s.duration||0);
        stitle.addEventListener('change', ()=>{ s.title = stitle.value.trim(); saveState(); });
        sdur.addEventListener('change', ()=>{ s.duration = secondsFromInput(sdur.value); sdur.value=inputFromSeconds(s.duration); saveState(); });
        sub.querySelector('.duplicate').addEventListener('click', ()=>{
          const copy = JSON.parse(JSON.stringify(s)); copy.id = uid('s');
          b.sub.splice(sIndex+1, 0, copy); saveState(); renderBlocks();
        });
        sub.querySelector('.delete').addEventListener('click', ()=>{
          if (confirm('Supprimer ce sous-bloc ?')) { b.sub.splice(sIndex,1); saveState(); renderBlocks(); }
        });
        // DnD for sub
        sub.addEventListener('dragstart', (e)=>{
          sub.setAttribute('aria-grabbed','true');
          e.dataTransfer.effectAllowed='move';
          e.dataTransfer.setData('text/plain', JSON.stringify({type:'sub', blockId: b.id, index: sIndex}));
        });
        sub.addEventListener('dragend', ()=> sub.removeAttribute('aria-grabbed'));
        sub.addEventListener('dragover', e=>{ e.preventDefault(); sub.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
        sub.addEventListener('dragleave', ()=> sub.classList.remove('drag-over'));
        sub.addEventListener('drop', e=>{
          e.preventDefault(); sub.classList.remove('drag-over');
          const data = JSON.parse(e.dataTransfer.getData('text/plain')||'{}');
          if (data.type==='sub' && data.blockId === b.id) {
            const from = data.index; const to = sIndex;
            if (from!==to) {
              const [moved] = b.sub.splice(from,1);
              b.sub.splice(to,0,moved);
              saveState(); renderBlocks();
            }
          }
        });

        subList.appendChild(sub);
      });

      els.blockList.appendChild(li);
    });
  }

  // Cycle selection handlers
  function ensureCurrentCycle() {
    if (!state.currentCycleId && state.cycles.length) state.currentCycleId = state.cycles[0].id;
  }
  function createCycle(name='Nouveau cycle') {
    const c = { id: uid('c'), name, blocks: [] };
    state.cycles.push(c);
    state.currentCycleId = c.id;
    saveState(); renderCycleSelect(); renderBlocks();
  }

  els.cycleSelect.addEventListener('change', ()=>{ state.currentCycleId = els.cycleSelect.value; saveState(); renderBlocks(); });
  els.addCycle.addEventListener('click', ()=>{
    const name = prompt('Nom du cycle :','Nouveau cycle');
    if (name) createCycle(name.trim());
  });
  els.renameCycle.addEventListener('click', ()=>{
    const cur = getCurrentCycle(); if (!cur) return;
    const name = prompt('Renommer le cycle :', cur.name);
    if (name && name.trim()) { cur.name = name.trim(); saveState(); renderCycleSelect(); }
  });
  els.deleteCycle.addEventListener('click', ()=>{
    const cur = getCurrentCycle(); if (!cur) return;
    if (!confirm('Supprimer ce cycle ?')) return;
    state.cycles = state.cycles.filter(c=>c.id!==cur.id);
    state.currentCycleId = state.cycles[0]?.id ?? null;
    saveState(); renderCycleSelect(); renderBlocks();
  });
  els.addBlock.addEventListener('click', ()=>{
    const c = getCurrentCycle(); if (!c) return;
    c.blocks.push({ id: uid('b'), title:'Nouveau bloc', duration: 60, sub: [] });
    saveState(); renderBlocks();
  });

  // --- Runner (timer) ---
  const runner = {
    active:false, paused:false, items:[], index:0,
    unitStart:0, unitEnd:0, // timestamps (ms since epoch)
    totalMs:0, elapsedMs:0,
    timerId:null,
  };

  function buildRunItems() {
    const c = getCurrentCycle(); if (!c) return [];
    const items = [];
    for (const b of c.blocks) {
      if (b.sub && b.sub.length) {
        for (const s of b.sub) {
          items.push({ label: `${b.title} — ${s.title}`, ms: (s.duration||0)*1000 });
        }
      } else {
        items.push({ label: b.title, ms: (b.duration||0)*1000 });
      }
    }
    return items.filter(it=>it.ms>0);
  }

  function startRunner() {
    ensureAudioContext();
    requestWakeLock();
    runner.items = buildRunItems();
    runner.totalMs = runner.items.reduce((a,b)=>a+b.ms,0);
    runner.index = 0;
    runner.elapsedMs = 0;
    if (runner.items.length===0) {
      els.currentLabel.textContent='—'; els.nextLabel.textContent='—'; els.clock.textContent='00:00';
      els.progressBar.style.width='0%'; return;
    }
    runner.active=true; runner.paused=false;
    startUnit(Date.now(), runner.items[0].ms);
    tick();
  }

  function startUnit(now, durationMs) {
    runner.unitStart = now;
    runner.unitEnd = now + durationMs;
    updateTimerUI(); // immediate render
    if (runner.timerId) cancelAnimationFrame(runner.timerId);
    const loop = ()=>{
      if (!runner.active || runner.paused) return;
      tick();
      runner.timerId = requestAnimationFrame(loop);
    };
    runner.timerId = requestAnimationFrame(loop);
  }

  function tick() {
    const now = Date.now();
    const it = runner.items[runner.index];
    if (!it) return stopRunner(true);
    const remain = Math.max(0, runner.unitEnd - now);
    // UI
    const next = runner.items[runner.index+1];
    els.currentLabel.textContent = it.label;
    els.nextLabel.textContent = next ? next.label : 'Fin';
    els.clock.textContent = fmtClock(remain);
    const elapsedInUnit = (it.ms - remain);
    const totalElapsed = runner.items.slice(0, runner.index).reduce((a,b)=>a+b.ms,0) + elapsedInUnit;
    const pct = runner.totalMs ? Math.min(100, (totalElapsed/runner.totalMs)*100) : 0;
    els.progressBar.style.width = pct.toFixed(2)+'%';
    // Transition
    if (remain <= 0) {
      beep(900, 0.12);
      runner.index += 1;
      if (runner.index >= runner.items.length) return stopRunner(true);
      startUnit(now, runner.items[runner.index].ms);
    }
  }

  function pauseRunner() {
    if (!runner.active || runner.paused) return;
    runner.paused = true;
    runner._remaining = Math.max(0, runner.unitEnd - Date.now());
  }
  function resumeRunner() {
    if (!runner.active || !runner.paused) return;
    runner.paused = false;
    startUnit(Date.now(), runner._remaining || 0);
  }
  function stopRunner(done=false) {
    runner.active=false; runner.paused=false;
    if (runner.timerId) cancelAnimationFrame(runner.timerId);
    releaseWakeLock();
    if (done) {
      setTimeout(()=>beep(880,0.1), 0);
      setTimeout(()=>beep(660,0.12), 160);
      setTimeout(()=>beep(990,0.12), 340);
    }
  }

  function fmtClock(ms) {
    const s = Math.ceil(ms/1000);
    const m = Math.floor(s/60); const sec = s%60;
    return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
  }

  function updateTimerUI() {
    const it = runner.items[runner.index];
    const next = runner.items[runner.index+1];
    els.currentLabel.textContent = it ? it.label : '—';
    els.nextLabel.textContent = next ? next.label : '—';
    els.clock.textContent = it ? fmtClock(it.ms) : '00:00';
    els.progressBar.style.width = '0%';
  }

  // Timer controls
  els.startCycle.addEventListener('click', ()=> startRunner());
  els.pauseCycle.addEventListener('click', ()=> runner.paused ? resumeRunner() : pauseRunner());
  els.resetCycle.addEventListener('click', ()=> stopRunner(false));

  // --- Events: tasks
  els.addForm?.addEventListener('submit', (e)=>{
    e.preventDefault(); addTask(els.taskInput.value); els.taskInput.value=''; els.taskInput.focus();
  });
  els.resetNow?.addEventListener('click', ()=>{
    if (confirm("Réinitialiser l'état 'terminé' pour toutes les tâches aujourd'hui ?")) {
      state.lastReset = '1970-01-01'; maybeResetToday(); renderTasks();
    }
  });

  // --- Init ---
  maybeResetToday();
  renderTasks();
  ensureCurrentCycle(); renderCycleSelect(); renderBlocks();
  scheduleMidnightReset();
  els.tabTasks.classList.add('show');
})();
