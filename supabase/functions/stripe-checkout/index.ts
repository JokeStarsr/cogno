/**
 * Stripe Checkout 会话创建（Phase 1.4）。
 * 部署前提：supabase secrets set STRIPE_SECRET_KEY；PLAN_PRICES 按需配置。
 * 鉴权：Supabase JWT（anon key 可用，靠 profile 匹配保证只能开自己的单）。
 */
import Stripe from 'https://esm.sh/stripe@16.1.0'

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')
if (!STRIPE_SECRET) throw new Error('缺少 STRIPE_SECRET_KEY')

const stripe = new Stripe(STRIPE_SECRET)

/** 方案 → Stripe 价格 ID（部署前按账套填入） */
const PLAN_PRICES: Record<string, string> = {
  pro: Deno.env.get('STRIPE_PRO_PRICE_ID') ?? '',
  enterprise: Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID') ?? '',
}

const SUCCESS_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'http://115.159.221.62:8090'
const ORIGIN = 'http://115.159.221.62:8090'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // 鉴权：携带用户 JWT（客户端 supabase.auth.getSession 的头）
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: '未登录' }, 401)
  const token = auth.slice(7)

  let userId: string
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return json({ error: '登录已失效' }, 401)
    userId = data.user.id
  } catch {
    return json({ error: '鉴权失败' }, 401)
  }

  let body: { plan?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'body 无效' }, 400)
  }
  const priceId = body.plan ? PLAN_PRICES[body.plan] : ''
  if (!priceId) return json({ error: '未知方案' }, 400)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SUCCESS_URL}/?payment=success`,
      cancel_url: `${SUCCESS_URL}/settings?payment=cancel`,
      client_reference_id: userId,
      // 订阅归属：回调里依据 client_reference_id 写 profiles.plan
      metadata: { plan: body.plan ?? '' },
      allow_promotion_codes: true,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error('stripe checkout 失败', e)
    return json({ error: '支付服务暂时不可用，请稍后重试' }, 502)
  }
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN },
  })
}

// supabase 客户端由 Supabase Edge Runtime 自动注入（build-time 声明）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { auth: { persistSession: false } }
)