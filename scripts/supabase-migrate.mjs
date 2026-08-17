// 一键执行 supabase/migrations/0001_init.sql（维护脚本，不含任何凭据）
// 用法（连接串从参数或环境变量 SUBABASE_DB_URL 传入）:
//   node scripts/supabase-migrate.mjs "postgresql://postgres.<ref>:密码@<pooler>:5432/postgres"
// 若直连域名仅 IPv6（国内网络无 IPv6 出口）→ 换成 Session pooler 主机即可
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const conn = process.argv[2] ?? process.env.SUPABASE_DB_URL
if (!conn) {
  console.error('用法: node scripts/supabase-migrate.mjs <postgres连接串>')
  process.exit(1)
}

const sql = readFileSync(resolve(process.cwd(), 'supabase', 'migrations', '0001_init.sql'), 'utf8')
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log('已连接:', `${client.host}:${client.port}（用户 ${client.user}）`)
  await client.query(sql)
  console.log('✅ 建表 SQL 执行成功')
  const { rows } = await client.query(
    "select tablename from pg_tables where schemaname='public' order by tablename"
  )
  console.log('public 表清单:', rows.map((r) => r.tablename).join(', '))
} finally {
  await client.end().catch(() => {})
}