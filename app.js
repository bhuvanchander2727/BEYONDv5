/**
 * BEYOND – The Gallery
 * Editorial Streetwear Mobile-First Web Application
 */

(function () {
  'use strict';

  // State Management
  let allProducts = [];
  let featuredProducts = [];
  let N = 0;
  let items = [];
  let bs = [];
  let pos = 0;
  let target = 0;
  let shown = -1;
  let timer = null;
  let drag = null;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let iw = 0;
  let reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // DOM Elements
  const hero = document.getElementById('hero');
  const stage = document.getElementById('stage');
  const rack = document.getElementById('rack');
  const bars = document.getElementById('bars');
  const nameEl = document.getElementById('name');
  const priceEl = document.getElementById('price');
  const cntEl = document.getElementById('cnt');
  const viewPieceBtn = document.getElementById('viewPieceBtn');
  const tabLinks = document.querySelectorAll('.tab');

  // LocalStorage Helpers
  const STORAGE_SAVED_KEY = 'beyond_saved_items_v1';
  const STORAGE_CART_KEY = 'beyond_cart_items_v1';

  function getStorage(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.warn('Storage error:', e);
      return fallback;
    }
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage write error:', e);
    }
  }

  function updateBadges() {
    const saved = getStorage(STORAGE_SAVED_KEY, []);
    const cart = getStorage(STORAGE_CART_KEY, []);

    const savedBadge = document.getElementById('savedCountBadge');
    const cartBadge = document.getElementById('cartCountBadge');
    const drawerSavedBadge = document.getElementById('drawerSavedBadge');
    const drawerCartBadge = document.getElementById('drawerCartBadge');

    const count = saved.length;
    if (savedBadge) {
      savedBadge.textContent = count;
      savedBadge.classList.toggle('visible', count > 0);
    }
    if (drawerSavedBadge) {
      drawerSavedBadge.textContent = count;
      drawerSavedBadge.classList.toggle('visible', count > 0);
    }

    const totalCount = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
    if (cartBadge) {
      cartBadge.textContent = totalCount;
      cartBadge.classList.toggle('visible', totalCount > 0);
    }
    if (drawerCartBadge) {
      drawerCartBadge.textContent = totalCount;
      drawerCartBadge.classList.toggle('visible', totalCount > 0);
    }
  }

  // 3D Math Helper: Wrap index around carousel ring
  function wrap(v) {
    return (((v % N) + N + N / 2) % N) - N / 2;
  }

  // Dynamic spacing factor based on viewport
  function getSpacingFactor() {
    const w = window.innerWidth;
    return w >= 1024 ? 1.05 : (w >= 768 ? 0.92 : 0.8);
  }

  // Calculate dynamic item width based on viewport and rack
  function size() {
    if (!rack) return;
    const rw = rack.clientWidth;
    const w = window.innerWidth;
    const rh = rack.clientHeight;

    if (w >= 1024) {
      // Desktop: proportioned to rack height, accommodating wider garments (moto jacket 0.803, tee 0.887)
      // Generous, prominent size while collar, sleeves, and hem never clip
      iw = Math.round(Math.min(Math.max(rh * 0.86, 420), 620));
    } else if (w >= 768) {
      // Tablet
      iw = Math.round(Math.min(rh * 0.86, 500));
    } else {
      // Mobile: prominent hero scale (+20-25% visible size) proportioned to rack height while maintaining balanced side margins
      iw = Math.round(rh * 0.77);
    }

    rack.style.setProperty('--iw', iw + 'px');
    items.forEach(function (e) {
      e.style.setProperty('--iw', iw + 'px');
    });
  }

  // Stage Render Function: Displays only the currently selected product
  function render() {
    if (!items.length) return;

    const s = ((Math.round(pos) % N) + N) % N;

    items.forEach(function (el, i) {
      if (i === s) {
        el.style.display = 'block';
        el.style.transform = 'translate3d(0, 0, 0)';
        el.style.opacity = '1';
        el.style.filter = 'none';
        el.style.zIndex = '20';
        el.style.pointerEvents = 'auto';
        el.setAttribute('aria-hidden', 'false');
      } else {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    });

    if (s !== shown) {
      shown = s;
      nameEl.classList.add('f');
      bs.forEach(function (b, k) {
        b.classList.toggle('on', k === s);
        b.setAttribute('aria-selected', k === s ? 'true' : 'false');
      });

      setTimeout(function () {
        const prod = featuredProducts[s];
        if (!prod) return;
        nameEl.textContent = prod.name;
        priceEl.textContent = prod.priceFormatted;
        cntEl.textContent = `0${s + 1} / 0${N}`;
        viewPieceBtn.href = `#/piece/${prod.id}`;
        nameEl.classList.remove('f');
      }, 140);
    }
  }

  // Physics animation loop with smooth lerping
  function loop() {
    const diff = target - pos;
    if (Math.abs(diff) > 0.0008) {
      pos += diff * (drag ? 0.35 : 0.11);
      render();
    }
    requestAnimationFrame(loop);
  }

  function goTo(k) {
    const cur = Math.round(target);
    const d = wrap(k - cur);
    target = cur + d;
    if (featuredProducts && featuredProducts.length) {
      const targetIdx = ((Math.round(target) % N) + N) % N;
      const prod = featuredProducts[targetIdx];
      if (prod && viewPieceBtn) {
        viewPieceBtn.href = `#/piece/${prod.id}`;
      }
    }
  }

  function play() {
    clearInterval(timer);
    if (!reduce) {
      timer = setInterval(function () {
        target = Math.round(target) + 1;
      }, 5500);
    }
  }

  function pause() {
    clearInterval(timer);
  }

  // 3D Restrained Parallax Tilt - Affects ONLY the product and its shadows
  function setParallax(x, y, isMobile) {
    if (!rack) return;
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));

    if (isMobile) {
      // Enhanced mobile gyroscope sensitivity: responsive to small phone movements with smooth natural motion
      rack.style.setProperty('--ry', (x * 10.5).toFixed(2) + 'deg');
      rack.style.setProperty('--rx', (-y * 7.5).toFixed(2) + 'deg');
      rack.style.setProperty('--tx', (x * 12).toFixed(1) + 'px');
      rack.style.setProperty('--ty', (y * 8).toFixed(1) + 'px');
    } else {
      // Preserved exact desktop mouse-based interaction
      rack.style.setProperty('--ry', (x * 5.5).toFixed(2) + 'deg');
      rack.style.setProperty('--rx', (-y * 4.0).toFixed(2) + 'deg');
      rack.style.setProperty('--tx', (x * 12).toFixed(1) + 'px');
      rack.style.setProperty('--ty', (y * 8).toFixed(1) + 'px');
    }
  }

  // Initialize Hero UI from Products Data
  function initHero(products) {
    allProducts = products;
    featuredProducts = products.filter(function (p) {
      return p.featured;
    });

    if (featuredProducts.length < 4) {
      featuredProducts = products.slice(0, 4);
    }
    N = featuredProducts.length;

    // Build Clean Product Presentation in Rack
    rack.innerHTML = '';
    featuredProducts.forEach(function (p, k) {
      const el = document.createElement('div');
      el.className = 'item';
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${p.name}, ${p.priceFormatted}`);
      el.dataset.id = p.id;
      el.dataset.index = k;

      const imgUrl = p.images[0];
      const isPrimary = k === 0;
      el.innerHTML = `
        <div class="pad"></div>
        <img class="product-img" src="${imgUrl}" alt="${p.name}" draggable="false" decoding="async" ${isPrimary ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} />
      `;

      // Item Interaction: tap/click opens piece details
      el.addEventListener('click', function (e) {
        if (moved) {
          e.preventDefault();
          return;
        }
        window.location.hash = `#/piece/${p.id}`;
      });

      // Item keyboard accessibility
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.hash = `#/piece/${p.id}`;
        }
      });

      rack.appendChild(el);
    });

    items = [].slice.call(rack.querySelectorAll('.item'));

    // Build Progress Indicators matching product count (Step 1d)
    bars.innerHTML = '';
    featuredProducts.forEach(function (p, k) {
      const b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', `Piece ${k + 1}: ${p.name}`);
      b.onclick = function () {
        goTo(k);
        play();
      };
      bars.appendChild(b);
    });

    bs = [].slice.call(bars.children);

    const urlParams = new URLSearchParams(window.location.search);
    const pieceParam = parseInt(urlParams.get('piece'), 10);
    if (!isNaN(pieceParam) && pieceParam >= 1 && pieceParam <= N) {
      pos = pieceParam - 1;
      target = pieceParam - 1;
    }

    size();
    render();
    play();
  }

  // Pointer & Drag Handlers with Movement Threshold
  hero.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button, a')) return;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    drag = { x: e.clientX, t: target };
    pause(); // Pause autoplay while touching or dragging
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 8) {
      moved = true; // Drag threshold reached
    }
  });

  function handlePointerEnd(e) {
    if (!drag) return;
    const endX = (e && typeof e.clientX === 'number') ? e.clientX : startX;
    const endY = (e && typeof e.clientY === 'number') ? e.clientY : startY;
    const dx = endX - startX;
    const dy = endY - startY;
    // Prefer intentional horizontal swipe over vertical scrolling
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        goTo(Math.round(target) + 1);
      } else {
        goTo(Math.round(target) - 1);
      }
    } else {
      target = Math.round(target);
    }
    drag = null;
    play();
    // Maintain moved state briefly so immediate synthetic click is ignored
    setTimeout(function () {
      moved = false;
    }, 60);
  }

  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerEnd);

  // Keyboard Navigation for Hero Carousel
  window.addEventListener('keydown', function (e) {
    const hash = window.location.hash;
    const isHeroActive = !hash || hash === '#/' || hash === '#';
    if (!isHeroActive) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(Math.round(target) - 1);
      play();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(Math.round(target) + 1);
      play();
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
      play();
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(N - 1);
      play();
    }
  });

  // Pause Autoplay when Tab is Hidden (Step 1c)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      pause();
    } else {
      play();
    }
  });

  // Automatic Parallax on Pointer Movement (Desktop)
  if (!reduce) {
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' || drag) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      setParallax(nx, ny);
    });

    document.addEventListener('mouseleave', function () {
      setParallax(0, 0);
    });

    // Mobile Gyroscope Parallax (Preserves tilt, affects only product and shadow, NO tilt button)
    let gyroBase = null;
    let smoothX = 0;
    let smoothY = 0;

    function handleOrientation(e) {
      if (e.beta === null || e.gamma === null) return;
      if (!gyroBase) {
        gyroBase = { b: e.beta, g: e.gamma };
      }

      // Gentle dynamic centering so the resting angle smoothly follows posture adjustments
      gyroBase.b += (e.beta - gyroBase.b) * 0.008;
      gyroBase.g += (e.gamma - gyroBase.g) * 0.008;

      let dx = e.gamma - gyroBase.g;
      let dy = e.beta - gyroBase.b;

      // Small 0.25deg deadzone eliminates sensor jitter when holding device still
      if (Math.abs(dx) < 0.25) dx = 0;
      if (Math.abs(dy) < 0.25) dy = 0;

      // Sensitivity divisor tuned from 22 to 11 for immediate, noticeable response to small wrist movements
      const targetX = Math.max(-1, Math.min(1, dx / 11));
      const targetY = Math.max(-1, Math.min(1, dy / 11));

      // Exponential smoothing filter for fluid, natural 3D motion without abrupt jumps
      smoothX += (targetX - smoothX) * 0.35;
      smoothY += (targetY - smoothY) * 0.35;

      setParallax(smoothX, smoothY, true);
    }

    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      // Seamlessly request on first user touch gesture without adding any UI button
      function requestGyroOnce() {
        window.removeEventListener('pointerdown', requestGyroOnce);
        D.requestPermission()
          .then(function (perm) {
            if (perm === 'granted') {
              window.addEventListener('deviceorientation', handleOrientation);
            }
          })
          .catch(function () {});
      }
      window.addEventListener('pointerdown', requestGyroOnce, { once: true });
    } else if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
  }

  // Resize handler
  window.addEventListener('resize', function () {
    size();
    render();
  });

  // Dynamic listener for prefers-reduced-motion preference change
  try {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', function (e) {
      reduce = e.matches;
      if (reduce) {
        pause();
        setParallax(0, 0);
      } else {
        play();
      }
    });
  } catch (err) {}

  // Toast Notification Helper
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
    }, 2400);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Saved & Cart State Helpers
  function isSaved(productId) {
    const saved = getStorage(STORAGE_SAVED_KEY, []);
    return saved.includes(productId);
  }

  function toggleSaved(productId) {
    let saved = getStorage(STORAGE_SAVED_KEY, []);
    const prod = allProducts.find(function (p) { return p.id === productId; });
    const name = prod ? prod.name : 'PIECE';
    if (saved.includes(productId)) {
      saved = saved.filter(function (id) { return id !== productId; });
      setStorage(STORAGE_SAVED_KEY, saved);
      updateBadges();
      showToast(`REMOVED FROM SAVED: ${name}`);
      return false;
    } else {
      saved.push(productId);
      setStorage(STORAGE_SAVED_KEY, saved);
      updateBadges();
      showToast(`SAVED TO ARCHIVE: ${name}`);
      return true;
    }
  }

  function addToCart(productId, size) {
    const prod = allProducts.find(function (p) { return p.id === productId; });
    if (!prod) return;
    let cart = getStorage(STORAGE_CART_KEY, []);
    const existing = cart.find(function (item) {
      return item.id === productId && item.size === size;
    });
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
    } else {
      cart.push({
        id: prod.id,
        name: prod.name,
        category: prod.category,
        price: prod.price,
        priceFormatted: prod.priceFormatted,
        image: prod.images[0],
        size: size,
        quantity: 1
      });
    }
    setStorage(STORAGE_CART_KEY, cart);
    updateBadges();
    showToast(`ADDED TO BAG: ${prod.name} (${size})`);
  }

  // Navigation Drawer Management
  const navDrawer = document.getElementById('navDrawer');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const menuBtn = document.getElementById('menuBtn');

  function openDrawer() {
    if (!navDrawer) return;
    navDrawer.classList.add('open');
    navDrawer.setAttribute('aria-hidden', 'false');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    pause();
    setParallax(0, 0);
    if (drawerCloseBtn) drawerCloseBtn.focus();
  }

  function closeDrawer() {
    if (!navDrawer) return;
    navDrawer.classList.remove('open');
    navDrawer.setAttribute('aria-hidden', 'true');
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'false');
    }
    const hash = window.location.hash || '#/';
    if (hash === '#/' || hash === '' || hash === '#') {
      play();
    }
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (navDrawer && navDrawer.classList.contains('open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeDrawer);
  }

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', closeDrawer);
  }

  document.querySelectorAll('.drawer-link').forEach(function (link) {
    link.addEventListener('click', function () {
      closeDrawer();
    });
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (navDrawer && navDrawer.classList.contains('open')) {
        closeDrawer();
      }
    }
  });

  // BEYOND Logo: Navigate home and reset hero to initial piece
  const logoEl = document.querySelector('.logo');
  if (logoEl) {
    logoEl.addEventListener('click', function () {
      if (navDrawer && navDrawer.classList.contains('open')) {
        closeDrawer();
      }
      goTo(0);
    });
  }

  // Header Search Button: Close drawer if open and navigate to search
  const headerSearchBtn = document.getElementById('headerSearchBtn');
  if (headerSearchBtn) {
    headerSearchBtn.addEventListener('click', function () {
      if (navDrawer && navDrawer.classList.contains('open')) {
        closeDrawer();
      }
    });
  }

  // Screen Rendering: Shop Catalogue
  function renderShop(activeCategory) {
    activeCategory = activeCategory || 'ALL';
    const container = document.getElementById('screen-shop');
    if (!container) return;

    function getCategoryCount(cat) {
      if (cat === 'ALL') return allProducts.length;
      return allProducts.filter(function (p) {
        return p.category && p.category.toUpperCase() === cat;
      }).length;
    }

    const categories = ['ALL', 'OUTERWEAR', 'TOPS', 'BOTTOMS', 'ACCESSORIES', 'FOOTWEAR'];
    const filtered = activeCategory === 'ALL'
      ? allProducts
      : allProducts.filter(function (p) {
          return p.category && p.category.toUpperCase() === activeCategory;
        });

    function getStockLabel(p) {
      if (p.sizes && p.sizes.length) {
        const totalStock = p.sizes.reduce(function (acc, s) { return acc + (s.stock || 0); }, 0);
        if (totalStock === 0) return 'SOLD OUT';
        if (totalStock <= 3) return 'LAST PIECES';
      }
      return 'LIMITED EDITION';
    }

    container.innerHTML = `
      <div class="page-container">
        <!-- Editorial Catalogue Header -->
        <header class="shop-header">
          <div class="shop-eyebrow-line">
            <span class="shop-eyebrow">GALLERY CATALOGUE // ARCHIVE</span>
            <span class="shop-badge">EDITION 01 &bull; FW26</span>
          </div>
          <div class="shop-title-row">
            <h1 class="shop-title">COLLECTION</h1>
            <div class="shop-count-pill" aria-label="${filtered.length} pieces available">
              <span class="shop-count-num">${filtered.length}</span>
              <span class="shop-count-label">${filtered.length === 1 ? 'PIECE' : 'PIECES'}</span>
            </div>
          </div>
          <div class="shop-divider" aria-hidden="true">
            <span class="shop-divider-line"></span>
            <span class="shop-divider-mark">BEYOND</span>
            <span class="shop-divider-line"></span>
          </div>
          <p class="shop-desc">
            Artisanal heavyweight fleece, distressed oil-wash cowhide, and brutalist streetwear silhouettes engineered for architectural drape.
          </p>
        </header>

        <!-- Category Filters -->
        <nav class="shop-filter-bar" role="tablist" aria-label="Filter Collection by Category">
          ${categories.map(function (cat) {
            const isAct = cat === activeCategory;
            const count = getCategoryCount(cat);
            return `
              <button type="button"
                class="shop-filter-btn ${isAct ? 'active' : ''}"
                data-cat="${cat}"
                role="tab"
                aria-selected="${isAct ? 'true' : 'false'}"
                aria-label="Filter by ${cat} (${count} pieces)">
                <span class="shop-filter-label">${cat}</span>
                <span class="shop-filter-count">${count}</span>
              </button>
            `;
          }).join('')}
        </nav>

        <!-- Product Grid -->
        ${filtered.length === 0 ? `
          <div class="empty-state">
            <p class="empty-code">0 PIECES</p>
            <h3 class="empty-title">NO PIECES IN THIS CATEGORY</h3>
            <p class="empty-desc">Check back soon for upcoming limited drops in this category.</p>
            <button type="button" class="empty-btn" id="shopResetFilterBtn">VIEW ALL PIECES</button>
          </div>
        ` : `
          <div class="shop-grid" id="shopGrid">
            ${filtered.map(function (p) {
              return `
                <article class="shop-card" data-id="${p.id}">
                  <div class="shop-card-media">
                    ${p.badge ? `<span class="shop-card-badge">${p.badge}</span>` : ''}
                    <button type="button"
                      class="shop-card-save-btn ${isSaved(p.id) ? 'saved' : ''}"
                      data-save-id="${p.id}"
                      aria-label="Save ${p.name} to archive"
                      aria-pressed="${isSaved(p.id) ? 'true' : 'false'}">
                      <svg class="i" viewBox="0 0 28 28" aria-hidden="true">
                        <path d="M14 24S3 17 3 10a5.5 5.5 0 0 1 11-1.5A5.5 5.5 0 0 1 25 10c0 7-11 14-11 14z"/>
                      </svg>
                    </button>
                    <a href="#/piece/${p.id}" class="shop-card-img-link" tabindex="-1" aria-label="View ${p.name}">
                      <div class="shop-card-halo" aria-hidden="true"></div>
                      <img src="${p.images[0]}" alt="${p.name}" class="shop-card-img" loading="lazy" />
                    </a>
                  </div>

                  <div class="shop-card-info">
                    <div class="shop-card-meta">
                      <span class="shop-card-cat">${(p.category || 'PIECE').toUpperCase()}</span>
                      <span class="shop-card-stock">${getStockLabel(p)}</span>
                    </div>
                    <h3 class="shop-card-name">
                      <a href="#/piece/${p.id}">${p.name}</a>
                    </h3>
                    <div class="shop-card-bottom">
                      <span class="shop-card-price">${p.priceFormatted}</span>
                      <a href="#/piece/${p.id}" class="shop-card-cta" aria-label="View details for ${p.name}">
                        <span>VIEW PIECE</span>
                        <svg class="cta-arrow" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M6 3L11 8L6 13" fill="none" stroke="currentColor" stroke-width="1.6"/>
                        </svg>
                      </a>
                    </div>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Filter Buttons
    container.querySelectorAll('.shop-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const cat = btn.getAttribute('data-cat');
        renderShop(cat);
      });
    });

    const resetBtn = container.querySelector('#shopResetFilterBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        renderShop('ALL');
      });
    }

    // Save Buttons
    container.querySelectorAll('[data-save-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-save-id');
        const nowSaved = toggleSaved(id);
        btn.classList.toggle('saved', nowSaved);
        btn.setAttribute('aria-pressed', nowSaved ? 'true' : 'false');
      });
    });
  }

  // Screen Rendering: Live Search
  function renderSearch(initialQuery) {
    initialQuery = initialQuery || '';
    const container = document.getElementById('screen-search');
    if (!container) return;

    function doSearch(q) {
      const query = (q || '').trim().toLowerCase();
      const matches = query
        ? allProducts.filter(function (p) {
            return (
              p.name.toLowerCase().includes(query) ||
              (p.category && p.category.toLowerCase().includes(query)) ||
              (p.description && p.description.toLowerCase().includes(query)) ||
              (p.material && p.material.toLowerCase().includes(query))
            );
          })
        : allProducts;

      const statusEl = container.querySelector('#searchStatus');
      const gridEl = container.querySelector('#searchGrid');
      const clearBtn = container.querySelector('#searchClearBtn');

      if (clearBtn) {
        clearBtn.classList.toggle('visible', query.length > 0);
      }

      if (statusEl) {
        statusEl.textContent = query
          ? `FOUND ${matches.length} ${matches.length === 1 ? 'PIECE' : 'PIECES'}`
          : `ARCHIVE / ${allProducts.length} TOTAL PIECES`;
      }

      if (!gridEl) return;

      if (query && matches.length === 0) {
        gridEl.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <p class="empty-code">0 MATCHES</p>
            <h3 class="empty-title">NO PIECES MATCHING "${escapeHtml(q)}"</h3>
            <p class="empty-desc">Check your spelling or explore the complete collection archive.</p>
            <a href="#/shop" class="empty-btn">VIEW ALL PIECES</a>
          </div>
        `;
      } else {
        gridEl.innerHTML = matches.map(function (p) {
          return `
            <article class="product-card" data-id="${p.id}">
              <div class="product-card-media">
                ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ''}
                <button type="button" class="card-save-btn ${isSaved(p.id) ? 'saved' : ''}" data-save-id="${p.id}" aria-label="Save ${p.name}">
                  <svg class="i" viewBox="0 0 28 28"><path d="M14 24S3 17 3 10a5.5 5.5 0 0 1 11-1.5A5.5 5.5 0 0 1 25 10c0 7-11 14-11 14z"/></svg>
                </button>
                <a href="#/piece/${p.id}" class="card-img-link" tabindex="-1">
                  <img src="${p.images[0]}" alt="${p.name}" loading="lazy" />
                </a>
              </div>
              <div class="product-card-info">
                <div class="card-meta">
                  <span class="card-cat">${(p.category || 'PIECE').toUpperCase()}</span>
                  <span class="card-price">${p.priceFormatted}</span>
                </div>
                <h3 class="card-name"><a href="#/piece/${p.id}">${p.name}</a></h3>
                <a href="#/piece/${p.id}" class="card-cta">VIEW PIECE</a>
              </div>
            </article>
          `;
        }).join('');

        gridEl.querySelectorAll('[data-save-id]').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-save-id');
            const nowSaved = toggleSaved(id);
            btn.classList.toggle('saved', nowSaved);
          });
        });
      }
    }

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-eyebrow">COLLECTION ARCHIVE</div>
          <h1 class="page-title">SEARCH</h1>
        </div>

        <div class="search-box">
          <svg class="i search-icon" viewBox="0 0 28 28"><circle cx="13" cy="13" r="8.5"/><path d="M19.5 19.5 25 25"/></svg>
          <input type="search" id="searchInput" class="search-input" placeholder="SEARCH PIECE, MATERIAL, SILHOUETTE..." value="${escapeHtml(initialQuery)}" aria-label="Search Collection" />
          <button type="button" id="searchClearBtn" class="search-clear ${initialQuery ? 'visible' : ''}" aria-label="Clear Search">
            <svg class="i" viewBox="0 0 28 28"><path d="M6 6L22 22M6 22L22 6"/></svg>
          </button>
        </div>

        <div class="search-tags">
          <span class="tags-label">QUICK SEARCH:</span>
          <button type="button" class="tag-chip" data-search="Hoodie">HOODIE</button>
          <button type="button" class="tag-chip" data-search="Leather">LEATHER</button>
          <button type="button" class="tag-chip" data-search="Denim">DENIM</button>
          <button type="button" class="tag-chip" data-search="Tee">TEE</button>
          <button type="button" class="tag-chip" data-search="Cargo">CARGO</button>
          <button type="button" class="tag-chip" data-search="Boots">BOOTS</button>
        </div>

        <div class="search-status" id="searchStatus"></div>
        <div class="product-grid" id="searchGrid"></div>
      </div>
    `;

    const inputEl = container.querySelector('#searchInput');
    const clearEl = container.querySelector('#searchClearBtn');

    if (inputEl) {
      inputEl.addEventListener('input', function () {
        doSearch(inputEl.value);
      });
      setTimeout(function () { inputEl.focus(); }, 80);
    }

    if (clearEl) {
      clearEl.addEventListener('click', function () {
        if (inputEl) {
          inputEl.value = '';
          inputEl.focus();
          doSearch('');
        }
      });
    }

    container.querySelectorAll('.tag-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const val = chip.getAttribute('data-search');
        if (inputEl) {
          inputEl.value = val;
          doSearch(val);
        }
      });
    });

    doSearch(initialQuery);
  }

  // Screen Rendering: Saved Items
  function renderSaved() {
    const container = document.getElementById('screen-saved');
    if (!container) return;

    const savedIds = getStorage(STORAGE_SAVED_KEY, []);
    const savedItems = allProducts.filter(function (p) {
      return savedIds.includes(p.id);
    });

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-eyebrow">PERSONAL ARCHIVE</div>
          <h1 class="page-title">SAVED PIECES</h1>
          <p class="page-desc">${savedItems.length} ${savedItems.length === 1 ? 'PIECE' : 'PIECES'} BOOKMARKED FOR DROP MONITORING</p>
        </div>

        ${savedItems.length === 0 ? `
          <div class="empty-state">
            <p class="empty-code">ARCHIVE EMPTY</p>
            <h3 class="empty-title">NO SAVED PIECES</h3>
            <p class="empty-desc">Bookmark pieces from the 3D gallery or catalogue to monitor sizing and drops.</p>
            <a href="#/shop" class="empty-btn">EXPLORE COLLECTION</a>
          </div>
        ` : `
          <div class="product-grid" id="savedGrid">
            ${savedItems.map(function (p) {
              return `
                <article class="product-card" data-id="${p.id}">
                  <div class="product-card-media">
                    ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ''}
                    <button type="button" class="card-save-btn saved" data-remove-id="${p.id}" aria-label="Remove ${p.name}">
                      <svg class="i" viewBox="0 0 28 28"><path d="M6 6L22 22M6 22L22 6"/></svg>
                    </button>
                    <a href="#/piece/${p.id}" class="card-img-link" tabindex="-1">
                      <img src="${p.images[0]}" alt="${p.name}" loading="lazy" />
                    </a>
                  </div>
                  <div class="product-card-info">
                    <div class="card-meta">
                      <span class="card-cat">${(p.category || 'PIECE').toUpperCase()}</span>
                      <span class="card-price">${p.priceFormatted}</span>
                    </div>
                    <h3 class="card-name"><a href="#/piece/${p.id}">${p.name}</a></h3>
                    <a href="#/piece/${p.id}" class="card-cta">VIEW PIECE</a>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    container.querySelectorAll('[data-remove-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-remove-id');
        toggleSaved(id);
        renderSaved();
      });
    });
  }

  // Screen Rendering: Shopping Cart
  function renderCart() {
    const container = document.getElementById('screen-cart');
    if (!container) return;

    const cart = getStorage(STORAGE_CART_KEY, []);
    const totalCount = cart.reduce(function (acc, item) {
      return acc + (item.quantity || 1);
    }, 0);
    const subtotal = cart.reduce(function (acc, item) {
      return acc + (item.price * (item.quantity || 1));
    }, 0);

    function formatPrice(val) {
      return '₹' + Number(val).toLocaleString('en-IN');
    }

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-eyebrow">YOUR BAG</div>
          <h1 class="page-title">SHOPPING CART</h1>
          <p class="page-desc">${totalCount} ${totalCount === 1 ? 'ITEM' : 'ITEMS'} IN YOUR ORDER</p>
        </div>

        ${cart.length === 0 ? `
          <div class="empty-state">
            <p class="empty-code">BAG EMPTY</p>
            <h3 class="empty-title">YOUR SHOPPING BAG IS EMPTY</h3>
            <p class="empty-desc">Explore the gallery pieces, select your size, and add items to your bag.</p>
            <a href="#/shop" class="empty-btn">EXPLORE COLLECTION</a>
          </div>
        ` : `
          <div class="cart-layout">
            <div class="cart-list">
              ${cart.map(function (item, idx) {
                return `
                  <div class="cart-item" data-cart-idx="${idx}">
                    <button type="button" class="cart-item-remove" data-remove-cart="${idx}" aria-label="Remove ${item.name}">
                      <svg class="i" viewBox="0 0 28 28"><path d="M6 6L22 22M6 22L22 6"/></svg>
                    </button>
                    <div class="cart-item-media">
                      <img src="${item.image}" alt="${item.name}" />
                    </div>
                    <div class="cart-item-info">
                      <h3 class="cart-item-name"><a href="#/piece/${item.id}">${item.name}</a></h3>
                      <div class="cart-item-detail">
                        SIZE: <strong>${item.size}</strong> &bull; UNIT: ${item.priceFormatted}
                      </div>
                      <div class="cart-item-bottom">
                        <div class="cart-qty-ctrl">
                          <button type="button" class="cart-qty-btn" data-qty-change="${idx}" data-delta="-1" aria-label="Decrease Quantity">-</button>
                          <span class="cart-qty-val">${item.quantity || 1}</span>
                          <button type="button" class="cart-qty-btn" data-qty-change="${idx}" data-delta="1" aria-label="Increase Quantity">+</button>
                        </div>
                        <div class="cart-item-price">${formatPrice(item.price * (item.quantity || 1))}</div>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="cart-summary">
              <h2 class="summary-title">ORDER SUMMARY</h2>
              <div class="summary-row">
                <span>ITEMS (${totalCount}):</span>
                <span>${formatPrice(subtotal)}</span>
              </div>
              <div class="summary-row">
                <span>SHIPPING:</span>
                <span>COMPLIMENTARY</span>
              </div>
              <div class="summary-row total">
                <span>ESTIMATED TOTAL:</span>
                <span>${formatPrice(subtotal)}</span>
              </div>
              <button type="button" class="cart-checkout-btn" disabled>
                DROP 01 &bull; ORDERING OPENS SOON
              </button>
              <p class="cart-disclaimer">
                Exclusive release window. Save garments to receive priority dispatch notifications.
              </p>
            </div>
          </div>
        `}
      </div>
    `;

    container.querySelectorAll('[data-remove-cart]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-remove-cart'), 10);
        let currentCart = getStorage(STORAGE_CART_KEY, []);
        if (idx >= 0 && idx < currentCart.length) {
          const removed = currentCart.splice(idx, 1);
          setStorage(STORAGE_CART_KEY, currentCart);
          updateBadges();
          showToast(`REMOVED FROM BAG: ${removed[0].name}`);
          renderCart();
        }
      });
    });

    container.querySelectorAll('[data-qty-change]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-qty-change'), 10);
        const delta = parseInt(btn.getAttribute('data-delta'), 10);
        let currentCart = getStorage(STORAGE_CART_KEY, []);
        if (idx >= 0 && idx < currentCart.length) {
          currentCart[idx].quantity = (currentCart[idx].quantity || 1) + delta;
          if (currentCart[idx].quantity <= 0) {
            currentCart.splice(idx, 1);
          }
          setStorage(STORAGE_CART_KEY, currentCart);
          updateBadges();
          renderCart();
        }
      });
    });
  }

  // Screen Rendering: Dedicated Product Detail View
  function renderPiece(pieceId) {
    const container = document.getElementById('screen-piece');
    if (!container) return;

    const prod = allProducts.find(function (p) { return p.id === pieceId; });
    if (!prod) {
      container.innerHTML = `
        <div class="page-container piece-page">
          <div class="piece-nav">
            <a href="#/" class="piece-back-btn">
              <svg class="i" viewBox="0 0 28 28"><path d="M19 4L9 14L19 24"/></svg>
              <span>RETURN TO GALLERY</span>
            </a>
          </div>
          <div class="empty-state">
            <p class="empty-code">404 / NOT FOUND</p>
            <h2 class="empty-title">PIECE NOT FOUND</h2>
            <p class="empty-desc">The requested garment identifier does not exist in the collection archive.</p>
            <a href="#/shop" class="empty-btn">EXPLORE COLLECTION</a>
          </div>
        </div>
      `;
      return;
    }

    let selectedSize = '';
    if (prod.sizes && prod.sizes.length > 0) {
      const inStock = prod.sizes.find(function (s) { return s.stock > 0; });
      selectedSize = inStock ? inStock.size : prod.sizes[0].size;
    }

    container.innerHTML = `
      <div class="page-container piece-page">
        <div class="piece-nav">
          <a href="#/" class="piece-back-btn" id="pieceBackBtn">
            <svg class="i" viewBox="0 0 28 28"><path d="M19 4L9 14L19 24"/></svg>
            <span>RETURN TO GALLERY</span>
          </a>
          <span class="piece-eyebrow-id">${prod.featured ? 'FEATURED PIECE' : 'ARCHIVE PIECE'} &bull; ${prod.id.toUpperCase()}</span>
        </div>

        <div class="piece-layout">
          <!-- Media Column -->
          <div class="piece-media-col">
            ${prod.badge ? `<span class="piece-badge">${prod.badge}</span>` : ''}
            <div class="piece-main-img-box">
              <img id="pieceMainImg" src="${prod.images[0]}" alt="${prod.name}" />
            </div>
            ${prod.images && prod.images.length > 1 ? `
              <div class="piece-thumbnails">
                ${prod.images.map(function (img, idx) {
                  return `
                    <button type="button" class="piece-thumb ${idx === 0 ? 'active' : ''}" data-thumb-idx="${idx}" aria-label="View Angle ${idx + 1}">
                      <img src="${img}" alt="${prod.name} thumbnail ${idx + 1}" />
                    </button>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Details Column -->
          <div class="piece-details-col">
            <div class="piece-header">
              <span class="piece-cat">${(prod.category || 'PIECE').toUpperCase()}</span>
              <h1 class="piece-title">${prod.name}</h1>
              <div class="piece-price">${prod.priceFormatted}</div>
            </div>

            <div class="piece-divider"></div>

            <div class="piece-desc">
              <p>${prod.description}</p>
            </div>

            <div class="piece-specs">
              <div class="spec-row">
                <span class="spec-label">MATERIAL & CONSTRUCTION</span>
                <span class="spec-val">${prod.material || 'Artisanal garment-dyed finish.'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">SILHOUETTE & FIT</span>
                <span class="spec-val">${prod.fitNotes || 'Designed for structured editorial drape.'}</span>
              </div>
            </div>

            <!-- Sizing Selection -->
            <div class="piece-sizing">
              <div class="size-header">
                <span class="size-label">SELECT SIZE</span>
                <span class="size-guide">TRUE TO STREETWEAR FIT</span>
              </div>
              <div class="size-chips" role="radiogroup" aria-label="Available Sizes">
                ${prod.sizes.map(function (s) {
                  return `
                    <button type="button"
                      class="size-chip ${s.stock === 0 ? 'sold-out' : ''} ${s.size === selectedSize ? 'selected' : ''}"
                      data-size-val="${s.size}"
                      ${s.stock === 0 ? 'disabled' : ''}
                      aria-label="Size ${s.size} ${s.stock === 0 ? '(Sold Out)' : `(${s.stock} in stock)`}">
                      <span>${s.size}</span>
                      <small>${s.stock === 0 ? 'SOLD' : (s.stock <= 2 ? 'LOW' : '')}</small>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="piece-actions">
              <button type="button" class="piece-add-btn" id="addToBagBtn">
                ADD TO BAG &bull; ${prod.priceFormatted}
              </button>
              <button type="button" class="piece-save-btn ${isSaved(prod.id) ? 'saved' : ''}" id="savePieceBtn" aria-label="Save ${prod.name}">
                <svg class="i" viewBox="0 0 28 28"><path d="M14 24S3 17 3 10a5.5 5.5 0 0 1 11-1.5A5.5 5.5 0 0 1 25 10c0 7-11 14-11 14z"/></svg>
                <span id="savePieceBtnText">${isSaved(prod.id) ? 'SAVED TO ARCHIVE' : 'SAVE PIECE'}</span>
              </button>
            </div>

            <div class="piece-shipping-note">
              <svg class="i" viewBox="0 0 28 28"><path d="M3 6h16v12H3zM19 10h5l2 3v5h-7zM7 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM22 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
              <span>COMPLIMENTARY DOMESTIC COURIER & ARCHIVAL PACKAGING</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const mainImg = container.querySelector('#pieceMainImg');
    const thumbs = container.querySelectorAll('.piece-thumb');
    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        const idx = parseInt(thumb.getAttribute('data-thumb-idx'), 10);
        if (prod.images[idx] && mainImg) {
          mainImg.src = prod.images[idx];
          thumbs.forEach(function (t) { t.classList.remove('active'); });
          thumb.classList.add('active');
        }
      });
    });

    const sizeBtns = container.querySelectorAll('.size-chip');
    sizeBtns.forEach(function (sb) {
      sb.addEventListener('click', function () {
        if (sb.disabled) return;
        selectedSize = sb.getAttribute('data-size-val');
        sizeBtns.forEach(function (b) { b.classList.remove('selected'); });
        sb.classList.add('selected');
      });
    });

    const addBtn = container.querySelector('#addToBagBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addToCart(prod.id, selectedSize || 'OS');
      });
    }

    const saveBtn = container.querySelector('#savePieceBtn');
    const saveText = container.querySelector('#savePieceBtnText');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        const nowSaved = toggleSaved(prod.id);
        saveBtn.classList.toggle('saved', nowSaved);
        if (saveText) {
          saveText.textContent = nowSaved ? 'SAVED TO ARCHIVE' : 'SAVE PIECE';
        }
      });
    }
  }

  // Router & Screen Management
  function route() {
    const rawHash = window.location.hash || '#/';
    const hash = rawHash.replace(/^#/, '') || '/';

    // Close navigation drawer on route change
    if (navDrawer && navDrawer.classList.contains('open')) {
      closeDrawer();
    }

    // Hide all screens
    const allScreens = document.querySelectorAll('.screen');
    allScreens.forEach(function (s) {
      s.classList.remove('active');
    });

    // Update bottom tabs active state
    tabLinks.forEach(function (tab) {
      const tabRoute = tab.getAttribute('data-route');
      const isActive =
        tabRoute === hash ||
        (tabRoute === '/shop' && hash.startsWith('/shop')) ||
        (tabRoute === '/search' && hash.startsWith('/search')) ||
        (tabRoute === '/saved' && hash.startsWith('/saved')) ||
        (tabRoute === '/cart' && hash.startsWith('/cart'));
      tab.classList.toggle('on', isActive);
    });

    // Update drawer links active state
    document.querySelectorAll('.drawer-link').forEach(function (dLink) {
      const dRoute = dLink.getAttribute('data-route');
      const isActive =
        dRoute === hash ||
        (dRoute === '/shop' && hash.startsWith('/shop')) ||
        (dRoute === '/search' && hash.startsWith('/search')) ||
        (dRoute === '/saved' && hash.startsWith('/saved')) ||
        (dRoute === '/cart' && hash.startsWith('/cart'));
      dLink.classList.toggle('active', isActive);
    });

    // Determine target screen
    if (hash === '/' || hash === '' || hash === '#') {
      const homeScreen = document.getElementById('screen-home');
      if (homeScreen) homeScreen.classList.add('active');
      play();
    } else if (hash.startsWith('/piece/')) {
      const pieceId = hash.replace('/piece/', '');
      const pieceScreen = document.getElementById('screen-piece');
      if (pieceScreen) {
        pieceScreen.classList.add('active');
        pieceScreen.scrollTop = 0;
      }
      pause();
      setParallax(0, 0);
      renderPiece(pieceId);
    } else if (hash === '/shop' || hash.startsWith('/shop')) {
      const shopScreen = document.getElementById('screen-shop');
      if (shopScreen) {
        shopScreen.classList.add('active');
        shopScreen.scrollTop = 0;
      }
      pause();
      setParallax(0, 0);
      renderShop('ALL');
    } else if (hash === '/search' || hash.startsWith('/search')) {
      const searchScreen = document.getElementById('screen-search');
      if (searchScreen) {
        searchScreen.classList.add('active');
        searchScreen.scrollTop = 0;
      }
      pause();
      setParallax(0, 0);
      renderSearch('');
    } else if (hash === '/saved' || hash.startsWith('/saved')) {
      const savedScreen = document.getElementById('screen-saved');
      if (savedScreen) {
        savedScreen.classList.add('active');
        savedScreen.scrollTop = 0;
      }
      pause();
      setParallax(0, 0);
      renderSaved();
    } else if (hash === '/cart' || hash.startsWith('/cart')) {
      const cartScreen = document.getElementById('screen-cart');
      if (cartScreen) {
        cartScreen.classList.add('active');
        cartScreen.scrollTop = 0;
      }
      pause();
      setParallax(0, 0);
      renderCart();
    }

    updateBadges();
  }

  window.addEventListener('hashchange', route);

  // Initial Featured Pieces for instant, non-blocking 0ms hero render & hydration
  const INITIAL_PRODUCTS = [
    {
      id: 'distressed-moto-jacket',
      name: 'Distressed Moto Jacket',
      category: 'outerwear',
      price: 42000,
      priceFormatted: '₹42,000',
      description: 'Hand-abraded heavy steerhide with artisanal oil wash.',
      material: '100% full-grain distressed cowhide leather.',
      fitNotes: 'Cropped boxy cut with extended sleeves.',
      sizes: [
        { size: 'S', stock: 2 },
        { size: 'M', stock: 4 },
        { size: 'L', stock: 0 },
        { size: 'XL', stock: 1 }
      ],
      images: ['assets/products/moto-jacket.webp', 'assets/products/moto-jacket.webp', 'assets/products/moto-jacket.png'],
      featured: true,
      badge: 'LAST PIECES'
    },
    {
      id: 'heavy-fleece-hoodie-01',
      name: 'Heavy Fleece Hoodie 01',
      category: 'tops',
      price: 8500,
      priceFormatted: '₹8,500',
      description: '600 GSM loopback French terry drenched in vintage mineral wash.',
      material: '100% combed heavyweight cotton.',
      fitNotes: 'Oversized, relaxed boxy cut.',
      sizes: [
        { size: 'S', stock: 5 },
        { size: 'M', stock: 8 },
        { size: 'L', stock: 3 },
        { size: 'XL', stock: 0 }
      ],
      images: ['assets/products/hoodie-black.webp', 'assets/products/heavy-fleece-hoodie-01.webp', 'assets/products/hoodie-black.png'],
      featured: true,
      badge: 'NEW'
    },
    {
      id: 'racing-spider-oversized-tee',
      name: 'Racing Spider Oversized Tee',
      category: 'tops',
      price: 6500,
      priceFormatted: '₹6,500',
      description: '310 GSM combed cotton jersey featuring hand-pulled cracked discharge print.',
      material: '100% high-density combed jersey.',
      fitNotes: 'Wide, relaxed oversized fit.',
      sizes: [
        { size: 'S', stock: 6 },
        { size: 'M', stock: 12 },
        { size: 'L', stock: 7 },
        { size: 'XL', stock: 4 }
      ],
      images: ['assets/products/racing-spider-tee.webp', 'assets/products/racing-spider-tee.webp', 'assets/products/racing-spider-tee.png'],
      featured: true,
      badge: null
    },
    {
      id: 'raw-plaster-hoodie-02',
      name: 'Raw Plaster Hoodie 02',
      category: 'tops',
      price: 8500,
      priceFormatted: '₹8,500',
      description: 'Heavyweight bone plaster terry treated with subtle wax resist and clay bath.',
      material: '100% custom dye-cast cotton fleece.',
      fitNotes: 'Sculptural drop shoulder with cropped hem.',
      sizes: [
        { size: 'S', stock: 3 },
        { size: 'M', stock: 0 },
        { size: 'L', stock: 5 },
        { size: 'XL', stock: 2 }
      ],
      images: ['assets/products/hoodie-grey.webp', 'assets/products/raw-plaster-hoodie-02.webp', 'assets/products/hoodie-grey.png'],
      featured: true,
      badge: 'NEW'
    }
  ];

  // Fetch Products Data Asynchronously in background without blocking initial hero render
  async function loadProductsAsync() {
    let products = null;

    // 1. Try real Supabase database
    if (window.BeyondSupabase && typeof window.BeyondSupabase.fetchProducts === 'function') {
      try {
        products = await window.BeyondSupabase.fetchProducts();
        if (products && products.length > 0) {
          console.info(`[BEYOND] Successfully loaded ${products.length} live products from Supabase.`);
        }
      } catch (err) {
        console.warn('[BEYOND] Failed to fetch products from Supabase:', err);
      }
    }

    // 2. Fallback to local products.json if Supabase returned 0 rows or is unconfigured
    if (!products || products.length === 0) {
      try {
        const res = await fetch('products.json');
        if (res.ok) {
          products = await res.json();
          console.info(`[BEYOND] Loaded ${products.length} products from products.json.`);
        }
      } catch (err) {
        console.warn('[BEYOND] Loading products via fetch failed, using fallback:', err);
      }
    }

    if (products && products.length > 0) {
      allProducts = products;
      const newFeatured = products.filter(function (p) { return p.featured; });
      if (newFeatured.length >= 4) {
        const isDifferent = newFeatured.length !== featuredProducts.length ||
          newFeatured.some(function (p, idx) { return !featuredProducts[idx] || featuredProducts[idx].id !== p.id; });

        if (isDifferent) {
          initHero(products);
        } else {
          featuredProducts = newFeatured;
          render();
        }
      }
      updateBadges();
      if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#') {
        route();
      }
    }
  }

  // Synchronous immediate initialization: Hero becomes interactive & renders on first paint
  initHero(INITIAL_PRODUCTS);
  updateBadges();
  loop();
  route();

  // Background catalog synchronization (non-blocking)
  loadProductsAsync();
})();
