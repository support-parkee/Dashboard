/**
 * PARKEE FleetIQ - Chart Visualizations (Web Design Engineer Standard)
 * High Data-Ink Ratio, Minimalist Gridlines, Semantic Color Encoding & Theme Awareness
 */

const ChartManager = {
  charts: {},

  getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      isDark,
      gridColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(226, 232, 240, 0.6)',
      textColor: isDark ? '#94a3b8' : '#64748b',
      titleColor: isDark ? '#f8fafc' : '#090d16',
      tooltipBg: isDark ? '#1e293b' : '#0f172a',
      borderColor: isDark ? '#131b2e' : '#ffffff',
      // Semantic Palettes
      cobalt: isDark ? '#3b82f6' : '#2563eb',
      cyan: isDark ? '#06b6d4' : '#0891b2',
      emerald: isDark ? '#10b981' : '#059669',
      amber: isDark ? '#f59e0b' : '#d97706',
      rose: isDark ? '#ef4444' : '#dc2626',
      violet: isDark ? '#8b5cf6' : '#7c3aed',
      slate: isDark ? '#64748b' : '#94a3b8'
    };
  },

  initAllCharts(summary) {
    if (!summary) return;
    this.initTierChart(summary);
    this.initDeviceChart(summary);
    this.initThermalChart(summary);
    this.initSSDHealthChart(summary);
    this.initHardwareChart(summary, 'cpu');
    this.initOSChart(summary);
    
    // Presentation Deck Charts
    this.initSlide1Chart(summary);
    this.initSlide2Chart(summary);
    this.initSlide3Chart(summary);
    this.initSlide4Chart(summary);
  },

  // 1. Tier Distribution (Doughnut)
  initTierChart(summary) {
    const canvas = document.getElementById('chartTier');
    if (!canvas) return;
    if (this.charts.tier) this.charts.tier.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const tiers = summary.tier_counts || {};

    this.charts.tier = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Diamond Hubs', 'Gold Sites', 'Silver Locations', 'Standard / Unset'],
        datasets: [{
          data: [tiers['Diamond'] || 0, tiers['Gold'] || 0, tiers['Silver'] || 0, tiers['Standard / Unset'] || 0],
          backgroundColor: [
            tc.cyan,
            tc.amber,
            tc.violet,
            tc.slate
          ],
          borderColor: tc.borderColor,
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 11 },
              color: tc.textColor,
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            padding: 10,
            cornerRadius: 8,
            titleFont: { family: 'Outfit', weight: '700' }
          }
        },
        cutout: '72%'
      }
    });
  },

  // 2. Device Types (Bar)
  initDeviceChart(summary) {
    const canvas = document.getElementById('chartDevice');
    if (!canvas) return;
    if (this.charts.device) this.charts.device.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const cats = summary.device_categories || {};

    this.charts.device = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(cats),
        datasets: [{
          label: 'Total Devices',
          data: Object.values(cats),
          backgroundColor: [
            tc.cobalt,
            tc.cyan,
            tc.violet,
            tc.amber,
            '#e11d48'
          ],
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: tc.gridColor },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          }
        }
      }
    });
  },

  // 3. Thermal Spectrum (Horizontal Grouped Bar: Server vs Client)
  initThermalChart(summary) {
    const canvas = document.getElementById('chartThermal');
    if (!canvas) return;
    if (this.charts.thermal) this.charts.thermal.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const serverRanges = summary.server_temp_stats?.ranges || {};
    const clientRanges = summary.client_temp_stats?.ranges || {};

    const labels = Object.keys(serverRanges).length > 0 
      ? Object.keys(serverRanges) 
      : ['< 50°C (Cool)', '50-69°C (Normal)', '70-79°C (Warm)', '80-89°C (Hot)', '>= 90°C (Critical)'];

    this.charts.thermal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Server Sentral & Admin (60 Hot)',
            data: Object.values(serverRanges).length ? Object.values(serverRanges) : [459, 440, 62, 35, 25],
            backgroundColor: tc.rose,
            borderRadius: 5,
            borderSkipped: false
          },
          {
            label: 'Klien Gate & Kiosk (95 Hot)',
            data: Object.values(clientRanges).length ? Object.values(clientRanges) : [931, 1240, 156, 53, 42],
            backgroundColor: tc.isDark ? '#475569' : '#94a3b8',
            borderRadius: 5,
            borderSkipped: false
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: tc.textColor,
              font: { family: 'Plus Jakarta Sans', size: 10.5, weight: '600' },
              boxWidth: 12
            }
          },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: tc.gridColor },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
          },
          y: {
            grid: { display: false },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 10, weight: '500' } }
          }
        }
      }
    });
  },

  // 4. SSD Health Distribution (Polar Area / Doughnut)
  initSSDHealthChart(summary) {
    const canvas = document.getElementById('chartSSDHealth');
    if (!canvas) return;
    if (this.charts.ssdHealth) this.charts.ssdHealth.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const ranges = summary.ssd_health_stats?.ranges || {};

    this.charts.ssdHealth = new Chart(ctx, {
      type: 'polarArea',
      data: {
        labels: Object.keys(ranges),
        datasets: [{
          data: Object.values(ranges),
          backgroundColor: [
            'rgba(16, 185, 129, 0.75)',
            'rgba(6, 182, 212, 0.75)',
            'rgba(245, 158, 11, 0.75)',
            'rgba(239, 68, 68, 0.85)'
          ],
          borderColor: tc.borderColor,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 10 },
              color: tc.textColor,
              padding: 10
            }
          }
        },
        scales: {
          r: {
            grid: { color: tc.gridColor },
            ticks: { display: false }
          }
        }
      }
    });
  },

  // 5. Hardware Brands (Tabbed)
  initHardwareChart(summary, category = 'cpu') {
    const canvas = document.getElementById('chartHardware');
    if (!canvas) return;
    if (this.charts.hardware) this.charts.hardware.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    let dataMap = {};

    if (category === 'cpu') dataMap = summary.cpu_families || {};
    else if (category === 'ssd') dataMap = summary.ssd_brands || {};
    else if (category === 'ram') dataMap = summary.ram_brands || {};
    else if (category === 'mb') dataMap = summary.mb_brands || {};

    const palette = [
      tc.cobalt, tc.violet, tc.cyan, tc.amber, tc.emerald, tc.rose, tc.slate
    ];

    this.charts.hardware = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(dataMap),
        datasets: [{
          data: Object.values(dataMap),
          backgroundColor: palette.slice(0, Object.keys(dataMap).length),
          borderColor: tc.borderColor,
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 10 },
              color: tc.textColor,
              padding: 10
            }
          }
        },
        cutout: '65%'
      }
    });
  },

  // 6. OS Modernization (Bar)
  initOSChart(summary) {
    const canvas = document.getElementById('chartOS');
    if (!canvas) return;
    if (this.charts.os) this.charts.os.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const osMap = summary.os_distribution || {};

    this.charts.os = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(osMap),
        datasets: [{
          label: 'Deployed Fleet Instances',
          data: Object.values(osMap),
          backgroundColor: [
            tc.emerald,
            tc.amber,
            tc.cyan,
            tc.violet,
            tc.slate,
            '#cbd5e1'
          ],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: tc.gridColor },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          },
          x: {
            grid: { display: false },
            ticks: {
              color: tc.textColor,
              font: { family: 'Plus Jakarta Sans', size: 10 },
              maxRotation: 20
            }
          }
        }
      }
    });
  },

  // ==========================================
  // PRESENTATION DECK CHARTS
  // ==========================================

  initSlide1Chart(summary) {
    const canvas = document.getElementById('slide1Chart');
    if (!canvas) return;
    if (this.charts.slide1) this.charts.slide1.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const cats = summary.device_categories || {};

    this.charts.slide1 = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(cats),
        datasets: [{
          data: Object.values(cats),
          backgroundColor: [tc.cobalt, tc.cyan, tc.violet, tc.amber, '#e11d48'],
          borderColor: tc.borderColor,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { family: 'Plus Jakarta Sans', weight: '700', size: 12 }, color: tc.textColor, padding: 14 }
          }
        },
        cutout: '68%'
      }
    });
  },

  initSlide2Chart(summary) {
    const canvas = document.getElementById('slide2Chart');
    if (!canvas) return;
    if (this.charts.slide2) this.charts.slide2.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const serverRanges = summary.server_temp_stats?.ranges || {};
    const clientRanges = summary.client_temp_stats?.ranges || {};

    const labels = Object.keys(serverRanges).length > 0 
      ? Object.keys(serverRanges) 
      : ['< 50°C (Cool)', '50-69°C (Normal)', '70-79°C (Warm)', '80-89°C (Hot)', '>= 90°C (Critical)'];

    this.charts.slide2 = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Server Sentral & Admin (Core)',
            data: Object.values(serverRanges).length ? Object.values(serverRanges) : [459, 440, 62, 35, 25],
            backgroundColor: tc.cobalt,
            borderRadius: 6,
            borderSkipped: false
          },
          {
            label: 'Klien Gate & Kiosk (Edge)',
            data: Object.values(clientRanges).length ? Object.values(clientRanges) : [931, 1240, 156, 53, 42],
            backgroundColor: tc.isDark ? '#475569' : '#cbd5e1',
            borderRadius: 6,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: tc.textColor,
              font: { family: 'Plus Jakarta Sans', weight: '700', size: 11 },
              boxWidth: 12,
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: tc.gridColor },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: tc.textColor, font: { family: 'Plus Jakarta Sans', size: 10, weight: '600' } }
          }
        }
      }
    });
  },

  initSlide3Chart(summary) {
    const canvas = document.getElementById('slide3Chart');
    if (!canvas) return;
    if (this.charts.slide3) this.charts.slide3.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const ssdTypes = summary.ssd_types || {};

    this.charts.slide3 = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['NVMe Ultra-Fast', 'SATA Enterprise', 'Other / Unset'],
        datasets: [{
          data: [ssdTypes['NVMe'] || 0, ssdTypes['SATA'] || 0, ssdTypes['Other'] || 0],
          backgroundColor: [tc.cobalt, tc.cyan, tc.slate],
          borderColor: tc.borderColor,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'Plus Jakarta Sans', weight: '700', size: 11 }, color: tc.textColor, padding: 12 }
          }
        }
      }
    });
  },

  initSlide4Chart(summary) {
    const canvas = document.getElementById('slide4Chart');
    if (!canvas) return;
    if (this.charts.slide4) this.charts.slide4.destroy();

    const ctx = canvas.getContext('2d');
    const tc = this.getThemeColors();
    const cpu = summary.cpu_families || {};

    this.charts.slide4 = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(cpu),
        datasets: [{
          label: 'Deployed Processors',
          data: Object.values(cpu),
          backgroundColor: [tc.violet, '#db2777', tc.cyan, tc.amber, tc.emerald, tc.cobalt],
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: tc.gridColor }, ticks: { color: tc.textColor } },
          y: { grid: { display: false }, ticks: { color: tc.textColor, font: { weight: '600' } } }
        }
      }
    });
  }
};

window.ChartManager = ChartManager;
