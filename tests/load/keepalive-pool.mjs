import { createServer } from 'node:http'
/**
 * Measures what the keep-alive pool (lib/transvoice/http.ts) changes: TCP connections opened for
 * 3 requests made 5 s apart, against servers with different Keep-Alive hints.
 *   node tests/load/keepalive-pool.mjs        (takes ~1 minute)
 */
import { Agent, fetch } from 'undici'
for (const hint of [0, 5000, 60000]) {
  let conns = 0
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-length': 2 })
    res.end('{}')
  })
  server.keepAliveTimeout = hint // 0: never closes idle sockets and sends no Keep-Alive hint
  server.on('connection', () => conns++)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/`
  for (const [name, agent] of [
    ['global default', undefined],
    ['our pool (60 s)', new Agent({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 300000 })],
  ]) {
    conns = 0
    for (let i = 0; i < 3; i++) {
      await (await fetch(url, { dispatcher: agent })).arrayBuffer()
      if (i < 2) await new Promise((r) => setTimeout(r, 5000))
    }
    console.log(
      `server keep-alive hint ${hint ? hint / 1000 + ' s' : 'none'} | ${name}: ${conns} connection(s) for 3 requests 5 s apart`,
    )
  }
  server.closeAllConnections()
  server.close()
}
