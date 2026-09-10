const slides = [...document.querySelectorAll('.slide')];
const dots = document.getElementById('dots');
let i = 0;

slides.forEach((_, n) => {
  const b = document.createElement('button');
  b.className = 'dot';
  b.setAttribute('aria-label', 'Go to slide ' + (n + 1));
  b.addEventListener('click', () => go(n));
  dots.appendChild(b);
});

function go(n) {
  i = Math.max(0, Math.min(slides.length - 1, n));
  slides.forEach((s, k) => s.classList.toggle('on', k === i));
  [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  document.getElementById('counter').textContent = (i + 1) + ' / ' + slides.length;
  document.getElementById('prev').disabled = i === 0;
  document.getElementById('next').disabled = i === slides.length - 1;
  document.getElementById('progress').style.width = ((i + 1) / slides.length * 100) + '%';
  slides[i].scrollTop = 0;
  if (history.replaceState) history.replaceState(null, '', '#' + (i + 1));
}

document.getElementById('next').addEventListener('click', () => go(i + 1));
document.getElementById('prev').addEventListener('click', () => go(i - 1));
document.getElementById('theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
});
document.getElementById('full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(i + 1); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
  if (e.key === 'Home') go(0);
  if (e.key === 'End') go(slides.length - 1);
  if (e.key === 'f' || e.key === 'F') document.getElementById('full').click();
  if (e.key === 't' || e.key === 'T') document.getElementById('theme').click();
});

let x0 = null;
document.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  if (x0 === null) return;
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 55) go(i + (dx < 0 ? 1 : -1));
  x0 = null;
}, { passive: true });

const start = parseInt((location.hash || '').replace('#', ''), 10);
go(Number.isFinite(start) && start > 0 ? start - 1 : 0);
