/**
 * PARKEE FleetIQ - Interactive Presentation Controller (Slide Deck / Keynote)
 * Fullscreen presentation runner, keyboard shortcuts, and auto-play
 */

const PresentationController = {
  currentSlide: 1,
  totalSlides: 6,
  autoPlayTimer: null,
  autoPlayIntervalMs: 12000, // 12 seconds per slide
  isPlaying: false,

  init() {
    this.bindEvents();
    this.updateSlideUI();
  },

  bindEvents() {
    // Next / Prev buttons
    const prevBtn = document.getElementById('deckPrevBtn');
    const nextBtn = document.getElementById('deckNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => this.prevSlide());
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextSlide());

    // Auto play button
    const autoBtn = document.getElementById('deckAutoPlayBtn');
    if (autoBtn) autoBtn.addEventListener('click', () => this.toggleAutoPlay());

    // Fullscreen button
    const fsBtn = document.getElementById('deckFullscreenBtn');
    if (fsBtn) fsBtn.addEventListener('click', () => this.toggleFullscreen());

    // Dots indicator
    const dots = document.querySelectorAll('.slide-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        const slideNum = parseInt(e.target.dataset.slide, 10);
        if (slideNum) this.goToSlide(slideNum);
      });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Only trigger if presentation view is active
      const presSection = document.getElementById('view-presentation');
      if (!presSection || !presSection.classList.contains('active-view')) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        this.nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.prevSlide();
      } else if (e.key.toLowerCase() === 'f') {
        this.toggleFullscreen();
      } else if (e.key === 'Home') {
        this.goToSlide(1);
      } else if (e.key === 'End') {
        this.goToSlide(this.totalSlides);
      }
    });
  },

  nextSlide() {
    if (this.currentSlide < this.totalSlides) {
      this.currentSlide++;
    } else {
      this.currentSlide = 1; // loop back
    }
    this.updateSlideUI();
  },

  prevSlide() {
    if (this.currentSlide > 1) {
      this.currentSlide--;
    } else {
      this.currentSlide = this.totalSlides;
    }
    this.updateSlideUI();
  },

  goToSlide(slideNum) {
    if (slideNum >= 1 && slideNum <= this.totalSlides) {
      this.currentSlide = slideNum;
      this.updateSlideUI();
    }
  },

  updateSlideUI() {
    // Hide all slides
    const slides = document.querySelectorAll('.slide-item');
    slides.forEach(slide => slide.classList.remove('active-slide'));

    // Show current slide
    const targetSlide = document.getElementById(`slide-${this.currentSlide}`);
    if (targetSlide) {
      targetSlide.classList.add('active-slide');
    }

    // Update Dots
    const dots = document.querySelectorAll('.slide-dot');
    dots.forEach(dot => {
      const s = parseInt(dot.dataset.slide, 10);
      dot.classList.toggle('active', s === this.currentSlide);
    });

    // Update Counter badge
    const badge = document.getElementById('deckSlideNumberBadge');
    if (badge) {
      badge.textContent = `SLIDE 0${this.currentSlide} / 0${this.totalSlides}`;
    }

    // Re-render charts for the active slide if needed
    if (window.ChartManager && window.currentSummary) {
      if (this.currentSlide === 1) window.ChartManager.initSlide1Chart(window.currentSummary);
      if (this.currentSlide === 2) window.ChartManager.initSlide2Chart(window.currentSummary);
      if (this.currentSlide === 3) window.ChartManager.initSlide3Chart(window.currentSummary);
      if (this.currentSlide === 4) window.ChartManager.initSlide4Chart(window.currentSummary);
    }
  },

  toggleAutoPlay() {
    const btn = document.getElementById('deckAutoPlayBtn');
    if (this.isPlaying) {
      clearInterval(this.autoPlayTimer);
      this.isPlaying = false;
      if (btn) btn.innerHTML = `<span>▶ Mulai Auto-Play</span>`;
    } else {
      this.isPlaying = true;
      if (btn) btn.innerHTML = `<span>⏸ Berhenti Auto-Play</span>`;
      this.autoPlayTimer = setInterval(() => {
        this.nextSlide();
      }, this.autoPlayIntervalMs);
    }
  },

  toggleFullscreen() {
    const container = document.querySelector('.slide-frame') || document.documentElement;
    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }
};

window.PresentationController = PresentationController;
