/**
 * PARKEE FleetIQ - Chart.js Visualizations
 * High-vibrancy, colorful gradients and interactive chart manager
 */

const ChartManager = {
  charts: {},

  // Vibrant Palette Tokens
  colors: {
    indigo: '#4f46e5',
    cyan: '#06b6d4',
    pink: '#ec4899',
    purple: '#8b5cf6',
    amber: '#f59e0b',
    emerald: '#10b981',
    rose: '#f43f5e',
    blue: '#2563eb',
    teal: '#14b8a6',
    slate: '#64748b',
    coolGreen: '#10b981',
    warmYellow: '#eab308',
    hotOrange: '#f97316',
    criticalRed: '#ef4444'
  },

  // Helper to create smooth linear gradient on canvas
  createGradient(ctx, color1, color2, isHorizontal = false) {
    if (!ctx) return color1;
    let gradient;
    if (isHorizontal) {
      gradient = ctx.createLinearGradient(0, 0, 400, 0);
    } else {
      gradient = ctx.createLinearGradient(0, 0, 0, 300);
    }
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    return gradient;
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
    const tiers = summary.tier_counts || {};

    this.charts.tier = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Diamond Hubs', 'Gold Sites', 'Silver Locations', 'Standard / Unset'],
        datasets: [{
          data: [tiers['Diamond'] || 0, tiers['Gold'] || 0, tiers['Silver'] || 0, tiers['Standard / Unset'] || 0],
          backgroundColor: [
            this.colors.cyan,
            this.colors.amber,
            this.colors.purple,
            '#cbd5e1'
          ],
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 12 },
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            padding: 12,
            cornerRadius: 10,
            titleFont: { family: 'Outfit', weight: '700' }
          }
        },
        cutout: '68%'
      }
    });
  },

  // 2. Device Types (Bar)
  initDeviceChart(summary) {
    const canvas = document.getElementById('chartDevice');
    if (!canvas) return;
    if (this.charts.device) this.charts.device.destroy();

    const ctx = canvas.getContext('2d');
    const cats = summary.device_categories || {};

    const grad = this.createGradient(ctx, '#4f46e5', '#8b5cf6');

    this.charts.device = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(cats),
        datasets: [{
          label: 'Total Devices',
          data: Object.values(cats),
          backgroundColor: [
            '#4f46e5', // Server
            '#06b6d4', // Admin
            '#8b5cf6', // Network
            '#f59e0b', // Gate/Kiosk
            '#ec4899'  // Cashier
          ],
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            padding: 12,
            cornerRadius: 8
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: { font: { family: 'Plus Jakarta Sans', weight: '600' } }
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Plus Jakarta Sans', weight: '600' } }
          }
        }
      }
    });
  },

  // 3. Thermal Distribution (Horizontal Bar)
  initThermalChart(summary) {
    const canvas = document.getElementById('chartThermal');
    if (!canvas) return;
    if (this.charts.thermal) this.charts.thermal.destroy();

    const ctx = canvas.getContext('2d');
    const ranges = summary.temp_stats?.ranges || {};

    this.charts.thermal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(ranges),
        datasets: [{
          label: 'Devices in Range',
          data: Object.values(ranges),
          backgroundColor: [
            this.colors.coolGreen,
            this.colors.teal,
            this.colors.warmYellow,
            this.colors.hotOrange,
            this.colors.criticalRed
          ],
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            padding: 12,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: { font: { family: 'Plus Jakarta Sans', weight: '600' } }
          },
          y: {
            grid: { display: false },
            ticks: { font: { family: 'Plus Jakarta Sans', weight: '600' } }
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
            'rgba(244, 63, 94, 0.85)'
          ],
          borderColor: '#ffffff',
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
              boxWidth: 12,
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 11 },
              padding: 12
            }
          }
        },
        scales: {
          r: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
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
    let dataMap = {};
    let label = 'CPU Families';

    if (category === 'cpu') {
      dataMap = summary.cpu_families || {};
      label = 'CPU Processors';
    } else if (category === 'ssd') {
      dataMap = summary.ssd_brands || {};
      label = 'SSD Brands';
    } else if (category === 'ram') {
      dataMap = summary.ram_brands || {};
      label = 'RAM Brands';
    } else if (category === 'mb') {
      dataMap = summary.mb_brands || {};
      label = 'Motherboard Brands';
    }

    const palette = [
      '#4f46e5', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#8b5cf6', '#64748b'
    ];

    this.charts.hardware = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(dataMap),
        datasets: [{
          data: Object.values(dataMap),
          backgroundColor: palette.slice(0, Object.keys(dataMap).length),
          borderColor: '#ffffff',
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
              boxWidth: 12,
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 11 },
              padding: 12
            }
          }
        },
        cutout: '60%'
      }
    });
  },

  // 6. OS Modernization (Bar)
  initOSChart(summary) {
    const canvas = document.getElementById('chartOS');
    if (!canvas) return;
    if (this.charts.os) this.charts.os.destroy();

    const ctx = canvas.getContext('2d');
    const osMap = summary.os_distribution || {};

    this.charts.os = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(osMap),
        datasets: [{
          label: 'Deployed Fleet Instances',
          data: Object.values(osMap),
          backgroundColor: [
            '#10b981', // 22.04 LTS Modern
            '#f59e0b', // 18.04 LTS Legacy
            '#06b6d4', // 20.04 LTS
            '#8b5cf6', // 24.04 LTS
            '#64748b',
            '#cbd5e1'
          ],
          borderRadius: 8
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
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: { font: { family: 'Plus Jakarta Sans', weight: '600' } }
          },
          x: {
            grid: { display: false },
            ticks: {
              font: { family: 'Plus Jakarta Sans', weight: '600', size: 10 },
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

  // Slide 1: Fleet Scale Chart
  initSlide1Chart(summary) {
    const canvas = document.getElementById('slide1Chart');
    if (!canvas) return;
    if (this.charts.slide1) this.charts.slide1.destroy();

    const ctx = canvas.getContext('2d');
    const cats = summary.device_categories || {};

    this.charts.slide1 = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(cats),
        datasets: [{
          data: Object.values(cats),
          backgroundColor: ['#4f46e5', '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899'],
          borderColor: '#ffffff',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { family: 'Plus Jakarta Sans', weight: '700', size: 13 }, padding: 16 }
          }
        },
        cutout: '62%'
      }
    });
  },

  // Slide 2: Thermal Breakdown
  initSlide2Chart(summary) {
    const canvas = document.getElementById('slide2Chart');
    if (!canvas) return;
    if (this.charts.slide2) this.charts.slide2.destroy();

    const ctx = canvas.getContext('2d');
    const ranges = summary.temp_stats?.ranges || {};

    this.charts.slide2 = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(ranges),
        datasets: [{
          label: 'Device Nodes',
          data: Object.values(ranges),
          backgroundColor: ['#10b981', '#06b6d4', '#f59e0b', '#f97316', '#ef4444'],
          borderRadius: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { padding: 12, cornerRadius: 8 }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
          x: { grid: { display: false }, ticks: { font: { weight: '600' } } }
        }
      }
    });
  },

  // Slide 3: Storage Reliability
  initSlide3Chart(summary) {
    const canvas = document.getElementById('slide3Chart');
    if (!canvas) return;
    if (this.charts.slide3) this.charts.slide3.destroy();

    const ctx = canvas.getContext('2d');
    const ssdTypes = summary.ssd_types || {};

    this.charts.slide3 = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['NVMe Ultra-Fast', 'SATA Enterprise', 'Other / Unset'],
        datasets: [{
          data: [ssdTypes['NVMe'] || 0, ssdTypes['SATA'] || 0, ssdTypes['Other'] || 0],
          backgroundColor: ['#4f46e5', '#06b6d4', '#cbd5e1'],
          borderColor: '#ffffff',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'Plus Jakarta Sans', weight: '700', size: 12 }, padding: 14 }
          }
        }
      }
    });
  },

  // Slide 4: Hardware Diversity
  initSlide4Chart(summary) {
    const canvas = document.getElementById('slide4Chart');
    if (!canvas) return;
    if (this.charts.slide4) this.charts.slide4.destroy();

    const ctx = canvas.getContext('2d');
    const cpu = summary.cpu_families || {};

    this.charts.slide4 = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(cpu),
        datasets: [{
          label: 'Deployed Processors',
          data: Object.values(cpu),
          backgroundColor: ['#8b5cf6', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#3b82f6'],
          borderRadius: 8
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: '#f1f5f9' } },
          y: { grid: { display: false }, ticks: { font: { weight: '600' } } }
        }
      }
    });
  }
};

window.ChartManager = ChartManager;
