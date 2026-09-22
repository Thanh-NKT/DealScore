/**
 * Kiểu dữ liệu cho schema Supabase (khớp supabase/migrations/0001_init.sql và 0002_search_rollup_categories.sql).
 */

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Timestamp = string;
type UUID = string;

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: {
          id: UUID;
          slug: string;
          name: string;
          parent_id: UUID | null;
          sort_order: number;
        };
        Insert: {
          id?: UUID;
          slug: string;
          name: string;
          parent_id?: UUID | null;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: UUID;
          slug: string | null;
          canonical_name: string;
          brand: string | null;
          model: string | null;
          category_id: UUID | null;
          gtin: string | null;
          image: string | null;
          specs: Json;
          status: "draft" | "verified";
          search_text: string | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          slug?: string | null;
          canonical_name: string;
          brand?: string | null;
          model?: string | null;
          category_id?: UUID | null;
          gtin?: string | null;
          image?: string | null;
          specs?: Json;
          status?: "draft" | "verified";
          search_text?: string | null;
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      product_variants: {
        Row: {
          id: UUID;
          product_id: UUID;
          variant_key: string;
          specs: Json;
        };
        Insert: {
          id?: UUID;
          product_id: UUID;
          variant_key: string;
          specs?: Json;
        };
        Update: Partial<
          Database["public"]["Tables"]["product_variants"]["Insert"]
        >;
        Relationships: [];
      };
      variant_current_price: {
        Row: {
          variant_id: UUID;
          best_offer_id: UUID | null;
          price: number | null;
          original_price: number | null;
          is_flash_sale: boolean;
          in_stock: boolean;
          offer_count: number;
          observed_at: Timestamp;
        };
        Insert: {
          variant_id: UUID;
          best_offer_id?: UUID | null;
          price?: number | null;
          original_price?: number | null;
          is_flash_sale?: boolean;
          in_stock?: boolean;
          offer_count?: number;
          observed_at: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["variant_current_price"]["Insert"]
        >;
        Relationships: [];
      };
      variant_daily_prices: {
        Row: {
          variant_id: UUID;
          day: string; // 'YYYY-MM-DD'
          min_price: number | null;
          median_price: number | null;
          max_price: number | null;
          obs_count: number;
          offer_count: number;
          has_flash_sale: boolean;
          flash_min_price: number | null;
        };
        Insert: {
          variant_id: UUID;
          day: string;
          min_price?: number | null;
          median_price?: number | null;
          max_price?: number | null;
          obs_count?: number;
          offer_count?: number;
          has_flash_sale?: boolean;
          flash_min_price?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["variant_daily_prices"]["Insert"]
        >;
        Relationships: [];
      };
      variant_deal_scores: {
        Row: {
          variant_id: UUID;
          score: number | null;
          recommendation: "insufficient_data" | "buy" | "wait" | "avoid";
          price_at_compute: number | null;
          computed_at: Timestamp;
        };
        Insert: {
          variant_id: UUID;
          score?: number | null;
          recommendation: "insufficient_data" | "buy" | "wait" | "avoid";
          price_at_compute?: number | null;
          computed_at?: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["variant_deal_scores"]["Insert"]
        >;
        Relationships: [];
      };
      lookup_requests: {
        Row: {
          id: number;
          ip_hash: string;
          user_id: UUID | null;
          outcome: "resolved" | "ingested" | "rejected" | "error";
          created_at: Timestamp;
        };
        Insert: {
          id?: number;
          ip_hash: string;
          user_id?: UUID | null;
          outcome: "resolved" | "ingested" | "rejected" | "error";
          created_at?: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["lookup_requests"]["Insert"]
        >;
        Relationships: [];
      };
      sellers: {
        Row: {
          id: UUID;
          marketplace: string;
          external_seller_id: string;
          name: string | null;
          rating: number | null;
          rating_count: number | null;
          is_official: boolean;
          location: string | null;
          updated_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          marketplace: string;
          external_seller_id: string;
          name?: string | null;
          rating?: number | null;
          rating_count?: number | null;
          is_official?: boolean;
          location?: string | null;
          updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["sellers"]["Insert"]>;
        Relationships: [];
      };
      listings: {
        Row: {
          id: UUID;
          marketplace: string;
          external_item_id: string;
          seller_id: UUID | null;
          title: string | null;
          url: string | null;
          status: string;
          first_seen_at: Timestamp;
          last_observed_at: Timestamp | null;
          refresh_priority: number;
        };
        Insert: {
          id?: UUID;
          marketplace: string;
          external_item_id: string;
          seller_id?: UUID | null;
          title?: string | null;
          url?: string | null;
          status?: string;
          first_seen_at?: Timestamp;
          last_observed_at?: Timestamp | null;
          refresh_priority?: number;
        };
        Update: Partial<Database["public"]["Tables"]["listings"]["Insert"]>;
        Relationships: [];
      };
      offers: {
        Row: {
          id: UUID;
          listing_id: UUID;
          external_model_id: string | null;
          variant_id: UUID | null;
          match_confidence: number | null;
          match_status: "auto" | "manual" | "rejected" | "pending";
        };
        Insert: {
          id?: UUID;
          listing_id: UUID;
          external_model_id?: string | null;
          variant_id?: UUID | null;
          match_confidence?: number | null;
          match_status?: "auto" | "manual" | "rejected" | "pending";
        };
        Update: Partial<Database["public"]["Tables"]["offers"]["Insert"]>;
        Relationships: [];
      };
      price_observations: {
        Row: {
          id: number;
          offer_id: UUID;
          observed_at: Timestamp;
          price: number | null;
          original_price: number | null;
          stock: number | null;
          is_flash_sale: boolean;
          is_valid: boolean;
          invalid_reason: string | null;
          source: "api" | "extension";
          collector_run_id: UUID | null;
        };
        Insert: {
          id?: number;
          offer_id: UUID;
          observed_at?: Timestamp;
          price?: number | null;
          original_price?: number | null;
          stock?: number | null;
          is_flash_sale?: boolean;
          is_valid?: boolean;
          invalid_reason?: string | null;
          source?: "api" | "extension";
          collector_run_id?: UUID | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["price_observations"]["Insert"]
        >;
        Relationships: [];
      };
      match_candidates: {
        Row: {
          id: UUID;
          offer_id: UUID;
          suggested_variant_id: UUID | null;
          confidence: number | null;
          reason: string | null;
          reviewed_by: UUID | null;
          decision: "accepted" | "rejected" | "pending" | null;
          reviewed_at: Timestamp | null;
        };
        Insert: {
          id?: UUID;
          offer_id: UUID;
          suggested_variant_id?: UUID | null;
          confidence?: number | null;
          reason?: string | null;
          reviewed_by?: UUID | null;
          decision?: "accepted" | "rejected" | "pending" | null;
          reviewed_at?: Timestamp | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["match_candidates"]["Insert"]
        >;
        Relationships: [];
      };
      affiliate_offers: {
        Row: {
          offer_id: UUID;
          affiliate_url: string | null;
          short_link: string | null;
          commission_rate: number | null;
          campaign: string | null;
          eligible: boolean;
          updated_at: Timestamp;
        };
        Insert: {
          offer_id: UUID;
          affiliate_url?: string | null;
          short_link?: string | null;
          commission_rate?: number | null;
          campaign?: string | null;
          eligible?: boolean;
          updated_at?: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["affiliate_offers"]["Insert"]
        >;
        Relationships: [];
      };
      users: {
        Row: {
          id: UUID;
          email: string | null;
          auth_provider: string | null;
          created_at: Timestamp;
          marketing_opt_in: boolean;
          consent_version: string | null;
          deleted_at: Timestamp | null;
        };
        Insert: {
          id: UUID;
          email?: string | null;
          auth_provider?: string | null;
          created_at?: Timestamp;
          marketing_opt_in?: boolean;
          consent_version?: string | null;
          deleted_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      watches: {
        Row: {
          id: UUID;
          user_id: UUID;
          product_id: UUID | null;
          variant_id: UUID | null;
          target_price: number | null;
          trigger_rules: Json;
          channels: string[];
          folder: string | null;
          note: string | null;
          status: "active" | "paused" | "done";
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          user_id: UUID;
          product_id?: UUID | null;
          variant_id?: UUID | null;
          target_price?: number | null;
          trigger_rules?: Json;
          channels?: string[];
          folder?: string | null;
          note?: string | null;
          status?: "active" | "paused" | "done";
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["watches"]["Insert"]>;
        Relationships: [];
      };
      alert_events: {
        Row: {
          id: UUID;
          watch_id: UUID;
          trigger_type: string | null;
          price: number | null;
          sent_at: Timestamp;
          channel: string | null;
          delivered: boolean | null;
          opened: boolean | null;
          clicked: boolean | null;
        };
        Insert: {
          id?: UUID;
          watch_id: UUID;
          trigger_type?: string | null;
          price?: number | null;
          sent_at?: Timestamp;
          channel?: string | null;
          delivered?: boolean | null;
          opened?: boolean | null;
          clicked?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["alert_events"]["Insert"]>;
        Relationships: [];
      };
      click_events: {
        Row: {
          id: UUID;
          user_id: UUID | null;
          offer_id: UUID | null;
          source: "web" | "extension" | "email" | "push" | null;
          watch_id: UUID | null;
          created_at: Timestamp;
          session_id: string | null;
        };
        Insert: {
          id?: UUID;
          user_id?: UUID | null;
          offer_id?: UUID | null;
          source?: "web" | "extension" | "email" | "push" | null;
          watch_id?: UUID | null;
          created_at?: Timestamp;
          session_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["click_events"]["Insert"]>;
        Relationships: [];
      };
      conversions: {
        Row: {
          id: UUID;
          click_ref: string | null;
          order_value: number | null;
          commission: number | null;
          status: string | null;
          reported_at: Timestamp | null;
        };
        Insert: {
          id?: UUID;
          click_ref?: string | null;
          order_value?: number | null;
          commission?: number | null;
          status?: string | null;
          reported_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["conversions"]["Insert"]>;
        Relationships: [];
      };
      collector_runs: {
        Row: {
          id: UUID;
          source: string;
          started_at: Timestamp;
          finished_at: Timestamp | null;
          items_ok: number;
          items_failed: number;
          error_summary: string | null;
        };
        Insert: {
          id?: UUID;
          source: string;
          started_at?: Timestamp;
          finished_at?: Timestamp | null;
          items_ok?: number;
          items_failed?: number;
          error_summary?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["collector_runs"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      refresh_variant_daily_prices: {
        Args: {
          p_from: string;
          p_to: string;
        };
        Returns: number;
      };
      latest_price_per_offer: {
        Args: {
          p_variant_id: UUID;
        };
        Returns: {
          offer_id: UUID;
          price: number | null;
          original_price: number | null;
          stock: number | null;
          is_flash_sale: boolean;
          observed_at: Timestamp;
        }[];
      };
      variant_tracking_since: {
        Args: {
          p_variant_id: UUID;
        };
        Returns: string | null;
      };
      search_products: {
        Args: {
          p_q?: string | null;
          p_category_id?: UUID | null;
          p_brands?: string[] | null;
          p_min_price?: number | null;
          p_max_price?: number | null;
          p_sort?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: {
          product_id: UUID;
          slug: string;
          canonical_name: string;
          brand: string | null;
          image: string | null;
          category_slug: string | null;
          best_price: number | null;
          original_price: number | null;
          score: number | null;
          recommendation: "insufficient_data" | "buy" | "wait" | "avoid" | null;
          last_observed_at: Timestamp | null;
          relevance: number | null;
          total_count: number;
        }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
