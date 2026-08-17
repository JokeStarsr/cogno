/**
 * Stripe Webhook（Phase 1.4）：订阅事件 → profiles.plan 与 subscriptions 表。
 * 必须校验 Stripe 签名，防止伪造事件改写他人方案。
 * 定位模型：checkout.session.completed 即写入 subscriptions 行（含 user_id 与 sub id），
 * 之后的 subscription.* 事件按 stripe_subscription_id 反查该行拿 user_id。
 * 部署前提：supabase secrets set STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET（Stripe 后台签名密钥）。
 */
import Stripe from 'https://esm.sh/stripe@16.1.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')
if (!STRIPE_SECRET || !WEBHOOK_SECRET) throw new Error('缺少 STRIPE 密钥配置')

const stripe = new Stripe(STRIPE_SECRET)
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const PLAN_BY_KEY: Record<string, string> = { pro: 'pro', enterprise: 'enterprise' }
const ACTIVE_STATUSES = new Set(['active', 'trialing'])

function toPlan(metaKey: string | undefined, status: string): string {
  return ACTIVE_STATUSES.has(status) ? (PLAN_BY_KEY[metaKey ?? ''] ?? 'free') : 'free'
}

function nowIso(unixSec: number | null): string {
  return unixSec ? new Date(unixSec * 1000).toISOString() : new Date().toISOString()
}

async function upsertSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const metaKey = sub.metadata?.plan
  const plan = toPlan(metaKey, sub.status)
  await supabase.from('profiles').upsert({ user_id: userId, plan }, { onConflict: 'user_id' })
  await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      plan,
      current_period_start: nowIso(sub.current_period_start),
      current_period_end: nowIso(sub.current_period_end),
    },
    { onConflict: 'stripe_subscription_id' }
  )
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const raw = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('missing signature', { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET)
  } catch (e) {
    console.error('签名校验失败', e instanceof Error ? e.message : e)
    return new Response('invalid signature', { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.client_reference_id
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (userId && subId) {
        // 会话刚完成时 subscription 对象可用；用整单 metadata 建首条订阅行
        const sub = typeof session.subscription === 'object' ? session.subscription : await stripe.subscriptions.retrieve(subId)
        await supabase.from('subscriptions').upsert(
          {
            user_id: userId,
            stripe_subscription_id: sub.id,
            status: sub.status,
            plan: toPlan(session.metadata?.plan, sub.status),
            current_period_start: nowIso(sub.current_period_start),
            current_period_end: nowIso(sub.current_period_end),
          },
          { onConflict: 'stripe_subscription_id' }
        )
        await supabase.from('profiles').upsert({ user_id: userId, plan: toPlan(session.metadata?.plan, sub.status) }, { onConflict: 'user_id' })
      }
      return new Response('ok', { status: 200 })
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      const { data, error } = await supabase.from('subscriptions').select('user_id').eq('stripe_subscription_id', sub.id).maybeSingle()
      if (error) throw error
      if (data?.user_id) {
        await upsertSubscription(data.user_id as string, sub)
      } else {
        // 无本地行（换卡重开等边缘）：按 customer 找 profiles（需 profiles.stripe_customer_id 列，
        // 未建列时该分支仅记录日志，subscribe 续期由 checkout.completed 重建）
        console.warn('[stripe-webhook] 未找到本地订阅行的 subscription：', sub.id)
      }
      return new Response('ok', { status: 200 })
    }
  } catch (e) {
    console.error('webhook 处理失败', e)
    return new Response('internal error', { status: 500 })
  }
  return new Response('ok', { status: 200 })
})