// 云端数据状态检查（只读，不含凭据）
// 用法: node scripts/supabase-check.mjs "postgresql://..."
import pg from 'pg'

const conn = process.argv[2] ?? process.env.SUPABASE_DB_URL
if (!conn) {
  console.error('用法: node scripts/supabase-check.mjs <postgres连接串>')
  process.exit(1)
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

// 注册用户（auth 库属于 Supabase Auth schema）
const users = await client.query(
  "select id, email, created_at from auth.users order by created_at desc limit 10"
)
console.log(`\n=== auth.users（${users.rowCount} 个注册用户）===`)
for (const u of users.rows) console.log(`  - ${u.email}  (${u.created_at?.toISOString?.() ?? u.created_at})`)

// 触发器自动建的 profiles
const profiles = await client.query("select id, display_name, plan from public.profiles limit 10")
console.log(`\n=== profiles（${profiles.rowCount} 条，应等于注册用户数）===`)

// 各业务表行数
for (const t of ['reading_sessions', 'documents', 'review_items', 'cognitive_logs']) {
  const { rows } = await client.query(`select count(*)::int as n from public.${t}`)
  console.log(`${t}: ${rows[0].n} 行`)
}

await client.end()