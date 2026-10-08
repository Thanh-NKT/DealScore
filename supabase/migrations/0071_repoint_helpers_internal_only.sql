-- Final roadmap review Minor 5: admin_repoint_watches / admin_repoint_variant_watches move watches but write no
-- admin_audit row of their own. Every legitimate call happens inside an audited SECURITY DEFINER RPC
-- (admin_merge_products 0050, admin_move_offer / admin_review_match 0022), which runs as the function owner, so
-- service_role does not need EXECUTE. Same treatment as the admin_check_* helpers: revoked from every API role.
-- No body change. tests/db/privileges.test.ts (INTERNAL_HELPERS) asserts service_role is refused.
revoke execute on function public.admin_repoint_variant_watches(uuid[], uuid),
                           public.admin_repoint_watches(uuid, uuid)
  from public, anon, authenticated, service_role;
