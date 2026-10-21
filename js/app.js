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
    pageSize: 15,
    sortCol: 'loc',
    sortDir: 'asc'
  },

  // Sisi Kanan (50%): Location Accordion Dropdowns
  pickerState: {
    search: '',
    tier: 'all',
    reader: 'all',
    condition: 'all'
  },
  expandedLocations: new Set(['Ancol Mansion']),
  targetHighlightedHost: null,

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

  // Navigation state
  activeView: 'locations',

  async init() {
    this.initTweaks();
    this.initNavigation();
    this.initFullscreen();
    this.initModal();
    this.setupDailyRefreshScheduler();

    // Check precomputed summary fallback
    if (window.PRECOMPUTED_SUMMARY) {
      this.summary = window.PRECOMPUTED_SUMMARY;
      this.renderSummaryKPIs();
    }

    // Load data sources
    await Promise.all([
      this.fetchLocations(),
      this.fetchServers(),
      this.fetchFleet(),
      this.fetchSummary()
    ]);

    this.initEventHandlers();
    this.renderActiveView();
  },

  // =========================================================================
  // DATA FETCHING
  // =========================================================================
  async fetchLocations() {
    try {
      const res = await fetch('./data/locations.json');
      if (res.ok) {
        this.locations = await res.json();
        const badge = document.getElementById('badgeTotalLocs');
        if (badge) badge.textContent = this.locations.length.toLocaleString();
        this.renderLocationsTable();
        this.renderClientLocationAccordions();
      }
    } catch (e) {
      console.warn('Could not load locations.json', e);
    }
  },

  async fetchServers() {
    try {
      const res = await fetch('./data/servers.json');
      if (res.ok) {
        const raw = await res.json();
        // Strict: Only hostnames starting with "server"
        this.servers = raw.filter(d => (d.host || '').toLowerCase().startsWith('server'));
        const badge = document.getElementById('badgeTotalServers');
        if (badge) badge.textContent = this.servers.length.toLocaleString();
        this.renderServersTable();
        this.renderStorageTable();
      }
    } catch (e) {
      console.warn('Could not load servers.json', e);
    }
  },

  async fetchFleet() {
    try {
      const res = await fetch('./data/fleet.json');
      if (res.ok) {
        this.fleet = await res.json();
        const clients = this.fleet.filter(d => !(d.host || '').toLowerCase().startsWith('server'));
        const badge = document.getElementById('badgeTotalClients');
        if (badge) badge.textContent = clients.length.toLocaleString();
        this.renderAllClientsNationwideTable();
        this.renderClientLocationAccordions();
      }
    } catch (e) {
      console.warn('Could not load fleet.json', e);
    }
  },

  async fetchSummary() {
    try {
      const res = await fetch('./data/summary.json');
      if (res.ok) {
        this.summary = await res.json();
        this.renderSummaryKPIs();
      }
    } catch (e) {
      console.warn('Could not load summary.json', e);
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

    if (elStorageTotal) elStorageTotal.textContent = (s.total_servers || 1982).toLocaleString();
    if (elNvmeRatio) elNvmeRatio.textContent = `${(s.server_nvme_count || 1328).toLocaleString()} NVMe`;
    if (elFullCount) elFullCount.textContent = (s.critical_server_storage_count || 39).toLocaleString();
    if (elLowHealth) elLowHealth.textContent = (s.critical_server_ssd_count || 19).toLocaleString();
  },

  // =========================================================================
  // VIEW NAVIGATION & ROUTING
  // =========================================================================
  initNavigation() {
    const navBtns = document.querySelectorAll('.sidebar-nav-btn');
    const topTitle = document.getElementById('topBarTitle');
    const crumbCurrent = document.getElementById('crumbCurrent');

    const metaMap = {
      locations: { title: 'Location Information', crumb: 'Location Information' },
      servers: { title: 'Server Specification', crumb: 'Server Specification' },
      clients: { title: 'Client Specification', crumb: 'Client Specification' },
      storage: { title: 'Storage (Server Only)', crumb: 'Storage Server' }
    };

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (!view) return;

        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active-view'));
        const targetSec = document.getElementById(`view-${view}`);
        if (targetSec) targetSec.classList.add('active-view');

        this.activeView = view;
        if (metaMap[view]) {
          if (topTitle) topTitle.textContent = metaMap[view].title;
          if (crumbCurrent) crumbCurrent.textContent = metaMap[view].crumb;
        }

        // Close mobile drawer if open
        const sidebar = document.getElementById('appSidebar');
        if (sidebar) sidebar.classList.remove('open');

        this.renderActiveView();
      });
    });

    // Mobile toggle
    const mobBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('appSidebar');
    if (mobBtn && sidebar) {
      mobBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    }
  },

  renderActiveView() {
    if (this.activeView === 'locations') {
      this.renderLocationsTable();
    } else if (this.activeView === 'servers') {
      this.renderServersTable();
    } else if (this.activeView === 'clients') {
      this.renderAllClientsNationwideTable();
      this.renderClientLocationAccordions();
    } else if (this.activeView === 'storage') {
      this.renderStorageTable();
    }
  },

  // =========================================================================
  // MODULE 1: LOCATION INFORMATION (10 Columns Requested)
  // =========================================================================
  renderLocationsTable() {
    const tbody = document.getElementById('locationsTableBody');
    if (!tbody) return;

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
      list = list.filter(item => item.tier && item.tier.toLowerCase() === this.locState.tier.toLowerCase());
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

    // Sort
    const col = this.locState.sortCol;
    const dir = this.locState.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[col] || '';
      let vb = b[col] || '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

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
    if (tableCount) tableCount.textContent = `Menampilkan ${startIdx + 1}-${Math.min(startIdx + this.locState.pageSize, list.length)} dari ${list.length.toLocaleString()} lokasi`;

    // Render 10 columns:
    // 1. Nama Lokasi
    // 2. Kode Unik Lokasi
    // 3. Tier
    // 4. IP ZT Lokasi
    // 5. Last Sync
    // 6. Agent Version
    // 7. Fisherman Version
    // 8. Watersheep Version
    // 9. WBO Version
    // 10. OS Version
    // 11. Aksi (Lihat Klien)
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada lokasi yang cocok dengan filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems.map(item => {
      const tierClass = item.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (item.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver');
      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.875rem;">${item.loc}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
              ${item.total_servers} Server · ${item.total_clients} Klien
            </div>
          </td>
          <td>
            <span class="version-code-tag">${item.code || '-'}</span>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${item.tier || 'Standard'}</span>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--accent-primary);">
              ${item.zt || '-'}
            </span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); white-space: nowrap;">
            ${item.last_sync || '-'}
          </td>
          <td>
            <span class="version-code-tag">${item.agent ? item.agent.split('-')[0] : '-'}</span>
          </td>
          <td>
            <span class="version-code-tag">${item.fisherman ? item.fisherman.split('-')[0] : '-'}</span>
          </td>
          <td>
            <span class="version-code-tag">${item.watersheep ? item.watersheep.split('-')[0] : '-'}</span>
          </td>
          <td>
            <span class="version-code-tag">${item.wbo || '-'}</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.os}">
            ${item.os ? item.os.split('(')[0].trim() : '-'}
          </td>
          <td>
            <button class="btn btn-outline" style="padding: 4px 10px; font-size: 0.72rem; white-space: nowrap;" onclick="App.jumpToClientSpec('${item.loc.replace(/'/g, "\\'")}')">
              Lihat Klien ➜
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  jumpToClientSpec(locName) {
    this.selectedLocation = locName;
    const clientNavBtn = document.querySelector('.sidebar-nav-btn[data-view="clients"]');
    if (clientNavBtn) clientNavBtn.click();
  },

  // =========================================================================
  // MODULE 2: SERVER SPECIFICATION (Data Lengkap Server)
  // =========================================================================
  renderServersTable() {
    const tbody = document.getElementById('serversTableBody');
    if (!tbody) return;

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
      list = list.filter(d => d.tier && d.tier.toLowerCase() === this.serverState.tier.toLowerCase());
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

    // Sort
    const col = this.serverState.sortCol;
    const dir = this.serverState.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

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
    if (tableCount) tableCount.textContent = `Menampilkan ${startIdx + 1}-${Math.min(startIdx + this.serverState.pageSize, list.length)} dari ${list.length.toLocaleString()} server`;

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada server yang cocok.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems.map(d => {
      const tierClass = d.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (d.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver');
      
      let tempClass = 'temp-cool';
      if (d.temp !== null) {
        if (d.temp >= 90) tempClass = 'temp-hot';
        else if (d.temp >= 80) tempClass = 'temp-hot';
        else if (d.temp >= 70) tempClass = 'temp-warm';
        else if (d.temp >= 50) tempClass = 'temp-normal';
      }

      let healthClass = 'health-good';
      if (d.ssd_health !== null && d.ssd_health < 70) healthClass = 'health-bad';
      else if (d.ssd_health !== null && d.ssd_health < 80) healthClass = 'health-warn';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${d.loc}</div>
            <span class="version-code-tag">${d.code || '-'}</span>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${d.tier || 'Standard'}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.85rem;">
              ${d.host}
            </div>
            <span style="font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">${d.cat}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-main);">${d.ip || '-'}</div>
            <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">ZT: ${d.zt || '-'}</div>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-main); min-width: 180px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${d.cpu || ''}">
            ${this.formatCpu(d.cpu)}
          </td>
          <td style="font-size: 0.78rem; font-weight: 600; color: var(--text-main);">
            ${d.ram || '-'} <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 400;">(${d.ram_brand || '-'})</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary); min-width: 150px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${d.mb || ''}">
            ${this.formatMb(d.mb, d.mb_brand)}
          </td>
          <td>
            <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-main);">${d.ssd_brand} ${d.ssd_size || ''}</div>
            <span class="version-code-tag" style="font-size: 0.65rem;">${d.ssd_type}</span>
          </td>
          <td>
            <span class="temp-badge ${tempClass}" style="font-weight: 700;">
              ${d.temp !== null ? d.temp + '°C' : '-'}
            </span>
          </td>
          <td>
            <span class="ssd-health-pill ${healthClass}">
              ${d.ssd_health !== null ? d.ssd_health + '%' : '-'}
            </span>
          </td>
          <td>
            <div style="font-size: 0.75rem; font-weight: 600; color: ${d.ssd_usage >= 85 ? 'var(--color-danger)' : 'var(--text-main)'};">
              ${d.ssd_usage !== null ? d.ssd_usage + '%' : '-'}
            </div>
          </td>
          <td style="font-size: 0.72rem; color: var(--text-muted); max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${d.os}">
            ${d.os ? d.os.split('(')[0].trim() : '-'}
          </td>
          <td>
            <button class="btn btn-outline" style="padding: 3px 8px; font-size: 0.72rem;" onclick="App.openServerDetailModal('${d.host}')">
              Detail
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  openServerDetailModal(hostname) {
    const dev = this.servers.find(d => d.host === hostname) || this.fleet.find(d => d.host === hostname);
    if (!dev) return;

    const modal = document.getElementById('deviceDetailModal');
    const title = document.getElementById('modalDeviceTitle');
    const body = document.getElementById('modalDeviceBody');

    if (title) title.textContent = `Server: ${dev.host} — ${dev.loc}`;

    if (body) {
      body.innerHTML = `
        <div class="modal-spec-item">
          <span class="modal-spec-label">Nama Lokasi</span>
          <span class="modal-spec-val">${dev.loc}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Kode Unik / Tier</span>
          <span class="modal-spec-val">${dev.code} · ${dev.tier}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP Local</span>
          <span class="modal-spec-val mono">${dev.ip || '-'}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">IP ZeroTier</span>
          <span class="modal-spec-val mono">${dev.zt || '-'}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Processor (CPU)</span>
          <span class="modal-spec-val">${this.formatCpu(dev.cpu)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Memori RAM</span>
          <span class="modal-spec-val">${dev.ram || '-'} (${dev.ram_brand || '-'})</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Motherboard</span>
          <span class="modal-spec-val">${this.formatMb(dev.mb, dev.mb_brand)}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Storage SSD</span>
          <span class="modal-spec-val">${dev.ssd_brand} (${dev.ssd_type}) ${dev.ssd_size} · Health: ${dev.ssd_health}% · Usage: ${dev.ssd_usage}%</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Suhu Operasional</span>
          <span class="modal-spec-val ${dev.temp >= 80 ? 'temp-hot' : ''}" style="display:inline-block;">${dev.temp !== null ? dev.temp + '°C' : '-'}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Sistem Operasi (OS)</span>
          <span class="modal-spec-val">${dev.os || '-'}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Versi Agent</span>
          <span class="modal-spec-val mono">${dev.agent || '-'}</span>
        </div>
        <div class="modal-spec-item">
          <span class="modal-spec-label">Last Telemetry Sync</span>
          <span class="modal-spec-val">${dev.sync || '-'}</span>
        </div>
      `;
    }

    if (modal) modal.classList.add('open');
  },

  // =========================================================================
  // MODULE 3: CLIENT SPECIFICATION (50:50 All Clients & Location Dropdowns)
  // =========================================================================
  renderAllClientsNationwideTable() {
    const tbody = document.getElementById('allClientsTableBody');
    if (!tbody) return;

    let list = this.fleet.filter(d => !(d.host || '').toLowerCase().startsWith('server'));

    // Quick filter pills
    if (this.allClientsState.filter === 'reader') {
      list = list.filter(d => d.reader_ver || d.reader_sn);
    } else if (this.allClientsState.filter === 'warm') {
      list = list.filter(d => d.temp !== null && d.temp >= 70);
    } else if (this.allClientsState.filter === 'hot') {
      list = list.filter(d => d.temp !== null && d.temp >= 80);
    }

    // Specific Filter: Role
    if (this.allClientsState.role !== 'all') {
      list = list.filter(d => {
        const cat = (d.cat || '').toLowerCase();
        const host = (d.host || '').toLowerCase();
        if (this.allClientsState.role === 'gate') {
          return cat.includes('gate') || cat.includes('dispenser') || cat.includes('entry') || cat.includes('exit') || cat.includes('barrier');
        }
        if (this.allClientsState.role === 'cashier') {
          return cat.includes('cashier') || cat.includes('kasir');
        }
        if (this.allClientsState.role === 'admin') {
          return cat.includes('admin') || host.startsWith('admin');
        }
        if (this.allClientsState.role === 'other') {
          const isGate = cat.includes('gate') || cat.includes('dispenser') || cat.includes('entry') || cat.includes('exit') || cat.includes('barrier');
          const isCashier = cat.includes('cashier') || cat.includes('kasir');
          const isAdmin = cat.includes('admin') || host.startsWith('admin');
          return !isGate && !isCashier && !isAdmin;
        }
        return true;
      });
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
        (d.reader_sn && d.reader_sn.toLowerCase().includes(q)) ||
        (d.reader_ver && d.reader_ver.toLowerCase().includes(q)) ||
        (d.os && d.os.toLowerCase().includes(q))
      );
    }

    // Sort
    const col = this.allClientsState.sortCol;
    const dir = this.allClientsState.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

    const badge = document.getElementById('allClientsCountBadge');
    if (badge) badge.textContent = `${list.length.toLocaleString()} Unit`;

    // Pagination
    const totalPages = Math.ceil(list.length / this.allClientsState.pageSize) || 1;
    if (this.allClientsState.page > totalPages) this.allClientsState.page = totalPages;
    if (this.allClientsState.page < 1) this.allClientsState.page = 1;

    const startIdx = (this.allClientsState.page - 1) * this.allClientsState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + this.allClientsState.pageSize);

    const pageLabel = document.getElementById('allClientsPageLabel');
    if (pageLabel) pageLabel.textContent = `Halaman ${this.allClientsState.page} / ${totalPages}`;
    const countLabel = document.getElementById('allClientsCountLabel');
    if (countLabel) countLabel.textContent = `Menampilkan ${startIdx + 1}-${Math.min(startIdx + this.allClientsState.pageSize, list.length)} dari ${list.length.toLocaleString()} klien`;

    const prevBtn = document.getElementById('allClientsPrevBtn');
    const nextBtn = document.getElementById('allClientsNextBtn');
    if (prevBtn) prevBtn.disabled = this.allClientsState.page <= 1;
    if (nextBtn) nextBtn.disabled = this.allClientsState.page >= totalPages;

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada unit klien yang cocok.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems.map(d => {
      let tempClass = 'temp-cool';
      if (d.temp !== null) {
        if (d.temp >= 80) tempClass = 'temp-hot';
        else if (d.temp >= 70) tempClass = 'temp-warm';
        else if (d.temp >= 50) tempClass = 'temp-normal';
      }

      const hasReader = Boolean(d.reader_ver || d.reader_sn);
      const locEscaped = (d.loc || '').replace(/'/g, "\\'");
      const hostEscaped = (d.host || '').replace(/'/g, "\\'");

      return `
        <tr onclick="App.openLocationInAccordion('${locEscaped}', '${hostEscaped}')" title="Klik untuk membuka dropdown lokasi di sisi kanan">
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.8rem; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${d.loc}
            </div>
            <span class="version-code-tag" style="font-size: 0.65rem;">${d.code || '-'}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.8rem;">
              ${d.host}
            </div>
            <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">${d.cat}</span>
          </td>
          <td>
            ${hasReader ? `
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <span class="reader-ver-tag" style="font-size: 0.68rem; font-weight: 600; color: var(--color-success);">✓ ${d.reader_ver || 'Reader'}</span>
                ${d.reader_sn ? `<span style="font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-secondary);">${d.reader_sn}</span>` : ''}
              </div>
            ` : `<span style="font-size: 0.68rem; color: var(--text-muted); font-style: italic;">Tidak Ada</span>`}
          </td>
          <td style="font-family: var(--font-mono); font-size: 0.74rem;">
            ${d.ip || '-'}
          </td>
          <td>
            <span class="temp-badge ${tempClass}" style="font-weight: 700; font-size: 0.72rem; padding: 2px 6px;">
              ${d.temp !== null ? d.temp + '°C' : '-'}
            </span>
          </td>
          <td style="font-size: 0.74rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${d.cpu || ''}">
            ${this.formatCpu(d.cpu)}
          </td>
          <td>
            <button class="btn btn-outline" style="padding: 2px 7px; font-size: 0.7rem; white-space: nowrap;" onclick="event.stopPropagation(); App.openLocationInAccordion('${locEscaped}', '${hostEscaped}')">
              Buka ➔
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderClientLocationAccordions() {
    const container = document.getElementById('clientLocAccordionList');
    if (!container) return;

    let locs = [...this.locations];

    if (this.pickerState.search) {
      const q = this.pickerState.search.toLowerCase();
      locs = locs.filter(l => 
        (l.loc && l.loc.toLowerCase().includes(q)) ||
        (l.code && l.code.toLowerCase().includes(q))
      );
    }

    if (this.pickerState.tier !== 'all') {
      locs = locs.filter(l => l.tier && l.tier.toLowerCase() === this.pickerState.tier.toLowerCase());
    }

    // Specific Filter: RFID Reader
    if (this.pickerState.reader === 'yes') {
      locs = locs.filter(l => l.has_reader === true);
    } else if (this.pickerState.reader === 'no') {
      locs = locs.filter(l => !l.has_reader);
    }

    // Specific Filter: Condition (overheat, low_ssd)
    if (this.pickerState.condition === 'overheat') {
      locs = locs.filter(l => (l.client_overheats || 0) > 0 || (l.server_overheats || 0) > 0);
    } else if (this.pickerState.condition === 'low_ssd') {
      const lowSsdLocs = new Set(this.fleet.filter(d => d.ssd_health !== null && d.ssd_health < 70).map(d => (d.loc || '').toLowerCase()));
      locs = locs.filter(l => l.loc && lowSsdLocs.has(l.loc.toLowerCase()));
    }

    const badge = document.getElementById('pickerCountBadge');
    if (badge) badge.textContent = `${locs.length} Sites`;

    if (locs.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">Lokasi tidak ditemukan.</div>`;
      return;
    }

    container.innerHTML = locs.map(l => {
      const isOpen = this.expandedLocations.has(l.loc);
      const tierClass = l.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (l.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver');
      const locEscaped = l.loc.replace(/'/g, "\\'");
      const safeId = 'loc-acc-' + (l.code || l.loc).replace(/[^a-zA-Z0-9_-]/g, '_');

      let clientsHtml = '';
      if (isOpen) {
        const clients = this.fleet.filter(d => d.loc.toLowerCase() === l.loc.toLowerCase() && !(d.host || '').toLowerCase().startsWith('server'));
        if (clients.length === 0) {
          clientsHtml = `
            <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.82rem; background: var(--surface-card); border-radius: var(--radius-sm);">
              Seluruh unit di lokasi ini terdaftar sebagai server atau belum ada unit klien yang aktif.
            </div>
          `;
        } else {
          clientsHtml = `
            <div class="loc-accordion-clients-grid">
              ${clients.map(dev => {
                let tempClass = 'temp-cool';
                if (dev.temp !== null) {
                  if (dev.temp >= 80) tempClass = 'temp-hot';
                  else if (dev.temp >= 70) tempClass = 'temp-warm';
                  else if (dev.temp >= 50) tempClass = 'temp-normal';
                }
                const hasReader = Boolean(dev.reader_ver || dev.reader_sn);
                const isTarget = this.targetHighlightedHost === dev.host;

                return `
                  <div class="client-device-card ${isTarget ? 'pulse-highlight' : ''}" id="card-client-${dev.host}">
                    <!-- Top Row -->
                    <div class="client-card-top">
                      <div>
                        <div class="client-host-title">${dev.host}</div>
                        <span class="badge-pill" style="font-size: 0.68rem; margin-top: 3px; display: inline-block;">
                          ${dev.cat}
                        </span>
                      </div>
                      <span class="temp-badge ${tempClass}" style="font-weight: 700;">
                        ${dev.temp !== null ? dev.temp + '°C' : '-'}
                      </span>
                    </div>

                    <!-- RFID Reader Box -->
                    <div class="reader-telemetry-box" style="${hasReader ? '' : 'border-style: solid; border-color: var(--border-subtle);'}">
                      <div class="reader-badge-header">
                        <span>RFID / Barcode Reader Telemetry</span>
                        ${hasReader ? '<span style="color: var(--color-success); font-weight: 700;">✓ TERKONEKSI</span>' : '<span style="color: var(--text-muted);">TIDAK TERPASANG</span>'}
                      </div>
                      <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span class="reader-ver-tag">Versi: <strong>${dev.reader_ver || '-'}</strong></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span style="font-size: 0.72rem; color: var(--text-muted);">SN Reader:</span>
                          ${dev.reader_sn ? `
                            <div class="reader-sn-code">
                              <span>${dev.reader_sn}</span>
                              <button style="background: none; border: none; cursor: pointer; color: var(--accent-primary); margin-left: 6px; padding: 0;" title="Salin Serial Number" onclick="App.copyToClipboard('${dev.reader_sn}')">
                                📋
                              </button>
                            </div>
                          ` : '<span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">-</span>'}
                        </div>
                      </div>
                    </div>

                    <!-- Hardware Specs Grid -->
                    <div class="client-specs-grid">
                      <div class="client-spec-cell">
                        <span class="lbl">Processor</span>
                        <span class="val" title="${dev.cpu || ''}">${this.formatCpu(dev.cpu)}</span>
                      </div>
                      <div class="client-spec-cell">
                        <span class="lbl">RAM</span>
                        <span class="val">${dev.ram || '-'} (${dev.ram_brand || '-'})</span>
                      </div>
                      <div class="client-spec-cell">
                        <span class="lbl">Motherboard</span>
                        <span class="val" title="${dev.mb || ''}">${this.formatMb(dev.mb, dev.mb_brand)}</span>
                      </div>
                      <div class="client-spec-cell">
                        <span class="lbl">Storage SSD</span>
                        <span class="val">${dev.ssd_brand} (${dev.ssd_type}) ${dev.ssd_size}</span>
                      </div>
                      <div class="client-spec-cell">
                        <span class="lbl">SSD Health / Usage</span>
                        <span class="val">Health: ${dev.ssd_health !== null ? dev.ssd_health + '%' : '-'} · Use: ${dev.ssd_usage !== null ? dev.ssd_usage + '%' : '-'}</span>
                      </div>
                      <div class="client-spec-cell">
                        <span class="lbl">IP Local / ZT</span>
                        <span class="val mono">${dev.ip || '-'}</span>
                      </div>
                    </div>

                    <!-- Footer -->
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 0.5rem; font-size: 0.7rem; color: var(--text-muted);">
                      <span>OS: ${dev.os ? dev.os.split('(')[0].trim() : '-'}</span>
                      <span>Sync: ${dev.sync}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }
      }

      return `
        <div class="loc-accordion-item ${isOpen ? 'open' : ''}" id="${safeId}">
          <div class="loc-accordion-header" onclick="App.toggleLocationAccordion('${locEscaped}')">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="loc-accordion-chevron">▶</span>
              <div>
                <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${l.loc}</div>
                <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px;">
                  <span class="version-code-tag" style="font-size: 0.65rem;">${l.code || '-'}</span>
                  <span class="tier-tag ${tierClass}" style="font-size: 0.65rem; padding: 1px 5px;">${l.tier}</span>
                </div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge-pill" style="font-size: 0.72rem;">${l.total_clients} Klien</span>
              ${l.has_reader ? '<span class="version-code-tag" style="color: var(--color-success); font-weight: 700; font-size: 0.68rem;">✓ RFID</span>' : ''}
            </div>
          </div>

          ${isOpen ? `
            <div class="loc-accordion-body">
              <div class="loc-accordion-meta-bar">
                <span>IP ZeroTier: <strong style="font-family: var(--font-mono);">${l.zt || '-'}</strong></span>
                <span>Last Telemetry Sync: <strong>${l.last_sync || '-'}</strong></span>
              </div>
              ${clientsHtml}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  toggleLocationAccordion(locName) {
    if (this.expandedLocations.has(locName)) {
      this.expandedLocations.delete(locName);
    } else {
      this.expandedLocations.add(locName);
    }
    this.renderClientLocationAccordions();
  },

  openLocationInAccordion(locName, targetHost = null) {
    this.expandedLocations.add(locName);
    this.targetHighlightedHost = targetHost;
    this.renderClientLocationAccordions();

    setTimeout(() => {
      const locMeta = this.locations.find(l => l.loc.toLowerCase() === locName.toLowerCase());
      const safeId = 'loc-acc-' + (locMeta ? (locMeta.code || locMeta.loc) : locName).replace(/[^a-zA-Z0-9_-]/g, '_');
      const el = document.getElementById(safeId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      if (targetHost) {
        const cardEl = document.getElementById(`card-client-${targetHost}`);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cardEl.classList.add('pulse-highlight');
          setTimeout(() => cardEl.classList.remove('pulse-highlight'), 2000);
        }
      }
    }, 60);
  },

  // =========================================================================
  // MODULE 4: STORAGE (SERVER ONLY)
  // =========================================================================
  renderStorageTable() {
    const tbody = document.getElementById('storageTableBody');
    if (!tbody) return;

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
      list = list.filter(d => d.tier && d.tier.toLowerCase() === this.storageState.tier.toLowerCase());
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

    // Sort
    const col = this.storageState.sortCol;
    const dir = this.storageState.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

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
    if (tableCount) tableCount.textContent = `Menampilkan ${startIdx + 1}-${Math.min(startIdx + this.storageState.pageSize, list.length)} dari ${list.length.toLocaleString()} server storage`;

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">Tidak ada data storage server yang cocok.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems.map(d => {
      const tierClass = d.tier.toLowerCase() === 'diamond' ? 'tier-diamond' : (d.tier.toLowerCase() === 'gold' ? 'tier-gold' : 'tier-silver');
      
      let usageColor = 'var(--color-success)';
      let usageBadge = 'Normal';
      if (d.ssd_usage !== null) {
        if (d.ssd_usage >= 85) {
          usageColor = 'var(--color-danger)';
          usageBadge = '🚨 Kritis Full';
        } else if (d.ssd_usage >= 70) {
          usageColor = 'var(--color-warning)';
          usageBadge = '⚠️ Waspada';
        }
      }

      let healthColor = 'var(--color-success)';
      if (d.ssd_health !== null && d.ssd_health < 70) {
        healthColor = 'var(--color-danger)';
      } else if (d.ssd_health !== null && d.ssd_health < 80) {
        healthColor = 'var(--color-warning)';
      }

      let actionRecommendation = 'Operasional Normal';
      if (d.ssd_usage >= 85) {
        actionRecommendation = 'Log rotate & vacuum PostgreSQL';
      } else if (d.ssd_health < 70) {
        actionRecommendation = 'Jadwalkan kloning SSD cadangan';
      }

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${d.loc}</div>
            <span class="version-code-tag">${d.code || '-'}</span>
          </td>
          <td>
            <span class="tier-tag ${tierClass}">${d.tier || 'Standard'}</span>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 0.85rem;">
              ${d.host}
            </div>
          </td>
          <td>
            <span style="font-weight: 600; color: var(--text-main); font-size: 0.825rem;">${d.ssd_brand || '-'}</span>
          </td>
          <td>
            <span class="version-code-tag" style="font-weight: 700; color: ${d.ssd_type === 'NVMe' ? 'var(--accent-primary)' : 'var(--text-secondary)'};">
              ${d.ssd_type}
            </span>
          </td>
          <td style="font-family: var(--font-mono); font-size: 0.825rem; font-weight: 600;">
            ${d.ssd_size || '-'}
          </td>
          <td>
            <div class="storage-bar-wrap">
              <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: ${healthColor};">
                <span>Health</span>
                <span>${d.ssd_health !== null ? d.ssd_health + '%' : '-'}</span>
              </div>
              <div class="storage-bar-track">
                <div class="storage-bar-fill" style="width: ${d.ssd_health || 0}%; background: ${healthColor};"></div>
              </div>
            </div>
          </td>
          <td>
            <div class="storage-bar-wrap">
              <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: ${usageColor};">
                <span>Usage</span>
                <span>${d.ssd_usage !== null ? d.ssd_usage + '%' : '-'}</span>
              </div>
              <div class="storage-bar-track">
                <div class="storage-bar-fill" style="width: ${d.ssd_usage || 0}%; background: ${usageColor};"></div>
              </div>
            </div>
          </td>
          <td>
            <span class="temp-badge ${d.temp >= 80 ? 'temp-hot' : 'temp-cool'}" style="font-weight: 700;">
              ${d.temp !== null ? d.temp + '°C' : '-'}
            </span>
          </td>
          <td style="font-size: 0.72rem; color: var(--text-muted); white-space: nowrap;">
            ${d.sync}
          </td>
          <td style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 500;">
            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; background: var(--surface-hover); border: 1px solid var(--border-subtle);">
              ${actionRecommendation}
            </span>
          </td>
        </tr>
      `;
    }).join('');
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
      locSearch.addEventListener('input', (e) => {
        this.locState.search = e.target.value;
        this.locState.page = 1;
        this.renderLocationsTable();
      });
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
      serverSearch.addEventListener('input', (e) => {
        this.serverState.search = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
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
        this.serverState.filter = btn.dataset.serverFilter;
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

    const serverTempFilter = document.getElementById('serverTempFilter');
    if (serverTempFilter) {
      serverTempFilter.addEventListener('change', (e) => {
        this.serverState.tempRange = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverHealthFilter = document.getElementById('serverHealthFilter');
    if (serverHealthFilter) {
      serverHealthFilter.addEventListener('change', (e) => {
        this.serverState.healthRange = e.target.value;
        this.serverState.page = 1;
        this.renderServersTable();
      });
    }

    const serverUsageFilter = document.getElementById('serverUsageFilter');
    if (serverUsageFilter) {
      serverUsageFilter.addEventListener('change', (e) => {
        this.serverState.usageRange = e.target.value;
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
      allClientsSearch.addEventListener('input', (e) => {
        this.allClientsState.search = e.target.value;
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    document.querySelectorAll('.filter-pill[data-client-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-client-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.allClientsState.filter = btn.dataset.clientFilter;
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    });

    const clientRoleFilter = document.getElementById('clientRoleFilter');
    if (clientRoleFilter) {
      clientRoleFilter.addEventListener('change', (e) => {
        this.allClientsState.role = e.target.value;
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const clientReaderFilter = document.getElementById('clientReaderFilter');
    if (clientReaderFilter) {
      clientReaderFilter.addEventListener('change', (e) => {
        this.allClientsState.readerStatus = e.target.value;
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
        this.allClientsState.page = 1;
        this.renderAllClientsNationwideTable();
      });
    }

    const allClientsResetBtn = document.getElementById('allClientsResetFiltersBtn');
    if (allClientsResetBtn) {
      allClientsResetBtn.addEventListener('click', () => {
        this.allClientsState.search = '';
        this.allClientsState.filter = 'all';
        this.allClientsState.role = 'all';
        this.allClientsState.readerStatus = 'all';
        this.allClientsState.readerVer = 'all';
        this.allClientsState.cpu = 'all';
        this.allClientsState.tempRange = 'all';
        this.allClientsState.page = 1;

        if (allClientsSearch) allClientsSearch.value = '';
        if (clientRoleFilter) clientRoleFilter.value = 'all';
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
        this.renderAllClientsNationwideTable();
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
        const clients = this.fleet.filter(d => !d.is_server);
        this.exportCsv(clients, 'parkee_all_clients.csv');
      });
    }

    // Sisi Kanan: Location Accordions
    const pickerSearch = document.getElementById('pickerSearchInput');
    if (pickerSearch) {
      pickerSearch.addEventListener('input', (e) => {
        this.pickerState.search = e.target.value;
        this.renderClientLocationAccordions();
      });
    }

    document.querySelectorAll('.filter-pill[data-picker-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-picker-tier]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.pickerState.tier = btn.dataset.pickerTier;
        this.renderClientLocationAccordions();
      });
    });

    const pickerReaderFilter = document.getElementById('pickerReaderFilter');
    if (pickerReaderFilter) {
      pickerReaderFilter.addEventListener('change', (e) => {
        this.pickerState.reader = e.target.value;
        this.renderClientLocationAccordions();
      });
    }

    const pickerConditionFilter = document.getElementById('pickerConditionFilter');
    if (pickerConditionFilter) {
      pickerConditionFilter.addEventListener('change', (e) => {
        this.pickerState.condition = e.target.value;
        this.renderClientLocationAccordions();
      });
    }

    const pickerResetBtn = document.getElementById('pickerResetFiltersBtn');
    if (pickerResetBtn) {
      pickerResetBtn.addEventListener('click', () => {
        this.pickerState.search = '';
        this.pickerState.tier = 'all';
        this.pickerState.reader = 'all';
        this.pickerState.condition = 'all';

        if (pickerSearch) pickerSearch.value = '';
        if (pickerReaderFilter) pickerReaderFilter.value = 'all';
        if (pickerConditionFilter) pickerConditionFilter.value = 'all';

        document.querySelectorAll('.filter-pill[data-picker-tier]').forEach(b => {
          b.classList.toggle('active', b.dataset.pickerTier === 'all');
        });

        this.renderClientLocationAccordions();
        this.showToast('Filter Dropdown Lokasi berhasil direset', 'info');
      });
    }

    // -----------------------------------------------------------------------
    // 4. Storage Table Events
    // -----------------------------------------------------------------------
    const storageSearch = document.getElementById('storageSearchInput');
    if (storageSearch) {
      storageSearch.addEventListener('input', (e) => {
        this.storageState.search = e.target.value;
        this.storageState.page = 1;
        this.renderStorageTable();
      });
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
        document.querySelectorAll('.filter-pill[data-storage-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.storageState.filter = btn.dataset.storageFilter;
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    });

    const storageTypeFilter = document.getElementById('storageTypeFilter');
    if (storageTypeFilter) {
      storageTypeFilter.addEventListener('change', (e) => {
        this.storageState.type = e.target.value;
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
        this.storageState.page = 1;
        this.renderStorageTable();
      });
    }

    const storageUsageFilter = document.getElementById('storageUsageFilter');
    if (storageUsageFilter) {
      storageUsageFilter.addEventListener('change', (e) => {
        this.storageState.usageRange = e.target.value;
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

    // CSV Exports
    const exportLocs = document.getElementById('exportLocsCsvBtn');
    if (exportLocs) {
      exportLocs.addEventListener('click', () => this.exportCsv(this.locations, 'parkee_location_information.csv'));
    }

    const exportServers = document.getElementById('exportServersCsvBtn');
    if (exportServers) {
      exportServers.addEventListener('click', () => this.exportCsv(this.servers, 'parkee_server_specifications.csv'));
    }

    const exportStorage = document.getElementById('exportStorageCsvBtn');
    if (exportStorage) {
      exportStorage.addEventListener('click', () => this.exportCsv(this.servers, 'parkee_server_storage.csv'));
    }

    // Manual sync button
    const manualBtn = document.getElementById('manualSyncBtn');
    if (manualBtn) {
      manualBtn.addEventListener('click', () => this.manualSync());
    }
  },

  parseRamGb(ramStr) {
    if (!ramStr) return 0;
    const num = parseFloat(String(ramStr).replace(',', '.'));
    return isNaN(num) ? 0 : num;
  },

  parseStorageGb(sizeStr) {
    if (!sizeStr) return 0;
    const s = String(sizeStr).toUpperCase();
    if (s.includes('T')) {
      const val = parseFloat(s.replace('T', ''));
      return (isNaN(val) ? 1 : val) * 1000;
    }
    const val = parseFloat(s.replace(/[^0-9.]/g, ''));
    return isNaN(val) ? 0 : val;
  },

  // =========================================================================
  // MODAL & UTILS
  // =========================================================================
  initModal() {
    const modal = document.getElementById('deviceDetailModal');
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }
  },

  formatCpu(raw) {
    if (!raw) return '-';
    let s = String(raw)
      .replace(/\((?:R|TM)\)/gi, '')
      .replace(/\bCPU\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s || '-';
  },

  formatMb(raw, brand) {
    if (!raw || raw.toLowerCase().includes('default string')) {
      return (brand && brand !== 'Other Brand') ? brand : '-';
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
    return s || brand || '-';
  },

  copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.showToast(`Serial Number ${text} berhasil disalin!`, 'success');
    }).catch(() => {
      this.showToast('Gagal menyalin ke clipboard', 'error');
    });
  },

  showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${msg}</span>`;
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
    const csvStr = Papa.unparse(data);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast(`Berhasil mengekspor ${filename}`, 'success');
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
    };

    updateCountdown();
    setInterval(updateCountdown, 60000);
  },

  manualSync() {
    this.showToast('Menghubungkan ke Google Sheets...', 'info');
    setTimeout(() => {
      this.fetchLocations();
      this.fetchServers();
      this.fetchFleet();
      this.showToast('Data telemetri berhasil diperbarui!', 'success');
    }, 1000);
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
  // TWEAKS PANEL CONTROLLER (SKILL STANDARD)
  // =========================================================================
  initTweaks() {
    const savedTheme = localStorage.getItem('parkee_theme') || 'light';
    this.applyTheme(savedTheme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const curTheme = document.documentElement.getAttribute('data-theme') || 'light';
        this.applyTheme(curTheme === 'dark' ? 'light' : 'dark');
      });
    }
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('parkee_theme', theme);
    const iconSpan = document.getElementById('themeIconSpan');
    if (iconSpan) iconSpan.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
