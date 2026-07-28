document.addEventListener('DOMContentLoaded', () => {

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.feature-card, .step, .section-title').forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        const original = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.innerHTML = original;
          btn.classList.remove('copied');
        }, 1500);
      });
    });
  });

  const heroImage = document.querySelector('.hero-image');
  if (heroImage) {
    const maxRotateX = 75;
    const scrollRange = window.innerHeight * 0.8;

    window.addEventListener('scroll', () => {
      const progress = Math.min(window.scrollY / scrollRange, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const rotateX = maxRotateX * (1 - eased);
      heroImage.style.transform = `rotateX(${rotateX}deg)`;
    }, { passive: true });
  }

});
