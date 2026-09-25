export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      affiliate_offers: {
        Row: {
          affiliate_url: string | null
          campaign: string | null
          commission_rate: number | null
          eligible: boolean
          offer_id: string
          short_link: string | null
          updated_at: string
        }
        Insert: {
          affiliate_url?: string | null
          campaign?: string | null
          commission_rate?: number | null
          eligible?: boolean
          offer_id: string
          short_link?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_url?: string | null
          campaign?: string | null
          commission_rate?: number | null
          eligible?: boolean
          offer_id?: string
          short_link?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_offers_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_deliveries: {
        Row: {
          alert_event_id: string
          attempts: number
          channel: string
          claimed_at: string | null
          id: string
          last_error: string | null
          next_attempt_at: string
          provider_message_id: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
        }
        Insert: {
          alert_event_id: string
          attempts?: number
          channel: string
          claimed_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at: string
          provider_message_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
        }
        Update: {
          alert_event_id?: string
          attempts?: number
          channel?: string
          claimed_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          provider_message_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_deliveries_alert_event_id_fkey"
            columns: ["alert_event_id"]
            isOneToOne: false
            referencedRelation: "alert_events"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_events: {
        Row: {
          baseline_price: number | null
          created_at: string
          deal_score: number | null
          deliver_after: string
          id: string
          offer_id: string | null
          previous_alert_price: number | null
          price: number | null
          recommendation: string | null
          score_reasons: string[]
          trigger_types: string[]
          watch_id: string
        }
        Insert: {
          baseline_price?: number | null
          created_at?: string
          deal_score?: number | null
          deliver_after?: string
          id?: string
          offer_id?: string | null
          previous_alert_price?: number | null
          price?: number | null
          recommendation?: string | null
          score_reasons?: string[]
          trigger_types?: string[]
          watch_id: string
        }
        Update: {
          baseline_price?: number | null
          created_at?: string
          deal_score?: number | null
          deliver_after?: string
          id?: string
          offer_id?: string | null
          previous_alert_price?: number | null
          price?: number | null
          recommendation?: string | null
          score_reasons?: string[]
          trigger_types?: string[]
          watch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "watches"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          created_at: string
          id: number
          name: string
          props: Json
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          props?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          props?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_runs: {
        Row: {
          accuracy: number | null
          avoid_correct: number
          avoid_n: number
          buy_correct: number
          buy_n: number
          drop_threshold: number
          horizon_days: number
          id: string
          ran_at: string
          samples: number
          variants: number
          version: string
          wait_correct: number
          wait_n: number
        }
        Insert: {
          accuracy?: number | null
          avoid_correct: number
          avoid_n: number
          buy_correct: number
          buy_n: number
          drop_threshold: number
          horizon_days: number
          id?: string
          ran_at?: string
          samples: number
          variants: number
          version?: string
          wait_correct: number
          wait_n: number
        }
        Update: {
          accuracy?: number | null
          avoid_correct?: number
          avoid_n?: number
          buy_correct?: number
          buy_n?: number
          drop_threshold?: number
          horizon_days?: number
          id?: string
          ran_at?: string
          samples?: number
          variants?: number
          version?: string
          wait_correct?: number
          wait_n?: number
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      click_events: {
        Row: {
          alert_event_id: string | null
          created_at: string
          id: string
          offer_id: string | null
          session_id: string | null
          source: string | null
          user_id: string | null
          watch_id: string | null
        }
        Insert: {
          alert_event_id?: string | null
          created_at?: string
          id?: string
          offer_id?: string | null
          session_id?: string | null
          source?: string | null
          user_id?: string | null
          watch_id?: string | null
        }
        Update: {
          alert_event_id?: string | null
          created_at?: string
          id?: string
          offer_id?: string | null
          session_id?: string | null
          source?: string | null
          user_id?: string | null
          watch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "click_events_alert_event_id_fkey"
            columns: ["alert_event_id"]
            isOneToOne: false
            referencedRelation: "alert_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "click_events_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "click_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "click_events_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "watches"
            referencedColumns: ["id"]
          },
        ]
      }
      collector_runs: {
        Row: {
          error_summary: string | null
          finished_at: string | null
          id: string
          items_failed: number
          items_ok: number
          source: string
          started_at: string
        }
        Insert: {
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          items_failed?: number
          items_ok?: number
          source: string
          started_at?: string
        }
        Update: {
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          items_failed?: number
          items_ok?: number
          source?: string
          started_at?: string
        }
        Relationships: []
      }
      conversions: {
        Row: {
          click_event_id: string | null
          commission: number | null
          complete_time: string | null
          first_seen_at: string
          id: string
          import_source: string
          item_id: string
          item_price: number | null
          marketplace: string
          model_id: string
          order_id: string
          order_value: number | null
          purchase_time: string
          quantity: number | null
          raw: Json
          raw_status: string
          source_channel: string
          status: string
          sub_ids: string[]
          updated_at: string
        }
        Insert: {
          click_event_id?: string | null
          commission?: number | null
          complete_time?: string | null
          first_seen_at?: string
          id?: string
          import_source: string
          item_id: string
          item_price?: number | null
          marketplace?: string
          model_id?: string
          order_id: string
          order_value?: number | null
          purchase_time: string
          quantity?: number | null
          raw: Json
          raw_status: string
          source_channel?: string
          status: string
          sub_ids?: string[]
          updated_at?: string
        }
        Update: {
          click_event_id?: string | null
          commission?: number | null
          complete_time?: string | null
          first_seen_at?: string
          id?: string
          import_source?: string
          item_id?: string
          item_price?: number | null
          marketplace?: string
          model_id?: string
          order_id?: string
          order_value?: number | null
          purchase_time?: string
          quantity?: number | null
          raw?: Json
          raw_status?: string
          source_channel?: string
          status?: string
          sub_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversions_click_event_id_fkey"
            columns: ["click_event_id"]
            isOneToOne: false
            referencedRelation: "click_events"
            referencedColumns: ["id"]
          },
        ]
      }
      job_locks: {
        Row: {
          locked_until: string
          name: string
          owner: string | null
        }
        Insert: {
          locked_until?: string
          name: string
          owner?: string | null
        }
        Update: {
          locked_until?: string
          name?: string
          owner?: string | null
        }
        Relationships: []
      }
      listings: {
        Row: {
          external_item_id: string
          first_seen_at: string
          id: string
          last_observed_at: string | null
          marketplace: string
          refresh_priority: number
          seller_id: string | null
          status: string
          title: string | null
          url: string | null
        }
        Insert: {
          external_item_id: string
          first_seen_at?: string
          id?: string
          last_observed_at?: string | null
          marketplace: string
          refresh_priority?: number
          seller_id?: string | null
          status?: string
          title?: string | null
          url?: string | null
        }
        Update: {
          external_item_id?: string
          first_seen_at?: string
          id?: string
          last_observed_at?: string | null
          marketplace?: string
          refresh_priority?: number
          seller_id?: string | null
          status?: string
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      lookup_requests: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
          is_ingest: boolean
          outcome: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          ip_hash: string
          is_ingest?: boolean
          outcome: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          ip_hash?: string
          is_ingest?: boolean
          outcome?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lookup_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_candidates: {
        Row: {
          confidence: number | null
          decision: string | null
          id: string
          offer_id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          suggested_variant_id: string | null
        }
        Insert: {
          confidence?: number | null
          decision?: string | null
          id?: string
          offer_id: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          suggested_variant_id?: string | null
        }
        Update: {
          confidence?: number | null
          decision?: string | null
          id?: string
          offer_id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          suggested_variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_candidates_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_suggested_variant_id_fkey"
            columns: ["suggested_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          digest_hour: number
          email_enabled: boolean
          frequency: string
          push_enabled: boolean
          quiet_end: number | null
          quiet_start: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          digest_hour?: number
          email_enabled?: boolean
          frequency?: string
          push_enabled?: boolean
          quiet_end?: number | null
          quiet_start?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          digest_hour?: number
          email_enabled?: boolean
          frequency?: string
          push_enabled?: boolean
          quiet_end?: number | null
          quiet_start?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          external_model_id: string | null
          free_shipping: boolean | null
          has_voucher: boolean | null
          id: string
          listing_id: string
          match_confidence: number | null
          match_status: string
          variant_id: string | null
        }
        Insert: {
          external_model_id?: string | null
          free_shipping?: boolean | null
          has_voucher?: boolean | null
          id?: string
          listing_id: string
          match_confidence?: number | null
          match_status?: string
          variant_id?: string | null
        }
        Update: {
          external_model_id?: string | null
          free_shipping?: boolean | null
          has_voucher?: boolean | null
          id?: string
          listing_id?: string
          match_confidence?: number | null
          match_status?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_observations: {
        Row: {
          collector_run_id: string | null
          id: number
          invalid_reason: string | null
          is_flash_sale: boolean
          is_valid: boolean
          observed_at: string
          offer_id: string
          original_price: number | null
          price: number | null
          source: string
          stock: number | null
        }
        Insert: {
          collector_run_id?: string | null
          id?: never
          invalid_reason?: string | null
          is_flash_sale?: boolean
          is_valid?: boolean
          observed_at?: string
          offer_id: string
          original_price?: number | null
          price?: number | null
          source?: string
          stock?: number | null
        }
        Update: {
          collector_run_id?: string | null
          id?: never
          invalid_reason?: string | null
          is_flash_sale?: boolean
          is_valid?: boolean
          observed_at?: string
          offer_id?: string
          original_price?: number | null
          price?: number | null
          source?: string
          stock?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_observations_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          id: string
          product_id: string
          specs: Json
          variant_key: string
        }
        Insert: {
          id?: string
          product_id: string
          specs?: Json
          variant_key: string
        }
        Update: {
          id?: string
          product_id?: string
          specs?: Json
          variant_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          canonical_name: string
          category_id: string | null
          created_at: string
          gtin: string | null
          id: string
          image: string | null
          model: string | null
          search_text: string | null
          slug: string | null
          specs: Json
          status: string
        }
        Insert: {
          brand?: string | null
          canonical_name: string
          category_id?: string | null
          created_at?: string
          gtin?: string | null
          id?: string
          image?: string | null
          model?: string | null
          search_text?: string | null
          slug?: string | null
          specs?: Json
          status?: string
        }
        Update: {
          brand?: string | null
          canonical_name?: string
          category_id?: string | null
          created_at?: string
          gtin?: string | null
          id?: string
          image?: string | null
          model?: string | null
          search_text?: string | null
          slug?: string | null
          specs?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fk"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sellers: {
        Row: {
          external_seller_id: string
          id: string
          is_official: boolean
          location: string | null
          marketplace: string
          name: string | null
          rating: number | null
          rating_count: number | null
          updated_at: string
        }
        Insert: {
          external_seller_id: string
          id?: string
          is_official?: boolean
          location?: string | null
          marketplace: string
          name?: string | null
          rating?: number | null
          rating_count?: number | null
          updated_at?: string
        }
        Update: {
          external_seller_id?: string
          id?: string
          is_official?: boolean
          location?: string | null
          marketplace?: string
          name?: string | null
          rating?: number | null
          rating_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          auth_provider: string | null
          consent_at: string | null
          consent_version: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          marketing_opt_in: boolean
        }
        Insert: {
          auth_provider?: string | null
          consent_at?: string | null
          consent_version?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id: string
          marketing_opt_in?: boolean
        }
        Update: {
          auth_provider?: string | null
          consent_at?: string | null
          consent_version?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          marketing_opt_in?: boolean
        }
        Relationships: []
      }
      variant_current_price: {
        Row: {
          best_offer_id: string | null
          in_stock: boolean
          is_flash_sale: boolean
          observed_at: string
          offer_count: number
          original_price: number | null
          price: number | null
          variant_id: string
        }
        Insert: {
          best_offer_id?: string | null
          in_stock?: boolean
          is_flash_sale?: boolean
          observed_at: string
          offer_count?: number
          original_price?: number | null
          price?: number | null
          variant_id: string
        }
        Update: {
          best_offer_id?: string | null
          in_stock?: boolean
          is_flash_sale?: boolean
          observed_at?: string
          offer_count?: number
          original_price?: number | null
          price?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_current_price_best_offer_id_fkey"
            columns: ["best_offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_current_price_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_daily_prices: {
        Row: {
          day: string
          flash_min_price: number | null
          has_flash_sale: boolean
          max_price: number | null
          median_price: number | null
          min_price: number | null
          obs_count: number
          offer_count: number
          variant_id: string
        }
        Insert: {
          day: string
          flash_min_price?: number | null
          has_flash_sale?: boolean
          max_price?: number | null
          median_price?: number | null
          min_price?: number | null
          obs_count?: number
          offer_count?: number
          variant_id: string
        }
        Update: {
          day?: string
          flash_min_price?: number | null
          has_flash_sale?: boolean
          max_price?: number | null
          median_price?: number | null
          min_price?: number | null
          obs_count?: number
          offer_count?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_daily_prices_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_deal_scores: {
        Row: {
          computed_at: string
          price_at_compute: number | null
          recommendation: string
          score: number | null
          variant_id: string
        }
        Insert: {
          computed_at?: string
          price_at_compute?: number | null
          recommendation: string
          score?: number | null
          variant_id: string
        }
        Update: {
          computed_at?: string
          price_at_compute?: number | null
          recommendation?: string
          score?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_deal_scores_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      watches: {
        Row: {
          baseline_price: number | null
          channels: string[] | null
          cond_state: Json
          config_version: number
          created_at: string
          drop_pct: number | null
          folder: string | null
          id: string
          last_alert_price: number | null
          last_alerted_at: string | null
          last_evaluated_at: string | null
          last_in_stock: boolean | null
          min_deal_score: number | null
          note: string | null
          notify_back_in_stock: boolean
          notify_low: boolean
          product_id: string | null
          status: string
          target_price: number | null
          updated_at: string
          user_id: string
          variant_id: string
        }
        Insert: {
          baseline_price?: number | null
          channels?: string[] | null
          cond_state?: Json
          config_version?: number
          created_at?: string
          drop_pct?: number | null
          folder?: string | null
          id?: string
          last_alert_price?: number | null
          last_alerted_at?: string | null
          last_evaluated_at?: string | null
          last_in_stock?: boolean | null
          min_deal_score?: number | null
          note?: string | null
          notify_back_in_stock?: boolean
          notify_low?: boolean
          product_id?: string | null
          status?: string
          target_price?: number | null
          updated_at?: string
          user_id?: string
          variant_id: string
        }
        Update: {
          baseline_price?: number | null
          channels?: string[] | null
          cond_state?: Json
          config_version?: number
          created_at?: string
          drop_pct?: number | null
          folder?: string | null
          id?: string
          last_alert_price?: number | null
          last_alerted_at?: string | null
          last_evaluated_at?: string | null
          last_in_stock?: boolean | null
          min_deal_score?: number | null
          note?: string | null
          notify_back_in_stock?: boolean
          notify_low?: boolean
          product_id?: string | null
          status?: string
          target_price?: number | null
          updated_at?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watches_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      affiliate_by_alert: {
        Row: {
          alert_event_id: string | null
          commission_completed: number | null
          orders: number | null
        }
        Relationships: [
          {
            foreignKeyName: "click_events_alert_event_id_fkey"
            columns: ["alert_event_id"]
            isOneToOne: false
            referencedRelation: "alert_events"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_daily: {
        Row: {
          channel: string | null
          clicks: number | null
          commission_completed: number | null
          commission_pending: number | null
          day: string | null
          gmv_completed: number | null
          gmv_pending: number | null
          match_rate: number | null
          orders_matched: number | null
          orders_total: number | null
        }
        Relationships: []
      }
      alert_click_rate_daily: {
        Row: {
          alerts_clicked: number | null
          alerts_sent: number | null
          day: string | null
        }
        Relationships: []
      }
      metrics_active_watches: {
        Row: {
          active_watches: number | null
          watching_users: number | null
        }
        Relationships: []
      }
      metrics_daily_active_users: {
        Row: {
          active_users: number | null
          day: string | null
        }
        Relationships: []
      }
      metrics_matching_quality: {
        Row: {
          auto: number | null
          manual: number | null
          marketplace: string | null
          offers: number | null
          pending: number | null
          rejected: number | null
          suggestions_accepted: number | null
          suggestions_reviewed: number | null
        }
        Relationships: []
      }
      metrics_retention_d30: {
        Row: {
          cohort_size: number | null
          cohort_week: string | null
          rate: number | null
          retained: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_due_deliveries: {
        Args: { p_limit: number; p_now: string }
        Returns: {
          alert_event_id: string
          attempts: number
          channel: string
          delivery_id: string
          user_id: string
          watch_id: string
        }[]
      }
      collector_candidates: {
        Args: { p_limit: number; p_marketplaces?: string[] }
        Returns: {
          external_item_id: string
          id: string
          last_observed_at: string
          marketplace: string
          refresh_priority: number
          watched: boolean
        }[]
      }
      f_unaccent: { Args: { "": string }; Returns: string }
      filter_availability: {
        Args: never
        Returns: {
          free_shipping: boolean
          rating: boolean
          voucher: boolean
        }[]
      }
      ingest_shopee_item: { Args: { p: Json }; Returns: Json }
      latest_price_per_offer: {
        Args: { p_variant_id: string }
        Returns: {
          is_flash_sale: boolean
          observed_at: string
          offer_id: string
          original_price: number
          price: number
          stock: number
        }[]
      }
      lookup_begin: {
        Args: { p_ip_hash: string; p_user_id: string }
        Returns: {
          allowed: boolean
          reason: string
          request_id: number
        }[]
      }
      lookup_begin_ingest: {
        Args: { p_global_cap: number; p_request_id: number }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      price_drop_radar: {
        Args: {
          p_category_id?: string
          p_limit?: number
          p_min_drop?: number
          p_offset?: number
        }
        Returns: {
          best_price: number
          brand: string
          canonical_name: string
          category_slug: string
          drop_pct: number
          image: string
          last_observed_at: string
          median_30d: number
          original_price: number
          product_id: string
          recommendation: string
          score: number
          slug: string
          total_count: number
          variant_id: string
          variant_key: string
        }[]
      }
      product_brands: {
        Args: never
        Returns: {
          brand: string
        }[]
      }
      record_observations: { Args: { p: Json }; Returns: string[] }
      record_watch_evaluation: {
        Args: {
          p_config_version: number
          p_event: Json
          p_now: string
          p_state: Json
          p_watch_id: string
        }
        Returns: string
      }
      refresh_variant_current_price: {
        Args: { p_variant_ids: string[] }
        Returns: undefined
      }
      refresh_variant_daily_prices: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      release_job_lock: {
        Args: { p_name: string; p_owner: string }
        Returns: undefined
      }
      search_products: {
        Args: {
          p_brands?: string[]
          p_category_id?: string
          p_free_shipping?: boolean
          p_has_voucher?: boolean
          p_limit?: number
          p_max_price?: number
          p_min_price?: number
          p_min_rating?: number
          p_offset?: number
          p_q?: string
          p_sort?: string
        }
        Returns: {
          best_price: number
          brand: string
          canonical_name: string
          category_slug: string
          image: string
          last_observed_at: string
          original_price: number
          product_id: string
          recommendation: string
          relevance: number
          score: number
          slug: string
          total_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      trending_products: {
        Args: { p_category_id?: string; p_limit?: number; p_mode: string }
        Returns: {
          best_price: number
          brand: string
          canonical_name: string
          category_slug: string
          image: string
          last_observed_at: string
          original_price: number
          product_id: string
          recommendation: string
          score: number
          slug: string
          views_7d: number
          views_prev_7d: number
          watch_count: number
        }[]
      }
      try_acquire_job_lock: {
        Args: { p_name: string; p_owner: string; p_ttl_seconds: number }
        Returns: boolean
      }
      unaccent: { Args: { "": string }; Returns: string }
      upsert_conversions: {
        Args: { p_rows: Json }
        Returns: {
          inserted: number
          matched: number
          updated: number
        }[]
      }
      variant_tracking_since: {
        Args: { p_variant_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

