import 'dotenv/config'
import { buildServer } from './server'
import { openDb } from './db'

openDb()
const app = buildServer()
const port = Number(process.env.API_PORT ?? 3100)

app.listen({ port, host: '127.0.0.1' }).then((addr) => {
  console.log(`hireyou-apply api listening on ${addr}`)
})
