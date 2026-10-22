# ⚡ PARKEE FleetIQ — Dashboard Presentasi Interaktif Server & Client

> **Executive Infrastructure Analytics & Nationwide Fleet Telemetry**  
> Visualisasi interaktif performa 7,518 node perangkat (Server Sentral, Admin POS, Gate, Kiosk) di 961 lokasi komersial seluruh Indonesia.

🔗 **Live Demo (GitHub Pages):**  
👉 **[https://support-parkee.github.io/Dashboard/](https://support-parkee.github.io/Dashboard/)**

---

## 🌟 Fitur Utama

1. **📽️ Presentasi Interaktif (Keynote / Pitch Deck Mode)**:
   - 6 slide presentasi eksekutif siap pakai untuk rapat manajemen.
   - Kontrol navigasi slide via keyboard (`Spasi`, `Panah Kanan/Kiri`, `F` untuk Fullscreen).
   - Fitur otomatis **Auto-Play** (12 detik per slide).
   - Analisis mendalam: Skala Armada, Ancaman Thermal/Overheat, Degradasi SSD, Ekosistem Hardware, Migrasi OS, dan Roadmap Aksi 30-60-90 Hari.

2. **📊 Matriks Eksekutif (Executive Overview)**:
   - 4 Hero KPI Cards real-time (Total Unit, Thermal Alert ≥80°C, Degraded SSD <70%, Disk Full ≥85%).
   - 6 Grafik warna-warni interaktif Chart.js (Tier Donut, Tipe Perangkat, Spektrum Suhu, Kesehatan SSD, Vendor Hardware, dan Adopsi OS).
   - Tabel Top 12 Lokasi Hotspot yang paling membutuhkan tindakan mitigasi (Sopodel Tower, Grand Wisata, dll).

3. **🔍 Eksplorasi Armada Lengkap (Fleet Explorer)**:
   - Pencarian cerdas instan (Nama Lokasi, Kode Unik, Hostname, IP Local, ZeroTier IP, CPU).
   - Filter bertingkat: Berdasarkan Tier (Diamond/Gold/Silver), Kategori Perangkat, dan Kondisi Kesehatan.
   - Pengurutan dinamis (Sortable columns) & drawer pop-up detail spesifikasi teknis lengkap setiap unit.
   - Tombol **Ekspor CSV** untuk pelaporan mingguan/bulanan.

4. **🚨 Ruang Tanggap Insiden (Incident Room)**:
   - Triage terpusat untuk 155 unit bersuhu kritis (≥80°C), 99 SSD terdegradasi (<70%), dan 198 unit disk penuh (≥85%).

5. **🔄 Live Sync Google Sheets**:
   - Terintegrasi langsung dengan sumber data Google Spreadsheet: [Master Data Perangkat](https://docs.google.com/spreadsheets/d/11HUECMQG_30Sc1AupFLac7OxBDiFiZOD339LjiOkpdc/edit?gid=0#gid=0).
   - Tombol sinkronisasi sekali klik dengan parsing otomatis di sisi browser tanpa lag.

---

## 🛠️ Arsitektur Teknologi

- **Frontend**: Vanilla HTML5, Modern CSS (Glassmorphism, Vibrant Palette), Pure JavaScript (ES6+).
- **Charts & Engine**: [Chart.js 4.4](https://www.chartjs.org/) & [PapaParse 5.4](https://www.papaparse.com/).
- **Data Pipeline**: Precomputed JSON + Live CSV Fetching fallback.
- **Hosting**: GitHub Pages (`github.io`).

---

*Dikembangkan untuk keandalan dan monitoring operasional infrastruktur PARKEE se-Indonesia.*
