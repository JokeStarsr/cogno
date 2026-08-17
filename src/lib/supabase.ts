import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase 客户端（Phase 1.1-1.4 云端同步/账号基础）。
 * 未配置环境变量时 supabase 为 null → 应用保持纯本地模式，一行云代码都不跑。
 * key 使用 publishable key（设计上可公开；数据安全靠 RLS 行级策略，不靠 key 保密）。
 */
const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const supabase: SupabaseClient | null =
  URL && KEY ? createClient(URL, KEY) : null

/** 云端是否已启用（构建期内恒定的布尔，前端据此显示"同步"入口与提示） */
export const isCloudEnabled = supabase != null