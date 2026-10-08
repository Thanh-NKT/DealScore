-- Final roadmap review Minor 7: the 0062 list missed top-level routes that predate the roadmap (compare, radar,
-- trending, wishlist, extension) and the legacy first segments next.config.ts redirects (dang-nhap, huy-dang-ky).
-- A category with one of those slugs would be unreachable and skipped by the slug-redirect proxy.
-- tests/lib/product/reserved-category-slugs.test.ts keeps this list ⊇ src/app top-level dirs ∪
-- RESERVED_FIRST_SEGMENTS (src/lib/product/slug-redirect-proxy.ts). 0062 list + the 7 new slugs.
-- Fails loudly (with the slug) if a category already uses one, instead of a bare constraint error.
do $$
declare v_slug text;
begin
  select slug into v_slug from public.categories
  where slug in ('compare','radar','trending','wishlist','extension','dang-nhap','huy-dang-ky') limit 1;
  if v_slug is not null then
    raise exception 'category slug "%" collides with a reserved route; rename the category first', v_slug;
  end if;
end $$;
alter table public.categories drop constraint if exists categories_slug_reserved;
alter table public.categories add constraint categories_slug_reserved check (
  slug not in ('tim-kiem','brand','danh-muc','go','api','share-target','admin','auth','watch',
               'tai-khoan','account','login','register','search','privacy','terms','unsubscribe',
               'forgot-password','reset-password','sitemap.xml','robots.txt',
               'shared','seller','deal-score',
               'compare','radar','trending','wishlist','extension','dang-nhap','huy-dang-ky')
);
