-- ==============================================================================
-- BEYOND E-COMMERCE DATABASE SCHEMA (PostgreSQL / Supabase)
-- Migration 002: Row Level Security (RLS) & Access Control Policies (Final Hardened)
--
-- ARCHITECTURAL SECURITY PRINCIPLES:
-- 1. SCOPED IDEMPOTENCY: Purge block drops ONLY known policies belonging to
--    Migration 002 and its predecessor iterations. It NEVER removes policies
--    belonging to unrelated features, extensions, or third-party plugins.
-- 2. ZERO SEARCH-PATH INJECTION: All SECURITY DEFINER functions enforce
--    SET search_path = '' and fully qualify all schema objects (public., auth.,
--    pg_catalog.). Standard SQL keywords (COALESCE, GREATEST, LEAST) are unqualified.
-- 3. LEAST PRIVILEGE TABLE & COLUMN GRANTS:
--    - Inherited PUBLIC permissions revoked across all 23 application tables.
--    - Anonymous visitors (anon) receive SELECT only on public catalog tables.
--    - Authenticated users receive column-restricted UPDATE on profiles (full_name, phone).
--    - Direct client-side INSERT/UPDATE on orders, order_items, inventory, and
--      user_roles is disallowed. Order placement must occur server-side.
-- 4. TRUSTED CHECKOUT ARCHITECTURE:
--    - validate_coupon() is an advisory preview helper for the storefront UI only.
--    - The trusted checkout backend (serverless function using SUPABASE_SERVICE_ROLE_KEY)
--      must independently recalculate prices, validate coupon eligibility, and apply
--      usage limits atomically in a transaction using SELECT ... FOR UPDATE.
-- 5. VERIFIED PURCHASE REVIEWS:
--    - Reviews INSERT requires authenticated caller matching JWT email and verified
--      order containing the product with 'delivered' status. Status defaults to 'pending'.
-- 6. FIRST-OWNER BOOTSTRAP:
--    - Client self-promotion is blocked by RLS. The first store owner is bootstrapped
--      strictly out-of-band via Supabase SQL Editor.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SECURITY DEFINER HELPER FUNCTIONS (Zero Search Path & Qualified Names)
-- ------------------------------------------------------------------------------

-- Helper: Check if calling user holds the 'owner' role in public.user_roles
CREATE OR REPLACE FUNCTION public.is_store_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role = 'owner'::public.user_role_type
  );
$$;

-- Helper: Check if calling user holds 'owner', 'admin', or 'staff' role
CREATE OR REPLACE FUNCTION public.is_store_staff()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role IN (
        'owner'::public.user_role_type,
        'admin'::public.user_role_type,
        'staff'::public.user_role_type
      )
  );
$$;

-- Revoke default PUBLIC execution privileges and grant only to necessary roles
REVOKE ALL ON FUNCTION public.is_store_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_store_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_store_owner() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_store_staff() TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 2. PUBLIC RPC ACCESSORS & TRIGGER FUNCTIONS
-- ------------------------------------------------------------------------------

-- Safe Public Settings: Returns only explicitly public branding & store configuration
-- Note: COALESCE is standard SQL syntax and does not take schema qualification
CREATE OR REPLACE FUNCTION public.get_public_store_settings()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(key, value),
    '{}'::jsonb
  )
  FROM public.store_settings
  WHERE key IN (
    'store_name',
    'brand_name',
    'currency',
    'currency_symbol',
    'contact_email',
    'support_phone',
    'announcement_banner',
    'shipping_policy_summary',
    'return_policy_days',
    'free_shipping_threshold',
    'cod_enabled'
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_store_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_store_settings() TO authenticated, anon;

-- Secure Coupon Validation: Checks code without exposing table of private codes
-- ARCHITECTURAL NOTICE:
-- validate_coupon() is an advisory display helper for UI preview only.
-- The trusted checkout backend (serverless function using SUPABASE_SERVICE_ROLE_KEY)
-- must independently verify item prices, recalculate discounts, and atomically
-- increment used_count in a database transaction with row-level locks (FOR UPDATE).
-- Note: GREATEST, LEAST, and COALESCE are SQL keywords and do not take schema qualification.
CREATE OR REPLACE FUNCTION public.validate_coupon(
  p_code TEXT,
  p_subtotal NUMERIC DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_coupon RECORD;
  v_discount NUMERIC(10, 2) := 0.00;
  v_subtotal NUMERIC(10, 2);
  v_now TIMESTAMPTZ;
BEGIN
  IF p_code IS NULL OR pg_catalog.btrim(p_code) = '' THEN
    RETURN pg_catalog.jsonb_build_object('is_valid', false, 'message', 'Please enter a coupon code.');
  END IF;

  -- Sanitize untrusted subtotal: ensure non-negative numeric (keywords: GREATEST, COALESCE)
  v_subtotal := GREATEST(0.00, COALESCE(p_subtotal, 0.00));
  v_now := pg_catalog.now();

  SELECT * INTO v_coupon
  FROM public.coupons
  WHERE pg_catalog.upper(code) = pg_catalog.upper(pg_catalog.btrim(p_code))
    AND is_active = true
    AND start_date <= v_now
    AND (expiry_date IS NULL OR expiry_date >= v_now);

  IF NOT FOUND THEN
    -- Generic response prevents enumeration of existing vs expired promo codes
    RETURN pg_catalog.jsonb_build_object('is_valid', false, 'message', 'Invalid or expired promotional code.');
  END IF;

  IF v_coupon.usage_limit IS NOT NULL AND v_coupon.used_count >= v_coupon.usage_limit THEN
    RETURN pg_catalog.jsonb_build_object('is_valid', false, 'message', 'This promotional code has reached its maximum usage limit.');
  END IF;

  IF v_subtotal < v_coupon.min_order_value THEN
    RETURN pg_catalog.jsonb_build_object(
      'is_valid', false,
      'message', pg_catalog.format('Minimum order subtotal of ₹%s required for this coupon.', v_coupon.min_order_value)
    );
  END IF;

  IF v_coupon.discount_type = 'percentage' THEN
    v_discount := pg_catalog.round((v_subtotal * (v_coupon.discount_value / 100.0)), 2);
    IF v_coupon.max_discount_value IS NOT NULL AND v_discount > v_coupon.max_discount_value THEN
      v_discount := v_coupon.max_discount_value;
    END IF;
    -- Discount cannot exceed subtotal
    v_discount := LEAST(v_discount, v_subtotal);
  ELSE
    -- Fixed discount cannot exceed subtotal (keyword: LEAST)
    v_discount := LEAST(v_coupon.discount_value, v_subtotal);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'is_valid', true,
    'code', v_coupon.code,
    'discount_type', v_coupon.discount_type,
    'discount_value', v_coupon.discount_value,
    'calculated_discount', v_discount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_coupon(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, NUMERIC) TO authenticated, anon;

-- Server-side trigger function for profile updated_at
CREATE OR REPLACE FUNCTION public.handle_profile_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
 NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_profile_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_profile_updated_at();

-- Harden automatic profile creation trigger from Migration 001
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
    updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- ------------------------------------------------------------------------------
-- 3. ENABLE ROW LEVEL SECURITY ON ALL 23 APPLICATION TABLES
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homepage_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4. SCOPED IDEMPOTENT POLICY PURGE
-- Drops ONLY known policies belonging to Migration 002 (and predecessor drafts).
-- Unrelated policies belonging to other extensions or integrations are preserved.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
  known_policies TEXT[] := ARRAY[
    'profiles_select_own_or_staff', 'profiles_insert_own', 'profiles_update_own',
    'profiles_read_own', 'profiles_update_own_fields',
    'user_roles_select_owner_or_self', 'user_roles_insert_owner_only', 'user_roles_update_owner_only', 'user_roles_delete_owner_only',
    'categories_select_public_active', 'categories_all_staff',
    'collections_select_public_active', 'collections_all_staff',
    'products_select_published_or_staff', 'products_all_staff',
    'product_images_select_published', 'product_images_all_staff',
    'product_variants_select_published_active', 'product_variants_all_staff',
    'product_collections_select_published', 'product_collections_all_staff',
    'inventory_logs_select_staff', 'inventory_logs_insert_staff',
    'customer_addresses_select_own', 'customer_addresses_insert_own', 'customer_addresses_update_own', 'customer_addresses_delete_own',
    'orders_select_own_or_staff', 'orders_all_staff',
    'order_items_select_own_or_staff', 'order_items_all_staff',
    'order_timeline_select_own_or_staff', 'order_timeline_all_staff',
    'payment_records_all_staff',
    'refund_records_select_own', 'refund_records_all_staff',
    'shipments_select_own_or_staff', 'shipments_all_staff',
    'tracking_events_select_own_or_staff', 'tracking_events_all_staff', 'tracking_events_select_public',
    'coupons_all_staff', 'coupons_select_active_public', 'coupon_redemptions_select_own_or_staff', 'coupon_redemptions_all_staff',
    'reviews_select_approved_or_staff', 'reviews_insert_authenticated_pending', 'reviews_insert_authenticated', 'reviews_all_staff',
    'homepage_slides_select_public_active', 'homepage_slides_all_staff',
    'store_settings_select_safe_public', 'store_settings_all_owner', 'store_settings_select_public_safe',
    'audit_logs_select_owner_only', 'audit_logs_insert_staff'
  ];
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = ANY(known_policies)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 5. REVOKE INHERITED PRIVILEGES & ESTABLISH EXPLICIT TABLE & COLUMN GRANTS
-- ------------------------------------------------------------------------------
-- In PostgreSQL, tables inherit default permissions from PUBLIC. Revoke all
-- privileges on the 23 application tables to enforce strict least-privilege.
REVOKE ALL ON TABLE
  public.profiles,
  public.user_roles,
  public.categories,
  public.collections,
  public.products,
  public.product_images,
  public.product_variants,
  public.product_collections,
  public.inventory_logs,
  public.customer_addresses,
  public.orders,
  public.order_items,
  public.order_timeline,
  public.payment_records,
  public.refund_records,
  public.shipments,
  public.tracking_events,
  public.coupons,
  public.coupon_redemptions,
  public.reviews,
  public.homepage_slides,
  public.store_settings,
  public.audit_logs
FROM PUBLIC, anon, authenticated;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ANON (Public Visitors):
-- SELECT only on public storefront tables; direct access to private tables is fully revoked
GRANT SELECT ON TABLE
  public.categories,
  public.collections,
  public.products,
  public.product_images,
  public.product_variants,
  public.product_collections,
  public.homepage_slides,
  public.reviews,
  public.store_settings
TO anon;

-- AUTHENTICATED (Signed-in Customers & Store Staff):
-- 1. Catalog & Content: SELECT for all customers; mutation for staff (enforced via RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.categories,
  public.collections,
  public.products,
  public.product_images,
  public.product_variants,
  public.product_collections,
  public.homepage_slides,
  public.store_settings
TO authenticated;

-- 2. Profiles (Column-level grants):
-- SELECT granted for viewing own profile or staff viewing customers
GRANT SELECT ON TABLE public.profiles TO authenticated;
-- Authenticated users can only INSERT their own approved profile fields
GRANT INSERT (id, email, full_name, phone) ON TABLE public.profiles TO authenticated;
-- Authenticated users can only UPDATE display name and phone (updated_at managed by trigger)
GRANT UPDATE (full_name, phone) ON TABLE public.profiles TO authenticated;

-- 3. Customer Addresses:
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_addresses TO authenticated;

-- 4. Reviews:
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reviews TO authenticated;

-- 5. Orders & Logistics:
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.orders,
  public.order_items,
  public.order_timeline,
  public.shipments,
  public.tracking_events,
  public.refund_records,
  public.coupon_redemptions
TO authenticated;

-- 6. Sensitive Financial, Inventory & Administrative Tables:
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.user_roles,
  public.payment_records,
  public.coupons
TO authenticated;

GRANT SELECT, INSERT ON TABLE
  public.inventory_logs,
  public.audit_logs
TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. PROFILES (Customers manage own profile; staff view all for support)
-- ------------------------------------------------------------------------------
CREATE POLICY "profiles_select_own_or_staff"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_store_staff());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (
    auth.uid() = id
    AND LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "profiles_update_own"
ON public.profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 7. USER ROLES (Owner-only mutation; users may read own assigned role)
-- ------------------------------------------------------------------------------
CREATE POLICY "user_roles_select_owner_or_self"
  ON public.user_roles FOR SELECT
  USING (public.is_store_owner() OR auth.uid() = user_id);

CREATE POLICY "user_roles_insert_owner_only"
  ON public.user_roles FOR INSERT
  WITH CHECK (public.is_store_owner());

CREATE POLICY "user_roles_update_owner_only"
  ON public.user_roles FOR UPDATE
  USING (public.is_store_owner())
  WITH CHECK (public.is_store_owner());

CREATE POLICY "user_roles_delete_owner_only"
  ON public.user_roles FOR DELETE
  USING (public.is_store_owner());

-- ------------------------------------------------------------------------------
-- 8. CATEGORIES & COLLECTIONS (Public read active; staff manage)
-- ------------------------------------------------------------------------------
CREATE POLICY "categories_select_public_active"
  ON public.categories FOR SELECT
  USING (is_active = true OR public.is_store_staff());

CREATE POLICY "categories_all_staff"
  ON public.categories FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

CREATE POLICY "collections_select_public_active"
  ON public.collections FOR SELECT
  USING (is_active = true OR public.is_store_staff());

CREATE POLICY "collections_all_staff"
  ON public.collections FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 9. PRODUCTS & CATALOG (Hardened against unreleased/draft piece leakage)
-- ------------------------------------------------------------------------------
CREATE POLICY "products_select_published_or_staff"
  ON public.products FOR SELECT
  USING (status = 'published'::public.product_status_type OR public.is_store_staff());

CREATE POLICY "products_all_staff"
  ON public.products FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Product images: only visible if parent product is published
CREATE POLICY "product_images_select_published"
  ON public.product_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_images.product_id
        AND (p.status = 'published'::public.product_status_type OR public.is_store_staff())
    )
  );

CREATE POLICY "product_images_all_staff"
  ON public.product_images FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Product variants: only active variants belonging to published pieces visible
CREATE POLICY "product_variants_select_published_active"
  ON public.product_variants FOR SELECT
  USING (
    (
      is_active = true
      AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_variants.product_id
          AND p.status = 'published'::public.product_status_type
      )
    )
    OR public.is_store_staff()
  );

CREATE POLICY "product_variants_all_staff"
  ON public.product_variants FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Product-collections map: only visible for published products
CREATE POLICY "product_collections_select_published"
  ON public.product_collections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_collections.product_id
        AND (p.status = 'published'::public.product_status_type OR public.is_store_staff())
    )
  );

CREATE POLICY "product_collections_all_staff"
  ON public.product_collections FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 10. INVENTORY LOGS (Append-only audit trail; staff read/insert; no updates/deletes)
-- ------------------------------------------------------------------------------
CREATE POLICY "inventory_logs_select_staff"
  ON public.inventory_logs FOR SELECT
  USING (public.is_store_staff());

CREATE POLICY "inventory_logs_insert_staff"
  ON public.inventory_logs FOR INSERT
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 11. CUSTOMER ADDRESSES (Customers manage only their own; staff view)
-- ------------------------------------------------------------------------------
CREATE POLICY "customer_addresses_select_own"
  ON public.customer_addresses FOR SELECT
  USING (auth.uid() = user_id OR public.is_store_staff());

CREATE POLICY "customer_addresses_insert_own"
  ON public.customer_addresses FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.is_store_staff());

CREATE POLICY "customer_addresses_update_own"
  ON public.customer_addresses FOR UPDATE
  USING (auth.uid() = user_id OR public.is_store_staff())
  WITH CHECK (auth.uid() = user_id OR public.is_store_staff());

CREATE POLICY "customer_addresses_delete_own"
  ON public.customer_addresses FOR DELETE
  USING (auth.uid() = user_id OR public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 12. ORDERS & ORDER ITEMS (Client-side inserts disallowed to prevent price tampering)
-- ------------------------------------------------------------------------------
CREATE POLICY "orders_select_own_or_staff"
  ON public.orders FOR SELECT
  USING (auth.uid() = customer_id OR public.is_store_staff());

CREATE POLICY "orders_all_staff"
  ON public.orders FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

CREATE POLICY "order_items_select_own_or_staff"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (o.customer_id = auth.uid() OR public.is_store_staff())
    )
  );

CREATE POLICY "order_items_all_staff"
  ON public.order_items FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Order timeline: customers view progress updates on their orders
CREATE POLICY "order_timeline_select_own_or_staff"
  ON public.order_timeline FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_timeline.order_id
        AND (o.customer_id = auth.uid() OR public.is_store_staff())
    )
  );

CREATE POLICY "order_timeline_all_staff"
  ON public.order_timeline FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 13. PAYMENTS, REFUNDS, SHIPMENTS & TRACKING
-- ------------------------------------------------------------------------------

-- Payment records: sensitive financial data; staff only
CREATE POLICY "payment_records_all_staff"
  ON public.payment_records FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Refund records: staff manage; customers view refunds on their own orders
CREATE POLICY "refund_records_select_own"
  ON public.refund_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = refund_records.order_id
        AND (o.customer_id = auth.uid() OR public.is_store_staff())
    )
  );

CREATE POLICY "refund_records_all_staff"
  ON public.refund_records FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Shipments: customers view shipment tracking details for their own order
CREATE POLICY "shipments_select_own_or_staff"
  ON public.shipments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = shipments.order_id
        AND (o.customer_id = auth.uid() OR public.is_store_staff())
    )
  );

CREATE POLICY "shipments_all_staff"
  ON public.shipments FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- Tracking events: ANONYMOUS ACCESS REMOVED.
-- Only accessible to customer of the related order or store staff
CREATE POLICY "tracking_events_select_own_or_staff"
  ON public.tracking_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.shipments s
      JOIN public.orders o ON o.id = s.order_id
      WHERE s.id = tracking_events.shipment_id
        AND (o.customer_id = auth.uid() OR public.is_store_staff())
    )
  );

CREATE POLICY "tracking_events_all_staff"
  ON public.tracking_events FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 14. COUPONS & DISCOUNTS (Staff manage; public uses validate_coupon RPC)
-- Direct SELECT by anonymous users is revoked to prevent coupon enumeration
-- ------------------------------------------------------------------------------
CREATE POLICY "coupons_all_staff"
  ON public.coupons FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

CREATE POLICY "coupon_redemptions_select_own_or_staff"
  ON public.coupon_redemptions FOR SELECT
  USING (auth.uid() = customer_id OR public.is_store_staff());

CREATE POLICY "coupon_redemptions_all_staff"
  ON public.coupon_redemptions FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 15. REVIEWS (Hardened Attribution & Verified Delivered Purchase Rule)
-- ------------------------------------------------------------------------------
CREATE POLICY "reviews_select_approved_or_staff"
  ON public.reviews FOR SELECT
  USING (status = 'approved' OR public.is_store_staff());

-- Reviews INSERT:
-- 1. Must be authenticated.
-- 2. status must be 'pending' (cannot self-approve).
-- 3. customer_email must match the authenticated caller's JWT email.
-- 4. Verified Purchase: caller must possess an order containing this product
--    with status 'delivered'::public.order_status_type.
CREATE POLICY "reviews_insert_authenticated_pending"
  ON public.reviews FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND status = 'pending'
    AND LOWER(customer_email) = LOWER(auth.jwt() ->> 'email')
    AND (
      public.is_store_staff()
      OR EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.order_items oi ON oi.order_id = o.id
        WHERE o.customer_id = auth.uid()
          AND oi.product_id = reviews.product_id
          AND o.order_status = 'delivered'::public.order_status_type
      )
    )
  );

CREATE POLICY "reviews_all_staff"
  ON public.reviews FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 16. HOMEPAGE SLIDES & LOOKBOOK
-- ------------------------------------------------------------------------------
CREATE POLICY "homepage_slides_select_public_active"
  ON public.homepage_slides FOR SELECT
  USING (is_active = true OR public.is_store_staff());

CREATE POLICY "homepage_slides_all_staff"
  ON public.homepage_slides FOR ALL
  USING (public.is_store_staff())
  WITH CHECK (public.is_store_staff());

-- ------------------------------------------------------------------------------
-- 17. STORE SETTINGS (Audited: Whitelisted Public Keys Only)
-- Sensitive internal settings (API secrets, webhook urls) are protected from public read
-- ------------------------------------------------------------------------------
CREATE POLICY "store_settings_select_safe_public"
  ON public.store_settings FOR SELECT
  USING (
    key IN (
      'store_name',
      'brand_name',
      'currency',
      'currency_symbol',
      'contact_email',
      'support_phone',
      'announcement_banner',
      'shipping_policy_summary',
      'return_policy_days',
      'free_shipping_threshold',
      'cod_enabled'
    )
    OR public.is_store_owner()
  );

CREATE POLICY "store_settings_all_owner"
  ON public.store_settings FOR ALL
  USING (public.is_store_owner())
  WITH CHECK (public.is_store_owner());

-- ------------------------------------------------------------------------------
-- 18. AUDIT LOGS (Immutable: Owner reads; staff insert operational records)
-- ------------------------------------------------------------------------------
CREATE POLICY "audit_logs_select_owner_only"
  ON public.audit_logs FOR SELECT
  USING (public.is_store_owner());

CREATE POLICY "audit_logs_insert_staff"
  ON public.audit_logs FOR INSERT
  WITH CHECK (public.is_store_staff());
