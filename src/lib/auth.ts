import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

/**
 * 认证层（Phase 1.3）：邮箱注册/登录/Google OAuth/登出/会话监听。
 * 未配置 Supabase（纯本地模式）时返回明确错误，UI 据此隐藏云端入口。
 */

export interface AuthResult {
  ok: boolean
  error?: string
}

function friendlyAuthError(message: string | null): string {
  if (!message) return '操作失败，请稍后再试'
  if (message.includes('already registered') || message.includes('already')) return '该邮箱已被注册'
  if (message.includes('invalid_credentials') || message.includes('Invalid login')) return '邮箱或密码错误'
  if (message.includes('weak_password')) return '密码强度不足（至少 8 位）'
  if (message.includes('rate limit') || message.includes('too many')) return '尝试过于频繁，请稍后再试'
  if (message.includes('network') || message.includes('fetch')) return '网络错误：无法连接云端（可离线使用本地模式）'
  return message
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: '云端未配置，当前为纯本地模式' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '邮箱格式不正确' }
  if (password.length < 8) return { ok: false, error: '密码至少 8 位' }
  try {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) return { ok: false, error: friendlyAuthError(error.message) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: friendlyAuthError((e as Error).message) }
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: '云端未配置，当前为纯本地模式' }
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, error: friendlyAuthError(error.message) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: friendlyAuthError((e as Error).message) }
  }
}

export async function signInWithGoogle(): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: '云端未配置，当前为纯本地模式' }
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) return { ok: false, error: friendlyAuthError(error.message) }
    return { ok: true } // OAuth 会整页跳转，不需要本地状态流转
  } catch (e) {
    return { ok: false, error: friendlyAuthError((e as Error).message) }
  }
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.auth.signOut()
  } catch {
    /* 登出失败不阻塞流程 */
  }
}

export async function getSession(): Promise<User | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user ?? null
}

/** 登录状态变更订阅；返回取消函数（组件卸载时调用） */
export function onAuthStateChange(cb: (user: User | null) => void): () => void {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null)
  })
  return () => data.subscription.unsubscribe()
}