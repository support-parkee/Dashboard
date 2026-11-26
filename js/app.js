/**
 * Support Apps - Server & Client Infrastructure Telemetry Controller
 * Author: PARKEE Infrastructure & Support Engineering
 */

const App = {
  // Data stores
  locations: [],
  servers: [],
  fleet: [],
  storageServers: [],
  serverBackup: [],
  _backupLoaded: false,
  _inflight: {},
  _copyFeedbackTimers: new WeakMap(),
  _lastCopyStatusMsg: '',

  // Loading status per dataset: 'loading' | 'ready' | 'error'
  dataStatus: {
    locations: 'loading',
    servers: 'loading',
    fleet: 'loading',
    summary: 'loading',
    tickets: 'loading',      // tickets_summary.json (ringkasan, cepat)
    ticketsFull: 'loading',  // tickets.json (lengkap, ~6 MB)
    temperature: 'loading',
    backup: 'loading'
  },

  // Elements (KPI numbers / badges) that show a shimmer while their dataset loads
  loadingTargets: {
    summary: ['storageKpiTotalDrives', 'storageKpiNvmeRatio', 'storageKpiFullCount', 'storageKpiLowHealthCount'],
    tickets: [
      'dashKpiTotal', 'dashKpiResolved', 'dashKpiResolvedPct', 'dashKpiProcessing', 'dashKpiNewPending', 'dashKpiHighPrio',
      'dashStatusSolveRate', 'dashHighPrioBadge', 'dashAvgDailyBadge',
      'ticketKpiTotal', 'ticketKpiResolved', 'ticketKpiProcessing', 'ticketKpiNewPending', 'ticketKpiHighPrio'
    ],
    temperature: ['tempTotalMonitored', 'tempCountOverheat', 'tempCountWarm', 'tempCountNormal', 'tempAvgCelsius'],
    backup: ['backupKpiTotal', 'backupKpiStreaming', 'backupKpiAutoPromote', 'backupKpiP2P']
  },

  // Table bodies -> datasets they depend on (+ optional counter labels to reset)
  tableLoadSpec: {
    dashCriticalTableBody: { keys: ['tickets'], label: 'Memuat tiket kritis…' },
    locationsTableBody: { keys: ['locations'], label: 'Memuat data lokasi…', labels: ['locResultCountLabel', 'locTableCountLabel'] },
    serversTableBody: { keys: ['servers'], label: 'Memuat data server…', labels: ['serverResultCountLabel', 'serverTableCountLabel'] },
    allClientsTableBody: { keys: ['fleet'], label: 'Memuat data klien (±3,5 MB)…', labels: ['allClientsCountBadge', 'allClientsCountLabel'] },
    storageTableBody: { keys: ['servers'], label: 'Memuat data storage server…', labels: ['storageResultCountLabel', 'storageTableCountLabel'] },
    tempTableBody: { keys: ['temperature'], label: 'Memuat telemetri suhu dari Grafana Prometheus…' },
    ticketTableBody: { keys: ['ticketsFull'], label: 'Memuat seluruh data tiket GLPI (±6 MB)…', labels: ['ticketResultCountLabel', 'ticketTableCountLabel'] },
    backupTableBody: { keys: ['backup'], label: 'Memuat data server backup…', labels: ['backupResultCountLabel', 'backupTableCountLabel'] }
  },

  chartCanvasIds: ['chartDashStatus', 'chartDashPriority', 'chartDashCatDonut', 'chartDashDailyTrend', 'chartDashCategories', 'chartDashLocations'],
  summary: null,

  // Selected state for Client Specification master-detail
  // View Filter states
  locState: {
    search: '',
    tier: 'all',
    reader: 'all',
    temp: 'all',
    storage: 'all',
    page: 1,
    pageSize: 25,
    sortCol: 'loc',
    sortDir: 'asc'
  },

  serverState: {
    search: '',
    filter: 'all',
    tier: 'all',
    cpu: 'all',
    mb: 'all',
    ram: 'all',
    ssdType: 'all',
    ssdBrand: 'all',
    ssdSize: 'all',
    tempRange: 'all',
    healthRange: 'all',
    usageRange: 'all',
    page: 1,
    pageSize: 25,
    sortCol: 'loc',
    sortDir: 'asc'
  },

  // Sisi Kiri (50%): All Clients Nationwide
  allClientsState: {
    search: '',
    filter: 'all',
    role: 'all',
    readerStatus: 'all',
    readerVer: 'all',
    cpu: 'all',
    tempRange: 'all',
    page: 1,
    pageSize: 50,
    sortCol: 'loc',
    sortDir: 'asc'
  },

  _trustedHtmlPolicy: null,
  _lastFocusedEl: null,
  _collator: (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function')
    ? new Intl.Collator('id', { numeric: true, sensitivity: 'base' })
    : null,

  getTrustedHtmlPolicy() {
    if (this._trustedHtmlPolicy) return this._trustedHtmlPolicy;
    if (typeof window !== 'undefined' && window.trustedTypes && typeof window.trustedTypes.createPolicy === 'function') {
      try {
        this._trustedHtmlPolicy = window.trustedTypes.createPolicy('parkee-html', {
          createHTML: (html) => String(html ?? '')
        });
      } catch (e) {
        this._trustedHtmlPolicy = null;
      }
    }
    return this._trustedHtmlPolicy;
  },

  setHtml(el, html) {
    if (!el) return;
    const str = html == null ? '' : String(html);
    const policy = this.getTrustedHtmlPolicy();
    el.innerHTML = policy ? policy.createHTML(str) : str;
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  sanitizeCsvValue(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^-\d+(\.\d+)?$/.test(str.trim())) return str;
    if (/^[=+\-@\t\r]/.test(str)) return `'${str}`;
    return str;
  },

  escapeCsvCell(val) {
    const safe = this.sanitizeCsvValue(val);
    if (/[",\n\r]/.test(safe)) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  },

  getWibParts(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    try {
      const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const map = {};
      for (const p of dtf.formatToParts(d)) {
        if (p.type !== 'literal') map[p.type] = p.value;
      }
      const hourNum = Number(map.hour) === 24 ? 0 : Number(map.hour);
      const year = Number(map.year);
      const month = Number(map.month);
      const day = Number(map.day);
      const minute = Number(map.minute);
      const second = Number(map.second);
      return {
        year,
        month,
        day,
        hour: hourNum,
        minute,
        second,
        ymd: `${map.year}-${map.month}-${map.day}`
      };
    } catch (e) {
      const utcMs = d.getTime() + 7 * 3600 * 1000;
      const w = new Date(utcMs);
      const pad = (n) => String(n).padStart(2, '0');
      const year = w.getUTCFullYear();
      const month = w.getUTCMonth() + 1;
      const day = w.getUTCDate();
      return {
        year,
        month,
        day,
        hour: w.getUTCHours(),
        minute: w.getUTCMinutes(),
        second: w.getUTCSeconds(),
        ymd: `${year}-${pad(month)}-${pad(day)}`
      };
    }
  },

  isTextInputFocused(el) {
    const target = el || document.activeElement;
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(target.isContentEditable);
  },

  storageState: {
    search: '',
    filter: 'all',
    type: 'all',
    brand: 'all',
    capacity: 'all',
    healthRange: 'all',
    usageRange: 'all',
    tier: 'all',
    page: 1,
    pageSize: 25,
    sortCol: 'loc',
    sortDir: 'asc'
  },

  temperatureState: {
    search: '',
    filter: 'all',
    page: 1,
    pageSize: 25,
    sortCol: 'temp',
    sortDir: 'desc'
  },
  temperatureData: null,

  ticketingState: {
    search: '',
    filter: 'all',
    product: 'all',
    category: 'all',
    priority: 'all',
    startDate: '',
    endDate: '',
    datePreset: 'all',
    page: 1,
    pageSize: 25,
    sortCol: 'open_date',
    sortDir: 'desc'
  },
  ticketingData: null,

  backupState: {
    search: '',
    status: 'all',
    replication: 'all',
    autoPromote: 'all',
    p2p: 'all',
    teleport: 'all',
    cable: 'all',
    page: 1,
    pageSize: 50,
    sortCol: 'loc',
    sortDir: 'asc'
  },

  // Navigation state
  activeView: 'dashboard',

  // Auth & Security Gate (SHA-256)
  AUTH_HASH: 'cd36d85d95af662ef316814deaa414e1bc02f1e955a2dd57c77734a4d1236859',
  AUTH_STORAGE_KEY: 'parkee_dashboard_auth',
  AUTH_EXPIRY_DAYS: 30,
  dashboardLoaded: false,

  async sha256(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  checkAuthentication() {
    try {
      const stored = localStorage.getItem(this.AUTH_STORAGE_KEY) || sessionStorage.getItem(this.AUTH_STORAGE_KEY);
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      if (parsed && parsed.hash === this.AUTH_HASH) {
        if (!parsed.expiry || Date.now() < parsed.expiry) {
          return true;
        }
      }
    } catch (e) {
      // invalid storage
    }
    return false;
  },

  initLockScreen() {
    const appContainer = document.querySelector('.app-container');
    const lockScreen = document.getElementById('appLockScreen');
    const lockForm = document.getElementById('lockForm');
    const passwordInput = document.getElementById('lockPasswordInput');
    const toggleEyeBtn = document.getElementById('lockTogglePasswordBtn');
    const eyeIcon = document.getElementById('lockEyeIcon');
    const errorMsg = document.getElementById('lockErrorMsg');
    const rememberMe = document.getElementById('lockRememberMe');
    const lockCard = document.querySelector('.lock-card');
    const lockDashboardBtn = document.getElementById('lockDashboardBtn');
    const sidebarLockBtn = document.getElementById('sidebarLockBtn');

    // Always wire the Lock Dashboard (Logout) buttons
    if (lockDashboardBtn) {
      lockDashboardBtn.onclick = () => {
        this.lockDashboard();
      };
    }
    if (sidebarLockBtn) {
      sidebarLockBtn.onclick = () => {
        this.lockDashboard();
      };
    }

    if (this.checkAuthentication()) {
      if (lockScreen) {
        lockScreen.classList.add('unlocked');
        lockScreen.style.display = 'none';
        lockScreen.inert = true;
      }
      if (appContainer) appContainer.inert = false;
      return true; // Authenticated
    }

    // Show Lock Screen
    if (appContainer) appContainer.inert = true;
    if (lockScreen) {
      lockScreen.inert = false;
      lockScreen.classList.remove('unlocked');
      lockScreen.style.display = 'flex';
      setTimeout(() => passwordInput?.focus(), 150);
    }

    if (toggleEyeBtn && passwordInput) {
      toggleEyeBtn.setAttribute('aria-pressed', 'false');
      toggleEyeBtn.onclick = () => {
        const isPass = passwordInput.type === 'password';
        passwordInput.type = isPass ? 'text' : 'password';
        toggleEyeBtn.setAttribute('aria-pressed', isPass ? 'true' : 'false');
        toggleEyeBtn.setAttribute('aria-label', isPass ? 'Sembunyikan password' : 'Lihat password');
        if (eyeIcon) eyeIcon.textContent = isPass ? '🙈' : '👁️';
      };
    }

    const handleUnlock = async () => {
      const inputVal = (passwordInput?.value || '').trim();
      if (!inputVal) {
        passwordInput?.focus();
        return;
      }

      const inputHash = await this.sha256(inputVal);
      if (inputHash === this.AUTH_HASH) {
        // Successful unlock
        const payload = {
          hash: this.AUTH_HASH,
          unlockedAt: Date.now(),
          expiry: rememberMe?.checked ? Date.now() + (this.AUTH_EXPIRY_DAYS * 24 * 60 * 60 * 1000) : null
        };
        const strPayload = JSON.stringify(payload);
        if (rememberMe?.checked) {
          localStorage.setItem(this.AUTH_STORAGE_KEY, strPayload);
        } else {
          sessionStorage.setItem(this.AUTH_STORAGE_KEY, strPayload);
        }

        if (errorMsg) errorMsg.style.display = 'none';
        if (appContainer) appContainer.inert = false;
        if (lockScreen) {
          lockScreen.classList.add('unlocked');
          lockScreen.inert = true;
          setTimeout(() => { lockScreen.style.display = 'none'; }, 320);
        }

        if (!this.dashboardLoaded) {
          this.startDashboard();
        }

        document.getElementById('mainContent')?.focus({ preventScroll: true });
        this.showToast('🔓 Akses Berhasil. Selamat datang di Dashboard Parkee.', 'success');
      } else {
        // Wrong password
        if (errorMsg) errorMsg.style.display = 'flex';
        if (lockCard) {
          lockCard.classList.remove('lock-shake');
          void lockCard.offsetWidth; // trigger reflow
          lockCard.classList.add('lock-shake');
        }
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      }
    };

    if (lockForm) {
      lockForm.onsubmit = (e) => {
        e.preventDefault();
        handleUnlock();
      };
    }

    return false;
  },

  lockDashboard() {
    localStorage.removeItem(this.AUTH_STORAGE_KEY);
    sessionStorage.removeItem(this.AUTH_STORAGE_KEY);
    const appContainer = document.querySelector('.app-container');
    const lockScreen = document.getElementById('appLockScreen');
    const passwordInput = document.getElementById('lockPasswordInput');
    const errorMsg = document.getElementById('lockErrorMsg');
    if (errorMsg) errorMsg.style.display = 'none';
    if (passwordInput) passwordInput.value = '';
    if (appContainer) appContainer.inert = true;
    if (lockScreen) {
      lockScreen.inert = false;
      lockScreen.style.display = 'flex';
      void lockScreen.offsetWidth;
      lockScreen.classList.remove('unlocked');
      setTimeout(() => passwordInput?.focus(), 150);
    }
    this.showToast('🔒 Dashboard berhasil dikunci.', 'info');
  },

  async init() {
    this.initTweaks();
    this.initSidebarToggle();
    this.initNavigation();
    this.initFullscreen();
    this.initModal();

    // Show "Memuat..." placeholders right away (charts, KPIs, tables) until data arrives
    this.applyInitialLoadingUI();

    // Check Authentication Gate before loading data
    const isAuth = this.initLockScreen();
    if (isAuth) {
      await this.startDashboard();
    }
  },

  debounce(fn, delay = 180) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  // =========================================================================
  // LOADING STATES (chart overlay, KPI shimmer, table loading / error rows)
  // =========================================================================
  applyInitialLoadingUI() {
    Object.keys(this.dataStatus).forEach(key => this.setDataStatus(key, 'loading'));
    this.setChartOverlay('loading', 'Memuat data grafik…');
  },

  setDataStatus(key, status) {
    this.dataStatus[key] = status;

    (this.loadingTargets[key] || []).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('is-loading', status === 'loading');
      if (status === 'error') el.textContent = '--';
    });

    if (status !== 'ready') this.paintTableStates(key);
    if (key === 'tickets' || key === 'ticketsFull') this.syncDashboardLoadingUI();
  },

  failLoad(key, label) {
    // Keep showing existing data when a background refresh fails
    if (this.dataStatus[key] === 'ready') return;
    this.setDataStatus(key, 'error');
    this.showToast(`Gagal memuat ${label}. Klik "Coba lagi" untuk mengulang.`, 'error');
  },

  retryLoad(key) {
    const loaders = {
      locations: () => this.fetchLocations(),
      servers: () => this.fetchServers(),
      fleet: () => this.fetchFleet(),
      summary: () => this.fetchSummary(),
      tickets: () => this.fetchTicketsSummary(),
      ticketsFull: () => this.fetchTickets(),
      temperature: () => this.fetchTemperature(),
      backup: () => this.fetchServerBackup()
    };
    const loader = loaders[key];
    if (!loader) return;
    this.setDataStatus(key, 'loading');
    loader();
  },

  getTableColspan(tbody) {
    const table = tbody.closest ? tbody.closest('table') : null;
    const n = table ? table.querySelectorAll('thead th').length : 0;
    return n || 1;
  },

  // Returns true when the table is still loading / failed (caller should stop rendering rows)
  guardTable(tbody) {
    const spec = this.tableLoadSpec[tbody.id];
    if (!spec) return false;

    const failedKey = spec.keys.find(k => this.dataStatus[k] === 'error');
    const isLoading = spec.keys.some(k => this.dataStatus[k] === 'loading');
    if (!failedKey && !isLoading) return false;

    const colspan = this.getTableColspan(tbody);
    if (failedKey) {
      this.setHtml(tbody, `
        <tr class="table-loading-row">
          <td colspan="${colspan}">
            <div class="table-loading-box table-error-box">
              <span>⚠️ Gagal memuat data. Periksa koneksi lalu coba lagi.</span>
              <button type="button" class="btn btn-outline btn-compact-retry" data-action="retry-load" data-retry-key="${this.escapeHtml(failedKey)}">↻ Coba lagi</button>
            </div>
          </td>
        </tr>
      `);
    } else {
      this.setHtml(tbody, `
        <tr class="table-loading-row">
          <td colspan="${colspan}">
            <div class="table-loading-box">
              <span class="loading-spinner"></span>
              <span>${this.escapeHtml(spec.label)}</span>
            </div>
          </td>
        </tr>
      `);
    }

    (spec.labels || []).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = failedKey ? 'Gagal memuat data' : 'Memuat data…';
    });
    return true;
  },

  paintTableStates(key) {
    Object.keys(this.tableLoadSpec).forEach(id => {
      if (!this.tableLoadSpec[id].keys.includes(key)) return;
      const tbody = document.getElementById(id);
      if (tbody) this.guardTable(tbody);
    });
  },

  // state: 'loading' | 'empty' | 'error' | 'hidden'
  setChartOverlay(state, message = '', actionHtml = '') {
    this.chartCanvasIds.forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas || !canvas.parentElement) return;
      const body = canvas.parentElement;
      let overlay = body.querySelector('.chart-loading-overlay');

      if (state === 'hidden') {
        if (overlay) overlay.classList.add('is-hidden');
        return;
      }

      if (!overlay) {
        if (!body.style.position) body.style.position = 'relative';
        overlay = document.createElement('div');
        overlay.className = 'chart-loading-overlay';
        body.appendChild(overlay);
      }
      overlay.classList.remove('is-hidden');
      overlay.classList.toggle('is-error', state === 'error');

      const safeMsg = this.escapeHtml(message);
      if (state === 'loading') {
        this.setHtml(overlay, `<span class="loading-spinner"></span><span>${safeMsg}</span>`);
      } else if (state === 'error') {
        this.setHtml(overlay, `<span>⚠️ ${safeMsg}</span>${actionHtml}`);
      } else {
        this.setHtml(overlay, `<span style="font-size: 1.4rem;" aria-hidden="true">📭</span><span>${safeMsg}</span>`);
      }
    });
  },

  syncDashboardLoadingUI() {
    const { tickets } = this.dataStatus;
    if (tickets === 'loading') {
      this.setChartOverlay('loading', 'Memuat data grafik…');
    } else if (tickets === 'error' && !this.ticketingData) {
      this.setChartOverlay(
        'error',
        'Gagal memuat data tiket.',
        `<button type="button" class="btn btn-outline btn-compact-retry" data-action="retry-load" data-retry-key="tickets">↻ Coba lagi</button>`
      );
    }
    // tickets === 'ready' -> overlay is hidden / switched to "empty" by renderDashboardCharts()
    this.updateDashboardSyncNote();
  },

  updateDashboardSyncNote() {
    const note = document.getElementById('dashSyncNote');
    if (!note) return;
    const { tickets, ticketsFull } = this.dataStatus;
    const hasComplete1mStats = Boolean(this.ticketingData && this.ticketingData.stats_1m);

    if (hasComplete1mStats) {
      note.style.display = 'none';
      return;
    }

    if (ticketsFull === 'error') {
      note.className = 'data-sync-note is-warn';
      this.setHtml(note, `<span>⚠️ Gagal memuat data tiket lengkap — angka &amp; grafik di bawah masih berupa ringkasan.</span>
        <button type="button" class="btn btn-outline btn-compact-retry" data-action="retry-load" data-retry-key="ticketsFull">↻ Coba lagi</button>`);
      note.style.display = 'flex';
    } else if (ticketsFull !== 'ready' && tickets === 'ready') {
      note.className = 'data-sync-note';
      this.setHtml(note, `<span class="loading-spinner loading-spinner-sm"></span>
        <span>Menampilkan ringkasan sementara — memuat data tiket lengkap, angka &amp; grafik akan diperbarui otomatis…</span>`);
      note.style.display = 'flex';
    } else {
      note.style.display = 'none';
    }
  },

  scheduleChartLibraryRetry() {
    if (this._chartLibTimer) return;
    let tries = 0;
    this._chartLibTimer = setInterval(() => {
      tries++;
      if (window.Chart) {
        clearInterval(this._chartLibTimer);
        this._chartLibTimer = null;
        this.renderDashboard();
      } else if (tries >= 20) {
        clearInterval(this._chartLibTimer);
        this._chartLibTimer = null;
        this.setChartOverlay(
          'error',
          'Pustaka grafik gagal dimuat. Periksa koneksi internet.',
          `<button type="button" class="btn btn-outline btn-compact-retry" data-action="reload-page">↻ Muat ulang halaman</button>`
        );
      }
    }, 500);
  },

  async startDashboard() {
    if (this.dashboardLoaded) return;
    this.dashboardLoaded = true;

    this.setupDailyRefreshScheduler();

    // Check precomputed summary fallback
    const hasPrecomputedSummary = Boolean(window.PRECOMPUTED_SUMMARY);
    if (hasPrecomputedSummary) {
      this.summary = window.PRECOMPUTED_SUMMARY;
      this.setDataStatus('summary', 'ready');
      this.renderSummaryKPIs();
    }

    // Ultra-Fast Initial Data Fetch (Under 1.2 MB total vs 11.6 MB)
    const initialTasks = [
      this.fetchLocations(),
      this.fetchServers(),
      this.fetchTemperature(),
      this.fetchTicketsSummary(),
      this.fetchServerBackup()
    ];
    if (!hasPrecomputedSummary) {
      initialTasks.push(this.fetchSummary());
    }
    await Promise.all(initialTasks);

    // Populate total clients badge & pill from summary data immediately without blocking on fleet.json
    const tc = (this.summary && this.summary.total_clients) ? this.summary.total_clients : 6585;
    const clientBadge = document.getElementById('badgeTotalClients');
    if (clientBadge) {
      clientBadge.textContent = tc.toLocaleString();
    }
    const allClientPill = document.querySelector('.filter-pill[data-client-filter="all"]');
    if (allClientPill) {
      allClientPill.textContent = `Semua Klien (${tc.toLocaleString()})`;
    }

    this.initEventHandlers();
    this.initFloatingScrollbar();
    this.renderActiveView();

    // Pre-fetch heavy tickets dataset in background without blocking initial rendering
    setTimeout(() => {
      this.fetchTickets();
    }, 400);
  },

  matchesTier(itemTier, filterTier) {
    if (!filterTier || filterTier === 'all') return true;
    const t = String(itemTier || 'Standard').trim().toLowerCase();
    const f = String(filterTier).trim().toLowerCase();
    if (f === 'standard') {
      return t.includes('standard') || t.includes('unset') || t === '-' || t === '';
    }
    return t === f;
  },

  // =========================================================================
  // DATA FETCHING
  // =========================================================================
  async fetchLocations() {
    if (this.dataStatus.locations !== 'ready') this.setDataStatus('locations', 'loading');
    try {
      const res = await fetch('./data/locations.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.locations = await res.json();
      this.setDataStatus('locations', 'ready');
      const badge = document.getElementById('badgeTotalLocs');
      if (badge) badge.textContent = this.locations.length.toLocaleString();
      if (this.activeView === 'locations') {
        this.renderLocationsTable();
      } else if (this.activeView === 'clients') {
        this.renderAllClientsNationwideTable();
      }
    } catch (e) {
      console.warn('Could not load locations.json', e);
      this.failLoad('locations', 'data lokasi');
    }
  },

  async fetchServers() {
    if (this.dataStatus.servers !== 'ready') this.setDataStatus('servers', 'loading');
    try {
      const res = await fetch('./data/servers.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      // Strict: Only hostnames starting with "server"
      this.servers = raw.filter(d => (d.host || '').toLowerCase().startsWith('server'));
      this.setDataStatus('servers', 'ready');
      const srvCountStr = this.servers.length.toLocaleString();
      const badge = document.getElementById('badgeTotalServers');
      if (badge) badge.textContent = srvCountStr;
      const allSrvPill = document.querySelector('.filter-pill[data-server-filter="all"]');
      if (allSrvPill) allSrvPill.textContent = `Semua Server (${srvCountStr})`;
      const allStoragePill = document.querySelector('.filter-pill[data-storage-filter="all"]');
      if (allStoragePill) allStoragePill.textContent = `Semua Server Storage (${srvCountStr})`;
      this.updateStorageKpisFromServers();
      if (this.activeView === 'servers') {
        this.renderServersTable();
      } else if (this.activeView === 'storage') {
        this.renderStorageTable();
      } else if (this.activeView === 'locations') {
        this.renderLocationsTable();
      }
    } catch (e) {
      console.warn('Could not load servers.json', e);
      this.failLoad('servers', 'data server');
    }
  },

  updateStorageKpisFromServers() {
    if (!this.servers || !this.servers.length) return;
    const totalServersVal = this.servers.length;
    const nvmeVal = this.servers.filter(d => d.ssd_type === 'NVMe').length;
    const sataVal = this.servers.filter(d => d.ssd_type === 'SATA').length;
    const fullVal = this.servers.filter(d => d.ssd_usage !== null && d.ssd_usage !== undefined && d.ssd_usage >= 85).length;
    const lowHealthVal = this.servers.filter(d => d.ssd_health !== null && d.ssd_health !== undefined && d.ssd_health < 70).length;

    const elStorageTotal = document.getElementById('storageKpiTotalDrives');
    const elNvmeRatio = document.getElementById('storageKpiNvmeRatio');
    const elFullCount = document.getElementById('storageKpiFullCount');
    const elLowHealth = document.getElementById('storageKpiLowHealthCount');
    const elSataLabel = document.getElementById('storageKpiSataLabel');
    const elNvmePctMeta = document.getElementById('storageKpiNvmePctMeta');

    if (elStorageTotal) elStorageTotal.textContent = totalServersVal.toLocaleString();
    if (elNvmeRatio) elNvmeRatio.textContent = `${nvmeVal.toLocaleString()} NVMe`;
    if (elFullCount) elFullCount.textContent = fullVal.toLocaleString();
    if (elLowHealth) elLowHealth.textContent = lowHealthVal.toLocaleString();
    if (elSataLabel) elSataLabel.textContent = `vs ${sataVal.toLocaleString()} SATA Server`;
    if (elNvmePctMeta && totalServersVal > 0) {
      elNvmePctMeta.textContent = `${Math.round((nvmeVal / totalServersVal) * 100)}% Armada NVMe`;
    }
  },

  // De-duplicated: concurrent callers share the same in-flight request
  fetchFleet(force = false) {
    if (this._fleetLoaded && !force) return Promise.resolve();
    if (!this._inflight.fleet) {
      this._inflight.fleet = this._loadFleet().finally(() => { delete this._inflight.fleet; });
    }
    return this._inflight.fleet;
  },

  async _loadFleet() {
    if (this.dataStatus.fleet !== 'ready') this.setDataStatus('fleet', 'loading');
    try {
      const res = await fetch('./data/fleet.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.fleet = await res.json();
      this._fleetLoaded = true;
      this.setDataStatus('fleet', 'ready');
      const clients = this.fleet.filter(d => !(d.host || '').toLowerCase().startsWith('server'));
      const clCountStr = clients.length.toLocaleString();
      const badge = document.getElementById('badgeTotalClients');
      if (badge) badge.textContent = clCountStr;
      const allClientPill = document.querySelector('.filter-pill[data-client-filter="all"]');
      if (allClientPill) allClientPill.textContent = `Semua Klien (${clCountStr})`;
      if (this.activeView === 'clients') {
        this.renderAllClientsNationwideTable();
      }
    } catch (e) {
      console.warn('Could not load fleet.json', e);
      this.failLoad('fleet', 'data klien');
    }
  },

  async fetchSummary() {
    if (this.dataStatus.summary !== 'ready') this.setDataStatus('summary', 'loading');
    try {
      const res = await fetch('./data/summary.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.summary = await res.json();
      this.setDataStatus('summary', 'ready');
      this.renderSummaryKPIs();
    } catch (e) {
      console.warn('Could not load summary.json', e);
      this.failLoad('summary', 'ringkasan data');
    }
  },

  renderSummaryKPIs() {
    if (!this.summary) return;
    const s = this.summary;

    const lastSyncLabel = document.getElementById('lastSyncStatusLabel');
    if (lastSyncLabel && s.last_updated) {
      lastSyncLabel.textContent = `Update: ${s.last_updated}`;
    }

    // Storage KPIs
    const elStorageTotal = document.getElementById('storageKpiTotalDrives');
    const elNvmeRatio = document.getElementById('storageKpiNvmeRatio');
    const elFullCount = document.getElementById('storageKpiFullCount');
    const elLowHealth = document.getElementById('storageKpiLowHealthCount');

    const totalServersVal = (this.servers && this.servers.length) ? this.servers.length : (s.total_servers ?? 969);
    const nvmeVal = s.server_nvme_count ?? 543;
    const sataVal = s.server_sata_count ?? Math.max(0, totalServersVal - nvmeVal);
    if (elStorageTotal) elStorageTotal.textContent = totalServersVal.toLocaleString();
    if (elNvmeRatio) elNvmeRatio.textContent = `${nvmeVal.toLocaleString()} NVMe`;
    if (elFullCount) elFullCount.textContent = (s.critical_server_storage_count ?? 0).toLocaleString();
    if (elLowHealth) elLowHealth.textContent = (s.critical_server_ssd_count ?? 7).toLocaleString();
    const elSataLabel = document.getElementById('storageKpiSataLabel');
    const elNvmePctMeta = document.getElementById('storageKpiNvmePctMeta');
    if (elSataLabel) elSataLabel.textContent = `vs ${sataVal.toLocaleString()} SATA Server`;
    if (elNvmePctMeta && totalServersVal > 0) {
      elNvmePctMeta.textContent = `${Math.round((nvmeVal / totalServersVal) * 100)}% Armada NVMe`;
    }

    const allSrvPill = document.querySelector('.filter-pill[data-server-filter="all"]');
    if (allSrvPill) allSrvPill.textContent = `Semua Server (${totalServersVal.toLocaleString()})`;
    const allStoragePill = document.querySelector('.filter-pill[data-storage-filter="all"]');
    if (allStoragePill) allStoragePill.textContent = `Semua Server Storage (${totalServersVal.toLocaleString()})`;
    if (s.total_clients && !this._fleetLoaded) {
      const allClientPill = document.querySelector('.filter-pill[data-client-filter="all"]');
      if (allClientPill) allClientPill.textContent = `Semua Klien (${s.total_clients.toLocaleString()})`;
    }
  },

  // =========================================================================
  // SIDEBAR HIDE / UNHIDE (TOGGLE & COLLAPSE)
  // =========================================================================
  initSidebarToggle() {
    const appContainer = document.querySelector('.app-container');
    const sidebar = document.getElementById('appSidebar');
    const mainContent = document.getElementById('mainContent');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const backdrop = document.getElementById('sidebarBackdrop');

    if (!appContainer || !sidebar) return;

    const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 899px)') : null;
    const isMobileViewport = () => mobileQuery ? mobileQuery.matches : window.innerWidth < 900;

    const syncSidebarA11y = () => {
      const mobile = isMobileViewport();
      if (mobile) {
        const isOpen = sidebar.classList.contains('open');
        sidebar.inert = !isOpen;
        if (mainContent) mainContent.inert = isOpen;
        if (toggleBtn) {
          toggleBtn.setAttribute('aria-expanded', String(isOpen));
          toggleBtn.title = isOpen ? 'Tutup Sidebar' : 'Tampilkan Sidebar (Ctrl+B)';
        }
        if (collapseBtn) collapseBtn.setAttribute('aria-expanded', String(isOpen));
      } else {
        const isCollapsed = appContainer.classList.contains('sidebar-collapsed');
        const expanded = !isCollapsed;
        sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('active');
        sidebar.inert = isCollapsed;
        if (mainContent) mainContent.inert = false;
        if (toggleBtn) {
          toggleBtn.setAttribute('aria-expanded', String(expanded));
          toggleBtn.title = isCollapsed ? 'Tampilkan Sidebar (Ctrl+B)' : 'Sembunyikan Sidebar (Ctrl+B)';
        }
        if (collapseBtn) collapseBtn.setAttribute('aria-expanded', String(expanded));
      }
    };

    const closeMobileDrawer = (restoreFocus = false) => {
      sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('active');
      syncSidebarA11y();
      if (restoreFocus && toggleBtn) toggleBtn.focus();
    };

    // Restore desktop preference from localStorage
    const isSavedCollapsed = localStorage.getItem('parkee_sidebar_collapsed') === 'true';
    if (isSavedCollapsed && !isMobileViewport()) {
      appContainer.classList.add('sidebar-collapsed');
    }
    syncSidebarA11y();

    const toggleSidebar = () => {
      if (isMobileViewport()) {
        const isOpen = sidebar.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('active', isOpen);
        syncSidebarA11y();
        if (isOpen) {
          const firstNav = sidebar.querySelector('.sidebar-nav-btn');
          if (firstNav) firstNav.focus();
        } else if (toggleBtn) {
          toggleBtn.focus();
        }
      } else {
        const isCollapsed = appContainer.classList.toggle('sidebar-collapsed');
        localStorage.setItem('parkee_sidebar_collapsed', isCollapsed ? 'true' : 'false');
        syncSidebarA11y();
        // Notify window resize so floating scrollbars & table geometries re-calculate smoothly
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 180);
      }
    };

    if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
      if (isMobileViewport()) closeMobileDrawer(true);
      else toggleSidebar();
    });

    if (backdrop) {
      backdrop.addEventListener('click', () => closeMobileDrawer(true));
    }

    if (mobileQuery) {
      mobileQuery.addEventListener('change', syncSidebarA11y);
    }

    // Keyboard shortcuts: Escape closes mobile drawer; Ctrl/Cmd + B toggles sidebar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isMobileViewport() && sidebar.classList.contains('open')) {
        e.preventDefault();
        closeMobileDrawer(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        if (this.isTextInputFocused()) return;
        e.preventDefault();
        toggleSidebar();
      }
    });
  },

  // =========================================================================
  // VIEW NAVIGATION & ROUTING
  // =========================================================================
  initNavigation() {
    const navBtns = document.querySelectorAll('.sidebar-nav-btn');
    const topTitle = document.getElementById('topBarTitle');
    const crumbCurrent = document.getElementById('crumbCurrent');
    const mainContent = document.getElementById('mainContent');
    const toggleBtn = document.getElementById('sidebarToggleBtn');

    const metaMap = {
      dashboard: { title: 'Dashboard (1 Bulan Terakhir)', crumb: 'GLPI Assistance Tickets' },
      locations: { title: 'Location Information', crumb: 'Location Information' },
      servers: { title: 'Server Specification', crumb: 'Server Specification' },
      clients: { title: 'Client Specification', crumb: 'Client Specification' },
      storage: { title: 'Storage (Server Only)', crumb: 'Storage Server' },
      temperature: { title: 'Temperature Server (Realtime)', crumb: 'Live Prometheus Telemetry' },
      ticketing: { title: 'Ticketing (GLPI - 3 Bulan Terakhir)', crumb: 'GLPI Assistance Tickets' },
      backup: { title: 'Server Backup (Standby & Auto Promote Telemetry)', crumb: 'High Availability & Standby Fleet' }
    };

    const syncViewVisibility = (activeView) => {
      navBtns.forEach(b => {
        const isCurrent = b.dataset.view === activeView;
        b.classList.toggle('active', isCurrent);
        if (isCurrent) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });

      document.querySelectorAll('.view-section').forEach(sec => {
        const isTarget = sec.id === `view-${activeView}`;
        sec.classList.toggle('active-view', isTarget);
        sec.inert = !isTarget;
      });
    };

    syncViewVisibility(this.activeView || 'dashboard');

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (!view) return;

        syncViewVisibility(view);

        this.activeView = view;
        if (metaMap[view]) {
          if (topTitle) topTitle.textContent = metaMap[view].title;
          if (crumbCurrent) crumbCurrent.textContent = metaMap[view].crumb;
        }

        // Close mobile drawer if open
        const sidebar = document.getElementById('appSidebar');
        if (sidebar) sidebar.classList.remove('open');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (backdrop) backdrop.classList.remove('active');
        if (window.innerWidth < 900) {
          if (sidebar) sidebar.inert = true;
          if (mainContent) mainContent.inert = false;
          if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        }

        this.renderActiveView();
      });
    });
  },

  renderActiveView() {
    if (this.activeView === 'dashboard') {
      this.renderDashboard();
    } else if (this.activeView === 'locations') {
      this.renderLocationsTable();
    } else if (this.activeView === 'servers') {
      this.renderServersTable();
    } else if (this.activeView === 'clients') {
      this.renderAllClientsNationwideTable();
      if (!this._fleetLoaded) {
        this.fetchFleet();
      }
    } else if (this.activeView === 'storage') {
      this.renderStorageTable();
    } else if (this.activeView === 'temperature') {
      this.renderTemperatureTable();
    } else if (this.activeView === 'ticketing') {
      if (!this._fullTicketsLoaded) {
        this.renderTicketingTable();
        this.fetchTickets();
      } else {
        this.renderTicketingTable();
      }
    } else if (this.activeView === 'backup') {
      if (!this._backupLoaded) {
        this.fetchServerBackup();
      } else {
        this.renderBackupTable();
      }
    }
    if (this.updateFloatingScrollbar) {
      this.updateFloatingScrollbar();
    }
  },

  // =========================================================================
  // MODULE 1: LOCATION INFORMATION (10 Columns Requested)
  // =========================================================================
  getFilteredLocations() {
    let list = [...this.locations];

    // Search filter
    if (this.locState.search) {
      const q = this.locState.search.toLowerCase();
      list = list.filter(item =>
        (item.loc && item.loc.toLowerCase().includes(q)) ||
        (item.code && item.code.toLowerCase().includes(q)) ||
        (item.zt && item.zt.toLowerCase().includes(q)) ||
        (item.agent && item.agent.toLowerCase().includes(q)) ||
        (item.fisherman && item.fisherman.toLowerCase().includes(q)) ||
        (item.watersheep && item.watersheep.toLowerCase().includes(q)) ||
        (item.wbo && item.wbo.toLowerCase().includes(q)) ||
        (item.os && item.os.toLowerCase().includes(q))
      );
    }

    // Tier filter
    if (this.locState.tier !== 'all') {
      list = list.filter(item => this.matchesTier(item.tier, this.locState.tier));
    }

    // Specific Filter: RFID Reader
    if (this.locState.reader === 'yes') {
      list = list.filter(item => item.has_reader === true);
    } else if (this.locState.reader === 'no') {
      list = list.filter(item => !item.has_reader);
    }

    // Specific Filter: Suhu Operasional
    if (this.locState.temp === 'cool') {
      list = list.filter(item => (item.server_overheats || 0) === 0 && (item.client_overheats || 0) === 0);
    } else if (this.locState.temp === 'hot') {
      list = list.filter(item => (item.server_overheats || 0) > 0 || (item.client_overheats || 0) > 0);
    }

    // Specific Filter: Status Storage
    if (this.locState.storage === 'low_health') {
      const lowHealthLocs = new Set(this.servers.filter(s => s.ssd_health !== null && s.ssd_health < 70).map(s => (s.loc || '').toLowerCase()));
      list = list.filter(item => item.loc && lowHealthLocs.has(item.loc.toLowerCase()));
    } else if (this.locState.storage === 'full_storage') {
      const fullStorageLocs = new Set(this.servers.filter(s => s.ssd_usage !== null && s.ssd_usage >= 85).map(s => (s.loc || '').toLowerCase()));
      list = list.filter(item => item.loc && fullStorageLocs.has(item.loc.toLowerCase()));
    }

    return list;
  },

  renderLocationsTable() {
    const tbody = document.getElementById('locationsTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) return;

    let list = this.getFilteredLocations();

    // Sort
    list = this.sortData(list, this.locState.sortCol, this.locState.sortDir === 'asc' ? 1 : -1);
    this.updateSortIndicators('#view-locations', 'data-loc-sort', this.locState.sortCol, this.locState.sortDir);

    // Update counter
    const countLabel = document.getElementById('locResultCountLabel');
    if (countLabel) countLabel.textContent = `Menampilkan ${list.length.toLocaleString()} Lokasi`;

    // Pagination
    const totalPages = Math.ceil(list.length / this.locState.pageSize) || 1;
    if (this.locState.page > totalPages) this.locState.page = totalPages;
    if (this.locState.page < 1) this.locState.page = 1;

    const startIdx = (this.locState.page - 1) * this.locState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + this.locState.pageSize);

    // Update pagination labels
    const pageLabel = document.getElementById('locCurrentPageLabel');
    if (pageLabel) pageLabel.textContent = `Halaman ${this.locState.page} / ${totalPages}`;
    const tableCount = document.getElementById('locTableCountLabel');
    if (tableCount) tableCount.textContent = `Menampilkan ${list.length === 0 ? 0 : startIdx + 1}-${Math.min(startIdx + this.locState.pageSize, list.length)} dari ${list.length.toLocaleString()} lokasi`;

    const prevBtn = document.getElementById('locPrevPageBtn');
    const nextBtn = document.getElementById('locNextPageBtn');
    if (prevBtn) prevBtn.disabled = this.locState.page <= 1;
    if (nextBtn) nextBtn.disabled = this.locState.page >= totalPages;

    if (pageItems.length === 0) {
      this.setHtml(tbody, `<tr><td colspan="10" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada lokasi yang cocok dengan filter.</td></tr>`);
      return;
    }

    const rowsHtml = pageItems.map(item => {
      const tierRaw = item.tier || 'Standard';
      const tierLower = tierRaw.toLowerCase();
      const tierClass = tierLower === 'diamond' ? 'tier-diamond' : (tierLower === 'gold' ? 'tier-gold' : 'tier-silver');
      const eLoc = this.escapeHtml(item.loc || '-');
      const eCode = this.escapeHtml(item.code || '-');
      const eCodeAttr = this.escapeHtml(item.code || '');
      const eTier = this.escapeHtml(tierRaw);
      const eZt = this.escapeHtml(item.zt || '-');
      const eSync = this.escapeHtml(item.last_sync || '-');
      const eAgent = this.escapeHtml(this.formatFullVersion(item.agent));
      const eFish = this.escapeHtml(this.formatVersion(item.fisherman));
      const eWater = this.escapeHtml(this.formatVersion(item.watersheep));
      const eWbo = this.escapeHtml(this.formatVersion(item.wbo));
      const eOs = this.escapeHtml(this.formatOs(item.os));
      const eOsTitle = this.escapeHtml(item.os || '');
      const eLocAttr = this.escapeHtml(item.loc || '');

      return `
        <tr class="clickable-row" tabindex="0" role="button" aria-label="Buka detail lokasi ${eLoc}" title="Klik baris untuk melihat detail lengkap lokasi ${eLoc}" data-action="open-location-modal" data-loc="${eLocAttr}" data-code="${eCodeAttr}">
          <td>
            <div class="row-primary-title" style="font-weight: 700; color: var(--text-main); font-size: 0.875rem;">${eLoc}</div>
            <div style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
              <span style="font-size: 0.72rem; color: var(--text-muted);">${Number(item.total_clients || 0).toLocaleString()} Klien</span>
              ${item.has_reader ? '<span class="version-code-tag" style="color: var(--color-success); font-weight: 700; font-size: 0.65rem; padding: 1px 4px;">✓ Reader PARKEE</span>' : ''}
            </div>
          </td>
          <td>
            <span class="version-code-tag">${eCode}</span>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${eTier}</span>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--accent-primary);">
              ${eZt}
            </span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); white-space: nowrap;">
            ${eSync}
          </td>
          <td>
            <span class="version-code-tag" style="white-space: nowrap;">${eAgent}</span>
          </td>
          <td>
            <span class="version-code-tag">${eFish}</span>
          </td>
          <td>
            <span class="version-code-tag">${eWater}</span>
          </td>
          <td>
            <span class="version-code-tag">${eWbo}</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eOsTitle}">
            ${eOs}
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  jumpToClientSpec(locName) {
    this.selectedLocation = locName;
    this.allClientsState.search = locName;
    this.allClientsState.page = 1;
    const searchInput = document.getElementById('allClientsSearchInput');
    if (searchInput) searchInput.value = locName;
    const clientNavBtn = document.querySelector('.sidebar-nav-btn[data-view="clients"]');
    if (clientNavBtn) clientNavBtn.click();
    if (this._fleetLoaded) {
      this.renderAllClientsNationwideTable();
    }
  },

  jumpToServerSpec(locName) {
    this.serverState.search = locName;
    this.serverState.page = 1;
    const searchInput = document.getElementById('serverSearchInput');
    if (searchInput) searchInput.value = locName;
    const srvNavBtn = document.querySelector('.sidebar-nav-btn[data-view="servers"]');
    if (srvNavBtn) srvNavBtn.click();
    this.renderServersTable();
  },

  // =========================================================================
  // MODULE 2: SERVER SPECIFICATION (Data Lengkap Server)
  // =========================================================================
  getFilteredServers() {
    let list = this.servers.filter(d => (d.host || '').toLowerCase().startsWith('server'));

    // Filter by Condition (overheat, low_ssd, full_storage)
    if (this.serverState.filter === 'overheat') {
      list = list.filter(d => d.temp !== null && d.temp >= 80);
    } else if (this.serverState.filter === 'low_ssd') {
      list = list.filter(d => d.ssd_health !== null && d.ssd_health < 70);
    } else if (this.serverState.filter === 'full_storage') {
      list = list.filter(d => d.ssd_usage !== null && d.ssd_usage >= 85);
    }

    // Filter by Tier
    if (this.serverState.tier !== 'all') {
      list = list.filter(d => this.matchesTier(d.tier, this.serverState.tier));
    }

    // Specific Filter: CPU
    if (this.serverState.cpu !== 'all') {
      const qCpu = this.serverState.cpu.toLowerCase();
      list = list.filter(d => d.cpu && d.cpu.toLowerCase().includes(qCpu));
    }

    // Specific Filter: Motherboard
    if (this.serverState.mb !== 'all') {
      const qMb = this.serverState.mb.toLowerCase();
      list = list.filter(d =>
        (d.mb && d.mb.toLowerCase().includes(qMb)) ||
        (d.mb_brand && d.mb_brand.toLowerCase().includes(qMb))
      );
    }

    // Specific Filter: RAM
    if (this.serverState.ram !== 'all') {
      list = list.filter(d => {
        const val = this.parseRamGb(d.ram);
        if (this.serverState.ram === '4g') return val > 0 && val <= 4.5;
        if (this.serverState.ram === '8g') return val > 4.5 && val <= 10;
        if (this.serverState.ram === '16g') return val > 10 && val <= 20;
        if (this.serverState.ram === '32g') return val > 20;
        return true;
      });
    }

    // Specific Filter: SSD Type
    if (this.serverState.ssdType !== 'all') {
      list = list.filter(d => d.ssd_type && d.ssd_type.toLowerCase() === this.serverState.ssdType.toLowerCase());
    }

    // Specific Filter: SSD Brand
    if (this.serverState.ssdBrand !== 'all') {
      const qBrand = this.serverState.ssdBrand.toLowerCase();
      list = list.filter(d => d.ssd_brand && d.ssd_brand.toLowerCase().includes(qBrand));
    }

    // Specific Filter: SSD Size
    if (this.serverState.ssdSize !== 'all') {
      const qSize = this.serverState.ssdSize;
      list = list.filter(d => {
        const sz = (d.ssd_size || '').toLowerCase();
        if (qSize === '128') return sz.includes('120') || sz.includes('128') || sz.includes('119');
        if (qSize === '256') return sz.includes('240') || sz.includes('250') || sz.includes('256') || sz.includes('238');
        if (qSize === '512') return sz.includes('480') || sz.includes('500') || sz.includes('512') || sz.includes('476') || sz.includes('465');
        if (qSize === '1t') return sz.includes('931') || sz.includes('960') || sz.includes('1000') || sz.includes('1t') || sz.includes('1.0t') || sz.includes('1tb');
        if (qSize === '2t') return sz.includes('1.8') || sz.includes('1.9') || sz.includes('2000') || sz.includes('2t') || sz.includes('2tb');
        return true;
      });
    }

    // Specific Filter: Temp Range
    if (this.serverState.tempRange !== 'all') {
      list = list.filter(d => {
        if (d.temp === null || d.temp === undefined) return false;
        if (this.serverState.tempRange === 'cool') return d.temp < 50;
        if (this.serverState.tempRange === 'normal') return d.temp >= 50 && d.temp < 70;
        if (this.serverState.tempRange === 'warm') return d.temp >= 70 && d.temp < 80;
        if (this.serverState.tempRange === 'hot') return d.temp >= 80 && d.temp < 90;
        if (this.serverState.tempRange === 'critical') return d.temp >= 90;
        return true;
      });
    }

    // Specific Filter: SSD Health Range
    if (this.serverState.healthRange !== 'all') {
      list = list.filter(d => {
        if (d.ssd_health === null || d.ssd_health === undefined) return false;
        if (this.serverState.healthRange === 'pristine') return d.ssd_health >= 95;
        if (this.serverState.healthRange === 'good') return d.ssd_health >= 80 && d.ssd_health < 95;
        if (this.serverState.healthRange === 'warning') return d.ssd_health >= 70 && d.ssd_health < 80;
        if (this.serverState.healthRange === 'degraded') return d.ssd_health < 70;
        return true;
      });
    }

    // Specific Filter: Disk Usage Range
    if (this.serverState.usageRange !== 'all') {
      list = list.filter(d => {
        if (d.ssd_usage === null || d.ssd_usage === undefined) return false;
        if (this.serverState.usageRange === 'plenty') return d.ssd_usage < 50;
        if (this.serverState.usageRange === 'moderate') return d.ssd_usage >= 50 && d.ssd_usage < 70;
        if (this.serverState.usageRange === 'high') return d.ssd_usage >= 70 && d.ssd_usage < 85;
        if (this.serverState.usageRange === 'critical') return d.ssd_usage >= 85;
        return true;
      });
    }

    // Search filter
    if (this.serverState.search) {
      const q = this.serverState.search.toLowerCase();
      list = list.filter(d =>
        (d.loc && d.loc.toLowerCase().includes(q)) ||
        (d.code && d.code.toLowerCase().includes(q)) ||
        (d.host && d.host.toLowerCase().includes(q)) ||
        (d.cpu && d.cpu.toLowerCase().includes(q)) ||
        (d.mb && d.mb.toLowerCase().includes(q)) ||
        (d.ram && d.ram.toLowerCase().includes(q)) ||
        (d.ip && d.ip.toLowerCase().includes(q)) ||
        (d.zt && d.zt.toLowerCase().includes(q))
      );
    }

    return list;
  },

  renderServersTable() {
    const tbody = document.getElementById('serversTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) return;

    let list = this.getFilteredServers();

    // Sort
    list = this.sortData(list, this.serverState.sortCol, this.serverState.sortDir === 'asc' ? 1 : -1);
    this.updateSortIndicators('#view-servers', 'data-srv-sort', this.serverState.sortCol, this.serverState.sortDir);

    const countLabel = document.getElementById('serverResultCountLabel');
    if (countLabel) countLabel.textContent = `Menampilkan ${list.length.toLocaleString()} Server`;

    // Pagination
    const totalPages = Math.ceil(list.length / this.serverState.pageSize) || 1;
    if (this.serverState.page > totalPages) this.serverState.page = totalPages;
    if (this.serverState.page < 1) this.serverState.page = 1;

    const startIdx = (this.serverState.page - 1) * this.serverState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + this.serverState.pageSize);

    const pageLabel = document.getElementById('serverCurrentPageLabel');
    if (pageLabel) pageLabel.textContent = `Halaman ${this.serverState.page} / ${totalPages}`;
    const tableCount = document.getElementById('serverTableCountLabel');
    if (tableCount) tableCount.textContent = `Menampilkan ${list.length === 0 ? 0 : startIdx + 1}-${Math.min(startIdx + this.serverState.pageSize, list.length)} dari ${list.length.toLocaleString()} server`;

    const prevBtn = document.getElementById('serverPrevPageBtn');
    const nextBtn = document.getElementById('serverNextPageBtn');
    if (prevBtn) prevBtn.disabled = this.serverState.page <= 1;
    if (nextBtn) nextBtn.disabled = this.serverState.page >= totalPages;

    if (pageItems.length === 0) {
      this.setHtml(tbody, `<tr><td colspan="13" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada server yang cocok.</td></tr>`);
      return;
    }

    const rowsHtml = pageItems.map(d => {
      const tierRaw = d.tier || 'Standard';
      const tierLower = tierRaw.toLowerCase();
      const tierClass = tierLower === 'diamond' ? 'tier-diamond' : (tierLower === 'gold' ? 'tier-gold' : 'tier-silver');

      let tempClass = 'temp-cool';
      if (d.temp !== null) {
        if (d.temp >= 80) tempClass = 'temp-hot';
        else if (d.temp >= 70) tempClass = 'temp-warm';
        else if (d.temp >= 50) tempClass = 'temp-normal';
      }

      let healthClass = 'health-good';
      if (d.ssd_health !== null && d.ssd_health < 70) healthClass = 'health-bad';
      else if (d.ssd_health !== null && d.ssd_health < 80) healthClass = 'health-warn';

      const ssdBrandFormatted = this.formatBrand(d.ssd_brand);
      const ssdSizeFormatted = this.formatSize(d.ssd_size);
      const ssdTypeTag = (d.ssd_type && d.ssd_type !== '-') ? `<span class="version-code-tag" style="font-size: 0.65rem;">${this.escapeHtml(d.ssd_type)}</span>` : '';

      const eLoc = this.escapeHtml(d.loc || '-');
      const eLocAttr = this.escapeHtml(d.loc || '');
      const eCode = this.escapeHtml(d.code || '-');
      const eCodeAttr = this.escapeHtml(d.code || '');
      const eTier = this.escapeHtml(tierRaw);
      const eHost = this.escapeHtml(d.host || '-');
      const eHostAttr = this.escapeHtml(d.host || '');
      const eIp = this.escapeHtml(d.ip || '-');
      const eZt = this.escapeHtml(d.zt || '-');
      const eCpuTitle = this.escapeHtml(d.cpu || '');
      const eCpu = this.escapeHtml(this.formatCpu(d.cpu));
      const eRam = this.escapeHtml(this.formatRam(d.ram, d.ram_brand));
      const eMbTitle = this.escapeHtml(d.mb || '');
      const eMb = this.escapeHtml(this.formatMb(d.mb, d.mb_brand));
      const eSsdBrand = this.escapeHtml(ssdBrandFormatted);
      const eSsdSize = this.escapeHtml(ssdSizeFormatted);
      const eOsTitle = this.escapeHtml(d.os || '');
      const eOs = this.escapeHtml(this.formatOs(d.os));

      return `
        <tr class="clickable-row" tabindex="0" role="button" aria-label="Buka detail server ${eHost} (${eLoc})" title="Klik baris untuk melihat detail spesifikasi server ${eHost}" data-action="open-server-modal" data-host="${eHostAttr}" data-code="${eCodeAttr}" data-loc="${eLocAttr}">
          <td>
            <div class="row-primary-title" style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${eLoc}</div>
            <span class="version-code-tag">${eCode}</span>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${eTier}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.85rem;">
              ${eHost}
            </div>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-main);">${eIp}</div>
            <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">ZT: ${eZt}</div>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-main); min-width: 180px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eCpuTitle}">
            ${eCpu}
          </td>
          <td style="font-size: 0.78rem; font-weight: 600; color: var(--text-main);">
            ${eRam}
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); min-width: 150px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eMbTitle}">
            ${eMb}
          </td>
          <td>
            <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-main);">${eSsdBrand}</div>
            ${ssdBrandFormatted !== '-' ? ssdTypeTag : ''}
          </td>
          <td style="font-size: 0.78rem; font-weight: 600; color: var(--text-main); font-family: var(--font-mono);">
            ${eSsdSize}
          </td>
          <td>
            ${d.temp !== null && d.temp !== undefined ? `<span class="temp-badge ${tempClass}" style="font-weight: 700;">${this.escapeHtml(d.temp)}°C</span>` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td>
            ${d.ssd_health !== null && d.ssd_health !== undefined ? `<span class="ssd-health-pill ${healthClass}">${this.escapeHtml(d.ssd_health)}%</span>` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td>
            ${d.ssd_usage !== null && d.ssd_usage !== undefined ? `<div style="font-size: 0.75rem; font-weight: 600; color: ${d.ssd_usage >= 85 ? 'var(--color-danger)' : 'var(--text-main)'};">${this.escapeHtml(d.ssd_usage)}%</div>` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td style="font-size: 0.72rem; color: var(--text-muted); max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eOsTitle}">
            ${eOs}
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  openNativeModal(modal) {
    if (!modal) return;
    this._lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof modal.showModal === 'function') {
      if (!modal.open) modal.showModal();
    } else {
      modal.setAttribute('open', '');
    }
  },

  closeNativeModal(modal) {
    if (!modal) return;
    if (typeof modal.close === 'function') {
      if (modal.open) modal.close();
    } else {
      modal.removeAttribute('open');
    }
    if (this._lastFocusedEl && typeof this._lastFocusedEl.focus === 'function' && document.contains(this._lastFocusedEl)) {
      this._lastFocusedEl.focus({ preventScroll: true });
      this._lastFocusedEl = null;
    }
  },

  setDeviceModalFooter(lastSyncText, summaryText, extraButtonsHtml = '') {
    const syncEl = document.getElementById('modalDeviceLastSync');
    if (syncEl) syncEl.textContent = lastSyncText || '-';
    this._activeModalDeviceSummary = summaryText || '';
    const actionsEl = document.getElementById('modalDeviceActions');
    if (actionsEl) {
      this.setHtml(actionsEl, `
        <button type="button" data-action="copy-device-modal" class="btn btn-outline" style="font-size: 0.76rem; padding: 5px 12px; display: inline-flex; align-items: center; gap: 6px;">
          <span aria-hidden="true">📋</span>
          <span>Salin Ringkasan</span>
        </button>
        ${extraButtonsHtml}
        <button type="button" data-action="close-device-modal" class="btn btn-outline" style="font-size: 0.76rem; padding: 5px 12px;">
          Tutup
        </button>
      `);
    }
  },

  copyDeviceModalSummary() {
    if (!this._activeModalDeviceSummary) return;
    const text = this._activeModalDeviceSummary;
    const onSuccess = () => this.showToast('Ringkasan detail berhasil disalin ke clipboard!', 'success');
    const onError = () => this.showToast('Gagal menyalin ringkasan ke clipboard', 'warn');

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        if (this.legacyCopyText(text)) onSuccess();
        else onError();
      });
    } else if (this.legacyCopyText(text)) {
      onSuccess();
    } else {
      onError();
    }
  },

  openLocationDetailModal(locName, locCode) {
    const qCode = (locCode || '').trim().toLowerCase();
    const qLoc = (locName || '').trim().toLowerCase();
    const item = this.locations.find(l =>
      (qCode && (l.code || '').toLowerCase() === qCode) ||
      (qLoc && (l.loc || '').toLowerCase() === qLoc)
    );
    if (!item) return;

    const srv = this.servers.find(s =>
      (item.code && (s.code || '').toLowerCase() === item.code.toLowerCase()) ||
      (item.loc && (s.loc || '').toLowerCase() === item.loc.toLowerCase())
    );
    const liveTemp = (this.temperatureData && Array.isArray(this.temperatureData.servers))
      ? this.temperatureData.servers.find(t =>
          (item.code && (t.code || '').toLowerCase() === item.code.toLowerCase()) ||
          (item.loc && (t.loc || '').toLowerCase() === item.loc.toLowerCase())
        )
      : null;

    const modal = document.getElementById('deviceDetailModal');
    const title = document.getElementById('modalDeviceTitle');
    const body = document.getElementById('modalDeviceBody');

    if (title) title.textContent = `Detail Lokasi: ${item.loc || '-'}`;

    const fullOs = this.formatFullOs(item.os || srv?.os);
    const fullAgent = this.formatFullVersion(item.agent || srv?.agent);
    const fullFish = this.formatFullVersion(item.fisherman || srv?.fisherman);
    const fullWater = this.formatFullVersion(item.watersheep || srv?.watersheep);
    const fullWbo = this.formatFullVersion(item.wbo || srv?.wbo);
    const syncTime = item.last_sync || srv?.sync || '-';
    const totalDevs = Number(item.total_devs || 0);
    const totalSrvs = Number(item.total_servers || 0);
    const totalClients = Number(item.total_clients || 0);
    const srvOverheat = Number(item.server_overheats || 0);
    const clOverheat = Number(item.client_overheats || 0);
    const tempDisplay = liveTemp && liveTemp.temp != null
      ? `${Number(liveTemp.temp).toFixed(1)}°C (Live Prometheus)`
      : (srv && srv.temp != null ? `${srv.temp}°C` : '-');

    if (body) {
      this.setHtml(body, `
        <div class="modal-spec-item">
          <span class="modal-spec-label">Nama Lokasi</span>
          <span class="modal-spec-val">${this.escapeHtml(item.loc || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Unique Code / Tier</span>
          <span class="modal-spec-val">${this.escapeHtml(item.code || '-')} · ${this.escapeHtml(item.tier || 'Standard')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP ZeroTier Lokasi</span>
          <span class="modal-spec-val mono">${this.escapeHtml(item.zt || srv?.zt || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP Local Server</span>
          <span class="modal-spec-val mono">${this.escapeHtml(srv?.ip || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Populasi Perangkat</span>
          <span class="modal-spec-val">${totalDevs.toLocaleString()} Unit (${totalSrvs.toLocaleString()} Server · ${totalClients.toLocaleString()} Klien)</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Status Reader PARKEE</span>
          <span class="modal-spec-val" style="color: ${item.has_reader ? 'var(--color-success)' : 'var(--text-muted)'}; font-weight: 700;">
            ${item.has_reader ? '✓ Sudah Ada Reader PARKEE' : '✕ Belum Ada Reader PARKEE'}
          </span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Agent Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullAgent)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Fisherman Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullFish)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Watersheep Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullWater)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">WBO Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullWbo)}</span>
        </div>
        <div class="modal-spec-item full-width">
          <span class="modal-spec-label">Sistem Operasi / OS Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullOs)}</span>
        </div>
        <div class="modal-spec-item full-width">
          <span class="modal-spec-label">Kondisi Termal &amp; Suhu Operasional</span>
          <span class="modal-spec-val">
            Suhu Server: <strong>${this.escapeHtml(tempDisplay)}</strong> · Server Overheat: <strong style="color: ${srvOverheat > 0 ? 'var(--color-danger)' : 'var(--color-success)'};">${srvOverheat}</strong> · Klien Overheat: <strong style="color: ${clOverheat > 0 ? 'var(--color-danger)' : 'var(--color-success)'};">${clOverheat}</strong>
          </span>
        </div>
        ${srv ? this.buildPrimarySpecBlockHtml(srv, { label: `Spesifikasi Utama (${srv.host || 'Server'})`, targetId: 'modalPrimarySpecText' }) : ''}
      `);
    }

    const summaryText = `[PARKEE LOCATION DETAIL]
Lokasi: ${item.loc || '-'} (${item.code || '-'} / ${item.tier || 'Standard'})
IP ZeroTier: ${item.zt || srv?.zt || '-'}
IP Local Server: ${srv?.ip || '-'}
Last Sync: ${syncTime}
OS Version: ${fullOs}
Agent: ${fullAgent}
Fisherman: ${fullFish}
Watersheep: ${fullWater}
WBO: ${fullWbo}
Total Perangkat: ${totalDevs} (${totalSrvs} Server, ${totalClients} Klien)
Reader PARKEE: ${item.has_reader ? 'Ada' : 'Belum Ada'}`;

    const eLocAttr = this.escapeHtml(item.loc || '');
    const extraBtns = `
      <button type="button" class="btn btn-outline" data-action="modal-jump-server" data-loc="${eLocAttr}" style="font-size: 0.76rem; padding: 5px 12px;">
        🖧 Lihat Server
      </button>
      <button type="button" class="btn btn-primary" data-action="modal-jump-clients" data-loc="${eLocAttr}" style="font-size: 0.76rem; padding: 5px 12px;">
        🖥️ Lihat Klien (${totalClients.toLocaleString()}) ➜
      </button>
    `;
    this.setDeviceModalFooter(syncTime, summaryText, extraBtns);
    this.openNativeModal(modal);
  },

  openClientDetailModal(hostname, locName = '', ipAddr = '') {
    const qHost = (hostname || '').trim();
    const qLoc = (locName || '').trim().toLowerCase();
    const qIp = (ipAddr || '').trim();
    const dev = this.fleet.find(d =>
      d.host === qHost &&
      (!qLoc || (d.loc || '').toLowerCase() === qLoc) &&
      (!qIp || d.ip === qIp)
    ) || this.fleet.find(d => d.host === qHost) || this.servers.find(d => d.host === qHost);
    if (!dev) return;

    const modal = document.getElementById('deviceDetailModal');
    const title = document.getElementById('modalDeviceTitle');
    const body = document.getElementById('modalDeviceBody');

    if (title) title.textContent = `Detail Klien: ${dev.host} · ${dev.loc}`;

    const hasReader = Boolean(dev.reader_ver || dev.reader_sn);
    const readerStatusText = hasReader ? `Terkoneksi (Firmware: ${dev.reader_ver || '-'}, SN: ${dev.reader_sn || '-'})` : 'Belum Terpasang';
    const fullOs = this.formatFullOs(dev.os);
    const fullAgent = this.formatFullVersion(dev.agent);
    const primarySpecText = this.formatPrimarySpecText(dev);

    if (body) {
      this.setHtml(body, `
        <div class="modal-spec-item">
          <span class="modal-spec-label">Nama Lokasi</span>
          <span class="modal-spec-val">${this.escapeHtml(dev.loc || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Unique Code / Tier</span>
          <span class="modal-spec-val">${this.escapeHtml(dev.code || '-')} · ${this.escapeHtml(dev.tier || 'Standard')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Hostname</span>
          <span class="modal-spec-val mono">${this.escapeHtml(dev.host)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Versi Agent (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullAgent)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP Local</span>
          <span class="modal-spec-val mono">${this.escapeHtml(dev.ip || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP ZeroTier</span>
          <span class="modal-spec-val mono">${this.escapeHtml(dev.zt || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Suhu Operasional</span>
          <span class="modal-spec-val ${dev.temp !== null && dev.temp !== undefined && dev.temp >= 80 ? 'temp-hot' : ''}" style="display:inline-block;">${dev.temp !== null && dev.temp !== undefined ? this.escapeHtml(dev.temp) + '°C' : '-'}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Reader PARKEE</span>
          <span class="modal-spec-val" style="color: ${hasReader ? 'var(--color-success)' : 'var(--text-muted)'}; font-weight: 700;">
            ${hasReader ? '✓ ' : '✕ '}${this.escapeHtml(readerStatusText)}
          </span>
        </div>
        ${this.buildPrimarySpecBlockHtml(dev, { label: 'Spesifikasi Utama', targetId: 'modalPrimarySpecText' })}
        <div class="modal-spec-item full-width">
          <span class="modal-spec-label">Sistem Operasi / OS Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullOs)}</span>
        </div>
      `);
    }

    const summaryText = `[PARKEE CLIENT DETAIL]
Lokasi: ${dev.loc || '-'} (${dev.code || '-'} / ${dev.tier || 'Standard'})
Hostname: ${dev.host || '-'}
IP Local: ${dev.ip || '-'} | IP ZT: ${dev.zt || '-'}
Agent: ${fullAgent}
Reader PARKEE: ${readerStatusText}
${primarySpecText}${dev.ssd_usage !== null && dev.ssd_usage !== undefined ? `\nDisk Usage: ${dev.ssd_usage}%` : ''}
Suhu: ${dev.temp != null ? dev.temp + '°C' : '-'}
OS Version: ${fullOs}
Last Sync: ${dev.sync || '-'}`;

    this.setDeviceModalFooter(dev.sync || '-', summaryText);
    this.openNativeModal(modal);
  },

  openServerDetailModal(hostname, code = '', locName = '') {
    const qHost = (hostname || '').trim();
    const qCode = (code || '').trim().toLowerCase();
    const qLoc = (locName || '').trim().toLowerCase();

    const srv = this.servers.find(d =>
      (qHost && d.host === qHost && (!qCode || (d.code || '').toLowerCase() === qCode))
    ) || this.servers.find(d =>
      (qHost && d.host === qHost) ||
      (qCode && (d.code || '').toLowerCase() === qCode) ||
      (qLoc && (d.loc || '').toLowerCase() === qLoc)
    ) || this.fleet.find(d => qHost && d.host === qHost);

    const liveTemp = (this.temperatureData && Array.isArray(this.temperatureData.servers))
      ? this.temperatureData.servers.find(t =>
          (qHost && t.host === qHost) ||
          (qCode && (t.code || '').toLowerCase() === qCode) ||
          (qLoc && (t.loc || '').toLowerCase() === qLoc)
        )
      : null;

    const dev = srv || liveTemp;
    if (!dev) return;

    const locObj = this.locations.find(l =>
      (dev.code && (l.code || '').toLowerCase() === (dev.code || '').toLowerCase()) ||
      (dev.loc && (l.loc || '').toLowerCase() === (dev.loc || '').toLowerCase())
    );

    const modal = document.getElementById('deviceDetailModal');
    const title = document.getElementById('modalDeviceTitle');
    const body = document.getElementById('modalDeviceBody');

    const dispLoc = dev.loc || locObj?.loc || '-';
    const dispCode = dev.code || locObj?.code || '-';
    const dispTier = dev.tier || locObj?.tier || 'Standard';
    const dispHost = dev.host || '-';

    if (title) title.textContent = `Detail Server: ${dispHost} · ${dispLoc}`;

    const specSource = srv || dev;
    const fullOs = this.formatFullOs(dev.os || locObj?.os);
    const primarySpecText = this.formatPrimarySpecText(specSource);
    const fullAgent = this.formatFullVersion(dev.agent || locObj?.agent);
    const fullFish = this.formatFullVersion(dev.fisherman || locObj?.fisherman);
    const fullWater = this.formatFullVersion(dev.watersheep || locObj?.watersheep);
    const fullWbo = this.formatFullVersion(dev.wbo || locObj?.wbo);
    const tempVal = (liveTemp && liveTemp.temp != null) ? Number(liveTemp.temp).toFixed(1) : (dev.temp != null ? dev.temp : null);
    const syncTime = dev.sync || locObj?.last_sync || (this.temperatureData?.updated_at) || '-';

    if (body) {
      this.setHtml(body, `
        <div class="modal-spec-item">
          <span class="modal-spec-label">Nama Lokasi</span>
          <span class="modal-spec-val">${this.escapeHtml(dispLoc)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Unique Code / Tier</span>
          <span class="modal-spec-val">${this.escapeHtml(dispCode)} · ${this.escapeHtml(dispTier)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Hostname</span>
          <span class="modal-spec-val mono">${this.escapeHtml(dispHost)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Suhu Operasional</span>
          <span class="modal-spec-val ${tempVal !== null && Number(tempVal) >= 80 ? 'temp-hot' : ''}" style="display:inline-block;">
            ${tempVal !== null ? `${this.escapeHtml(tempVal)}°C` : '-'}
            ${liveTemp && liveTemp.status ? ` (${this.escapeHtml(liveTemp.status.toUpperCase())})` : ''}
          </span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP Local</span>
          <span class="modal-spec-val mono">${this.escapeHtml(srv?.ip || dev.ip || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP ZeroTier</span>
          <span class="modal-spec-val mono">${this.escapeHtml(srv?.zt || locObj?.zt || dev.ip || '-')}</span>
        </div>
        ${this.buildPrimarySpecBlockHtml(specSource, { label: 'Spesifikasi Utama', targetId: 'modalPrimarySpecText' })}
        <div class="modal-spec-item full-width">
          <span class="modal-spec-label">Sistem Operasi / OS Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullOs)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Agent Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullAgent)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Fisherman Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullFish)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Watersheep Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullWater)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">WBO Version (Lengkap)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(fullWbo)}</span>
        </div>
      `);
    }

    const summaryText = `[PARKEE SERVER DETAIL]
Lokasi: ${dispLoc} (${dispCode} / ${dispTier})
Hostname: ${dispHost}
IP Local: ${srv?.ip || dev.ip || '-'} | IP ZT: ${srv?.zt || locObj?.zt || dev.ip || '-'}
${primarySpecText}${specSource?.ssd_usage !== null && specSource?.ssd_usage !== undefined ? `\nDisk Usage: ${specSource.ssd_usage}%` : ''}
Suhu: ${tempVal !== null ? tempVal + '°C' : '-'}
OS Version: ${fullOs}
Agent: ${fullAgent} | Fisherman: ${fullFish} | Watersheep: ${fullWater} | WBO: ${fullWbo}
Last Sync: ${syncTime}`;

    const eLocAttr = this.escapeHtml(dispLoc !== '-' ? dispLoc : '');
    const extraBtns = eLocAttr ? `
      <button type="button" class="btn btn-primary" data-action="modal-jump-clients" data-loc="${eLocAttr}" style="font-size: 0.76rem; padding: 5px 12px;">
        🖥️ Lihat Klien Lokasi Ini ➜
      </button>
    ` : '';
    this.setDeviceModalFooter(syncTime, summaryText, extraBtns);
    this.openNativeModal(modal);
  },

  openBackupDetailModal(code, locName) {
    const qCode = (code || '').trim().toLowerCase();
    const qLoc = (locName || '').trim().toLowerCase();
    const item = this.serverBackup.find(b =>
      (qCode && (b.code || '').toLowerCase() === qCode) ||
      (qLoc && (b.loc || '').toLowerCase() === qLoc)
    );
    if (!item) return;

    const modal = document.getElementById('deviceDetailModal');
    const title = document.getElementById('modalDeviceTitle');
    const body = document.getElementById('modalDeviceBody');

    if (title) title.textContent = `Detail Server Backup: ${item.loc || '-'}`;

    const fullNotes = item.notes || item.note_col_s || '-';
    const connNote = item.conn_note || '-';

    if (body) {
      this.setHtml(body, `
        <div class="modal-spec-item">
          <span class="modal-spec-label">Nama Lokasi</span>
          <span class="modal-spec-val">${this.escapeHtml(item.loc || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Unique Code</span>
          <span class="modal-spec-val mono">${this.escapeHtml(item.code || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Status Aset Backup</span>
          <span class="modal-spec-val">${this.escapeHtml(item.status || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Koneksi P2P</span>
          <span class="modal-spec-val">${this.escapeHtml(item.p2p || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Tipe Kabel P2P</span>
          <span class="modal-spec-val">${this.escapeHtml(item.cable_type || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Teleport Node</span>
          <span class="modal-spec-val">${this.escapeHtml(item.teleport || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP Local Backup</span>
          <span class="modal-spec-val mono">${this.escapeHtml(item.ip_local || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP P2P</span>
          <span class="modal-spec-val mono">${this.escapeHtml(item.ip_p2p || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Status Replikasi (repmgr)</span>
          <span class="modal-spec-val">${this.escapeHtml(item.replication || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Auto Promote (Pawdog)</span>
          <span class="modal-spec-val">${this.escapeHtml(item.autopromote || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Replication Lag (Replag)</span>
          <span class="modal-spec-val mono">${this.escapeHtml(item.replag || '-')}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Catatan Konektivitas</span>
          <span class="modal-spec-val">${this.escapeHtml(connNote)}</span>
        </div>
        <div class="modal-spec-item full-width">
          <span class="modal-spec-label">Keterangan Lengkap</span>
          <span class="modal-spec-val">${this.escapeHtml(fullNotes)}</span>
        </div>
      `);
    }

    const summaryText = `[PARKEE SERVER BACKUP DETAIL]
Lokasi: ${item.loc || '-'} (${item.code || '-'})
Status: ${item.status || '-'}
P2P: ${item.p2p || '-'} (${item.cable_type || '-'})
Teleport: ${item.teleport || '-'}
IP Local: ${item.ip_local || '-'} | IP P2P: ${item.ip_p2p || '-'}
Replication: ${item.replication || '-'} | Auto Promote: ${item.autopromote || '-'} | Replag: ${item.replag || '-'}
Keterangan: ${fullNotes}${item.conn_note ? ' (' + item.conn_note + ')' : ''}`;

    const eLocAttr = this.escapeHtml(item.loc || '');
    const extraBtns = eLocAttr ? `
      <button type="button" class="btn btn-outline" data-action="modal-jump-server" data-loc="${eLocAttr}" style="font-size: 0.76rem; padding: 5px 12px;">
        🖧 Lihat Server Utama ➜
      </button>
    ` : '';
    this.setDeviceModalFooter('Google Sheet HA Fleet', summaryText, extraBtns);
    this.openNativeModal(modal);
  },

  // =========================================================================
  // MODULE 3: CLIENT SPECIFICATION
  // =========================================================================
  getFilteredClients() {
    let list = this.fleet.filter(d => !(d.host || '').toLowerCase().startsWith('server'));

    // Quick filter pills (Reader PARKEE & Thermal)
    if (this.allClientsState.filter === 'reader') {
      list = list.filter(d => Boolean(d.reader_ver || d.reader_sn));
    } else if (this.allClientsState.filter === 'no_reader') {
      list = list.filter(d => !d.reader_ver && !d.reader_sn);
    } else if (this.allClientsState.filter === 'warm') {
      list = list.filter(d => d.temp !== null && d.temp >= 70);
    } else if (this.allClientsState.filter === 'hot') {
      list = list.filter(d => d.temp !== null && d.temp >= 80);
    }

    // Specific Filter: Reader Status
    if (this.allClientsState.readerStatus === 'connected') {
      list = list.filter(d => Boolean(d.reader_ver || d.reader_sn));
    } else if (this.allClientsState.readerStatus === 'none') {
      list = list.filter(d => !d.reader_ver && !d.reader_sn);
    }

    // Specific Filter: Firmware Version
    if (this.allClientsState.readerVer !== 'all') {
      const qFw = this.allClientsState.readerVer.toLowerCase();
      list = list.filter(d => d.reader_ver && d.reader_ver.toLowerCase().startsWith(qFw));
    }

    // Specific Filter: CPU
    if (this.allClientsState.cpu !== 'all') {
      const qCpu = this.allClientsState.cpu.toLowerCase();
      list = list.filter(d => d.cpu && d.cpu.toLowerCase().includes(qCpu));
    }

    // Specific Filter: Temp Range
    if (this.allClientsState.tempRange !== 'all') {
      list = list.filter(d => {
        if (d.temp === null || d.temp === undefined) return false;
        if (this.allClientsState.tempRange === 'normal') return d.temp < 60;
        if (this.allClientsState.tempRange === 'warm') return d.temp >= 60 && d.temp < 80;
        if (this.allClientsState.tempRange === 'hot') return d.temp >= 80;
        return true;
      });
    }

    // Search query
    if (this.allClientsState.search) {
      const q = this.allClientsState.search.toLowerCase();
      list = list.filter(d =>
        (d.loc && d.loc.toLowerCase().includes(q)) ||
        (d.code && d.code.toLowerCase().includes(q)) ||
        (d.host && d.host.toLowerCase().includes(q)) ||
        (d.ip && d.ip.toLowerCase().includes(q)) ||
        (d.cpu && d.cpu.toLowerCase().includes(q)) ||
        (d.agent && d.agent.toLowerCase().includes(q)) ||
        (d.reader_sn && d.reader_sn.toLowerCase().includes(q)) ||
        (d.reader_ver && d.reader_ver.toLowerCase().includes(q)) ||
        (d.os && d.os.toLowerCase().includes(q))
      );
    }

    return list;
  },

  renderAllClientsNationwideTable() {
    const tbody = document.getElementById('allClientsTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) return;

    let list = this.getFilteredClients();

    // Sort
    list = this.sortData(list, this.allClientsState.sortCol, this.allClientsState.sortDir === 'asc' ? 1 : -1);
    this.updateSortIndicators('#view-clients', 'data-cl-sort', this.allClientsState.sortCol, this.allClientsState.sortDir);

    const badge = document.getElementById('allClientsCountBadge');
    if (badge) badge.textContent = `Menampilkan ${list.length.toLocaleString()} Unit Klien`;

    // Pagination
    const totalPages = Math.ceil(list.length / this.allClientsState.pageSize) || 1;
    if (this.allClientsState.page > totalPages) this.allClientsState.page = totalPages;
    if (this.allClientsState.page < 1) this.allClientsState.page = 1;

    const startIdx = (this.allClientsState.page - 1) * this.allClientsState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + this.allClientsState.pageSize);

    const pageLabel = document.getElementById('allClientsPageLabel');
    if (pageLabel) pageLabel.textContent = `Halaman ${this.allClientsState.page} / ${totalPages}`;
    const countLabel = document.getElementById('allClientsCountLabel');
    if (countLabel) countLabel.textContent = `Menampilkan ${list.length === 0 ? 0 : startIdx + 1}-${Math.min(startIdx + this.allClientsState.pageSize, list.length)} dari ${list.length.toLocaleString()} klien`;

    const prevBtn = document.getElementById('allClientsPrevBtn');
    const nextBtn = document.getElementById('allClientsNextBtn');
    if (prevBtn) prevBtn.disabled = this.allClientsState.page <= 1;
    if (nextBtn) nextBtn.disabled = this.allClientsState.page >= totalPages;

    if (pageItems.length === 0) {
      this.setHtml(tbody, `<tr><td colspan="11" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada unit klien yang cocok.</td></tr>`);
      return;
    }

    const rowsHtml = pageItems.map(d => {
      let tempClass = 'temp-cool';
      if (d.temp !== null && d.temp !== undefined) {
        if (d.temp >= 80) tempClass = 'temp-hot';
        else if (d.temp >= 70) tempClass = 'temp-warm';
        else if (d.temp >= 50) tempClass = 'temp-normal';
      }

      const hasReader = Boolean(d.reader_ver || d.reader_sn);
      const tierRaw = d.tier || 'Standard';
      const tierLower = tierRaw.toLowerCase();
      const tierClass = tierLower === 'diamond' ? 'tier-diamond' : (tierLower === 'gold' ? 'tier-gold' : 'tier-silver');

      let healthClass = 'health-good';
      if (d.ssd_health !== null && d.ssd_health !== undefined) {
        if (d.ssd_health < 70) healthClass = 'health-bad';
        else if (d.ssd_health < 80) healthClass = 'health-warn';
      }

      const ssdBrandFormatted = this.formatBrand(d.ssd_brand);
      const ssdSizeFormatted = this.formatSize(d.ssd_size);

      const eLoc = this.escapeHtml(d.loc || '-');
      const eLocAttr = this.escapeHtml(d.loc || '');
      const eCode = this.escapeHtml(d.code || '-');
      const eTier = this.escapeHtml(tierRaw);
      const eHost = this.escapeHtml(d.host || '-');
      const eHostAttr = this.escapeHtml(d.host || '');
      const eAgent = this.escapeHtml(d.agent || '');
      const eReaderVer = this.escapeHtml(d.reader_ver || 'Reader PARKEE');
      const eReaderSn = this.escapeHtml(d.reader_sn || '');
      const eIp = this.escapeHtml(d.ip || '-');
      const eIpAttr = this.escapeHtml(d.ip || '');
      const eZt = this.escapeHtml(d.zt || '');
      const eCpuTitle = this.escapeHtml(d.cpu || '');
      const eCpu = this.escapeHtml(this.formatCpu(d.cpu));
      const eRam = this.escapeHtml(this.formatRam(d.ram, d.ram_brand));
      const eMbTitle = this.escapeHtml(d.mb || '');
      const eMb = this.escapeHtml(this.formatMb(d.mb, d.mb_brand));
      const eSsdSize = this.escapeHtml(ssdSizeFormatted);
      const eSsdBrand = this.escapeHtml(ssdBrandFormatted);
      const eOsTitle = this.escapeHtml(d.os || '');
      const eOs = this.escapeHtml(this.formatOs(d.os));

      return `
        <tr class="clickable-row" tabindex="0" role="button" aria-label="Buka detail klien ${eHost} (${eLoc})" title="Klik baris untuk melihat spesifikasi lengkap klien ${eHost}" data-action="open-client-modal" data-host="${eHostAttr}" data-loc="${eLocAttr}" data-ip="${eIpAttr}">
          <td>
            <div class="row-primary-title" style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${eLoc}</div>
            <div style="display: flex; gap: 4px; align-items: center; margin-top: 3px;">
              <span class="version-code-tag">${eCode}</span>
              <span class="tier-tag ${tierClass}" style="font-size: 0.65rem; padding: 1px 5px;">${eTier}</span>
            </div>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.85rem;">
              ${eHost}
            </div>
          </td>
          <td>
            ${d.agent && d.agent !== '-' ? `<span class="version-code-tag" style="font-size: 0.72rem; white-space: nowrap;" title="${eAgent}">${eAgent}</span>` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td>
            ${hasReader ? `
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <span class="reader-ver-tag" style="font-size: 0.72rem; font-weight: 600; color: var(--color-success);">✓ ${eReaderVer}</span>
                ${d.reader_sn ? `
                  <div class="reader-sn-code" style="font-size: 0.75rem; padding: 2px 6px;">
                    <span>${eReaderSn}</span>
                    <button type="button" class="btn-copy-inline" aria-label="Salin Serial Number Reader PARKEE ${eReaderSn}" title="Salin Serial Number Reader PARKEE" data-action="copy-text" data-copy-text="${eReaderSn}">
                      <span aria-hidden="true">📋</span>
                    </button>
                  </div>
                ` : ''}
              </div>
            ` : `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Belum Pakai</span>`}
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-main);">${eIp}</div>
            ${d.zt ? `<div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">ZT: ${eZt}</div>` : ''}
          </td>
          <td style="font-size: 0.78rem; color: var(--text-main); min-width: 170px; max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eCpuTitle}">
            ${eCpu}
          </td>
          <td style="font-size: 0.78rem; font-weight: 600; color: var(--text-main);">
            ${eRam}
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); min-width: 130px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eMbTitle}">
            ${eMb}
          </td>
          <td>
            <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-main); font-family: var(--font-mono);">
              ${eSsdSize} ${ssdBrandFormatted !== '-' ? `(${eSsdBrand})` : ''}
            </div>
            <div style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
              ${d.ssd_health !== null && d.ssd_health !== undefined ? `<span class="ssd-health-pill ${healthClass}">${this.escapeHtml(d.ssd_health)}%</span>` : ''}
              ${d.ssd_usage !== null && d.ssd_usage !== undefined ? `<span style="font-size: 0.7rem; color: var(--text-muted);">${this.escapeHtml(d.ssd_usage)}%</span>` : ''}
            </div>
          </td>
          <td>
            ${d.temp !== null && d.temp !== undefined ? `<span class="temp-badge ${tempClass}" style="font-weight: 700;">${this.escapeHtml(d.temp)}°C</span>` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td style="font-size: 0.72rem; color: var(--text-muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${eOsTitle}">
            ${eOs}
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  // =========================================================================
  // MODULE 4: STORAGE (SERVER ONLY)
  // =========================================================================
  setStorageQuickFilter(filterVal, fromKpiCard = false) {
    let nextFilter = filterVal || 'all';
    if (fromKpiCard && nextFilter === 'nvme') {
      if (this.storageState.filter === 'nvme') nextFilter = 'sata';
      else if (this.storageState.filter === 'sata') nextFilter = 'all';
      else nextFilter = 'nvme';
    } else if (fromKpiCard && nextFilter !== 'all' && this.storageState.filter === nextFilter) {
      nextFilter = 'all';
    }

    this.storageState.filter = nextFilter;
    this.storageState.page = 1;

    // Reset conflicting specific dropdowns so KPI card count matches table rows
    const storageTypeFilter = document.getElementById('storageTypeFilter');
    const storageHealthFilter = document.getElementById('storageHealthFilter');
    const storageUsageFilter = document.getElementById('storageUsageFilter');

    if (nextFilter === 'nvme' || nextFilter === 'sata') {
      this.storageState.type = 'all';
      if (storageTypeFilter) storageTypeFilter.value = 'all';
    } else if (nextFilter === 'critical_usage') {
      this.storageState.usageRange = 'all';
      if (storageUsageFilter) storageUsageFilter.value = 'all';
    } else if (nextFilter === 'critical_health') {
      this.storageState.healthRange = 'all';
      if (storageHealthFilter) storageHealthFilter.value = 'all';
    }

    this.syncStorageFilterUI();
    this.renderStorageTable();
  },

  syncStorageFilterUI() {
    const cur = this.storageState.filter || 'all';
    document.querySelectorAll('.filter-pill[data-storage-filter]').forEach(b => {
      b.classList.toggle('active', b.dataset.storageFilter === cur);
    });
    document.querySelectorAll('[data-storage-kpi]').forEach(card => {
      const kpi = card.dataset.storageKpi;
      const isActive = (kpi === cur) || (kpi === 'nvme' && (cur === 'nvme' || cur === 'sata'));
      card.classList.toggle('kpi-active-filter', isActive);
      card.setAttribute('aria-pressed', String(isActive));
    });
  },

  getFilteredStorageServers() {
    let list = this.servers.filter(d => (d.host || '').toLowerCase().startsWith('server'));

    // Filter condition
    if (this.storageState.filter === 'critical_usage') {
      list = list.filter(d => d.ssd_usage !== null && d.ssd_usage >= 85);
    } else if (this.storageState.filter === 'critical_health') {
      list = list.filter(d => d.ssd_health !== null && d.ssd_health < 70);
    } else if (this.storageState.filter === 'nvme') {
      list = list.filter(d => d.ssd_type === 'NVMe');
    } else if (this.storageState.filter === 'sata') {
      list = list.filter(d => d.ssd_type === 'SATA');
    }

    // Specific Filter: Tipe SSD
    if (this.storageState.type !== 'all') {
      list = list.filter(d => d.ssd_type && d.ssd_type.toLowerCase() === this.storageState.type.toLowerCase());
    }

    // Specific Filter: Merk SSD
    if (this.storageState.brand !== 'all') {
      const qBrand = this.storageState.brand.toLowerCase();
      list = list.filter(d => d.ssd_brand && d.ssd_brand.toLowerCase().includes(qBrand));
    }

    // Specific Filter: Kapasitas
    if (this.storageState.capacity !== 'all') {
      list = list.filter(d => {
        const cap = this.parseStorageGb(d.ssd_size);
        if (this.storageState.capacity === '128g') return cap > 0 && cap <= 130;
        if (this.storageState.capacity === '256g') return cap > 130 && cap <= 260;
        if (this.storageState.capacity === '512g') return cap > 260 && cap <= 550;
        if (this.storageState.capacity === '1t') return cap > 550;
        return true;
      });
    }

    // Specific Filter: Health SSD
    if (this.storageState.healthRange !== 'all') {
      list = list.filter(d => {
        if (d.ssd_health === null || d.ssd_health === undefined) return false;
        if (this.storageState.healthRange === 'pristine') return d.ssd_health >= 95;
        if (this.storageState.healthRange === 'good') return d.ssd_health >= 80 && d.ssd_health < 95;
        if (this.storageState.healthRange === 'warning') return d.ssd_health >= 70 && d.ssd_health < 80;
        if (this.storageState.healthRange === 'degraded') return d.ssd_health < 70;
        return true;
      });
    }

    // Specific Filter: Disk Usage
    if (this.storageState.usageRange !== 'all') {
      list = list.filter(d => {
        if (d.ssd_usage === null || d.ssd_usage === undefined) return false;
        if (this.storageState.usageRange === 'plenty') return d.ssd_usage < 50;
        if (this.storageState.usageRange === 'moderate') return d.ssd_usage >= 50 && d.ssd_usage < 70;
        if (this.storageState.usageRange === 'high') return d.ssd_usage >= 70 && d.ssd_usage < 85;
        if (this.storageState.usageRange === 'critical') return d.ssd_usage >= 85;
        return true;
      });
    }

    // Specific Filter: Tier
    if (this.storageState.tier !== 'all') {
      list = list.filter(d => this.matchesTier(d.tier, this.storageState.tier));
    }

    // Search filter
    if (this.storageState.search) {
      const q = this.storageState.search.toLowerCase();
      list = list.filter(d =>
        (d.loc && d.loc.toLowerCase().includes(q)) ||
        (d.code && d.code.toLowerCase().includes(q)) ||
        (d.host && d.host.toLowerCase().includes(q)) ||
        (d.ssd_brand && d.ssd_brand.toLowerCase().includes(q)) ||
        (d.ssd_type && d.ssd_type.toLowerCase().includes(q))
      );
    }

    return list;
  },

  renderStorageTable() {
    const tbody = document.getElementById('storageTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) return;

    this.syncStorageFilterUI();
    let list = this.getFilteredStorageServers();

    // Sort
    list = this.sortData(list, this.storageState.sortCol, this.storageState.sortDir === 'asc' ? 1 : -1);
    this.updateSortIndicators('#view-storage', 'data-st-sort', this.storageState.sortCol, this.storageState.sortDir);

    const countLabel = document.getElementById('storageResultCountLabel');
    if (countLabel) countLabel.textContent = `Menampilkan ${list.length.toLocaleString()} Server Storage`;

    // Pagination
    const totalPages = Math.ceil(list.length / this.storageState.pageSize) || 1;
    if (this.storageState.page > totalPages) this.storageState.page = totalPages;
    if (this.storageState.page < 1) this.storageState.page = 1;

    const startIdx = (this.storageState.page - 1) * this.storageState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + this.storageState.pageSize);

    const pageLabel = document.getElementById('storageCurrentPageLabel');
    if (pageLabel) pageLabel.textContent = `Halaman ${this.storageState.page} / ${totalPages}`;
    const tableCount = document.getElementById('storageTableCountLabel');
    if (tableCount) tableCount.textContent = `Menampilkan ${list.length === 0 ? 0 : startIdx + 1}-${Math.min(startIdx + this.storageState.pageSize, list.length)} dari ${list.length.toLocaleString()} server storage`;

    const prevBtn = document.getElementById('storagePrevPageBtn');
    const nextBtn = document.getElementById('storageNextPageBtn');
    if (prevBtn) prevBtn.disabled = this.storageState.page <= 1;
    if (nextBtn) nextBtn.disabled = this.storageState.page >= totalPages;

    if (pageItems.length === 0) {
      this.setHtml(tbody, `<tr><td colspan="11" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada data storage server yang cocok.</td></tr>`);
      return;
    }

    const rowsHtml = pageItems.map(d => {
      const tierRaw = d.tier || 'Standard';
      const tierLower = tierRaw.toLowerCase();
      const tierClass = tierLower === 'diamond' ? 'tier-diamond' : (tierLower === 'gold' ? 'tier-gold' : 'tier-silver');

      let usageColor = 'var(--color-success)';
      if (d.ssd_usage !== null && d.ssd_usage !== undefined) {
        if (d.ssd_usage >= 85) {
          usageColor = 'var(--color-danger)';
        } else if (d.ssd_usage >= 70) {
          usageColor = 'var(--color-warning)';
        }
      }

      let healthColor = 'var(--color-success)';
      if (d.ssd_health !== null && d.ssd_health !== undefined && d.ssd_health < 70) {
        healthColor = 'var(--color-danger)';
      } else if (d.ssd_health !== null && d.ssd_health !== undefined && d.ssd_health < 80) {
        healthColor = 'var(--color-warning)';
      }

      let actionRecommendation = 'Operasional Normal';
      if (d.ssd_usage !== null && d.ssd_usage >= 85) {
        actionRecommendation = 'Log rotate & vacuum PostgreSQL';
      } else if (d.ssd_health !== null && d.ssd_health < 70) {
        actionRecommendation = 'Jadwalkan kloning SSD cadangan';
      }

      const healthPct = d.ssd_health !== null && d.ssd_health !== undefined ? Math.max(0, Math.min(100, Number(d.ssd_health) || 0)) : null;
      const usagePct = d.ssd_usage !== null && d.ssd_usage !== undefined ? Math.max(0, Math.min(100, Number(d.ssd_usage) || 0)) : null;

      const eLoc = this.escapeHtml(d.loc || '-');
      const eLocAttr = this.escapeHtml(d.loc || '');
      const eCode = this.escapeHtml(d.code || '-');
      const eCodeAttr = this.escapeHtml(d.code || '');
      const eTier = this.escapeHtml(tierRaw);
      const eHost = this.escapeHtml(d.host || '-');
      const eHostAttr = this.escapeHtml(d.host || '');
      const eBrand = this.escapeHtml(this.formatBrand(d.ssd_brand));
      const eType = this.escapeHtml(d.ssd_type || '-');
      const eSize = this.escapeHtml(this.formatSize(d.ssd_size));
      const eSync = this.escapeHtml(d.sync || '-');
      const eAction = this.escapeHtml(actionRecommendation);

      return `
        <tr class="clickable-row" tabindex="0" role="button" aria-label="Buka detail storage server ${eHost} (${eLoc})" title="Klik baris untuk melihat detail spesifikasi server ${eHost}" data-action="open-server-modal" data-host="${eHostAttr}" data-code="${eCodeAttr}" data-loc="${eLocAttr}">
          <td>
            <div class="row-primary-title" style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${eLoc}</div>
            <span class="version-code-tag">${eCode}</span>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${eTier}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.85rem;">
              ${eHost}
            </div>
          </td>
          <td>
            <span style="font-weight: 600; color: var(--text-main); font-size: 0.825rem;">${eBrand}</span>
          </td>
          <td>
            ${d.ssd_type && d.ssd_type !== '-' ? `
              <span class="version-code-tag" style="font-weight: 700; color: ${d.ssd_type === 'NVMe' ? 'var(--accent-primary)' : 'var(--text-secondary)'};">
                ${eType}
              </span>
            ` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td style="font-family: var(--font-mono); font-size: 0.825rem; font-weight: 600;">
            ${eSize}
          </td>
          <td>
            ${healthPct !== null ? `
              <div class="storage-bar-wrap">
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: ${healthColor};">
                  <span>Health</span>
                  <span>${this.escapeHtml(d.ssd_health)}%</span>
                </div>
                <div class="storage-bar-track">
                  <div class="storage-bar-fill" style="width: ${healthPct}%; background: ${healthColor};"></div>
                </div>
              </div>
            ` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td>
            ${usagePct !== null ? `
              <div class="storage-bar-wrap">
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: ${usageColor};">
                  <span>Usage</span>
                  <span>${this.escapeHtml(d.ssd_usage)}%</span>
                </div>
                <div class="storage-bar-track">
                  <div class="storage-bar-fill" style="width: ${usagePct}%; background: ${usageColor};"></div>
                </div>
              </div>
            ` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td>
            ${d.temp !== null && d.temp !== undefined ? `
              <span class="temp-badge ${d.temp >= 80 ? 'temp-hot' : 'temp-cool'}" style="font-weight: 700;">
                ${this.escapeHtml(d.temp)}°C
              </span>
            ` : `<span style="color: var(--text-muted);">-</span>`}
          </td>
          <td style="font-size: 0.72rem; color: var(--text-muted); white-space: nowrap;">
            ${eSync}
          </td>
          <td style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 500;">
            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; background: var(--surface-hover); border: 1px solid var(--border-subtle);">
              ${eAction}
            </span>
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  // =========================================================================
  // MODULE 5: TEMPERATURE SERVER (LIVE PROMETHEUS TELEMETRY)
  // =========================================================================
  setTemperatureFilter(filterVal, fromKpiCard = false) {
    let targetFilter = filterVal || 'all';
    if (targetFilter === 'avg') {
      targetFilter = 'all';
      this.temperatureState.sortCol = 'temp';
      this.temperatureState.sortDir = 'desc';
    } else if (fromKpiCard && targetFilter !== 'all' && this.temperatureState.filter === targetFilter) {
      targetFilter = 'all';
    }

    this.temperatureState.filter = targetFilter;
    this.temperatureState.page = 1;
    this.syncTemperatureFilterUI(filterVal === 'avg' ? 'avg' : targetFilter);
    this.renderTemperatureTable();
  },

  syncTemperatureFilterUI(activeKpiOverride = null) {
    const curFilter = this.temperatureState.filter || 'all';
    const curKpi = activeKpiOverride || curFilter;

    document.querySelectorAll('.filter-pill[data-temp-filter]').forEach(b => {
      b.classList.toggle('active', b.dataset.tempFilter === curFilter);
    });

    document.querySelectorAll('[data-temp-kpi]').forEach(card => {
      const kpi = card.dataset.tempKpi;
      const isActive = kpi === curKpi;
      card.classList.toggle('kpi-active-filter', isActive);
      card.setAttribute('aria-pressed', String(isActive));
    });
  },

  async fetchTemperature(forceRefresh = false) {
    if (this.dataStatus.temperature !== 'ready') this.setDataStatus('temperature', 'loading');
    const rawUrl = `https://raw.githubusercontent.com/support-parkee/Dashboard/telemetry/temperature.json?_t=${Date.now()}`;
    try {
      const res = await fetch(rawUrl, { cache: 'no-store' });
      if (res.ok) {
        this.temperatureData = await res.json();
        this.setDataStatus('temperature', 'ready');
        this.renderTemperatureKPIs();
        if (this.activeView === 'temperature') this.renderTemperatureTable();
        return;
      }
    } catch (e) {
      console.warn('Could not fetch live telemetry branch:', e);
    }

    try {
      const localRes = await fetch('./data/temperature.json?_t=' + Date.now());
      if (localRes.ok) {
        this.temperatureData = await localRes.json();
        this.setDataStatus('temperature', 'ready');
        this.renderTemperatureKPIs();
        if (this.activeView === 'temperature') this.renderTemperatureTable();
      }
    } catch (err) {
      console.error('Could not fetch fallback temperature.json:', err);
    }

    if (!this.temperatureData) this.failLoad('temperature', 'telemetri suhu');
  },

  renderTemperatureKPIs() {
    if (!this.temperatureData) return;
    const d = this.temperatureData;

    const badge = document.getElementById('badgeOverheatTemp');
    if (badge) {
      badge.textContent = `🔥 ${d.overheat_count || 0}`;
    }

    const totalEl = document.getElementById('tempTotalMonitored');
    if (totalEl) totalEl.textContent = (d.total_monitored || 0).toLocaleString();

    const overEl = document.getElementById('tempCountOverheat');
    if (overEl) overEl.textContent = (d.overheat_count || 0).toLocaleString();

    const warmEl = document.getElementById('tempCountWarm');
    if (warmEl) warmEl.textContent = (d.warm_count || 0).toLocaleString();

    const normalEl = document.getElementById('tempCountNormal');
    if (normalEl) normalEl.textContent = (d.normal_count || 0).toLocaleString();

    const avgEl = document.getElementById('tempAvgCelsius');
    if (avgEl) avgEl.textContent = `${d.avg_temp || 0}°C`;

    const lastSyncEl = document.getElementById('tempLastSyncLabel');
    if (lastSyncEl && d.updated_at) {
      lastSyncEl.textContent = `Update: ${d.updated_at}`;
    }
  },

  getFilteredTemperatureServers() {
    if (!this.temperatureData || !Array.isArray(this.temperatureData.servers)) return [];
    let list = [...this.temperatureData.servers];

    // 1. Search Filter
    if (this.temperatureState.search) {
      const q = this.temperatureState.search.toLowerCase();
      list = list.filter(item =>
        (item.loc && item.loc.toLowerCase().includes(q)) ||
        (item.code && item.code.toLowerCase().includes(q)) ||
        (item.host && item.host.toLowerCase().includes(q)) ||
        (item.ip && item.ip.toLowerCase().includes(q)) ||
        (item.cpu && item.cpu.toLowerCase().includes(q))
      );
    }

    // 2. Status Filter
    if (this.temperatureState.filter !== 'all') {
      list = list.filter(item => item.status === this.temperatureState.filter);
    }

    return list;
  },

  renderTemperatureTable() {
    const tbody = document.getElementById('tempTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) return;

    this.syncTemperatureFilterUI();

    if (!this.temperatureData || !this.temperatureData.servers) {
      this.setHtml(tbody, `
        <tr>
          <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
            <div style="font-size: 1.2rem; margin-bottom: 6px;">⏳</div>
            Memuat telemetri suhu dari Grafana Prometheus...
          </td>
        </tr>
      `);
      return;
    }

    let list = this.getFilteredTemperatureServers();

    // 3. Sorting
    const col = this.temperatureState.sortCol;
    const dir = this.temperatureState.sortDir === 'desc' ? -1 : 1;

    list.sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      if (col === 'temp') {
        va = Number(va) || 0;
        vb = Number(vb) || 0;
        return (va - vb) * dir;
      }

      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
      return (this._collator ? this._collator.compare(va, vb) : va.localeCompare(vb)) * dir;
    });

    // Update Sorting arrows & aria-sort in table headers (preserve <button class="th-sort-btn">)
    document.querySelectorAll('#tempTable th.sortable[data-temp-sort]').forEach(th => {
      const c = th.dataset.tempSort;
      const isSorted = c === this.temperatureState.sortCol;
      th.setAttribute('aria-sort', isSorted ? (this.temperatureState.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.style.color = isSorted ? 'var(--accent-primary)' : '';
      const icon = th.querySelector('.sort-icon');
      if (icon) {
        icon.textContent = isSorted ? (this.temperatureState.sortDir === 'asc' ? '▲' : '▼') : '⇅';
      }
    });

    // 4. Pagination
    const total = list.length;
    const pageSize = this.temperatureState.pageSize || 25;
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (this.temperatureState.page > totalPages) this.temperatureState.page = totalPages;
    if (this.temperatureState.page < 1) this.temperatureState.page = 1;

    const start = (this.temperatureState.page - 1) * pageSize;
    const end = start + pageSize;
    const paginated = list.slice(start, end);

    // Update pagination labels
    const countLabel = document.getElementById('tempTableCountLabel');
    if (countLabel) {
      countLabel.textContent = `Menampilkan ${total === 0 ? 0 : start + 1} - ${Math.min(end, total)} dari ${total.toLocaleString()} unit server`;
    }

    const pageLabel = document.getElementById('tempCurrentPageLabel');
    if (pageLabel) {
      pageLabel.textContent = `Halaman ${this.temperatureState.page} / ${totalPages}`;
    }

    const prevBtn = document.getElementById('tempPrevPageBtn');
    if (prevBtn) prevBtn.disabled = this.temperatureState.page <= 1;

    const nextBtn = document.getElementById('tempNextPageBtn');
    if (nextBtn) nextBtn.disabled = this.temperatureState.page >= totalPages;

    if (paginated.length === 0) {
      this.setHtml(tbody, `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2.5rem; color: var(--text-muted); font-size: 0.85rem;">
            Tidak ada unit server yang cocok dengan filter suhu saat ini.
          </td>
        </tr>
      `);
      return;
    }

    const rowsHtml = paginated.map((d, index) => {
      const rowNo = start + index + 1;
      let statusHtml = '';
      let fillClass = 'fill-normal';
      let valClass = 'temp-val-normal';

      if (d.status === 'overheat') {
        statusHtml = '<span class="temp-status-badge temp-status-overheat">🔥 OVERHEAT</span>';
        fillClass = 'fill-overheat';
        valClass = 'temp-val-overheat';
      } else if (d.status === 'warm') {
        statusHtml = '<span class="temp-status-badge temp-status-warm">⚠️ WASPADA</span>';
        fillClass = 'fill-warm';
        valClass = 'temp-val-warm';
      } else {
        statusHtml = '<span class="temp-status-badge temp-status-normal">🟢 NORMAL</span>';
        fillClass = 'fill-normal';
        valClass = 'temp-val-normal';
      }

      const tempNum = Number(d.temp);
      const safeTemp = Number.isFinite(tempNum) ? tempNum : 0;
      // Visual bar fill percentage (20C = 0%, 100C = 100%)
      const barPercent = Math.min(100, Math.max(8, ((safeTemp - 20) / 80) * 100));

      const eLoc = this.escapeHtml(d.loc || '-');
      const eLocAttr = this.escapeHtml(d.loc || '');
      const eCode = this.escapeHtml(d.code || '-');
      const eCodeAttr = this.escapeHtml(d.code || '');
      const eHost = this.escapeHtml(d.host || '-');
      const eHostAttr = this.escapeHtml(d.host || '');
      const eIp = this.escapeHtml(d.ip || '-');
      const cpuClean = d.cpu && d.cpu !== '-' ? d.cpu.split('@')[0].trim() : '-';
      const eCpu = this.escapeHtml(cpuClean);
      const eRam = d.ram && d.ram !== '-' ? this.escapeHtml(d.ram) : '';

      return `
        <tr class="clickable-row" tabindex="0" role="button" aria-label="Buka detail server ${eHost} (${eLoc})" title="Klik baris untuk melihat detail lengkap server ${eHost}" data-action="open-server-modal" data-host="${eHostAttr}" data-code="${eCodeAttr}" data-loc="${eLocAttr}">
          <td style="text-align: center; font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">
            ${rowNo}
          </td>
          <td>
            <div class="row-primary-title" style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${eLoc}</div>
          </td>
          <td>
            <span class="version-code-tag">${eCode}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.85rem;">
              ${eHost}
            </div>
          </td>
          <td>
            ${statusHtml}
          </td>
          <td>
            <div class="temp-bar-container">
              <div class="temp-bar-bg">
                <div class="temp-bar-fill ${fillClass}" style="width: ${barPercent}%;"></div>
              </div>
            </div>
          </td>
          <td>
            <span class="temp-val-text ${valClass}">${safeTemp.toFixed(1)}°C</span>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-secondary);">${eIp}</span>
          </td>
          <td style="font-size: 0.74rem; color: var(--text-muted);">
            <div>${eCpu}</div>
            ${eRam ? `<span class="badge-pill" style="font-size: 0.65rem; margin-top: 2px; display: inline-block;">RAM: ${eRam}</span>` : ''}
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  // =========================================================================
  // MODULE 0: DASHBOARD (HALAMAN UTAMA - TICKETING 1 BULAN TERAKHIR)
  // =========================================================================
  dashboardCharts: {},
  _lastChartRenderSig: null,
  _lastCritTableSig: null,

  getOneMonthTickets() {
    if (!this.ticketingData || !this.ticketingData.tickets || !this.ticketingData.tickets.length) return [];
    const s1m = this.ticketingData.stats_1m;
    let startStr = s1m && s1m.cutoff_date ? s1m.cutoff_date : '';
    if (!startStr) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      startStr = `${y}-${m}-${day}`;
    }
    if (!this._fullTicketsLoaded && this.ticketingData.critical_tickets) {
      return this.ticketingData.critical_tickets.filter(t => t.open_date && t.open_date >= startStr);
    }
    return this.ticketingData.tickets.filter(t => t.open_date && t.open_date >= startStr);
  },

  renderDashboard() {
    const t1m = this.getOneMonthTickets();
    this.renderDashboardKPIs(t1m);
    this.renderDashboardCharts(t1m);
    this.renderDashboardCriticalTable(t1m);
  },

  renderDashboardKPIs(t1m) {
    if (!this.ticketingData) return;
    const s = this.ticketingData.stats || {};
    const s1m = this.ticketingData.stats_1m || null;
    let total = t1m.length;
    let closed = 0;
    let solved = 0;
    let processing = 0;
    let newCount = 0;
    let pending = 0;
    let p0 = 0;
    let p1 = 0;

    if (s1m && s1m.total !== undefined) {
      total = s1m.total || 0;
      closed = s1m.closed || 0;
      solved = s1m.solved || 0;
      processing = s1m.processing || 0;
      newCount = s1m.new || 0;
      pending = s1m.pending || 0;
      const p = s1m.priority || {};
      p0 = p.P0 || 0;
      p1 = p.P1 || 0;
    } else if (!this._fullTicketsLoaded && s.total) {
      total = Math.round(s.total / 3);
      closed = Math.round((s.closed || 0) / 3);
      solved = Math.round((s.solved || 0) / 3);
      processing = s.processing || 0;
      newCount = s.new || 0;
      pending = s.pending || 0;
      const p = s.priority || {};
      p0 = Math.round((p.P0 || 0) / 3);
      p1 = Math.round((p.P1 || 0) / 3);
    } else {
      if (total === 0) return;
      t1m.forEach(t => {
        const st = (t.status || '').toLowerCase();
        const raw = (t.status_raw || '').toLowerCase();
        if (st === 'closed' || raw.includes('closed')) closed++;
        else if (st === 'solved' || raw.includes('solved')) solved++;
        else if (st.includes('process') || raw.includes('process')) processing++;
        else if (st === 'new' || raw.includes('new')) newCount++;
        else if (st === 'pending' || raw.includes('pending')) pending++;

        const p = (t.priority || '').toUpperCase();
        if (p === 'P0') p0++;
        else if (p === 'P1') p1++;
      });
    }

    const resolved = closed + solved;
    const resolvedPct = total > 0 ? ((resolved / total) * 100).toFixed(1) : '0';
    const newPending = newCount + pending;
    const highPrio = p0 + p1;

    // Sidebar badge
    const badgeDash = document.getElementById('badgeDashboardTickets');
    if (badgeDash) badgeDash.textContent = `${total.toLocaleString()} Tiket`;

    // 1. Total Tiket (1 Bulan)
    const totalEl = document.getElementById('dashKpiTotal');
    if (totalEl) totalEl.textContent = total.toLocaleString();

    // 2. Tiket Selesai
    const resolvedEl = document.getElementById('dashKpiResolved');
    if (resolvedEl) resolvedEl.textContent = resolved.toLocaleString();

    const resolvedPctEl = document.getElementById('dashKpiResolvedPct');
    if (resolvedPctEl) resolvedPctEl.textContent = `${resolvedPct}%`;

    const resolvedSubEl = document.getElementById('dashKpiResolvedSub');
    if (resolvedSubEl) {
      resolvedSubEl.textContent = `Selesai (${closed.toLocaleString()} Closed, ${solved.toLocaleString()} Solved)`;
    }

    // 3. Dalam Pengerjaan
    const procEl = document.getElementById('dashKpiProcessing');
    if (procEl) procEl.textContent = processing.toLocaleString();

    // 4. Baru & Pending
    const newPendEl = document.getElementById('dashKpiNewPending');
    if (newPendEl) newPendEl.textContent = newPending.toLocaleString();

    // 5. Prioritas P0 & P1
    const highPrioEl = document.getElementById('dashKpiHighPrio');
    if (highPrioEl) highPrioEl.textContent = highPrio.toLocaleString();

    // Header badges
    const statusRateBadge = document.getElementById('dashStatusSolveRate');
    if (statusRateBadge) statusRateBadge.textContent = `${resolvedPct}% Selesai`;

    const highPrioBadge = document.getElementById('dashHighPrioBadge');
    if (highPrioBadge) highPrioBadge.textContent = `${highPrio} P0/P1 Kritis`;

    const critBadge = document.getElementById('dashCriticalCountBadge');
    if (critBadge) critBadge.textContent = `${highPrio} Tiket Kritis`;

    // Average daily tickets badge
    const avgDailyBadge = document.getElementById('dashAvgDailyBadge');
    if (avgDailyBadge) {
      const avg = Math.round(total / 30);
      avgDailyBadge.textContent = `Rata-rata: ~${avg} tiket/hari`;
    }
  },

  getChartThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      isDark,
      gridColor: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(226, 232, 240, 0.7)',
      textColor: isDark ? '#94a3b8' : '#64748b',
      titleColor: isDark ? '#f8fafc' : '#090d16',
      tooltipBg: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.95)',
      cobalt: isDark ? '#3b82f6' : '#2563eb',
      cyan: isDark ? '#06b6d4' : '#0891b2',
      emerald: isDark ? '#10b981' : '#059669',
      amber: isDark ? '#f59e0b' : '#d97706',
      rose: isDark ? '#ef4444' : '#dc2626',
      orange: isDark ? '#f97316' : '#ea580c',
      violet: isDark ? '#8b5cf6' : '#7c3aed',
      teal: isDark ? '#14b8a6' : '#0d9488',
      slate: isDark ? '#64748b' : '#94a3b8'
    };
  },

  renderDashboardCharts(t1m) {
    if (!window.Chart) {
      this.setChartOverlay('loading', 'Memuat pustaka grafik…');
      this.scheduleChartLibraryRetry();
      return;
    }
    const s1m = (this.ticketingData && this.ticketingData.stats_1m) || null;
    if ((!t1m || !t1m.length) && (!s1m || !s1m.total)) {
      // Loading / error overlays are managed by syncDashboardLoadingUI()
      if (this.dataStatus.tickets === 'ready') {
        this.setChartOverlay('empty', 'Belum ada data tiket untuk 30 hari terakhir.');
      }
      return;
    }
    const tc = this.getChartThemeColors();
    const isSummaryOnly = !this._fullTicketsLoaded && Boolean(this.ticketingData && this.ticketingData.stats);
    const s = isSummaryOnly ? this.ticketingData.stats : null;

    // Precompute all 6 chart datasets so we can check if re-rendering is actually needed
    const statusCounts = {
      Closed: 0,
      ProcessingAssigned: 0,
      ProcessingPlanned: 0,
      'Baru / Pending': 0,
      Solved: 0
    };
    if (s1m && s1m.total !== undefined) {
      statusCounts.Closed = s1m.closed || 0;
      statusCounts.ProcessingAssigned = s1m.processing_assigned || 0;
      statusCounts.ProcessingPlanned = s1m.processing_planned || 0;
      statusCounts['Baru / Pending'] = (s1m.new || 0) + (s1m.pending || 0);
      statusCounts.Solved = s1m.solved || 0;
    } else if (isSummaryOnly && s) {
      statusCounts.Closed = Math.round((s.closed || 0) / 3);
      statusCounts.ProcessingAssigned = s.processing_assigned || s.processing || 0;
      statusCounts.ProcessingPlanned = s.processing_planned || 0;
      statusCounts['Baru / Pending'] = (s.new || 0) + (s.pending || 0);
      statusCounts.Solved = Math.round((s.solved || 0) / 3);
    } else {
      t1m.forEach(t => {
        const raw = (t.status_raw || '').toLowerCase();
        const st = (t.status || '').toLowerCase();
        if (st === 'closed' || raw.includes('closed')) statusCounts.Closed++;
        else if (raw.includes('planned') || st.includes('planned')) statusCounts.ProcessingPlanned++;
        else if (raw.includes('assign') || st.includes('process')) statusCounts.ProcessingAssigned++;
        else if (st === 'new' || st === 'pending' || raw.includes('new') || raw.includes('pending')) statusCounts['Baru / Pending']++;
        else if (st === 'solved' || raw.includes('solved')) statusCounts.Solved++;
      });
    }
    const totalStatus = Object.values(statusCounts).reduce((a, b) => a + b, 0) || 1;

    const prioCounts = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
    if (s1m && s1m.priority) {
      prioCounts.P0 = s1m.priority.P0 || 0;
      prioCounts.P1 = s1m.priority.P1 || 0;
      prioCounts.P2 = s1m.priority.P2 || 0;
      prioCounts.P3 = s1m.priority.P3 || 0;
      prioCounts.P4 = s1m.priority.P4 || 0;
    } else if (isSummaryOnly && s && s.priority) {
      const pStats = s.priority || {};
      prioCounts.P0 = Math.round((pStats.P0 || 0) / 3);
      prioCounts.P1 = Math.round((pStats.P1 || 0) / 3);
      prioCounts.P2 = Math.round((pStats.P2 || 0) / 3);
      prioCounts.P3 = Math.round((pStats.P3 || 0) / 3);
      prioCounts.P4 = Math.round((pStats.P4 || 0) / 3);
    } else {
      t1m.forEach(t => {
        const p = (t.priority || '').toUpperCase();
        if (prioCounts[p] !== undefined) prioCounts[p]++;
        else prioCounts.P2++;
      });
    }
    const totalPrio = Object.values(prioCounts).reduce((a, b) => a + b, 0) || 1;

    let catDonutLabels = [];
    let catDonutData = [];
    let topCatText = '';
    if (s1m && Array.isArray(s1m.categories) && s1m.categories.length) {
      const top5 = s1m.categories.slice(0, 5);
      const rest = s1m.categories.slice(5);
      catDonutLabels = top5.map(x => x.name);
      catDonutData = top5.map(x => x.count);
      const restSum = rest.reduce((sum, item) => sum + item.count, 0);
      if (restSum > 0) {
        catDonutLabels.push('Kategori Lain');
        catDonutData.push(restSum);
      }
      if (top5.length > 0) topCatText = `${top5[0].name} (${top5[0].count.toLocaleString()})`;
    } else if (isSummaryOnly && s && Array.isArray(s.top_categories) && s.top_categories.length) {
      const top5 = s.top_categories.slice(0, 5);
      const rest = s.top_categories.slice(5);
      catDonutLabels = top5.map(x => x.name);
      catDonutData = top5.map(x => Math.round(x.count / 3));
      const restSum = rest.reduce((sum, item) => sum + Math.round(item.count / 3), 0);
      if (restSum > 0) {
        catDonutLabels.push('Kategori Lain');
        catDonutData.push(restSum);
      }
      if (top5.length > 0) topCatText = `${top5[0].name} (${Math.round(top5[0].count / 3).toLocaleString()})`;
    } else {
      const catCounts = {};
      t1m.forEach(t => {
        const c = t.cat || 'Lainnya';
        catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
      const top5 = sortedCats.slice(0, 5);
      const rest = sortedCats.slice(5);
      const restSum = rest.reduce((sum, item) => sum + item[1], 0);
      catDonutLabels = top5.map(x => x[0]);
      catDonutData = top5.map(x => x[1]);
      if (restSum > 0) {
        catDonutLabels.push('Kategori Lain');
        catDonutData.push(restSum);
      }
      if (top5.length > 0) topCatText = `${top5[0][0]} (${top5[0][1].toLocaleString()})`;
    }
    const totalCat = catDonutData.reduce((a, b) => a + b, 0) || 1;
    const topCatBadge = document.getElementById('dashTopCatBadge');
    if (topCatBadge && topCatText) topCatBadge.textContent = topCatText;

    const dayMap = (s1m && s1m.daily_trend) ? s1m.daily_trend : {};
    if (!s1m || !s1m.daily_trend) {
      t1m.forEach(t => {
        if (!t.open_date) return;
        const day = t.open_date.substring(0, 10);
        dayMap[day] = (dayMap[day] || 0) + 1;
      });
    }
    const sortedDays = Object.keys(dayMap).sort();
    const trendLabels = sortedDays.map(d => {
      const parts = d.split('-');
      if (parts.length === 3) {
        const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const mIdx = parseInt(parts[1], 10);
        return `${parts[2]} ${monthNames[mIdx] || parts[1]}`;
      }
      return d;
    });
    const trendDataPoints = sortedDays.map(d => dayMap[d]);

    let barCatLabels = [];
    let barCatData = [];
    if (s1m && Array.isArray(s1m.categories) && s1m.categories.length) {
      const top8 = s1m.categories.slice(0, 8);
      barCatLabels = top8.map(x => x.name);
      barCatData = top8.map(x => x.count);
    } else if (isSummaryOnly && s && Array.isArray(s.top_categories) && s.top_categories.length) {
      const top8 = s.top_categories.slice(0, 8);
      barCatLabels = top8.map(x => x.name);
      barCatData = top8.map(x => Math.round(x.count / 3));
    } else {
      const catCounts = {};
      t1m.forEach(t => {
        const c = t.cat || 'Lainnya';
        catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      barCatLabels = sortedCats.map(x => x[0]);
      barCatData = sortedCats.map(x => x[1]);
    }
    const totalBarCat = barCatData.reduce((a, b) => a + b, 0) || 1;

    let barLocLabels = [];
    let barLocData = [];
    if (s1m && Array.isArray(s1m.top_locations) && s1m.top_locations.length) {
      const top8 = s1m.top_locations.slice(0, 8);
      barLocLabels = top8.map(x => x.name);
      barLocData = top8.map(x => x.count);
    } else if (isSummaryOnly && s && Array.isArray(s.top_locations) && s.top_locations.length) {
      const top8 = s.top_locations.slice(0, 8);
      barLocLabels = top8.map(x => x.name);
      barLocData = top8.map(x => Math.round(x.count / 3));
    } else {
      const locCounts = {};
      t1m.forEach(t => {
        const l = t.loc || 'Unknown Site';
        locCounts[l] = (locCounts[l] || 0) + 1;
      });
      const sortedLocs = Object.entries(locCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      barLocLabels = sortedLocs.map(x => x[0]);
      barLocData = sortedLocs.map(x => x[1]);
    }
    const totalBarLoc = barLocData.reduce((a, b) => a + b, 0) || 1;

    // Prevent redundant chart destroy/re-animate if datasets & theme are identical
    const reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const animOpt = reducedMotion ? false : undefined;

    const renderSig = JSON.stringify({
      isDark: tc.isDark,
      reducedMotion,
      statusCounts,
      prioCounts,
      catDonutLabels,
      catDonutData,
      trendLabels,
      trendDataPoints,
      barCatLabels,
      barCatData,
      barLocLabels,
      barLocData
    });
    if (this._lastChartRenderSig === renderSig && this.dashboardCharts.status && this.dashboardCharts.priority) {
      this.setChartOverlay('hidden');
      return;
    }
    this._lastChartRenderSig = renderSig;

    // 1. Chart Donut Status (Bagan 1 - Kiri)
    const canvasStatus = document.getElementById('chartDashStatus');
    if (canvasStatus) {
      if (this.dashboardCharts.status) this.dashboardCharts.status.destroy();

      this.dashboardCharts.status = new Chart(canvasStatus.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Closed', 'Processing (assigned)', 'Processing (planned)', 'Baru & Pending', 'Solved'],
          datasets: [{
            data: [
              statusCounts.Closed,
              statusCounts.ProcessingAssigned,
              statusCounts.ProcessingPlanned,
              statusCounts['Baru / Pending'],
              statusCounts.Solved
            ],
            backgroundColor: [tc.slate, tc.cobalt, tc.amber, '#ef4444', tc.emerald],
            borderWidth: 2,
            borderColor: tc.isDark ? '#131b2e' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          animation: animOpt,
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: tc.textColor,
                font: { size: 10, weight: '600', family: "'Plus Jakarta Sans', system-ui, sans-serif" },
                usePointStyle: true,
                padding: 10,
                boxWidth: 8
              }
            },
            tooltip: {
              backgroundColor: tc.tooltipBg,
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw || 0;
                  const pct = ((val / totalStatus) * 100).toFixed(1);
                  return ` ${ctx.label}: ${val.toLocaleString()} (${pct}%)`;
                }
              }
            }
          }
        }
      });
      const capStatus = document.getElementById('captionChartDashStatus');
      if (capStatus) {
        capStatus.textContent = `Distribusi status tiket 1 bulan: Closed ${statusCounts.Closed.toLocaleString()}, Processing assigned ${statusCounts.ProcessingAssigned.toLocaleString()}, Processing planned ${statusCounts.ProcessingPlanned.toLocaleString()}, Baru & Pending ${statusCounts['Baru / Pending'].toLocaleString()}, Solved ${statusCounts.Solved.toLocaleString()}.`;
      }
    }

    // 2. Chart Donut Priority (Bagan 2 - Tengah)
    const canvasPrio = document.getElementById('chartDashPriority');
    if (canvasPrio) {
      if (this.dashboardCharts.priority) this.dashboardCharts.priority.destroy();

      this.dashboardCharts.priority = new Chart(canvasPrio.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['P0 - Kritis', 'P1 - Tinggi', 'P2 - Sedang', 'P3 - Rendah', 'P4 - Sangat Rendah'],
          datasets: [{
            data: [
              prioCounts.P0,
              prioCounts.P1,
              prioCounts.P2,
              prioCounts.P3,
              prioCounts.P4
            ],
            backgroundColor: [tc.rose, tc.orange, tc.cobalt, tc.teal, tc.slate],
            borderWidth: 2,
            borderColor: tc.isDark ? '#131b2e' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          animation: animOpt,
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: tc.textColor,
                font: { size: 10, weight: '600', family: "'Plus Jakarta Sans', system-ui, sans-serif" },
                usePointStyle: true,
                padding: 10,
                boxWidth: 8
              }
            },
            tooltip: {
              backgroundColor: tc.tooltipBg,
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw || 0;
                  const pct = ((val / totalPrio) * 100).toFixed(1);
                  return ` ${ctx.label}: ${val.toLocaleString()} (${pct}%)`;
                }
              }
            }
          }
        }
      });
      const capPrio = document.getElementById('captionChartDashPriority');
      if (capPrio) {
        capPrio.textContent = `Distribusi prioritas tiket 1 bulan: P0 Kritis ${prioCounts.P0.toLocaleString()}, P1 Tinggi ${prioCounts.P1.toLocaleString()}, P2 Sedang ${prioCounts.P2.toLocaleString()}, P3 Rendah ${prioCounts.P3.toLocaleString()}, P4 Sangat Rendah ${prioCounts.P4.toLocaleString()}.`;
      }
    }

    // 3. Chart Donut Category (Bagan 3 - Paling Kanan untuk Kategori)
    const canvasCatDonut = document.getElementById('chartDashCatDonut');
    if (canvasCatDonut) {
      if (this.dashboardCharts.catDonut) this.dashboardCharts.catDonut.destroy();

      const catColors = [
        tc.violet,
        tc.cyan,
        tc.cobalt,
        tc.amber,
        tc.rose,
        tc.slate
      ];

      this.dashboardCharts.catDonut = new Chart(canvasCatDonut.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: catDonutLabels,
          datasets: [{
            data: catDonutData,
            backgroundColor: catColors.slice(0, catDonutLabels.length),
            borderWidth: 2,
            borderColor: tc.isDark ? '#131b2e' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          animation: animOpt,
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: tc.textColor,
                font: { size: 10, weight: '600', family: "'Plus Jakarta Sans', system-ui, sans-serif" },
                usePointStyle: true,
                padding: 10,
                boxWidth: 8
              }
            },
            tooltip: {
              backgroundColor: tc.tooltipBg,
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw || 0;
                  const pct = ((val / totalCat) * 100).toFixed(1);
                  return ` ${ctx.label}: ${val.toLocaleString()} (${pct}%)`;
                }
              }
            }
          }
        }
      });
      const capCatDonut = document.getElementById('captionChartDashCatDonut');
      if (capCatDonut) {
        capCatDonut.textContent = `Distribusi kategori masalah 1 bulan: ${catDonutLabels.map((l, i) => `${l} (${(catDonutData[i] || 0).toLocaleString()})`).join(', ')}.`;
      }
    }

    // 3. Chart Daily Trend (Line / Area)
    const canvasTrend = document.getElementById('chartDashDailyTrend');
    if (canvasTrend) {
      if (this.dashboardCharts.trend) this.dashboardCharts.trend.destroy();

      const ctx = canvasTrend.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 240);
      gradient.addColorStop(0, tc.isDark ? 'rgba(59, 130, 246, 0.35)' : 'rgba(37, 99, 235, 0.2)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

      this.dashboardCharts.trend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: trendLabels,
          datasets: [{
            label: 'Volume Tiket Masuk',
            data: trendDataPoints,
            fill: true,
            backgroundColor: gradient,
            borderColor: tc.cobalt,
            borderWidth: 2.2,
            tension: 0.35,
            pointRadius: 2.5,
            pointHoverRadius: 6,
            pointBackgroundColor: tc.cobalt,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: tc.cobalt,
            pointHoverBorderWidth: 2
          }]
        },
        options: {
          animation: animOpt,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: tc.tooltipBg,
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              padding: 10,
              callbacks: {
                label: (ctx) => ` ${ctx.raw} Tiket Masuk`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: tc.textColor,
                maxTicksLimit: 15,
                font: { size: 10, family: "'Plus Jakarta Sans', system-ui, sans-serif" }
              }
            },
            y: {
              beginAtZero: true,
              grid: { color: tc.gridColor },
              ticks: {
                color: tc.textColor,
                font: { size: 10, family: "'Plus Jakarta Sans', system-ui, sans-serif" }
              }
            }
          }
        }
      });
      const capTrend = document.getElementById('captionChartDashDailyTrend');
      if (capTrend) {
        const sumTrend = trendDataPoints.reduce((a, b) => a + b, 0);
        capTrend.textContent = `Tren tiket harian dalam ${trendLabels.length} hari tercatat, total ${sumTrend.toLocaleString()} tiket masuk.`;
      }
    }

    // 4. Chart Top 8 Categories (Horizontal Bar)
    const canvasCats = document.getElementById('chartDashCategories');
    if (canvasCats) {
      if (this.dashboardCharts.cats) this.dashboardCharts.cats.destroy();

      this.dashboardCharts.cats = new Chart(canvasCats.getContext('2d'), {
        type: 'bar',
        data: {
          labels: barCatLabels,
          datasets: [{
            label: 'Jumlah Tiket',
            data: barCatData,
            backgroundColor: tc.violet,
            borderRadius: 6,
            barThickness: 18
          }]
        },
        options: {
          animation: animOpt,
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: tc.tooltipBg,
              callbacks: {
                label: (ctx) => ` ${ctx.raw.toLocaleString()} Tiket (${((ctx.raw / totalBarCat) * 100).toFixed(1)}%)`
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: tc.gridColor },
              ticks: { color: tc.textColor, font: { size: 10 } }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: tc.textColor,
                font: { size: 11, weight: '600' }
              }
            }
          }
        }
      });
      const capCats = document.getElementById('captionChartDashCategories');
      if (capCats) {
        capCats.textContent = `Top 8 kategori tiket: ${barCatLabels.map((l, i) => `${l} (${(barCatData[i] || 0).toLocaleString()})`).join(', ')}.`;
      }
    }

    // 5. Chart Top 8 Hotspot Locations (Horizontal Bar)
    const canvasLocs = document.getElementById('chartDashLocations');
    if (canvasLocs) {
      if (this.dashboardCharts.locs) this.dashboardCharts.locs.destroy();

      this.dashboardCharts.locs = new Chart(canvasLocs.getContext('2d'), {
        type: 'bar',
        data: {
          labels: barLocLabels,
          datasets: [{
            label: 'Jumlah Tiket',
            data: barLocData,
            backgroundColor: tc.orange,
            borderRadius: 6,
            barThickness: 18
          }]
        },
        options: {
          animation: animOpt,
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: tc.tooltipBg,
              callbacks: {
                label: (ctx) => ` ${ctx.raw.toLocaleString()} Tiket (${((ctx.raw / totalBarLoc) * 100).toFixed(1)}%)`
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: tc.gridColor },
              ticks: { color: tc.textColor, font: { size: 10 } }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: tc.textColor,
                font: { size: 11, weight: '600' }
              }
            }
          }
        }
      });
      const capLocs = document.getElementById('captionChartDashLocations');
      if (capLocs) {
        capLocs.textContent = `Top 8 lokasi dengan tiket terbanyak: ${barLocLabels.map((l, i) => `${l} (${(barLocData[i] || 0).toLocaleString()})`).join(', ')}.`;
      }
    }

    this.setChartOverlay('hidden');
  },

  renderDashboardCriticalTable(t1m) {
    const tbody = document.getElementById('dashCriticalTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) {
      this._lastCritTableSig = null;
      return;
    }

    if (!t1m || !t1m.length) {
      this._lastCritTableSig = 'empty';
      this.setHtml(tbody, `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            Tidak ada tiket pada 30 hari terakhir.
          </td>
        </tr>
      `);
      return;
    }

    // Filter tickets that are P0 or P1, or active (Processing/New)
    const priorityWeight = { P0: 5, P1: 4, P2: 3, P3: 2, P4: 1 };
    const criticalList = t1m.filter(t => {
      const p = (t.priority || '').toUpperCase();
      const st = (t.status || '').toLowerCase();
      const raw = (t.status_raw || '').toLowerCase();
      return p === 'P0' || p === 'P1' || st.includes('process') || raw.includes('process') || st === 'new';
    }).sort((a, b) => {
      const wa = priorityWeight[(a.priority || '').toUpperCase()] || 0;
      const wb = priorityWeight[(b.priority || '').toUpperCase()] || 0;
      if (wb !== wa) return wb - wa; // Higher priority first
      return String(b.open_date || '').localeCompare(String(a.open_date || ''));
    }).slice(0, 15);

    if (criticalList.length === 0) {
      this._lastCritTableSig = 'none';
      this.setHtml(tbody, `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2rem; color: var(--color-success); font-weight: 600;">
            ✅ Tidak ada tiket kendala kritis P0/P1 yang aktif dalam 30 hari terakhir. Semua terkendali!
          </td>
        </tr>
      `);
      return;
    }

    const critSig = criticalList.map(d => `${d.id}:${d.status}:${d.priority}:${d.last_update}`).join('|');
    if (this._lastCritTableSig === critSig && tbody.children.length > 0 && !tbody.querySelector('.table-loading-row')) {
      return;
    }
    this._lastCritTableSig = critSig;

    const rowsHtml = criticalList.map((d, index) => {
      if (!d.product || d.product === 'Uncategorized') {
        const parsed = this.parseTicketCategory(d.cat_full, d.cat);
        d.product = parsed.product;
        d.cat_issue = parsed.cat_issue;
        d.sub_issue = parsed.sub_issue;
      }

      let statusClass = 'ticket-status-closed';
      let statusIcon = '🔒';
      let statusLabel = d.status_raw || d.status || '-';
      const rawLower = (d.status_raw || '').toLowerCase();
      const stLower = (d.status || '').toLowerCase();

      if (rawLower.includes('planned') || stLower.includes('planned')) {
        statusClass = 'ticket-status-planned';
        statusIcon = '📅';
        statusLabel = 'Processing (planned)';
      } else if (rawLower.includes('assign') || stLower.includes('process')) {
        statusClass = 'ticket-status-processing';
        statusIcon = '⚙️';
        statusLabel = d.status_raw || 'Processing (assigned)';
      } else if (stLower === 'new' || rawLower.includes('new')) {
        statusClass = 'ticket-status-new';
        statusIcon = '⚡';
        statusLabel = 'New';
      } else if (stLower === 'solved' || rawLower.includes('solved')) {
        statusClass = 'ticket-status-solved';
        statusIcon = '✅';
        statusLabel = 'Solved';
      } else if (stLower === 'pending' || rawLower.includes('pending')) {
        statusClass = 'ticket-status-pending';
        statusIcon = '⏳';
        statusLabel = 'Pending';
      }

      const pRaw = d.priority || 'P2';
      const pLower = pRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const prioClass = `ticket-prio-${pLower}`;
      const idEnc = encodeURIComponent(String(d.id ?? ''));
      const glpiUrl = `https://parkee-ticket.nusa.technology/front/ticket.form.php?id=${idEnc}`;

      const eId = this.escapeHtml(d.id);
      const eOpenDate = this.escapeHtml(d.open_date || '-');
      const eLoc = this.escapeHtml(d.loc || '-');
      const eSource = this.escapeHtml(d.source || '');
      const eTitle = this.escapeHtml(d.title || '-');
      const eDesc = this.escapeHtml(d.desc || '');
      const eStatus = this.escapeHtml(statusLabel);
      const ePrio = this.escapeHtml(pRaw);
      const eTech = this.escapeHtml(d.tech || '-');
      const eReq = this.escapeHtml(d.req || '');
      const eCatFull = this.escapeHtml(d.cat_full || d.cat_issue || d.cat || '-');
      const eCatShort = this.escapeHtml(d.cat_issue || d.cat || '-');

      return `
        <tr class="ticket-clickable-row" tabindex="0" role="button" aria-label="Buka rincian kendala tiket #${eId}" data-ticket-id="${eId}" title="Klik untuk membuka rincian kendala tiket #${eId}">
          <td style="text-align: center; font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">
            ${index + 1}
          </td>
          <td>
            <a href="${glpiUrl}" target="_blank" rel="noopener noreferrer" class="ticket-id-badge" title="Buka tiket #${eId} di GLPI">
              #${eId}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </td>
          <td style="font-size: 0.76rem; color: var(--text-secondary); white-space: nowrap; font-family: var(--font-mono);">
            ${eOpenDate}
          </td>
          <td class="ticket-loc-cell">
            <div class="ticket-loc-title" title="${eLoc}">${eLoc}</div>
            ${d.source && d.source !== '-' ? `<span class="version-code-tag" style="font-size: 0.65rem;">${eSource}</span>` : ''}
          </td>
          <td class="ticket-title-cell" data-ticket-id="${eId}">
            <div class="ticket-title-text" title="${eTitle}">${eTitle}</div>
            ${d.desc ? `<div class="ticket-desc-snippet" title="${eDesc}">${eDesc}</div>` : ''}
            <div class="ticket-open-hint">
              <span>👁️ Detail Kendala</span>
            </div>
          </td>
          <td>
            <span class="ticket-status-pill ${statusClass}">
              <span aria-hidden="true">${statusIcon}</span>
              <span>${eStatus}</span>
            </span>
          </td>
          <td style="text-align: center;">
            <span class="ticket-prio-badge ${prioClass}">${ePrio}</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-main);">
            <div>${eTech}</div>
            ${d.req && d.req !== '-' ? `<div style="font-size: 0.7rem; color: var(--text-muted);">Pelapor: ${eReq}</div>` : ''}
          </td>
          <td style="font-size: 0.76rem;">
            ${this.renderProductPill(d.product)}
          </td>
          <td style="font-size: 0.74rem; color: var(--text-secondary);">
            <span class="badge-category-tag" title="${eCatFull}">
              ${eCatShort}
            </span>
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
  },

  // =========================================================================
  // MODULE 6: TICKETING (GLPI 3 BULAN TERAKHIR)
  // =========================================================================
  parseWibMs(dateStr) {
    if (!dateStr) return NaN;
    const raw = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
      return Date.parse(raw.replace(' ', 'T') + '+07:00');
    }
    return Date.parse(raw.replace(' ', 'T'));
  },

  normalizeTicketItem(t) {
    if (!t.product || t.product === 'Uncategorized') {
      const parsed = this.parseTicketCategory(t.cat_full, t.cat);
      t.product = parsed.product;
      t.cat_issue = parsed.cat_issue;
      t.sub_issue = parsed.sub_issue;
    }
    if (t.dur_solving === undefined) {
      let dur = '0:00:00';
      let durSec = 0;
      if (t.open_date && t.resolve_date) {
        const d1 = this.parseWibMs(t.open_date);
        const d2 = this.parseWibMs(t.resolve_date);
        const diff = Math.floor((d2 - d1) / 1000);
        if (diff > 0) {
          durSec = diff;
          const h = Math.floor(diff / 3600);
          const m = Math.floor((diff % 3600) / 60);
          const s = diff % 60;
          dur = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
      }
      t.dur_solving = dur;
      t.dur_seconds = durSec;
    }
  },

  normalizeTicketList(tickets) {
    if (!Array.isArray(tickets)) return;
    for (let i = 0; i < tickets.length; i++) {
      this.normalizeTicketItem(tickets[i]);
    }
  },

  async normalizeTicketListChunked(tickets) {
    if (!Array.isArray(tickets)) return;
    if (tickets.length <= 500) {
      this.normalizeTicketList(tickets);
      return;
    }
    const yieldMain = () => {
      if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
        return scheduler.yield();
      }
      return new Promise(resolve => setTimeout(resolve, 0));
    };
    const CHUNK = 1500;
    for (let i = 0; i < tickets.length; i++) {
      this.normalizeTicketItem(tickets[i]);
      if (i > 0 && i % CHUNK === 0) {
        await yieldMain();
      }
    }
  },

  async fetchTicketsSummary() {
    if (this.dataStatus.tickets !== 'ready') this.setDataStatus('tickets', 'loading');
    try {
      const res = await fetch('./data/tickets_summary.json');
      if (res.ok) {
        const sumData = await res.json();
        if (!this._fullTicketsLoaded) {
          const combined = (sumData.critical_tickets && sumData.critical_tickets.length)
            ? sumData.critical_tickets
            : (sumData.recent_tickets || []);
          this.normalizeTicketList(combined);
          if (sumData.critical_tickets) this.normalizeTicketList(sumData.critical_tickets);
          this.ticketingData = {
            meta: sumData.meta,
            stats: sumData.stats,
            stats_1m: sumData.stats_1m || null,
            critical_tickets: sumData.critical_tickets || [],
            tickets: combined
          };
          this.setDataStatus('tickets', 'ready');
          this.populateProductDropdown();
          this.populateCategoryDropdown();
          this.renderTicketingKPIs();
          this.renderDashboard();
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn('Could not load tickets_summary.json', e);
      this.failLoad('tickets', 'ringkasan tiket');
    }
  },

  // De-duplicated: the background prefetch and the Ticketing view share one request
  fetchTickets(forceRefresh = false) {
    if (this._fullTicketsLoaded && !forceRefresh) return Promise.resolve();
    if (!this._inflight.tickets) {
      this._inflight.tickets = this._loadTickets(forceRefresh).finally(() => { delete this._inflight.tickets; });
    }
    return this._inflight.tickets;
  },

  async _loadTickets(forceRefresh = false) {
    if (this.dataStatus.ticketsFull !== 'ready') this.setDataStatus('ticketsFull', 'loading');
    try {
      const url = forceRefresh ? './data/tickets.json?_t=' + Date.now() : './data/tickets.json';
      const fetchOpts = forceRefresh ? {} : { priority: 'low' };
      const res = await fetch(url, fetchOpts);
      if (res.ok) {
        const data = await res.json();
        if (data && data.tickets) await this.normalizeTicketListChunked(data.tickets);
        if (data && !data.stats_1m && this.ticketingData && this.ticketingData.stats_1m) {
          data.stats_1m = this.ticketingData.stats_1m;
        }
        this.ticketingData = data;
        this._fullTicketsLoaded = true;
        this.setDataStatus('ticketsFull', 'ready');
        this.setDataStatus('tickets', 'ready');
        this.populateProductDropdown();
        this.populateCategoryDropdown();
        this.renderTicketingKPIs();
        this.renderDashboard();
        if (this.activeView === 'ticketing') this.renderTicketingTable();
        return;
      }
    } catch (e) {
      console.warn('Could not load tickets.json', e);
    }

    // Fallback to summary if tickets.json fails
    this.failLoad('ticketsFull', 'data tiket lengkap');
    await this.fetchTicketsSummary();
  },

  renderTicketingKPIs(customList = null) {
    if (!this.ticketingData) return;
    const m = this.ticketingData.meta || {};

    // 1. Determine active date range title & subtitle label
    let rangeTitleShort = '3 Bulan';
    let rangeSubLabel = '90 Hari Terakhir';
    let topBarDateLabel = '3 Bulan Terakhir';

    const preset = this.ticketingState.datePreset;
    const sDate = this.ticketingState.startDate;
    const eDate = this.ticketingState.endDate;

    if (preset === 'today') {
      rangeTitleShort = 'Hari Ini';
      rangeSubLabel = 'Hari Ini';
      topBarDateLabel = 'Hari Ini';
    } else if (preset === '7days') {
      rangeTitleShort = '7 Hari Terakhir';
      rangeSubLabel = '7 Hari Terakhir';
      topBarDateLabel = '7 Hari Terakhir';
    } else if (preset === '30days') {
      rangeTitleShort = '30 Hari Terakhir';
      rangeSubLabel = '30 Hari Terakhir';
      topBarDateLabel = '30 Hari Terakhir';
    } else if (preset === 'this_month') {
      const nowWib = this.getWibParts();
      const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const curMonth = monthNames[nowWib.month - 1];
      rangeTitleShort = `Bulan Ini - ${curMonth}`;
      rangeSubLabel = `1 ${curMonth} - Sekarang`;
      topBarDateLabel = `Bulan Ini (${curMonth})`;
    } else if (preset === 'last_month') {
      const nowWib = this.getWibParts();
      const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const prevMonth = monthNames[(nowWib.month - 2 + 12) % 12];
      rangeTitleShort = `Bulan Lalu - ${prevMonth}`;
      rangeSubLabel = `Bulan ${prevMonth}`;
      topBarDateLabel = `Bulan Lalu (${prevMonth})`;
    } else if (preset === 'custom' || sDate || eDate) {
      if (sDate && eDate) {
        rangeTitleShort = `${sDate} s/d ${eDate}`;
        rangeSubLabel = `${sDate} s/d ${eDate}`;
        topBarDateLabel = `${sDate} s/d ${eDate}`;
      } else if (sDate) {
        rangeTitleShort = `Sejak ${sDate}`;
        rangeSubLabel = `Sejak ${sDate}`;
        topBarDateLabel = `Sejak ${sDate}`;
      } else if (eDate) {
        rangeTitleShort = `Sampai ${eDate}`;
        rangeSubLabel = `Sampai ${eDate}`;
        topBarDateLabel = `Sampai ${eDate}`;
      }
    } else {
      rangeTitleShort = '3 Bulan';
      rangeSubLabel = m.date_range_days ? `${m.date_range_days} Hari Terakhir` : '90 Hari Terakhir';
      topBarDateLabel = '3 Bulan Terakhir';
    }

    // 2. Filter tickets according to base scope (Date, Product, Category, Search) so sibling KPI cards retain their counts
    const scopeTickets = customList || this.getFilteredTickets({ ignoreStatusFilter: true });
    const total = scopeTickets.length;
    const allTotal = (this.ticketingData && this.ticketingData.tickets) ? this.ticketingData.tickets.length : (m.total || 9039);

    // 3. Compute Metrics for all 5 KPI cards within filtered scope
    let closed = 0;
    let solved = 0;
    let processingAssigned = 0;
    let processingPlanned = 0;
    let processingGeneral = 0;
    let newCount = 0;
    let pendingCount = 0;
    let p0Count = 0;
    let p1Count = 0;

    scopeTickets.forEach(t => {
      const st = (t.status || '').toLowerCase();
      const stRaw = (t.status_raw || '').toLowerCase();

      // Closed & Solved
      if (st === 'closed' || stRaw.includes('closed')) {
        closed++;
      } else if (st === 'solved' || stRaw.includes('solved')) {
        solved++;
      }

      // Processing
      if (stRaw.includes('planned') || st.includes('planned')) {
        processingPlanned++;
      } else if (stRaw.includes('assigned') || (st === 'processing' && !stRaw.includes('planned'))) {
        processingAssigned++;
      } else if (st.includes('process') || stRaw.includes('process')) {
        processingGeneral++;
      }

      // New & Pending
      if (st === 'new' || stRaw.includes('new')) {
        newCount++;
      } else if (st === 'pending' || stRaw.includes('pending') || stRaw.includes('waiting')) {
        pendingCount++;
      }

      // Priority
      if (t.priority === 'P0') p0Count++;
      else if (t.priority === 'P1') p1Count++;
    });

    const resolved = closed + solved;
    const processing = processingAssigned + processingPlanned + processingGeneral;
    const newPending = newCount + pendingCount;
    const highPrio = p0Count + p1Count;

    // 4. Determine Dynamic Filter Title & Subtitle for Card 1
    let filterLabel = '';
    const stFilter = this.ticketingState.filter;
    if (stFilter && stFilter !== 'all') {
      const fLower = stFilter.toLowerCase();
      if (fLower.includes('planned')) filterLabel = 'Processing Planned';
      else if (fLower.includes('assigned')) filterLabel = 'Processing Assigned';
      else if (fLower === 'processing') filterLabel = 'Dalam Pengerjaan';
      else if (fLower === 'new') filterLabel = 'Baru & Pending';
      else if (fLower === 'pending') filterLabel = 'Pending';
      else if (fLower === 'solved') filterLabel = 'Solved';
      else if (fLower === 'closed') filterLabel = 'Closed';
      else if (fLower === 'resolved' || fLower === 'selesai') filterLabel = 'Selesai (Closed + Solved)';
      else if (fLower === 'critical') filterLabel = 'P0/P1 Kritis';
      else filterLabel = stFilter;
    }

    let filterTag = '';
    if (filterLabel) {
      filterTag = filterLabel;
    } else if (this.ticketingState.priority && this.ticketingState.priority !== 'all') {
      filterTag = `Prioritas ${this.ticketingState.priority}`;
    } else if (this.ticketingState.product && this.ticketingState.product !== 'all') {
      filterTag = this.ticketingState.product;
    } else if (this.ticketingState.category && this.ticketingState.category !== 'all') {
      filterTag = this.ticketingState.category;
    } else if (this.ticketingState.search) {
      filterTag = `Cari "${this.ticketingState.search.substring(0, 15)}"`;
    }

    // Determine Card 1 Title
    let totalCardTitle = `Total Tiket (${rangeTitleShort})`;
    if (filterTag) {
      if (preset && preset !== 'all') {
        totalCardTitle = `Total Tiket (${filterTag} - ${rangeTitleShort})`;
      } else {
        totalCardTitle = `Total Tiket (${filterTag})`;
      }
    }

    // Determine Card 1 Subtitle
    let totalCardSub = rangeSubLabel;
    if (filterTag || (preset && preset !== 'all') || this.ticketingState.search) {
      if (total < allTotal) {
        totalCardSub = `${total.toLocaleString()} dari ${allTotal.toLocaleString()} Tiket (${rangeSubLabel})`;
      } else {
        totalCardSub = `${rangeSubLabel} (${total.toLocaleString()} Tiket)`;
      }
    }

    // 5. Update UI Elements
    // Card 1: Total Tiket
    const totalTitleEl = document.getElementById('ticketKpiTotalTitle');
    if (totalTitleEl) {
      totalTitleEl.textContent = totalCardTitle;
      totalTitleEl.title = `Filter: ${filterTag || 'Semua'} | Rentang: ${rangeSubLabel}`;
    }

    const totalEl = document.getElementById('ticketKpiTotal');
    if (totalEl) totalEl.textContent = total.toLocaleString();

    const rangeLabel = document.getElementById('ticketKpiRangeLabel');
    if (rangeLabel) {
      rangeLabel.textContent = totalCardSub;
    }

    // Card 2: Tiket Selesai
    const resolvedEl = document.getElementById('ticketKpiResolved');
    if (resolvedEl) resolvedEl.textContent = resolved.toLocaleString();

    const resolvedPctEl = document.getElementById('ticketKpiResolvedPct');
    if (resolvedPctEl) {
      if (total > 0) {
        const pct = ((resolved / total) * 100).toFixed(1);
        resolvedPctEl.textContent = `${pct}% Selesai (${closed.toLocaleString()} Closed, ${solved.toLocaleString()} Solved)`;
      } else {
        resolvedPctEl.textContent = '0% Selesai (0 Closed, 0 Solved)';
      }
    }

    // Card 3: Dalam Pengerjaan
    const procEl = document.getElementById('ticketKpiProcessing');
    if (procEl) procEl.textContent = processing.toLocaleString();

    const procSubEl = document.getElementById('ticketKpiProcessingSub');
    if (procSubEl) {
      if (processing > 0) {
        procSubEl.textContent = `${processingAssigned.toLocaleString()} Assigned, ${processingPlanned.toLocaleString()} Planned`;
      } else {
        procSubEl.textContent = '0 Assigned, 0 Planned';
      }
    }

    // Card 4: Baru & Pending
    const newPendEl = document.getElementById('ticketKpiNewPending');
    if (newPendEl) newPendEl.textContent = newPending.toLocaleString();

    const newPendSubEl = document.getElementById('ticketKpiNewPendingSub');
    if (newPendSubEl) {
      if (newPending > 0) {
        newPendSubEl.textContent = `${newCount.toLocaleString()} Baru, ${pendingCount.toLocaleString()} Pending`;
      } else {
        newPendSubEl.textContent = '0 Baru, 0 Pending';
      }
    }

    // Card 5: Prioritas P0 & P1
    const highPrioEl = document.getElementById('ticketKpiHighPrio');
    if (highPrioEl) highPrioEl.textContent = highPrio.toLocaleString();

    const highPrioSubEl = document.getElementById('ticketKpiHighPrioSub');
    if (highPrioSubEl) {
      if (highPrio > 0) {
        highPrioSubEl.textContent = `${p0Count.toLocaleString()} P0 Kritis, ${p1Count.toLocaleString()} P1 Tinggi`;
      } else {
        highPrioSubEl.textContent = '0 P0 Kritis, 0 P1 Tinggi';
      }
    }

    // Top Bar Title update (only when in ticketing view)
    if (this.activeView === 'ticketing') {
      const topTitle = document.getElementById('topBarTitle');
      if (topTitle) {
        const titleScope = filterTag ? `${filterTag} • ${topBarDateLabel}` : topBarDateLabel;
        topTitle.textContent = `Ticketing (GLPI - ${titleScope})`;
      }
    }

    // Update last sync label
    const lastSyncEl = document.getElementById('ticketLastSyncLabel');
    if (lastSyncEl && m.updated_at) {
      lastSyncEl.textContent = `Update: ${m.updated_at}`;
    }

    // Sidebar badge: keep total tickets count from database or overall
    const badge = document.getElementById('badgeTotalTickets');
    if (badge && this.ticketingData.stats) {
      badge.textContent = (this.ticketingData.stats.total || 9082).toLocaleString();
    }
  },

  setTicketStatusFilter(filterVal, fromKpiCard = false) {
    let nextFilter = filterVal || 'all';
    if (fromKpiCard && nextFilter !== 'all' && this.ticketingState.filter === nextFilter) {
      nextFilter = 'all';
    }
    this.ticketingState.filter = nextFilter;
    this.ticketingState.page = 1;

    if (nextFilter === 'Critical') {
      this.ticketingState.priority = 'all';
      const prioSel = document.getElementById('ticketPriorityFilter');
      if (prioSel) prioSel.value = 'all';
    }

    this.syncTicketFilterUI();
    this.renderTicketingTable();
  },

  syncTicketFilterUI() {
    const filterVal = this.ticketingState.filter || 'all';

    // Update pill buttons
    document.querySelectorAll('.filter-pill[data-ticket-filter]').forEach(b => {
      b.classList.toggle('active', b.dataset.ticketFilter === filterVal);
    });

    // Update status select dropdown
    const statusSel = document.getElementById('ticketStatusFilter');
    if (statusSel) {
      const validOpts = Array.from(statusSel.options).map(o => o.value);
      statusSel.value = validOpts.includes(filterVal) ? filterVal : 'all';
    }

    // Update KPI cards active state
    document.querySelectorAll('[data-ticket-kpi]').forEach(card => {
      const kpi = card.dataset.ticketKpi;
      const isActive =
        (kpi === filterVal) ||
        (kpi === 'Processing' && filterVal.toLowerCase().includes('process')) ||
        (kpi === 'Resolved' && (filterVal === 'Closed' || filterVal === 'Solved' || filterVal === 'Resolved')) ||
        (kpi === 'New' && (filterVal === 'New' || filterVal === 'Pending'));
      card.classList.toggle('kpi-active-filter', isActive);
      card.setAttribute('aria-pressed', String(isActive));
    });
  },

  // Parse category hierarchy into Product, Kategori Issue, and Sub Issue
  // Rule:
  // - Multi-level: "PARKEE OS > Software PARKEE > Human Error" -> Product: "PARKEE OS", Kategori Issue: "Software PARKEE"
  // - Single-level: "PARKEE Wuzz" -> Product: "PARKEE Wuzz", Kategori Issue: "PARKEE Wuzz"
  parseTicketCategory(catFull, catShort) {
    const raw = (catFull || catShort || '').trim();
    if (!raw || raw === '-' || raw.toLowerCase() === 'uncategorized') {
      return { product: 'Uncategorized', cat_issue: 'Uncategorized', sub_issue: '' };
    }
    const parts = raw.split('>').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        product: parts[0],
        cat_issue: parts[1],
        sub_issue: parts[2] || ''
      };
    } else if (parts.length === 1) {
      return {
        product: parts[0],
        cat_issue: parts[0],
        sub_issue: ''
      };
    }
    return { product: 'Uncategorized', cat_issue: 'Uncategorized', sub_issue: '' };
  },

  renderProductPill(product) {
    const p = (product || 'Uncategorized').trim();
    let extraClass = '';
    const pLower = p.toLowerCase();
    if (pLower.includes('wuzz')) extraClass = 'badge-product-wuzz';
    else if (pLower.includes('apps')) extraClass = 'badge-product-apps';
    else if (pLower.includes('reader')) extraClass = 'badge-product-reader';
    const escVal = this.escapeHtml(p);
    return `<span class="badge-product-pill ${extraClass}" title="${escVal}">${escVal}</span>`;
  },

  populateProductDropdown() {
    const select = document.getElementById('ticketProductFilter');
    if (!select || !this.ticketingData || !this.ticketingData.tickets) return;

    const curVal = this.ticketingState.product;
    const prodCounts = {};

    this.ticketingData.tickets.forEach(t => {
      if (!t.product || t.product === 'Uncategorized') {
        const parsed = this.parseTicketCategory(t.cat_full, t.cat);
        t.product = parsed.product;
        t.cat_issue = parsed.cat_issue;
        t.sub_issue = parsed.sub_issue;
      }
      const p = t.product || 'Uncategorized';
      prodCounts[p] = (prodCounts[p] || 0) + 1;
    });

    const sortedProds = Object.entries(prodCounts).sort((a, b) => b[1] - a[1]);

    let html = `<option value="all">Semua Produk (${this.ticketingData.tickets.length.toLocaleString()})</option>`;
    sortedProds.forEach(([prodName, count]) => {
      const selected = (prodName === curVal) ? 'selected' : '';
      const eProd = this.escapeHtml(prodName);
      html += `<option value="${eProd}" ${selected}>${eProd} (${count.toLocaleString()})</option>`;
    });

    this.setHtml(select, html);
  },

  populateCategoryDropdown() {
    const select = document.getElementById('ticketCategoryFilter');
    if (!select || !this.ticketingData || !this.ticketingData.tickets) return;

    const selectedProd = this.ticketingState.product;
    const curVal = this.ticketingState.category;

    // Requirement: "di bagian filter juga nanti pilih produk dulu baru ada dropdown ya"
    if (!selectedProd || selectedProd === 'all') {
      select.disabled = true;
      this.setHtml(select, '<option value="all">-- Pilih Produk Dahulu --</option>');
      this.ticketingState.category = 'all';
      return;
    }

    // A specific product is selected! Enable and populate its specific category issues
    select.disabled = false;

    const catCounts = {};
    const relevantTickets = this.ticketingData.tickets.filter(t =>
      (t.product || '').toLowerCase() === selectedProd.toLowerCase()
    );

    relevantTickets.forEach(t => {
      const c = t.cat_issue || t.product || 'Uncategorized';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });

    const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

    let html = `<option value="all">Semua Kategori (${this.escapeHtml(selectedProd)})</option>`;
    sortedCats.forEach(([catName, count]) => {
      const selected = (catName === curVal) ? 'selected' : '';
      const eCat = this.escapeHtml(catName);
      html += `<option value="${eCat}" ${selected}>${eCat} (${count.toLocaleString()})</option>`;
    });

    this.setHtml(select, html);
  },

  getFilteredTickets(opts = {}) {
    if (!this.ticketingData || !this.ticketingData.tickets) return [];
    let list = [...this.ticketingData.tickets];

    // 1. Search Filter
    if (this.ticketingState.search) {
      const q = this.ticketingState.search.toLowerCase();
      list = list.filter(t =>
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.loc && t.loc.toLowerCase().includes(q)) ||
        (t.tech && t.tech.toLowerCase().includes(q)) ||
        (t.product && t.product.toLowerCase().includes(q)) ||
        (t.cat_issue && t.cat_issue.toLowerCase().includes(q)) ||
        (t.cat && t.cat.toLowerCase().includes(q)) ||
        (t.desc && t.desc.toLowerCase().includes(q))
      );
    }

    // 2. Status Pill / Dropdown Filter
    if (!opts.ignoreStatusFilter && this.ticketingState.filter !== 'all') {
      const f = this.ticketingState.filter.toLowerCase();
      if (f.includes('planned')) {
        list = list.filter(t => (t.status_raw || '').toLowerCase().includes('planned') || (t.status || '').toLowerCase().includes('planned'));
      } else if (f.includes('assigned')) {
        list = list.filter(t => (t.status_raw || '').toLowerCase().includes('assigned') || ((t.status || '').toLowerCase() === 'processing' && !(t.status_raw || '').toLowerCase().includes('planned')));
      } else if (f === 'processing') {
        // Matches all processing (both assigned & planned)
        list = list.filter(t => (t.status || '').toLowerCase().includes('process') || (t.status_raw || '').toLowerCase().includes('process'));
      } else if (f === 'new') {
        list = list.filter(t => (t.status || '').toLowerCase() === 'new' || (t.status || '').toLowerCase() === 'pending' || (t.status_raw || '').toLowerCase().includes('new') || (t.status_raw || '').toLowerCase().includes('pending'));
      } else if (f === 'pending') {
        list = list.filter(t => (t.status || '').toLowerCase() === 'pending' || (t.status_raw || '').toLowerCase().includes('pending'));
      } else if (f === 'solved') {
        list = list.filter(t => (t.status || '').toLowerCase() === 'solved' || (t.status_raw || '').toLowerCase().includes('solved'));
      } else if (f === 'closed') {
        list = list.filter(t => (t.status || '').toLowerCase() === 'closed' || (t.status_raw || '').toLowerCase() === 'closed');
      } else if (f === 'resolved' || f === 'selesai') {
        list = list.filter(t => (t.status || '').toLowerCase() === 'closed' || (t.status || '').toLowerCase() === 'solved' || (t.status_raw || '').toLowerCase().includes('closed') || (t.status_raw || '').toLowerCase().includes('solved'));
      } else if (f === 'critical') {
        list = list.filter(t => t.priority === 'P0' || t.priority === 'P1');
      }
    }

    // 3. Product Dropdown Filter
    if (this.ticketingState.product && this.ticketingState.product !== 'all') {
      const prod = this.ticketingState.product.toLowerCase();
      list = list.filter(t => (t.product || '').toLowerCase() === prod);
    }

    // 4. Category Issue Dropdown Filter
    if (this.ticketingState.category && this.ticketingState.category !== 'all') {
      const cat = this.ticketingState.category.toLowerCase();
      list = list.filter(t => (t.cat_issue || t.cat || '').toLowerCase() === cat);
    }

    // 5. Priority Dropdown Filter
    if (!opts.ignoreStatusFilter && this.ticketingState.priority !== 'all') {
      list = list.filter(t => t.priority === this.ticketingState.priority);
    }

    // 6. Date Range Filter (Rentang Tanggal)
    if (this.ticketingState.startDate) {
      const s = this.ticketingState.startDate;
      list = list.filter(t => t.open_date && t.open_date >= s);
    }
    if (this.ticketingState.endDate) {
      const e = this.ticketingState.endDate + ' 23:59:59';
      list = list.filter(t => t.open_date && t.open_date <= e);
    }

    return list;
  },

  renderTicketingTable() {
    const tbody = document.getElementById('ticketTableBody');
    if (!tbody) return;
    if (this.guardTable(tbody)) return;

    this.syncTicketFilterUI();

    if (!this.ticketingData || !this.ticketingData.tickets) {
      this.setHtml(tbody, `
        <tr>
          <td colspan="11" style="text-align: center; padding: 3rem; color: var(--text-muted);">
            <div style="font-size: 1.2rem; margin-bottom: 6px;" aria-hidden="true">⏳</div>
            Memuat data tiket dari GLPI (parkee-ticket.nusa.technology)...
          </td>
        </tr>
      `);
      return;
    }

    let list = this.getFilteredTickets();

    // Dynamically update Top KPI Cards based on active date range & product/category/search scope
    this.renderTicketingKPIs();

    // Update Result Count Label
    const resCountLabel = document.getElementById('ticketResultCountLabel');
    if (resCountLabel) {
      resCountLabel.textContent = `Menampilkan ${list.length.toLocaleString()} Tiket`;
    }

    // 4. Sorting
    const col = this.ticketingState.sortCol;
    const dir = this.ticketingState.sortDir === 'desc' ? -1 : 1;

    list.sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      if (col === 'id') {
        return ((parseInt(va, 10) || 0) - (parseInt(vb, 10) || 0)) * dir;
      }
      if (col === 'dur_seconds') {
        return ((parseInt(va, 10) || 0) - (parseInt(vb, 10) || 0)) * dir;
      }
      if (col === 'open_date') {
        const sa = String(va || '');
        const sb = String(vb || '');
        return (sa < sb ? -1 : (sa > sb ? 1 : 0)) * dir;
      }

      if (col === 'product') {
        va = (a.product || 'Uncategorized').toLowerCase();
        vb = (b.product || 'Uncategorized').toLowerCase();
        return (this._collator ? this._collator.compare(va, vb) : va.localeCompare(vb)) * dir;
      }
      if (col === 'cat_issue' || col === 'category') {
        va = (a.cat_issue || 'Uncategorized').toLowerCase();
        vb = (b.cat_issue || 'Uncategorized').toLowerCase();
        return (this._collator ? this._collator.compare(va, vb) : va.localeCompare(vb)) * dir;
      }

      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
      return (this._collator ? this._collator.compare(va, vb) : va.localeCompare(vb)) * dir;
    });

    // Update Sorting arrows & aria-sort in table headers (preserve <button class="th-sort-btn">)
    document.querySelectorAll('#ticketTable th.sortable[data-ticket-sort]').forEach(th => {
      const c = th.dataset.ticketSort;
      const isSorted = c === this.ticketingState.sortCol;
      th.setAttribute('aria-sort', isSorted ? (this.ticketingState.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.style.color = isSorted ? 'var(--accent-primary)' : '';
      const icon = th.querySelector('.sort-icon');
      if (icon) {
        icon.textContent = isSorted ? (this.ticketingState.sortDir === 'asc' ? '▲' : '▼') : '⇅';
      }
    });

    // 5. Pagination
    const total = list.length;
    const pageSize = this.ticketingState.pageSize || 25;
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (this.ticketingState.page > totalPages) this.ticketingState.page = totalPages;
    if (this.ticketingState.page < 1) this.ticketingState.page = 1;

    const start = (this.ticketingState.page - 1) * pageSize;
    const end = start + pageSize;
    const paginated = list.slice(start, end);

    // Update pagination labels
    const countLabel = document.getElementById('ticketTableCountLabel');
    if (countLabel) {
      countLabel.textContent = `Menampilkan ${total === 0 ? 0 : start + 1} - ${Math.min(end, total)} dari ${total.toLocaleString()} tiket kendala`;
    }

    const pageLabel = document.getElementById('ticketCurrentPageLabel');
    if (pageLabel) {
      pageLabel.textContent = `Halaman ${this.ticketingState.page} / ${totalPages}`;
    }

    const prevBtn = document.getElementById('ticketPrevPageBtn');
    if (prevBtn) prevBtn.disabled = this.ticketingState.page <= 1;

    const nextBtn = document.getElementById('ticketNextPageBtn');
    if (nextBtn) nextBtn.disabled = this.ticketingState.page >= totalPages;

    if (paginated.length === 0) {
      this.setHtml(tbody, `
        <tr>
          <td colspan="11" style="text-align: center; padding: 2.5rem; color: var(--text-muted); font-size: 0.85rem;">
            Tidak ada tiket kendala yang cocok dengan kriteria pencarian / filter saat ini.
          </td>
        </tr>
      `);
      return;
    }

    const rowsHtml = paginated.map((d, index) => {
      const rowNo = start + index + 1;

      // Status pill
      let statusClass = 'ticket-status-closed';
      let statusIcon = '🔒';
      let statusLabel = d.status_raw || d.status || '-';
      const rawLower = (d.status_raw || '').toLowerCase();
      const st = (d.status || '').toLowerCase();

      if (rawLower.includes('planned') || st.includes('planned')) {
        statusClass = 'ticket-status-planned';
        statusIcon = '📅';
        statusLabel = 'Processing (planned)';
      } else if (rawLower.includes('assigned') || st.includes('process')) {
        statusClass = 'ticket-status-processing';
        statusIcon = '⚙️';
        statusLabel = d.status_raw || 'Processing (assigned)';
      } else if (st === 'new' || rawLower.includes('new')) {
        statusClass = 'ticket-status-new';
        statusIcon = '⚡';
        statusLabel = 'New';
      } else if (st === 'solved' || rawLower.includes('solved')) {
        statusClass = 'ticket-status-solved';
        statusIcon = '✅';
        statusLabel = 'Solved';
      } else if (st === 'pending' || rawLower.includes('pending')) {
        statusClass = 'ticket-status-pending';
        statusIcon = '⏳';
        statusLabel = 'Pending';
      }

      // Priority badge
      const pRaw = d.priority || 'P2';
      const pLower = pRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const prioClass = `ticket-prio-${pLower}`;

      const idEnc = encodeURIComponent(String(d.id ?? ''));
      const glpiUrl = `https://parkee-ticket.nusa.technology/front/ticket.form.php?id=${idEnc}`;

      const eId = this.escapeHtml(d.id);
      const eOpenDate = this.escapeHtml(d.open_date || '-');
      const eResolveDate = this.escapeHtml(d.resolve_date || '-');
      const eDur = this.escapeHtml(d.dur_solving || '0:00:00');
      const eLoc = this.escapeHtml(d.loc || '-');
      const eSource = this.escapeHtml(d.source || '');
      const eTitle = this.escapeHtml(d.title || '-');
      const eDesc = this.escapeHtml(d.desc || '');
      const eStatus = this.escapeHtml(statusLabel);
      const ePrio = this.escapeHtml(pRaw);
      const eTech = this.escapeHtml(d.tech || '-');
      const eReq = this.escapeHtml(d.req || '');
      const eCatFull = this.escapeHtml(d.cat_full || d.cat_issue || '-');
      const eCatShort = this.escapeHtml(d.cat_issue || 'Uncategorized');

      return `
        <tr class="ticket-clickable-row" tabindex="0" role="button" aria-label="Lihat rincian kendala tiket #${eId}" data-ticket-id="${eId}" title="Klik untuk melihat rincian kendala tiket #${eId}">
          <td style="text-align: center; font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">
            ${rowNo}
          </td>
          <td>
            <a href="${glpiUrl}" target="_blank" rel="noopener noreferrer" class="ticket-id-badge" title="Buka tiket #${eId} di GLPI">
              #${eId}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </td>
          <td style="font-size: 0.76rem; color: var(--text-secondary); white-space: nowrap; font-family: var(--font-mono);">
            ${eOpenDate}
          </td>
          <td style="text-align: center; white-space: nowrap;">
            <span class="badge-duration ${d.dur_seconds > 0 ? 'badge-duration-solved' : 'badge-duration-empty'}" title="Durasi Solving: Resolution Date (${eResolveDate}) dikurangi Opening Date (${eOpenDate})">
              ⏱️ ${eDur}
            </span>
          </td>
          <td class="ticket-loc-cell">
            <div class="ticket-loc-title" title="${eLoc}">${eLoc}</div>
            ${d.source && d.source !== '-' ? `<span class="version-code-tag" style="font-size: 0.65rem;">${eSource}</span>` : ''}
          </td>
          <td class="ticket-title-cell" data-ticket-id="${eId}">
            <div class="ticket-title-text" title="${eTitle}">${eTitle}</div>
            ${d.desc ? `<div class="ticket-desc-snippet" title="${eDesc}">${eDesc}</div>` : ''}
            <div class="ticket-open-hint">
              <span>👁️ Detail Kendala</span>
            </div>
          </td>
          <td>
            <span class="ticket-status-pill ${statusClass}">
              <span aria-hidden="true">${statusIcon}</span>
              <span>${eStatus}</span>
            </span>
          </td>
          <td style="text-align: center;">
            <span class="ticket-prio-badge ${prioClass}">${ePrio}</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-main);">
            <div>${eTech}</div>
            ${d.req && d.req !== '-' ? `<div style="font-size: 0.7rem; color: var(--text-muted);">Pelapor: ${eReq}</div>` : ''}
          </td>
          <td style="font-size: 0.76rem;">
            ${this.renderProductPill(d.product)}
          </td>
          <td style="font-size: 0.76rem;">
            <span class="badge-category-tag" title="${eCatFull}">
              ${eCatShort}
            </span>
          </td>
        </tr>
      `;
    }).join('');
    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  openTicketDetailModal(ticketId) {
    if (!this.ticketingData || !this.ticketingData.tickets) return;
    const ticket = this.ticketingData.tickets.find(t => String(t.id) === String(ticketId));
    if (!ticket) return;

    const modal = document.getElementById('ticketDetailModal');
    if (!modal) return;

    const idBadge = document.getElementById('modalTicketIdBadge');
    if (idBadge) idBadge.textContent = `#${ticket.id}`;

    const titleEl = document.getElementById('modalTicketTitle');
    if (titleEl) titleEl.textContent = ticket.title || `Tiket #${ticket.id}`;

    // Status Pill
    let statusClass = 'ticket-status-closed';
    let statusIcon = '🔒';
    const rawLower = (ticket.status_raw || '').toLowerCase();
    const st = (ticket.status || '').toLowerCase();
    if (rawLower.includes('planned') || st.includes('planned')) {
      statusClass = 'ticket-status-planned';
      statusIcon = '📅';
    } else if (rawLower.includes('assigned') || st.includes('process')) {
      statusClass = 'ticket-status-processing';
      statusIcon = '⚙️';
    } else if (st === 'new' || rawLower.includes('new')) {
      statusClass = 'ticket-status-new';
      statusIcon = '⚡';
    } else if (st === 'solved' || rawLower.includes('solved')) {
      statusClass = 'ticket-status-solved';
      statusIcon = '✅';
    } else if (st === 'pending' || rawLower.includes('pending')) {
      statusClass = 'ticket-status-pending';
      statusIcon = '⏳';
    }

    const statusPill = document.getElementById('modalTicketStatusPill');
    if (statusPill) {
      statusPill.className = `ticket-status-pill ${statusClass}`;
      const eStLabel = this.escapeHtml(ticket.status_raw || ticket.status || '-');
      this.setHtml(statusPill, `<span aria-hidden="true">${statusIcon}</span> <span>${eStLabel}</span>`);
    }

    // Priority badge
    const pRaw = ticket.priority || 'P2';
    const pLower = pRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const prioBadge = document.getElementById('modalTicketPrioBadge');
    if (prioBadge) {
      prioBadge.className = `ticket-prio-badge ticket-prio-${pLower}`;
      prioBadge.textContent = pRaw;
    }

    // GLPI Link
    const glpiUrl = `https://parkee-ticket.nusa.technology/front/ticket.form.php?id=${encodeURIComponent(String(ticket.id ?? ''))}`;
    const glpiLink = document.getElementById('modalTicketGlpiLink');
    if (glpiLink) glpiLink.href = glpiUrl;

    // Last update
    const lastUpdateEl = document.getElementById('modalTicketLastUpdate');
    if (lastUpdateEl) lastUpdateEl.textContent = ticket.last_update || ticket.open_date || '-';

    this._activeModalTicket = ticket;

    // Body content
    const bodyEl = document.getElementById('modalTicketBody');
    if (bodyEl) {
      const esc = (s) => (s === null || s === undefined || s === '') ? '-' : this.escapeHtml(s);
      const descContent = ticket.desc ? esc(ticket.desc) : esc(ticket.title);

      this.setHtml(bodyEl, `
        <div class="ticket-detail-grid">
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">📍 Lokasi Unit / Merchant</span>
            <span class="ticket-detail-value">${esc(ticket.loc)}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">📦 Produk PARKEE</span>
            <span class="ticket-detail-value" style="font-weight: 700; color: var(--accent-primary);">${esc(ticket.product || 'Uncategorized')}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">🏷️ Kategori Issue</span>
            <span class="ticket-detail-value" style="font-weight: 600;">${esc(ticket.cat_issue || ticket.cat || '-')}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">⏱️ Durasi Solving</span>
            <span class="ticket-detail-value">
              <span class="badge-duration ${ticket.dur_seconds > 0 ? 'badge-duration-solved' : 'badge-duration-empty'}" style="font-size: 0.8rem; padding: 3px 8px;">
                ⏱️ ${esc(ticket.dur_solving || '0:00:00')}
              </span>
            </span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">📅 Tanggal Buka (Opening)</span>
            <span class="ticket-detail-value" style="font-family: var(--font-mono);">${esc(ticket.open_date)}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">🏁 Tanggal Selesai (Resolution)</span>
            <span class="ticket-detail-value" style="font-family: var(--font-mono);">${esc(ticket.resolve_date || ticket.close_date || 'Belum Selesai (0:00:00)')}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">📂 Sub-Kategori / Jalur Rincian</span>
            <span class="ticket-detail-value" style="font-size: 0.8rem; color: var(--text-secondary);">${esc(ticket.cat_full || ticket.cat || '-')}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">👤 Teknisi Ditugaskan (PIC)</span>
            <span class="ticket-detail-value">${esc(ticket.tech)}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">📢 Pelapor (Requester)</span>
            <span class="ticket-detail-value">${esc(ticket.req)}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">📡 Sumber Laporan (Source)</span>
            <span class="ticket-detail-value">${esc(ticket.source)}</span>
          </div>
          <div class="ticket-detail-field">
            <span class="ticket-detail-label">⏱️ Terakhir Diperbarui</span>
            <span class="ticket-detail-value" style="font-family: var(--font-mono);">${esc(ticket.last_update)}</span>
          </div>
        </div>

        <div class="ticket-detail-desc-card">
          <span class="ticket-detail-label" style="font-size: 0.72rem; color: var(--text-secondary);">
            📋 Rincian Kendala &amp; Deskripsi Lengkap:
          </span>
          <div class="ticket-detail-desc-box">${descContent}</div>
        </div>
      `);
    }

    this.openNativeModal(modal);
  },

  closeTicketDetailModal() {
    const modal = document.getElementById('ticketDetailModal');
    this.closeNativeModal(modal);
    this._activeModalTicket = null;
  },

  copyTicketSummary() {
    if (!this._activeModalTicket) return;
    const t = this._activeModalTicket;
    const summary = `[PARKEE TICKET #${t.id}]
Lokasi: ${t.loc || '-'}
Kendala: ${t.title || '-'}
Status: ${t.status || '-'} (${t.priority || 'P2'})
Teknisi: ${t.tech || '-'}
Pelapor: ${t.req || '-'}
Tanggal Buka: ${t.open_date || '-'}
Rincian: ${t.desc || t.title || '-'}
GLPI: https://parkee-ticket.nusa.technology/front/ticket.form.php?id=${t.id}`;

    navigator.clipboard.writeText(summary).then(() => {
      this.showToast(`Info tiket #${t.id} berhasil disalin!`, 'success');
    }).catch(() => {
      this.showToast('Gagal menyalin ringkasan tiket ke clipboard', 'warn');
    });
  },

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================
  initEventHandlers() {
    // -----------------------------------------------------------------------
    // 1. Location Table Events
    // -----------------------------------------------------------------------
    const locSearch = document.getElementById('locSearchInput');
    if (locSearch) {
      locSearch.addEventListener('input', this.debounce((e) => {
        this.locState.search = e.target.value;
        this.locState.page = 1;
        this.renderLocationsTable();
      }, 180));
    }

    const locPageSize = document.getElementById('locPageSizeSelect');
    if (locPageSize) {
      locPageSize.addEventListener('change', (e) => {
        this.locState.pageSize = parseInt(e.target.value, 10);
        this.locState.page = 1;
        this.renderLocationsTable();
      });
    }

    document.querySelectorAll('.filter-pill[data-loc-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-loc-tier]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.locState.tier = btn.dataset.locTier;
        this.locState.page = 1;
        this.renderLocationsTable();
      });
    });

    const locReaderFilter = document.getElementById('locReaderFilter');
    if (locReaderFilter) {
      locReaderFilter.addEventListener('change', (e) => {
        this.locState.reader = e.target.value;
        this.locState.page = 1;
        this.renderLocationsTable();
      });
    }

    const locTempFilter = document.getElementById('locTempFilter');
    if (locTempFilter) {
      locTempFilter.addEventListener('change', (e) => {
        this.locState.temp = e.target.value;
        this.locState.page = 1;
        this.renderLocationsTable();
      });
    }

    const locStorageFilter = document.getElementById('locStorageFilter');
    if (locStorageFilter) {
      locStorageFilter.addEventListener('change', (e) => {
        this.locState.storage = e.target.value;
        this.locState.page = 1;
        this.renderLocationsTable();
      });
    }

    const locResetBtn = document.getElementById('locResetFiltersBtn');
    if (locResetBtn) {
      locResetBtn.addEventListener('click', () => {
        this.locState.search = '';
        this.locState.tier = 'all';
        this.locState.reader = 'all';
        this.locState.temp = 'all';
        this.locState.storage = 'all';
        this.locState.page = 1;

        if (locSearch) locSearch.value = '';
        if (locReaderFilter) locReaderFilter.value = 'all';
        if (locTempFilter) locTempFilter.value = 'all';
        if (locStorageFilter) locStorageFilter.value = 'all';

        document.querySelectorAll('.filter-pill[data-loc-tier]').forEach(b => {
          b.classList.toggle('active', b.dataset.locTier === 'all');
        });

        this.renderLocationsTable();
        this.showToast('Filter Lokasi berhasil direset', 'info');
      });
    }

    const locPrev = document.getElementById('locPrevPageBtn');
    if (locPrev) {
      locPrev.addEventListener('click', () => {
        if (this.locState.page > 1) {
          this.locState.page--;
          this.renderLocationsTable();
        }
      });
    }

    const locNext = document.getElementById('locNextPageBtn');
    if (locNext) {
      locNext.addEventListener('click', () => {
        this.locState.page++;
        this.renderLocationsTable();
      });
    }

    // -----------------------------------------------------------------------
    // 2. Server Table Events
    // -----------------------------------------------------------------------
    const serverSearch = document.getElementById('serverSearchInput');
    if (serverSearch) {
      serverSearch.addEventListener('input', this.debounce((e) => {
        this.serverState.search = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      }, 180));
    }

    const serverPageSize = document.getElementById('serverPageSizeSelect');
    if (serverPageSize) {
      serverPageSize.addEventListener('change', (e) => {
        this.serverState.pageSize = parseInt(e.target.value, 10);
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    document.querySelectorAll('.filter-pill[data-server-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-server-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const nextFilter = btn.dataset.serverFilter;
        this.serverState.filter = nextFilter;
        if (nextFilter === 'overheat') {
          this.serverState.tempRange = 'all';
          if (serverTempFilter) serverTempFilter.value = 'all';
        } else if (nextFilter === 'low_ssd') {
          this.serverState.healthRange = 'all';
          if (serverHealthFilter) serverHealthFilter.value = 'all';
        } else if (nextFilter === 'full_storage') {
          this.serverState.usageRange = 'all';
          if (serverUsageFilter) serverUsageFilter.value = 'all';
        }
        this.serverState.page = 1;
        this.renderServersTable();
      });
    });

    document.querySelectorAll('.filter-pill[data-server-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-server-tier]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.serverState.tier = btn.dataset.serverTier;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    });

    // Specific Server Dropdowns
    const serverCpuFilter = document.getElementById('serverCpuFilter');
    if (serverCpuFilter) {
      serverCpuFilter.addEventListener('change', (e) => {
        this.serverState.cpu = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverMbFilter = document.getElementById('serverMbFilter');
    if (serverMbFilter) {
      serverMbFilter.addEventListener('change', (e) => {
        this.serverState.mb = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverRamFilter = document.getElementById('serverRamFilter');
    if (serverRamFilter) {
      serverRamFilter.addEventListener('change', (e) => {
        this.serverState.ram = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverSsdTypeFilter = document.getElementById('serverSsdTypeFilter');
    if (serverSsdTypeFilter) {
      serverSsdTypeFilter.addEventListener('change', (e) => {
        this.serverState.ssdType = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverSsdBrandFilter = document.getElementById('serverSsdBrandFilter');
    if (serverSsdBrandFilter) {
      serverSsdBrandFilter.addEventListener('change', (e) => {
        this.serverState.ssdBrand = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverSsdSizeFilter = document.getElementById('serverSsdSizeFilter');
    if (serverSsdSizeFilter) {
      serverSsdSizeFilter.addEventListener('change', (e) => {
        this.serverState.ssdSize = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverTempFilter = document.getElementById('serverTempFilter');
    if (serverTempFilter) {
      serverTempFilter.addEventListener('change', (e) => {
        this.serverState.tempRange = e.target.value;
        if (e.target.value !== 'all' && this.serverState.filter === 'overheat') {
          this.serverState.filter = 'all';
          document.querySelectorAll('.filter-pill[data-server-filter]').forEach(b => {
            b.classList.toggle('active', b.dataset.serverFilter === 'all');
          });
        }
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverHealthFilter = document.getElementById('serverHealthFilter');
    if (serverHealthFilter) {
      serverHealthFilter.addEventListener('change', (e) => {
        this.serverState.healthRange = e.target.value;
        if (e.target.value !== 'all' && this.serverState.filter === 'low_ssd') {
          this.serverState.filter = 'all';
          document.querySelectorAll('.filter-pill[data-server-filter]').forEach(b => {
            b.classList.toggle('active', b.dataset.serverFilter === 'all');
          });
        }
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverUsageFilter = document.getElementById('serverUsageFilter');
    if (serverUsageFilter) {
      serverUsageFilter.addEventListener('change', (e) => {
        this.serverState.usageRange = e.target.value;
        if (e.target.value !== 'all' && this.serverState.filter === 'full_storage') {
          this.serverState.filter = 'all';
          document.querySelectorAll('.filter-pill[data-server-filter]').forEach(b => {
            b.classList.toggle('active', b.dataset.serverFilter === 'all');
          });
        }
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverResetBtn = document.getElementById('serverResetFiltersBtn');
    if (serverResetBtn) {
      serverResetBtn.addEventListener('click', () => {
        this.serverState.search = '';
        this.serverState.filter = 'all';
        this.serverState.tier = 'all';
        this.serverState.cpu = 'all';
        this.serverState.mb = 'all';
        this.serverState.ram = 'all';
        this.serverState.ssdType = 'all';
        this.serverState.ssdBrand = 'all';
        this.serverState.ssdSize = 'all';
        this.serverState.tempRange = 'all';
        this.serverState.healthRange = 'all';
        this.serverState.usageRange = 'all';
        this.serverState.page = 1;

        if (serverSearch) serverSearch.value = '';
        if (serverCpuFilter) serverCpuFilter.value = 'all';
        if (serverMbFilter) serverMbFilter.value = 'all';
        if (serverRamFilter) serverRamFilter.value = 'all';
        if (serverSsdTypeFilter) serverSsdTypeFilter.value = 'all';
        if (serverSsdBrandFilter) serverSsdBrandFilter.value = 'all';
        if (serverSsdSizeFilter) serverSsdSizeFilter.value = 'all';
        if (serverTempFilter) serverTempFilter.value = 'all';
        if (serverHealthFilter) serverHealthFilter.value = 'all';
        if (serverUsageFilter) serverUsageFilter.value = 'all';

        document.querySelectorAll('.filter-pill[data-server-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.serverFilter === 'all');
        });
        document.querySelectorAll('.filter-pill[data-server-tier]').forEach(b => {
          b.classList.toggle('active', b.dataset.serverTier === 'all');
        });

        this.renderServersTable();
        this.showToast('Filter Server berhasil direset', 'info');
      });
    }

    const serverPrev = document.getElementById('serverPrevPageBtn');
    if (serverPrev) {
      serverPrev.addEventListener('click', () => {
        if (this.serverState.page > 1) {
          this.serverState.page--;
          this.renderServersTable();
        }
      });
    }

    const serverNext = document.getElementById('serverNextPageBtn');
    if (serverNext) {
      serverNext.addEventListener('click', () => {
        this.serverState.page++;
        this.renderServersTable();
      });
    }

    // -----------------------------------------------------------------------
    // 3. Client Specification Events (50:50 Layout)
    // -----------------------------------------------------------------------
    // Sisi Kiri: All Clients Nationwide
    const allClientsSearch = document.getElementById('allClientsSearchInput');
    if (allClientsSearch) {
      allClientsSearch.addEventListener('input', this.debounce((e) => {
        this.allClientsState.search = e.target.value;
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      }, 180));
    }

    document.querySelectorAll('.filter-pill[data-client-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-client-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.allClientsState.filter = btn.dataset.clientFilter;
        // Sync dropdown if reader or temp pill is selected
        if (btn.dataset.clientFilter === 'reader' || btn.dataset.clientFilter === 'no_reader') {
          this.allClientsState.readerStatus = 'all';
          if (clientReaderFilter) clientReaderFilter.value = 'all';
        } else if (btn.dataset.clientFilter === 'warm' || btn.dataset.clientFilter === 'hot') {
          this.allClientsState.tempRange = 'all';
          if (clientTempFilter) clientTempFilter.value = 'all';
        }
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    });

    const clientReaderFilter = document.getElementById('clientReaderFilter');
    if (clientReaderFilter) {
      clientReaderFilter.addEventListener('change', (e) => {
        this.allClientsState.readerStatus = e.target.value;
        if (e.target.value !== 'all' && (this.allClientsState.filter === 'reader' || this.allClientsState.filter === 'no_reader')) {
          this.allClientsState.filter = 'all';
          document.querySelectorAll('.filter-pill[data-client-filter]').forEach(b => {
            b.classList.toggle('active', b.dataset.clientFilter === 'all');
          });
        }
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const clientReaderVerFilter = document.getElementById('clientReaderVerFilter');
    if (clientReaderVerFilter) {
      clientReaderVerFilter.addEventListener('change', (e) => {
        this.allClientsState.readerVer = e.target.value;
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const clientCpuFilter = document.getElementById('clientCpuFilter');
    if (clientCpuFilter) {
      clientCpuFilter.addEventListener('change', (e) => {
        this.allClientsState.cpu = e.target.value;
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const clientTempFilter = document.getElementById('clientTempFilter');
    if (clientTempFilter) {
      clientTempFilter.addEventListener('change', (e) => {
        this.allClientsState.tempRange = e.target.value;
        if (e.target.value !== 'all' && (this.allClientsState.filter === 'warm' || this.allClientsState.filter === 'hot')) {
          this.allClientsState.filter = 'all';
          document.querySelectorAll('.filter-pill[data-client-filter]').forEach(b => {
            b.classList.toggle('active', b.dataset.clientFilter === 'all');
          });
        }
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const allClientsPageSize = document.getElementById('allClientsPageSizeSelect');
    if (allClientsPageSize) {
      allClientsPageSize.addEventListener('change', (e) => {
        this.allClientsState.pageSize = parseInt(e.target.value, 10);
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const allClientsResetBtn = document.getElementById('allClientsResetFiltersBtn');
    if (allClientsResetBtn) {
      allClientsResetBtn.addEventListener('click', () => {
        this.allClientsState.search = '';
        this.allClientsState.filter = 'all';
        this.allClientsState.readerStatus = 'all';
        this.allClientsState.readerVer = 'all';
        this.allClientsState.cpu = 'all';
        this.allClientsState.tempRange = 'all';
        this.allClientsState.page = 1;

        if (allClientsSearch) allClientsSearch.value = '';
        if (clientReaderFilter) clientReaderFilter.value = 'all';
        if (clientReaderVerFilter) clientReaderVerFilter.value = 'all';
        if (clientCpuFilter) clientCpuFilter.value = 'all';
        if (clientTempFilter) clientTempFilter.value = 'all';

        document.querySelectorAll('.filter-pill[data-client-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.clientFilter === 'all');
        });

        this.renderAllClientsNationwideTable();
        this.showToast('Filter Klien berhasil direset', 'info');
      });
    }

    document.querySelectorAll('[data-cl-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.clSort;
        if (this.allClientsState.sortCol === col) {
          this.allClientsState.sortDir = this.allClientsState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.allClientsState.sortCol = col;
          this.allClientsState.sortDir = 'asc';
        }
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    });

    document.querySelectorAll('[data-loc-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.locSort;
        if (this.locState.sortCol === col) {
          this.locState.sortDir = this.locState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.locState.sortCol = col;
          this.locState.sortDir = 'asc';
        }
        this.locState.page = 1;
        this.renderLocationsTable();
      });
    });

    document.querySelectorAll('[data-srv-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.srvSort;
        if (this.serverState.sortCol === col) {
          this.serverState.sortDir = this.serverState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.serverState.sortCol = col;
          this.serverState.sortDir = 'asc';
        }
        this.serverState.page = 1;
        this.renderServersTable();
      });
    });

    document.querySelectorAll('[data-st-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.stSort;
        if (this.storageState.sortCol === col) {
          this.storageState.sortDir = this.storageState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.storageState.sortCol = col;
          this.storageState.sortDir = 'asc';
        }
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    });

    const clPrev = document.getElementById('allClientsPrevBtn');
    if (clPrev) {
      clPrev.addEventListener('click', () => {
        if (this.allClientsState.page > 1) {
          this.allClientsState.page--;
          this.renderAllClientsNationwideTable();
        }
      });
    }

    const clNext = document.getElementById('allClientsNextBtn');
    if (clNext) {
      clNext.addEventListener('click', () => {
        this.allClientsState.page++;
        this.renderAllClientsNationwideTable();
      });
    }

    const exportClients = document.getElementById('exportAllClientsBtn');
    if (exportClients) {
      exportClients.addEventListener('click', () => {
        const filteredClients = this.getFilteredClients();
        this.exportCsv(filteredClients, `parkee_all_clients_${filteredClients.length}.csv`);
      });
    }

    // -----------------------------------------------------------------------
    // 4. Storage Table Events
    // -----------------------------------------------------------------------
    const storageSearch = document.getElementById('storageSearchInput');
    if (storageSearch) {
      storageSearch.addEventListener('input', this.debounce((e) => {
        this.storageState.search = e.target.value;
        this.storageState.page = 1;
        this.renderStorageTable();
      }, 180));
    }

    const storagePageSize = document.getElementById('storagePageSizeSelect');
    if (storagePageSize) {
      storagePageSize.addEventListener('change', (e) => {
        this.storageState.pageSize = parseInt(e.target.value, 10);
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    document.querySelectorAll('.filter-pill[data-storage-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setStorageQuickFilter(btn.dataset.storageFilter, false);
      });
    });

    document.querySelectorAll('[data-storage-kpi]').forEach(card => {
      card.addEventListener('click', () => {
        this.setStorageQuickFilter(card.dataset.storageKpi, true);
      });
    });

    const storageTypeFilter = document.getElementById('storageTypeFilter');
    if (storageTypeFilter) {
      storageTypeFilter.addEventListener('change', (e) => {
        this.storageState.type = e.target.value;
        if (e.target.value !== 'all' && (this.storageState.filter === 'nvme' || this.storageState.filter === 'sata')) {
          this.storageState.filter = 'all';
        }
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageBrandFilter = document.getElementById('storageBrandFilter');
    if (storageBrandFilter) {
      storageBrandFilter.addEventListener('change', (e) => {
        this.storageState.brand = e.target.value;
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageCapFilter = document.getElementById('storageCapFilter');
    if (storageCapFilter) {
      storageCapFilter.addEventListener('change', (e) => {
        this.storageState.capacity = e.target.value;
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageHealthFilter = document.getElementById('storageHealthFilter');
    if (storageHealthFilter) {
      storageHealthFilter.addEventListener('change', (e) => {
        this.storageState.healthRange = e.target.value;
        if (e.target.value !== 'all' && this.storageState.filter === 'critical_health') {
          this.storageState.filter = 'all';
        }
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageUsageFilter = document.getElementById('storageUsageFilter');
    if (storageUsageFilter) {
      storageUsageFilter.addEventListener('change', (e) => {
        this.storageState.usageRange = e.target.value;
        if (e.target.value !== 'all' && this.storageState.filter === 'critical_usage') {
          this.storageState.filter = 'all';
        }
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageTierFilter = document.getElementById('storageTierFilter');
    if (storageTierFilter) {
      storageTierFilter.addEventListener('change', (e) => {
        this.storageState.tier = e.target.value;
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageResetBtn = document.getElementById('storageResetFiltersBtn');
    if (storageResetBtn) {
      storageResetBtn.addEventListener('click', () => {
        this.storageState.search = '';
        this.storageState.filter = 'all';
        this.storageState.type = 'all';
        this.storageState.brand = 'all';
        this.storageState.capacity = 'all';
        this.storageState.healthRange = 'all';
        this.storageState.usageRange = 'all';
        this.storageState.tier = 'all';
        this.storageState.page = 1;

        if (storageSearch) storageSearch.value = '';
        if (storageTypeFilter) storageTypeFilter.value = 'all';
        if (storageBrandFilter) storageBrandFilter.value = 'all';
        if (storageCapFilter) storageCapFilter.value = 'all';
        if (storageHealthFilter) storageHealthFilter.value = 'all';
        if (storageUsageFilter) storageUsageFilter.value = 'all';
        if (storageTierFilter) storageTierFilter.value = 'all';

        document.querySelectorAll('.filter-pill[data-storage-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.storageFilter === 'all');
        });

        this.renderStorageTable();
        this.showToast('Filter Storage berhasil direset', 'info');
      });
    }

    const storagePrev = document.getElementById('storagePrevPageBtn');
    if (storagePrev) {
      storagePrev.addEventListener('click', () => {
        if (this.storageState.page > 1) {
          this.storageState.page--;
          this.renderStorageTable();
        }
      });
    }

    const storageNext = document.getElementById('storageNextPageBtn');
    if (storageNext) {
      storageNext.addEventListener('click', () => {
        this.storageState.page++;
        this.renderStorageTable();
      });
    }

    // CSV Exports (respecting active filters)
    const exportLocs = document.getElementById('exportLocsCsvBtn');
    if (exportLocs) {
      exportLocs.addEventListener('click', () => {
        const list = this.getFilteredLocations();
        this.exportCsv(list, `parkee_location_information_${list.length}.csv`);
      });
    }

    const exportServers = document.getElementById('exportServersCsvBtn');
    if (exportServers) {
      exportServers.addEventListener('click', () => {
        const list = this.getFilteredServers();
        this.exportCsv(list, `parkee_server_specifications_${list.length}.csv`);
      });
    }

    const exportStorage = document.getElementById('exportStorageCsvBtn');
    if (exportStorage) {
      exportStorage.addEventListener('click', () => {
        const list = this.getFilteredStorageServers();
        this.exportCsv(list, `parkee_server_storage_${list.length}.csv`);
      });
    }

    // -----------------------------------------------------------------------
    // 5. Temperature Table Events
    // -----------------------------------------------------------------------
    const tempSearch = document.getElementById('tempSearchInput');
    if (tempSearch) {
      tempSearch.addEventListener('input', this.debounce((e) => {
        this.temperatureState.search = e.target.value;
        this.temperatureState.page = 1;
        this.renderTemperatureTable();
      }, 180));
    }

    document.querySelectorAll('.filter-pill[data-temp-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setTemperatureFilter(btn.dataset.tempFilter, false);
      });
    });

    document.querySelectorAll('[data-temp-kpi]').forEach(card => {
      card.addEventListener('click', () => {
        this.setTemperatureFilter(card.dataset.tempKpi, true);
      });
    });

    document.querySelectorAll('#tempTable th.sortable[data-temp-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.tempSort;
        if (this.temperatureState.sortCol === col) {
          this.temperatureState.sortDir = this.temperatureState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.temperatureState.sortCol = col;
          this.temperatureState.sortDir = col === 'temp' ? 'desc' : 'asc';
        }
        this.temperatureState.page = 1;
        this.renderTemperatureTable();
      });
    });

    const tempPrev = document.getElementById('tempPrevPageBtn');
    if (tempPrev) {
      tempPrev.addEventListener('click', () => {
        if (this.temperatureState.page > 1) {
          this.temperatureState.page--;
          this.renderTemperatureTable();
        }
      });
    }

    const tempNext = document.getElementById('tempNextPageBtn');
    if (tempNext) {
      tempNext.addEventListener('click', () => {
        this.temperatureState.page++;
        this.renderTemperatureTable();
      });
    }

    const tempRefresh = document.getElementById('tempRefreshBtn');
    if (tempRefresh) {
      tempRefresh.addEventListener('click', async () => {
        this.showToast('Memperbarui telemetry suhu dari Grafana...', 'info');
        await this.fetchTemperature(true);
        this.renderTemperatureTable();
        this.showToast('Data suhu server berhasil diperbarui!', 'success');
      });
    }

    const exportTemp = document.getElementById('exportTempBtn');
    if (exportTemp) {
      exportTemp.addEventListener('click', () => {
        const list = this.getFilteredTemperatureServers();
        this.exportCsv(list, `parkee_temperature_servers_${list.length}.csv`);
      });
    }

    // -----------------------------------------------------------------------
    // 6. Ticketing Table Events & Interactive KPI Cards
    // -----------------------------------------------------------------------
    const ticketSearch = document.getElementById('ticketSearchInput');
    const ticketStatusFilter = document.getElementById('ticketStatusFilter');
    const ticketProdFilter = document.getElementById('ticketProductFilter');
    const ticketCatFilter = document.getElementById('ticketCategoryFilter');
    const ticketPrioFilter = document.getElementById('ticketPriorityFilter');
    const ticketDatePreset = document.getElementById('ticketDatePreset');
    const ticketStartDate = document.getElementById('ticketStartDate');
    const ticketEndDate = document.getElementById('ticketEndDate');

    // Initial DOM State Sync in case browser restored form inputs on page refresh
    if (ticketDatePreset && ticketDatePreset.value && ticketDatePreset.value !== 'all') {
      this.ticketingState.datePreset = ticketDatePreset.value;
    }
    if (ticketStartDate && ticketStartDate.value) {
      this.ticketingState.startDate = ticketStartDate.value;
    }
    if (ticketEndDate && ticketEndDate.value) {
      this.ticketingState.endDate = ticketEndDate.value;
    }
    if (ticketStatusFilter && ticketStatusFilter.value && ticketStatusFilter.value !== 'all') {
      this.ticketingState.filter = ticketStatusFilter.value;
    }
    if (ticketProdFilter && ticketProdFilter.value && ticketProdFilter.value !== 'all') {
      this.ticketingState.product = ticketProdFilter.value;
    }
    if (ticketPrioFilter && ticketPrioFilter.value && ticketPrioFilter.value !== 'all') {
      this.ticketingState.priority = ticketPrioFilter.value;
    }
    if (ticketSearch && ticketSearch.value) {
      this.ticketingState.search = ticketSearch.value;
    }

    // Interactive Top KPI Cards (Quick-Filter by Click)
    const cardKpiTotal = document.getElementById('cardKpiTotal');
    if (cardKpiTotal) {
      cardKpiTotal.addEventListener('click', () => {
        this.setTicketStatusFilter('all', true);
      });
    }

    const cardKpiResolved = document.getElementById('cardKpiResolved');
    if (cardKpiResolved) {
      cardKpiResolved.addEventListener('click', () => {
        this.setTicketStatusFilter('Resolved', true);
      });
    }

    const cardKpiProcessing = document.getElementById('cardKpiProcessing');
    if (cardKpiProcessing) {
      cardKpiProcessing.addEventListener('click', () => {
        this.setTicketStatusFilter('Processing', true);
      });
    }

    const cardKpiNewPending = document.getElementById('cardKpiNewPending');
    if (cardKpiNewPending) {
      cardKpiNewPending.addEventListener('click', () => {
        this.setTicketStatusFilter('New', true);
      });
    }

    const cardKpiHighPrio = document.getElementById('cardKpiHighPrio');
    if (cardKpiHighPrio) {
      cardKpiHighPrio.addEventListener('click', () => {
        this.setTicketStatusFilter('Critical', true);
      });
    }

    // Dashboard Top KPI Cards -> Jump to Ticketing View with matching filter (Last 30 Days)
    document.querySelectorAll('[data-dash-kpi]').forEach(card => {
      card.addEventListener('click', () => {
        const filterVal = card.dataset.dashKpi || 'all';
        if (ticketDatePreset && ticketDatePreset.value !== '30days') {
          ticketDatePreset.value = '30days';
          ticketDatePreset.dispatchEvent(new Event('change'));
        }
        this.setTicketStatusFilter(filterVal, false);
        const ticketNav = document.querySelector('.sidebar-nav-btn[data-view="ticketing"]');
        if (ticketNav) ticketNav.click();
      });
    });

    // Search Input Event
    if (ticketSearch) {
      ticketSearch.addEventListener('input', this.debounce((e) => {
        this.ticketingState.search = e.target.value;
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      }, 180));
    }

    // Status Filter Pills
    document.querySelectorAll('.filter-pill[data-ticket-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setTicketStatusFilter(btn.dataset.ticketFilter);
      });
    });

    // Status Select Dropdown
    if (ticketStatusFilter) {
      ticketStatusFilter.addEventListener('change', (e) => {
        this.setTicketStatusFilter(e.target.value);
      });
    }

    // Product Dropdown Filter
    if (ticketProdFilter) {
      ticketProdFilter.addEventListener('change', (e) => {
        this.ticketingState.product = e.target.value;
        this.ticketingState.category = 'all';
        this.populateCategoryDropdown();
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      });
    }

    // Category Dropdown Filter
    if (ticketCatFilter) {
      ticketCatFilter.addEventListener('change', (e) => {
        this.ticketingState.category = e.target.value;
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      });
    }

    // Priority Dropdown Filter
    if (ticketPrioFilter) {
      ticketPrioFilter.addEventListener('change', (e) => {
        this.ticketingState.priority = e.target.value;
        if (e.target.value !== 'all' && this.ticketingState.filter === 'Critical') {
          this.ticketingState.filter = 'all';
        }
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      });
    }

    // Rentang Tanggal (Date Range) Events — computed cleanly in Asia/Jakarta (WIB)
    const formatUtcDateStr = (utcDate) => {
      const year = utcDate.getUTCFullYear();
      const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(utcDate.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (ticketDatePreset) {
      ticketDatePreset.addEventListener('change', (e) => {
        const val = e.target.value;
        const wibNow = this.getWibParts(new Date());
        const wibTodayUtc = new Date(Date.UTC(wibNow.year, wibNow.month - 1, wibNow.day));
        let start = '';
        let end = '';

        if (val === 'today') {
          start = formatUtcDateStr(wibTodayUtc);
          end = start;
        } else if (val === '7days') {
          const d = new Date(wibTodayUtc.getTime());
          d.setUTCDate(d.getUTCDate() - 7);
          start = formatUtcDateStr(d);
          end = formatUtcDateStr(wibTodayUtc);
        } else if (val === '30days') {
          const d = new Date(wibTodayUtc.getTime());
          d.setUTCDate(d.getUTCDate() - 30);
          start = formatUtcDateStr(d);
          end = formatUtcDateStr(wibTodayUtc);
        } else if (val === 'this_month') {
          start = formatUtcDateStr(new Date(Date.UTC(wibNow.year, wibNow.month - 1, 1)));
          end = formatUtcDateStr(wibTodayUtc);
        } else if (val === 'last_month') {
          start = formatUtcDateStr(new Date(Date.UTC(wibNow.year, wibNow.month - 2, 1)));
          end = formatUtcDateStr(new Date(Date.UTC(wibNow.year, wibNow.month - 1, 0)));
        } else if (val === 'all') {
          start = '';
          end = '';
        }

        if (ticketStartDate) ticketStartDate.value = start;
        if (ticketEndDate) ticketEndDate.value = end;

        this.ticketingState.startDate = start;
        this.ticketingState.endDate = end;
        this.ticketingState.datePreset = val;
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      });
    }

    const handleCustomDateChange = () => {
      const s = ticketStartDate ? ticketStartDate.value : '';
      const e = ticketEndDate ? ticketEndDate.value : '';
      if (s && e && s > e) {
        this.showToast('Tanggal awal tidak boleh melebihi tanggal akhir', 'warn');
        return;
      }
      this.ticketingState.startDate = s;
      this.ticketingState.endDate = e;
      this.ticketingState.datePreset = 'custom';
      if (ticketDatePreset) ticketDatePreset.value = 'custom';
      this.ticketingState.page = 1;
      this.renderTicketingTable();
    };
    const debouncedDateChange = this.debounce(handleCustomDateChange, 180);

    if (ticketStartDate) {
      ticketStartDate.addEventListener('change', handleCustomDateChange);
      ticketStartDate.addEventListener('input', debouncedDateChange);
    }

    if (ticketEndDate) {
      ticketEndDate.addEventListener('change', handleCustomDateChange);
      ticketEndDate.addEventListener('input', debouncedDateChange);
    }

    const ticketResetBtn = document.getElementById('ticketResetFiltersBtn');
    if (ticketResetBtn) {
      ticketResetBtn.addEventListener('click', () => {
        this.ticketingState.search = '';
        this.ticketingState.filter = 'all';
        this.ticketingState.priority = 'all';
        this.ticketingState.product = 'all';
        this.ticketingState.category = 'all';
        this.ticketingState.startDate = '';
        this.ticketingState.endDate = '';
        this.ticketingState.datePreset = 'all';
        this.ticketingState.page = 1;

        if (ticketSearch) ticketSearch.value = '';
        if (ticketStatusFilter) ticketStatusFilter.value = 'all';
        if (ticketPrioFilter) ticketPrioFilter.value = 'all';
        if (ticketProdFilter) ticketProdFilter.value = 'all';
        this.populateCategoryDropdown();
        if (ticketCatFilter) ticketCatFilter.value = 'all';
        if (ticketStartDate) ticketStartDate.value = '';
        if (ticketEndDate) ticketEndDate.value = '';
        if (ticketDatePreset) ticketDatePreset.value = 'all';

        document.querySelectorAll('.filter-pill[data-ticket-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.ticketFilter === 'all');
        });

        this.renderTicketingTable();
        this.showToast('Filter Tiket berhasil direset', 'info');
      });
    }

    const ticketPageSize = document.getElementById('ticketPageSizeSelect');
    if (ticketPageSize) {
      ticketPageSize.addEventListener('change', (e) => {
        this.ticketingState.pageSize = parseInt(e.target.value, 10);
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      });
    }

    document.querySelectorAll('#ticketTable th.sortable[data-ticket-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.ticketSort;
        if (this.ticketingState.sortCol === col) {
          this.ticketingState.sortDir = this.ticketingState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.ticketingState.sortCol = col;
          this.ticketingState.sortDir = (col === 'open_date' || col === 'id') ? 'desc' : 'asc';
        }
        this.ticketingState.page = 1;
        this.renderTicketingTable();
      });
    });

    const ticketPrev = document.getElementById('ticketPrevPageBtn');
    if (ticketPrev) {
      ticketPrev.addEventListener('click', () => {
        if (this.ticketingState.page > 1) {
          this.ticketingState.page--;
          this.renderTicketingTable();
        }
      });
    }

    const ticketNext = document.getElementById('ticketNextPageBtn');
    if (ticketNext) {
      ticketNext.addEventListener('click', () => {
        this.ticketingState.page++;
        this.renderTicketingTable();
      });
    }

    const ticketRefresh = document.getElementById('ticketRefreshBtn');
    if (ticketRefresh) {
      ticketRefresh.addEventListener('click', async () => {
        this.showToast('Memperbarui data tiket dari GLPI...', 'info');
        await this.fetchTickets(true);
        this.renderTicketingTable();
        this.showToast('Data tiket berhasil diperbarui!', 'success');
      });
    }

    const exportTickets = document.getElementById('exportTicketsBtn');
    if (exportTickets) {
      exportTickets.addEventListener('click', () => {
        if (this.ticketingData && this.ticketingData.tickets) {
          const list = this.getFilteredTickets();
          this.exportCsv(list, `parkee_glpi_tickets_${list.length}.csv`);
        }
      });
    }

    const bindTicketRowEvents = (tbody) => {
      if (!tbody) return;
      tbody.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        const row = e.target.closest('[data-ticket-id]');
        if (row && row.dataset.ticketId) {
          this.openTicketDetailModal(row.dataset.ticketId);
        }
      });
      tbody.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('a, button')) return;
        const row = e.target.closest('.ticket-clickable-row[data-ticket-id]');
        if (row && row.dataset.ticketId) {
          e.preventDefault();
          this.openTicketDetailModal(row.dataset.ticketId);
        }
      });
    };

    bindTicketRowEvents(document.getElementById('ticketTableBody'));
    bindTicketRowEvents(document.getElementById('dashCriticalTableBody'));

    if (!this._actionDelegationBound) {
      this._actionDelegationBound = true;
      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-action]');
        if (!trigger) return;
        const action = trigger.dataset.action;
        if (action === 'retry-load' && trigger.dataset.retryKey) {
          this.retryLoad(trigger.dataset.retryKey);
        } else if (action === 'reload-page') {
          window.location.reload();
        } else if (action === 'jump-client-spec' && trigger.dataset.loc) {
          this.jumpToClientSpec(trigger.dataset.loc);
        } else if (action === 'modal-jump-clients' && trigger.dataset.loc) {
          this.closeNativeModal(document.getElementById('deviceDetailModal'));
          this.jumpToClientSpec(trigger.dataset.loc);
        } else if (action === 'modal-jump-server' && trigger.dataset.loc) {
          this.closeNativeModal(document.getElementById('deviceDetailModal'));
          this.jumpToServerSpec(trigger.dataset.loc);
        } else if (action === 'copy-device-modal') {
          this.copyDeviceModalSummary();
        } else if (action === 'close-device-modal') {
          this.closeNativeModal(document.getElementById('deviceDetailModal'));
        } else if (action === 'open-location-modal') {
          this.openLocationDetailModal(trigger.dataset.loc, trigger.dataset.code);
        } else if (action === 'open-server-modal') {
          this.openServerDetailModal(trigger.dataset.host, trigger.dataset.code, trigger.dataset.loc);
        } else if (action === 'open-client-modal') {
          this.openClientDetailModal(trigger.dataset.host, trigger.dataset.loc, trigger.dataset.ip);
        } else if (action === 'open-backup-modal') {
          this.openBackupDetailModal(trigger.dataset.code, trigger.dataset.loc);
        } else if (action === 'copy-text' && trigger.dataset.copyText !== undefined) {
          e.stopPropagation();
          this.copyToClipboard(trigger.dataset.copyText);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('a, button, input, select, textarea')) return;
        const row = e.target.closest('.clickable-row[data-action]');
        if (!row) return;
        e.preventDefault();
        const action = row.dataset.action;
        if (action === 'open-location-modal') {
          this.openLocationDetailModal(row.dataset.loc, row.dataset.code);
        } else if (action === 'open-server-modal') {
          this.openServerDetailModal(row.dataset.host, row.dataset.code, row.dataset.loc);
        } else if (action === 'open-client-modal') {
          this.openClientDetailModal(row.dataset.host, row.dataset.loc, row.dataset.ip);
        } else if (action === 'open-backup-modal') {
          this.openBackupDetailModal(row.dataset.code, row.dataset.loc);
        }
      });
    }

    // Dashboard Go to Ticketing View Button
    const dashGoToTicketing = document.getElementById('dashGoToTicketingBtn');
    if (dashGoToTicketing) {
      dashGoToTicketing.addEventListener('click', () => {
        const ticketNav = document.querySelector('.sidebar-nav-btn[data-view="ticketing"]');
        if (ticketNav) ticketNav.click();
      });
    }

    this.initBackupEventHandlers();
  },

  parseRamGb(ramStr) {
    if (!ramStr) return 0;
    const num = parseFloat(String(ramStr).replace(',', '.'));
    return isNaN(num) ? 0 : num;
  },

  parseStorageGb(sizeStr) {
    if (!sizeStr) return 0;
    const s = String(sizeStr).toUpperCase().replace(',', '.');
    if (s.includes('T')) {
      const val = parseFloat(s.replace(/[^0-9.]/g, ''));
      return (isNaN(val) ? 1 : val) * 1000;
    }
    const val = parseFloat(s.replace(/[^0-9.]/g, ''));
    return isNaN(val) ? 0 : val;
  },

  sortData(list, col, dir) {
    return list.slice().sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      const isNullA = (va === null || va === undefined || va === '' || va === '-');
      const isNullB = (vb === null || vb === undefined || vb === '' || vb === '-');
      if (isNullA && isNullB) return 0;
      if (isNullA) return 1;
      if (isNullB) return -1;

      if (col === 'ssd_size' || col === 'capacity') {
        const numA = this.parseStorageGb(va);
        const numB = this.parseStorageGb(vb);
        if (numA !== numB) return (numA - numB) * dir;
      } else if (col === 'ram') {
        const numA = parseFloat(String(va).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
        const numB = parseFloat(String(vb).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
        if (numA !== numB) return (numA - numB) * dir;
      }

      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }

      const strA = String(va).trim();
      const strB = String(vb).trim();
      return this._collator.compare(strA, strB) * dir;
    });
  },

  updateSortIndicators(tableContainerSelector, attrName, currentSortCol, currentSortDir) {
    const container = document.querySelector(tableContainerSelector);
    if (!container) return;
    container.querySelectorAll(`th[${attrName}]`).forEach(th => {
      const col = th.getAttribute(attrName);
      const isActive = col === currentSortCol;
      th.classList.toggle('sort-active', isActive);
      th.setAttribute('aria-sort', isActive ? (currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      const iconEl = th.querySelector('.sort-icon');
      if (iconEl) {
        iconEl.textContent = isActive ? (currentSortDir === 'asc' ? '▲' : '▼') : '⇅';
        iconEl.style.opacity = isActive ? '1' : '0.35';
      }
    });
  },

  // =========================================================================
  // MODAL & UTILS
  // =========================================================================
  initModal() {
    const restoreFocus = () => {
      if (this._lastFocusedEl && typeof this._lastFocusedEl.focus === 'function' && document.contains(this._lastFocusedEl)) {
        this._lastFocusedEl.focus({ preventScroll: true });
      }
      this._lastFocusedEl = null;
    };

    // 1. Device Modal (<dialog closedby="any">)
    const modal = document.getElementById('deviceDetailModal');
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => this.closeNativeModal(modal));
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeNativeModal(modal);
      });
      modal.addEventListener('close', restoreFocus);
    }

    // 2. Ticket Detail Modal (<dialog closedby="any">)
    const ticketModal = document.getElementById('ticketDetailModal');
    const ticketCloseBtn = document.getElementById('modalTicketCloseBtn');
    const ticketCloseBtnBottom = document.getElementById('modalTicketCloseBtnBottom');
    const ticketCopyBtn = document.getElementById('modalTicketCopyBtn');

    if (ticketCloseBtn && ticketModal) {
      ticketCloseBtn.addEventListener('click', () => this.closeTicketDetailModal());
    }
    if (ticketCloseBtnBottom && ticketModal) {
      ticketCloseBtnBottom.addEventListener('click', () => this.closeTicketDetailModal());
    }
    if (ticketCopyBtn) {
      ticketCopyBtn.addEventListener('click', () => this.copyTicketSummary());
    }
    if (ticketModal) {
      ticketModal.addEventListener('click', (e) => {
        if (e.target === ticketModal) this.closeTicketDetailModal();
      });
      ticketModal.addEventListener('close', restoreFocus);
    }

    // 3. Copy Invoker Commands (--copy) with progressive fallback
    if (!this._copyCommandBound) {
      this._copyCommandBound = true;
      if ('CommandEvent' in window) {
        document.addEventListener('command', (event) => {
          if (event.command === '--copy' && event.source && event.target) {
            this.copyFromInvoker(event.source, event.target);
          }
        }, true);
      } else {
        document.addEventListener('click', (event) => {
          if (event.defaultPrevented) return;
          const button = event.target.closest('button[command="--copy"]');
          if (!button) return;
          const target = document.getElementById(button.getAttribute('commandfor'));
          if (target) this.copyFromInvoker(button, target);
        });
      }
    }
  },

  formatCpu(raw) {
    if (!raw || raw === '-' || raw.toLowerCase() === 'other cpu' || raw.toLowerCase() === 'other') return '-';
    let s = String(raw)
      .replace(/\((?:R|TM)\)/gi, '')
      .replace(/\bCPU\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s || '-';
  },

  formatRam(raw, brand) {
    if (!raw || raw === '-' || raw === '0') return '-';
    let s = String(raw).trim();
    if (s.toLowerCase() === 'other' || s.toLowerCase() === 'other brand' || s === '-' || s.toLowerCase() === '- (other)') return '-';
    
    // Check if brand is meaningful
    let b = (brand || '').trim();
    const isBrandValid = b && 
      b !== '-' && 
      b.toLowerCase() !== 'other' && 
      b.toLowerCase() !== 'other brand' && 
      !b.toLowerCase().startsWith('0x') && 
      !b.toLowerCase().includes('unknown');

    return isBrandValid ? `${s} (${b})` : s;
  },

  formatMb(raw, brand) {
    let b = (brand || '').trim();
    const isBrandValid = b && 
      b !== '-' && 
      b.toLowerCase() !== 'other' && 
      b.toLowerCase() !== 'other brand' && 
      b.toLowerCase() !== 'default string';
    const cleanBrand = isBrandValid ? b : '';

    if (!raw || raw.toLowerCase().includes('default string') || raw.toLowerCase() === 'other' || raw.toLowerCase() === 'other brand' || raw === '-') {
      return cleanBrand || '-';
    }
    let s = String(raw)
      .replace(/ASUSTeK COMPUTER INC\./gi, 'ASUS')
      .replace(/Micro-Star International Co\., Ltd\./gi, 'MSI')
      .replace(/Gigabyte Technology Co\., Ltd\./gi, 'Gigabyte')
      .replace(/BIOSTAR Group/gi, 'Biostar')
      .replace(/Intel Corporation/gi, 'Intel')
      .replace(/Dell Inc\./gi, 'Dell')
      .replace(/Hewlett-Packard/gi, 'HP')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.toLowerCase() === 'other' || s.toLowerCase() === 'other brand' || s === '-' || s.toLowerCase().includes('default string')) {
      return cleanBrand || '-';
    }
    return s || cleanBrand || '-';
  },

  formatBrand(brand) {
    if (!brand || brand === '-' || brand.toLowerCase() === 'other' || brand.toLowerCase() === 'other brand') return '-';
    return brand.trim();
  },

  formatSize(size) {
    if (!size || size === '-' || size === '0' || size === '0B' || size.toLowerCase() === 'other') return '-';
    return size.trim();
  },

  formatOs(raw) {
    if (!raw || raw === '-' || raw.toLowerCase() === 'other' || raw.toLowerCase() === 'other os') return '-';
    let s = String(raw).trim();
    if (s.startsWith('-')) return '-';
    return s.split('(')[0].trim() || '-';
  },

  formatFullOs(raw) {
    if (!raw || raw === '-' || raw.toLowerCase() === 'other' || raw.toLowerCase() === 'other os') return '-';
    let s = String(raw).replace(/\s+/g, ' ').trim();
    if (s.startsWith('-')) return '-';
    return s || '-';
  },

  formatFullVersion(raw) {
    if (!raw || raw === '-' || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'unset') return '-';
    const s = String(raw).trim();
    if (s.startsWith('-')) return '-';
    return s;
  },

  formatVersion(raw) {
    if (!raw || raw === '-' || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'unset') return '-';
    const s = String(raw).trim();
    if (s.startsWith('-')) return '-';
    return s.split('-')[0].trim() || s;
  },

  formatStorageSummary(brand, type, size) {
    const b = this.formatBrand(brand);
    const s = this.formatSize(size);
    const t = (type && type !== '-' && type !== 'Other') ? type : '';
    const parts = [];
    if (b !== '-') parts.push(b);
    if (t) parts.push(`(${t})`);
    if (s !== '-') parts.push(s);
    return parts.length > 0 ? parts.join(' ') : '-';
  },

  formatNominalRam(raw) {
    if (raw === null || raw === undefined) return '-';
    const s = String(raw).trim();
    const low = s.toLowerCase();
    if (!s || s === '-' || s === '0' || low === 'other' || low === 'other brand' || low === '- (other)' || low === 'none') {
      return '-';
    }

    const m = s.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*([TGMK]?i?B?)?/i);
    if (!m) return s;
    let gb = parseFloat(m[1]);
    if (isNaN(gb) || gb <= 0) return s;

    const unit = (m[2] || '').toUpperCase();
    if (unit.startsWith('T')) gb *= 1024;
    else if (unit.startsWith('M')) gb /= 1024;

    if (gb >= 0.7 && gb <= 1.15) return '1GB';
    if (gb >= 1.4 && gb <= 2.15) return '2GB';
    if (gb >= 2.4 && gb <= 3.15) return '3GB';
    if (gb > 3.15 && gb <= 4.15) return '4GB';
    if (gb >= 4.4 && gb <= 5.15) return '5GB';
    if (gb > 5.15 && gb <= 6.2) return '6GB';
    if (gb >= 6.8 && gb <= 8.2) return '8GB';
    if (gb >= 8.8 && gb <= 10.2) return '10GB';
    if (gb >= 10.4 && gb <= 12.2) return '12GB';
    if (gb >= 13.5 && gb <= 16.3) return '16GB';
    if (gb >= 17.5 && gb <= 20.5) return '20GB';
    if (gb >= 21.5 && gb <= 24.5) return '24GB';
    if (gb >= 28.0 && gb <= 32.5) return '32GB';
    if (gb >= 44.0 && gb <= 48.5) return '48GB';
    if (gb >= 58.0 && gb <= 64.5) return '64GB';
    if (gb >= 88.0 && gb <= 96.5) return '96GB';
    if (gb >= 116.0 && gb <= 128.5) return '128GB';
    if (gb >= 178.0 && gb <= 192.5) return '192GB';
    if (gb >= 235.0 && gb <= 256.5) return '256GB';
    if (gb >= 470.0 && gb <= 512.5) return '512GB';
    return `${Math.round(gb)}GB`;
  },

  formatNominalStorageSize(sizeRaw) {
    if (sizeRaw === null || sizeRaw === undefined) return '';
    const s = String(sizeRaw).trim();
    const low = s.toLowerCase();
    if (!s || s === '-' || s === '0' || low === '0b' || low === 'other' || low === 'other brand' || low === 'none') {
      return '';
    }
    const m = s.replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*([TGMK]?i?B?)?$/i);
    if (!m) return '';
    let gb = parseFloat(m[1]);
    if (isNaN(gb) || gb <= 0) return '';
    const unit = (m[2] || '').toUpperCase();
    if (unit.startsWith('T')) gb *= 1000;

    if (gb >= 3500 && gb <= 4100) return '4TB';
    if (gb >= 1700 && gb <= 2050) return '2TB';
    if (gb >= 900 && gb <= 1050) return '1TB';
    if (gb >= 470 && gb <= 515) return '512GB';
    if (gb >= 455 && gb < 470) return '500GB';
    if (gb >= 435 && gb < 455) return '480GB';
    if (gb >= 235 && gb <= 260) return '256GB';
    if (gb >= 228 && gb < 235) return '250GB';
    if (gb >= 215 && gb < 228) return '240GB';
    if (gb >= 115 && gb <= 130) return '128GB';
    if (gb >= 105 && gb < 115) return '120GB';
    return s.replace(',', '.');
  },

  formatPrimarySsdSpec(dev) {
    let model = String(dev?.ssd_model || '').replace(/\s+/g, ' ').trim();
    const modelLow = model.toLowerCase();
    if (!model || model === '-' || modelLow === 'other' || modelLow === 'other brand' || modelLow === 'none' || modelLow === '0') {
      model = '';
    } else {
      model = model.replace(/\s+with$/i, '').trim();
    }

    const nomSize = this.formatNominalStorageSize(dev?.ssd_size);
    let ssdName = '-';

    if (model) {
      const hasCap = /(?:\b\d+(?:\.\d+)?\s*(?:TB|GB|MB)\b|(?:1TB|2TB|4TB|1000GB|512GB|500GB|480GB|256GB|250GB|240GB|128GB|120GB)|\b(?:1|2|4)T\b)/i.test(model);
      ssdName = (!hasCap && nomSize) ? `${model} ${nomSize}` : model;
    } else {
      const brand = this.formatBrand(dev?.ssd_brand);
      const type = (dev?.ssd_type && dev.ssd_type !== '-' && dev.ssd_type !== 'Other') ? dev.ssd_type : '';
      const parts = [];
      if (brand !== '-') parts.push(brand);
      if (type) parts.push(type);
      if (nomSize) parts.push(nomSize);
      if (parts.length > 0) ssdName = parts.join(' ');
    }

    const hasHealth = dev?.ssd_health !== null && dev?.ssd_health !== undefined && String(dev.ssd_health).trim() !== '';
    if (ssdName === '-' && !hasHealth) return '-';
    if (ssdName === '-' && hasHealth) return `Health ${dev.ssd_health}%`;
    return hasHealth ? `${ssdName} - Health ${dev.ssd_health}%` : ssdName;
  },

  formatPrimarySpecText(dev) {
    const rawCpu = String(dev?.cpu || '').replace(/\s+/g, ' ').trim();
    const cpuLow = rawCpu.toLowerCase();
    const cpu = (rawCpu && rawCpu !== '-' && cpuLow !== 'other' && cpuLow !== 'other cpu') ? rawCpu : '-';

    const rawMb = String(dev?.mb || '').replace(/\s+/g, ' ').trim();
    const mbLow = rawMb.toLowerCase();
    const mb = (rawMb && rawMb !== '-' && !mbLow.includes('default string') && mbLow !== 'other' && mbLow !== 'other brand')
      ? rawMb
      : (this.formatMb(dev?.mb, dev?.mb_brand) || '-');

    const ram = this.formatNominalRam(dev?.ram);
    const ssd = this.formatPrimarySsdSpec(dev);

    return `* Processor: ${cpu}\n* Motherboard: ${mb}\n* RAM: ${ram}\n* SSD: ${ssd}`;
  },

  buildPrimarySpecBlockHtml(dev, options = {}) {
    const label = options.label || 'Spesifikasi Utama';
    const targetId = options.targetId || 'modalPrimarySpecText';
    const specText = this.formatPrimarySpecText(dev);

    const metaItems = [];
    if (dev?.ssd_usage !== null && dev?.ssd_usage !== undefined && String(dev.ssd_usage).trim() !== '') {
      metaItems.push(`Disk Usage: ${this.escapeHtml(dev.ssd_usage)}%`);
    }
    if (dev?.ssd_type && dev.ssd_type !== '-' && dev.ssd_type !== 'Other') {
      metaItems.push(`Tipe SSD: ${this.escapeHtml(dev.ssd_type)}`);
    }
    const ramBrandRaw = String(dev?.ram_brand || '').trim();
    const ramBrandLow = ramBrandRaw.toLowerCase();
    if (ramBrandRaw && ramBrandRaw !== '-' && ramBrandLow !== 'other' && ramBrandLow !== 'other brand' && !ramBrandLow.startsWith('0x') && !ramBrandLow.includes('unknown')) {
      metaItems.push(`Merek RAM: ${this.escapeHtml(ramBrandRaw)}`);
    }

    const metaHtml = metaItems.length > 0
      ? `<div class="modal-primary-spec-meta">${metaItems.join(' · ')}</div>`
      : '';

    return `
      <div class="modal-spec-item full-width modal-primary-spec-card">
        <div class="modal-primary-spec-header">
          <span class="modal-spec-label">${this.escapeHtml(label)}</span>
          <span class="modal-spec-copy-wrap">
            <button type="button" class="modal-spec-copy-btn" command="--copy" commandfor="${this.escapeHtml(targetId)}">
              <svg class="copy-icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <svg class="copy-icon-done" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Salin Spek</span>
            </button>
            <span class="modal-spec-copy-tip" role="status"></span>
          </span>
        </div>
        <pre id="${this.escapeHtml(targetId)}" class="modal-primary-spec-pre">${this.escapeHtml(specText)}</pre>
        ${metaHtml}
      </div>
    `;
  },

  legacyCopyText(text) {
    const previousFocus = document.activeElement;
    const field = Object.assign(document.createElement('textarea'), { value: text });
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
    document.body.append(field);
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus({ preventScroll: true });
      }
    }
  },

  async copyFromInvoker(button, target) {
    const text = target.matches('input, textarea') ? target.value : target.innerText.trim();
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else if (!this.legacyCopyText(text)) {
        throw new Error('Copy failed');
      }
      this.reportCopyFeedback(button, true);
    } catch {
      if (this.legacyCopyText(text)) {
        this.reportCopyFeedback(button, true);
      } else {
        this.reportCopyFeedback(button, false);
      }
    }
  },

  reportCopyFeedback(button, ok) {
    const tip = button.nextElementSibling;
    if (!tip) return;
    clearTimeout(this._copyFeedbackTimers.get(button));
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    let message = ok ? 'Tersalin' : 'Gagal salin';
    if (message === this._lastCopyStatusMsg) message += '\u00A0';
    this._lastCopyStatusMsg = message;
    tip.textContent = '';
    void button.offsetWidth;
    button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    requestAnimationFrame(() => { tip.textContent = message; });
    this._copyFeedbackTimers.set(button, setTimeout(() => {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      tip.textContent = '';
    }, 2000));
  },

  copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.showToast(`Serial Number Reader PARKEE ${text} berhasil disalin!`, 'success');
    }).catch(() => {
      this.showToast('Gagal menyalin ke clipboard', 'error');
    });
  },

  showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const span = document.createElement('span');
    span.textContent = msg == null ? '' : String(msg);
    toast.appendChild(span);
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  },

  exportCsv(data, filename) {
    if (!data || data.length === 0) {
      this.showToast('Tidak ada data untuk diekspor', 'warn');
      return;
    }
    const safeRows = data.map(item => {
      if (!item || typeof item !== 'object') return this.sanitizeCsvValue(item);
      const out = {};
      for (const key of Object.keys(item)) {
        const val = item[key];
        const normalized = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
        out[key] = this.sanitizeCsvValue(normalized);
      }
      return out;
    });

    let csvStr = '';
    if (typeof Papa !== 'undefined' && typeof Papa.unparse === 'function') {
      try {
        csvStr = Papa.unparse(safeRows);
      } catch (err) {
        console.warn('Papa.unparse failed, using native fallback', err);
        csvStr = this.nativeUnparse(safeRows);
      }
    } else {
      csvStr = this.nativeUnparse(safeRows);
    }

    const blob = new Blob(['\uFEFF' + csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showToast(`Berhasil mengekspor ${filename}`, 'success');
  },

  nativeUnparse(data) {
    if (!Array.isArray(data) || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const serializeCell = (val) => {
      if (val === null || val === undefined) return '';
      const raw = typeof val === 'object' ? JSON.stringify(val) : val;
      return this.escapeCsvCell(raw);
    };
    const headerRow = headers.map(h => this.escapeCsvCell(h)).join(',');
    const rows = data.map(item => headers.map(h => serializeCell(item ? item[h] : '')).join(','));
    return [headerRow, ...rows].join('\r\n');
  },

  // =========================================================================
  // AUTO-REFRESH SCHEDULER (SETIAP JAM 05:00 WIB / Asia/Jakarta)
  // =========================================================================
  setupDailyRefreshScheduler() {
    this._lastAutoRefreshDay = this.getWibParts(new Date()).ymd;
    const updateCountdown = () => {
      const now = new Date();
      const wib = this.getWibParts(now);

      // Trigger real background data refresh once per WIB day after 05:05 WIB
      if (wib.hour === 5 && wib.minute >= 5 && this._lastAutoRefreshDay !== wib.ymd) {
        this._lastAutoRefreshDay = wib.ymd;
        Promise.all([
          this.fetchLocations(),
          this.fetchServers(),
          this.fetchSummary(),
          this.fetchTemperature(true),
          this.fetchTickets(true),
          this.fetchServerBackup(true)
        ]).then(() => {
          this.renderActiveView();
          this.showToast('🔄 Data harian (05:00 WIB) telah diperbarui otomatis.', 'info');
        }).catch(() => {});
      }

      // Compute next 05:00 WIB in UTC epoch ms (05:00 WIB == UTC 22:00 prev day)
      let targetMs = Date.UTC(wib.year, wib.month - 1, wib.day, 5, 0, 0) - 7 * 3600 * 1000;
      if (now.getTime() >= targetMs) {
        targetMs += 24 * 3600 * 1000;
      }

      const diffMs = Math.max(0, targetMs - now.getTime());
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      const badge = document.getElementById('syncCountdownBadge');
      if (badge) {
        badge.textContent = `Auto-refresh: ${hours}j ${mins}m (05:00 WIB)`;
      }
    };

    updateCountdown();
    setInterval(updateCountdown, 60000);
  },

  async manualSync() {
    this.showToast('Memperbarui data dashboard...', 'info');
    await Promise.all([
      this.fetchLocations(),
      this.fetchServers(),
      this.fetchSummary(),
      this.fetchTemperature(true),
      this.fetchServerBackup(true)
    ]);
    if (this._fleetLoaded) await this.fetchFleet(true);
    this.renderActiveView();
    this.showToast('Data telemetri berhasil diperbarui!', 'success');
  },

  initFullscreen() {
    const fsBtn = document.getElementById('globalFullscreenBtn');
    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    };

    const syncFsState = () => {
      if (!fsBtn) return;
      const isFs = Boolean(document.fullscreenElement);
      fsBtn.setAttribute('aria-pressed', String(isFs));
      const label = isFs ? 'Keluar Layar Penuh (F)' : 'Mode Layar Penuh (F)';
      fsBtn.setAttribute('title', label);
      fsBtn.setAttribute('aria-label', label);
    };

    if (fsBtn) {
      fsBtn.addEventListener('click', toggleFullscreen);
      syncFsState();
    }

    if (!this._fsListenersBound) {
      this._fsListenersBound = true;
      document.addEventListener('fullscreenchange', syncFsState);
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'f' && e.key !== 'F') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (this.isTextInputFocused()) return;
        if (document.querySelector('.app-container[inert], dialog[open]')) return;
        e.preventDefault();
        toggleFullscreen();
      });
    }
  },

  // =========================================================================
  // FLOATING HORIZONTAL SCROLLBAR SYSTEM (Cross-Table Sticky Horizontal Scroll)
  // Ultra-Smooth, Zero-Lag Custom Slider with Pointer Capture & RAF Sync
  // =========================================================================
  initFloatingScrollbar() {
    const floatBar = document.getElementById('floatingTableScrollbar');
    const track = document.getElementById('floatScrollTrack');
    const thumb = document.getElementById('floatScrollThumb');
    const leftBtn = document.getElementById('floatScrollLeftBtn');
    const rightBtn = document.getElementById('floatScrollRightBtn');
    const badge = document.getElementById('floatScrollBadge');

    if (!floatBar || !track || !thumb) return;

    let activeTarget = null;
    let isDraggingThumb = false;
    let dragStartPointerX = 0;
    let dragStartScrollLeft = 0;
    let cachedMaxScroll = 0;
    let cachedTrackWidth = 0;
    let cachedThumbWidth = 36;
    let cachedMaxThumbTravel = 1;
    let prevLeft = -9999;
    let prevWidth = -9999;
    let holdTimer = null;
    let holdInterval = null;

    // Recalculate metrics for current target and track dimensions
    const updateMetrics = () => {
      if (!activeTarget) return false;
      const scrollW = activeTarget.scrollWidth;
      const clientW = activeTarget.clientWidth;
      cachedMaxScroll = scrollW - clientW;

      if (cachedMaxScroll <= 2) {
        return false;
      }

      cachedTrackWidth = track.clientWidth;
      if (cachedTrackWidth <= 0) return false;

      const visibleRatio = Math.min(1, Math.max(0.08, clientW / scrollW));
      cachedThumbWidth = Math.max(36, Math.min(cachedTrackWidth - 8, Math.round(cachedTrackWidth * visibleRatio)));
      cachedMaxThumbTravel = Math.max(1, cachedTrackWidth - cachedThumbWidth);

      thumb.style.width = `${cachedThumbWidth}px`;
      return true;
    };

    // Update thumb position and badge from activeTarget.scrollLeft
    const updateThumbUI = (scrollLeft) => {
      if (!activeTarget || cachedMaxScroll <= 0) return;
      const ratio = Math.max(0, Math.min(1, scrollLeft / cachedMaxScroll));
      const thumbX = Math.round(ratio * cachedMaxThumbTravel);

      // Hardware-accelerated translate3d
      thumb.style.transform = `translate3d(${thumbX}px, 0, 0)`;
      thumb.setAttribute('aria-valuenow', Math.round(ratio * 100));

      const pct = Math.round(ratio * 100);
      if (badge) badge.textContent = `↔ ${pct}%`;
      if (leftBtn) leftBtn.disabled = scrollLeft <= 2;
      if (rightBtn) rightBtn.disabled = scrollLeft >= cachedMaxScroll - 2;
    };

    // Scroll listener on the active table (debounced with RAF)
    let targetRafId = null;
    const onTargetScroll = () => {
      if (isDraggingThumb) return; // Pointermove already updates thumb instantaneously
      if (targetRafId) return;
      targetRafId = requestAnimationFrame(() => {
        targetRafId = null;
        if (activeTarget) {
          updateThumbUI(activeTarget.scrollLeft);
        }
      });
    };

    // POINTER DRAG ON THUMB (Smooth 60/120fps with Pointer Capture)
    thumb.addEventListener('pointerdown', (e) => {
      if (!activeTarget || cachedMaxScroll <= 0) return;
      e.preventDefault();
      e.stopPropagation();

      isDraggingThumb = true;
      thumb.classList.add('dragging');
      dragStartPointerX = e.clientX;
      dragStartScrollLeft = activeTarget.scrollLeft;

      try {
        thumb.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    const onPointerMove = (e) => {
      if (!isDraggingThumb || !activeTarget || cachedMaxScroll <= 0) return;
      const deltaX = e.clientX - dragStartPointerX;
      const scrollDelta = (deltaX / cachedMaxThumbTravel) * cachedMaxScroll;
      const targetScroll = Math.max(0, Math.min(cachedMaxScroll, dragStartScrollLeft + scrollDelta));

      activeTarget.scrollLeft = targetScroll;
      updateThumbUI(targetScroll);
    };

    const onPointerUp = (e) => {
      if (!isDraggingThumb) return;
      isDraggingThumb = false;
      thumb.classList.remove('dragging');
      try {
        thumb.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };

    thumb.addEventListener('pointermove', onPointerMove);
    thumb.addEventListener('pointerup', onPointerUp);
    thumb.addEventListener('pointercancel', onPointerUp);

    // CLICK ON TRACK (Jump / Smooth Slide to click location)
    track.addEventListener('pointerdown', (e) => {
      if (e.target === thumb || thumb.contains(e.target)) return;
      if (!activeTarget || cachedMaxScroll <= 0) return;

      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const desiredThumbLeft = clickX - (cachedThumbWidth / 2);
      const ratio = Math.max(0, Math.min(1, desiredThumbLeft / cachedMaxThumbTravel));
      const targetScroll = Math.round(ratio * cachedMaxScroll);

      activeTarget.scrollTo({
        left: targetScroll,
        behavior: 'smooth'
      });
    });

    // KEYBOARD NAVIGATION ON THUMB
    thumb.addEventListener('keydown', (e) => {
      if (!activeTarget) return;
      const step = 80;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        activeTarget.scrollBy({ left: -step, behavior: 'smooth' });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        activeTarget.scrollBy({ left: step, behavior: 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        activeTarget.scrollTo({ left: 0, behavior: 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        activeTarget.scrollTo({ left: activeTarget.scrollWidth, behavior: 'smooth' });
      }
    });

    // MOUSE WHEEL ON FLOATING BAR (Translate to Horizontal Scroll)
    floatBar.addEventListener('wheel', (e) => {
      if (!activeTarget || cachedMaxScroll <= 0) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      activeTarget.scrollLeft += delta;
    }, { passive: false });

    // ARROW BUTTONS: CLICK (Smooth Step / Keyboard) + PRESS & HOLD (Continuous Glide)
    const setupArrowButton = (btn, direction) => {
      if (!btn) return;
      let startTime = 0;
      let didHold = false;
      let pointerHandled = false;

      const stopHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
      };

      const stepBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

      btn.addEventListener('pointerdown', (e) => {
        if (!activeTarget || cachedMaxScroll <= 0) return;
        e.preventDefault();
        startTime = Date.now();
        didHold = false;
        pointerHandled = true;
        stopHold();

        holdTimer = setTimeout(() => {
          didHold = true;
          holdInterval = setInterval(() => {
            if (!activeTarget) return stopHold();
            activeTarget.scrollLeft += direction * 24;
          }, 16);
        }, 220);
      });

      btn.addEventListener('pointerup', () => {
        const elapsed = Date.now() - startTime;
        stopHold();
        if (!didHold && elapsed < 220 && activeTarget) {
          activeTarget.scrollBy({ left: direction * 320, behavior: stepBehavior() });
        }
      });

      btn.addEventListener('click', () => {
        if (pointerHandled) {
          pointerHandled = false;
          return;
        }
        if (activeTarget && cachedMaxScroll > 0) {
          activeTarget.scrollBy({ left: direction * 320, behavior: stepBehavior() });
        }
      });

      btn.addEventListener('pointerleave', stopHold);
      btn.addEventListener('pointercancel', stopHold);
    };

    setupArrowButton(leftBtn, -1);
    setupArrowButton(rightBtn, 1);

    // Keyboard navigation on scrollbar thumb (WCAG ARIA scrollbar pattern)
    thumb.addEventListener('keydown', (e) => {
      if (!activeTarget || cachedMaxScroll <= 0) return;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        activeTarget.scrollBy({ left: 160, behavior });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        activeTarget.scrollBy({ left: -160, behavior });
      } else if (e.key === 'Home') {
        e.preventDefault();
        activeTarget.scrollTo({ left: 0, behavior });
      } else if (e.key === 'End') {
        e.preventDefault();
        activeTarget.scrollTo({ left: cachedMaxScroll, behavior });
      }
    });

    floatBar.inert = true;

    // CORE VISIBILITY & POSITIONING LOGIC
    const checkFloatingScrollbar = () => {
      const wrappers = document.querySelectorAll(
        '.table-responsive, .table-container, .client-table-wrap'
      );
      const vh = window.innerHeight;
      let candidate = null;
      let candidateRect = null;

      for (const el of wrappers) {
        if (el.offsetParent === null) continue;
        if (el.scrollWidth <= el.clientWidth + 2) continue;

        const rect = el.getBoundingClientRect();
        const topInView = rect.top < vh - 40;
        const bottomBelowScreen = rect.bottom > vh - 12;
        const bottomStillVisible = rect.bottom > 80;

        if (topInView && bottomBelowScreen && bottomStillVisible) {
          candidate = el;
          candidateRect = rect;
          break;
        }
      }

      if (!candidate) {
        if (activeTarget) {
          activeTarget.removeEventListener('scroll', onTargetScroll);
          activeTarget = null;
        }
        floatBar.classList.remove('visible');
        floatBar.inert = true;
        return;
      }

      // Switch active target
      if (activeTarget !== candidate) {
        if (activeTarget) activeTarget.removeEventListener('scroll', onTargetScroll);
        activeTarget = candidate;
        activeTarget.addEventListener('scroll', onTargetScroll, { passive: true });
      }

      // Calculate position and width
      const paddingX = 16;
      const left = Math.round(Math.max(paddingX, candidateRect.left + 8));
      const rightMargin = (window.innerWidth >= 900) ? 140 : 16;
      const maxWidth = window.innerWidth - left - rightMargin;
      const width = Math.round(Math.min(candidateRect.width - 16, maxWidth));

      if (Math.abs(prevLeft - left) >= 1) {
        floatBar.style.left = `${left}px`;
        prevLeft = left;
      }
      if (Math.abs(prevWidth - width) >= 1) {
        floatBar.style.width = `${Math.max(200, width)}px`;
        prevWidth = width;
      }

      const hasOverflow = updateMetrics();
      if (!hasOverflow) {
        floatBar.classList.remove('visible');
        floatBar.inert = true;
        return;
      }

      updateThumbUI(activeTarget.scrollLeft);
      floatBar.classList.add('visible');
      floatBar.inert = false;
    };

    // Throttled scroll and resize listeners using requestAnimationFrame
    let checkRaf = null;
    const requestCheck = () => {
      if (checkRaf) return;
      checkRaf = requestAnimationFrame(() => {
        checkRaf = null;
        checkFloatingScrollbar();
      });
    };

    window.addEventListener('scroll', requestCheck, { passive: true });
    window.addEventListener('resize', requestCheck, { passive: true });

    let mutationTimer = null;
    this.updateFloatingScrollbar = () => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(checkFloatingScrollbar, 50);
    };
    setTimeout(checkFloatingScrollbar, 200);
  },

  // =========================================================================
  // MODULE 7: SERVER BACKUP & REPLICATION TELEMETRY
  // =========================================================================
  async fetchServerBackup(force = false) {
    if (this._backupLoaded && !force) return;
    if (this.dataStatus.backup !== 'ready') this.setDataStatus('backup', 'loading');
    try {
      const res = await fetch(`./data/server_backup.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.serverBackup = await res.json();
      this._backupLoaded = true;
      this.setDataStatus('backup', 'ready');
      const badge = document.getElementById('badgeServerBackup');
      if (badge) badge.textContent = this.serverBackup.length.toLocaleString();
      this.renderBackupTable();
    } catch (e) {
      console.warn('Could not load server_backup.json', e);
      this.failLoad('backup', 'data server backup');
    }
  },

  setBackupKpiFilter(kpiVal) {
    const val = kpiVal || 'all';
    if (val === 'all') {
      this.backupState.status = 'all';
      this.backupState.replication = 'all';
      this.backupState.autoPromote = 'all';
      this.backupState.p2p = 'all';
    } else if (val === 'streaming') {
      const isAlready = this.backupState.replication === 'Streaming' &&
        this.backupState.autoPromote === 'all' &&
        this.backupState.p2p === 'all';
      this.backupState.replication = isAlready ? 'all' : 'Streaming';
      this.backupState.autoPromote = 'all';
      this.backupState.p2p = 'all';
    } else if (val === 'autopromote') {
      const isAlready = this.backupState.autoPromote === 'Yes' &&
        this.backupState.replication === 'all' &&
        this.backupState.p2p === 'all';
      this.backupState.autoPromote = isAlready ? 'all' : 'Yes';
      this.backupState.replication = 'all';
      this.backupState.p2p = 'all';
    } else if (val === 'p2p') {
      const isAlready = this.backupState.p2p === 'Connected' &&
        this.backupState.replication === 'all' &&
        this.backupState.autoPromote === 'all';
      this.backupState.p2p = isAlready ? 'all' : 'Connected';
      this.backupState.replication = 'all';
      this.backupState.autoPromote = 'all';
    }
    this.backupState.page = 1;
    this.syncBackupKpiUI();
    this.renderBackupTable();
  },

  syncBackupKpiUI() {
    document.querySelectorAll('.filter-pill[data-backup-status-pill]').forEach(b => {
      b.classList.toggle('active', b.dataset.backupStatusPill === this.backupState.status);
    });
    document.querySelectorAll('.filter-pill[data-backup-repl-pill]').forEach(b => {
      b.classList.toggle('active', b.dataset.backupReplPill === this.backupState.replication);
    });
    const autoPromoteFilter = document.getElementById('backupAutoPromoteFilter');
    if (autoPromoteFilter) autoPromoteFilter.value = this.backupState.autoPromote;
    const p2pFilter = document.getElementById('backupP2PFilter');
    if (p2pFilter) p2pFilter.value = this.backupState.p2p;

    let activeKpi = '';
    if (
      this.backupState.status === 'all' &&
      this.backupState.replication === 'all' &&
      this.backupState.autoPromote === 'all' &&
      this.backupState.p2p === 'all' &&
      this.backupState.teleport === 'all' &&
      this.backupState.cable === 'all'
    ) {
      activeKpi = 'all';
    } else if (
      this.backupState.replication === 'Streaming' &&
      this.backupState.autoPromote === 'all' &&
      this.backupState.p2p === 'all'
    ) {
      activeKpi = 'streaming';
    } else if (
      this.backupState.autoPromote === 'Yes' &&
      this.backupState.replication === 'all' &&
      this.backupState.p2p === 'all'
    ) {
      activeKpi = 'autopromote';
    } else if (
      this.backupState.p2p === 'Connected' &&
      this.backupState.replication === 'all' &&
      this.backupState.autoPromote === 'all'
    ) {
      activeKpi = 'p2p';
    }

    document.querySelectorAll('[data-backup-kpi]').forEach(card => {
      const isAct = card.dataset.backupKpi === activeKpi;
      card.classList.toggle('kpi-active-filter', isAct);
      card.setAttribute('aria-pressed', isAct ? 'true' : 'false');
    });
  },

  initBackupEventHandlers() {
    document.querySelectorAll('[data-backup-kpi]').forEach(card => {
      card.addEventListener('click', () => {
        this.setBackupKpiFilter(card.dataset.backupKpi);
      });
    });

    const searchInput = document.getElementById('backupSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', this.debounce((e) => {
        this.backupState.search = e.target.value;
        this.backupState.page = 1;
        this.renderBackupTable();
      }, 180));
    }

    const pageSizeSelect = document.getElementById('backupPageSizeSelect');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        this.backupState.pageSize = parseInt(e.target.value, 10);
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    }

    // Status filter pills
    document.querySelectorAll('.filter-pill[data-backup-status-pill]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-backup-status-pill]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.backupState.status = btn.dataset.backupStatusPill;
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    });

    // Replication filter pills
    document.querySelectorAll('.filter-pill[data-backup-repl-pill]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-backup-repl-pill]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.backupState.replication = btn.dataset.backupReplPill;
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    });

    // Dropdown filters
    const autoPromoteFilter = document.getElementById('backupAutoPromoteFilter');
    if (autoPromoteFilter) {
      autoPromoteFilter.addEventListener('change', (e) => {
        this.backupState.autoPromote = e.target.value;
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    }

    const p2pFilter = document.getElementById('backupP2PFilter');
    if (p2pFilter) {
      p2pFilter.addEventListener('change', (e) => {
        this.backupState.p2p = e.target.value;
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    }

    const teleportFilter = document.getElementById('backupTeleportFilter');
    if (teleportFilter) {
      teleportFilter.addEventListener('change', (e) => {
        this.backupState.teleport = e.target.value;
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    }

    const cableFilter = document.getElementById('backupCableFilter');
    if (cableFilter) {
      cableFilter.addEventListener('change', (e) => {
        this.backupState.cable = e.target.value;
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    }

    // Reset button
    const resetBtn = document.getElementById('backupResetFiltersBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.backupState.search = '';
        this.backupState.status = 'all';
        this.backupState.replication = 'all';
        this.backupState.autoPromote = 'all';
        this.backupState.p2p = 'all';
        this.backupState.teleport = 'all';
        this.backupState.cable = 'all';
        this.backupState.page = 1;

        if (searchInput) searchInput.value = '';
        if (autoPromoteFilter) autoPromoteFilter.value = 'all';
        if (p2pFilter) p2pFilter.value = 'all';
        if (teleportFilter) teleportFilter.value = 'all';
        if (cableFilter) cableFilter.value = 'all';

        document.querySelectorAll('.filter-pill[data-backup-status-pill]').forEach(b => {
          b.classList.toggle('active', b.dataset.backupStatusPill === 'all');
        });
        document.querySelectorAll('.filter-pill[data-backup-repl-pill]').forEach(b => {
          b.classList.toggle('active', b.dataset.backupReplPill === 'all');
        });

        this.renderBackupTable();
        this.showToast('Filter server backup telah di-reset.', 'info');
      });
    }

    // Refresh button
    const refreshBtn = document.getElementById('backupRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        this.showToast('Memperbarui data server backup...', 'info');
        await this.fetchServerBackup(true);
        this.showToast('Data server backup berhasil diperbarui.', 'success');
      });
    }

    // Sorting headers
    document.querySelectorAll('#backupTable th.sortable[data-backup-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.backupSort;
        if (this.backupState.sortCol === col) {
          this.backupState.sortDir = this.backupState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.backupState.sortCol = col;
          this.backupState.sortDir = 'asc';
        }
        this.backupState.page = 1;
        this.renderBackupTable();
      });
    });

    // Pagination buttons
    const prevBtn = document.getElementById('backupPrevPageBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.backupState.page > 1) {
          this.backupState.page--;
          this.renderBackupTable();
        }
      });
    }

    const nextBtn = document.getElementById('backupNextPageBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.backupState.page++;
        this.renderBackupTable();
      });
    }
  },

  renderBackupTable() {
    const guardBody = document.getElementById('backupTableBody');
    if (guardBody && this.guardTable(guardBody)) return;

    this.syncBackupKpiUI();

    if (!this.serverBackup || !this.serverBackup.length) {
      if (guardBody) {
        this.setHtml(guardBody, '<tr><td colspan="12" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Belum ada data server backup.</td></tr>');
      }
      return;
    }

    // 1. Update KPIs
    const totalCount = this.serverBackup.length;
    const streamingCount = this.serverBackup.filter(r => (r.replication || '').toLowerCase() === 'streaming').length;
    const autoPromoteCount = this.serverBackup.filter(r => (r.autopromote || '').toLowerCase() === 'yes').length;
    const p2pCount = this.serverBackup.filter(r => (r.p2p || '').toLowerCase() === 'connected').length;

    const elTotal = document.getElementById('backupKpiTotal');
    if (elTotal) elTotal.textContent = totalCount.toLocaleString();

    const elStreaming = document.getElementById('backupKpiStreaming');
    if (elStreaming) elStreaming.textContent = streamingCount.toLocaleString();

    const elAutoPromote = document.getElementById('backupKpiAutoPromote');
    if (elAutoPromote) elAutoPromote.textContent = autoPromoteCount.toLocaleString();

    const elP2P = document.getElementById('backupKpiP2P');
    if (elP2P) elP2P.textContent = p2pCount.toLocaleString();

    // 2. Filter data
    const q = (this.backupState.search || '').toLowerCase().trim();
    let filtered = this.serverBackup.filter(item => {
      if (q) {
        const match =
          (item.loc || '').toLowerCase().includes(q) ||
          (item.code || '').toLowerCase().includes(q) ||
          (item.ip_local || '').toLowerCase().includes(q) ||
          (item.ip_p2p || '').toLowerCase().includes(q) ||
          (item.notes || '').toLowerCase().includes(q) ||
          (item.note_col_s || '').toLowerCase().includes(q) ||
          (item.conn_note || '').toLowerCase().includes(q) ||
          (item.status || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      if (this.backupState.status !== 'all') {
        if ((item.status || '').toLowerCase() !== this.backupState.status.toLowerCase()) {
          return false;
        }
      }

      if (this.backupState.replication !== 'all') {
        if ((item.replication || '').toLowerCase() !== this.backupState.replication.toLowerCase()) {
          return false;
        }
      }

      if (this.backupState.autoPromote !== 'all') {
        if ((item.autopromote || '').toLowerCase() !== this.backupState.autoPromote.toLowerCase()) {
          return false;
        }
      }

      if (this.backupState.p2p !== 'all') {
        if ((item.p2p || '').toLowerCase() !== this.backupState.p2p.toLowerCase()) {
          return false;
        }
      }

      if (this.backupState.teleport !== 'all') {
        if ((item.teleport || '').toLowerCase() !== this.backupState.teleport.toLowerCase()) {
          return false;
        }
      }

      if (this.backupState.cable !== 'all') {
        const c = (item.cable_type || '').toLowerCase();
        if (this.backupState.cable === 'cat7' && !c.includes('cat7')) return false;
        if (this.backupState.cable === 'cat6' && !c.includes('cat6')) return false;
      }

      return true;
    });

    // 3. Sort data
    const col = this.backupState.sortCol;
    const dir = this.backupState.sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let va = a[col] || '';
      let vb = b[col] || '';

      if (col === 'replag') {
        const numA = parseInt(String(va).replace(/[^0-9]/g, ''), 10);
        const numB = parseInt(String(vb).replace(/[^0-9]/g, ''), 10);
        const validA = !isNaN(numA);
        const validB = !isNaN(numB);
        if (!validA && !validB) return 0;
        if (!validA) return 1;
        if (!validB) return -1;
        return (numA - numB) * dir;
      }

      return this._collator.compare(String(va), String(vb)) * dir;
    });

    // Update sort indicators
    this.updateSortIndicators('#view-backup', 'data-backup-sort', this.backupState.sortCol, this.backupState.sortDir);

    // 4. Pagination
    const totalFiltered = filtered.length;
    const pageSize = this.backupState.pageSize;
    const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
    if (this.backupState.page > totalPages) this.backupState.page = totalPages;
    if (this.backupState.page < 1) this.backupState.page = 1;

    const startIdx = (this.backupState.page - 1) * pageSize;
    const paginated = filtered.slice(startIdx, startIdx + pageSize);

    // Update labels
    const countLabel = document.getElementById('backupResultCountLabel');
    if (countLabel) countLabel.textContent = `Menampilkan ${totalFiltered} dari ${totalCount} Server Backup`;

    const tableCountLabel = document.getElementById('backupTableCountLabel');
    if (tableCountLabel) {
      if (totalFiltered === 0) {
        tableCountLabel.textContent = 'Tidak ada server backup yang cocok dengan filter.';
      } else {
        const fromItem = startIdx + 1;
        const toItem = Math.min(startIdx + pageSize, totalFiltered);
        tableCountLabel.textContent = `Menampilkan ${fromItem} - ${toItem} dari ${totalFiltered} server backup`;
      }
    }

    const curPageLabel = document.getElementById('backupCurrentPageLabel');
    if (curPageLabel) curPageLabel.textContent = `Halaman ${this.backupState.page} / ${totalPages}`;

    const prevBtn = document.getElementById('backupPrevPageBtn');
    if (prevBtn) prevBtn.disabled = this.backupState.page <= 1;

    const nextBtn = document.getElementById('backupNextPageBtn');
    if (nextBtn) nextBtn.disabled = this.backupState.page >= totalPages;

    // 5. Render rows
    const tbody = document.getElementById('backupTableBody');
    if (!tbody) return;

    if (!paginated.length) {
      this.setHtml(tbody, `<tr><td colspan="12" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
        <div style="font-size: 1.5rem; margin-bottom: 6px;" aria-hidden="true">🔍</div>
        Tidak ada data server backup yang cocok dengan pencarian / filter Anda.
      </td></tr>`);
      return;
    }

    const rowsHtml = paginated.map(item => {
      // 1. Status Badge
      const st = (item.status || '').trim();
      const eSt = this.escapeHtml(st || '-');
      let statusBadge = `<div style="text-align: center;"><span class="backup-badge-inactive">${eSt}</span></div>`;
      if (st.toLowerCase() === 'aktif') {
        statusBadge = `<div style="text-align: center;"><span class="backup-badge-active">● Aktif</span></div>`;
      } else if (st.toLowerCase() === 'tidak aktif') {
        statusBadge = `<div style="text-align: center;"><span class="backup-badge-inactive">● Tidak Aktif</span></div>`;
      } else if (st.toLowerCase().includes('aset')) {
        statusBadge = `<div style="text-align: center;"><span class="backup-badge-pending">⏳ Belum Ada Aset</span></div>`;
      }

      // 2. P2P Badge
      const p2pVal = (item.p2p || '').trim().toLowerCase();
      let p2pBadge = `<div style="text-align: center;"><span class="backup-badge-p2p-bad">✕ Not Connected</span></div>`;
      if (p2pVal === 'connected') {
        p2pBadge = `<div style="text-align: center;"><span class="backup-badge-p2p-ok">✓ Connected</span></div>`;
      }

      // 3. Cable Type
      const cableVal = (item.cable_type || '').trim();
      let cableBadge = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem;">-</div>`;
      if (cableVal.toUpperCase().includes('CAT7')) {
        cableBadge = `<div style="text-align: center;"><span class="backup-badge-cat7">CAT7 After Market</span></div>`;
      } else if (cableVal.toUpperCase().includes('CAT6')) {
        cableBadge = `<div style="text-align: center;"><span class="backup-badge-cat6">CAT6 Rakitan</span></div>`;
      }

      // 4. Teleport Badge
      const teleVal = (item.teleport || '').trim().toLowerCase();
      let teleBadge = `<div style="text-align: center;"><span class="backup-badge-tele-no">No</span></div>`;
      if (teleVal === 'yes') {
        teleBadge = `<div style="text-align: center;"><span class="backup-badge-tele-yes">Yes</span></div>`;
      }

      // 5. Replication Badge
      const replVal = (item.replication || '').trim().toLowerCase();
      let replBadge = `<div style="text-align: center;"><span class="badge-not-streaming">✕ Not Streaming</span></div>`;
      if (replVal === 'streaming') {
        replBadge = `<div style="text-align: center;"><span class="badge-streaming">⚡ Streaming</span></div>`;
      }

      // 6. Auto Promote Badge
      const autoVal = (item.autopromote || '').trim().toLowerCase();
      let autoBadge = `<div style="text-align: center;"><span class="badge-autopromote-no">No</span></div>`;
      if (autoVal === 'yes') {
        autoBadge = `<div style="text-align: center;"><span class="badge-autopromote-yes">✓ Yes (Pawdog)</span></div>`;
      }

      // 7. Replag Badge
      const lagVal = (item.replag || '').trim();
      const eLagVal = this.escapeHtml(lagVal);
      let replagBadge = `<div style="text-align: center; color: var(--text-muted); font-size: 0.74rem;">-</div>`;
      if (lagVal && lagVal !== '-') {
        const numLag = parseInt(lagVal.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(numLag)) {
          if (numLag <= 10) {
            replagBadge = `<div style="text-align: center;"><span class="badge-replag-ok" title="Replikasi Normal (${numLag}s)">${eLagVal}</span></div>`;
          } else if (numLag <= 60) {
            replagBadge = `<div style="text-align: center;"><span class="badge-replag-warn" title="Lag Replikasi Waspada (${numLag}s)">${eLagVal}</span></div>`;
          } else {
            replagBadge = `<div style="text-align: center;"><span class="badge-replag-crit" title="Lag Replikasi Kritis (${numLag}s)">${eLagVal}</span></div>`;
          }
        } else {
          replagBadge = `<div style="text-align: center;"><span class="badge-replag-ok">${eLagVal}</span></div>`;
        }
      }

      // 8. Keterangan note with Column S / connectivity note
      const noteVal = (item.notes || '').trim();
      const connNote = (item.conn_note || '').trim();
      const colSNote = (item.note_col_s || '').trim();

      let connAlertBadge = '';
      if (connNote) {
        connAlertBadge = `<div style="margin-bottom: 4px;"><span class="backup-conn-warn-pill">⚠️ ${this.escapeHtml(connNote)}</span></div>`;
      }

      const displayNote = noteVal || colSNote || '-';
      const eFullNoteTitle = this.escapeHtml(displayNote + (connNote ? ` (${connNote})` : ''));
      const shortNote = displayNote.length > 110 ? `${displayNote.slice(0, 110)}...` : displayNote;
      const eShortNote = this.escapeHtml(shortNote);
      const eLoc = this.escapeHtml(item.loc || '-');
      const eCode = this.escapeHtml(item.code || '-');
      const eIpLocal = item.ip_local ? this.escapeHtml(item.ip_local) : '';
      const eIpP2p = item.ip_p2p ? this.escapeHtml(item.ip_p2p) : '';

      return `
        <tr class="clickable-row" tabindex="0" role="button" data-action="open-backup-modal" data-code="${eCode}" data-loc="${eLoc}" title="Klik baris untuk melihat detail lengkap server backup ${eLoc}">
          <td>
            <div class="backup-loc-name row-primary-title">${eLoc}</div>
          </td>
          <td>
            <div style="text-align: center;"><span class="backup-code-pill">${eCode}</span></div>
          </td>
          <td>${statusBadge}</td>
          <td>${p2pBadge}</td>
          <td>${cableBadge}</td>
          <td>${teleBadge}</td>
          <td>
            ${eIpLocal ? `<span class="backup-ip-mono">${eIpLocal}</span>` : '<span style="color:var(--text-muted);">-</span>'}
          </td>
          <td>
            ${eIpP2p ? `<span class="backup-ip-mono" style="color: var(--accent-secondary); font-weight: 700;">${eIpP2p}</span>` : '<span style="color:var(--text-muted);">-</span>'}
          </td>
          <td>${replBadge}</td>
          <td>${autoBadge}</td>
          <td>${replagBadge}</td>
          <td>
            ${connAlertBadge}
            <div class="backup-notes-text" title="${eFullNoteTitle}">
              ${eShortNote}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    this.setHtml(tbody, rowsHtml);
    if (this.updateFloatingScrollbar) this.updateFloatingScrollbar();
  },

  // =========================================================================
  // THEME CONTROLLER (System / Light / Dark + OS listener + Cross-tab sync)
  // =========================================================================
  resolveTheme(pref) {
    if (pref === 'dark') return 'dark';
    if (pref === 'light') return 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  initTweaks() {
    let savedTheme = 'system';
    try {
      savedTheme = localStorage.getItem('parkee_theme') || 'system';
    } catch (_) {}
    this.applyTheme(savedTheme, false);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const pref = document.documentElement.dataset.themePref || 'system';
        const rendered = this.resolveTheme(pref);
        const target = rendered === 'dark' ? 'light' : 'dark';
        const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const osTheme = osDark ? 'dark' : 'light';
        const nextPref = target === osTheme ? 'system' : target;
        this.applyTheme(nextPref, true);
      });
    }

    if (!this._themeListenersBound) {
      this._themeListenersBound = true;
      if (window.matchMedia) {
        const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
        const onOsChange = () => {
          if ((document.documentElement.dataset.themePref || 'system') === 'system') {
            this.applyTheme('system', false);
          }
        };
        if (typeof mqDark.addEventListener === 'function') {
          mqDark.addEventListener('change', onOsChange);
        } else if (typeof mqDark.addListener === 'function') {
          mqDark.addListener(onOsChange);
        }
      }
      window.addEventListener('storage', (e) => {
        if (e.key === 'parkee_theme') {
          this.applyTheme(e.newValue || 'system', false);
        }
      });
    }
  },

  applyTheme(theme, persist = true) {
    const pref = (theme === 'dark' || theme === 'light') ? theme : 'system';
    const resolved = this.resolveTheme(pref);
    const metaScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaScheme) {
      metaScheme.setAttribute('content', pref === 'system' ? 'light dark' : pref);
    }
    document.documentElement.dataset.themePref = pref;
    document.documentElement.setAttribute('data-theme', resolved);

    if (persist) {
      try {
        if (pref === 'system') {
          localStorage.removeItem('parkee_theme');
        } else {
          localStorage.setItem('parkee_theme', pref);
        }
      } catch (_) {}
    }

    const iconSpan = document.getElementById('themeIconSpan');
    const toggleBtn = document.getElementById('themeToggleBtn');
    if (iconSpan) {
      iconSpan.textContent = pref === 'system' ? '🌓' : (resolved === 'dark' ? '☀️' : '🌙');
    }
    if (toggleBtn) {
      const modeDesc = pref === 'system'
        ? `Otomatis (${resolved === 'dark' ? 'Gelap' : 'Terang'})`
        : (resolved === 'dark' ? 'Mode Gelap' : 'Mode Terang');
      toggleBtn.setAttribute('title', `Tema: ${modeDesc} — klik untuk ganti`);
      toggleBtn.setAttribute('aria-label', `Tema tampilan saat ini: ${modeDesc}. Klik untuk mengganti.`);
    }

    if (this.activeView === 'dashboard') {
      this.renderDashboardCharts(this.getOneMonthTickets());
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
