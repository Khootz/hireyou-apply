import 'dotenv/config'
import { buildServer } from './server'
import { openDb } from './db'
import { rotationReminders } from './services/keyRotation'

const { sqlite } = openDb()
const app = buildServer({ sqlite })
const port = Number(process.env.API_PORT ?? 3100)

app.listen({ port, host: '127.0.0.1' }).then((addr) => {
  console.log(`hireyou-apply api listening on ${addr}`)
  for (const r of rotationReminders(sqlite)) {
    console.warn(
      `⚠ ${r.key} has not been rotated in ${r.days_old} days (first seen ${r.first_seen.slice(0, 10)}) — rotate it and update .env`,
    )
  }
})
