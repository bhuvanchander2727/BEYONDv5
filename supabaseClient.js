/**
 * BEYOND E-COMMERCE — Unified Supabase Client Module
 *
 * Configured dynamically using public environment variables.
 * Credential sources (in order of priority):
 * 1. window.VITE_SUPABASE_URL & window.VITE_SUPABASE_PUBLISHABLE_KEY
 * 2. window.ENV_SUPABASE_URL & window.ENV_SUPABASE_ANON_KEY (from config.js)
 * 3. Dynamic runtime fetch of .env.local (in dev server environments)
 *
 * Row Level Security (RLS) guarantees data isolation.
 * No secret keys (SERVICE_ROLE_KEY) are ever loaded into client JavaScript.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BeyondSupabase = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let _clientInstance = null;
  let _initPromise = null;

  /**
   * Resolve environment variables safely from all supported browser and bundler environments.
   */
  function getCredentials() {
    let url = '';
    let key = '';

    // 1. Check window-level globals (from config.js or Vite HTML injection)
    if (typeof window !== 'undefined') {
      url = window.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || '';
      key = window.VITE_SUPABASE_PUBLISHABLE_KEY || window.ENV_SUPABASE_ANON_KEY || window.VITE_SUPABASE_ANON_KEY || '';
    }

    // 2. Check process.env (Node / SSR / test runners)
    try {
      if (typeof process !== 'undefined' && process.env) {
        url = url || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
        key = key || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
      }
    } catch (_) {}

    return { url: url.trim(), key: key.trim() };
  }

  /**
   * Attempt to load credentials asynchronously by reading .env.local if not already in window
   */
  async function resolveCredentialsAsync() {
    let creds = getCredentials();
    if (creds.url && creds.key) return creds;

    if (typeof window !== 'undefined' && window.fetch) {
      try {
        const res = await fetch('/.env.local');
        if (res.ok) {
          const text = await res.text();
          const urlMatch = text.match(/^(?:VITE_SUPABASE_URL|SUPABASE_URL)\s*=\s*(.*)$/m);
          const keyMatch = text.match(/^(?:VITE_SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON_KEY|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*)$/m);
          if (urlMatch && urlMatch[1]) creds.url = urlMatch[1].trim();
          if (keyMatch && keyMatch[1]) creds.key = keyMatch[1].trim();

          if (creds.url && creds.key) {
            window.VITE_SUPABASE_URL = creds.url;
            window.VITE_SUPABASE_PUBLISHABLE_KEY = creds.key;
            window.ENV_SUPABASE_URL = creds.url;
            window.ENV_SUPABASE_ANON_KEY = creds.key;
          }
        }
      } catch (_) {}
    }

    return creds;
  }

  /**
   * Initialize or retrieve the single Supabase client instance
   */
  async function initClient() {
    if (_clientInstance) return _clientInstance;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      const creds = await resolveCredentialsAsync();

      if (!creds.url || !creds.key) {
        console.warn('[BEYOND:Supabase] Supabase credentials (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) not found. Running in offline/fallback mode.');
        return null;
      }

      // Ensure Supabase JS library is present
      const supabaseLib = (typeof window !== 'undefined' && window.supabase)
        ? window.supabase
        : (typeof require === 'function' ? require('@supabase/supabase-js') : null);

      if (!supabaseLib || typeof supabaseLib.createClient !== 'function') {
        console.warn('[BEYOND:Supabase] @supabase/supabase-js library is not loaded on window.');
        return null;
      }

      try {
        _clientInstance = supabaseLib.createClient(creds.url, creds.key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'beyond_customer_auth_v1'
          }
        });
        console.info('[BEYOND:Supabase] Supabase client initialized successfully:', creds.url);
        return _clientInstance;
      } catch (err) {
        console.error('[BEYOND:Supabase] Failed to initialize client:', err);
        return null;
      }
    })();

    return _initPromise;
  }

  /**
   * Synchronous getter for the client instance (returns null if not yet initialized)
   */
  function getClient() {
    if (_clientInstance) return _clientInstance;
    const creds = getCredentials();
    const supabaseLib = (typeof window !== 'undefined' && window.supabase)
      ? window.supabase
      : (typeof require === 'function' ? require('@supabase/supabase-js') : null);

    if (creds.url && creds.key && supabaseLib && typeof supabaseLib.createClient === 'function') {
      try {
        _clientInstance = supabaseLib.createClient(creds.url, creds.key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'beyond_customer_auth_v1'
          }
        });
        return _clientInstance;
      } catch (e) {
        console.warn('[BEYOND:Supabase] Synchronous createClient failed:', e);
      }
    }
    return null;
  }

  /**
   * Health-check verification of Supabase connectivity
   */
  async function verifyConnection() {
    const start = Date.now();
    const client = await initClient();
    if (!client) {
      return {
        success: false,
        error: 'Client could not be initialized. Missing credentials or @supabase/supabase-js library.'
      };
    }

    try {
      // Query published products with a limit of 1 to verify read capability
      const { data, error, status } = await client
        .from('products')
        .select('id, name, status')
        .limit(1);

      const latencyMs = Date.now() - start;

      if (error) {
        return {
          success: false,
          status,
          latencyMs,
          error: error.message,
          code: error.code,
          details: error.details
        };
      }

      return {
        success: true,
        status,
        latencyMs,
        rowsReturned: (data || []).length,
        url: getCredentials().url
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: err.message || String(err)
      };
    }
  }

  /**
   * Fetch all active products from Supabase with their variants and images.
   * Maps relational tables back to the exact product schema required by BEYOND.
   */
  async function fetchProducts() {
    const client = await initClient();
    if (!client) return null;

    try {
      // 1. Fetch published products
      const { data: productsData, error: prodErr } = await client
        .from('products')
        .select(`
          id,
          name,
          slug,
          category_id,
          regular_price,
          sale_price,
          price_formatted,
          description,
          material,
          fit_notes,
          status,
          featured,
          badge,
          sort_order
        `)
        .eq('status', 'published')
        .order('sort_order', { ascending: true });

      if (prodErr) {
        console.warn('[BEYOND:Supabase] Error querying products table:', prodErr);
        return null;
      }

      if (!productsData || productsData.length === 0) {
        console.warn('[BEYOND:Supabase] Supabase products query returned 0 rows (check RLS policies or run 002_rls_policies.sql).');
        return null;
      }

      // 2. Fetch variants & images for these products
      const productIds = productsData.map(p => p.id);

      const [variantsRes, imagesRes] = await Promise.all([
        client
          .from('product_variants')
          .select('product_id, size, sku, stock_quantity, is_active')
          .in('product_id', productIds)
          .eq('is_active', true),
        client
          .from('product_images')
          .select('product_id, image_url, alt_text, is_primary, sort_order')
          .in('product_id', productIds)
          .order('sort_order', { ascending: true })
      ]);

      const variantsByProduct = {};
      if (variantsRes.data) {
        variantsRes.data.forEach(v => {
          if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
          variantsByProduct[v.product_id].push({
            size: v.size,
            stock: v.stock_quantity || 0,
            sku: v.sku
          });
        });
      }

      const imagesByProduct = {};
      if (imagesRes.data) {
        imagesRes.data.forEach(img => {
          if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
          imagesByProduct[img.product_id].push(img.image_url);
        });
      }

      // 3. Assemble complete normalized product objects
      const normalized = productsData.map(p => {
        const sizes = variantsByProduct[p.id] || [];
        const rawImages = imagesByProduct[p.id] || [];
        const images = rawImages.map(img => {
          if (typeof img === 'string' && img.startsWith('assets/products/') && img.endsWith('.png')) {
            return img.replace(/\.png$/, '.webp');
          }
          return img;
        });

        return {
          id: p.id,
          name: p.name,
          category: p.category_id || 'tops',
          price: Number(p.regular_price),
          salePrice: p.sale_price ? Number(p.sale_price) : null,
          priceFormatted: p.price_formatted || ('₹' + Number(p.regular_price).toLocaleString('en-IN')),
          description: p.description,
          material: p.material || '',
          fitNotes: p.fit_notes || '',
          sizes: sizes,
          images: images.length > 0 ? images : ['assets/products/moto-jacket.webp'],
          featured: !!p.featured,
          badge: p.badge || null,
          source: 'supabase'
        };
      });

      console.info(`[BEYOND:Supabase] Successfully loaded ${normalized.length} products from Supabase.`);
      return normalized;
    } catch (err) {
      console.error('[BEYOND:Supabase] Failed to fetch products:', err);
      return null;
    }
  }

  /**
   * Customer Authentication Methods
   */
  async function getCurrentUser() {
    const client = await initClient();
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    return session ? session.user : null;
  }

  async function signUp(email, password, fullName) {
    const client = await initClient();
    if (!client) throw new Error('Supabase client unavailable');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' }
      }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const client = await initClient();
    if (!client) throw new Error('Supabase client unavailable');
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const client = await initClient();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  /**
   * Customer Data Isolation Helpers (Scoped strictly to authenticated user's ID)
   */
  async function getCustomerOrders(userId) {
    const client = await initClient();
    if (!client || !userId) return [];
    const { data, error } = await client
      .from('orders')
      .select('*, order_items(*)')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function getCustomerAddresses(userId) {
    const client = await initClient();
    if (!client || !userId) return [];
    const { data, error } = await client
      .from('customer_addresses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function getCustomerProfile(userId) {
    const client = await initClient();
    if (!client || !userId) return null;
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  // Public API surface
  return {
    initClient,
    getClient,
    verifyConnection,
    fetchProducts,
    getCredentials,
    auth: {
      getCurrentUser,
      signUp,
      signIn,
      signOut
    },
    customer: {
      getOrders: getCustomerOrders,
      getAddresses: getCustomerAddresses,
      getProfile: getCustomerProfile
    }
  };
});
