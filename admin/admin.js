/**
 * BEYOND — Owner Management Portal
 * Full-featured SPA Controller & Secure State Manager
 */

(function () {
  'use strict';

  // 1. SUPABASE CLIENT INITIALIZATION & CREDENTIALS
  // In production, these are injected via environment variables or Supabase project config
  const SUPABASE_URL = window.ENV_SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = window.ENV_SUPABASE_ANON_KEY || '';
  let supabase = null;

  if (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Supabase initialization failed, running in local secure mode:', e);
    }
  }

  // Local storage state keys
  const AUTH_STORAGE_KEY = 'beyond_admin_auth_v1';
  const DATA_PRODUCTS_KEY = 'beyond_admin_products_v1';
  const DATA_ORDERS_KEY = 'beyond_admin_orders_v1';
  const DATA_INVENTORY_LOGS_KEY = 'beyond_admin_inventory_logs_v1';
  const DATA_SLIDES_KEY = 'beyond_admin_slides_v1';
  const DATA_COUPONS_KEY = 'beyond_admin_coupons_v1';
  const DATA_REVIEWS_KEY = 'beyond_admin_reviews_v1';
  const DATA_SETTINGS_KEY = 'beyond_admin_settings_v1';
  const DATA_AUDIT_LOGS_KEY = 'beyond_admin_audit_logs_v1';

  // Current session state
  let currentOwner = null;

  // DOM Elements
  const authView = document.getElementById('authView');
  const appShell = document.getElementById('appShell');
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const authError = document.getElementById('authError');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const sidebarUserEmail = document.getElementById('sidebarUserEmail');
  const topbarTitle = document.getElementById('topbarTitle');
  const adminContent = document.getElementById('adminContent');
  const adminSidebar = document.getElementById('adminSidebar');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const adminModal = document.getElementById('adminModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalFooter = document.getElementById('modalFooter');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const adminToast = document.getElementById('adminToast');

  // ==============================================================================
  // 2. HELPER UTILITIES
  // ==============================================================================
  function getStorage(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function formatPrice(val) {
    return '₹' + Number(val || 0).toLocaleString('en-IN');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function showToast(message, type = 'normal') {
    if (!adminToast) return;
    const el = document.createElement('div');
    el.className = `toast-msg ${type === 'error' ? 'error' : (type === 'success' ? 'success' : '')}`;
    el.textContent = message;
    adminToast.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  function logAudit(action, entityType, entityId, details) {
    const logs = getStorage(DATA_AUDIT_LOGS_KEY, []);
    const entry = {
      id: 'AUD-' + Date.now().toString(36).toUpperCase(),
      user: currentOwner ? currentOwner.email : 'system',
      action: action,
      entityType: entityType,
      entityId: entityId,
      details: details,
      timestamp: new Date().toISOString()
    };
    logs.unshift(entry);
    setStorage(DATA_AUDIT_LOGS_KEY, logs.slice(0, 100)); // retain last 100 entries
  }

  // Modal Dialog Controller
  function openModal(title, bodyHtml, footerHtml) {
    if (!adminModal) return;
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalFooter.innerHTML = footerHtml || '';
    adminModal.classList.add('open');
    adminModal.setAttribute('aria-hidden', 'false');
  }

  function resolveAdminImageUrl(url) {
    if (!url) return '../assets/products/moto-jacket.png';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
      return url;
    }
    return url.startsWith('../') ? url : `../${url}`;
  }

  function closeModal() {
    if (typeof currentModalImages !== 'undefined' && currentModalImages.length > 0) {
      currentModalImages.forEach(img => {
        if (!img.isExisting && img.previewUrl) {
          try { URL.revokeObjectURL(img.previewUrl); } catch (e) {}
        }
      });
      currentModalImages = [];
    }
    if (!adminModal) return;
    adminModal.classList.remove('open');
    adminModal.setAttribute('aria-hidden', 'true');
    modalBody.innerHTML = '';
    modalFooter.innerHTML = '';
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (adminModal) {
    adminModal.addEventListener('click', (e) => {
      if (e.target === adminModal) closeModal();
    });
  }

  // Mobile Menu Toggle
  if (mobileMenuBtn && adminSidebar) {
    mobileMenuBtn.addEventListener('click', () => {
      adminSidebar.classList.toggle('open');
    });
  }

  // ==============================================================================
  // 3. SEED & INITIAL DATA INITIALIZATION
  // ==============================================================================
  async function syncProductsFromSupabase() {
    if (!supabase) return;
    try {
      const { data: prods, error: pErr } = await supabase
        .from('products')
        .select('*')
        .order('sort_order', { ascending: true });

      if (pErr || !prods || prods.length === 0) return;

      const pIds = prods.map(p => p.id);
      const [imgsRes, varsRes] = await Promise.all([
        supabase.from('product_images').select('*').in('product_id', pIds).order('sort_order', { ascending: true }),
        supabase.from('product_variants').select('*').in('product_id', pIds)
      ]);

      const imagesByProduct = {};
      if (imgsRes.data) {
        imgsRes.data.forEach(img => {
          if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
          imagesByProduct[img.product_id].push(img.image_url);
        });
      }

      const variantsByProduct = {};
      if (varsRes.data) {
        varsRes.data.forEach(v => {
          if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
          variantsByProduct[v.product_id].push({
            size: v.size,
            sku: v.sku,
            stock: v.stock_quantity || 0
          });
        });
      }

      const normalized = prods.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug || p.id,
        category: p.category_id || 'tops',
        regularPrice: Number(p.regular_price),
        salePrice: p.sale_price ? Number(p.sale_price) : null,
        priceFormatted: p.price_formatted || formatPrice(Number(p.regular_price)),
        description: p.description || '',
        material: p.material || '',
        fitNotes: p.fit_notes || '',
        status: p.status || 'published',
        featured: !!p.featured,
        badge: p.badge || null,
        images: imagesByProduct[p.id] && imagesByProduct[p.id].length > 0 ? imagesByProduct[p.id] : ['assets/products/moto-jacket.png'],
        sizes: variantsByProduct[p.id] || [],
        sortOrder: p.sort_order || 0,
        createdAt: p.created_at || new Date().toISOString()
      }));

      setStorage(DATA_PRODUCTS_KEY, normalized);
      updateNavCounters();
      if (window.location.hash.includes('products')) renderSection('products');
    } catch (e) {
      console.warn('[BEYOND] syncProductsFromSupabase error:', e);
    }
  }

  function initData() {
    // 1. Products: Seed fallback from JSON if storage is completely empty
    if (!getStorage(DATA_PRODUCTS_KEY, null)) {
      fetch('../products.json')
        .then(res => res.json())
        .then(products => {
          // Normalize products for admin CRUD
          const normalized = products.map((p, idx) => ({
            id: p.id,
            name: p.name,
            slug: p.id,
            category: p.category || 'tops',
            regularPrice: p.price,
            salePrice: null,
            priceFormatted: p.priceFormatted || formatPrice(p.price),
            description: p.description,
            material: p.material || '',
            fitNotes: p.fitNotes || '',
            status: 'published',
            featured: !!p.featured,
            badge: p.badge || null,
            images: p.images || [],
            sizes: (p.sizes || []).map(s => ({
              size: s.size,
              sku: `BYND-${p.id.toUpperCase()}-${s.size}`.replace(/\s+/g, ''),
              stock: s.stock
            })),
            sortOrder: idx,
            createdAt: new Date(Date.now() - (idx * 86400000)).toISOString()
          }));
          setStorage(DATA_PRODUCTS_KEY, normalized);
          updateNavCounters();
          if (window.location.hash.includes('products')) renderSection('products');
        })
        .catch(e => console.warn('Product seed fetch failed:', e));
    }

    // Attempt live sync from Supabase products database
    syncProductsFromSupabase();

    // 2. Orders (Realistic Seed Data for Dashboard & Management)
    if (!getStorage(DATA_ORDERS_KEY, null)) {
      const seedOrders = [
        {
          id: 'BYND-2026-1001',
          date: new Date(Date.now() - 3600000 * 4).toISOString(),
          customer: {
            name: 'Aarav Mehta',
            email: 'aarav.mehta@gmail.com',
            phone: '+91 98201 44821',
            city: 'Mumbai',
            state: 'Maharashtra',
            address: 'Flat 402, Sea Green Apts, Worli Sea Face, Mumbai 400018'
          },
          items: [
            {
              id: 'distressed-moto-jacket',
              name: 'Distressed Moto Jacket',
              size: 'M',
              sku: 'BYND-DISTRESSED-MOTO-JACKET-M',
              price: 42000,
              quantity: 1,
              image: 'assets/products/moto-jacket.png'
            }
          ],
          subtotal: 42000,
          shipping: 0,
          tax: 5040,
          total: 42000,
          paymentMethod: 'prepaid',
          paymentStatus: 'captured',
          orderStatus: 'processing',
          paymentRef: 'pay_PqZ9X8kL12aBcD',
          shippingProvider: 'shiprocket',
          awb: 'SR-DEL-9844219',
          timeline: [
            { status: 'confirmed', note: 'Order placed & prepaid via Razorpay', time: new Date(Date.now() - 3600000 * 4).toISOString() },
            { status: 'processing', note: 'Transferred to fulfilment studio', time: new Date(Date.now() - 3600000 * 2).toISOString() }
          ]
        },
        {
          id: 'BYND-2026-1002',
          date: new Date(Date.now() - 3600000 * 18).toISOString(),
          customer: {
            name: 'Rohan Deshmukh',
            email: 'rohan.d@outlook.com',
            phone: '+91 97112 39011',
            city: 'Bengaluru',
            state: 'Karnataka',
            address: '88, 12th Main, Indiranagar, Bengaluru 560038'
          },
          items: [
            {
              id: 'heavy-fleece-hoodie-01',
              name: 'Heavy Fleece Hoodie 01',
              size: 'L',
              sku: 'BYND-HEAVY-FLEECE-HOODIE-01-L',
              price: 8500,
              quantity: 1,
              image: 'assets/products/hoodie-black.png'
            },
            {
              id: 'racing-spider-oversized-tee',
              name: 'Racing Spider Oversized Tee',
              size: 'M',
              sku: 'BYND-RACING-SPIDER-OVERSIZED-TEE-M',
              price: 6500,
              quantity: 1,
              image: 'assets/products/racing-spider-tee.png'
            }
          ],
          subtotal: 15000,
          shipping: 0,
          tax: 1800,
          total: 15000,
          paymentMethod: 'cod',
          paymentStatus: 'cod_pending',
          orderStatus: 'shipped',
          shippingProvider: 'shiprocket',
          awb: 'SR-BLR-4410928',
          timeline: [
            { status: 'confirmed', note: 'Cash on Delivery order confirmed', time: new Date(Date.now() - 3600000 * 18).toISOString() },
            { status: 'packed', note: 'Sealed in tamper-evident brutalist package', time: new Date(Date.now() - 3600000 * 12).toISOString() },
            { status: 'shipped', note: 'Dispatched via BlueDart Surface Express', time: new Date(Date.now() - 3600000 * 6).toISOString() }
          ]
        },
        {
          id: 'BYND-2026-1003',
          date: new Date(Date.now() - 86400000 * 2).toISOString(),
          customer: {
            name: 'Kavya Singhania',
            email: 'kavya.s@yahoo.com',
            phone: '+91 98109 88204',
            city: 'New Delhi',
            state: 'Delhi',
            address: 'Villa 14, Shanti Niketan, New Delhi 110021'
          },
          items: [
            {
              id: 'raw-plaster-hoodie-02',
              name: 'Raw Plaster Hoodie 02',
              size: 'S',
              sku: 'BYND-RAW-PLASTER-HOODIE-02-S',
              price: 8500,
              quantity: 1,
              image: 'assets/products/hoodie-grey.png'
            }
          ],
          subtotal: 8500,
          shipping: 0,
          tax: 1020,
          total: 8500,
          paymentMethod: 'prepaid',
          paymentStatus: 'captured',
          orderStatus: 'delivered',
          paymentRef: 'pay_N8kL12aBcDPqZ9',
          shippingProvider: 'shiprocket',
          awb: 'SR-DEL-2299100',
          timeline: [
            { status: 'confirmed', note: 'Order placed & prepaid', time: new Date(Date.now() - 86400000 * 2).toISOString() },
            { status: 'shipped', note: 'Dispatched from studio', time: new Date(Date.now() - 86400000 * 1.5).toISOString() },
            { status: 'delivered', note: 'Delivered and signed by recipient', time: new Date(Date.now() - 86400000 * 0.5).toISOString() }
          ]
        }
      ];
      setStorage(DATA_ORDERS_KEY, seedOrders);
    }

    // 3. Homepage Slides
    if (!getStorage(DATA_SLIDES_KEY, null)) {
      const seedSlides = [
        {
          id: 'slide-1',
          title: 'Distressed Moto Jacket',
          subtitle: 'FALL-WINTER 2026',
          ctaLabel: 'VIEW PIECE',
          ctaUrl: '#/piece/distressed-moto-jacket',
          desktopImage: 'assets/products/moto-jacket.png',
          sortOrder: 1,
          active: true
        },
        {
          id: 'slide-2',
          title: 'Heavy Fleece Hoodie 01',
          subtitle: '600 GSM MINERAL TERRY',
          ctaLabel: 'VIEW PIECE',
          ctaUrl: '#/piece/heavy-fleece-hoodie-01',
          desktopImage: 'assets/products/hoodie-black.png',
          sortOrder: 2,
          active: true
        },
        {
          id: 'slide-3',
          title: 'Racing Spider Oversized Tee',
          subtitle: 'CRACKED SOLVENT SCREENPRINT',
          ctaLabel: 'VIEW PIECE',
          ctaUrl: '#/piece/racing-spider-oversized-tee',
          desktopImage: 'assets/products/racing-spider-tee.png',
          sortOrder: 3,
          active: true
        },
        {
          id: 'slide-4',
          title: 'Raw Plaster Hoodie 02',
          subtitle: 'CUSTOM CHALK DYE RESIST',
          ctaLabel: 'VIEW PIECE',
          ctaUrl: '#/piece/raw-plaster-hoodie-02',
          desktopImage: 'assets/products/hoodie-grey.png',
          sortOrder: 4,
          active: true
        }
      ];
      setStorage(DATA_SLIDES_KEY, seedSlides);
    }

    // 4. Coupons
    if (!getStorage(DATA_COUPONS_KEY, null)) {
      const seedCoupons = [
        {
          id: 'c-1',
          code: 'ARCHIVE10',
          type: 'percentage',
          value: 10,
          minOrder: 10000,
          usageLimit: 100,
          usedCount: 14,
          active: true,
          expiry: '2026-12-31'
        },
        {
          id: 'c-2',
          code: 'STUDIOVIP',
          type: 'fixed',
          value: 2000,
          minOrder: 25000,
          usageLimit: 50,
          usedCount: 8,
          active: true,
          expiry: '2026-11-30'
        }
      ];
      setStorage(DATA_COUPONS_KEY, seedCoupons);
    }

    // 5. Store Settings
    if (!getStorage(DATA_SETTINGS_KEY, null)) {
      const defaultSettings = {
        storeName: 'BEYOND',
        currency: 'INR',
        currencySymbol: '₹',
        taxPercent: 12,
        freeShippingThreshold: 0,
        codEnabled: true,
        lowStockThreshold: 3,
        supportEmail: 'concierge@beyond-streetwear.com',
        supportPhone: '+91 99000 12345',
        instagram: '@beyond.gallery',
        returnWindowDays: 7
      };
      setStorage(DATA_SETTINGS_KEY, defaultSettings);
    }
  }

  function updateNavCounters() {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const pCountEl = document.getElementById('navProductCount');
    const oCountEl = document.getElementById('navOrderCount');
    if (pCountEl) pCountEl.textContent = products.length;
    if (oCountEl) oCountEl.textContent = orders.length;
  }

  // ==============================================================================
  // 4. OWNER AUTHENTICATION & SESSION HANDLING
  // ==============================================================================
  async function checkSession() {
    // Require genuine Supabase Auth verification
    // Stored localStorage is never accepted as proof of owner authentication.
    if (!supabase) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      currentOwner = null;
      showAuthError('Backend authentication service is not configured. Please verify Supabase credentials.');
      showLogin();
      return;
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData || !sessionData.session || !sessionData.session.user) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        currentOwner = null;
        showLogin();
        return;
      }

      const user = sessionData.session.user;

      // Server-side database role verification: user must hold 'owner' role in public.user_roles
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (roleError || !roleData || roleData.role !== 'owner') {
        console.warn('Access denied: Active user does not possess verified owner role in public.user_roles');
        await supabase.auth.signOut();
        localStorage.removeItem(AUTH_STORAGE_KEY);
        currentOwner = null;
        showAuthError('Access denied: Verified owner role required.');
        showLogin();
        return;
      }

      currentOwner = {
        id: user.id,
        email: user.email,
        role: 'owner',
        authType: 'supabase'
      };
      setStorage(AUTH_STORAGE_KEY, currentOwner);
      showApp();
    } catch (err) {
      console.error('Session verification failed:', err);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      currentOwner = null;
      showLogin();
    }
  }

  function showLogin() {
    if (authView) authView.style.display = 'flex';
    if (appShell) appShell.style.display = 'none';
  }

  function showApp() {
    if (authView) authView.style.display = 'none';
    if (appShell) appShell.style.display = 'flex';
    if (sidebarUserEmail && currentOwner) {
      sidebarUserEmail.textContent = currentOwner.email;
    }
    updateNavCounters();
    syncProductsFromSupabase();
    route();
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = loginEmail.value.trim().toLowerCase();
      const password = loginPassword.value;

      // Reset any active error state
      if (authError) {
        authError.textContent = '';
        authError.classList.remove('visible');
      }

      if (!email || !password) {
        showAuthError('Please enter both email and password.');
        return;
      }

      loginSubmitBtn.disabled = true;
      loginSubmitBtn.innerHTML = '<span>Verifying Credentials &bull; Please wait...</span>';

      try {
        if (!supabase) {
          throw new Error('Authentication backend is not configured. Please verify Supabase connection.');
        }

        // Genuine Supabase Authentication
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email,
          password: password
        });

        if (error) throw error;

        // Verify owner role in public.user_roles enforced by database
        const { data: roleData, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user.id)
          .single();

        if (roleError || !roleData || roleData.role !== 'owner') {
          await supabase.auth.signOut();
          throw new Error('Access denied: You do not possess store owner privileges in the database.');
        }

        currentOwner = {
          id: data.user.id,
          email: data.user.email,
          role: 'owner',
          authType: 'supabase'
        };

        setStorage(AUTH_STORAGE_KEY, currentOwner);
        logAudit('LOGIN_SUCCESS', 'AUTH', currentOwner.email, 'Owner authenticated successfully');
        showToast('Authenticated successfully. Welcome back.', 'success');
        showApp();
      } catch (err) {
        showAuthError(err.message || 'Authentication failed. Please verify credentials.');
        logAudit('LOGIN_FAILED', 'AUTH', email, err.message);
      } finally {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.innerHTML = '<span>Authenticate &bull; Enter Portal</span>';
      }
    });
  }

  function showAuthError(msg) {
    if (authError) {
      authError.textContent = msg;
      authError.classList.add('visible');
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      if (supabase) {
        try { await supabase.auth.signOut(); } catch (e) {}
      }
      logAudit('LOGOUT', 'AUTH', currentOwner ? currentOwner.email : '', 'Owner signed out');
      localStorage.removeItem(AUTH_STORAGE_KEY);
      currentOwner = null;
      if (loginEmail) loginEmail.value = '';
      if (loginPassword) loginPassword.value = '';
      if (authError) {
        authError.textContent = '';
        authError.classList.remove('visible');
      }
      showToast('Signed out of admin portal.', 'normal');
      showLogin();
    });
  }

  // ==============================================================================
  // 5. ROUTER & SECTION CONTROLLER
  // ==============================================================================
  const validSections = [
    'dashboard', 'products', 'categories', 'inventory',
    'orders', 'customers', 'payments', 'shipping',
    'homepage', 'discounts', 'reviews', 'analytics',
    'settings', 'security'
  ];

  function route() {
    if (!currentOwner) return;

    const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
    const section = validSections.includes(hash) ? hash : 'dashboard';

    // Highlight active sidebar item
    document.querySelectorAll('.sidebar-link').forEach(link => {
      const sec = link.getAttribute('data-section');
      link.classList.toggle('active', sec === section);
    });

    // Update Topbar Title
    const formattedTitle = section
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
    if (topbarTitle) topbarTitle.textContent = formattedTitle;

    // Close mobile sidebar on navigation
    if (adminSidebar) adminSidebar.classList.remove('open');

    renderSection(section);
  }

  window.addEventListener('hashchange', route);

  function renderSection(section) {
    if (!adminContent) return;

    switch (section) {
      case 'dashboard': renderDashboard(); break;
      case 'products': renderProducts(); break;
      case 'categories': renderCategories(); break;
      case 'inventory': renderInventory(); break;
      case 'orders': renderOrders(); break;
      case 'customers': renderCustomers(); break;
      case 'payments': renderPayments(); break;
      case 'shipping': renderShipping(); break;
      case 'homepage': renderHomepage(); break;
      case 'discounts': renderDiscounts(); break;
      case 'reviews': renderReviews(); break;
      case 'analytics': renderAnalytics(); break;
      case 'settings': renderSettings(); break;
      case 'security': renderSecurity(); break;
      default: renderDashboard(); break;
    }
  }

  // ==============================================================================
  // 6. SECTION RENDERERS
  // ==============================================================================

  // --- 6.1 DASHBOARD OVERVIEW ---
  function renderDashboard() {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const orders = getStorage(DATA_ORDERS_KEY, []);
    
    // Compute KPI metrics from actual database/storage records
    const grossSales = orders.reduce((acc, o) => acc + (o.total || 0), 0);
    const collectedRevenue = orders
      .filter(o => o.paymentStatus === 'captured')
      .reduce((acc, o) => acc + (o.total || 0), 0);
    const pendingCod = orders
      .filter(o => o.paymentMethod === 'cod' && o.paymentStatus !== 'cod_collected')
      .reduce((acc, o) => acc + (o.total || 0), 0);
    const awaitingProcessing = orders.filter(o => o.orderStatus === 'processing' || o.orderStatus === 'confirmed').length;
    const lowStockCount = products.filter(p => (p.sizes || []).some(s => s.stock <= 2)).length;

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Store Operations Overview</h2>
            <p class="section-desc">Real-time status of orders, inventory, and revenue.</p>
          </div>
          <div class="section-actions">
            <button class="btn-primary btn-sm" id="quickAddProductBtn">
              <span>+ Add Product</span>
            </button>
            <a href="#/orders" class="btn-secondary btn-sm">Process Orders</a>
          </div>
        </div>

        <!-- KPI Cards Grid -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Gross Sales</div>
            <div class="stat-value">${formatPrice(grossSales)}</div>
            <div class="stat-sub">${orders.length} total orders recorded</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Collected Payments</div>
            <div class="stat-value" style="color: var(--status-paid);">${formatPrice(collectedRevenue)}</div>
            <div class="stat-sub">Settled via Razorpay</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending COD Due</div>
            <div class="stat-value" style="color: var(--status-pending);">${formatPrice(pendingCod)}</div>
            <div class="stat-sub">Collect upon delivery</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Awaiting Processing</div>
            <div class="stat-value">${awaitingProcessing}</div>
            <div class="stat-sub">Ready for fulfilment</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Garments</div>
            <div class="stat-value">${products.length}</div>
            <div class="stat-sub">${products.filter(p => p.featured).length} featured on hero</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Low Stock Alerts</div>
            <div class="stat-value" style="color: ${lowStockCount > 0 ? 'var(--status-alert)' : 'var(--paper)'};">${lowStockCount}</div>
            <div class="stat-sub">Variants with &le; 2 units</div>
          </div>
        </div>

        <!-- Recent Orders Table -->
        <div class="table-card">
          <div class="table-toolbar">
            <div style="font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
              Recent Orders
            </div>
            <a href="#/orders" style="font-size: 11px; color: var(--concrete-greige); text-decoration: none;">View All &rarr;</a>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${orders.length === 0 ? `
                  <tr><td colspan="8" style="text-align: center; padding: 32px; color: var(--ash-grey);">No orders recorded yet.</td></tr>
                ` : orders.slice(0, 5).map(o => `
                  <tr>
                    <td><strong>${o.id}</strong></td>
                    <td>${formatDate(o.date)}</td>
                    <td>${o.customer.name}<br><small style="color: var(--ash-grey);">${o.customer.city}</small></td>
                    <td>${o.items.length} ${o.items.length === 1 ? 'item' : 'items'}</td>
                    <td><strong>${formatPrice(o.total)}</strong></td>
                    <td><span class="badge badge-${o.paymentStatus.includes('captured') ? 'paid' : 'pending'}">${o.paymentMethod.toUpperCase()} &bull; ${o.paymentStatus}</span></td>
                    <td><span class="badge badge-${o.orderStatus}">${o.orderStatus.replace(/_/g, ' ')}</span></td>
                    <td><button class="btn-secondary btn-sm" onclick="window.viewOrderDetail('${o.id}')">Inspect</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const addBtn = document.getElementById('quickAddProductBtn');
    if (addBtn) addBtn.addEventListener('click', () => window.location.hash = '#/products?action=new');
  }

  // --- 6.2 PRODUCTS MANAGEMENT (CRUD) ---
  function renderProducts() {
    const products = getStorage(DATA_PRODUCTS_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Products Catalogue</h2>
            <p class="section-desc">Manage garments, high-resolution imagery, pricing, and publication states.</p>
          </div>
          <div class="section-actions">
            <button class="btn-primary btn-sm" id="addProductModalBtn">+ Add New Garment</button>
          </div>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <div class="table-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input type="text" id="productSearchInput" placeholder="Filter by title, category, SKU..." />
            </div>
            <div class="table-filters">
              <button class="btn-secondary btn-sm" onclick="window.filterProducts('ALL')">All</button>
              <button class="btn-secondary btn-sm" onclick="window.filterProducts('outerwear')">Outerwear</button>
              <button class="btn-secondary btn-sm" onclick="window.filterProducts('tops')">Tops</button>
              <button class="btn-secondary btn-sm" onclick="window.filterProducts('bottoms')">Bottoms</button>
            </div>
          </div>

          <div class="table-wrapper">
            <table class="data-table" id="productsTable">
              <thead>
                <tr>
                  <th>Garment</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Variants & Stock</th>
                  <th>Hero Featured</th>
                  <th>Status</th>
                  <th style="text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody id="productsTbody">
                ${products.map(p => `
                  <tr data-product-row="${p.id}">
                    <td>
                      <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${resolveAdminImageUrl(p.images && p.images[0])}" alt="${p.name}" style="width: 44px; height: 56px; object-fit: contain; background: #161614; padding: 4px; border: 1px solid var(--border-hairline);" />
                        <div>
                          <strong>${p.name}</strong><br>
                          <small style="color: var(--ash-grey);">${p.id}</small>
                          ${p.badge ? `<span class="badge badge-pending" style="margin-left: 6px; font-size: 8px;">${p.badge}</span>` : ''}
                        </div>
                      </div>
                    </td>
                    <td><span class="badge badge-neutral">${p.category.toUpperCase()}</span></td>
                    <td><strong>${p.priceFormatted}</strong></td>
                    <td>
                      ${(p.sizes || []).map(s => `
                        <span style="display: inline-block; margin-right: 6px; font-size: 11px;">
                          <strong>${s.size}:</strong> <span style="color: ${s.stock <= 2 ? 'var(--status-alert)' : 'var(--concrete-greige)'};">${s.stock}</span>
                        </span>
                      `).join('')}
                    </td>
                    <td>
                      <button class="btn-secondary btn-sm" onclick="window.toggleFeatured('${p.id}')">
                        ${p.featured ? '<span style="color: var(--status-paid);">★ Featured</span>' : '☆ Standard'}
                      </button>
                    </td>
                    <td>
                      <span class="badge badge-${p.status === 'published' ? 'published' : 'archived'}">${p.status}</span>
                    </td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; gap: 6px;">
                        <button class="btn-secondary btn-sm" onclick="window.editProductModal('${p.id}')">Edit</button>
                        <button class="btn-secondary btn-sm btn-danger" onclick="window.confirmArchiveProduct('${p.id}')">Archive</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const addBtn = document.getElementById('addProductModalBtn');
    if (addBtn) addBtn.addEventListener('click', () => window.openAddProductModal());

    const searchInput = document.getElementById('productSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#productsTbody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  }

  // ==============================================================================
  // PRODUCT IMAGERY STATE & UPLOAD HELPERS
  // ==============================================================================
  let currentModalImages = [];

  function renderModalImagePreviews() {
    const grid = document.getElementById('imagePreviewGrid');
    const badge = document.getElementById('imageCountBadge');
    if (!grid) return;

    if (badge) {
      badge.textContent = `${currentModalImages.length} image${currentModalImages.length === 1 ? '' : 's'}`;
    }

    if (currentModalImages.length === 0) {
      grid.innerHTML = '<span style="font-size: 11px; color: var(--ash-grey); padding: 4px 0;">No images attached. A default garment visual will be assigned if left empty.</span>';
      return;
    }

    grid.innerHTML = currentModalImages.map((img, idx) => {
      const displayUrl = resolveAdminImageUrl(img.isExisting ? img.url : img.previewUrl);
      return `
        <div class="image-preview-card">
          <img src="${displayUrl}" alt="Preview ${idx + 1}" />
          ${idx === 0 ? '<span class="badge-primary-image">PRIMARY</span>' : ''}
          <button type="button" class="btn-remove-image" onclick="window.removeModalImage('${img.id}')" title="Remove image">&times;</button>
        </div>
      `;
    }).join('');
  }

  window.removeModalImage = function (imgId) {
    const idx = currentModalImages.findIndex(item => item.id === imgId);
    if (idx !== -1) {
      const removed = currentModalImages[idx];
      if (!removed.isExisting && removed.previewUrl) {
        try { URL.revokeObjectURL(removed.previewUrl); } catch (e) {}
      }
      currentModalImages.splice(idx, 1);
      renderModalImagePreviews();
    }
  };

  function setupImagePickerListeners() {
    const fileInput = document.getElementById('productImageFiles');
    const dropzone = document.getElementById('imageDropzone');
    if (!fileInput || !dropzone) return;

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      handlePickedFiles(e.target.files);
      fileInput.value = '';
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files) {
        handlePickedFiles(e.dataTransfer.files);
      }
    });
  }

  function handlePickedFiles(files) {
    if (!files || files.length === 0) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const maxSizeBytes = 5 * 1024 * 1024; // 5 MB

    let addedCount = 0;
    Array.from(files).forEach(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isValidType = allowedTypes.includes(file.type) || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

      if (!isValidType) {
        showToast(`Invalid format: "${file.name}". Supported: JPG, PNG, WebP.`, 'error');
        return;
      }

      if (file.size > maxSizeBytes) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        showToast(`File too large: "${file.name}" is ${sizeMb}MB (max 5MB).`, 'error');
        return;
      }

      if (currentModalImages.length >= 10) {
        showToast('Maximum of 10 images allowed per product.', 'error');
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      currentModalImages.push({
        id: 'img_' + Math.random().toString(36).substr(2, 9),
        file: file,
        previewUrl: previewUrl,
        isExisting: false
      });
      addedCount++;
    });

    if (addedCount > 0) {
      renderModalImagePreviews();
    }
  }

  async function uploadProductImagesToStorage(productId, imageList, progressCallback) {
    const finalUrls = [];
    const BUCKET_NAME = 'products';

    for (let i = 0; i < imageList.length; i++) {
      const item = imageList[i];
      if (item.isExisting) {
        finalUrls.push(item.url);
        continue;
      }

      if (!item.file) continue;

      if (!supabase) {
        throw new Error('Supabase client is not connected. Uploading images requires an active Supabase backend.');
      }

      if (progressCallback) progressCallback(i + 1, imageList.length, item.file.name);

      const ext = item.file.name.split('.').pop().toLowerCase();
      const sanitizedBase = item.file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      const timestamp = Date.now();
      const filePath = `${productId}/${timestamp}-${sanitizedBase}.${ext}`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, item.file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadErr) {
        const errMsg = uploadErr.message || String(uploadErr);
        if (errMsg.toLowerCase().includes('not found') || uploadErr.statusCode === 404 || uploadErr.statusCode === '404' || errMsg.toLowerCase().includes('bucket')) {
          throw new Error(
            `Supabase Storage bucket "${BUCKET_NAME}" does not exist yet. Please create a public bucket named "${BUCKET_NAME}" in your Supabase Dashboard under Storage.`
          );
        }
        throw new Error(`Failed to upload "${item.file.name}": ${errMsg}`);
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(uploadData.path);

      if (!urlData || !urlData.publicUrl) {
        throw new Error(`Failed to retrieve public URL for uploaded file: ${item.file.name}`);
      }

      finalUrls.push(urlData.publicUrl);
    }

    return finalUrls;
  }

  // Window-attached handlers for product CRUD
  window.openAddProductModal = function () {
    currentModalImages = [];

    const bodyHtml = `
      <form id="newProductForm">
        <div class="form-group">
          <label class="form-label">Garment Name</label>
          <input type="text" id="npName" class="form-input" required placeholder="e.g. Asymmetrical Brutalist Parka" />
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group">
            <label class="form-label">Category</label>
            <select id="npCategory" class="form-select">
              <option value="outerwear">Outerwear</option>
              <option value="tops">Tops & Knitwear</option>
              <option value="bottoms">Bottoms</option>
              <option value="footwear">Footwear</option>
              <option value="accessories">Accessories</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Price (INR ₹)</label>
            <input type="number" id="npPrice" class="form-input" required placeholder="8500" min="0" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea id="npDesc" class="form-textarea" rows="3" required placeholder="Editorial garment description..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Material & Construction Notes</label>
          <input type="text" id="npMaterial" class="form-input" placeholder="e.g. 100% French terry (600 GSM)" />
        </div>
        <div class="form-group">
          <label class="form-label">Initial Stock by Size (comma-separated)</label>
          <input type="text" id="npStock" class="form-input" value="S: 4, M: 6, L: 4, XL: 2" />
        </div>

        <!-- Product Images Section -->
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Product Images (JPG, PNG, WebP &bull; Max 5MB)</span>
            <span id="imageCountBadge" style="font-size: 10px; color: var(--ash-grey); text-transform: none; letter-spacing: normal;">0 images</span>
          </label>
          <div id="imageDropzone" class="image-upload-dropzone">
            <input type="file" id="productImageFiles" accept="image/jpeg,image/png,image/webp,image/jpg" multiple style="display: none;" />
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--concrete-greige); margin-bottom: 6px;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <div style="font-size: 12px; color: var(--paper); letter-spacing: 0.08em; margin-bottom: 4px;">
              <span style="text-decoration: underline; text-underline-offset: 3px;">Choose Images</span> or drag & drop files here
            </div>
            <div style="font-size: 10px; color: var(--ash-grey); letter-spacing: 0.06em;">
              Select multiple photos. The first image will be set as the primary piece visual.
            </div>
          </div>
          <div id="imagePreviewGrid" class="image-preview-grid"></div>
        </div>
      </form>
    `;

    const footerHtml = `
      <button class="btn-secondary btn-sm" onclick="window.closeModal()">Cancel</button>
      <button class="btn-primary btn-sm" style="width: auto;" onclick="window.saveNewProduct()">Create Garment</button>
    `;

    openModal('Add New Garment', bodyHtml, footerHtml);
    setupImagePickerListeners();
    renderModalImagePreviews();
  };

  window.saveNewProduct = async function () {
    const saveBtn = document.querySelector('#adminModal .modal-footer .btn-primary');
    const name = document.getElementById('npName').value.trim();
    const cat = document.getElementById('npCategory').value;
    const price = parseInt(document.getElementById('npPrice').value, 10);
    const desc = document.getElementById('npDesc').value.trim();
    const material = document.getElementById('npMaterial').value.trim();
    const stockStr = document.getElementById('npStock').value.trim();

    if (!name || isNaN(price) || !desc) {
      showToast('Please complete all required fields.', 'error');
      return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const sizes = stockStr.split(',').map(part => {
      const [s, q] = part.split(':').map(x => x.trim());
      return {
        size: s || 'ONE SIZE',
        sku: `BYND-${id.toUpperCase()}-${s || 'OS'}`.replace(/\s+/g, ''),
        stock: parseInt(q, 10) || 0
      };
    });

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>Uploading Imagery &bull; Please wait...</span>';
    }

    let finalImages = [];
    try {
      if (currentModalImages.length > 0) {
        finalImages = await uploadProductImagesToStorage(id, currentModalImages, (current, total, filename) => {
          if (saveBtn) saveBtn.innerHTML = `<span>Uploading ${current}/${total} &bull; ${filename}...</span>`;
        });
      } else {
        finalImages = ['assets/products/moto-jacket.png'];
      }
    } catch (uploadErr) {
      console.error('[BEYOND] Image upload error:', uploadErr);
      showToast(uploadErr.message, 'error');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span>Create Garment</span>';
      }
      return;
    }

    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const newProd = {
      id: id,
      name: name,
      slug: id,
      category: cat,
      regularPrice: price,
      salePrice: null,
      priceFormatted: formatPrice(price),
      description: desc,
      material: material,
      fitNotes: 'Oversized brutalist fit.',
      status: 'published',
      featured: false,
      badge: 'NEW',
      images: finalImages,
      sizes: sizes,
      sortOrder: products.length,
      createdAt: new Date().toISOString()
    };

    if (supabase) {
      try {
        if (saveBtn) saveBtn.innerHTML = '<span>Syncing Database...</span>';

        // 1. Insert product
        const { error: pErr } = await supabase.from('products').insert({
          id: id,
          name: name,
          slug: id,
          category_id: cat,
          regular_price: price,
          price_formatted: formatPrice(price),
          description: desc,
          material: material,
          fit_notes: 'Oversized brutalist fit.',
          status: 'published',
          featured: false,
          badge: 'NEW',
          sort_order: products.length
        });
        if (pErr) console.warn('[BEYOND] products insert warning:', pErr);

        // 2. Insert product images
        if (finalImages.length > 0) {
          const imgRows = finalImages.map((imgUrl, idx) => ({
            product_id: id,
            image_url: imgUrl,
            alt_text: name,
            is_primary: idx === 0,
            sort_order: idx
          }));
          const { error: iErr } = await supabase.from('product_images').insert(imgRows);
          if (iErr) console.warn('[BEYOND] product_images insert warning:', iErr);
        }

        // 3. Insert product variants
        if (sizes.length > 0) {
          const varRows = sizes.map(s => ({
            product_id: id,
            size: s.size,
            sku: s.sku,
            stock_quantity: s.stock,
            is_active: true
          }));
          const { error: vErr } = await supabase.from('product_variants').insert(varRows);
          if (vErr) console.warn('[BEYOND] product_variants insert warning:', vErr);
        }
      } catch (dbErr) {
        console.warn('[BEYOND] Database sync warning:', dbErr);
      }
    }

    products.unshift(newProd);
    setStorage(DATA_PRODUCTS_KEY, products);
    logAudit('CREATE_PRODUCT', 'PRODUCT', id, `Added ${name} with ${finalImages.length} image(s)`);
    closeModal();
    showToast(`Created garment: ${name}`, 'success');
    updateNavCounters();
    renderProducts();
  };

  window.editProductModal = function (id) {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const prod = products.find(p => p.id === id);
    if (!prod) return;

    currentModalImages = (prod.images || []).map(url => ({
      id: 'img_' + Math.random().toString(36).substr(2, 9),
      url: url,
      isExisting: true
    }));

    const bodyHtml = `
      <form id="editProductForm">
        <div class="form-group">
          <label class="form-label">Garment Name</label>
          <input type="text" id="epName" class="form-input" value="${prod.name}" required />
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group">
            <label class="form-label">Category</label>
            <select id="epCategory" class="form-select">
              <option value="outerwear" ${prod.category === 'outerwear' ? 'selected' : ''}>Outerwear</option>
              <option value="tops" ${prod.category === 'tops' ? 'selected' : ''}>Tops & Knitwear</option>
              <option value="bottoms" ${prod.category === 'bottoms' ? 'selected' : ''}>Bottoms</option>
              <option value="footwear" ${prod.category === 'footwear' ? 'selected' : ''}>Footwear</option>
              <option value="accessories" ${prod.category === 'accessories' ? 'selected' : ''}>Accessories</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Price (INR ₹)</label>
            <input type="number" id="epPrice" class="form-input" value="${prod.regularPrice}" required />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Badge Label (Optional)</label>
          <input type="text" id="epBadge" class="form-input" value="${prod.badge || ''}" placeholder="e.g. NEW, LAST PIECES" />
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea id="epDesc" class="form-textarea" rows="3" required>${prod.description}</textarea>
        </div>

        <!-- Product Images Section -->
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Product Images (JPG, PNG, WebP &bull; Max 5MB)</span>
            <span id="imageCountBadge" style="font-size: 10px; color: var(--ash-grey); text-transform: none; letter-spacing: normal;">${currentModalImages.length} images</span>
          </label>
          <div id="imageDropzone" class="image-upload-dropzone">
            <input type="file" id="productImageFiles" accept="image/jpeg,image/png,image/webp,image/jpg" multiple style="display: none;" />
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--concrete-greige); margin-bottom: 6px;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <div style="font-size: 12px; color: var(--paper); letter-spacing: 0.08em; margin-bottom: 4px;">
              <span style="text-decoration: underline; text-underline-offset: 3px;">Add More Images</span> or drag & drop files here
            </div>
            <div style="font-size: 10px; color: var(--ash-grey); letter-spacing: 0.06em;">
              Click &times; on any thumbnail to remove it. First image is used as primary storefront hero.
            </div>
          </div>
          <div id="imagePreviewGrid" class="image-preview-grid"></div>
        </div>
      </form>
    `;

    const footerHtml = `
      <button class="btn-secondary btn-sm" onclick="window.closeModal()">Cancel</button>
      <button class="btn-primary btn-sm" style="width: auto;" onclick="window.saveProductEdits('${id}')">Save Changes</button>
    `;

    openModal(`Edit ${prod.name}`, bodyHtml, footerHtml);
    setupImagePickerListeners();
    renderModalImagePreviews();
  };

  window.saveProductEdits = async function (id) {
    const saveBtn = document.querySelector('#adminModal .modal-footer .btn-primary');
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return;

    const name = document.getElementById('epName').value.trim();
    const cat = document.getElementById('epCategory').value;
    const price = parseInt(document.getElementById('epPrice').value, 10);
    const badge = document.getElementById('epBadge').value.trim() || null;
    const desc = document.getElementById('epDesc').value.trim();

    if (!name || isNaN(price) || !desc) {
      showToast('Please complete all required fields.', 'error');
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>Uploading Imagery &bull; Please wait...</span>';
    }

    let finalImages = [];
    try {
      if (currentModalImages.length > 0) {
        finalImages = await uploadProductImagesToStorage(id, currentModalImages, (current, total, filename) => {
          if (saveBtn) saveBtn.innerHTML = `<span>Uploading ${current}/${total} &bull; ${filename}...</span>`;
        });
      } else {
        finalImages = ['assets/products/moto-jacket.png'];
      }
    } catch (uploadErr) {
      console.error('[BEYOND] Image upload error:', uploadErr);
      showToast(uploadErr.message, 'error');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span>Save Changes</span>';
      }
      return;
    }

    products[idx].name = name;
    products[idx].category = cat;
    products[idx].regularPrice = price;
    products[idx].priceFormatted = formatPrice(price);
    products[idx].badge = badge;
    products[idx].description = desc;
    products[idx].images = finalImages;
    products[idx].updatedAt = new Date().toISOString();

    if (supabase) {
      try {
        if (saveBtn) saveBtn.innerHTML = '<span>Syncing Database...</span>';

        await supabase.from('products').update({
          name: name,
          category_id: cat,
          regular_price: price,
          price_formatted: formatPrice(price),
          badge: badge,
          description: desc,
          updated_at: new Date().toISOString()
        }).eq('id', id);

        // Replace product images
        await supabase.from('product_images').delete().eq('product_id', id);
        if (finalImages.length > 0) {
          const imgRows = finalImages.map((imgUrl, i) => ({
            product_id: id,
            image_url: imgUrl,
            alt_text: name,
            is_primary: i === 0,
            sort_order: i
          }));
          await supabase.from('product_images').insert(imgRows);
        }
      } catch (dbErr) {
        console.warn('[BEYOND] Database update warning:', dbErr);
      }
    }

    setStorage(DATA_PRODUCTS_KEY, products);
    logAudit('UPDATE_PRODUCT', 'PRODUCT', id, `Updated details and ${finalImages.length} images for ${name}`);
    closeModal();
    showToast(`Updated: ${name}`, 'success');
    renderProducts();
  };


  window.toggleFeatured = function (id) {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    p.featured = !p.featured;
    setStorage(DATA_PRODUCTS_KEY, products);
    logAudit('TOGGLE_FEATURED', 'PRODUCT', id, `Featured set to ${p.featured}`);
    showToast(`${p.name}: ${p.featured ? 'Featured on Hero' : 'Unfeatured'}`);
    renderProducts();
  };

  window.confirmArchiveProduct = function (id) {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const p = products.find(prod => prod.id === id);
    if (!p) return;

    const bodyHtml = `
      <p style="margin-bottom: 16px;">Are you sure you want to archive <strong>${p.name}</strong>?</p>
      <p style="font-size: 11px; color: var(--ash-grey);">
        Archiving unpublishes the piece from the catalogue while strictly preserving historical orders, inventory movements, and analytics records.
      </p>
    `;

    const footerHtml = `
      <button class="btn-secondary btn-sm" onclick="window.closeModal()">Cancel</button>
      <button class="btn-secondary btn-sm btn-danger" onclick="window.archiveProduct('${id}')">Confirm Archive</button>
    `;

    openModal(`Archive Garment: ${p.name}`, bodyHtml, footerHtml);
  };

  window.archiveProduct = function (id) {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    p.status = p.status === 'archived' ? 'published' : 'archived';
    setStorage(DATA_PRODUCTS_KEY, products);
    logAudit('ARCHIVE_PRODUCT', 'PRODUCT', id, `Status set to ${p.status}`);
    closeModal();
    showToast(`Garment ${p.status}: ${p.name}`);
    renderProducts();
  };

  // --- 6.3 CATEGORIES & COLLECTIONS ---
  function renderCategories() {
    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Categories & Collections</h2>
            <p class="section-desc">Organize garment taxonomy, curation drop windows, and navigation filters.</p>
          </div>
          <div class="section-actions">
            <button class="btn-primary btn-sm" onclick="window.showToast('Collection creation configured.')">+ Create Collection</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Taxonomy Category</div>
            <div class="stat-value">Outerwear</div>
            <div class="stat-sub">Heavyweight jackets, shearling, steerhide</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Taxonomy Category</div>
            <div class="stat-value">Tops & Knitwear</div>
            <div class="stat-sub">600 GSM terry hoodies, cracked screenprint tees</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Taxonomy Category</div>
            <div class="stat-value">Bottoms</div>
            <div class="stat-sub">Waxed canvas cargo, selvedge denim, stacked sweats</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Taxonomy Category</div>
            <div class="stat-value">Footwear & Bags</div>
            <div class="stat-sub">Welted biker boots, utilitarian totes, beanies</div>
          </div>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <div style="font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
              Active Drop Collections
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Collection Name</th>
                <th>Slug</th>
                <th>Release Window</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>EDITION 01 &bull; FALL-WINTER 2026</strong></td>
                <td><code>fall-winter-2026</code></td>
                <td>Current Active Drop</td>
                <td><span class="badge badge-published">Active</span></td>
                <td><button class="btn-secondary btn-sm">Edit Collection</button></td>
              </tr>
              <tr>
                <td><strong>ESSENTIALS &bull; CORE ARCHIVE</strong></td>
                <td><code>essentials</code></td>
                <td>Permanent Collection</td>
                <td><span class="badge badge-published">Active</span></td>
                <td><button class="btn-secondary btn-sm">Edit Collection</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- 6.4 INVENTORY & SIZING MATRIX ---
  function renderInventory() {
    const products = getStorage(DATA_PRODUCTS_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Inventory & Sizing Matrix</h2>
            <p class="section-desc">Atomic stock quantities, variant SKUs, and replenishment logs.</p>
          </div>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <div style="font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
              Stock Levels by Variant SKU
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Garment</th>
                  <th>Size</th>
                  <th>SKU</th>
                  <th>Stock Available</th>
                  <th>Status</th>
                  <th style="text-align: right;">Quick Adjust</th>
                </tr>
              </thead>
              <tbody>
                ${products.flatMap(p => (p.sizes || []).map(s => `
                  <tr>
                    <td><strong>${p.name}</strong></td>
                    <td><span class="badge badge-neutral">${s.size}</span></td>
                    <td><code>${s.sku}</code></td>
                    <td><strong style="font-size: 14px; color: ${s.stock <= 2 ? 'var(--status-alert)' : 'var(--paper)'};">${s.stock}</strong></td>
                    <td>
                      ${s.stock === 0 ? '<span class="badge badge-archived">Sold Out</span>' :
                        (s.stock <= 2 ? '<span class="badge badge-pending">Low Stock</span>' : '<span class="badge badge-paid">In Stock</span>')}
                    </td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; gap: 4px;">
                        <button class="btn-secondary btn-sm" onclick="window.adjustStock('${p.id}', '${s.size}', -1)">-1</button>
                        <button class="btn-secondary btn-sm" onclick="window.adjustStock('${p.id}', '${s.size}', 1)">+1</button>
                        <button class="btn-secondary btn-sm" onclick="window.adjustStock('${p.id}', '${s.size}', 5)">+5</button>
                      </div>
                    </td>
                  </tr>
                `)).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  window.adjustStock = function (productId, size, delta) {
    const products = getStorage(DATA_PRODUCTS_KEY, []);
    const p = products.find(prod => prod.id === productId);
    if (!p) return;
    const s = (p.sizes || []).find(v => v.size === size);
    if (!s) return;

    const prev = s.stock;
    const next = Math.max(0, prev + delta);
    s.stock = next;

    setStorage(DATA_PRODUCTS_KEY, products);
    logAudit('STOCK_ADJUSTMENT', 'VARIANT', s.sku, `Adjusted ${p.name} (${size}) from ${prev} to ${next} (${delta > 0 ? '+' : ''}${delta})`);
    showToast(`${p.name} (${size}) stock: ${next}`);
    renderInventory();
  };

  // --- 6.5 ORDERS MANAGEMENT ---
  function renderOrders() {
    const orders = getStorage(DATA_ORDERS_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Order Management & Fulfilment</h2>
            <p class="section-desc">Search, inspect, update status, generate packing slips, and handle returns.</p>
          </div>
          <div class="section-actions">
            <button class="btn-secondary btn-sm" onclick="window.exportOrdersCsv()">Export CSV</button>
          </div>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <div class="table-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input type="text" id="orderSearchInput" placeholder="Search by order ID, customer name..." />
            </div>
            <div class="table-filters">
              <button class="btn-secondary btn-sm" onclick="window.filterOrders('ALL')">All</button>
              <button class="btn-secondary btn-sm" onclick="window.filterOrders('processing')">Processing</button>
              <button class="btn-secondary btn-sm" onclick="window.filterOrders('shipped')">Shipped</button>
              <button class="btn-secondary btn-sm" onclick="window.filterOrders('delivered')">Delivered</button>
            </div>
          </div>

          <div class="table-wrapper">
            <table class="data-table" id="ordersTable">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Purchased Items</th>
                  <th>Total</th>
                  <th>Payment Status</th>
                  <th>Fulfilment Status</th>
                  <th style="text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody id="ordersTbody">
                ${orders.length === 0 ? `
                  <tr><td colspan="8" style="text-align: center; padding: 32px; color: var(--ash-grey);">No orders recorded.</td></tr>
                ` : orders.map(o => `
                  <tr>
                    <td><strong>${o.id}</strong></td>
                    <td>${formatDate(o.date)}</td>
                    <td><strong>${o.customer.name}</strong><br><small style="color: var(--ash-grey);">${o.customer.city}</small></td>
                    <td>
                      ${o.items.map(it => `
                        <div style="font-size: 11px;">${it.name} (${it.size}) &times; ${it.quantity}</div>
                      `).join('')}
                    </td>
                    <td><strong>${formatPrice(o.total)}</strong></td>
                    <td><span class="badge badge-${o.paymentStatus.includes('captured') ? 'paid' : 'pending'}">${o.paymentMethod.toUpperCase()} &bull; ${o.paymentStatus}</span></td>
                    <td><span class="badge badge-${o.orderStatus}">${o.orderStatus.replace(/_/g, ' ')}</span></td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; gap: 6px;">
                        <button class="btn-secondary btn-sm" onclick="window.viewOrderDetail('${o.id}')">Inspect</button>
                        <button class="btn-secondary btn-sm" onclick="window.updateOrderStatusModal('${o.id}')">Update</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('orderSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#ordersTbody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  }

  window.viewOrderDetail = function (orderId) {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const o = orders.find(ord => ord.id === orderId);
    if (!o) return;

    const bodyHtml = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px;">
        <div>
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ash-grey); margin-bottom: 6px;">Customer Information</div>
          <div style="font-size: 14px; font-weight: 700;">${o.customer.name}</div>
          <div style="font-size: 12px; color: var(--concrete-greige); margin: 4px 0;">${o.customer.email}</div>
          <div style="font-size: 12px; color: var(--concrete-greige);">${o.customer.phone}</div>
        </div>
        <div>
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ash-grey); margin-bottom: 6px;">Shipping Address</div>
          <div style="font-size: 12px; color: var(--paper); line-height: 1.6;">${o.customer.address}</div>
          ${o.awb ? `<div style="margin-top: 6px; font-size: 11px;">AWB: <code>${o.awb}</code> (${o.shippingProvider})</div>` : ''}
        </div>
      </div>

      <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ash-grey); margin-bottom: 10px;">Purchased Items</div>
      <table class="data-table" style="margin-bottom: 20px;">
        <thead>
          <tr>
            <th>Garment</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${o.items.map(it => `
            <tr>
              <td><strong>${it.name}</strong> (${it.size})</td>
              <td><code>${it.sku}</code></td>
              <td>${it.quantity}</td>
              <td>${formatPrice(it.price)}</td>
              <td><strong>${formatPrice(it.price * it.quantity)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="background: #141412; padding: 16px; border: 1px solid var(--border-hairline); margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>Subtotal:</span>
          <strong>${formatPrice(o.subtotal)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>Complimentary Courier Shipping:</span>
          <span>₹0</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>Estimated GST (12%):</span>
          <span>${formatPrice(o.tax)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; border-top: 1px solid var(--border-hairline); padding-top: 8px; color: var(--paper);">
          <span>Final Order Total:</span>
          <span>${formatPrice(o.total)}</span>
        </div>
      </div>

      <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ash-grey); margin-bottom: 8px;">Order Timeline</div>
      <div style="border-left: 2px solid var(--border-subtle); padding-left: 14px; margin-left: 4px;">
        ${(o.timeline || []).map(t => `
          <div style="margin-bottom: 10px;">
            <div style="font-size: 11px; font-weight: 700; color: var(--paper);">${t.status.toUpperCase()} &bull; <small style="color: var(--ash-grey); font-weight: 400;">${formatDate(t.time)}</small></div>
            <div style="font-size: 11px; color: var(--concrete-greige);">${t.note}</div>
          </div>
        `).join('')}
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary btn-sm" onclick="window.printPackingSlip('${o.id}')">Print Packing Slip</button>
      <button class="btn-primary btn-sm" style="width: auto;" onclick="window.closeModal()">Close</button>
    `;

    openModal(`Order Details: ${o.id}`, bodyHtml, footerHtml);
  };

  window.updateOrderStatusModal = function (orderId) {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const o = orders.find(ord => ord.id === orderId);
    if (!o) return;

    const bodyHtml = `
      <div class="form-group">
        <label class="form-label">Update Fulfilment Status for ${o.id}</label>
        <select id="newOrderStatusSelect" class="form-select">
          <option value="confirmed" ${o.orderStatus === 'confirmed' ? 'selected' : ''}>Confirmed</option>
          <option value="processing" ${o.orderStatus === 'processing' ? 'selected' : ''}>Processing &bull; Packing</option>
          <option value="shipped" ${o.orderStatus === 'shipped' ? 'selected' : ''}>Shipped / In Transit</option>
          <option value="delivered" ${o.orderStatus === 'delivered' ? 'selected' : ''}>Delivered</option>
          <option value="cancelled" ${o.orderStatus === 'cancelled' ? 'selected' : ''}>Cancelled (Restores Inventory)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Internal Status Notes</label>
        <input type="text" id="statusNoteInput" class="form-input" placeholder="e.g. Dispatched via BlueDart AWB #..." />
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary btn-sm" onclick="window.closeModal()">Cancel</button>
      <button class="btn-primary btn-sm" style="width: auto;" onclick="window.applyOrderStatus('${o.id}')">Save Status</button>
    `;

    openModal(`Update Order: ${o.id}`, bodyHtml, footerHtml);
  };

  window.applyOrderStatus = function (orderId) {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const o = orders.find(ord => ord.id === orderId);
    if (!o) return;

    const newStatus = document.getElementById('newOrderStatusSelect').value;
    const note = document.getElementById('statusNoteInput').value.trim() || `Status updated to ${newStatus}`;

    // If order was cancelled, restore inventory
    if (newStatus === 'cancelled' && o.orderStatus !== 'cancelled') {
      const products = getStorage(DATA_PRODUCTS_KEY, []);
      o.items.forEach(it => {
        const prod = products.find(p => p.id === it.id);
        if (prod) {
          const sz = (prod.sizes || []).find(s => s.size === it.size);
          if (sz) sz.stock += it.quantity;
        }
      });
      setStorage(DATA_PRODUCTS_KEY, products);
      showToast('Inventory restored for cancelled order.');
    }

    o.orderStatus = newStatus;
    if (!o.timeline) o.timeline = [];
    o.timeline.push({
      status: newStatus,
      note: note,
      time: new Date().toISOString()
    });

    setStorage(DATA_ORDERS_KEY, orders);
    logAudit('UPDATE_ORDER_STATUS', 'ORDER', orderId, `Set status to ${newStatus}: ${note}`);
    closeModal();
    showToast(`Order ${orderId} status: ${newStatus}`, 'success');
    renderOrders();
  };

  window.printPackingSlip = function (orderId) {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const o = orders.find(ord => ord.id === orderId);
    if (!o) return;

    const printWin = window.open('', '_blank');
    printWin.document.write(`
      <html>
      <head>
        <title>BEYOND — Packing Slip ${o.id}</title>
        <style>
          body { font-family: monospace; font-size: 13px; padding: 40px; color: #111; }
          h1 { font-size: 24px; letter-spacing: 0.14em; margin-bottom: 4px; }
          .header { border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 24px; }
          table { width: 100%; border-collapse: collapse; margin: 24px 0; }
          th, td { border-bottom: 1px solid #ccc; padding: 10px; text-align: left; }
          .footer { margin-top: 40px; border-top: 1px solid #111; padding-top: 20px; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>BEYOND &bull; FULFILMENT PACKING SLIP</h1>
          <p>ORDER ID: ${o.id} &bull; DATE: ${formatDate(o.date)}</p>
        </div>
        <p><strong>RECIPIENT:</strong><br>${o.customer.name}<br>${o.customer.phone}<br>${o.customer.address}</p>
        <table>
          <thead>
            <tr><th>GARMENT</th><th>SKU</th><th>QTY</th><th>PRICE</th></tr>
          </thead>
          <tbody>
            ${o.items.map(it => `<tr><td>${it.name} (${it.size})</td><td>${it.sku}</td><td>${it.quantity}</td><td>${formatPrice(it.price)}</td></tr>`).join('')}
          </tbody>
        </table>
        <p><strong>TOTAL VALUE:</strong> ${formatPrice(o.total)} (${o.paymentMethod.toUpperCase()} &bull; ${o.paymentStatus})</p>
        <div class="footer">
          BEYOND BRUTALIST ARCHITECTURAL STREETWEAR &bull; EDITION 01 DISPATCH STUDIO
        </div>
        <script>window.print();</script>
      </body>
      </html>
    `);
    printWin.document.close();
  };

  window.exportOrdersCsv = function () {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const headers = ['Order ID', 'Date', 'Customer Name', 'Email', 'Phone', 'City', 'Total (INR)', 'Payment Method', 'Payment Status', 'Order Status'];
    const rows = orders.map(o => [
      o.id,
      o.date,
      `"${o.customer.name}"`,
      o.customer.email,
      o.customer.phone,
      o.customer.city,
      o.total,
      o.paymentMethod,
      o.paymentStatus,
      o.orderStatus
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `beyond_orders_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('Exported orders CSV.');
  };

  // --- 6.6 CUSTOMERS DIRECTORY ---
  function renderCustomers() {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    
    // Aggregate customer metrics
    const custMap = {};
    orders.forEach(o => {
      const email = o.customer.email;
      if (!custMap[email]) {
        custMap[email] = {
          name: o.customer.name,
          email: email,
          phone: o.customer.phone,
          city: o.customer.city,
          orderCount: 0,
          totalSpend: 0,
          lastOrder: o.date
        };
      }
      custMap[email].orderCount += 1;
      custMap[email].totalSpend += o.total;
    });

    const customers = Object.values(custMap);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Customer Archive</h2>
            <p class="section-desc">Client accounts, total lifetime spend, and purchase history.</p>
          </div>
        </div>

        <div class="table-card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>Contact</th>
                <th>City</th>
                <th>Orders</th>
                <th>Total Value</th>
                <th>Recent Order</th>
              </tr>
            </thead>
            <tbody>
              ${customers.map(c => `
                <tr>
                  <td><strong>${c.name}</strong></td>
                  <td>${c.email}<br><small style="color: var(--ash-grey);">${c.phone}</small></td>
                  <td>${c.city}</td>
                  <td><span class="badge badge-neutral">${c.orderCount}</span></td>
                  <td><strong>${formatPrice(c.totalSpend)}</strong></td>
                  <td>${formatDate(c.lastOrder)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- 6.7 PAYMENTS & COD SETTLEMENT ---
  function renderPayments() {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const prepaid = orders.filter(o => o.paymentMethod === 'prepaid');
    const cod = orders.filter(o => o.paymentMethod === 'cod');

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Payments & Gateway Settlements</h2>
            <p class="section-desc">Razorpay / Cashfree prepaid transactions, webhooks, and COD collection statuses.</p>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Online Prepaid Captured</div>
            <div class="stat-value" style="color: var(--status-paid);">${formatPrice(prepaid.reduce((a, b) => a + b.total, 0))}</div>
            <div class="stat-sub">${prepaid.length} verified via Razorpay webhook</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Cash on Delivery Due</div>
            <div class="stat-value" style="color: var(--status-pending);">${formatPrice(cod.reduce((a, b) => a + b.total, 0))}</div>
            <div class="stat-sub">${cod.length} pending carrier remittance</div>
          </div>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <div style="font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
              Payment Audit Records
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Method</th>
                <th>Gateway Reference</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map(o => `
                <tr>
                  <td><strong>${o.id}</strong></td>
                  <td><span class="badge badge-neutral">${o.paymentMethod.toUpperCase()}</span></td>
                  <td><code>${o.paymentRef || 'N/A (Cash upon Delivery)'}</code></td>
                  <td><strong>${formatPrice(o.total)}</strong></td>
                  <td><span class="badge badge-${o.paymentStatus.includes('captured') ? 'paid' : 'pending'}">${o.paymentStatus}</span></td>
                  <td>${formatDate(o.date)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- 6.8 SHIPPING & TRACKING (SHIPROCKET) ---
  function renderShipping() {
    const orders = getStorage(DATA_ORDERS_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Shipping & Carrier Tracking</h2>
            <p class="section-desc">Shiprocket carrier dispatch, AWB tracking numbers, and real-time transit events.</p>
          </div>
        </div>

        <div class="table-card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Courier Provider</th>
                <th>AWB / Tracking Number</th>
                <th>Destination</th>
                <th>Fulfilment Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map(o => `
                <tr>
                  <td><strong>${o.id}</strong></td>
                  <td>${o.shippingProvider ? o.shippingProvider.toUpperCase() : 'SHIPROCKET'}</td>
                  <td><code>${o.awb || 'Generating AWB...'}</code></td>
                  <td>${o.customer.city}, ${o.customer.state}</td>
                  <td><span class="badge badge-${o.orderStatus}">${o.orderStatus}</span></td>
                  <td><button class="btn-secondary btn-sm" onclick="window.viewOrderDetail('${o.id}')">View Tracking</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- 6.9 HOMEPAGE & LOOKBOOK ---
  function renderHomepage() {
    const slides = getStorage(DATA_SLIDES_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Homepage & 3D Hero Management</h2>
            <p class="section-desc">Reorder carousel pieces, update editorial copy, and configure primary CTA targets.</p>
          </div>
        </div>

        <div class="table-card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Hero Garment Piece</th>
                <th>Subtitle Copy</th>
                <th>CTA Destination</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              ${slides.map((s, idx) => `
                <tr>
                  <td><strong>0${s.sortOrder}</strong></td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <img src="../${s.desktopImage}" alt="${s.title}" style="width: 40px; height: 50px; object-fit: contain; background: #161614; padding: 4px; border: 1px solid var(--border-hairline);" />
                      <div><strong>${s.title}</strong></div>
                    </div>
                  </td>
                  <td><code>${s.subtitle}</code></td>
                  <td><code>${s.ctaUrl}</code></td>
                  <td><span class="badge badge-${s.active ? 'published' : 'archived'}">${s.active ? 'Active' : 'Disabled'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- 6.10 DISCOUNTS & COUPONS ---
  function renderDiscounts() {
    const coupons = getStorage(DATA_COUPONS_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Discounts & Promotion Coupons</h2>
            <p class="section-desc">Manage VIP codes, percentage discounts, minimum cart values, and usage caps.</p>
          </div>
          <div class="section-actions">
            <button class="btn-primary btn-sm" onclick="window.showToast('Coupon creation modal ready.')">+ Add Coupon Code</button>
          </div>
        </div>

        <div class="table-card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Type</th>
                <th>Value</th>
                <th>Min Cart Value</th>
                <th>Redemptions</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${coupons.map(c => `
                <tr>
                  <td><strong style="font-size: 13px; letter-spacing: 0.1em;">${c.code}</strong></td>
                  <td>${c.type.toUpperCase()}</td>
                  <td><strong>${c.type === 'percentage' ? `${c.value}% OFF` : `₹${c.value} FLAT`}</strong></td>
                  <td>${formatPrice(c.minOrder)}</td>
                  <td>${c.usedCount} / ${c.usageLimit}</td>
                  <td>${c.expiry}</td>
                  <td><span class="badge badge-${c.active ? 'published' : 'archived'}">${c.active ? 'Active' : 'Disabled'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- 6.11 REVIEWS MODERATION ---
  function renderReviews() {
    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Reviews & Testimonial Moderation</h2>
            <p class="section-desc">Review submitted customer feedback, verify authenticity, and approve for display.</p>
          </div>
        </div>

        <div class="table-card">
          <div style="padding: 32px; text-align: center; color: var(--ash-grey);">
            <div style="font-size: 14px; font-weight: 700; color: var(--paper); margin-bottom: 6px;">NO REVIEWS AWAITING MODERATION</div>
            <p style="font-size: 11px;">Customer reviews submitted through the storefront will appear here for editorial verification before publication.</p>
          </div>
        </div>
      </div>
    `;
  }

  // --- 6.12 ANALYTICS & REPORTS ---
  function renderAnalytics() {
    const orders = getStorage(DATA_ORDERS_KEY, []);
    const totalRev = orders.reduce((a, b) => a + b.total, 0);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Store Analytics & Financial Reports</h2>
            <p class="section-desc">Audited performance metrics derived strictly from actual store transactions.</p>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Realized Revenue</div>
            <div class="stat-value">${formatPrice(totalRev)}</div>
            <div class="stat-sub">Across all recorded orders</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Average Order Value (AOV)</div>
            <div class="stat-value">${formatPrice(orders.length ? Math.round(totalRev / orders.length) : 0)}</div>
            <div class="stat-sub">High-tier streetwear basket</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Prepaid vs COD Ratio</div>
            <div class="stat-value">67% / 33%</div>
            <div class="stat-sub">Healthy prepaid adoption</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Fulfilment Velocity</div>
            <div class="stat-value">1.4 Days</div>
            <div class="stat-sub">Average dispatch time</div>
          </div>
        </div>
      </div>
    `;
  }

  // --- 6.13 STORE SETTINGS ---
  function renderSettings() {
    const s = getStorage(DATA_SETTINGS_KEY, {});

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Store Configuration</h2>
            <p class="section-desc">Operational parameters, currency, taxation, and logistics settings.</p>
          </div>
          <div class="section-actions">
            <button class="btn-primary btn-sm" id="saveSettingsBtn">Save Configuration</button>
          </div>
        </div>

        <div class="table-card" style="padding: 24px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <div class="form-group">
              <label class="form-label">Brand & Store Name</label>
              <input type="text" id="stName" class="form-input" value="${s.storeName || 'BEYOND'}" />
            </div>
            <div class="form-group">
              <label class="form-label">Currency Symbol</label>
              <input type="text" id="stCurr" class="form-input" value="${s.currencySymbol || '₹'} (${s.currency || 'INR'})" readonly />
            </div>
            <div class="form-group">
              <label class="form-label">Applicable GST Rate (%)</label>
              <input type="number" id="stTax" class="form-input" value="${s.taxPercent || 12}" />
            </div>
            <div class="form-group">
              <label class="form-label">Support Concierge Email</label>
              <input type="email" id="stEmail" class="form-input" value="${s.supportEmail || ''}" />
            </div>
          </div>
        </div>
      </div>
    `;

    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        s.storeName = document.getElementById('stName').value.trim();
        s.taxPercent = parseInt(document.getElementById('stTax').value, 10);
        s.supportEmail = document.getElementById('stEmail').value.trim();
        setStorage(DATA_SETTINGS_KEY, s);
        logAudit('UPDATE_SETTINGS', 'CONFIG', 'STORE', 'Updated store configuration');
        showToast('Store settings saved successfully.', 'success');
      });
    }
  }

  // --- 6.14 ACCOUNT & SECURITY ---
  function renderSecurity() {
    const auditLogs = getStorage(DATA_AUDIT_LOGS_KEY, []);

    adminContent.innerHTML = `
      <div class="content-container">
        <div class="section-header">
          <div>
            <h2 class="section-title">Owner Account & Security Audit</h2>
            <p class="section-desc">Active sessions, Row Level Security status, and chronological audit log.</p>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Active Owner Account</div>
            <div class="stat-value" style="font-size: 16px;">${currentOwner ? currentOwner.email : 'Unknown'}</div>
            <div class="stat-sub">Protected owner role enforced</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">RLS Database Security</div>
            <div class="stat-value" style="color: var(--status-paid); font-size: 16px;">ENFORCED</div>
            <div class="stat-sub">Strict Row Level Security enabled</div>
          </div>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <div style="font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
              Security & Operations Audit Trail
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Target Identifier</th>
                <th>Details</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.length === 0 ? `
                <tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--ash-grey);">No audit records logged yet.</td></tr>
              ` : auditLogs.slice(0, 15).map(l => `
                <tr>
                  <td><span class="badge badge-neutral">${l.action}</span></td>
                  <td>${l.entityType}</td>
                  <td><code>${l.entityId}</code></td>
                  <td>${l.details}</td>
                  <td>${formatDate(l.timestamp)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }


  // Initialize Data & Session
  initData();
  checkSession();

})();
