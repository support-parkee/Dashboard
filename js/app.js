/**
 * PARKEE FleetIQ - Core Application Logic (Web Design Engineer Standard)
 * Left Sidebar, Live Google Sheets Sync, 05:00 AM Auto-Refresh, Dark/Light Themes & Tweaks Panel
 */

const App = {
  summary: null,
  fleet: [],
  filteredFleet: [],
  currentPage: 1,
  pageSize: 25,
  currentSort: { col: 'loc', dir: 'asc' },
  activeFilter: {
    search: '',
    tier: 'all',
    cat: 'all',
    alert: 'all'
  },

  SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/11HUECMQG_30Sc1AupFLac7OxBDiFiZOD339LjiOkpdc/export?format=csv&gid=0',
  nextSyncTimeout: null,

  async init() {
    this.initThemeAndTweaks();
    this.initNavigation();
    this.initModal();
    this.initHardwareTabs();
    this.initFleetTableControls();
    this.initFullscreen();
    this.setupDailyRefreshScheduler();

    // 1. Load Precomputed Summary (Instant 0ms render)
    if (window.PRECOMPUTED_SUMMARY) {
      this.summary = window.PRECOMPUTED_SUMMARY;
      window.currentSummary = this.summary;
      this.renderDashboardSummary();
      if (window.ChartManager) window.ChartManager.initAllCharts(this.summary);
      if (window.PresentationController) window.PresentationController.init();
    } else {
      await this.fetchSummaryJson();
    }

    // 2. Load Full Fleet JSON asynchronously for table and search
    this.fetchFleetData();

    // 3. Setup Sync button & Export button
    const syncBtn = document.getElementById('syncSheetBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => this.syncGoogleSheets());
    }

    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportTableToCSV());
    }

    // 4. Check if today's 05:00 AM auto-refresh is due
    this.checkAutoSyncOnLoad();
  },

  // =========================================================================
  // THEME & TWEAKS PANEL (SKILL REQUIREMENT)
  // =========================================================================
  initThemeAndTweaks() {
    // 1. Theme (Light vs Dark)
    const savedTheme = localStorage.getItem('parkee_theme') || 'light';
    this.applyTheme(savedTheme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
      });
    }

    // 2. Density (Comfortable vs Compact)
    const savedDensity = localStorage.getItem('parkee_density') || 'comfortable';
    this.applyDensity(savedDensity);

    // 3. Tweaks Drawer Toggle
    const tweaksTrigger = document.getElementById('tweaksTriggerBtn');
    const tweaksDrawer = document.getElementById('tweaksDrawer');
    const closeTweaksBtn = document.getElementById('closeTweaksBtn');

    if (tweaksTrigger && tweaksDrawer) {
      tweaksTrigger.addEventListener('click', () => {
        tweaksDrawer.classList.toggle('open');
      });
    }

    if (closeTweaksBtn && tweaksDrawer) {
      closeTweaksBtn.addEventListener('click', () => {
        tweaksDrawer.classList.remove('open');
      });
    }

    // Tweaks Segmented Buttons
    document.querySelectorAll('.tweaks-seg-btn[data-theme-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tweaks-seg-btn[data-theme-val]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyTheme(btn.dataset.themeVal);
      });
    });

    document.querySelectorAll('.tweaks-seg-btn[data-density-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tweaks-seg-btn[data-density-val]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyDensity(btn.dataset.densityVal);
      });
    });

    document.querySelectorAll('.tweaks-seg-btn[data-accent-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tweaks-seg-btn[data-accent-val]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyAccent(btn.dataset.accentVal);
      });
    });
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('parkee_theme', theme);

    // Update icons
    const iconSpan = document.getElementById('themeIconSpan');
    if (iconSpan) {
      iconSpan.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    // Update tweaks active state
    document.querySelectorAll('.tweaks-seg-btn[data-theme-val]').forEach(b => {
      b.classList.toggle('active', b.dataset.themeVal === theme);
    });

    // Re-render charts with theme-aware colors
    if (window.ChartManager && this.summary) {
      window.ChartManager.initAllCharts(this.summary);
    }
  },

  applyDensity(density) {
    document.documentElement.setAttribute('data-density', density);
    localStorage.setItem('parkee_density', density);

    document.querySelectorAll('.tweaks-seg-btn[data-density-val]').forEach(b => {
      b.classList.toggle('active', b.dataset.densityVal === density);
    });
  },

  applyAccent(accent) {
    const accents = {
      cobalt: '#2563eb',
      cyan: '#0891b2',
      emerald: '#059669',
      violet: '#7c3aed'
    };
    if (accents[accent]) {
      document.documentElement.style.setProperty('--accent-primary', accents[accent]);
      localStorage.setItem('parkee_accent', accent);
      if (window.ChartManager && this.summary) {
        window.ChartManager.initAllCharts(this.summary);
      }
    }
  },

  initNavigation() {
    const navBtns = document.querySelectorAll('.sidebar-nav-btn');
    const topTitle = document.getElementById('topBarTitle');

    const titleMap = {
      presentation: 'Presentasi Interaktif Armada',
      dashboard: 'Matriks & Analitik Eksekutif',
      explorer: 'Eksplorasi Armada Perangkat',
      alerts: 'Incident Response & Triage Room'
    };

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetView = btn.dataset.view;
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active-view'));
        const targetSec = document.getElementById(`view-${targetView}`);
        if (targetSec) targetSec.classList.add('active-view');

        if (topTitle && titleMap[targetView]) {
          topTitle.textContent = titleMap[targetView];
        }

        // Close mobile sidebar if open
        const sidebar = document.getElementById('appSidebar');
        if (sidebar) sidebar.classList.remove('open');

        // Trigger chart resize
        window.dispatchEvent(new Event('resize'));
      });
    });

    // Mobile menu toggle
    const mobBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('appSidebar');
    if (mobBtn && sidebar) {
      mobBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }
  },

  initFullscreen() {
    const fsBtn = document.getElementById('globalFullscreenBtn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  },

  // =========================================================================
  // AUTO-REFRESH SCHEDULER (SETIAP JAM 05:00 WIB)
  // =========================================================================
  setupDailyRefreshScheduler() {
    const updateCountdown = () => {
      const now = new Date();
      let target = new Date();
      target.setHours(5, 0, 0, 0);

      if (now >= target) {
        target.setDate(target.getDate() + 1);
      }

      const diffMs = target.getTime() - now.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      const badge = document.getElementById('syncCountdownBadge');
      if (badge) {
        badge.textContent = `Auto-refresh: ${hours}j ${mins}m (05:00 WIB)`;
      }

      if (diffMs <= 1000) {
        this.syncGoogleSheets(true);
      }
    };

    updateCountdown();
    setInterval(updateCountdown, 60000);

    const now = new Date();
    let next5AM = new Date();
    next5AM.setHours(5, 0, 0, 0);
    if (now >= next5AM) {
      next5AM.setDate(next5AM.getDate() + 1);
    }
    const msUntil5AM = next5AM.getTime() - now.getTime();

    if (this.nextSyncTimeout) clearTimeout(this.nextSyncTimeout);
    this.nextSyncTimeout = setTimeout(() => {
      console.log('⏰ Auto-refresh triggered at 05:00 AM WIB!');
      this.syncGoogleSheets(true);
      this.setupDailyRefreshScheduler();
    }, msUntil5AM);
  },

  checkAutoSyncOnLoad() {
    const lastSync = localStorage.getItem('fleet_last_sync_timestamp');
    const now = new Date();
    const today5AM = new Date();
    today5AM.setHours(5, 0, 0, 0);

    if (now > today5AM) {
      if (!lastSync || new Date(parseInt(lastSync, 10)) < today5AM) {
        console.log('⚡ Data stale since 05:00 AM today, auto-syncing in background...');
        setTimeout(() => this.syncGoogleSheets(true), 1500);
      }
    }
  },

  async fetchSummaryJson() {
    try {
      const res = await fetch('./data/summary.json');
      if (res.ok) {
        this.summary = await res.json();
        window.currentSummary = this.summary;
        this.renderDashboardSummary();
        if (window.ChartManager) window.ChartManager.initAllCharts(this.summary);
        if (window.PresentationController) window.PresentationController.init();
      }
    } catch (e) {
      console.warn('Could not load summary.json', e);
    }
  },

  async fetchFleetData() {
    try {
      const res = await fetch('./data/fleet.json');
      if (res.ok) {
        this.fleet = await res.json();
        this.applyFleetFilters();
      }
    } catch (e) {
      console.warn('Could not load fleet.json asynchronously', e);
    }
  },

  renderDashboardSummary() {
    if (!this.summary) return;
    const s = this.summary;

    const headerBadge = document.getElementById('headerFleetBadge');
    if (headerBadge) {
      headerBadge.textContent = `${(s.total_devices || 0).toLocaleString()} Nodes · ${s.unique_locations || 0} Sites`;
    }

    const lastSyncLabel = document.getElementById('lastSyncStatusLabel');
    if (lastSyncLabel) {
      lastSyncLabel.textContent = s.last_updated ? `Update: ${s.last_updated}` : 'Terakhir disinkronkan: Hari ini, 05:00 WIB';
    }

    const elTotal = document.getElementById('kpiTotalDevices');
    const elLocs = document.getElementById('kpiTotalLocations');
    const elOverheat = document.getElementById('kpiOverheats');
    const elLowSSD = document.getElementById('kpiLowSSD');
    const elStorage = document.getElementById('kpiStorageWarn');

    if (elTotal) elTotal.textContent = (s.total_devices || 0).toLocaleString();
    if (elLocs) elLocs.textContent = (s.unique_locations || 0).toLocaleString();
    if (elOverheat) elOverheat.textContent = (s.temp_stats?.overheat_count || 0).toLocaleString();
    if (elLowSSD) elLowSSD.textContent = (s.ssd_health_stats?.critical_count || 0).toLocaleString();
    if (elStorage) elStorage.textContent = (s.ssd_usage_stats?.critical_count || 0).toLocaleString();

    // Slide 1 KPIs
    const s1Total = document.getElementById('s1TotalDevs');
    const s1Sites = document.getElementById('s1TotalSites');
    const s1Diamond = document.getElementById('s1Diamond');
    const s1Action = document.getElementById('s1ActionItems');

    if (s1Total) s1Total.textContent = (s.total_devices || 0).toLocaleString();
    if (s1Sites) s1Sites.textContent = (s.unique_locations || 0).toLocaleString();
    if (s1Diamond) s1Diamond.textContent = (s.tier_counts?.Diamond || 0).toLocaleString();
    if (s1Action) s1Action.textContent = ((s.temp_stats?.overheat_count || 0) + (s.ssd_health_stats?.critical_count || 0)).toLocaleString();

    this.renderProblemLocationsTable();
    this.renderAlertIncidentRoom();
  },

  renderProblemLocationsTable() {
    const tbody = document.getElementById('problemLocsTbody');
    if (!tbody || !this.summary?.top_problem_locations) return;

    tbody.innerHTML = this.summary.top_problem_locations.map((item, idx) => `
      <tr onclick="App.filterByLocation('${item.loc.replace(/'/g, "\\'")}')">
        <td style="font-weight: 700; color: var(--text-muted); font-family: var(--font-mono);">0${idx + 1}</td>
        <td>
          <div style="font-weight: 700; color: var(--text-main);">${item.loc}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${item.total_devs} unit terpasang</div>
        </td>
        <td>
          <span class="tier-tag ${item.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (item.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver')}">
            ${item.tier}
          </span>
        </td>
        <td>
          <span class="temp-badge ${item.overheats > 0 ? 'temp-hot' : 'temp-cool'}">
            ${item.overheats} Unit
          </span>
        </td>
        <td>
          <span class="ssd-health-pill ${item.critical_ssd > 0 ? 'health-bad' : 'health-good'}">
            ${item.critical_ssd} Unit
          </span>
        </td>
        <td>
          <span class="ssd-health-pill ${item.critical_storage > 0 ? 'health-bad' : 'health-good'}">
            ${item.critical_storage} Unit
          </span>
        </td>
        <td>
          <button class="btn btn-outline" style="padding: 3px 8px; font-size: 0.72rem;">
            Investigasi
          </button>
        </td>
      </tr>
    `).join('');
  },

  renderAlertIncidentRoom() {
    if (!this.summary) return;
    const overheats = this.summary.temp_stats?.top_overheats || [];
    const lowSsds = this.summary.ssd_health_stats?.top_critical || [];
    const highDisks = this.summary.ssd_usage_stats?.top_critical || [];

    const elOverheatGrid = document.getElementById('incidentOverheatGrid');
    if (elOverheatGrid) {
      elOverheatGrid.innerHTML = overheats.slice(0, 8).map(dev => `
        <div class="glass-panel" style="padding: 1.15rem; border-top: 3px solid var(--color-danger); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${dev.loc}</div>
            <span class="temp-badge temp-hot">${dev.temp}°C</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-primary); font-weight: 600;">${dev.host} (${dev.code})</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">IP: <strong>${dev.ip || '-'}</strong> | CPU: ${dev.cpu || '-'}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 6px;">Sync: ${dev.sync}</div>
        </div>
      `).join('');
    }

    const elSsdGrid = document.getElementById('incidentSsdGrid');
    if (elSsdGrid) {
      elSsdGrid.innerHTML = lowSsds.slice(0, 8).map(dev => `
        <div class="glass-panel" style="padding: 1.15rem; border-top: 3px solid var(--color-warning); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${dev.loc}</div>
            <span class="ssd-health-pill health-bad">Health ${dev.ssd_health}%</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-primary); font-weight: 600;">${dev.host}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">SSD: ${dev.ssd_brand} (${dev.ssd_type}) ${dev.ssd_size}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 6px;">Tindakan: Siapkan SSD clone cadangan</div>
        </div>
      `).join('');
    }

    const elDiskGrid = document.getElementById('incidentDiskGrid');
    if (elDiskGrid) {
      elDiskGrid.innerHTML = highDisks.slice(0, 8).map(dev => `
        <div class="glass-panel" style="padding: 1.15rem; border-top: 3px solid var(--accent-primary); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${dev.loc}</div>
            <span class="ssd-health-pill health-bad">${dev.ssd_usage}% Full</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-primary); font-weight: 600;">${dev.host}</div>
          <div class="usage-bar-track" style="margin-top: 4px;">
            <div class="usage-bar-fill" style="width: ${dev.ssd_usage}%; background: var(--color-danger);"></div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">Tindakan: Log cleaning & vacuum DB</div>
        </div>
      `).join('');
    }
  },

  initFleetTableControls() {
    const searchInput = document.getElementById('tableSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.activeFilter.search = e.target.value.toLowerCase().trim();
        this.currentPage = 1;
        this.applyFleetFilters();
      });
    }

    document.querySelectorAll('.filter-pill[data-filter]').forEach(pill => {
      pill.addEventListener('click', () => {
        const type = pill.dataset.filterType;
        const val = pill.dataset.filter;

        document.querySelectorAll(`.filter-pill[data-filter-type="${type}"]`).forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        this.activeFilter[type] = val;
        this.currentPage = 1;
        this.applyFleetFilters();
      });
    });

    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderFleetTable();
        }
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(this.filteredFleet.length / this.pageSize);
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.renderFleetTable();
        }
      });
    }

    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        this.pageSize = parseInt(e.target.value, 10);
        this.currentPage = 1;
        this.renderFleetTable();
      });
    }

    document.querySelectorAll('.fleet-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (this.currentSort.col === col) {
          this.currentSort.dir = this.currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this.currentSort.col = col;
          this.currentSort.dir = 'asc';
        }
        this.applyFleetFilters();
      });
    });
  },

  applyFleetFilters() {
    if (!this.fleet || this.fleet.length === 0) return;

    const { search, tier, cat, alert } = this.activeFilter;

    this.filteredFleet = this.fleet.filter(r => {
      if (search) {
        const matchLoc = r.loc && r.loc.toLowerCase().includes(search);
        const matchHost = r.host && r.host.toLowerCase().includes(search);
        const matchCode = r.code && r.code.toLowerCase().includes(search);
        const matchIp = (r.ip && r.ip.includes(search)) || (r.zt && r.zt.includes(search));
        const matchCpu = r.cpu && r.cpu.toLowerCase().includes(search);
        if (!matchLoc && !matchHost && !matchCode && !matchIp && !matchCpu) return false;
      }

      if (tier !== 'all') {
        if (tier === 'diamond' && r.tier.toLowerCase() !== 'diamond') return false;
        if (tier === 'gold' && r.tier.toLowerCase() !== 'gold') return false;
        if (tier === 'silver' && r.tier.toLowerCase() !== 'silver') return false;
      }

      if (cat !== 'all') {
        if (cat === 'server' && r.cat !== 'Server') return false;
        if (cat === 'admin' && r.cat !== 'Admin') return false;
        if (cat === 'gate' && r.cat !== 'Gate / Kiosk') return false;
        if (cat === 'cashier' && r.cat !== 'Cashier') return false;
      }

      if (alert !== 'all') {
        if (alert === 'overheat' && (!r.temp || r.temp < 80)) return false;
        if (alert === 'low_ssd' && (!r.ssd_health || r.ssd_health >= 70)) return false;
        if (alert === 'high_storage' && (!r.ssd_usage || r.ssd_usage < 85)) return false;
        if (alert === 'normal') {
          if ((r.temp && r.temp >= 80) || (r.ssd_health && r.ssd_health < 70) || (r.ssd_usage && r.ssd_usage >= 85)) return false;
        }
      }

      return true;
    });

    const { col, dir } = this.currentSort;
    this.filteredFleet.sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      if (va === null || va === undefined) va = '';
      if (vb === null || vb === undefined) vb = '';

      if (typeof va === 'string') {
        return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      } else {
        return dir === 'asc' ? va - vb : vb - va;
      }
    });

    this.renderFleetTable();
  },

  renderFleetTable() {
    const tbody = document.getElementById('fleetTableBody');
    const countLabel = document.getElementById('tableCountLabel');
    const pageNumLabel = document.getElementById('currentPageLabel');
    if (!tbody) return;

    const total = this.filteredFleet.length;
    const startIdx = (this.currentPage - 1) * this.pageSize;
    const endIdx = Math.min(startIdx + this.pageSize, total);
    const pageRows = this.filteredFleet.slice(startIdx, endIdx);

    if (countLabel) {
      countLabel.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari total ${total.toLocaleString()} unit`;
    }
    if (pageNumLabel) {
      const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
      pageNumLabel.textContent = `Halaman ${this.currentPage} / ${totalPages}`;
    }

    if (pageRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">Tidak ada data yang cocok dengan kriteria filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageRows.map((row, idx) => {
      const tierClass = row.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (row.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver');
      
      let tempHtml = '<span style="color: var(--text-muted);">-</span>';
      if (row.temp !== null && row.temp !== undefined) {
        const cls = row.temp >= 80 ? 'temp-hot' : (row.temp >= 70 ? 'temp-warm' : 'temp-cool');
        tempHtml = `<span class="temp-badge ${cls}">${row.temp}°C</span>`;
      }

      let healthHtml = '<span style="color: var(--text-muted);">-</span>';
      if (row.ssd_health !== null && row.ssd_health !== undefined) {
        const cls = row.ssd_health < 70 ? 'health-bad' : (row.ssd_health < 90 ? 'health-warn' : 'health-good');
        healthHtml = `<span class="ssd-health-pill ${cls}">${row.ssd_health}%</span>`;
      }

      let usageHtml = '<span style="color: var(--text-muted);">-</span>';
      if (row.ssd_usage !== null && row.ssd_usage !== undefined) {
        const fillCol = row.ssd_usage >= 85 ? 'var(--color-danger)' : (row.ssd_usage >= 70 ? 'var(--color-warning)' : 'var(--color-success)');
        usageHtml = `
          <div class="usage-cell">
            <span style="font-family: var(--font-mono); font-weight: 700; font-size: 0.75rem; width: 32px;">${row.ssd_usage}%</span>
            <div class="usage-bar-track">
              <div class="usage-bar-fill" style="width: ${row.ssd_usage}%; background: ${fillCol};"></div>
            </div>
          </div>
        `;
      }

      return `
        <tr onclick="App.openDetailModal(${startIdx + idx})">
          <td>
            <div style="font-weight: 700; color: var(--text-main);">${row.loc}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">Kode: ${row.code || '-'}</div>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${row.tier || 'Standard'}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary);">${row.host}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${row.cat}</div>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-size: 0.78rem;">${row.ip || '-'}</div>
            <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-secondary);">${row.zt ? 'ZT: ' + row.zt : ''}</div>
          </td>
          <td>${tempHtml}</td>
          <td>${healthHtml}</td>
          <td>${usageHtml}</td>
          <td>
            <div style="font-size: 0.78rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.os}">
              ${row.os.split(' ')[0]} ${row.os.split(' ')[1] || ''}
            </div>
          </td>
          <td>
            <button class="btn btn-outline" style="padding: 3px 8px; font-size: 0.72rem;">Detail</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  filterByLocation(locName) {
    const tabExplorer = document.querySelector('.sidebar-nav-btn[data-view="explorer"]');
    if (tabExplorer) tabExplorer.click();

    const searchInput = document.getElementById('tableSearchInput');
    if (searchInput) {
      searchInput.value = locName;
      this.activeFilter.search = locName.toLowerCase();
      this.currentPage = 1;
      this.applyFleetFilters();
    }
  },

  initHardwareTabs() {
    const hwBtns = document.querySelectorAll('.hw-tab-btn');
    hwBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        hwBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.hw;
        if (window.ChartManager && this.summary) {
          window.ChartManager.initHardwareChart(this.summary, cat);
        }
      });
    });
  },

  initModal() {
    const modal = document.getElementById('deviceDetailModal');
    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('open'));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }
  },

  openDetailModal(idx) {
    const item = this.filteredFleet[idx];
    if (!item) return;

    const modal = document.getElementById('deviceDetailModal');
    const body = document.getElementById('modalBodyContent');
    const title = document.getElementById('modalDeviceTitle');

    if (title) title.textContent = `${item.loc} — ${item.host}`;

    if (body) {
      body.innerHTML = `
        <div class="modal-spec-item">
          <div class="modal-spec-label">Lokasi & Kode</div>
          <div class="modal-spec-val">${item.loc} (${item.code})</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">Tier Layanan</div>
          <div class="modal-spec-val"><span class="tier-tag ${item.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (item.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver')}">${item.tier}</span></div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">IP Address</div>
          <div class="modal-spec-val mono">Local: ${item.ip || '-'} | ZeroTier: ${item.zt || '-'}</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">Suhu Prosessor</div>
          <div class="modal-spec-val">${item.temp ? item.temp + '°C' : 'N/A'}</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">Processor (CPU)</div>
          <div class="modal-spec-val">${item.cpu || '-'}</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">Motherboard</div>
          <div class="modal-spec-val">${item.mb || '-'}</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">Total RAM & Merek</div>
          <div class="modal-spec-val">${item.ram || '-'} (${item.ram_brand || '-'})</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">SSD Type & Kapasitas</div>
          <div class="modal-spec-val">${item.ssd_brand} (${item.ssd_type}) - ${item.ssd_size}</div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">SSD Health & Usage</div>
          <div class="modal-spec-val">Kesehatan: <strong>${item.ssd_health || '-'}%</strong> | Pemakaian: <strong>${item.ssd_usage || '-'}%</strong></div>
        </div>
        <div class="modal-spec-item">
          <div class="modal-spec-label">Versi Agent</div>
          <div class="modal-spec-val mono">${item.agent || '-'}</div>
        </div>
        <div class="modal-spec-item" style="grid-column: span 2;">
          <div class="modal-spec-label">Sistem Operasi (OS)</div>
          <div class="modal-spec-val mono" style="font-size: 0.825rem;">${item.os || '-'}</div>
        </div>
        <div class="modal-spec-item" style="grid-column: span 2;">
          <div class="modal-spec-label">Last Synchronized</div>
          <div class="modal-spec-val mono">${item.sync || '-'}</div>
        </div>
      `;
    }

    if (modal) modal.classList.add('open');
  },

  exportTableToCSV() {
    if (!this.filteredFleet || this.filteredFleet.length === 0) {
      this.showToast('Tidak ada data untuk diekspor', 'warn');
      return;
    }

    const headers = ['Lokasi', 'Kode', 'Tier', 'Hostname', 'Kategori', 'IP_Local', 'IP_ZeroTier', 'Suhu_C', 'SSD_Health', 'SSD_Usage', 'Processor', 'RAM', 'SSD', 'OS', 'Last_Sync'];
    const rows = this.filteredFleet.map(r => [
      `"${r.loc.replace(/"/g, '""')}"`,
      `"${r.code}"`,
      `"${r.tier}"`,
      `"${r.host}"`,
      `"${r.cat}"`,
      `"${r.ip}"`,
      `"${r.zt}"`,
      r.temp ?? '',
      r.ssd_health ?? '',
      r.ssd_usage ?? '',
      `"${(r.cpu || '').replace(/"/g, '""')}"`,
      `"${r.ram}"`,
      `"${r.ssd_brand} ${r.ssd_type}"`,
      `"${(r.os || '').replace(/"/g, '""')}"`,
      `"${r.sync}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parkee_fleet_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('File CSV berhasil diunduh.', 'success');
  },

  async syncGoogleSheets(isSilent = false) {
    const btn = document.getElementById('syncSheetBtn');
    if (btn && !isSilent) {
      btn.disabled = true;
      btn.innerHTML = `Menyinkronkan...`;
    }

    if (!isSilent) {
      this.showToast('Mengambil data terbaru dari Google Sheets...', 'info');
    }

    try {
      const res = await fetch(this.SHEET_CSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csvText = await res.text();

      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          this.processSyncData(results.data);
          
          localStorage.setItem('fleet_last_sync_timestamp', Date.now().toString());

          const lastSyncLabel = document.getElementById('lastSyncStatusLabel');
          if (lastSyncLabel) {
            const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            lastSyncLabel.textContent = `Terakhir disinkronkan: Hari ini, ${timeStr} WIB`;
          }

          this.showToast('Sinkronisasi Sukses. Data armada diperbarui.', 'success');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = `Sync Sheets Sekarang`;
          }
        },
        error: (err) => {
          throw err;
        }
      });
    } catch (e) {
      console.error('Sync failed', e);
      if (!isSilent) {
        this.showToast('Gagal menyinkronkan live: ' + e.message, 'error');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `Sync Sheets Sekarang`;
      }
    }
  },

  processSyncData(rows) {
    const locTiers = {};
    rows.forEach(r => {
      const loc = (r['Nama Lokasi'] || '').trim();
      const tier = (r['Tier'] || '').trim();
      if (loc && tier) locTiers[loc] = tier;
    });

    const cleanNum = (val, isFloat = false) => {
      if (!val) return null;
      val = val.replace('Â°C', '').replace('°C', '').replace('C', '').replace('%', '').replace(',', '.').trim();
      const m = val.match(/[-+]?\d*\.?\d+/);
      return m ? (isFloat ? parseFloat(m[0]) : parseInt(m[0], 10)) : null;
    };

    const newFleet = [];
    rows.forEach(r => {
      const loc = (r['Nama Lokasi'] || '').trim();
      if (!loc) return;
      const host = (r['Nama Device / Hostname'] || '').trim();
      const hLower = host.toLowerCase();

      let devCat = 'Other / Network';
      if (hLower.includes('server')) devCat = 'Server';
      else if (hLower.includes('admin')) devCat = 'Admin';
      else if (['pm', 'pos', 'gate', 'barrier', 'kiosk', 'dispenser'].some(k => hLower.includes(k))) devCat = 'Gate / Kiosk';
      else if (hLower.includes('cashier') || hLower.includes('kasir')) devCat = 'Cashier';

      const tier = (r['Tier'] || '').trim() || locTiers[loc] || 'Standard / Unset';

      newFleet.push({
        loc,
        code: (r['Kode Unik Lokasi'] || '').trim(),
        tier,
        host,
        cat: devCat,
        ip: (r['IP local lokasi'] || '').trim(),
        zt: (r['IP ZT Lokasi'] || '').trim(),
        sync: (r['Last Sync'] || '').trim(),
        agent: (r['Agent Version'] || '').trim(),
        cpu: (r['Processor'] || '').trim(),
        ram: (r['Total Ram'] || '').trim(),
        mb: (r['Merek Motherboard'] || '').trim(),
        ssd_brand: (r['Merk SSD'] || '').trim(),
        ssd_type: (r['Type SSD (SATA/NVME)'] || '').toUpperCase().includes('NVME') ? 'NVMe' : 'SATA',
        ssd_size: (r['Size SSD'] || '').trim(),
        ssd_health: cleanNum(r['Health SSD']),
        ssd_usage: cleanNum(r['SSD Usage']),
        temp: cleanNum(r['Temperature'], true),
        os: (r['OS Version'] || '').trim()
      });
    });

    this.fleet = newFleet;
    this.applyFleetFilters();
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
